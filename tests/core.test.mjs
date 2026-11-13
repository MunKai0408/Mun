import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJson } from '../site/js/core/json/parse.js';
import { validateParsed } from '../site/js/core/json/validate.js';
import { extractEntries } from '../site/js/core/extract/extract.js';
import { classifyText, classifyEntries } from '../site/js/core/classify/classify.js';
import { findTokens, diffTokens, tagsBalanced, stripProtected } from '../site/js/core/qa/placeholders.js';
import { runQa } from '../site/js/core/qa/validate.js';
import { repairTranslation } from '../site/js/core/repair/repair.js';
import { transition, canTransition, recoverInterrupted } from '../site/js/core/state/state.js';
import { makeBatches } from '../site/js/core/batch/batch.js';
import { exportVi, mergeTranslations } from '../site/js/core/export/merge.js';
import { checkCompleteness, computeProgress } from '../site/js/core/progress/progress.js';
import { buildSystemPrompt, parseModelOutput } from '../site/js/core/translate/prompt.js';
import { extractTermCandidates, tmFromEntries } from '../site/js/core/glossary/glossary.js';
import { DEFAULT_SETTINGS } from '../site/js/contracts/defaults.js';

const QA = { glossary: [], settings: DEFAULT_SETTINGS.qa, kind: 'UI' };

// ---------- Parser ----------
test('parser: đọc JSON lồng nhau, giữ pointer và span', () => {
  const src = '{\n  "ui": { "ok": "OK", "list": ["a b", "c d"] },\n  "n": 5, "t": true, "z": null\n}';
  const p = parseJson(src);
  assert.equal(p.ok, true);
  assert.deepEqual(p.strings.map((s) => s.pointer), ['/ui/ok', '/ui/list/0', '/ui/list/1']);
  for (const s of p.strings) assert.equal(src.slice(s.span.start, s.span.end), s.rawLiteral);
  assert.equal(p.nonStringCount, 6); // 2 object + 1 array... + số + true + null
});

test('parser: phát hiện key trùng (JSON.parse sẽ làm mất)', () => {
  const p = parseJson('{"a":"x","a":"y"}');
  assert.equal(p.ok, true);
  assert.equal(p.strings.length, 2);
  assert.equal(p.strings[1].dupIndex, 1);
  assert.ok(p.issues.some((i) => i.code === 'JSON_DUPLICATE_KEY'));
});

test('parser: báo lỗi cú pháp kèm dòng/cột', () => {
  const p = parseJson('{\n  "a": "x",\n  "b": \n}');
  assert.equal(p.ok, false);
  assert.equal(p.issues[0].code, 'JSON_SYNTAX');
  assert.equal(p.issues[0].line, 4);
});

test('parser: lỗi phổ biến bị từ chối', () => {
  for (const bad of ['{"a":}', '{"a":"x",}', "{'a':'x'}", '{"a":"x"} extra', '{"a":"\\q"}', '{"a":"\n"}', '[1,]', '{"a":01}', '', '{"a":"x"']) {
    assert.equal(parseJson(bad).ok, false, `phải lỗi: ${JSON.stringify(bad)}`);
  }
});

test('parser: BOM, CRLF, unicode, escape', () => {
  const src = '﻿{\r\n"a":"Xin chào \\u00e9 \\n \\"q\\" 😀"}\r\n';
  const p = parseJson(src);
  assert.equal(p.ok, true);
  assert.equal(p.hasBom, true);
  assert.equal(p.newline, 'CRLF');
  assert.equal(p.strings[0].value, 'Xin chào é \n "q" 😀');
});

test('parser: JSON lồng quá sâu không làm tràn stack', () => {
  const p = parseJson('['.repeat(2000) + ']'.repeat(2000));
  assert.equal(p.ok, false);
  assert.equal(p.issues[0].code, 'JSON_TOO_DEEP');
});

