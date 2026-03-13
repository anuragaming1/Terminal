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
const sessionFileStore = require('session-file-store')(session);

const app = express();
const server = http.createServer(app);

// QUAN TRỌNG: Lưu session vào FILE, không phải memory
const fileStoreOptions = {
    path: path.join(__dirname, 'data/sessions'),
    ttl: 86400, // 24 giờ
    retries: 0
};

// Tạo thư mục sessions nếu chưa có
fs.ensureDirSync(path.join(__dirname, 'data/sessions'));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session dùng file store
app.use(session({
    store: new sessionFileStore(fileStoreOptions),
    secret: 'web-terminal-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false,
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 ngày
    }
}));

// Đường dẫn lưu dữ liệu
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const WORKSPACES_DIR = path.join(__dirname, 'workspaces');

fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(WORKSPACES_DIR);

// Tạo users.json nếu chưa có
if (!fs.existsSync(USERS_FILE)) {
    fs.writeJsonSync(USERS_FILE, {});
}

// WebSocket với noServer
const wss = new WebSocket.Server({ 
    noServer: true,
    perMessageDeflate: false
});

// Helper functions
function readUsers() {
    try {
        return fs.readJsonSync(USERS_FILE);
    } catch (err) {
        return {};
    }
}

function writeUsers(users) {
    fs.writeJsonSync(USERS_FILE, users, { spaces: 2 });
}

function createUserWorkspace(username) {
    const userDir = path.join(WORKSPACES_DIR, username);
    fs.ensureDirSync(userDir);
    return userDir;
}

// Middleware
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

// API Health
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        time: new Date().toISOString(),
        session: req.session.userId || 'none'
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
            lastLogin: new Date().toISOString()
        };
        
        writeUsers(users);
        createUserWorkspace(username);
        
        // Tự động đăng nhập sau khi đăng ký
        req.session.userId = username;
        req.session.username = username;
        
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

// API Save code - QUAN TRỌNG: Auto-save code
app.post('/api/save-code', requireAuth, (req, res) => {
    const { filename, content } = req.body;
    const username = req.session.userId;
    const userDir = path.join(WORKSPACES_DIR, username);
    const filePath = path.join(userDir, filename);
    
    try {
        fs.writeFileSync(filePath, content);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API Load code
app.get('/api/load-code/:filename', requireAuth, (req, res) => {
    const { filename } = req.params;
    const username = req.session.userId;
    const filePath = path.join(WORKSPACES_DIR, username, filename);
    
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            res.json({ content });
        } else {
            res.json({ content: '' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API List files
app.get('/api/list-files', requireAuth, (req, res) => {
    const username = req.session.userId;
    const userDir = path.join(WORKSPACES_DIR, username);
    
    try {
        const files = fs.readdirSync(userDir).filter(f => f.endsWith('.py') || f.endsWith('.js'));
        res.json({ files });
    } catch (err) {
        res.json({ files: [] });
    }
});

// WebSocket handling
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

// Lưu terminals theo user
const userTerminals = new Map();

wss.on('connection', (ws, req) => {
    console.log('🔌 WebSocket connected');
    let currentUser = null;
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'auth') {
                currentUser = data.username;
                const userDir = createUserWorkspace(currentUser);
                
                // Tạo PTY mới
                const ptyProcess = pty.spawn('bash', [], {
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
                userTerminals.get(currentUser).set(sessionId, ptyProcess);
                
                // Gửi data
                ptyProcess.on('data', (ptyData) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            sessionId: sessionId,
                            data: ptyData.toString()
                        }));
                    }
                });
                
                // Welcome
                ws.send(JSON.stringify({
                    sessionId: sessionId,
                    data: `\r\n\x1b[32m=== Chào mừng ${currentUser} ===\x1b[0m\r\n`
                }));
                
                return;
            }
            
            if (data.type === 'input') {
                const { sessionId, data: inputData } = data;
                const pty = userTerminals.get(currentUser)?.get(sessionId);
                if (pty) pty.write(inputData);
                return;
            }
            
            if (data.type === 'resize') {
                const { sessionId, cols, rows } = data;
                const pty = userTerminals.get(currentUser)?.get(sessionId);
                if (pty) pty.resize(cols, rows);
                return;
            }
            
        } catch (err) {
            console.error('Message error:', err);
        }
    });
    
    ws.on('close', () => {
        if (currentUser) {
            // Cleanup sau 5 phút
            setTimeout(() => {
                const sessions = userTerminals.get(currentUser);
                if (sessions) {
                    for (const [sid, pty] of sessions) {
                        pty.kill();
                    }
                    userTerminals.delete(currentUser);
                }
            }, 5 * 60 * 1000);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📁 Data: ${DATA_DIR}`);
    console.log(`📁 Workspaces: ${WORKSPACES_DIR}`);
});
