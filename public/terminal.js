document.addEventListener('DOMContentLoaded', async function() {
    // Kiểm tra session trước
    const sessionResponse = await fetch('/api/session');
    const sessionData = await sessionResponse.json();
    
    if (!sessionData.authenticated) {
        window.location.href = '/login.html';
        return;
    }
    
    const username = sessionData.username;
    
    // Thêm nút logout
    const logoutBtn = document.createElement('button');
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
    logoutBtn.onclick = logout;
    document.body.appendChild(logoutBtn);
    
    // Thêm thông tin user
    const userInfo = document.createElement('div');
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
    
    term.open(document.getElementById('terminal-container'));
    fitAddon.fit();
    
    // Kết nối WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
        
        // Gửi thông tin xác thực
        ws.send(JSON.stringify({
            type: 'auth',
            username: username,
            cols: term.cols,
            rows: term.rows
        }));
    };
    
    ws.onmessage = (event) => {
        term.write(event.data);
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        term.write('\r\n\x1b[31m*** Lỗi kết nối. Đang thử lại... ***\x1b[0m\r\n');
    };
    
    ws.onclose = () => {
        console.log('WebSocket closed');
        term.write('\r\n\x1b[31m*** Mất kết nối. Đang thử lại... ***\x1b[0m\r\n');
        
        // Thử kết nối lại sau 3 giây
        setTimeout(() => {
            window.location.reload();
        }, 3000);
    };
    
    term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
        }
    });
    
    window.addEventListener('resize', () => {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'resize',
                cols: term.cols,
                rows: term.rows
            }));
        }
    });
});
