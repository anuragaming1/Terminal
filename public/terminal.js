// Global variables
let sessions = new Map();
let activeSessionId = null;
let currentUsername = null;
let ws = null;
let reconnectAttempts = 0;
let sessionToken = null;

// Log system - LƯU VĨNH VIỄN
let logData = [];

// Load logs từ localStorage khi khởi động
try {
    const savedLogs = localStorage.getItem('terminalLogs_v2');
    if (savedLogs) {
        logData = JSON.parse(savedLogs);
    } else {
        const oldLogs = localStorage.getItem('terminalLogs');
        if (oldLogs) {
            logData = JSON.parse(oldLogs);
        }
    }
} catch (e) {
    console.log('No saved logs');
}

// Tạo session token khi load trang
sessionToken = localStorage.getItem('sessionToken');
if (!sessionToken) {
    sessionToken = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(7);
    localStorage.setItem('sessionToken', sessionToken);
}

document.addEventListener('DOMContentLoaded', async function() {
    console.log('🖥️ Terminal loaded');
    
    // Hiện UI ngay lập tức
    document.getElementById('loading').style.display = 'none';
    document.getElementById('tabBar').style.display = 'flex';
    document.getElementById('userSection').style.display = 'flex';
    document.getElementById('terminalWrapper').style.display = 'block';
    
    // Setup virtual keys TRƯỚC
    setupVirtualKeys();
    
    // Kiểm tra session
    try {
        const sessionResponse = await fetch('/api/session');
        const sessionData = await sessionResponse.json();
        
        if (!sessionData.authenticated) {
            window.location.href = '/login.html';
            return;
        }
        
        currentUsername = sessionData.username;
        console.log('✅ User:', currentUsername);
        
        // Update user info
        document.getElementById('userSection').innerHTML = `
            <div id="user-info">👤 ${currentUsername}</div>
            <button id="logout-btn">Đăng xuất</button>
        `;
        
        // Logout handler
        document.getElementById('logout-btn').onclick = async () => {
            await fetch('/api/logout', { method: 'POST' });
            localStorage.removeItem('sessionToken');
            window.location.href = '/login.html';
        };
        
        // Tạo session đầu tiên
        createNewSession();
        
        // Setup các handlers
        setupNanoButtons();
        setupLogPanel();
        
        // Hiển thị logs cũ
        displayLogs();
        addLog('🟢 Đã đăng nhập thành công');
        
        // Kết nối WebSocket
        connectWebSocket();
        
    } catch (err) {
        console.error('Session error:', err);
        showError('Không thể kết nối server');
    }
});

// Kết nối WebSocket với auto-reconnect
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    function connect() {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('✅ WebSocket connected');
            reconnectAttempts = 0;
            addLog('🟢 Đã kết nối lại server');
            
            // Gửi session token để server nhận diện
            ws.send(JSON.stringify({
                type: 'init',
                username: currentUsername,
                sessionToken: sessionToken
            }));
            
            // Auth tất cả sessions
            sessions.forEach((session, id) => {
                ws.send(JSON.stringify({
                    type: 'auth',
                    username: currentUsername,
                    sessionId: id,
                    cols: session.term.cols,
                    rows: session.term.rows
                }));
            });
        };
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                if (data.type === 'pong') return;
                
                if (data.type === 'log') {
                    addLog(data.message);
                } 
                else if (data.type === 'restore') {
                    if (data.logs) {
                        logData = data.logs;
                        displayLogs();
                    }
                }
                else if (data.sessionId && sessions.has(data.sessionId)) {
                    sessions.get(data.sessionId).term.write(data.data);
                }
            } catch (e) {
                const activeSession = sessions.get(activeSessionId);
                if (activeSession) {
                    activeSession.term.write(event.data);
                }
            }
        };
        
        ws.onclose = () => {
            console.log('🔌 WebSocket closed');
            reconnectAttempts++;
            
            const delay = Math.min(1000 * reconnectAttempts, 10000);
            addLog(`🔴 Mất kết nối, thử lại sau ${delay/1000}s...`);
            
            setTimeout(connect, delay);
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }
    
    connect();
}

