const { WebSocketServer } = require('ws');
const { spawn } = require('node-pty');
const { parse } = require('url');

module.exports = (req, res) => {
  // Xử lý WebSocket upgrade
  if (req.headers.upgrade === 'websocket') {
    const wss = new WebSocketServer({ noServer: true });
    
    wss.handleUpgrade(req, req.socket, Buffer.alloc(0), (ws) => {
      // Xử lý kết nối WebSocket
      const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
      const ptyProcess = spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: '/tmp', // Vercel không cho ghi file ở /app
        env: process.env
      });

      ptyProcess.on('data', (data) => {
        ws.send(data);
      });

      ws.on('message', (msg) => {
        try {
          const data = JSON.parse(msg);
          if (data.type === 'resize') {
            ptyProcess.resize(data.cols, data.rows);
            return;
          }
        } catch (e) {
          ptyProcess.write(msg.toString());
        }
      });

      ws.on('close', () => {
        ptyProcess.kill();
      });
    });
    
    return;
  }

  // Xử lý API endpoints
  const { pathname } = parse(req.url);
  
  if (pathname === '/api/register') {
    // Xử lý đăng ký
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Vercel không hỗ trợ ghi file' }));
  } else {
    res.statusCode = 404;
    res.end();
  }
};
