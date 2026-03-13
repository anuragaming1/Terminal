// Global variables
let sessions = new Map();
let activeSessionId = null;
let currentUsername = null;
let ws = null;
let reconnectAttempts = 0;
let reconnectTimeout = null;
let sessionToken = null;
let isInstalling = false;

// Log system - LƯU VĨNH VIỄN
let logData = [];

// Load logs từ localStorage khi khởi động
try {
    const savedLogs = localStorage.getItem('terminal_logs_' + window.location.host);
    if (savedLogs) {
        logData = JSON.parse(savedLogs);
        console.log('📋 Loaded', logData.length, 'logs from localStorage');
    }
} catch (e) {
    console.log('No saved logs');
}

// Tạo session token cố định
sessionToken = localStorage.getItem('session_token');
if (!sessionToken) {
    sessionToken = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(7);
    localStorage.setItem('session_token', sessionToken);
}

document.addEventListener('DOMContentLoaded', async function() {
    console.log('🖥️ Terminal loaded');
    
    // Hiện UI ngay lập tức
    document.getElementById('loading').style.display = 'none';
    document.getElementById('tabBar').style.display = 'flex';
    document.getElementById('userSection').style.display = 'flex';
    document.getElementById('terminalWrapper').style.display = 'block';
    
    // Setup virtual keys
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
            localStorage.removeItem('session_token');
            window.location.href = '/login.html';
        };
        
        // Tạo session đầu tiên
        createNewSession();
        
        // Setup các handlers
        setupNanoButtons();
        setupLogPanel();
        setupProgressBar();
        
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

// Kết nối WebSocket
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    function connect() {
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
        
        ws = new WebSocket(wsUrl);
        
        const connectionTimeout = setTimeout(() => {
            console.log('⏰ Connection timeout');
            if (ws) {
                ws.close();
                ws = null;
            }
        }, 15000);
        
        ws.onopen = () => {
            console.log('✅ WebSocket connected');
            clearTimeout(connectionTimeout);
            reconnectAttempts = 0;
            addLog('🟢 Đã kết nối lại server');
            
            ws.send(JSON.stringify({
                type: 'init',
                username: currentUsername,
                sessionToken: sessionToken
            }));
            
            // Gửi logs lên server để đồng bộ
            ws.send(JSON.stringify({
                type: 'sync_logs',
                logs: logData
            }));
            
            sessions.forEach((session, id) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'auth',
                        username: currentUsername,
                        sessionId: id,
                        cols: session.term.cols,
                        rows: session.term.rows
                    }));
                }
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
                    if (data.logs && data.logs.length > logData.length) {
                        logData = data.logs;
                        displayLogs();
                        saveLogs();
                        addLog('📋 Đã khôi phục logs từ server');
                    }
                }
                else if (data.type === 'synced') {
                    console.log('📋 Logs synced with server');
                }
                else if (data.sessionId && sessions.has(data.sessionId)) {
                    const output = event.data;
                    // Kiểm tra nếu đang cài pip
                    if (output.includes('Collecting') || output.includes('Installing') || output.includes('Downloading')) {
                        showProgress(true);
                        updateProgress(output);
                    }
                    if (output.includes('Successfully installed')) {
                        showProgress(false);
                        addLog('✅ Cài đặt hoàn tất!');
                    }
                    sessions.get(data.sessionId).term.write(data.data);
                }
            } catch (e) {
                const activeSession = sessions.get(activeSessionId);
                if (activeSession) {
                    activeSession.term.write(event.data);
                }
            }
        };
        
        ws.onclose = (event) => {
            console.log('🔌 WebSocket closed:', event.code);
            clearTimeout(connectionTimeout);
            
            reconnectAttempts++;
            const delay = Math.min(1000 * reconnectAttempts, 30000);
            
            addLog(`🔴 Mất kết nối, thử lại sau ${Math.round(delay/1000)}s...`);
            
            reconnectTimeout = setTimeout(connect, delay);
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }
    
    connect();
}

// Tạo session mới
function createNewSession() {
    const sessionId = 'term_' + Date.now() + '_' + Math.random().toString(36).substring(7);
    
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
        scrollback: 10000,
        allowTransparency: true
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
        
        addLog(`📪 Đã đóng terminal`);
    }
}

// Thêm tab mới
document.getElementById('addTabBtn').onclick = () => {
    createNewSession();
    addLog(`📫 Mở terminal mới`);
};