// Tạo session mới
function createNewSession() {
    const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(7);
    
    const wrapper = document.getElementById('terminalWrapper');
    const termDiv = document.createElement('div');
    termDiv.id = `terminal-${sessionId}`;
    termDiv.className = 'terminal-instance';
    wrapper.appendChild(termDiv);
    
    const term = new Terminal({
        cursorBlink: true,
        theme: {
            background: '#000000',
            foreground: '#00ff00',
            cursor: '#00ff00'
        },
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        fontSize: 14,
        scrollback: 10000
    });
    
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    
    term.open(termDiv);
    setTimeout(() => fitAddon.fit(), 100);
    
    sessions.set(sessionId, {
        id: sessionId,
        term: term,
        fitAddon: fitAddon,
        element: termDiv,
        history: []
    });
    
    addTab(sessionId);
    activateSession(sessionId);
    
    term.write(`\r\n\x1b[32m=== Terminal ${sessions.size} ===\x1b[0m\r\n`);
    term.write(`\x1b[36mUser: ${currentUsername}\x1b[0m\r\n`);
    term.write(`\x1b[33mSession: ${sessionId.substring(0,8)}...\x1b[0m\r\n\n`);
    
    term.onData((data) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'input',
                sessionId: sessionId,
                data: data
            }));
        }
    });
    
    term.onResize((size) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'resize',
                sessionId: sessionId,
                cols: size.cols,
                rows: size.rows
            }));
        }
        setTimeout(() => fitAddon.fit(), 50);
    });
    
    return sessionId;
}

// Thêm tab
function addTab(sessionId) {
    const container = document.getElementById('tabsContainer');
    const tab = document.createElement('div');
    tab.className = `tab ${sessionId === activeSessionId ? 'active' : ''}`;
    tab.id = `tab-${sessionId}`;
    tab.innerHTML = `
        <span>📟 Term ${sessions.size}</span>
        <span class="close" onclick="event.stopPropagation(); closeSession('${sessionId}')">✖</span>
    `;
    tab.onclick = () => activateSession(sessionId);
    container.appendChild(tab);
}

// Kích hoạt session
function activateSession(sessionId) {
    if (activeSessionId === sessionId) return;
    
    sessions.forEach((session, id) => {
        session.element.classList.remove('active');
        document.getElementById(`tab-${id}`)?.classList.remove('active');
    });
    
    const session = sessions.get(sessionId);
    if (session) {
        session.element.classList.add('active');
        document.getElementById(`tab-${sessionId}`)?.classList.add('active');
        activeSessionId = sessionId;
        setTimeout(() => session.fitAddon.fit(), 50);
    }
}

// Đóng session
function closeSession(sessionId) {
    if (sessions.size <= 1) {
        addLog('⚠️ Không thể đóng terminal cuối cùng');
        return;
    }
    
    const session = sessions.get(sessionId);
    if (session) {
        session.term.dispose();
        session.element.remove();
        document.getElementById(`tab-${sessionId}`)?.remove();
        sessions.delete(sessionId);
        
        const nextSession = sessions.keys().next().value;
        if (nextSession) activateSession(nextSession);
        
        addLog(`📪 Đã đóng terminal ${sessionId.substring(0,8)}...`);
    }
}

// Thêm tab mới
document.getElementById('addTabBtn').onclick = () => {
    const newId = createNewSession();
    addLog(`📫 Mở terminal mới`);
};

