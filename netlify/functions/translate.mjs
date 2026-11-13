// Netlify Function: proxy gọi AI, giữ API key ở máy chủ (chế độ SERVER) hoặc chuyển tiếp key người dùng (BYO, không lưu/log).
// Biến môi trường: ACCESS_TOKEN (bắt buộc ở chế độ SERVER), AI_API_KEY, AI_PROVIDER (anthropic|openai), AI_MODEL,
// AI_BASE_URL (openai-compatible), ALLOWED_ORIGINS (phân tách bằng dấu phẩy), MAX_ITEMS, MAX_CHARS, FUNC_TIMEOUT_MS.
import { timingSafeEqual } from 'node:crypto';
import { callProvider } from '../../site/js/services/ai/provider.js';

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const fail = (status, code, message, retryable = false, headers = {}) => json(status, { error: { code, message, retryable } }, headers);

const safeEq = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// Giới hạn tốc độ tạm theo IP (best-effort: mỗi instance của Function có bộ nhớ riêng).
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > Number(process.env.RATE_PER_MIN ?? 120);
}

export default async (req, context) => {
  if (req.method !== 'POST') return fail(405, 'API_PROVIDER_ERROR', 'Chỉ chấp nhận POST.');

  // Origin: mặc định chỉ cho cùng origin; có thể mở rộng bằng ALLOWED_ORIGINS
  const origin = req.headers.get('origin');
  if (origin) {
    const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const sameHost = new URL(origin).host === new URL(req.url).host;
    if (!sameHost && !allowed.includes(origin)) return fail(403, 'API_AUTH', 'Origin không được phép.');
  }

  const ip = context?.ip ?? req.headers.get('x-nf-client-connection-ip') ?? 'unknown';
  if (rateLimited(ip)) return fail(429, 'API_RATE_LIMIT', 'Quá nhiều yêu cầu, hãy thử lại sau.', true, { 'retry-after': '10' });

  // Xác thực
  const userKey = req.headers.get('x-user-key');
  let apiKey;
  let provider = process.env.AI_PROVIDER ?? 'anthropic';
  if (userKey) {
    apiKey = userKey;
    const p = req.headers.get('x-provider');
    if (p === 'anthropic' || p === 'openai') provider = p;
  } else {
    const token = process.env.ACCESS_TOKEN;
    if (!token) return fail(401, 'API_AUTH', 'Máy chủ chưa cấu hình ACCESS_TOKEN.');
    const auth = req.headers.get('authorization') ?? '';
    if (!auth.startsWith('Bearer ') || !safeEq(auth.slice(7), token)) return fail(401, 'API_AUTH', 'Token truy cập không đúng.');
    apiKey = process.env.AI_API_KEY;
    if (!apiKey) return fail(500, 'API_AUTH', 'Máy chủ chưa cấu hình AI_API_KEY.');
  }

  // Kiểm tra đầu vào
  let body;
  try { body = await req.json(); } catch { return fail(400, 'API_BAD_RESPONSE', 'Body không phải JSON.'); }
  const maxItems = Number(process.env.MAX_ITEMS ?? 60);
  const maxChars = Number(process.env.MAX_CHARS ?? 20000);
  if (!body || !Array.isArray(body.items) || body.items.length === 0 || body.items.length > maxItems) return fail(400, 'API_BAD_RESPONSE', `items phải có 1–${maxItems} phần tử.`);
  let chars = 0;
  for (const it of body.items) {
    if (!it || typeof it.id !== 'string' || typeof it.text !== 'string') return fail(400, 'API_BAD_RESPONSE', 'Mỗi item cần id và text dạng chuỗi.');
    chars += it.text.length;
  }
  if (chars > maxChars) return fail(400, 'JSON_TOO_LARGE', `Tổng ký tự vượt ${maxChars}.`);
  body.glossary = Array.isArray(body.glossary) ? body.glossary.slice(0, 300) : [];
  body.styleGuideVersion = String(body.styleGuideVersion ?? '0.1');

  // Chế độ SERVER: model do máy chủ quyết định (tránh bị lạm dụng model đắt tiền), trừ khi ALLOW_MODEL_OVERRIDE=1
  const model = userKey || process.env.ALLOW_MODEL_OVERRIDE === '1' ? body.options?.model || process.env.AI_MODEL || '' : process.env.AI_MODEL || '';

  try {
    const result = await callProvider(
      { provider, apiKey, model, baseUrl: process.env.AI_BASE_URL || undefined,
        priceInPerMTok: process.env.AI_PRICE_IN ? Number(process.env.AI_PRICE_IN) : null,
        priceOutPerMTok: process.env.AI_PRICE_OUT ? Number(process.env.AI_PRICE_OUT) : null },
      body,
      { timeoutMs: Number(process.env.FUNC_TIMEOUT_MS ?? 25000) },
    );
    return json(200, result);
  } catch (e) {
    // Không bao giờ trả lại key hay nội dung header trong lỗi
    const code = e?.code ?? 'API_PROVIDER_ERROR';
    const status = code === 'API_AUTH' ? 401 : code === 'API_RATE_LIMIT' ? 429 : code === 'API_TIMEOUT' ? 504 : 502;
    const headers = e?.details?.retryAfterMs ? { 'retry-after': String(Math.ceil(e.details.retryAfterMs / 1000)) } : {};
    return fail(status, code, String(e?.message ?? 'Lỗi không xác định').slice(0, 300), !!e?.retryable, headers);
  }
};

export const config = { path: '/api/translate' };
