import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJson } from '../site/js/core/json/parse.js';
import { extractEntries } from '../site/js/core/extract/extract.js';
import { classifyEntries } from '../site/js/core/classify/classify.js';
import { startTranslation } from '../site/js/services/orchestrator/runner.js';
import { tmKey } from '../site/js/core/glossary/glossary.js';
import { DEFAULT_SETTINGS } from '../site/js/contracts/defaults.js';
import { exportVi } from '../site/js/core/export/merge.js';

const noSleep = () => Promise.resolve();

function setup(obj, { settings = {}, glossary = [], tm = new Map() } = {}) {
  const parse = parseJson(JSON.stringify(obj));
  let entries = classifyEntries(extractEntries(parse, 'p'));
  const s = { ...DEFAULT_SETTINGS, ...settings, batch: { ...DEFAULT_SETTINGS.batch, ...(settings.batch ?? {}) }, retry: { ...DEFAULT_SETTINGS.retry, baseDelayMs: 1, ...(settings.retry ?? {}) }, budget: { ...DEFAULT_SETTINGS.budget, ...(settings.budget ?? {}) } };
  const events = [];
  const audits = [];
  const persisted = [];
  const make = (translate, extra = {}) => ({
    translate,
    getContext: () => ({ projectId: 'p', glossary, characters: [], examples: [], settings: s, tm }),
    getEntries: () => entries,
    applyChanges: (changed, a) => {
      const m = new Map(changed.map((c) => [c.id, c]));
      entries = entries.map((e) => m.get(e.id) ?? e);
      audits.push(...a);
      persisted.push(changed.length);
    },
    onEvent: (e) => events.push(e),
    sleep: noSleep,
    random: () => 0,
    ...extra,
  });
  return { parse, get entries() { return entries; }, set entries(v) { entries = v; }, events, audits, persisted, make };
}

const okTr = (req) => Promise.resolve({
  batchId: req.batchId, provider: 'mock', model: 'm',
  results: req.items.map((i) => ({ id: i.id, translation: 'Việt ' + i.text })),
  usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.01 },
});
const err = (code, retryable, details) => Object.assign({ code, message: code, retryable, details });
const by = (h, p) => h.entries.find((e) => e.pointer === p);

const DATA = { a: 'Hello there', b: 'Open the door', c: 'Close the window', id: 'item_001', d: 'Hello there', e: 'Take {0} coins' };

test('runner: dịch toàn bộ, QA đạt → VERIFIED, trùng chỉ gửi một lần, EXCLUDED không bị dịch', async () => {
  const h = setup(DATA);
  const sent = [];
  const d = h.make((req) => { sent.push(...req.items.map((i) => i.text)); return okTr(req); });
  const sum = await startTranslation(d).promise;
  assert.equal(sum.verified, 5);
  assert.equal(sum.fatal, undefined);
  assert.equal(sent.filter((t) => t === 'Hello there').length, 1);
  assert.equal(by(h, '/d').translation, 'Việt Hello there');
  assert.equal(by(h, '/id').status, 'EXCLUDED');
  assert.equal(by(h, '/id').translation, null);
  assert.equal(by(h, '/e').translation, 'Việt Take {0} coins');
  assert.ok(sum.costUsd > 0);
  const { report } = exportVi(h.parse, h.entries);
  assert.equal(report.ok, true, report.issues.join(';'));
  assert.ok(h.persisted.length > 0, 'phải lưu checkpoint');
});

test('runner: 429 → chờ và retry, thành công', async () => {
  const h = setup({ a: 'Hello there' });
  let calls = 0;
  const waits = [];
  const d = h.make((req) => { if (++calls < 3) return Promise.reject(err('API_RATE_LIMIT', true, { retryAfterMs: 500 })); return okTr(req); }, { sleep: (ms) => { waits.push(ms); return Promise.resolve(); } });
  const sum = await startTranslation(d).promise;
  assert.equal(calls, 3);
  assert.equal(sum.verified, 1);
  assert.ok(waits.every((w) => w >= 500));
});

