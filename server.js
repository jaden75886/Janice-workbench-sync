// 工作台云端同步服务器 —— 零依赖 Node.js
// 启动：node server.js   （可选 PORT 环境变量，默认 8787）
// 数据存于同目录 data.json，整包 last-write-wins 合并，个人低频使用足够。
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8787;
const FILE = path.join(__dirname, 'data.json');

let store = { ts: 0, payload: {} };
try { if (fs.existsSync(FILE)) store = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}

function save() { try { fs.writeFileSync(FILE, JSON.stringify(store)); } catch (e) {} }

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'GET' && req.url.startsWith('/api/data')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(store));
  }
  if (req.method === 'POST' && req.url.startsWith('/api/data')) {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { ts, payload } = JSON.parse(body || '{}');
        if (typeof ts === 'number' && ts > store.ts) { store = { ts, payload: payload || {} }; save(); }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(store));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad json' }));
      }
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, ts: store.ts, keys: Object.keys(store.payload).length }));
});

server.listen(PORT, () => console.log('Workbench sync server running on http://localhost:' + PORT));
