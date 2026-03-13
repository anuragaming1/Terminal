// Global variables
let sessions = new Map();
let activeSessionId = null;
let currentUsername = null;
let ws = null;
let reconnectAttempts = 0;
let currentFile = null;
let autoSaveTimer = null;

document.addEventListener('DOMContentLoaded', async function() {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('tabBar').style.display = 'flex';
    document.getElementById('userSection').style.display = 'flex';
    document.getElementById('terminalWrapper').style.display = 'block';
    
    setupVirtualKeys();
    
    try {
        const sessionResponse = await fetch('/api/session');
        const sessionData = await sessionResponse.json();
        
        if (!sessionData.authenticated) {
            window.location.href = '/login.html';
            return;
        }
        
        currentUsername = sessionData.username;
        
        document.getElementById('userSection').innerHTML = `
            <div id="user-info">👤 ${currentUsername}</div>
            <button id="logout-btn">Đăng xuất</button>
        `;
        
        document.getElementById('logout-btn').onclick = async () => {
            await fetch('/api/logout', { method: 'POST' });
            window.location.href = '/login.html';
        };
        
        createNewSession();
        setupNanoButtons();
        connectWebSocket();
        loadSavedFiles();
        
        // Auto-save mỗi 2 giây
        autoSaveTimer = setInterval(autoSave, 2000);
        
    } catch (err) {
        showError('Không thể kết nối server');
    }
});

// Kết nối WebSocket
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    function connect() {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('✅ WebSocket connected');
            reconnectAttempts = 0;
            
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
                if (data.sessionId && sessions.has(data.sessionId)) {
                    const session = sessions.get(data.sessionId);
                    session.term.write(data.data);
                    
                    // Auto-scroll xuống cuối
                    session.term.scrollToBottom();
                }
            } catch (e) {
                const activeSession = sessions.get(activeSessionId);
                if (activeSession) {
                    activeSession.term.write(event.data);
                    activeSession.term.scrollToBottom();
                }
            }
        };
        
        ws.onclose = () => {
            reconnectAttempts++;
            const delay = Math.min(1000 * reconnectAttempts, 10000);
            setTimeout(connect, delay);
        };
    }
    
    connect();
}

// Tạo session mới với scroll fix
function createNewSession() {
    const sessionId = 'term_' + Date.now();
    
    const wrapper = document.getElementById('terminalWrapper');
    const termDiv = document.createElement('div');
    termDiv.id = `terminal-${sessionId}`;
    termDiv.className = 'terminal-instance';
    wrapper.appendChild(termDiv);
    
    // QUAN TRỌNG: Cấu hình scrollback lớn
    const term = new Terminal({
        cursorBlink: true,
        theme: {
            background: '#000000',
            foreground: '#00ff00',
            cursor: '#00ff00'
        },
        fontFamily: 'monospace',
        fontSize: 14,
        scrollback: 100000, // Lưu 100k dòng
        rows: 40,
        cols: 100,
        allowTransparency: true
    });
    
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    
    term.open(termDiv);
    setTimeout(() => fitAddon.fit(), 100);
    
    // Fix scroll bằng wheel
    termDiv.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (e.deltaY < 0) {
            term.scrollLines(-3);
        } else {
            term.scrollLines(3);
        }
    });
    
    sessions.set(sessionId, {
        id: sessionId,
        term: term,
        fitAddon: fitAddon,
        element: termDiv
    });
    
    addTab(sessionId);
    activateSession(sessionId);
    
    term.write(`\r\n\x1b[32m=== Terminal ${sessions.size} ===\x1b[0m\r\n`);
    term.write(`\x1b[36mUser: ${currentUsername}\x1b[0m\r\n`);
    term.write(`\x1b[33mScroll: Dùng chuột hoặc phím mũi tên\x1b[0m\r\n\n`);
    
    term.onData((data) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'input',
                sessionId: sessionId,
                data: data
            }));
            
            // Auto-save nếu đang trong nano
            if (data === '\x0F') { // Ctrl+O
                setTimeout(autoSave, 500);
            }
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

// Auto-save code
function autoSave() {
    if (!currentFile) return;
    
    const activeSession = sessions.get(activeSessionId);
    if (!activeSession) return;
    
    // Lấy nội dung từ terminal? Khó, nên dùng API riêng
    // Tạm thời bỏ qua
}

// Load danh sách file đã lưu
async function loadSavedFiles() {
    try {
        const response = await fetch('/api/list-files');
        const data = await response.json();
        
        if (data.files && data.files.length > 0) {
            console.log('📁 Saved files:', data.files);
        }
    } catch (err) {
        console.error('Cannot load files:', err);
    }
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
    if (sessions.size <= 1) return;
    
    const session = sessions.get(sessionId);
    if (session) {
        session.term.dispose();
        session.element.remove();
        document.getElementById(`tab-${sessionId}`)?.remove();
        sessions.delete(sessionId);
        
        const nextSession = sessions.keys().next().value;
        if (nextSession) activateSession(nextSession);
    }
}

// Thêm tab mới
document.getElementById('addTabBtn').onclick = () => {
    createNewSession();
};

// Setup nút ảo
function setupVirtualKeys() {
    const container = document.getElementById('virtualKeys');
    
    const keys = [
        ['ESC', 'TAB', 'CTRL', 'ALT'],
        ['⬆️', '⬇️', '⬅️', '➡️'],
        ['📋 PM2 list', '🐍 Python', '🟢 Node.js'],
        ['📦 pip install', '📦 npm install', '🔍 Clear'],
        ['📝 nano', '💾 Lưu', '🚪 Thoát']
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
                    case 'ESC': sendKey('\x1b'); break;
                    case 'TAB': sendKey('\t'); break;
                    case '⬆️': sendKey('\x1b[A'); break;
                    case '⬇️': sendKey('\x1b[B'); break;
                    case '⬅️': sendKey('\x1b[D'); break;
                    case '➡️': sendKey('\x1b[C'); break;
                    case '📋 PM2 list': sendCommand('pm2 list'); break;
                    case '🐍 Python': sendCommand('python '); break;
                    case '🟢 Node.js': sendCommand('node '); break;
                    case '📦 pip install': sendCommand('pip install '); break;
                    case '📦 npm install': sendCommand('npm install'); break;
                    case '🔍 Clear': sendCommand('clear'); break;
                    case '📝 nano': 
                        sendCommand('nano ');
                        break;
                    case '💾 Lưu': 
                        sendKey('\x0F');
                        setTimeout(() => sendKey('\r'), 100);
                        break;
                    case '🚪 Thoát':
                        sendKey('\x18');
                        break;
                }
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
}

// Setup nút nano
function setupNanoButtons() {
    document.getElementById('nanoSaveBtn').onclick = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            sendKey('\x0F');
            setTimeout(() => sendKey('\r'), 100);
        }
    };
    
    document.getElementById('nanoExitBtn').onclick = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            sendKey('\x18');
        }
    };
    
    document.getElementById('nanoForceBtn').onclick = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            sendKey('\x18');
            setTimeout(() => sendKey('n'), 100);
        }
    };
}

// Show error
function showError(message) {
    document.getElementById('terminalWrapper').innerHTML = `
        <div style="color: red; padding: 30px; text-align: center;">
            ❌ ${message}<br><br>
            <button onclick="window.location.reload()">Tải lại</button>
        </div>
    `;
}

// Cleanup
window.addEventListener('beforeunload', () => {
    if (autoSaveTimer) clearInterval(autoSaveTimer);
    if (ws) ws.close();
});
