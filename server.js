/**
 * InstantAI 後端伺服器
 * - 提供靜態檔案服務
 * - WebSocket 代理：前端 ↔ 此 server ↔ Gemini Live API
 * - API Key 安全存放在環境變數中，前端不暴露
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocket, WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

// MIME 類型對應
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
};

// HTTP 靜態檔案伺服器
const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = filePath.split('?')[0];
  const fullPath = path.join(__dirname, filePath);

  // 安全性：不允許存取上層目錄
  if (!fullPath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(fullPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// WebSocket 代理伺服器
const wss = new WebSocketServer({ server, path: '/ws/gemini-live' });

wss.on('connection', (clientWs) => {
  if (!GEMINI_API_KEY) {
    clientWs.send(JSON.stringify({ error: '伺服器未設定 GEMINI_API_KEY' }));
    clientWs.close();
    return;
  }

  // 連接到 Gemini Live API
  const geminiUrl = `${GEMINI_WS_URL}?key=${GEMINI_API_KEY}`;
  const geminiWs = new WebSocket(geminiUrl);

  geminiWs.on('open', () => {
    console.log('[Proxy] 已連接 Gemini Live API');
  });

  // 訊息計數器
  let geminiMsgCount = 0;
  let clientMsgCount = 0;

  // Gemini → Client（直接轉發原始資料，保持 frame 類型）
  geminiWs.on('message', (data, isBinary) => {
    geminiMsgCount++;
    if (geminiMsgCount <= 5 || geminiMsgCount % 50 === 0) {
      const preview = isBinary
        ? `[binary ${data.length} bytes]`
        : data.toString().substring(0, 200);
      console.log(`[Proxy] Gemini→Client #${geminiMsgCount}: ${preview}`);
    }
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data);
    }
  });

  // Client → Gemini（直接轉發原始資料）
  clientWs.on('message', (data, isBinary) => {
    clientMsgCount++;
    // 記錄前幾筆 + 每 50 筆
    if (clientMsgCount <= 5 || clientMsgCount % 50 === 0) {
      let preview;
      if (isBinary) {
        preview = `[binary audio ${data.length} bytes]`;
      } else {
        const str = data.toString();
        try {
          const parsed = JSON.parse(str);
          if (parsed.setup) {
            preview = `setup: model=${parsed.setup.model}`;
          } else {
            preview = `[text ${str.length} bytes] ${str.substring(0, 120)}`;
          }
        } catch {
          preview = `[text] ${str.substring(0, 100)}`;
        }
      }
      console.log(`[Proxy] Client→Gemini #${clientMsgCount} (binary=${isBinary}): ${preview}`);
    }
    if (geminiWs.readyState === WebSocket.OPEN) {
      // 直接轉發原始 Buffer（與 RoBo 一致：geminiWs.send(data)）
      geminiWs.send(data);
    } else {
      console.warn(`[Proxy] Gemini WS 未就緒 (state=${geminiWs.readyState}), 丟棄訊息`);
    }
  });

  // 關閉處理
  clientWs.on('close', () => {
    console.log('[Proxy] 前端斷線');
    if (geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.close();
    }
  });

  geminiWs.on('close', () => {
    console.log('[Proxy] Gemini 斷線');
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close();
    }
  });

  geminiWs.on('error', (err) => {
    console.error('[Proxy] Gemini error:', err.message);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ error: 'Gemini 連線錯誤' }));
      clientWs.close();
    }
  });

  clientWs.on('error', (err) => {
    console.error('[Proxy] Client error:', err.message);
  });
});

server.listen(PORT, () => {
  console.log(`InstantAI server 啟動於 http://localhost:${PORT}`);
  console.log(`GEMINI_API_KEY: ${GEMINI_API_KEY ? '已設定' : '⚠️ 未設定'}`);
});
