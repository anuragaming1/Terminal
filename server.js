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

// QUAN TRỌNG: Tạo WebSocket server với `noServer` option
const wss = new WebSocket.Server({ 
    noServer: true,
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
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
}));

// Đường dẫn lưu dữ liệu
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

fs.ensureDirSync(DATA_DIR);

if (!fs.existsSync(USERS_FILE)) {
    fs.writeJsonSync(USERS_FILE, {});
}

// Session store cho WebSocket
const sessionStore = new Map(); // Lưu session data theo token
const userTerminals = new Map(); // Lưu các PTY processes theo user

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
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username và password là bắt buộc' });
        }
        
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

// API để kiểm tra WebSocket status
app.get('/api/ws-status', (req, res) => {
    res.json({
        totalClients: wss.clients.size,
        clients: Array.from(wss.clients).map(c => ({
            readyState: c.readyState
        }))
    });
});

// API để lấy logs của user
app.get('/api/logs', requireAuth, (req, res) => {
    const username = req.session.userId;
    const userLogs = [];
    
    // Tìm logs trong sessionStore
    for (const [token, session] of sessionStore.entries()) {
        if (session.username === username) {
            userLogs.push(...(session.logs || []));
        }
    }
    
    res.json({ logs: userLogs.slice(-200) }); // Trả về 200 logs gần nhất
});

// QUAN TRỌNG: Xử lý upgrade request đúng cách
server.on('upgrade', function upgrade(request, socket, head) {
    console.log('📡 WebSocket upgrade request received');
    
    // Kiểm tra nếu socket đã được xử lý
    if (socket.wsHandleUsed) {
        console.log('⚠️ Socket already handled, skipping');
        return;
    }
    
    // Đánh dấu socket đã được xử lý
    socket.wsHandleUsed = true;
    
    // Xử lý upgrade
    wss.handleUpgrade(request, socket, head, function done(ws) {
        console.log('✅ WebSocket upgrade successful');
        wss.emit('connection', ws, request);
    });
});