// Setup nút ảo
function setupVirtualKeys() {
    const container = document.getElementById('virtualKeys');
    
    const keys = [
        ['ESC', 'TAB', 'CTRL', 'ALT'],
        ['HOME', 'END', 'PGUP', 'PGDN'],
        ['⬆️', '⬇️', '⬅️', '➡️'],
        ['📋 PM2 list', '📊 PM2 logs', '🐍 Python', '🟢 Node'],
        ['📦 pip install', '📦 npm install', '⏹️ Stop all', '🔄 Restart all'],
        ['📝 nano', '💾 save', '🚪 exit', '🔍 clear']
    ];
    
    keys.forEach(row => {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'key-row';
        
        row.forEach(key => {
            const btn = document.createElement('div');
            btn.className = 'virtual-key';
            btn.textContent = key;
            
            btn.onclick = () => {
                const activeSession = sessions.get(activeSessionId);
                if (!activeSession || !ws || ws.readyState !== WebSocket.OPEN) return;
                
                switch(key) {
                    case 'ESC': ws.send('\x1b'); break;
                    case 'TAB': ws.send('\t'); break;
                    case 'CTRL': 
                        activeSession.term.write('\r\n🔧 CTRL mode - nhấn phím...\r\n');
                        break;
                    case 'ALT':
                        activeSession.term.write('\r\n🔧 ALT mode - nhấn phím...\r\n');
                        break;
                    case '⬆️': ws.send('\x1b[A'); break;
                    case '⬇️': ws.send('\x1b[B'); break;
                    case '⬅️': ws.send('\x1b[D'); break;
                    case '➡️': ws.send('\x1b[C'); break;
                    case 'HOME': ws.send('\x1b[H'); break;
                    case 'END': ws.send('\x1b[F'); break;
                    case 'PGUP': ws.send('\x1b[5~'); break;
                    case 'PGDN': ws.send('\x1b[6~'); break;
                    case '📋 PM2 list': sendCommand('pm2 list'); break;
                    case '📊 PM2 logs': sendCommand('pm2 logs'); break;
                    case '⏹️ Stop all': sendCommand('pm2 stop all'); break;
                    case '🔄 Restart all': sendCommand('pm2 restart all'); break;
                    case '🐍 Python': sendCommand('python '); break;
                    case '🟢 Node': sendCommand('node '); break;
                    case '📦 pip install': sendCommand('pip install '); break;
                    case '📦 npm install': sendCommand('npm install'); break;
                    case '📝 nano': sendCommand('nano '); break;
                    case '💾 save': 
                        ws.send('\x0F');
                        setTimeout(() => ws.send('\r'), 100);
                        break;
                    case '🚪 exit': ws.send('\x18'); break;
                    case '🔍 clear': sendCommand('clear'); break;
                }
                
                addLog(`🔘 Đã nhấn: ${key}`);
            };
            
            rowDiv.appendChild(btn);
        });
        
        container.appendChild(rowDiv);
    });
}

// Setup nút nano
function setupNanoButtons() {
    document.getElementById('nanoSaveBtn').onclick = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send('\x0F');
            setTimeout(() => ws.send('\r'), 100);
            addLog('💾 Đã lưu file');
        }
    };
    
    document.getElementById('nanoExitBtn').onclick = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send('\x18');
            addLog('🚪 Thoát nano');
        }
    };
    
    document.getElementById('nanoForceBtn').onclick = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send('\x18');
            setTimeout(() => ws.send('n'), 100);
            addLog('⚠️ Thoát không lưu');
        }
    };
}

// Gửi lệnh
function sendCommand(cmd) {
    const activeSession = sessions.get(activeSessionId);
    if (!activeSession || !ws || ws.readyState !== WebSocket.OPEN) return;
    
    cmd.split('').forEach(char => ws.send(char));
    ws.send('\r');
    addLog(`📤 Lệnh: ${cmd}`);
}

// Log system
function addLog(message) {
    const time = new Date().toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    logData.push({
        time: time,
        message: message,
        timestamp: Date.now()
    });
    
    if (logData.length > 200) {
        logData = logData.slice(-200);
    }
    
    try {
        localStorage.setItem('terminalLogs_v2', JSON.stringify(logData));
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            logData = logData.slice(-100);
            localStorage.setItem('terminalLogs_v2', JSON.stringify(logData));
        }
    }
    
    displayLogs();
}

// Hiển thị logs
function displayLogs() {
    const logContent = document.getElementById('logContent');
    logContent.innerHTML = logData.map(log => 
        `<div style="color: ${log.message.includes('🟢') ? '#00ff00' : 
                              log.message.includes('🔴') ? '#ff5555' : 
                              log.message.includes('⚠️') ? '#ffaa00' : '#00ff00'}">
            [${log.time}] ${log.message}
        </div>`
    ).join('');
    
    logContent.scrollTop = logContent.scrollHeight;
}

// Setup log panel
function setupLogPanel() {
    document.getElementById('closeLogBtn').onclick = () => {
        document.getElementById('logPanel').style.display = 'none';
    };
    
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'l') {
            document.getElementById('logPanel').style.display = 'block';
            e.preventDefault();
        }
    });
}

// Show error
function showError(message) {
    document.getElementById('terminalWrapper').innerHTML = `
        <div style="color: red; padding: 30px; text-align: center;">
            ❌ ${message}<br><br>
            <button onclick="window.location.reload()" 
                style="padding: 10px 30px; background: #00ff00; border: none; border-radius: 5px; cursor: pointer;">
                Tải lại
            </button>
        </div>
    `;
}

// Resize handler
window.addEventListener('resize', () => {
    sessions.forEach(session => {
        setTimeout(() => session.fitAddon.fit(), 50);
    });
});

window.addEventListener('beforeunload', () => {
    if (ws) {
        ws.close();
    }
});