test('parser: khớp JSON.parse trên tập giá trị', () => {
  const obj = { a: ['x', { b: 'y z', c: 1.5e3 }], 'k/~': 'v' };
  const text = JSON.stringify(obj, null, 2);
  const p = parseJson(text);
  assert.equal(p.ok, true);
  assert.deepEqual(p.strings.map((s) => s.value), ['x', 'y z', 'v']);
  assert.equal(p.strings[2].pointer, '/k~1~0');
});

test('validator: chuỗi quá dài và file không có chuỗi', () => {
  assert.equal(validateParsed(parseJson('{"a":1}')).warnings, 1);
  const v = validateParsed(parseJson(JSON.stringify({ a: 'x'.repeat(30) })), { maxStringLen: 10 });
  assert.ok(v.issues.some((i) => i.code === 'JSON_TOO_LARGE'));
});

// ---------- Extractor ----------
test('extractor: id ổn định khi parse lại và duy nhất khi key trùng', () => {
  const src = '{"a":"x","a":"y","b":{"a":"z"}}';
  const e1 = extractEntries(parseJson(src), 'p');
  const e2 = extractEntries(parseJson(src), 'p');
  assert.deepEqual(e1.map((e) => e.id), e2.map((e) => e.id));
  assert.equal(new Set(e1.map((e) => e.id)).size, 3);
});

// ---------- Classifier ----------
test('classifier: loại chuỗi kỹ thuật, không loại văn bản thường', () => {
  const ex = (t, path = ['x']) => classifyText(t, path, '/' + path.join('/')).exclude;
  assert.equal(ex(''), 'EMPTY');
  assert.equal(ex('   '), 'EMPTY');
  assert.equal(ex('12.5%'), 'NUMERIC');
  assert.equal(ex('{0}'), 'NO_LETTERS');
  assert.equal(ex('★ ★ ★'), 'NO_LETTERS');
  assert.equal(ex('#FF00FF'), 'COLOR_OR_HEX');
  assert.equal(ex('https://example.com/a'), 'PATH_OR_URL');
  assert.equal(ex('assets/ui/icon.png'), 'PATH_OR_URL');
  assert.equal(ex('item_sword_01'), 'ID_OR_CODE');
  assert.equal(ex('MAX_HEALTH'), 'ID_OR_CODE');
  assert.equal(ex('btnOk'), 'ID_OR_CODE');
  assert.equal(ex('Xin chào các bạn, đây là bản đã dịch'), 'ALREADY_VIETNAMESE');
  assert.equal(ex('こんにちは世界'), 'NOT_ENGLISH');
  for (const t of ['Start Game', 'Back', 'You found {0} gold!', 'Half-Elf', 'Use the <b>Health Potion</b>.', 'OK']) {
    assert.equal(ex(t), undefined, `không được loại: ${t}`);
  }
});

test('classifier: chuỗi nghi ngờ → cần xác nhận, không tự loại', () => {
  const r = classifyText('DarkKnight', ['name'], '/name');
  assert.equal(r.needsReview, true);
  assert.equal(r.exclude, undefined);
  const r2 = classifyText('ui.button.ok', ['x'], '/x');
  assert.equal(r2.needsReview, true);
});

test('classifier: loại theo đường dẫn key và luật người dùng', () => {
  assert.equal(classifyText('Heal', ['skills', '0', 'name'], '/skills/0/name').kind, 'SKILL');
  assert.equal(classifyText('Hello there, traveler.', ['dialogue', 'intro'], '/dialogue/intro').kind, 'DIALOGUE');
  const r = classifyText('Secret Debug', ['dbg', 'label'], '/dbg/label', [{ id: 'r', pointerRegex: '^/dbg/', action: 'EXCLUDE' }]);
  assert.equal(r.exclude, 'USER_RULE');
});

test('classifyEntries: gắn EXCLUDED có lý do', () => {
  const es = classifyEntries(extractEntries(parseJson('{"a":"Hello world","id":"item_001","c":"#fff"}'), 'p'));
  assert.equal(es[0].status, 'PENDING');
  assert.equal(es[1].status, 'EXCLUDED');
  assert.equal(es[1].excludeReason, 'ID_OR_CODE');
  assert.equal(es[2].excludeReason, 'COLOR_OR_HEX');
});