// Xử lý WebSocket connection
wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`🔌 WebSocket connected from: ${clientIp}`);
    
    let currentUser = null;
    let sessionToken = null;
    let pingInterval = null;
    let isAlive = true;
    
    // Ping để giữ kết nối (30 giây)
    pingInterval = setInterval(() => {
        if (!isAlive) {
            console.log('💀 Client không phản hồi, đóng kết nối');
            return ws.terminate();
        }
        
        isAlive = false;
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
        }
    }, 30000);
    
    ws.on('pong', () => {
        isAlive = true;
    });
    
    ws.on('message', async (message) => {
        try {
            // Kiểm tra nếu là binary message
            if (Buffer.isBuffer(message)) {
                message = message.toString();
            }
            
            // Thử parse JSON
            let data;
            try {
                data = JSON.parse(message);
            } catch (e) {
                // Không phải JSON, bỏ qua
                return;
            }
            
            // Xử lý pong từ client
            if (data.type === 'pong') {
                isAlive = true;
                return;
            }
            
            // Xử lý init với session token
            if (data.type === 'init') {
                sessionToken = data.sessionToken;
                currentUser = data.username;
                console.log(`👤 User init: ${currentUser} with token: ${sessionToken}`);
                
                // Kiểm tra nếu đã có session cũ
                if (sessionStore.has(sessionToken)) {
                    const oldSession = sessionStore.get(sessionToken);
                    console.log(`🔄 Restoring session for ${currentUser}`);
                    // Gửi logs cũ về client
                    ws.send(JSON.stringify({
                        type: 'restore',
                        logs: oldSession.logs || []
                    }));
                } else {
                    // Tạo session mới
                    sessionStore.set(sessionToken, {
                        username: currentUser,
                        logs: [],
                        createdAt: new Date()
                    });
                    console.log(`✨ New session created for ${currentUser}`);
                }
                return;
            }
            
            // Xử lý sync logs
            if (data.type === 'sync_logs') {
                if (sessionToken && sessionStore.has(sessionToken)) {
                    const session = sessionStore.get(sessionToken);
                    session.logs = data.logs;
                    session.lastSync = new Date();
                    console.log(`📋 Synced ${data.logs.length} logs for ${currentUser}`);
                    
                    // Xác nhận đã sync
                    ws.send(JSON.stringify({
                        type: 'synced'
                    }));
                }
                return;
            }
            
            // Xử lý auth với sessionId
            if (data.type === 'auth') {
                const { username, sessionId, cols, rows } = data;
                currentUser = username;
                
                console.log(`👤 Auth session: ${sessionId} for ${username}`);
                
                // Tạo workspace cho user
                const userDir = createUserWorkspace(username);
                
                // Kill PTY cũ nếu có
                const oldPty = userTerminals.get(username)?.get(sessionId);
                if (oldPty) {
                    try {
                        oldPty.kill();
                    } catch (e) {}
                }
                
                // Khởi tạo PTY mới
                const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
                const ptyProcess = pty.spawn(shell, [], {
                    name: 'xterm-color',
                    cols: cols || 80,
                    rows: rows || 30,
                    cwd: userDir,
                    env: {
                        ...process.env,
                        USER: username,
                        HOME: userDir,
                        PS1: `\\[\\e[32m\\]${username}@web-terminal\\[\\e[0m\\]:\\[\\e[34m\\]\\w\\[\\e[0m\\]\\$ `
                    }
                });
                
                // Lưu PTY
                if (!userTerminals.has(username)) {
                    userTerminals.set(username, new Map());
                }
                userTerminals.get(username).set(sessionId, ptyProcess);
                
                // Gửi dữ liệu từ PTY tới client
                ptyProcess.on('data', (ptyData) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            sessionId: sessionId,
                            data: ptyData.toString()
                        }));
                    }
                });
                
                // Xử lý lỗi PTY
                ptyProcess.on('error', (err) => {
                    console.error(`❌ PTY error for ${username}:`, err);
                });
                
                return;
            }
            
            // Xử lý input
            if (data.type === 'input') {
                const { sessionId, data: inputData } = data;
                
                if (!currentUser) {
                    console.log('⚠️ Input received but no user authenticated');
                    return;
                }
                
                const pty = userTerminals.get(currentUser)?.get(sessionId);
                if (pty) {
                    pty.write(inputData);
                    
                    // Log command nếu là Enter
                    if (inputData === '\r') {
                        // Command executed
                    }
                }
                return;
            }
            
            // Xử lý resize
            if (data.type === 'resize') {
                const { sessionId, cols, rows } = data;
                
                if (!currentUser) {
                    console.log('⚠️ Resize received but no user authenticated');
                    return;
                }
                
                const pty = userTerminals.get(currentUser)?.get(sessionId);
                if (pty) {
                    pty.resize(cols, rows);
                }
                return;
            }
            
        } catch (err) {
            console.error('❌ WebSocket message error:', err);
        }
    });
    
    ws.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
    });
    
    ws.on('close', (code, reason) => {
        console.log(`🔌 WebSocket closed: ${code} ${reason.toString()}`);
        clearInterval(pingInterval);
        
        // Không xóa PTY ngay, giữ 5 phút để có thể reconnect
        if (currentUser) {
            console.log(`👤 User ${currentUser} disconnected, keeping PTYs for 5 minutes`);
            
            setTimeout(() => {
                // Cleanup PTYs cũ
                const userSessions = userTerminals.get(currentUser);
                if (userSessions) {
                    console.log(`🧹 Cleaning up PTYs for ${currentUser}`);
                    for (const [sid, pty] of userSessions) {
                        try {
                            pty.kill();
                        } catch (e) {}
                    }
                    userTerminals.delete(currentUser);
                }
            }, 5 * 60 * 1000); // 5 phút
        }
    });
});

// Thêm route để clear logs cũ (có thể gọi định kỳ)
app.post('/api/clear-old-logs', requireAuth, (req, res) => {
    const username = req.session.userId;
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    
    for (const [token, session] of sessionStore.entries()) {
        if (session.username === username && session.logs) {
            // Giữ logs trong 24h
            session.logs = session.logs.filter(log => log.timestamp > oneDayAgo);
        }
    }
    
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📁 Data directory: ${DATA_DIR}`);
    console.log(`🌐 WebSocket server ready (noServer mode)`);
});

// Cleanup on exit
process.on('SIGTERM', () => {
    console.log('SIGTERM received, cleaning up...');
    
    // Kill all PTYs
    for (const [username, sessions] of userTerminals) {
        for (const [sid, pty] of sessions) {
            try {
                pty.kill();
            } catch (e) {}
        }
    }
    
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Xử lý uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
