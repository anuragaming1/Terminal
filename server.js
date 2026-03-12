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

const app = express();
const server = http.createServer(app);

// Cấu hình WebSocket cho Render
const wss = new WebSocket.Server({ 
    server,
    perMessageDeflate: false,
    clientTracking: true
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Cấu hình session
app.use(session({
    secret: 'web-terminal-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Đường dẫn lưu dữ liệu
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

fs.ensureDirSync(DATA_DIR);

if (!fs.existsSync(USERS_FILE)) {
    fs.writeJsonSync(USERS_FILE, {});
}

// Helper functions
function readUsers() {
    try {
        return fs.readJsonSync(USERS_FILE);
    } catch (err) {
        return {};
    }
}

function writeUsers(users) {
    fs.writeJsonSync(USERS_FILE, users);
}

function createUserWorkspace(username) {
    const userDir = path.join(DATA_DIR, 'workspaces', username);
    fs.ensureDirSync(userDir);
    return userDir;
}

// Middleware kiểm tra đăng nhập
function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
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

// API Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        time: new Date().toISOString(),
        session: req.session.userId || 'none',
        uptime: process.uptime()
    });
});

// API Session
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

// API Register
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username và password là bắt buộc' });
        }
        
        const users = readUsers();
        
        if (users[username]) {
            return res.status(400).json({ error: 'Username đã tồn tại' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        users[username] = {
            username,
            password: hashedPassword,
            createdAt: new Date().toISOString(),
            lastLogin: null
        };
        
        writeUsers(users);
        createUserWorkspace(username);
        
        res.json({ success: true, message: 'Đăng ký thành công' });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// API Login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const users = readUsers();
        const user = users[username];
        
        if (!user) {
            return res.status(401).json({ error: 'Sai username hoặc password' });
        }
        
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Sai username hoặc password' });
        }
        
        user.lastLogin = new Date().toISOString();
        writeUsers(users);
        
        req.session.userId = username;
        req.session.username = username;
        
        res.json({ success: true, message: 'Đăng nhập thành công' });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Lỗi server' });
    }
});

// API Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// API Debug files
app.get('/debug/files', requireAuth, (req, res) => {
    const publicPath = path.join(__dirname, 'public');
    try {
        const files = fs.readdirSync(publicPath);
        res.json({
            publicExists: fs.existsSync(publicPath),
            files: files,
            cwd: process.cwd(),
            dirname: __dirname
        });
    } catch (err) {
        res.json({ error: err.message });
    }
});

// Lưu trữ terminal sessions
const userTerminals = new Map();

// Xử lý WebSocket connection
wss.on('connection', (ws, req) => {
    console.log('🔌 WebSocket connected from:', req.socket.remoteAddress);
    
    let currentUser = null;
    let currentPty = null;
    let pingInterval = null;
    
    // Ping để giữ kết nối
    pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
        }
    }, 30000);
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            // Xử lý ping từ client
            if (data.type === 'pong') {
                return;
            }
            
            // Xác thực user
            if (data.type === 'auth') {
                currentUser = data.username;
                console.log('👤 User authenticated:', currentUser);
                
                // Tạo workspace cho user
                const userDir = createUserWorkspace(currentUser);
                
                // Khởi tạo PTY
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
                
                // Lưu PTY
                if (!userTerminals.has(currentUser)) {
                    userTerminals.set(currentUser, new Map());
                }
                const sessionId = Date.now().toString();
                userTerminals.get(currentUser).set(sessionId, currentPty);
                
                // Gửi dữ liệu từ PTY tới client
                currentPty.on('data', (ptyData) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(ptyData);
                    }
                });
                
                // Gửi thông báo chào mừng
                ws.write = function(data) {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(data);
                    }
                };
                
                currentPty.write('\r\n');
                ws.send(`\r\n\x1b[32m=== Chào mừng ${currentUser} đến Web Terminal ===\x1b[0m\r\n`);
                ws.send(`\x1b[33mWorkspace: ${userDir}\x1b[0m\r\n`);
                ws.send(`\x1b[36mGõ 'help' để xem hướng dẫn\x1b[0m\r\n\n`);
                
                return;
            }
            
            // Xử lý resize
            if (data.type === 'resize' && currentPty) {
                currentPty.resize(data.cols, data.rows);
                return;
            }
            
        } catch (e) {
            // Nếu không phải JSON, gửi thẳng vào PTY
            if (currentPty) {
                currentPty.write(message.toString());
            }
        }
    });
    
    ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
    });
    
    ws.on('close', (code, reason) => {
        console.log('🔌 WebSocket closed:', code, reason.toString());
        clearInterval(pingInterval);
        
        // Cleanup PTY sau 5 phút
        if (currentUser && currentPty) {
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
            }, 5 * 60 * 1000);
        }
    });
});

// Xử lý upgrade request
server.on('upgrade', (request, socket, head) => {
    console.log('📡 WebSocket upgrade request');
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📁 Data directory: ${DATA_DIR}`);
});