// ---------- Placeholder / tag ----------
test('placeholders: nhận diện các dạng phổ biến', () => {
  const keys = (s) => findTokens(s).map((t) => t.raw);
  assert.deepEqual(keys('Hi {0}, {name} và {{count}} ${x} %s %d %1$s 100%%'), ['{0}', '{name}', '{{count}}', '${x}', '%s', '%d', '%1$s', '%%']);
  assert.deepEqual(keys('50% off'), []);
  assert.deepEqual(keys('<color=#FF0000>Hot</color> [b]x[/b] <br/> &nbsp; \\n'), ['<color=#FF0000>', '</color>', '[b]', '[/b]', '<br/>', '&nbsp;', '\\n']);
  assert.deepEqual(keys('[Note] giữ nguyên'), []);
});

test('placeholders: ICU plural — chỉ dịch chữ trong nhánh', () => {
  const src = '{count, plural, one {# item} other {# items}} left';
  const vi = '{count, plural, one {# vật phẩm} other {# vật phẩm}} còn lại';
  const d = diffTokens(findTokens(src), findTokens(vi));
  assert.deepEqual(d, { missing: [], extra: [] });
  const broken = '{count, plural, one {# vật phẩm}} còn lại';
  const d2 = diffTokens(findTokens(src), findTokens(broken));
  assert.ok(d2.missing.length > 0);
  // nhánh {Many} dịch được mà không bị tính là placeholder
  const s2 = '{n, plural, one {One} other {Many}}';
  const v2 = '{n, plural, one {Một} other {Nhiều}}';
  assert.deepEqual(diffTokens(findTokens(s2), findTokens(v2)), { missing: [], extra: [] });
});

test('tags: cân bằng và stripProtected', () => {
  assert.equal(tagsBalanced('<b>x</b>'), true);
  assert.equal(tagsBalanced('<b>x<i>y</b></i>'), false);
  assert.equal(tagsBalanced('a<br>b'), true);
  assert.equal(stripProtected('{0}').trim(), '');
  assert.match(stripProtected('You have {0} gold'), /You have\s+gold/);
});

// ---------- QA ----------
const q = (o, t, extra = {}) => runQa(o, t, { ...QA, ...extra });
const codes = (r) => r.issues.map((i) => i.code);

test('QA: bản dịch tốt đạt', () => {
  const r = q('You found {0} gold!', 'Bạn nhặt được {0} vàng!');
  assert.equal(r.passed, true);
  assert.equal(r.score, 100);
});

test('QA: placeholder thiếu/thừa → BLOCKER', () => {
  assert.ok(codes(q('Hello {name}', 'Xin chào')).includes('PLACEHOLDER_MISSING'));
  assert.ok(codes(q('Hello {name}', 'Xin chào {ten}')).includes('PLACEHOLDER_EXTRA'));
  assert.equal(q('Hello {name}', 'Xin chào').passed, false);
});

test('QA: cho phép đổi thứ tự placeholder', () => {
  assert.equal(q('%1$s attacks %2$s', '%2$s bị %1$s tấn công').passed, true);
});

test('QA: tag mất / không cân bằng', () => {
  assert.ok(codes(q('<b>Hot</b>', 'Nóng')).includes('TAG_MISSING'));
  assert.ok(codes(q('<b>Hot</b> <i>x</i>', '<b>Nóng <i>x</b></i>')).includes('TAG_UNBALANCED'));
});

test('QA: trống, còn tiếng Anh, giống gốc, rác AI, bao ngoặc', () => {
  assert.ok(codes(q('Hello', '')).includes('EMPTY'));
  assert.ok(codes(q('Press the button to start the game now', 'Press the button to start the game now')).includes('UNTRANSLATED'));
  assert.ok(codes(q('Press the button to start the game', 'You can press the button and it will start the game')).includes('STILL_ENGLISH'));
  assert.ok(codes(q('Start', 'Bản dịch: Bắt đầu')).includes('AI_PREAMBLE'));
  assert.ok(codes(q('Start', '"Bắt đầu"')).includes('AI_WRAP_QUOTES'));
  assert.equal(q('OK', 'OK').passed, true); // ngắn, có thể là thuật ngữ giữ nguyên
});