test('runner: một chuỗi gây lỗi không dừng cả quá trình (bisect cô lập)', async () => {
  const obj = {};
  for (let i = 0; i < 9; i++) obj['k' + i] = 'Normal sentence number ' + i;
  obj.bad = 'POISON sentence here';
  const h = setup(obj);
  const d = h.make((req) => (req.items.some((i) => i.text.includes('POISON')) ? Promise.reject(err('API_PROVIDER_ERROR', true)) : okTr(req)));
  const sum = await startTranslation(d).promise;
  assert.equal(by(h, '/bad').status, 'REVIEW_REQUIRED');
  assert.equal(h.entries.filter((e) => e.status === 'VERIFIED').length, 9);
  assert.equal(sum.reviewRequired, 1);
});

test('runner: phản hồi thiếu id → dịch lại phần thiếu', async () => {
  const h = setup({ a: 'Alpha one', b: 'Beta two', c: 'Gamma three' });
  let first = true;
  const d = h.make((req) => {
    if (first) { first = false; return Promise.resolve({ batchId: req.batchId, provider: 'm', model: 'm', results: req.items.slice(0, 1).map((i) => ({ id: i.id, translation: 'Việt ' + i.text })) }); }
    return okTr(req);
  });
  const sum = await startTranslation(d).promise;
  assert.equal(sum.verified, 3);
});

test('runner: QA trượt → gửi lại kèm gợi ý sửa lỗi → đạt', async () => {
  const h = setup({ a: 'Hello {name}, welcome' });
  const fixes = [];
  const d = h.make((req) => {
    const it = req.items[0];
    fixes.push(it.fix ?? null);
    const text = it.fix ? 'Chào {name}, chào mừng' : 'Xin chào, chào mừng'; // lần đầu làm mất {name}
    return Promise.resolve({ batchId: req.batchId, provider: 'm', model: 'm', results: [{ id: it.id, translation: text }] });
  });
  const sum = await startTranslation(d).promise;
  assert.equal(sum.verified, 1);
  assert.equal(fixes[0], null);
  assert.match(fixes[1], /placeholder/i);
  assert.equal(by(h, '/a').retryCount, 1);
});

test('runner: QA luôn trượt → hết retry → REVIEW_REQUIRED (không retry vô hạn)', async () => {
  const h = setup({ a: 'Hello {name}, welcome' }, { settings: { retry: { max: 2 } } });
  let calls = 0;
  const d = h.make((req) => { calls++; return Promise.resolve({ batchId: req.batchId, provider: 'm', model: 'm', results: req.items.map((i) => ({ id: i.id, translation: 'Xin chào' })) }); });
  const sum = await startTranslation(d).promise;
  assert.equal(by(h, '/a').status, 'REVIEW_REQUIRED');
  assert.equal(calls, 3); // 1 lần đầu + 2 retry
  assert.equal(sum.reviewRequired, 1);
});

test('runner: Auto Repair sửa lỗi nhỏ mà không cần gọi AI lại', async () => {
  const h = setup({ a: 'Hello {name}' });
  let calls = 0;
  const d = h.make((req) => { calls++; return Promise.resolve({ batchId: req.batchId, provider: 'm', model: 'm', results: req.items.map((i) => ({ id: i.id, translation: '"Xin chào { Name }"' })) }); });
  await startTranslation(d).promise;
  assert.equal(calls, 1);
  assert.equal(by(h, '/a').translation, 'Xin chào {name}');
  assert.equal(by(h, '/a').status, 'VERIFIED');
});

test('runner: lỗi xác thực → dừng, chuỗi trở về PENDING', async () => {
  const h = setup({ a: 'Hello there', b: 'Open the door' });
  const d = h.make(() => Promise.reject(err('API_AUTH', false)));
  const sum = await startTranslation(d).promise;
  assert.equal(sum.fatal.code, 'API_AUTH');
  assert.ok(h.entries.every((e) => e.status === 'PENDING'));
});

test('runner: Translation Memory dùng lại bản dịch, không gọi AI', async () => {
  const tm = new Map();
  const h = setup({ a: 'Hello there', b: 'Open the door' }, { tm });
  const e0 = h.entries[0];
  tm.set(tmKey(e0.original, e0.kind), { key: tmKey(e0.original, e0.kind), source: e0.original, kind: e0.kind, target: 'Xin chào bạn', verifiedLevel: 'HUMAN', updatedAt: 0 });
  const sent = [];
  const d = h.make((req) => { sent.push(...req.items.map((i) => i.text)); return okTr(req); });
  const sum = await startTranslation(d).promise;
  assert.deepEqual(sent, ['Open the door']);
  assert.equal(sum.fromTm, 1);
  assert.equal(by(h, '/a').translation, 'Xin chào bạn');
  assert.equal(by(h, '/a').translationSource, 'TM');
});

