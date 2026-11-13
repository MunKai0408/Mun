import test from 'node:test';
import assert from 'node:assert/strict';
import { callProvider, mapHttpError } from '../site/js/services/ai/provider.js';

const REQ = { projectId: 'p', batchId: 'b1', styleGuideVersion: '0.1', glossary: [{ source: 'Mana', target: 'Ma lực', keepAsIs: false }], items: [{ id: 'a', text: 'Restore Mana', kind: 'UI' }, { id: 'b', text: 'Hello', kind: 'UI' }] };

function withFetch(fn, body) {
  const orig = globalThis.fetch;
  globalThis.fetch = fn;
  return Promise.resolve(body()).finally(() => { globalThis.fetch = orig; });
}
const resp = (status, obj, headers = {}) => new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), { status, headers });

test('anthropic: dựng request đúng, đọc usage, tính chi phí', async () => {
  let seen;
  await withFetch(async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return resp(200, { content: [{ type: 'text', text: '```json\n{"translations":[{"id":"a","vi":"Hồi phục Ma lực"},{"id":"b","vi":"Xin chào"}]}\n```' }], usage: { input_tokens: 1000, output_tokens: 200 }, stop_reason: 'end_turn' });
  }, async () => {
    const r = await callProvider({ provider: 'anthropic', apiKey: 'k', model: '', browser: true, priceInPerMTok: 3, priceOutPerMTok: 15 }, REQ, { timeoutMs: 5000 });
    assert.equal(r.results.length, 2);
    assert.equal(r.results[0].translation, 'Hồi phục Ma lực');
    assert.equal(r.usage.inputTokens, 1000);
    assert.ok(Math.abs(r.usage.costUsd - 0.006) < 1e-9);
    assert.equal(r.model, 'claude-sonnet-5-5');
  });
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(seen.init.headers['x-api-key'], 'k');
  assert.equal(seen.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.match(seen.body.system, /"Mana" → "Ma lực"/);
  assert.equal(JSON.parse(seen.body.messages[0].content).items.length, 2);
});

test('openai-compatible: baseUrl tuỳ chỉnh + Bearer', async () => {
  let seen;
  await withFetch(async (url, init) => {
    seen = { url, init };
    return resp(200, { choices: [{ message: { content: '{"translations":[{"id":"a","vi":"x"},{"id":"b","vi":"y"}]}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  }, async () => {
    const r = await callProvider({ provider: 'openai', apiKey: 'sk', model: 'm', baseUrl: 'https://openrouter.ai/api/v1/' }, REQ, { timeoutMs: 5000 });
    assert.equal(r.results.length, 2);
  });
  assert.equal(seen.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(seen.init.headers.authorization, 'Bearer sk');
});

test('lỗi HTTP được phân loại đúng', () => {
  assert.equal(mapHttpError(401, '{}', null).code, 'API_AUTH');
  assert.equal(mapHttpError(401, '{}', null).retryable, false);
  const rl = mapHttpError(429, '{"error":{"message":"slow"}}', '7');
  assert.equal(rl.code, 'API_RATE_LIMIT');
  assert.equal(rl.details.retryAfterMs, 7000);
  assert.equal(mapHttpError(529, '', null).retryable, true);
  assert.equal(mapHttpError(400, '{"error":{"message":"Your credit balance is too low"}}', null).code, 'BUDGET_EXCEEDED');
});

test('phản hồi cắt cụt / sai định dạng → lỗi có thể retry', async () => {
  await withFetch(async () => resp(200, { content: [{ type: 'text', text: '{"translations":[' }], stop_reason: 'max_tokens' }), async () => {
    await assert.rejects(() => callProvider({ provider: 'anthropic', apiKey: 'k', model: 'm' }, REQ, { timeoutMs: 5000 }), (e) => e.code === 'API_BAD_RESPONSE' && e.retryable);
  });
  await withFetch(async () => resp(200, { content: [{ type: 'text', text: 'xin lỗi tôi không thể' }], stop_reason: 'end_turn' }), async () => {
    await assert.rejects(() => callProvider({ provider: 'anthropic', apiKey: 'k', model: 'm' }, REQ, { timeoutMs: 5000 }), (e) => e.code === 'API_BAD_RESPONSE');
  });
});

test('lỗi mạng và timeout', async () => {
  await withFetch(async () => { throw new TypeError('fetch failed'); }, async () => {
    await assert.rejects(() => callProvider({ provider: 'anthropic', apiKey: 'k', model: 'm', browser: true }, REQ, { timeoutMs: 5000 }), (e) => e.code === 'API_NETWORK' && e.retryable);
  });
  // AbortSignal.timeout không giữ event loop sống → giữ bằng một timer trong mock
  await withFetch((url, init) => new Promise((_, rej) => { const keep = setInterval(() => {}, 1000); init.signal.addEventListener('abort', () => { clearInterval(keep); rej(init.signal.reason); }); }), async () => {
    await assert.rejects(() => callProvider({ provider: 'anthropic', apiKey: 'k', model: 'm' }, REQ, { timeoutMs: 30 }), (e) => e.code === 'API_TIMEOUT');
  });
});