test('QA: số, xuống dòng, khoảng trắng, độ dài, chữ lạ, lặp', () => {
  assert.ok(codes(q('Deal 50 damage', 'Gây 500 sát thương')).includes('NUMBER_MISMATCH'));
  assert.equal(q('Gây 1,000 sát thương', 'Deal 1.000 damage').issues.some((i) => i.code === 'NUMBER_MISMATCH'), false);
  assert.ok(codes(q('Line1\nLine2', 'Dòng một Dòng hai')).includes('NEWLINE_MISMATCH'));
  assert.ok(codes(q('Hi ', 'Chào')).includes('WHITESPACE_EDGE'));
  assert.ok(codes(q('Save game', 'Lưu trò chơi vào bộ nhớ của thiết bị này ngay bây giờ')).includes('TOO_LONG'));
  assert.ok(codes(q('Hello world friend', '你好世界')).includes('FOREIGN_SCRIPT'));
  assert.ok(codes(q('Attack the enemy now please', 'Tấn công tấn công tấn công tấn công tấn công')).includes('REPETITION'));
});

test('QA: Glossary dịch chuẩn và giữ nguyên', () => {
  const glossary = [
    { id: '1', source: 'Mana', target: 'Ma lực', category: 'GENERAL', keepAsIs: false, caseSensitive: false },
    { id: '2', source: 'Aria', target: '', category: 'CHARACTER', keepAsIs: true, caseSensitive: true },
  ];
  assert.equal(q('Restore Mana', 'Hồi phục Ma lực', { glossary }).passed, true);
  assert.ok(codes(q('Restore Mana', 'Hồi phục năng lượng', { glossary })).includes('GLOSSARY_MISMATCH'));
  assert.ok(codes(q('Aria is here', 'Cô ấy ở đây', { glossary })).includes('GLOSSARY_KEEP'));
});

// ---------- Repair ----------
test('repair: sửa lỗi xác định', () => {
  const r1 = repairTranslation('Hi {name}', '"Chào { Name }"');
  assert.equal(r1.text, 'Chào {name}');
  assert.equal(q('Hi {name}', r1.text).passed, true);
  assert.equal(repairTranslation('Start', 'Bản dịch: Bắt đầu').text, 'Bắt đầu');
  assert.equal(repairTranslation('Start', '```\nBắt đầu\n```').text, 'Bắt đầu');
  assert.equal(repairTranslation(' Hi ', 'Chào').text, ' Chào ');
  assert.equal(repairTranslation('A\nB', 'Một\\nHai').text, 'Một\nHai');
  assert.equal(repairTranslation('Giá 50% %s', 'Giá 50% % s').text.includes('%s'), true);
});

test('repair: không bịa placeholder thiếu', () => {
  const r = repairTranslation('Hello {name}', 'Xin chào');
  assert.equal(r.text, 'Xin chào');
  assert.equal(q('Hello {name}', r.text).passed, false);
});

// ---------- State machine ----------
const mk = (over = {}) => ({ id: 's1', status: 'PENDING', translation: null, retryCount: 0, updatedAt: 0, original: 'x', ...over });

test('state: chuyển hợp lệ / không hợp lệ', () => {
  assert.equal(canTransition('PENDING', 'TRANSLATING'), true);
  assert.equal(canTransition('EXCLUDED', 'VERIFIED'), false);
  assert.equal(canTransition('VERIFIED', 'QA_FAILED'), false);
  assert.throws(() => transition(mk(), 'QA_FAILED'));
  assert.throws(() => transition(mk(), 'EXCLUDED'), /excludeReason/);
  const r = transition(mk(), 'EXCLUDED', { excludeReason: 'USER_MANUAL' });
  assert.equal(r.entry.status, 'EXCLUDED');
  assert.equal(r.audit.from, 'PENDING');
  assert.equal(transition(r.entry, 'PENDING').entry.excludeReason, undefined);
});