// Setup nút ảo
function setupVirtualKeys() {
    const container = document.getElementById('virtualKeys');
    
    const keys = [
        ['ESC', 'TAB', 'CTRL', 'ALT'],
        ['HOME', 'END', 'PGUP', 'PGDN'],
        ['⬆️', '⬇️', '⬅️', '➡️'],
        ['📋 PM2 list', '📊 PM2 logs', '🐍 Python', '🟢 Node.js'],
        ['📦 pip install', '📦 npm install', '⏹️ Stop all', '🔄 Restart all'],
        ['📝 nano', '💾 Lưu', '🚪 Thoát', '🔍 Clear'],
        ['💾 Lưu & Thoát', '❌ Không lưu', '🔄 pip status', '📜 pip list']
    ];
    
    keys.forEach(row => {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'key-row';
        
        row.forEach(key => {
            const btn = document.createElement('div');
            btn.className = 'virtual-key';
            btn.textContent = key;
            
            if (key.includes('pip') && isInstalling) {
                btn.classList.add('install');
            }
            
            btn.onclick = () => {
                const activeSession = sessions.get(activeSessionId);
                if (!activeSession || !ws || ws.readyState !== WebSocket.OPEN) {
                    alert('Chưa kết nối server!');
                    return;
                }
                
                switch(key) {
                    // Phím điều khiển
                    case 'ESC': sendKey('\x1b'); break;
                    case 'TAB': sendKey('\t'); break;
                    case 'CTRL': 
                        activeSession.term.write('\r\n🔧 Đang ở chế độ CTRL. Nhấn phím tiếp theo...\r\n');
                        break;
                    case 'ALT':
                        activeSession.term.write('\r\n🔧 Đang ở chế độ ALT. Nhấn phím tiếp theo...\r\n');
                        break;
                    
                    // Phím di chuyển
                    case '⬆️': sendKey('\x1b[A'); break;
                    case '⬇️': sendKey('\x1b[B'); break;
                    case '⬅️': sendKey('\x1b[D'); break;
                    case '➡️': sendKey('\x1b[C'); break;
                    case 'HOME': sendKey('\x1b[H'); break;
                    case 'END': sendKey('\x1b[F'); break;
                    case 'PGUP': sendKey('\x1b[5~'); break;
                    case 'PGDN': sendKey('\x1b[6~'); break;
                    
                    // Lệnh PM2
                    case '📋 PM2 list': sendCommand('pm2 list'); break;
                    case '📊 PM2 logs': sendCommand('pm2 logs'); break;
                    case '⏹️ Stop all': sendCommand('pm2 stop all'); break;
                    case '🔄 Restart all': sendCommand('pm2 restart all'); break;
                    
                    // Lệnh dev
                    case '🐍 Python': sendCommand('python '); break;
                    case '🟢 Node.js': sendCommand('node '); break;
                    
                    // Lệnh pip - có progress bar
                    case '📦 pip install':
                        sendCommand('pip install ');
                        showProgress(true);
                        addLog('📦 Bắt đầu cài đặt package...');
                        break;
                    case '🔄 pip status':
                        sendCommand('pip list');
                        break;
                    case '📜 pip list':
                        sendCommand('pip list');
                        break;
                    
                    // Lệnh npm
                    case '📦 npm install':
                        sendCommand('npm install');
                        break;
                    
                    // Lệnh nano
                    case '📝 nano': sendCommand('nano '); break;
                    case '💾 Lưu': 
                        sendKey('\x0F');
                        setTimeout(() => sendKey('\r'), 100);
                        addLog('💾 Đã lưu file');
                        break;
                    case '🚪 Thoát':
                        sendKey('\x18');
                        addLog('🚪 Đã thoát nano');
                        break;
                    case '💾 Lưu & Thoát':
                        sendKey('\x0F');
                        setTimeout(() => {
                            sendKey('\r');
                            setTimeout(() => sendKey('\x18'), 200);
                        }, 100);
                        addLog('💾 Đã lưu và thoát');
                        break;
                    case '❌ Không lưu':
                        sendKey('\x18');
                        setTimeout(() => sendKey('n'), 100);
                        addLog('❌ Thoát không lưu');
                        break;
                    case '🔍 Clear': sendCommand('clear'); break;
                }
                
                addLog(`🔘 Đã nhấn: ${key}`);
            };
            
            rowDiv.appendChild(btn);
        });
        
        container.appendChild(rowDiv);
    });
}

// Gửi key
function sendKey(key) {
    const activeSession = sessions.get(activeSessionId);
    if (!activeSession || !ws || ws.readyState !== WebSocket.OPEN) return;
    
    ws.send(JSON.stringify({
        type: 'input',
        sessionId: activeSessionId,
        data: key
    }));
}

