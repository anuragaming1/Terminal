document.addEventListener('DOMContentLoaded', async function() {
    console.log('🖥️ Terminal page loaded');
    
    // Hiển thị terminal container ngay lập tức
    const loadingEl = document.getElementById('loading');
    const terminalEl = document.getElementById('terminal-container');
    const virtualKeys = document.getElementById('virtualKeys');
    
    if (loadingEl) loadingEl.style.display = 'none';
    if (terminalEl) terminalEl.style.display = 'block';
    
    // Hiện nút ảo nếu là mobile
    if (window.innerWidth <= 768) {
        if (virtualKeys) virtualKeys.style.display = 'block';
    }
    
    // Khởi tạo terminal với font size lớn hơn cho mobile
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
        fontSize: window.innerWidth <= 768 ? 12 : 14, // Font nhỏ hơn trên mobile
        scrollback: 5000,
        allowTransparency: true
    });
    
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    
    try {
        term.open(terminalEl);
        setTimeout(() => {
            try {
                fitAddon.fit();
            } catch (e) {}
        }, 100);
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
        
        // Thêm nút logout và user info
        addUserInfo(username);
        addLogoutButton();
        
        // Kết nối WebSocket
        const ws = connectWebSocket(term, username);
        
        // Thêm xử lý cho nút ảo
        setupVirtualKeys(term, ws);
        
    } catch (err) {
        console.error('❌ Session check failed:', err);
        showError('Không thể kết nối đến server. Vui lòng tải lại trang.');
    }
    
    // Xử lý resize với debounce
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            try {
                fitAddon.fit();
                // Ẩn/hiện nút ảo theo kích thước màn hình
                const virtualKeys = document.getElementById('virtualKeys');
                if (virtualKeys) {
                    virtualKeys.style.display = window.innerWidth <= 768 ? 'block' : 'none';
                }
            } catch (err) {
                console.error('Resize error:', err);
            }
        }, 100);
    });
});

function addUserInfo(username) {
    const existingInfo = document.getElementById('user-info');
    if (existingInfo) return;
    
    const userInfo = document.createElement('div');
    userInfo.id = 'user-info';
    userInfo.textContent = `User: ${username}`;
    userInfo.style.position = 'fixed';
    userInfo.style.top = '10px';
    userInfo.style.left = '10px';
    userInfo.style.zIndex = '1500';
    userInfo.style.padding = '5px 10px';
    userInfo.style.backgroundColor = '#27ae60';
    userInfo.style.color = 'white';
    userInfo.style.borderRadius = '4px';
    userInfo.style.fontSize = '12px';
    userInfo.style.fontFamily = 'monospace';
    document.body.appendChild(userInfo);
}

function addLogoutButton() {
    const existingBtn = document.getElementById('logout-btn');
    if (existingBtn) return;
    
    const logoutBtn = document.createElement('button');
    logoutBtn.id = 'logout-btn';
    logoutBtn.textContent = 'Đăng xuất';
    logoutBtn.style.position = 'fixed';
    logoutBtn.style.top = '10px';
    logoutBtn.style.right = '10px';
    logoutBtn.style.zIndex = '1500';
    logoutBtn.style.padding = '5px 10px';
    logoutBtn.style.backgroundColor = '#e74c3c';
    logoutBtn.style.color = 'white';
    logoutBtn.style.border = 'none';
    logoutBtn.style.borderRadius = '4px';
    logoutBtn.style.fontSize = '12px';
    logoutBtn.style.cursor = 'pointer';
    logoutBtn.style.fontFamily = 'monospace';
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

function connectWebSocket(term, username) {
    console.log('🔌 Connecting WebSocket...');
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;
    let ws = null;
    let pingInterval = null;
    let reconnectTimeout = null;
    
    function cleanup() {
        if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
        }
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
    }
    
    function createConnection() {
        cleanup();
        
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
            
            // Gửi thông tin xác thực
            ws.send(JSON.stringify({
                type: 'auth',
                username: username,
                cols: term.cols,
                rows: term.rows
            }));
            
            term.write('\r\n\x1b[32m✓ Đã kết nối đến server\x1b[0m\r\n');
            term.write('\x1b[36m📱 Chế độ điện thoại: Dùng các nút bên dưới\x1b[0m\r\n');
            
            pingInterval = setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'ping' }));
                }
            }, 25000);
        };
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong' }));
                    return;
                }
            } catch (e) {
                term.write(event.data);
            }
        };
        
        ws.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            term.write('\r\n\x1b[31m⚠️ Lỗi kết nối WebSocket\x1b[0m\r\n');
        };
        
        ws.onclose = (event) => {
            console.log('🔌 WebSocket closed:', event.code);
            clearTimeout(connectionTimeout);
            cleanup();
            
            if (event.code === 1000) return;
            
            if (reconnectAttempts < maxReconnectAttempts) {
                reconnectAttempts++;
                const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 30000);
                
                term.write(`\r\n\x1b[33m⚠️ Mất kết nối. Thử lại lần ${reconnectAttempts}/${maxReconnectAttempts} sau ${Math.round(delay/1000)}s...\x1b[0m\r\n`);
                
                reconnectTimeout = setTimeout(() => {
                    console.log('🔄 Reconnecting...');
                    createConnection();
                }, delay);
            }
        };
        
        term.onData((data) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(data);
            }
        });
        
        term.onResize((size) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'resize',
                    cols: size.cols,
                    rows: size.rows
                }));
            }
        });
    }
    
    createConnection();
    return ws;
}