test('state: phục hồi chuỗi TRANSLATING bị gián đoạn', () => {
  const { entries, recovered } = recoverInterrupted([mk({ status: 'TRANSLATING' }), mk({ id: 's2', status: 'VERIFIED' })]);
  assert.equal(recovered, 1);
  assert.equal(entries[0].status, 'PENDING');
  assert.equal(entries[1].status, 'VERIFIED');
});

// ---------- Batcher ----------
test('batcher: giới hạn, không cắt chuỗi, gộp trùng, có neighbors', () => {
  const src = JSON.stringify({ a: 'Hello', b: 'Hello', c: 'World', d: 'x'.repeat(50), e: 'Last one' });
  const all = classifyEntries(extractEntries(parseJson(src), 'p')).map((e) => ({ ...e, kind: 'UI' }));
  const batches = makeBatches(all, all, { maxItems: 2, maxChars: 40 });
  const ids = batches.flatMap((b) => b.items.map((i) => i.id));
  assert.equal(ids.length, 4); // 'b' gộp vào 'a'
  assert.deepEqual(batches[0].followers.get(all[0].id), [all[1].id]);
  for (const b of batches) assert.ok(b.items.length <= 2);
  assert.ok(batches.some((b) => b.items.some((i) => i.text.length === 50)));
  assert.ok(batches[0].neighbors.length >= 1);
});

test('batcher: 50.000 chuỗi trong thời gian hợp lý', () => {
  const obj = {};
  for (let i = 0; i < 50000; i++) obj['k' + i] = 'String number ' + i + ' of the test';
  const t0 = Date.now();
  const p = parseJson(JSON.stringify(obj));
  const es = classifyEntries(extractEntries(p, 'p'));
  const b = makeBatches(es, es, { maxItems: 20, maxChars: 3500 });
  const ms = Date.now() - t0;
  assert.equal(es.length, 50000);
  assert.equal(b.reduce((n, x) => n + x.items.length, 0), 50000);
  assert.ok(ms < 8000, `quá chậm: ${ms}ms`);
});

// ---------- Export ----------
const SRC = '﻿{\r\n  "ui": {"play": "Play {0}", "list": ["One", "Two"]},\r\n  "n": 3, "id": "item_001", "esc": "A\\u00e9\\/b",\r\n  "e": ""\r\n}\r\n';

function prepared() {
  const p = parseJson(SRC);
  const es = classifyEntries(extractEntries(p, 'p'));
  return { p, es };
}

test('export: Identity Round-trip byte-for-byte (BOM, CRLF, escape, khoảng trắng)', () => {
  const { p, es } = prepared();
  const out = mergeTranslations(p, es.map((e) => ({ ...e, translation: e.original, status: 'VERIFIED' })));
  assert.equal(out, SRC);
  const r = exportVi(p, es);
  assert.equal(r.report.identityRoundTripOk, true);
});

test('export: thay bản dịch, giữ nguyên mọi thứ khác, validation đạt', () => {
  const { p, es } = prepared();
  const tr = { '/ui/play': 'Chơi {0}', '/ui/list/0': 'Một', '/ui/list/1': 'Hai', '/esc': 'Aé/b "vi"' };
  const done = es.map((e) => (tr[e.pointer] ? { ...e, translation: tr[e.pointer], status: 'VERIFIED' } : e));
  const { text, report } = exportVi(p, done);
  assert.equal(report.ok, true, report.issues.join('\n'));
  assert.equal(JSON.parse(text.slice(1)).ui.play, 'Chơi {0}');
  assert.equal(JSON.parse(text.slice(1)).esc, 'Aé/b "vi"');
  assert.equal(JSON.parse(text.slice(1)).id, 'item_001'); // chuỗi kỹ thuật không đổi
  assert.ok(text.startsWith('﻿{\r\n  "ui"'));
  assert.ok(text.endsWith('}\r\n'));
});

