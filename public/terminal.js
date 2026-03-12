document.addEventListener('DOMContentLoaded', async function() {
    console.log('🖥️ Terminal page loaded');
    
    // Hiển thị terminal container ngay lập tức
    const loadingEl = document.getElementById('loading');
    const terminalEl = document.getElementById('terminal-container');
    
    if (loadingEl) loadingEl.style.display = 'none';
    if (terminalEl) terminalEl.style.display = 'block';
    
    // Khởi tạo terminal
    const term = new Terminal({
        cursorBlink: true,
        theme: {
            background: '#000000',
            foreground: '#00ff00',
            cursor: '#00ff00',
            black: '#000000',
            red: '#cd0000',
            green: '#00cd00',
            yellow: '#cdcd00',
            blue: '#0000cd',
            magenta: '#cd00cd',
            cyan: '#00cdcd',
            white: '#ffffff'
        },
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        fontSize: 14,
        scrollback: 5000
    });
    
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    
    try {
        term.open(terminalEl);
        fitAddon.fit();
    } catch (err) {
        console.error('❌ Cannot open terminal:', err);
    }
    
    // Kiểm tra session
    try {
        console.log('🔍 Checking session...');
        const sessionResponse = await fetch('/api/session');
        const sessionData = await sessionResponse.json();
        
        if (!sessionData.authenticated) {
            console.log('🚫 Not authenticated, redirecting to login');
            window.location.href = '/login.html';
            return;
        }
        
        const username = sessionData.username;
        console.log('✅ Authenticated as:', username);
        
        // Thêm nút logout
        addLogoutButton();
        
        // Thêm user info
        addUserInfo(username);
        
        // Kết nối WebSocket
        connectWebSocket(term, username);
        
    } catch (err) {
        console.error('❌ Session check failed:', err);
        showError('Không thể kết nối đến server. Vui lòng tải lại trang.');
    }
    
    // Xử lý resize
    window.addEventListener('resize', () => {
        try {
            fitAddon.fit();
        } catch (err) {
            console.error('Resize error:', err);
        }
    });
});

function addLogoutButton() {
    const existingBtn = document.getElementById('logout-btn');
    if (existingBtn) return;
    
    const logoutBtn = document.createElement('button');
    logoutBtn.id = 'logout-btn';
    logoutBtn.textContent = 'Đăng xuất';
    logoutBtn.style.position = 'fixed';
    logoutBtn.style.top = '10px';
    logoutBtn.style.right = '10px';
    logoutBtn.style.zIndex = '1000';
    logoutBtn.style.padding = '8px 16px';
    logoutBtn.style.backgroundColor = '#e74c3c';
    logoutBtn.style.color = 'white';
    logoutBtn.style.border = 'none';
    logoutBtn.style.borderRadius = '4px';
    logoutBtn.style.cursor = 'pointer';
    logoutBtn.onclick = async () => {
        try {
            await fetch('/api/logout', { method: 'POST' });
            window.location.href = '/login.html';
        } catch (err) {
            console.error('Logout error:', err);
        }
    };
    document.body.appendChild(logoutBtn);
}

function addUserInfo(username) {
    const existingInfo = document.getElementById('user-info');
    if (existingInfo) return;
    
    const userInfo = document.createElement('div');
    userInfo.id = 'user-info';
    userInfo.textContent = `User: ${username}`;
    userInfo.style.position = 'fixed';
    userInfo.style.top = '10px';
    userInfo.style.left = '10px';
    userInfo.style.zIndex = '1000';
    userInfo.style.padding = '8px 16px';
    userInfo.style.backgroundColor = '#27ae60';
    userInfo.style.color = 'white';
    userInfo.style.borderRadius = '4px';
    document.body.appendChild(userInfo);
}

function connectWebSocket(term, username) {
    console.log('🔌 Connecting WebSocket...');
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    console.log('WebSocket URL:', wsUrl);
    
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    
    function createConnection() {
        const ws = new WebSocket(wsUrl);
        let connectionTimeout = setTimeout(() => {
            console.log('⏰ Connection timeout');
            ws.close();
        }, 10000);
        
        ws.onopen = () => {
            console.log('✅ WebSocket connected');
            clearTimeout(connectionTimeout);
            reconnectAttempts = 0;
            
            // Gửi thông tin xác thực
            ws.send(JSON.stringify({
                type: 'auth',
                username: username,
                cols: term.cols,
                rows: term.rows
            }));
            
            term.write('\r\n\x1b[32m✓ Đã kết nối đến server\x1b[0m\r\n');
        };
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong' }));
                    return;
                }
            } catch (e) {
                // Không phải JSON, ghi vào terminal
                term.write(event.data);
            }
        };
        
        ws.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            clearTimeout(connectionTimeout);
            term.write('\r\n\x1b[31m⚠️ Lỗi kết nối WebSocket\x1b[0m\r\n');
        };
        
        ws.onclose = (event) => {
            console.log('🔌 WebSocket closed:', event.code, event.reason);
            clearTimeout(connectionTimeout);
            
            if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
                reconnectAttempts++;
                const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
                
                term.write(`\r\n\x1b[33m⚠️ Mất kết nối. Thử lại lần ${reconnectAttempts}/${maxReconnectAttempts} sau ${delay/1000}s...\x1b[0m\r\n`);
                
                setTimeout(() => {
                    console.log('🔄 Reconnecting...');
                    createConnection();
                }, delay);
            } else if (reconnectAttempts >= maxReconnectAttempts) {
                term.write('\r\n\x1b[31m❌ Không thể kết nối lại. Vui lòng tải lại trang.\x1b[0m\r\n');
            }
        };
        
        // Xử lý input từ terminal
        term.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            }
        });
        
        // Xử lý resize
        term.onResize((size) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'resize',
                    cols: size.cols,
                    rows: size.rows
                }));
            }
        });
    }
    
    createConnection();
}

function showError(message) {
    const terminalEl = document.getElementById('terminal-container');
    if (terminalEl) {
        terminalEl.innerHTML = `
            <div style="color: red; padding: 20px; font-family: monospace;">
                ❌ ${message}
                <br><br>
                <button onclick="window.location.reload()" 
                    style="padding: 10px 20px; background: #00ff00; color: black; border: none; border-radius: 5px; cursor: pointer;">
                    Tải lại trang
                </button>
            </div>
        `;
    }
}