test('runner: tạm dừng / tiếp tục / huỷ', async () => {
  const obj = {};
  for (let i = 0; i < 6; i++) obj['k' + i] = 'Sentence number ' + i + ' here';
  const h = setup(obj, { settings: { batch: { maxItems: 1, maxChars: 3500, concurrency: 1 } } });
  let calls = 0;
  let ctl;
  const d = h.make((req) => { calls++; if (calls === 2) ctl.pause(); return okTr(req); });
  ctl = startTranslation(d);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(ctl.isPaused(), true);
  const before = calls;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls, before, 'không gọi thêm khi đang tạm dừng');
  ctl.resume();
  const sum = await ctl.promise;
  assert.equal(sum.verified, 6);

  // huỷ
  const h2 = setup(obj, { settings: { batch: { maxItems: 1, maxChars: 3500, concurrency: 1 } } });
  let c2 = 0; let ctl2;
  ctl2 = startTranslation(h2.make((req) => { c2++; if (c2 === 2) ctl2.cancel(); return okTr(req); }));
  const s2 = await ctl2.promise;
  assert.equal(s2.cancelled, true);
  assert.ok(h2.entries.every((e) => e.status !== 'TRANSLATING'), 'không để chuỗi kẹt TRANSLATING');
  assert.ok(h2.entries.some((e) => e.status === 'PENDING'));
});

test('runner: tiếp tục sau gián đoạn — không dịch lại chuỗi đã VERIFIED', async () => {
  const h = setup({ a: 'Hello there', b: 'Open the door', c: 'Close the window' });
  await startTranslation(h.make(okTr, {}), { limit: 1 }).promise;
  assert.equal(h.entries.filter((e) => e.status === 'VERIFIED').length, 1);
  const sent = [];
  await startTranslation(h.make((req) => { sent.push(...req.items.map((i) => i.text)); return okTr(req); })).promise;
  assert.equal(sent.length, 2);
  assert.ok(h.entries.every((e) => e.status === 'VERIFIED'));
});

test('runner: chuỗi bị khoá và chuỗi cần xác nhận phân loại không bị dịch', async () => {
  const h = setup({ a: 'Hello there', b: 'DarkKnight' });
  assert.equal(by(h, '/b').needsClassifyReview, true);
  h.entries = h.entries.map((e) => (e.pointer === '/a' ? { ...e, locked: true } : e));
  const sent = [];
  await startTranslation(h.make((req) => { sent.push(...req.items.map((i) => i.text)); return okTr(req); })).promise;
  assert.deepEqual(sent, []);
});

test('runner: vượt trần ngân sách → tự tạm dừng', async () => {
  const obj = {};
  for (let i = 0; i < 4; i++) obj['k' + i] = 'Sentence number ' + i + ' here';
  const h = setup(obj, { settings: { batch: { maxItems: 1, maxChars: 3500, concurrency: 1 }, budget: { capUsd: 0.015 } } });
  const ctl = startTranslation(h.make(okTr));
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(ctl.isPaused(), true);
  assert.ok(h.events.some((e) => e.type === 'budget'));
  ctl.cancel();
  await ctl.promise;
});

test('runner: 2.000 chuỗi qua Mock, concurrency 4 — hiệu năng và nhất quán', async () => {
  const obj = {};
  for (let i = 0; i < 2000; i++) obj['k' + i] = 'Sentence number ' + i + ' of the stress test';
  const h = setup(obj, { settings: { batch: { maxItems: 25, maxChars: 4000, concurrency: 4 } } });
  const t0 = Date.now();
  const sum = await startTranslation(h.make(okTr)).promise;
  assert.equal(sum.verified, 2000);
  assert.ok(Date.now() - t0 < 15000, 'quá chậm: ' + (Date.now() - t0));
});