// Xử lý nút ảo
function setupVirtualKeys(term, ws) {
    const keys = document.querySelectorAll('.virtual-key');
    
    keys.forEach(key => {
        key.addEventListener('touchstart', (e) => {
            e.preventDefault();
            
            const keyData = key.dataset.key;
            const cmdData = key.dataset.cmd;
            
            // Hiệu ứng nhấn
            key.style.background = '#00ff00';
            key.style.color = 'black';
            
            if (cmdData) {
                // Gửi lệnh nhanh
                if (ws && ws.readyState === WebSocket.OPEN) {
                    cmdData.split('').forEach(char => {
                        ws.send(char);
                    });
                    ws.send('\r'); // Enter
                }
                term.write(`\r\n\x1b[33m➜ ${cmdData}\x1b[0m\r\n`);
            } else if (keyData) {
                // Gửi phím đặc biệt
                let sequence = '';
                switch(keyData) {
                    case 'esc': sequence = '\x1b'; break; // ESC
                    case 'tab': sequence = '\t'; break; // TAB
                    case 'ctrl': 
                        term.write('\r\n\x1b[33m🔧 Đang ở chế độ CTRL. Nhấn phím tiếp theo...\x1b[0m\r\n');
                        // Xử lý CTRL combination
                        const ctrlHandler = (e) => {
                            const char = e.data;
                            if (char) {
                                const ctrlChar = String.fromCharCode(char.charCodeAt(0) - 64); // CTRL+A = 1
                                if (ws && ws.readyState === WebSocket.OPEN) {
                                    ws.send(ctrlChar);
                                }
                                term.offData(ctrlHandler);
                            }
                        };
                        term.onData(ctrlHandler);
                        return;
                    case 'alt': 
                        term.write('\r\n\x1b[33m🔧 Đang ở chế độ ALT. Nhấn phím tiếp theo...\x1b[0m\r\n');
                        const altHandler = (e) => {
                            const char = e.data;
                            if (char) {
                                if (ws && ws.readyState === WebSocket.OPEN) {
                                    ws.send('\x1b' + char);
                                }
                                term.offData(altHandler);
                            }
                        };
                        term.onData(altHandler);
                        return;
                    case 'up': sequence = '\x1b[A'; break;
                    case 'down': sequence = '\x1b[B'; break;
                    case 'right': sequence = '\x1b[C'; break;
                    case 'left': sequence = '\x1b[D'; break;
                    case 'home': sequence = '\x1b[H'; break;
                    case 'end': sequence = '\x1b[F'; break;
                    case 'pageup': sequence = '\x1b[5~'; break;
                    case 'pagedown': sequence = '\x1b[6~'; break;
                }
                
                if (sequence && ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(sequence);
                }
            }
            
            // Reset sau 100ms
            setTimeout(() => {
                key.style.background = '';
                key.style.color = '';
            }, 100);
        });
        
        // Ngăn click chuột thông thường
        key.addEventListener('click', (e) => {
            e.preventDefault();
        });
    });
}

function showError(message) {
    const terminalEl = document.getElementById('terminal-container');
    if (terminalEl) {
        terminalEl.innerHTML = `
            <div style="color: red; padding: 20px; font-family: monospace; text-align: center;">
                <div style="font-size: 20px; margin-bottom: 20px;">❌ ${message}</div>
                <button onclick="window.location.reload()" 
                    style="padding: 12px 24px; background: #00ff00; color: black; border: none; border-radius: 5px; cursor: pointer; font-size: 16px;">
                    Tải lại trang
                </button>
            </div>
        `;
    }
}