// Gửi command
function sendCommand(cmd) {
    const activeSession = sessions.get(activeSessionId);
    if (!activeSession || !ws || ws.readyState !== WebSocket.OPEN) return;
    
    for (let i = 0; i < cmd.length; i++) {
        setTimeout(() => {
            ws.send(JSON.stringify({
                type: 'input',
                sessionId: activeSessionId,
                data: cmd[i]
            }));
        }, i * 10);
    }
    
    setTimeout(() => {
        ws.send(JSON.stringify({
            type: 'input',
            sessionId: activeSessionId,
            data: '\r'
        }));
    }, cmd.length * 10 + 50);
    
    addLog(`📤 Lệnh: ${cmd}`);
}

// Setup nút nano
function setupNanoButtons() {
    document.getElementById('nanoSaveBtn').onclick = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            sendKey('\x0F');
            setTimeout(() => sendKey('\r'), 100);
            addLog('💾 Đã lưu file');
        }
    };
    
    document.getElementById('nanoExitBtn').onclick = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            sendKey('\x18');
            addLog('🚪 Thoát nano');
        }
    };
    
    document.getElementById('nanoForceBtn').onclick = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            sendKey('\x18');
            setTimeout(() => sendKey('n'), 100);
            addLog('⚠️ Thoát không lưu');
        }
    };
}

// Setup progress bar
function setupProgressBar() {
    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const progressStatus = document.getElementById('progressStatus');
}

function showProgress(show) {
    const progressBar = document.getElementById('progressBar');
    if (show) {
        progressBar.style.display = 'flex';
        isInstalling = true;
    } else {
        progressBar.style.display = 'none';
        isInstalling = false;
        document.getElementById('progressFill').style.width = '0%';
        document.getElementById('progressText').textContent = '0%';
    }
}

function updateProgress(output) {
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const progressStatus = document.getElementById('progressStatus');
    
    // Parse output để lấy % nếu có
    const percentMatch = output.match(/(\d+)%/);
    if (percentMatch) {
        const percent = parseInt(percentMatch[1]);
        progressFill.style.width = percent + '%';
        progressText.textContent = percent + '%';
    }
    
    // Cập nhật status
    if (output.includes('Collecting')) {
        progressStatus.textContent = '📦 Đang tải package...';
    } else if (output.includes('Installing')) {
        progressStatus.textContent = '⚙️ Đang cài đặt...';
    } else if (output.includes('Successfully')) {
        progressStatus.textContent = '✅ Hoàn tất!';
        setTimeout(() => showProgress(false), 2000);
    }
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
    
    // Giữ 500 log gần nhất
    if (logData.length > 500) {
        logData = logData.slice(-500);
    }
    
    // Lưu vào localStorage NGAY LẬP TỨC
    saveLogs();
    
    // Đồng bộ lên server
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'sync_logs',
            logs: logData
        }));
    }
    
    displayLogs();
}

// Lưu logs vào localStorage
function saveLogs() {
    try {
        localStorage.setItem('terminal_logs_' + window.location.host, JSON.stringify(logData));
        console.log('📋 Saved', logData.length, 'logs to localStorage');
    } catch (e) {
        console.warn('Cannot save logs:', e);
        if (e.name === 'QuotaExceededError') {
            logData = logData.slice(-100);
            try {
                localStorage.setItem('terminal_logs_' + window.location.host, JSON.stringify(logData));
            } catch (e2) {}
        }
    }
}

// Hiển thị logs
function displayLogs() {
    const logContent = document.getElementById('logContent');
    if (!logContent) return;
    
    logContent.innerHTML = logData.map(log => 
        `<div style="color: ${log.message.includes('🟢') ? '#00ff00' : 
                              log.message.includes('🔴') ? '#ff5555' : 
                              log.message.includes('⚠️') ? '#ffaa00' : 
                              log.message.includes('📦') ? '#00aaff' : '#00ff00'};
                    padding: 2px 0;
                    border-bottom: 1px solid #333;
                    font-size: 11px;">
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
    
    displayLogs();
}

// Show error
function showError(message) {
    document.getElementById('terminalWrapper').innerHTML = `
        <div style="color: red; padding: 30px; text-align: center; font-family: monospace;">
            <div style="font-size: 20px; margin-bottom: 20px;">❌ ${message}</div>
            <button onclick="window.location.reload()" 
                style="padding: 10px 30px; background: #00ff00; color: black; border: none; border-radius: 5px; cursor: pointer; font-size: 16px;">
                Tải lại trang
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

// Save logs before unload
window.addEventListener('beforeunload', () => {
    saveLogs();
    if (ws) {
        ws.close();
    }
});

// Auto-save logs mỗi 30 giây
setInterval(saveLogs, 30000);
