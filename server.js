const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const os = require('os');
const pty = require('node-pty');
const path = require('path');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const fs = require('fs-extra');
const mkdirp = require('mkdirp');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, clientTracking: true });

// Cấu hình middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Cấu hình session
app.use(session({
    secret: 'web-terminal-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // true nếu dùng HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 giờ
    }
}));

// Đường dẫn lưu dữ liệu người dùng
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Đảm bảo thư mục data tồn tại
fs.ensureDirSync(DATA_DIR);

// Khởi tạo file users.json nếu chưa có
if (!fs.existsSync(USERS_FILE)) {
    fs.writeJsonSync(USERS_FILE, {});
}

// Helper: Đọc users
function readUsers() {
    try {
        return fs.readJsonSync(USERS_FILE);
    } catch (err) {
        return {};
    }
}

// Helper: Ghi users
function writeUsers(users) {
    fs.writeJsonSync(USERS_FILE, users);
}

// Helper: Tạo thư mục workspace cho user
function createUserWorkspace(username) {
    const userDir = path.join(DATA_DIR, 'workspaces', username);
    fs.ensureDirSync(userDir);
    
    // Tạo một số file mẫu
    const sampleFiles = [
        { name: 'README.txt', content: `Welcome ${username} to your workspace!\nThis is your personal terminal environment.\n` },
        { name: 'example.py', content: 'print("Hello from Python!")\n' },
        { name: 'example.js', content: 'console.log("Hello from Node.js!");\n' }
    ];
    
    sampleFiles.forEach(file => {
        const filePath = path.join(userDir, file.name);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, file.content);
        }
    });
    
    return userDir;
}

// Middleware: Kiểm tra đăng nhập
function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.redirect('/login.html');
    }
    next();
}

// Routes
app.get('/', (req, res) => {
    if (req.session.userId) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.redirect('/login.html');
    }
});

// API: Đăng ký
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username và password là bắt buộc' });
        }
        
        if (username.length < 3 || username.length > 20) {
            return res.status(400).json({ error: 'Username phải từ 3-20 ký tự' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password phải có ít nhất 6 ký tự' });
        }
        
        const users = readUsers();
        
        if (users[username]) {
            return res.status(400).json({ error: 'Username đã tồn tại' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Tạo user mới
        users[username] = {
            username,
            password: hashedPassword,
            createdAt: new Date().toISOString(),
            lastLogin: null
        };
        
        writeUsers(users);
        
        // Tạo workspace cho user
        createUserWorkspace(username);
        
        res.json({ success: true, message: 'Đăng ký thành công' });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// API: Đăng nhập
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username và password là bắt buộc' });
        }
        
        const users = readUsers();
        const user = users[username];
        
        if (!user) {
            return res.status(401).json({ error: 'Sai username hoặc password' });
        }
        
        // Kiểm tra password
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Sai username hoặc password' });
        }
        
        // Cập nhật last login
        user.lastLogin = new Date().toISOString();
        writeUsers(users);
        
        // Tạo session
        req.session.userId = username;
        req.session.username = username;
        
        res.json({ success: true, message: 'Đăng nhập thành công' });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// API: Đăng xuất
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// API: Kiểm tra session
app.get('/api/session', (req, res) => {
    if (req.session.userId) {
        res.json({ 
            authenticated: true, 
            username: req.session.userId 
        });
    } else {
        res.json({ authenticated: false });
    }
});

// API: Lấy thông tin user
app.get('/api/user', requireAuth, (req, res) => {
    const users = readUsers();
    const user = users[req.session.userId];
    
    if (user) {
        res.json({
            username: user.username,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin
        });
    } else {
        res.status(404).json({ error: 'User not found' });
    }
});

// Lưu trữ các PTY process theo user và session
const userTerminals = new Map(); // Map<username, Map<sessionId, ptyProcess>>

// Xử lý WebSocket với xác thực
wss.on('connection', (ws, req) => {
    // Lấy session từ cookie (cần parse)
    // Trong thực tế, nên dùng thư viện cookie-parser
    // Đơn giản hóa: client sẽ gửi username sau khi kết nối
    
    let currentUser = null;
    let currentPty = null;
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            // Xác thực user
            if (data.type === 'auth') {
                // Kiểm tra session từ client
                // Trong thực tế, nên xác thực qua session cookie
                // Đây là phiên bản đơn giản
                if (data.username) {
                    currentUser = data.username;
                    
                    // Tạo thư mục workspace cho user nếu chưa có
                    const userDir = createUserWorkspace(currentUser);
                    
                    // Khởi tạo PTY với working directory là workspace của user
                    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
                    currentPty = pty.spawn(shell, [], {
                        name: 'xterm-color',
                        cols: data.cols || 80,
                        rows: data.rows || 30,
                        cwd: userDir,
                        env: {
                            ...process.env,
                            USER: currentUser,
                            HOME: userDir,
                            PS1: `\\[\\e[32m\\]${currentUser}@web-terminal\\[\\e[0m\\]:\\[\\e[34m\\]\\w\\[\\e[0m\\]\\$ `
                        }
                    });
                    
                    // Lưu PTY vào map
                    if (!userTerminals.has(currentUser)) {
                        userTerminals.set(currentUser, new Map());
                    }
                    const sessionId = Date.now().toString();
                    userTerminals.get(currentUser).set(sessionId, currentPty);
                    
                    // Gửi dữ liệu từ PTY tới client
                    currentPty.on('data', (ptyData) => {
                        ws.send(ptyData);
                    });
                    
                    // Thông báo kết nối thành công
                    ws.send(`\r\n\x1b[32m=== Chào mừng ${currentUser} đến Web Terminal ===\x1b[0m\r\n`);
                    ws.send(`\x1b[33mWorkspace: ${userDir}\x1b[0m\r\n`);
                    ws.send(`\x1b[36mBạn có thể chạy lệnh Linux, cài đặt thư viện, và quản lý bot Discord bằng PM2\x1b[0m\r\n`);
                    ws.send(`\x1b[36mDùng 'pm2 list' để xem các bot đang chạy\x1b[0m\r\n\n`);
                    
                    // Gửi prompt đầu tiên
                    currentPty.write('\r\n');
                }
                return;
            }
            
            // Xử lý resize
            if (data.type === 'resize' && currentPty) {
                currentPty.resize(data.cols, data.rows);
                return;
            }
            
            // Nếu chưa xác thực, bỏ qua
            if (!currentPty) {
                return;
            }
            
            // Gửi input tới PTY
            currentPty.write(message.toString());
            
        } catch (e) {
            // Không phải JSON, coi như input bình thường nếu đã xác thực
            if (currentPty) {
                currentPty.write(message.toString());
            }
        }
    });
    
    // Xử lý đóng kết nối
    ws.on('close', () => {
        if (currentUser && currentPty) {
            // Không kill PTY ngay, giữ cho user có thể reconnect
            // Nhưng cần cleanup sau timeout
            setTimeout(() => {
                const userSessions = userTerminals.get(currentUser);
                if (userSessions) {
                    for (const [sid, pty] of userSessions) {
                        if (pty === currentPty) {
                            pty.kill();
                            userSessions.delete(sid);
                            break;
                        }
                    }
                    if (userSessions.size === 0) {
                        userTerminals.delete(currentUser);
                    }
                }
            }, 5 * 60 * 1000); // 5 phút
        }
    });
});

