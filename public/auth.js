// Xử lý đăng nhập
document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    
    // Kiểm tra session khi load trang
    checkSession();
    
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const errorDiv = document.getElementById('errorMessage');
            
            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ username, password })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    window.location.href = '/';
                } else {
                    errorDiv.textContent = data.error || 'Đăng nhập thất bại';
                }
            } catch (err) {
                errorDiv.textContent = 'Lỗi kết nối server';
            }
        });
    }
    
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            const messageDiv = document.getElementById('message');
            
            // Kiểm tra username hợp lệ
            const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
            if (!usernameRegex.test(username)) {
                messageDiv.textContent = 'Username không hợp lệ (3-20 ký tự, chỉ chữ, số, _)';
                messageDiv.className = 'error-message';
                return;
            }
            
            if (password.length < 6) {
                messageDiv.textContent = 'Mật khẩu phải có ít nhất 6 ký tự';
                messageDiv.className = 'error-message';
                return;
            }
            
            if (password !== confirmPassword) {
                messageDiv.textContent = 'Mật khẩu xác nhận không khớp';
                messageDiv.className = 'error-message';
                return;
            }
            
            try {
                const response = await fetch('/api/register', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ username, password })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    messageDiv.textContent = 'Đăng ký thành công! Đang chuyển hướng...';
                    messageDiv.className = 'success-message';
                    
                    setTimeout(() => {
                        window.location.href = '/login.html';
                    }, 2000);
                } else {
                    messageDiv.textContent = data.error || 'Đăng ký thất bại';
                    messageDiv.className = 'error-message';
                }
            } catch (err) {
                messageDiv.textContent = 'Lỗi kết nối server';
                messageDiv.className = 'error-message';
            }
        });
    }
});

// Kiểm tra session
async function checkSession() {
    try {
        const response = await fetch('/api/session');
        const data = await response.json();
        
        // Nếu đang ở trang login/register mà đã đăng nhập thì chuyển về terminal
        if (data.authenticated) {
            const currentPage = window.location.pathname;
            if (currentPage.includes('login.html') || currentPage.includes('register.html')) {
                window.location.href = '/';
            }
        }
    } catch (err) {
        console.error('Session check error:', err);
    }
}

// Đăng xuất
async function logout() {
    try {
        const response = await fetch('/api/logout', {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            window.location.href = '/login.html';
        }
    } catch (err) {
        console.error('Logout error:', err);
    }
}
