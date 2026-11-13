import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Nhà cung cấp giả (tương thích OpenAI) chạy cục bộ để kiểm tra Netlify Function đầu-cuối.
let upstreamAuth = null;
const upstream = http.createServer((req, res) => {
  upstreamAuth = req.headers.authorization;
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    const j = JSON.parse(b);
    const user = JSON.parse(j.messages[1].content);
    const out = { translations: user.items.map((i) => ({ id: i.id, vi: 'Việt ' + i.text })) };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
  });
});
await new Promise((r) => upstream.listen(0, r));
const base = `http://127.0.0.1:${upstream.address().port}/v1`;

process.env.ACCESS_TOKEN = 'secret-token';
process.env.AI_API_KEY = 'server-key';
process.env.AI_PROVIDER = 'openai';
process.env.AI_BASE_URL = base;
process.env.MAX_ITEMS = '3';
process.env.RATE_PER_MIN = '1000';
const { default: handler } = await import('../netlify/functions/translate.mjs');

const body = (items = [{ id: 'a', text: 'Hello', kind: 'UI' }]) => JSON.stringify({ projectId: 'p', batchId: 'b', items, glossary: [], styleGuideVersion: '0.1' });
const call = (headers, b = body(), method = 'POST') => handler(new Request('https://site.test/api/translate', { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'POST' ? b : undefined }), { ip: '1.1.1.1' });

test.after(() => upstream.close());

test('function: chế độ SERVER với token đúng → dịch, dùng key máy chủ', async () => {
  const r = await call({ authorization: 'Bearer secret-token' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.results[0].translation, 'Việt Hello');
  assert.equal(upstreamAuth, 'Bearer server-key');
  assert.ok(!JSON.stringify(j).includes('server-key'));
});

test('function: thiếu/sai token → 401, không gọi nhà cung cấp', async () => {
  upstreamAuth = null;
  assert.equal((await call({})).status, 401);
  assert.equal((await call({ authorization: 'Bearer wrong' })).status, 401);
  assert.equal(upstreamAuth, null);
});

test('function: chế độ BYO dùng key người dùng, không cần token', async () => {
  const r = await call({ 'x-user-key': 'my-key', 'x-provider': 'openai' });
  assert.equal(r.status, 200);
  assert.equal(upstreamAuth, 'Bearer my-key');
});

test('function: kiểm tra đầu vào, origin, method', async () => {
  const auth = { authorization: 'Bearer secret-token' };
  assert.equal((await call(auth, '{bad')).status, 400);
  assert.equal((await call(auth, body([]))).status, 400);
  const many = Array.from({ length: 4 }, (_, i) => ({ id: 'i' + i, text: 'x', kind: 'UI' }));
  assert.equal((await call(auth, body(many))).status, 400);
  assert.equal((await call({ ...auth, origin: 'https://evil.example' })).status, 403);
  assert.equal((await call({ ...auth, origin: 'https://site.test' })).status, 200);
  assert.equal((await call(auth, undefined, 'GET')).status, 405);
});

test('function: chưa cấu hình ACCESS_TOKEN → từ chối an toàn', async () => {
  const saved = process.env.ACCESS_TOKEN;
  delete process.env.ACCESS_TOKEN;
  assert.equal((await call({ authorization: 'Bearer anything' })).status, 401);
  process.env.ACCESS_TOKEN = saved;
});
