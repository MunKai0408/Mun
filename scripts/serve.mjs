// Máy chủ cục bộ: phục vụ thư mục site/ và /api/translate (chạy đúng Netlify Function). Dùng: npm start
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from '../netlify/functions/translate.mjs';

const root = fileURLToPath(new URL('../site/', import.meta.url));
const port = Number(process.env.PORT ?? 8080);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/translate') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const r = await handler(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), { ip: req.socket.remoteAddress });
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(root, rel.endsWith('/') ? rel + 'index.html' : rel);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500).end(e.code === 'ENOENT' ? 'Not found' : String(e));
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
