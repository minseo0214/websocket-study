const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocket, WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;

// Simple HTTP server to serve the client HTML
const httpServer = http.createServer((req, res) => {
  const filePath = path.join(__dirname, 'public', 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
});

// WebSocket server attached to the same HTTP server
const wss = new WebSocketServer({ server: httpServer });

// Track connected clients
const clients = new Set();

wss.on('connection', (ws, req) => {
  clients.add(ws);
  const clientIp = req.socket.remoteAddress;
  console.log(`[연결] 새 클라이언트 접속: ${clientIp} (현재 접속자: ${clients.size}명)`);

  // Notify everyone that a new user joined
  broadcast({ type: 'system', message: `새 사용자가 입장했습니다. (접속자: ${clients.size}명)` }, null);

  ws.on('message', (data) => {
    let parsed;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      parsed = { type: 'chat', message: data.toString() };
    }

    console.log(`[수신] ${JSON.stringify(parsed)}`);

    if (parsed.type === 'chat') {
      // Broadcast the chat message to all connected clients
      broadcast({ type: 'chat', sender: parsed.sender || '익명', message: parsed.message }, null);
    } else if (parsed.type === 'echo') {
      // Echo back only to the sender
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'echo', message: parsed.message }));
      }
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[종료] 클라이언트 연결 종료 (현재 접속자: ${clients.size}명)`);
    broadcast({ type: 'system', message: `사용자가 퇴장했습니다. (접속자: ${clients.size}명)` }, ws);
  });

  ws.on('error', (err) => {
    console.error(`[오류] ${err.message}`);
  });
});

/**
 * Broadcast a message to all connected clients.
 * @param {object} payload - The message object to send.
 * @param {WebSocket|null} exclude - A client to exclude from the broadcast (e.g. the sender).
 */
function broadcast(payload, exclude) {
  const data = JSON.stringify(payload);
  for (const client of clients) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

httpServer.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
  console.log(`WebSocket 주소:  ws://localhost:${PORT}`);
});