test('export: phát hiện placeholder bị mất ở file xuất', () => {
  const { p, es } = prepared();
  const done = es.map((e) => (e.pointer === '/ui/play' ? { ...e, translation: 'Chơi', status: 'TRANSLATED' } : e));
  const { report } = exportVi(p, done);
  assert.equal(report.placeholdersOk, false);
  assert.equal(report.ok, false);
});

test('export: chuỗi chưa đạt (QA_FAILED/PENDING) giữ nguyên tiếng Anh', () => {
  const { p, es } = prepared();
  const done = es.map((e) => (e.pointer === '/ui/play' ? { ...e, translation: 'Chơi', status: 'QA_FAILED' } : e));
  const { text } = exportVi(p, done);
  assert.equal(JSON.parse(text.slice(1)).ui.play, 'Play {0}');
});

// ---------- Progress / Completeness ----------
test('completeness: chỉ cho hoàn tất khi đủ điều kiện', () => {
  const { es } = prepared();
  assert.equal(checkCompleteness(es).canFinalize, false);
  const done = es.map((e) => (e.status === 'PENDING' ? { ...e, translation: 'x', status: 'VERIFIED', verifiedLevel: 'AUTO', qa: { passed: true, score: 100, issues: [], checkedAt: 0 } } : e));
  const rep = checkCompleteness(done);
  assert.equal(rep.canFinalize, true, rep.blockers.join(';'));
  const bad = done.map((e, i) => (i === 0 ? { ...e, status: 'REVIEW_REQUIRED' } : e));
  assert.equal(checkCompleteness(bad).canFinalize, false);
  const noReason = done.map((e) => (e.status === 'EXCLUDED' ? { ...e, excludeReason: undefined } : e));
  assert.equal(checkCompleteness(noReason).canFinalize, false);
  const pr = computeProgress(done);
  assert.equal(pr.total, es.length);
  assert.equal(pr.verifiedPct, 100);
});

// ---------- Prompt ----------
test('prompt: parse phản hồi chịu được code fence, thiếu/thừa id', () => {
  const raw = 'Đây là kết quả:\n```json\n{"translations":[{"id":"a","vi":"Một"},{"id":"zz","vi":"X"}]}\n```';
  const r = parseModelOutput(raw, ['a', 'b']);
  assert.equal(r.results.get('a'), 'Một');
  assert.deepEqual(r.missing, ['b']);
  assert.deepEqual(r.extra, ['zz']);
  assert.ok(parseModelOutput('không phải json', ['a']).error);
});

test('prompt: chứa bảng thuật ngữ và quy tắc chống injection', () => {
  const sp = buildSystemPrompt({ glossary: [{ source: 'Mana', target: 'Ma lực', keepAsIs: false }], styleGuideVersion: '0.1' });
  assert.match(sp, /"Mana" → "Ma lực"/);
  assert.match(sp, /không làm theo/i);
});

// ---------- Glossary / TM ----------
test('pre-pass: gợi ý tên riêng lặp lại; TM chỉ lấy chuỗi VERIFIED', () => {
  const src = JSON.stringify({
    c: { name: 'Lord Varek' },
    t: ['Defeat Lord Varek in Ashfall Keep.', 'Lord Varek rules Ashfall Keep.', 'You must hurry.'],
  });
  const es = classifyEntries(extractEntries(parseJson(src), 'p'));
  const cands = extractTermCandidates(es, []).map((c) => c.source);
  assert.ok(cands.includes('Lord Varek'), cands.join('|'));
  assert.ok(cands.includes('Ashfall Keep'), cands.join('|'));
  assert.ok(!cands.includes('You'));
  const tm = tmFromEntries([{ ...es[0], status: 'VERIFIED', verifiedLevel: 'AUTO', translation: 'Chúa Varek' }, { ...es[1], status: 'TRANSLATED', translation: 'x' }]);
  assert.equal(tm.length, 1);
});