// API: Lấy danh sách process của user
app.get('/api/processes', requireAuth, (req, res) => {
    const username = req.session.userId;
    const processes = [];
    
    // Lấy process từ PM2 (nếu có)
    const { exec } = require('child_process');
    exec('pm2 jlist', (error, stdout) => {
        if (!error && stdout) {
            try {
                const pm2Processes = JSON.parse(stdout);
                const userProcesses = pm2Processes.filter(p => 
                    p.pm2_env && p.pm2_env.name && p.pm2_env.name.startsWith(`${username}-`)
                );
                res.json(userProcesses);
            } catch (e) {
                res.json([]);
            }
        } else {
            res.json([]);
        }
    });
});

// API: Quản lý bot với PM2
app.post('/api/bot/:action', requireAuth, (req, res) => {
    const username = req.session.userId;
    const { action } = req.params;
    const { name, script, interpreter } = req.body;
    
    const { exec } = require('child_process');
    let command = '';
    
    // Prefix tên bot với username để tránh xung đột
    const botName = `${username}-${name}`;
    
    switch(action) {
        case 'start':
            if (script.endsWith('.py')) {
                command = `pm2 start ${script} --interpreter python --name "${botName}" --cwd ${path.join(DATA_DIR, 'workspaces', username)}`;
            } else if (script.endsWith('.js')) {
                command = `pm2 start ${script} --name "${botName}" --cwd ${path.join(DATA_DIR, 'workspaces', username)}`;
            } else {
                return res.status(400).json({ error: 'Unsupported script type' });
            }
            break;
        case 'stop':
            command = `pm2 stop "${botName}"`;
            break;
        case 'restart':
            command = `pm2 restart "${botName}"`;
            break;
        case 'delete':
            command = `pm2 delete "${botName}"`;
            break;
        case 'logs':
            command = `pm2 logs "${botName}" --nostream --lines 50`;
            break;
        default:
            return res.status(400).json({ error: 'Invalid action' });
    }
    
    exec(command, { cwd: path.join(DATA_DIR, 'workspaces', username) }, (error, stdout, stderr) => {
        if (error) {
            res.status(500).json({ error: stderr || error.message });
        } else {
            res.json({ success: true, output: stdout });
        }
    });
});

// API: Lấy danh sách files của user
app.get('/api/files', requireAuth, (req, res) => {
    const username = req.session.userId;
    const userDir = path.join(DATA_DIR, 'workspaces', username);
    
    fs.readdir(userDir, (err, files) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            const fileStats = files.map(file => {
                const filePath = path.join(userDir, file);
                const stat = fs.statSync(filePath);
                return {
                    name: file,
                    type: stat.isDirectory() ? 'directory' : 'file',
                    size: stat.size,
                    modified: stat.mtime
                };
            });
            res.json(fileStats);
        }
    });
});

// API: Tải file lên
app.post('/api/upload', requireAuth, (req, res) => {
    // Cần multer để xử lý file upload
    // Đây là phiên bản đơn giản
    res.json({ error: 'Upload functionality requires multer' });
});

// Khởi động server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Data directory: ${DATA_DIR}`);
});
