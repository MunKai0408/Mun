// Giao diện chính (SP-8.x). Chỉ nối UI với module thật; không chứa logic nghiệp vụ.
import type { ExcludeReason, GlossaryTerm, StringEntry, StringKind, EntryStatus } from '../contracts/types.js';
import { h, download, toast, fmt, pct, readFileText, pickFile } from './dom.js';
import {
  S, initStore, createProject, applyChanges, saveGlossary, saveCharacters, saveSettings, saveSecrets, startRun, startReview, reclassify,
  saveRules, buildTranslateFn, isBackup, type Tab,
} from './store.js';
import { parseJson, lineCol } from '../core/json/parse.js';
import { validateParsed } from '../core/json/validate.js';
import { computeProgress, checkCompleteness } from '../core/progress/progress.js';
import { estimateCost } from '../services/cost/cost.js';
import { exportVi, errorsCsv } from '../core/export/merge.js';
import { applyManualEdit, resolveClassifyReview } from '../core/state/edit.js';
import { transition } from '../core/state/state.js';
import { extractTermCandidates, findGlossaryConflicts, tmFromEntries } from '../core/glossary/glossary.js';
import { STYLE_GUIDE_VERSION } from '../contracts/defaults.js';
import { isReviewable } from '../core/review/review.js';
import type { ParseResult } from '../contracts/types.js';

const root = document.getElementById('app') as HTMLElement;

const TABS: [Tab, string, string][] = [
  ['dashboard', 'Tổng quan', '◔'], ['upload', 'Tải lên', '⇪'], ['editor', 'Biên tập', '✎'],
  ['glossary', 'Thuật ngữ', '☰'], ['export', 'Xuất', '⇩'], ['settings', 'Cài đặt', '⚙'],
];
const STATUS_LABEL: Record<EntryStatus, string> = {
  PENDING: 'Chưa dịch', TRANSLATING: 'Đang dịch', TRANSLATED: 'Đã dịch', QA_FAILED: 'Không đạt QA', RETRYING: 'Đang thử lại',
  REVIEW_REQUIRED: 'Cần xem', VERIFIED: 'Đạt', EXCLUDED: 'Loại trừ',
};
const REASON_LABEL: Record<ExcludeReason, string> = {
  EMPTY: 'Chuỗi rỗng', NO_LETTERS: 'Không có chữ', ID_OR_CODE: 'ID / mã kỹ thuật', PATH_OR_URL: 'Đường dẫn / URL', COLOR_OR_HEX: 'Mã màu',
  NUMERIC: 'Chỉ có số', ALREADY_VIETNAMESE: 'Đã là tiếng Việt', NOT_ENGLISH: 'Không phải tiếng Anh', USER_RULE: 'Luật của bạn',
  USER_MANUAL: 'Bạn chọn giữ nguyên', KEEP_AS_IS_GLOSSARY: 'Thuật ngữ giữ nguyên',
};
const KINDS: StringKind[] = ['UI', 'DIALOGUE', 'ITEM', 'SKILL', 'CHARACTER', 'QUEST', 'TUTORIAL', 'SYSTEM', 'DESCRIPTION', 'OTHER'];
const KIND_LABEL: Record<StringKind, string> = {
  UI: 'Giao diện', DIALOGUE: 'Hội thoại', ITEM: 'Vật phẩm', SKILL: 'Kỹ năng', CHARACTER: 'Nhân vật', QUEST: 'Nhiệm vụ',
  TUTORIAL: 'Hướng dẫn', SYSTEM: 'Hệ thống', DESCRIPTION: 'Mô tả', OTHER: 'Khác',
};

const btn = (label: string, onClick: () => void, cls = '', disabled = false) =>
  h('button', { type: 'button', class: `btn ${cls}`, disabled, on: { click: onClick as EventListener } }, label);
const badge = (text: string, cls = '') => h('span', { class: `badge ${cls}` }, text);
const card = (title: string | null, ...kids: Parameters<typeof h>[2][]) => h('section', { class: 'card' }, title ? h('h2', null, title) : null, ...kids);
const field = (label: string, input: HTMLElement, hint?: string) => h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), input, hint ? h('small', null, hint) : null);
const bar = (value: number, cls = '') => { const f = h('div', { class: `fill ${cls}` }); f.style.width = `${Math.max(0, Math.min(100, value))}%`; return h('div', { class: 'bar' }, f); };
const stat = (label: string, value: string | number, cls = '') => h('div', { class: `stat ${cls}` }, h('div', { class: 'v' }, typeof value === 'number' ? fmt(value) : value), h('div', { class: 'l' }, label));
const baseName = () => (S.meta?.fileName ?? 'en.json').replace(/\.json$/i, '');
const outName = () => (/^en$/i.test(baseName()) ? 'vi.json' : `${baseName()}.vi.json`);
const needProject = () => card(null, h('p', { class: 'muted' }, 'Chưa có dự án. Hãy tải lên file en.json trước.'), btn('Đến trang Tải lên', () => go('upload'), 'primary'));

function go(t: Tab) { S.tab = t; render(); window.scrollTo(0, 0); }

// ======================= TỔNG QUAN =======================
function pilotSample(n: number): Set<string> {
  const c = S.entries.filter((e) => e.status === 'PENDING' && !e.needsClassifyReview && !e.locked);
  const step = Math.max(1, Math.floor(c.length / n));
  const ids = new Set<string>();
  for (let i = 0; i < c.length && ids.size < n; i += step) ids.add(c[i]!.id);
  return ids;
}

async function requeueFailed() {
  const changed: StringEntry[] = [];
  for (const e of S.entries) {
    if ((e.status === 'QA_FAILED' || e.status === 'REVIEW_REQUIRED' || e.status === 'RETRYING') && !e.locked) {
      const { entry } = transition(e, 'PENDING', { retryCount: 0, qaHint: undefined, error: undefined, note: 'Người dùng đưa lại vào hàng đợi' });
      changed.push(entry);
    }
  }
  await applyChanges(changed, []);
  toast(`Đã đưa ${changed.length} chuỗi lỗi về hàng đợi.`, 'ok');
  render();
}

async function acceptPilot() {
  const done = S.pilotIds.map((id) => S.index.get(id)).filter((e): e is StringEntry => !!e && e.status === 'VERIFIED' && !!e.translation);
  const pick = done.sort((a, b) => a.original.length - b.original.length).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 8)) === 0).slice(0, 8);
  S.examples = pick.map((e) => ({ source: e.original, target: e.translation as string }));
  await S.storage.saveExamples(S.examples);
  await applyChanges(done.map((e) => ({ ...e, locked: true, verifiedLevel: 'HUMAN' as const })), []);
  S.pilotIds = [];
  toast(`Đã dùng ${S.examples.length} câu làm mẫu văn phong và khoá ${done.length} chuỗi pilot.`, 'ok');
  render();
}

function reviewCard(): HTMLElement {
  const R = S.review;
  const eligible = S.entries.filter(isReviewable).length;
  const last = R.last;
  return card('Kiểm tra chéo bằng AI (tuỳ chọn)',
    h('p', { class: 'muted small' }, `Một lượt AI thứ hai chấm nghĩa và độ tự nhiên trên mẫu ~10% (tối đa 200) trong ${fmt(eligible)} chuỗi đã đạt QA tự động. Chuỗi bị chấm thấp được đánh dấu "Cần xem"; bản dịch không bị sửa. Có tốn thêm chi phí API.`),
    h('div', { class: 'row wrap gap center' },
      R.running ? btn('■ Dừng', () => R.abort?.abort(), 'danger') : btn('Kiểm tra mẫu ngẫu nhiên', () => startReview(), 'primary', eligible === 0),
      R.running ? badge(`Đang kiểm tra ${R.done}/${R.total}`, 'info') : null),
    last && !R.running ? h('p', { class: last.flagged ? 'warnt' : 'okt' },
      `Lần gần nhất: ${last.reviewed}/${last.sampled} chuỗi được chấm; ${last.flagged} bị đánh dấu; điểm TB nghĩa ${last.avgAccuracy.toFixed(1)}/5, tự nhiên ${last.avgFluency.toFixed(1)}/5; ${last.costUsd.toFixed(3)} USD.`,
      last.missing ? ` Có ${last.missing} chuỗi AI không trả điểm.` : '',
      last.stoppedReason === 'budget' ? ' Dừng sớm vì chạm trần chi phí kiểm tra (20% trần ngân sách).' : '') : null);
}

function dashboardView(): HTMLElement {
  if (!S.meta) return h('div', null, needProject());
  const p = computeProgress(S.entries);
  const comp = checkCompleteness(S.entries);
  const est = estimateCost(S.entries, S.settings);
  const kinds = new Map<StringKind, number>();
  for (const e of S.entries) if (e.status !== 'EXCLUDED') kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);

  const controls = h('div', { class: 'row wrap gap' });
  if (!S.running) {
    controls.append(
      btn('▶ Dịch thử (pilot 40 chuỗi)', () => { const ids = pilotSample(40); S.pilotIds = [...ids]; startRun('pilot', ids); }, '', p.pending === 0),
      btn('▶▶ Dịch tất cả', () => startRun('all'), 'primary', p.pending + p.retrying === 0),
      btn('↻ Dịch lại chuỗi lỗi', () => void requeueFailed(), '', p.qaFailed + p.reviewRequired === 0),
    );
  } else {
    controls.append(
      S.paused ? btn('▶ Tiếp tục', () => { S.runner?.resume(); render(); }, 'primary') : btn('⏸ Tạm dừng', () => { S.runner?.pause(); render(); }),
      btn('■ Huỷ', () => { S.runner?.cancel(); }, 'danger'),
      badge(S.paused ? 'Đang tạm dừng' : 'Đang chạy…', S.paused ? 'warn' : 'info'),
    );
  }
  const pilotBox = S.pilotIds.length && !S.running && S.pilotIds.some((id) => S.index.get(id)?.status === 'VERIFIED')
    ? card('Pilot đã xong', h('p', null, 'Mở tab Biên tập để xem và sửa bản dịch thử. Hài lòng thì chấp nhận làm mẫu văn phong cho phần còn lại.'), h('div', { class: 'row gap' }, btn('Xem bản dịch', () => go('editor')), btn('Chấp nhận pilot làm mẫu', () => void acceptPilot(), 'primary')))
    : null;

  return h('div', { class: 'stack' },
    card('Tiến độ',
      h('div', { class: 'lbl-row' }, h('span', null, 'Đã dịch'), h('b', null, pct(p.translatedPct))), bar(p.translatedPct),
      h('div', { class: 'lbl-row' }, h('span', null, 'Đạt QA'), h('b', null, pct(p.verifiedPct))), bar(p.verifiedPct, 'ok'),
      h('div', { class: 'stats' },
        stat('Tổng chuỗi', p.total), stat('Chưa dịch', p.pending), stat('Đang xử lý', p.translating + p.retrying), stat('Đạt QA', p.verified, 'ok'),
        stat('Không đạt QA', p.qaFailed, p.qaFailed ? 'bad' : ''), stat('Cần xem', p.reviewRequired, p.reviewRequired ? 'warn' : ''),
        stat('Loại trừ', p.excluded), stat('Chờ phân loại', p.needsClassifyReview, p.needsClassifyReview ? 'warn' : '')),
      controls),
    pilotBox,
    p.needsClassifyReview ? card('Cần bạn xác nhận', h('p', null, `${p.needsClassifyReview} chuỗi chưa rõ là văn bản hay mã kỹ thuật, nên chưa được dịch.`), btn('Xem và xác nhận', () => go('upload'), 'primary')) : null,
    S.settings.qa.enableLlmReview && p.verified > 0 ? reviewCard() : null,
    card('Ước tính (chuỗi còn lại)',
      h('div', { class: 'stats' }, stat('Cần gửi AI', est.uniqueStrings), stat('Số lô', est.batches), stat('Token vào ≈', est.inputTokens), stat('Token ra ≈', est.outputTokens),
        stat('Chi phí ≈', est.costUsd === null ? 'nhập giá ở Cài đặt' : `${est.costUsd.toFixed(3)} USD`)),
      S.running || S.lastRun ? h('p', { class: 'muted' }, `Đã dùng: ${fmt(Math.round(S.lastRun?.inputTokens ?? 0))} token vào, ${fmt(Math.round(S.lastRun?.outputTokens ?? 0))} token ra, ${(S.lastRun?.costUsd ?? 0).toFixed(3)} USD (lần chạy gần nhất)`) : null),
    card('Theo loại chuỗi', h('div', { class: 'chips' }, [...kinds].sort((a, b) => b[1] - a[1]).map(([k, n]) => badge(`${KIND_LABEL[k]}: ${fmt(n)}`)))),
    card('Hoàn tất?', comp.canFinalize ? h('p', { class: 'okt' }, '✓ Đủ điều kiện xuất bản hoàn tất.') : h('ul', null, comp.blockers.map((b) => h('li', null, b)))),
    S.log.length ? card('Nhật ký', h('pre', { class: 'log' }, S.log.slice(-25).join('\n'))) : null,
    h('p', { class: 'muted small' },
      S.persistent ? 'Bộ nhớ trình duyệt đã được yêu cầu giữ lâu dài.' : 'Bộ nhớ trình duyệt có thể bị dọn nếu lâu không dùng.',
      ios ? ' Trên iPhone: hãy thêm vào Màn hình chính và sao lưu dự án thường xuyên (tab Xuất).' : ' Hãy sao lưu dự án thường xuyên (tab Xuất).'),
  );
}

// ======================= TẢI LÊN =======================
let pending: { name: string; text: string; parse: ParseResult } | null = null;

async function loadFile(f: File | null) {
  if (!f) return;
  try {
    const text = await readFileText(f);
    pending = { name: f.name, text, parse: parseJson(text) };
  } catch { toast('Không đọc được file.', 'err'); }
  render();
}

function topKeyBreakdown(p: ParseResult): [string, number][] {
  const m = new Map<string, number>();
  for (const s of p.strings) { const k = s.keyPath[0] ?? '(gốc)'; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, 12);
}

function reviewList(): HTMLElement | null {
  const rev = S.entries.filter((e) => e.status === 'PENDING' && e.needsClassifyReview);
  if (!rev.length) return null;
  const decide = async (list: StringEntry[], d: 'TRANSLATE' | 'KEEP') => { await applyChanges(list.map((e) => resolveClassifyReview(e, d)), []); render(); };
  return card(`Cần xác nhận phân loại (${rev.length})`,
    h('p', { class: 'muted' }, 'Các chuỗi này giống mã kỹ thuật nhưng cũng có thể là chữ cần dịch. Chúng sẽ không được dịch cho đến khi bạn quyết định.'),
    h('div', { class: 'row gap wrap' }, btn('Dịch tất cả', () => void decide(rev, 'TRANSLATE'), 'primary'), btn('Giữ nguyên tất cả', () => void decide(rev, 'KEEP'))),
    h('div', { class: 'list' }, rev.slice(0, 60).map((e) => h('div', { class: 'item' },
      h('div', { class: 'grow' }, h('code', null, e.original), h('small', { class: 'muted' }, ` ${e.pointer}`)),
      btn('Dịch', () => void decide([e], 'TRANSLATE')), btn('Giữ nguyên', () => void decide([e], 'KEEP'))))),
    rev.length > 60 ? h('p', { class: 'muted' }, `… và ${rev.length - 60} chuỗi nữa (dùng nút “tất cả”).`) : null);
}

function classificationView(): HTMLElement {
  const byReason = new Map<ExcludeReason, StringEntry[]>();
  for (const e of S.entries) if (e.status === 'EXCLUDED' && e.excludeReason) { const l = byReason.get(e.excludeReason) ?? []; l.push(e); byReason.set(e.excludeReason, l); }
  const kinds = new Map<StringKind, number>();
  for (const e of S.entries) if (e.status !== 'EXCLUDED') kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  const rule = { pointerRegex: h('input', { placeholder: 'vd: ^/debug/', class: 'mono' }), valueRegex: h('input', { placeholder: 'vd: ^\\[DEV\\]', class: 'mono' }), action: h('select', null, h('option', { value: 'EXCLUDE' }, 'Không dịch'), h('option', { value: 'TRANSLATE' }, 'Luôn dịch')) };
  return h('div', { class: 'stack' },
    card('Kết quả phân loại',
      h('div', { class: 'stats' }, stat('Cần dịch', S.entries.filter((e) => e.status !== 'EXCLUDED').length), stat('Loại trừ', S.entries.filter((e) => e.status === 'EXCLUDED').length)),
      h('div', { class: 'chips' }, [...kinds].map(([k, n]) => badge(`${KIND_LABEL[k]}: ${fmt(n)}`))),
      h('h3', null, 'Chuỗi bị loại trừ (không dịch)'),
      [...byReason].map(([r, list]) => h('details', null, h('summary', null, `${REASON_LABEL[r]} — ${fmt(list.length)}`),
        h('div', { class: 'list' }, list.slice(0, 30).map((e) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('code', null, e.original.slice(0, 120)), h('small', { class: 'muted' }, ` ${e.pointer}`)),
          btn('Vẫn dịch', () => { void applyChanges([transition(e, 'PENDING', { note: 'Người dùng gỡ loại trừ' }).entry], []).then(render); })))),
        list.length > 30 ? h('p', { class: 'muted' }, `… và ${list.length - 30} chuỗi nữa`) : null))),
    reviewList(),
    card('Luật phân loại của bạn',
      S.rules.length ? h('div', { class: 'list' }, S.rules.map((r, i) => h('div', { class: 'item' }, h('div', { class: 'grow mono small' }, `${r.action === 'EXCLUDE' ? 'Không dịch' : 'Luôn dịch'} • đường dẫn: ${r.pointerRegex ?? '—'} • giá trị: ${r.valueRegex ?? '—'}`), btn('Xoá', () => { S.rules.splice(i, 1); saveRules(); render(); })))) : h('p', { class: 'muted' }, 'Chưa có luật.'),
      h('div', { class: 'grid2' }, field('Regex đường dẫn', rule.pointerRegex), field('Regex giá trị', rule.valueRegex), field('Hành động', rule.action)),
      h('div', { class: 'row gap' }, btn('Thêm luật', () => {
        const pr = (rule.pointerRegex as HTMLInputElement).value.trim(); const vr = (rule.valueRegex as HTMLInputElement).value.trim();
        if (!pr && !vr) { toast('Nhập ít nhất một regex.', 'err'); return; }
        try { if (pr) new RegExp(pr); if (vr) new RegExp(vr, 'u'); } catch { toast('Regex không hợp lệ.', 'err'); return; }
        S.rules.push({ id: 'r' + Date.now(), ...(pr ? { pointerRegex: pr } : {}), ...(vr ? { valueRegex: vr } : {}), action: (rule.action as HTMLSelectElement).value as 'EXCLUDE' | 'TRANSLATE' }); saveRules(); render();
      }), btn('Áp dụng luật (phân loại lại)', () => void reclassify().then((n) => { toast(`Đã cập nhật ${n} chuỗi.`, 'ok'); render(); }), 'primary'))),
  );
}

function uploadView(): HTMLElement {
  const drop = h('div', { class: 'drop', tabindex: '0', on: {
    dragover: ((e: DragEvent) => { e.preventDefault(); drop.classList.add('over'); }) as EventListener,
    dragleave: (() => drop.classList.remove('over')) as EventListener,
    drop: ((e: DragEvent) => { e.preventDefault(); drop.classList.remove('over'); void loadFile(e.dataTransfer?.files?.[0] ?? null); }) as EventListener,
  } }, h('div', { class: 'big' }, '⇪'), h('div', null, 'Kéo thả file en.json vào đây'), h('div', { class: 'muted' }, 'hoặc'),
  btn('Chọn file', () => void pickFile('.json,application/json').then(loadFile), 'primary'));

  const parts: Parameters<typeof h>[2][] = [card('Tải file en.json', drop)];
  if (pending) {
    const v = validateParsed(pending.parse);
    const p = pending.parse;
    parts.push(card(`File: ${pending.name}`,
      h('div', { class: 'stats' }, stat('Kích thước', `${(pending.text.length / 1024).toFixed(1)} KB`), stat('Số chuỗi', p.strings.length), stat('Độ sâu', p.maxDepth), stat('Xuống dòng', p.newline), stat('BOM', p.hasBom ? 'có' : 'không')),
      v.ok ? h('p', { class: 'okt' }, '✓ JSON hợp lệ.') : h('p', { class: 'badt' }, '✗ JSON không hợp lệ — hãy sửa file rồi tải lại.'),
      v.issues.length ? h('ul', null, v.issues.slice(0, 20).map((i) => {
        const line = pending!.text.split(/\r\n|\n|\r/)[i.line - 1] ?? '';
        return h('li', { class: i.severity === 'BLOCKER' ? 'badt' : 'warnt' }, `[${i.severity}] dòng ${i.line}, cột ${i.column}: ${i.message}`, !v.ok && line ? h('pre', { class: 'snippet' }, line.slice(Math.max(0, i.column - 40), i.column + 40)) : null);
      })) : null,
      v.ok ? h('div', null, h('h3', null, 'Xem trước cấu trúc (số chuỗi theo key cấp 1)'), h('div', { class: 'chips' }, topKeyBreakdown(p).map(([k, n]) => badge(`${k}: ${fmt(n)}`)))) : null,
      v.ok ? btn(S.meta ? 'Thay dự án hiện tại bằng file này' : 'Tạo dự án và phân loại chuỗi', async () => {
        if (S.meta && !confirm('Thay thế dự án hiện tại? Tiến độ cũ sẽ mất (hãy sao lưu trước nếu cần).')) return;
        const r = await createProject(pending!.name, pending!.text);
        if (!r.ok) { toast(r.message ?? 'Lỗi', 'err'); return; }
        pending = null; toast('Đã tạo dự án.', 'ok'); render();
      }, 'primary') : null));
  }
  if (S.meta) {
    parts.push(card(`Dự án hiện tại: ${S.meta.fileName}`, h('p', { class: 'muted' }, `${fmt(S.entries.length)} chuỗi • tạo lúc ${new Date(S.meta.createdAt).toLocaleString('vi-VN')}`),
      h('div', { class: 'row gap wrap' },
        btn('Sao lưu dự án', () => void backup()), btn('Khôi phục từ bản sao lưu', () => void restore()))));
    parts.push(classificationView());
  } else {
    parts.push(card('Khôi phục', h('p', { class: 'muted' }, 'Có bản sao lưu dự án (.json) từ trước?'), btn('Khôi phục từ bản sao lưu', () => void restore())));
  }
  return h('div', { class: 'stack' }, ...parts);
}

async function backup() {
  const b = await S.storage.exportBackup();
  if (!b) { toast('Chưa có dự án để sao lưu.', 'err'); return; }
  download(`${baseName()}-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b));
  toast('Đã tạo bản sao lưu.', 'ok');
}
async function restore() {
  const f = await pickFile('.json,application/json');
  if (!f) return;
  try {
    const data: unknown = JSON.parse(await readFileText(f));
    if (!isBackup(data)) { toast('File không phải bản sao lưu của công cụ này.', 'err'); return; }
    if (S.meta && !confirm('Khôi phục sẽ thay thế dự án hiện tại. Tiếp tục?')) return;
    await S.storage.importBackup(data);
    S.meta = data.meta; S.parse = parseJson(data.meta.source); S.entries = data.entries; S.glossary = data.glossary ?? []; S.characters = data.characters ?? []; S.examples = data.examples ?? [];
    S.index = new Map(S.entries.map((e) => [e.id, e]));
    S.tm = new Map((data.tm ?? []).map((r) => [r.key, r]));
    toast('Đã khôi phục dự án.', 'ok'); render();
  } catch (e) { toast('Không khôi phục được: ' + (e as Error).message, 'err'); }
}

// ======================= BIÊN TẬP =======================
const F = { status: '', kind: '', q: '', preset: 'all', page: 0 };
const PAGE = 40;
const acceptWarn = new Set<string>();

function filtered(): StringEntry[] {
  const q = F.q.trim().toLowerCase();
  return S.entries.filter((e) => {
    if (F.preset === 'review' && !(e.status === 'REVIEW_REQUIRED' || e.status === 'QA_FAILED')) return false;
    if (F.preset === 'pending' && e.status !== 'PENDING') return false;
    if (F.preset === 'verified' && e.status !== 'VERIFIED') return false;
    if (F.preset === 'warn' && !(e.qa?.issues.some((i) => i.severity !== 'INFO'))) return false;
    if (F.status && e.status !== F.status) return false;
    if (F.kind && e.kind !== F.kind) return false;
    if (q && !(e.original.toLowerCase().includes(q) || (e.translation ?? '').toLowerCase().includes(q) || e.pointer.toLowerCase().includes(q))) return false;
    return true;
  });
}

function rowView(e: StringEntry): HTMLElement {
  const ta = h('textarea', { rows: Math.min(8, Math.max(2, Math.ceil((e.translation ?? e.original).length / 50))), value: e.translation ?? '', placeholder: 'Chưa có bản dịch…', 'aria-label': 'Bản dịch tiếng Việt', spellcheck: 'false' });
  const issues = (e.qa?.issues ?? []).filter((i) => i.severity !== 'INFO');
  const statusCls = e.status === 'VERIFIED' ? 'ok' : e.status === 'QA_FAILED' || e.status === 'REVIEW_REQUIRED' ? 'bad' : e.status === 'EXCLUDED' ? '' : 'info';
  const save = async () => {
    const { entry, audit } = applyManualEdit(e, ta.value, { glossary: S.glossary, settings: S.settings.qa }, { acceptWithWarnings: acceptWarn.has(e.id) });
    await applyChanges([entry], audit);
    toast(entry.status === 'VERIFIED' ? 'Đã lưu.' : 'Đã lưu nhưng còn lỗi QA — xem chi tiết bên dưới.', entry.status === 'VERIFIED' ? 'ok' : 'err');
    render();
  };
  return h('article', { class: `row-card ${e.status.toLowerCase()}` },
    h('div', { class: 'row gap wrap meta' }, badge(STATUS_LABEL[e.status], statusCls), badge(KIND_LABEL[e.kind]), e.locked ? badge('🔒 Đã khoá') : null, e.verifiedLevel === 'HUMAN' ? badge('Người duyệt', 'ok') : null,
      e.translationSource === 'TM' ? badge('Từ TM') : null, h('code', { class: 'ptr' }, e.pointer)),
    h('div', { class: 'orig' }, e.original),
    e.status === 'EXCLUDED' ? h('p', { class: 'muted' }, `Không dịch: ${e.excludeReason ? REASON_LABEL[e.excludeReason] : ''}`) : ta,
    issues.length ? h('ul', { class: 'issues' }, issues.map((i) => h('li', { class: i.severity === 'BLOCKER' ? 'badt' : 'warnt' }, `${i.severity}: ${i.message}`))) : null,
    e.error && (e.status === 'QA_FAILED' || e.status === 'REVIEW_REQUIRED') && !issues.length ? h('p', { class: 'badt' }, e.error.message) : null,
    h('div', { class: 'row gap wrap' },
      e.status !== 'EXCLUDED' ? btn('Lưu', () => void save(), 'primary') : btn('Vẫn dịch chuỗi này', () => { void applyChanges([transition(e, 'PENDING').entry], []).then(render); }),
      e.status !== 'EXCLUDED' ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: acceptWarn.has(e.id), on: { change: ((ev: Event) => { (ev.target as HTMLInputElement).checked ? acceptWarn.add(e.id) : acceptWarn.delete(e.id); }) as EventListener } }), 'Chấp nhận dù có cảnh báo') : null,
      e.status !== 'EXCLUDED' && e.status !== 'PENDING' ? btn('Dịch lại', () => { void applyChanges([{ ...transition(e, 'PENDING', { retryCount: 0 }).entry, locked: false }], []).then(render); }) : null,
      btn(e.locked ? 'Mở khoá' : 'Khoá', () => { void applyChanges([{ ...e, locked: !e.locked }], []).then(render); }),
      e.status !== 'EXCLUDED' ? btn('Giữ nguyên (loại trừ)', () => { void applyChanges([transition(e, 'EXCLUDED', { excludeReason: 'USER_MANUAL', translation: null, qa: null }).entry], []).then(render); }) : null));
}

function editorView(): HTMLElement {
  if (!S.meta) return h('div', null, needProject());
  const list = filtered();
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  F.page = Math.min(F.page, pages - 1);
  const rows = list.slice(F.page * PAGE, F.page * PAGE + PAGE);
  const sel = (opts: [string, string][], val: string, onChange: (v: string) => void) => h('select', { on: { change: ((e: Event) => onChange((e.target as HTMLSelectElement).value)) as EventListener } }, opts.map(([v, l]) => h('option', { value: v, selected: v === val }, l)));
  const preset = (id: string, label: string) => h('button', { type: 'button', class: `chip ${F.preset === id ? 'on' : ''}`, on: { click: (() => { F.preset = id; F.page = 0; render(); }) as EventListener } }, label);
  const search = h('input', { type: 'search', placeholder: 'Tìm trong bản gốc, bản dịch, đường dẫn…', value: F.q, 'aria-label': 'Tìm kiếm', on: { keydown: ((e: KeyboardEvent) => { if (e.key === 'Enter') { F.q = (e.target as HTMLInputElement).value; F.page = 0; render(); } }) as EventListener, change: ((e: Event) => { F.q = (e.target as HTMLInputElement).value; F.page = 0; render(); }) as EventListener } });
  return h('div', { class: 'stack' },
    card(null,
      h('div', { class: 'chips' }, preset('all', 'Tất cả'), preset('review', 'Cần xem'), preset('warn', 'Có cảnh báo'), preset('pending', 'Chưa dịch'), preset('verified', 'Đã đạt')),
      h('div', { class: 'grid3' }, search,
        sel([['', 'Mọi trạng thái'], ...(Object.entries(STATUS_LABEL) as [string, string][])], F.status, (v) => { F.status = v; F.page = 0; render(); }),
        sel([['', 'Mọi loại'], ...KINDS.map((k) => [k, KIND_LABEL[k]] as [string, string])], F.kind, (v) => { F.kind = v; F.page = 0; render(); })),
      h('p', { class: 'muted small' }, `${fmt(list.length)} chuỗi khớp bộ lọc`)),
    ...rows.map(rowView),
    list.length === 0 ? card(null, h('p', { class: 'muted' }, 'Không có chuỗi nào khớp.')) : null,
    h('div', { class: 'row gap center' }, btn('‹ Trước', () => { F.page--; render(); window.scrollTo(0, 0); }, '', F.page === 0), h('span', null, `Trang ${F.page + 1}/${pages}`), btn('Sau ›', () => { F.page++; render(); window.scrollTo(0, 0); }, '', F.page >= pages - 1)),
  );
}

// ======================= THUẬT NGỮ =======================
let candidates: ReturnType<typeof extractTermCandidates> = [];

function glossaryView(): HTMLElement {
  const nw = { source: h('input', { placeholder: 'Từ gốc (EN)' }), target: h('input', { placeholder: 'Bản dịch (VI)' }), cat: h('select', null, ...(['GENERAL', 'CHARACTER', 'ITEM', 'SKILL', 'LOCATION', 'UI'] as const).map((c) => h('option', { value: c }, c))), keep: h('input', { type: 'checkbox' }), cs: h('input', { type: 'checkbox' }) };
  const add = async () => {
    const source = (nw.source as HTMLInputElement).value.trim(); const target = (nw.target as HTMLInputElement).value.trim(); const keepAsIs = (nw.keep as HTMLInputElement).checked;
    if (!source || (!target && !keepAsIs)) { toast('Nhập từ gốc và bản dịch (hoặc chọn "giữ nguyên").', 'err'); return; }
    S.glossary.push({ id: 'g' + Date.now() + Math.random().toString(36).slice(2, 5), source, target, category: (nw.cat as HTMLSelectElement).value as GlossaryTerm['category'], keepAsIs, caseSensitive: (nw.cs as HTMLInputElement).checked });
    await saveGlossary(); render();
  };
  const conflicts = findGlossaryConflicts(S.glossary);
  const edit = <K extends keyof GlossaryTerm>(t: GlossaryTerm, k: K, v: GlossaryTerm[K]) => { t[k] = v; void S.storage.saveGlossary(S.glossary); };
  const rowFor = (t: GlossaryTerm) => h('div', { class: 'term' },
    h('input', { value: t.source, 'aria-label': 'Từ gốc', on: { change: ((e: Event) => edit(t, 'source', (e.target as HTMLInputElement).value)) as EventListener } }),
    h('input', { value: t.target, disabled: t.keepAsIs, 'aria-label': 'Bản dịch', on: { change: ((e: Event) => edit(t, 'target', (e.target as HTMLInputElement).value)) as EventListener } }),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: t.keepAsIs, on: { change: ((e: Event) => { edit(t, 'keepAsIs', (e.target as HTMLInputElement).checked); render(); }) as EventListener } }), 'Giữ nguyên'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: t.caseSensitive, on: { change: ((e: Event) => edit(t, 'caseSensitive', (e.target as HTMLInputElement).checked)) as EventListener } }), 'Phân biệt hoa/thường'),
    btn('Xoá', () => { S.glossary = S.glossary.filter((x) => x.id !== t.id); void saveGlossary().then(render); }, 'danger'));

  const chars = { name: h('input', { placeholder: 'Tên nhân vật' }), vi: h('input', { placeholder: 'Tên tiếng Việt (nếu có)' }), self: h('input', { placeholder: 'Tự xưng (tôi/ta/tao…)' }), addr: h('input', { placeholder: 'Gọi người khác: Aria=cô; Kael=anh' }), voice: h('input', { placeholder: 'Giọng điệu (lạnh lùng, hài hước…)' }) };
  return h('div', { class: 'stack' },
    card('Bảng thuật ngữ', h('p', { class: 'muted' }, `Thuật ngữ được áp dụng bắt buộc khi dịch và khi kiểm tra QA. ${S.glossary.length} mục.`),
      conflicts.length ? h('ul', { class: 'warnt' }, conflicts.map((c) => h('li', null, c))) : null,
      h('div', { class: 'terms' }, S.glossary.map(rowFor)),
      h('h3', null, 'Thêm thuật ngữ'),
      h('div', { class: 'grid3' }, nw.source, nw.target, nw.cat),
      h('div', { class: 'row gap wrap' }, h('label', { class: 'check' }, nw.keep, 'Giữ nguyên (không dịch)'), h('label', { class: 'check' }, nw.cs, 'Phân biệt hoa/thường'), btn('Thêm', () => void add(), 'primary')),
      h('div', { class: 'row gap wrap' },
        btn('Xuất JSON', () => download('glossary.json', JSON.stringify(S.glossary, null, 2))),
        btn('Nhập JSON', async () => { const f = await pickFile('.json'); if (!f) return; try { const d = JSON.parse(await readFileText(f)) as GlossaryTerm[]; if (!Array.isArray(d)) throw new Error('không phải mảng'); const have = new Set(S.glossary.map((g) => g.source.toLowerCase())); for (const t of d) if (t && typeof t.source === 'string' && !have.has(t.source.toLowerCase())) S.glossary.push({ id: 'g' + Math.random().toString(36).slice(2), source: t.source, target: String(t.target ?? ''), category: t.category ?? 'GENERAL', keepAsIs: !!t.keepAsIs, caseSensitive: !!t.caseSensitive }); await saveGlossary(); render(); } catch (e) { toast('File không hợp lệ: ' + (e as Error).message, 'err'); } }))),
    card('Quét thuật ngữ (Pre-pass)',
      h('p', { class: 'muted' }, 'Tìm tên riêng và cụm từ viết hoa lặp lại trong file để bạn chốt cách dịch TRƯỚC khi dịch hàng loạt — giúp bản dịch nhất quán.'),
      btn('Quét file', () => { candidates = extractTermCandidates(S.entries, S.glossary); if (!candidates.length) toast('Không tìm thấy ứng viên mới.', 'info'); render(); }, 'primary', !S.meta),
      candidates.length ? h('div', { class: 'terms' }, candidates.slice(0, 80).map((c) => {
        const inp = h('input', { placeholder: 'Bản dịch…', 'aria-label': `Bản dịch cho ${c.source}` });
        return h('div', { class: 'term' }, h('div', { class: 'grow' }, h('b', null, c.source), h('small', { class: 'muted' }, ` ×${c.count} • ${c.kinds.map((k) => KIND_LABEL[k]).join(', ')}`)), inp,
          btn('Thêm', () => { const t = (inp as HTMLInputElement).value.trim(); if (!t) { toast('Nhập bản dịch hoặc dùng “Giữ nguyên”.', 'err'); return; } S.glossary.push({ id: 'g' + Math.random().toString(36).slice(2), source: c.source, target: t, category: c.kinds[0] === 'CHARACTER' ? 'CHARACTER' : c.kinds[0] === 'ITEM' ? 'ITEM' : c.kinds[0] === 'SKILL' ? 'SKILL' : 'GENERAL', keepAsIs: false, caseSensitive: false }); candidates = candidates.filter((x) => x !== c); void saveGlossary().then(render); }),
          btn('Giữ nguyên', () => { S.glossary.push({ id: 'g' + Math.random().toString(36).slice(2), source: c.source, target: '', category: c.suggestKeep ? 'CHARACTER' : 'GENERAL', keepAsIs: true, caseSensitive: true }); candidates = candidates.filter((x) => x !== c); void saveGlossary().then(render); }));
      })) : null),
    card('Hồ sơ nhân vật (xưng hô)',
      h('p', { class: 'muted' }, 'Giúp hội thoại xưng hô nhất quán. Chỉ nhân vật có tên xuất hiện trong lô đang dịch mới được gửi cho AI.'),
      S.characters.map((c) => h('div', { class: 'item' }, h('div', { class: 'grow' }, h('b', null, c.name), c.viName ? ` → ${c.viName}` : '', h('small', { class: 'muted' }, ` ${[c.selfPronoun && `xưng "${c.selfPronoun}"`, c.voice].filter(Boolean).join(' • ')}`)), btn('Xoá', () => { S.characters = S.characters.filter((x) => x.id !== c.id); void saveCharacters().then(render); }, 'danger'))),
      h('div', { class: 'grid2' }, chars.name, chars.vi, chars.self, chars.voice), chars.addr,
      btn('Thêm nhân vật', () => {
        const name = (chars.name as HTMLInputElement).value.trim(); if (!name) { toast('Nhập tên nhân vật.', 'err'); return; }
        const addressMap: Record<string, string> = {};
        for (const part of (chars.addr as HTMLInputElement).value.split(/[;,]/)) { const [k, v] = part.split('='); if (k?.trim() && v?.trim()) addressMap[k.trim()] = v.trim(); }
        S.characters.push({ id: 'c' + Date.now(), name, ...((chars.vi as HTMLInputElement).value.trim() ? { viName: (chars.vi as HTMLInputElement).value.trim() } : {}), ...((chars.self as HTMLInputElement).value.trim() ? { selfPronoun: (chars.self as HTMLInputElement).value.trim() } : {}), ...((chars.voice as HTMLInputElement).value.trim() ? { voice: (chars.voice as HTMLInputElement).value.trim() } : {}), ...(Object.keys(addressMap).length ? { addressMap } : {}) });
        void saveCharacters().then(render);
      }, 'primary')),
    card('Translation Memory', h('p', { class: 'muted' }, `${fmt(S.tm.size)} bản dịch đã xác nhận được tái sử dụng (khớp chính xác theo nội dung + loại chuỗi).`),
      h('div', { class: 'row gap wrap' }, btn('Xuất TM', () => download('translation-memory.json', JSON.stringify([...S.tm.values()], null, 2))), btn('Tạo TM từ dự án', async () => { const recs = tmFromEntries(S.entries); for (const r of recs) S.tm.set(r.key, r); await S.storage.putTm(recs); toast(`Đã lưu ${recs.length} mục.`, 'ok'); render(); }, '', !S.meta))),
  );
}

// ======================= XUẤT =======================
function glyphCheck(): string {
  const set = new Set<string>();
  for (const e of S.entries) if (e.translation && (e.status === 'TRANSLATED' || e.status === 'VERIFIED')) for (const ch of e.translation.normalize('NFC')) if (/[^\u0000-\u007f]/.test(ch) && /\p{L}/u.test(ch)) set.add(ch);
  return [...set].sort().join(' ');
}

function exportView(): HTMLElement {
  if (!S.meta || !S.parse) return h('div', null, needProject());
  const comp = checkCompleteness(S.entries);
  const { text: finalText, report } = exportVi(S.parse, S.entries);
  const english = S.entries.filter((e) => e.status !== 'EXCLUDED' && !(e.status === 'TRANSLATED' || e.status === 'VERIFIED')).length;
  const canFinal = comp.canFinalize && report.ok;
  const yn = (v: boolean) => (v ? '✓' : '✗');
  const glyphs = glyphCheck();
  return h('div', { class: 'stack' },
    card('Kiểm tra trước khi xuất',
      comp.canFinalize ? h('p', { class: 'okt' }, '✓ Hoàn tất: mọi chuỗi đã xử lý.') : h('ul', null, comp.blockers.map((b) => h('li', { class: 'warnt' }, b))),
      h('h3', null, 'Kiểm tra file xuất'),
      h('ul', { class: 'checks' },
        [['Cú pháp JSON hợp lệ', report.ok || report.keySetEqual], ['Giữ nguyên toàn bộ key', report.keySetEqual], ['Giữ nguyên cấu trúc', report.structureEqual], ['Số chuỗi khớp', report.stringCountEqual], ['Phần không dịch không đổi', report.untouchedEqual], ['Placeholder đầy đủ', report.placeholdersOk], ['Thẻ/format đầy đủ', report.tagsOk], ['Khôi phục đúng bản gốc khi không dịch (round-trip)', report.identityRoundTripOk]]
          .map(([l, v]) => h('li', { class: v ? 'okt' : 'badt' }, `${yn(v as boolean)} ${l}`))),
      report.issues.length ? h('ul', { class: 'badt' }, report.issues.slice(0, 10).map((i) => h('li', null, i))) : null),
    card('Tải về',
      h('div', { class: 'row gap wrap' },
        btn(`⇩ Tải ${outName()} (hoàn tất)`, () => { download(outName(), finalText); toast('Đã tải file.', 'ok'); }, 'primary', !canFinal),
        btn(`Tải bản tạm (${fmt(english)} chuỗi còn tiếng Anh)`, () => { download(outName().replace(/\.json$/, '.partial.json'), finalText); }, '', !report.ok)),
      !canFinal ? h('p', { class: 'muted small' }, 'Nút “hoàn tất” chỉ bật khi không còn chuỗi chưa dịch/lỗi và file xuất qua mọi kiểm tra. Bản tạm giữ nguyên tiếng Anh cho chuỗi chưa xong.') : null,
      h('div', { class: 'row gap wrap' },
        btn('Danh sách chuỗi lỗi (CSV)', () => download('loi.csv', errorsCsv(S.entries), 'text/csv;charset=utf-8')),
        btn('Báo cáo tiến độ (JSON)', () => download('bao-cao.json', JSON.stringify({ at: new Date().toISOString(), file: S.meta?.fileName, progress: computeProgress(S.entries), completeness: comp, exportValidation: report }, null, 2))),
        btn('Glossary (JSON)', () => download('glossary.json', JSON.stringify(S.glossary, null, 2))),
        btn('Translation Memory (JSON)', () => download('translation-memory.json', JSON.stringify([...S.tm.values()], null, 2))),
        btn('Sao lưu dự án', () => void backup()))),
    card('Kiểm tra phông chữ tiếng Việt', h('p', { class: 'muted' }, 'Game phải dùng phông chữ có đủ các ký tự có dấu sau (nếu thiếu, chữ sẽ hiện ô vuông):'), h('p', { class: 'glyphs' }, glyphs || '— chưa có bản dịch —')),
  );
}

// ======================= CÀI ĐẶT =======================
function settingsView(): HTMLElement {
  const st = S.settings;
  const num = (label: string, get: () => number | null, set: (n: number | null) => void, opts: { step?: string; min?: string; nullable?: boolean; hint?: string } = {}) => {
    const i = h('input', { type: 'number', value: get() ?? '', step: opts.step ?? '1', min: opts.min ?? '0', inputmode: 'decimal' });
    i.addEventListener('change', () => { const v = (i as HTMLInputElement).value.trim(); set(v === '' ? (opts.nullable ? null : get()) : Number(v)); void saveSettings(); });
    return field(label, i, opts.hint);
  };
  const mode = h('select', { 'aria-label': 'Chế độ gọi AI', on: { change: ((e: Event) => { st.keyMode = (e.target as HTMLSelectElement).value as typeof st.keyMode; void saveSettings(); render(); }) as EventListener } },
    h('option', { value: 'DIRECT', selected: st.keyMode === 'DIRECT' }, 'Trực tiếp: trình duyệt gọi AI bằng key của tôi (GitHub Pages)'),
    h('option', { value: 'SERVER', selected: st.keyMode === 'SERVER' }, 'Máy chủ Netlify giữ key (cần Token truy cập)'),
    h('option', { value: 'BYO', selected: st.keyMode === 'BYO' }, 'Qua máy chủ Netlify nhưng dùng key của tôi'));
  const provider = h('select', { on: { change: ((e: Event) => { st.provider = (e.target as HTMLSelectElement).value as typeof st.provider; void saveSettings(); render(); }) as EventListener } },
    h('option', { value: 'anthropic', selected: st.provider === 'anthropic' }, 'Anthropic (Claude)'), h('option', { value: 'openai', selected: st.provider === 'openai' }, 'OpenAI hoặc tương thích (OpenRouter, Groq…)'));
  const key = h('input', { type: 'password', value: S.secrets.apiKey, autocomplete: 'off', placeholder: 'sk-…', on: { change: ((e: Event) => { S.secrets.apiKey = (e.target as HTMLInputElement).value.trim(); saveSecrets(); }) as EventListener } });
  const tok = h('input', { type: 'password', value: S.secrets.accessToken, autocomplete: 'off', placeholder: 'Token do chủ site đặt (ACCESS_TOKEN)', on: { change: ((e: Event) => { S.secrets.accessToken = (e.target as HTMLInputElement).value.trim(); saveSecrets(); }) as EventListener } });
  const testOut = h('pre', { class: 'log hidden' });
  const test = async () => {
    testOut.classList.remove('hidden'); testOut.textContent = 'Đang thử…';
    const need = st.keyMode === 'SERVER' ? S.secrets.accessToken : S.secrets.apiKey;
    if (!need) { testOut.textContent = '✗ Chưa nhập key/token.'; return; }
    try {
      const t0 = Date.now();
      const r = await buildTranslateFn()({ projectId: 'test', batchId: 'test', items: [{ id: 't1', text: 'Hello, adventurer! You found {0} gold.', kind: 'UI' }], glossary: [], styleGuideVersion: STYLE_GUIDE_VERSION, ...(st.model ? { options: { model: st.model } } : {}) }, { timeoutMs: st.timeoutMs });
      testOut.textContent = `✓ Kết nối được (${Date.now() - t0}ms) • ${r.provider}/${r.model}\n→ ${r.results[0]?.translation ?? '(không có kết quả)'}`;
    } catch (e) { const er = e as { message?: string; code?: string }; testOut.textContent = `✗ ${er.code ?? ''} ${er.message ?? String(e)}`; }
  };
  return h('div', { class: 'stack' },
    card('Kết nối AI',
      field('Chế độ', mode),
      st.keyMode === 'DIRECT' ? h('p', { class: 'muted small' }, 'API key chỉ được giữ trong trình duyệt này và gửi thẳng tới nhà cung cấp AI, không qua máy chủ nào khác. Chỉ dùng trên thiết bị của bạn.') : null,
      field('Nhà cung cấp', provider),
      st.provider === 'openai' ? field('Base URL (tuỳ chọn)', h('input', { value: st.baseUrl, placeholder: 'https://api.openai.com/v1', on: { change: ((e: Event) => { st.baseUrl = (e.target as HTMLInputElement).value.trim(); void saveSettings(); }) as EventListener } })) : null,
      field('Model', h('input', { value: st.model, placeholder: st.provider === 'anthropic' ? 'mặc định: claude-sonnet-5-5' : 'mặc định: gpt-4o-mini', on: { change: ((e: Event) => { st.model = (e.target as HTMLInputElement).value.trim(); void saveSettings(); }) as EventListener } })),
      st.keyMode === 'SERVER' ? field('Token truy cập', tok) : field('API key', key),
      st.keyMode !== 'SERVER'
        ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.secrets.rememberKey, on: { change: ((e: Event) => { S.secrets.rememberKey = (e.target as HTMLInputElement).checked; saveSecrets(); }) as EventListener } }), 'Ghi nhớ key trên thiết bị này (không khuyến nghị trên máy dùng chung)')
        : h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.secrets.rememberToken, on: { change: ((e: Event) => { S.secrets.rememberToken = (e.target as HTMLInputElement).checked; saveSecrets(); }) as EventListener } }), 'Ghi nhớ token trên thiết bị này'),
      btn('Kiểm tra kết nối', () => void test(), 'primary'), testOut),
    card('Lô dịch & thử lại',
      h('div', { class: 'grid2' },
        num('Số chuỗi tối đa mỗi lô', () => st.batch.maxItems, (n) => { st.batch.maxItems = Math.max(1, n ?? 20); }, { min: '1' }),
        num('Số ký tự tối đa mỗi lô', () => st.batch.maxChars, (n) => { st.batch.maxChars = Math.max(200, n ?? 3500); }, { min: '200' }),
        num('Số lô chạy song song', () => st.batch.concurrency, (n) => { st.batch.concurrency = Math.min(8, Math.max(1, n ?? 2)); }, { min: '1', hint: 'Tăng nếu nhà cung cấp cho phép; giảm nếu hay gặp lỗi 429.' }),
        num('Số lần thử lại tối đa', () => st.retry.max, (n) => { st.retry.max = Math.max(0, n ?? 3); }),
        num('Chờ thử lại cơ bản (ms)', () => st.retry.baseDelayMs, (n) => { st.retry.baseDelayMs = Math.max(0, n ?? 1000); }, { step: '100' }),
        num('Timeout mỗi lời gọi (ms)', () => st.timeoutMs, (n) => { st.timeoutMs = Math.max(3000, n ?? 28000); }, { step: '1000', hint: 'Netlify có thể ngắt sớm (~10s). Nếu gặp lỗi 504, hãy giảm số chuỗi mỗi lô.' }))),
    card('Quy tắc QA',
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.qa.enableLlmReview, on: { change: ((e: Event) => { st.qa.enableLlmReview = (e.target as HTMLInputElement).checked; void saveSettings(); render(); }) as EventListener } }), 'Bật kiểm tra chéo bằng AI (SP-6.4, tốn thêm chi phí)'),
      st.qa.enableLlmReview ? field('Mô hình kiểm tra (tuỳ chọn)', h('input', { value: st.qa.reviewModel ?? '', placeholder: 'Để trống = dùng cùng mô hình dịch', on: { change: ((e: Event) => { st.qa.reviewModel = (e.target as HTMLInputElement).value.trim(); void saveSettings(); }) as EventListener } }), 'Nên dùng mô hình khác lúc dịch để có góc nhìn độc lập.') : null,
      num('Tỷ lệ độ dài tối đa (dịch/gốc)', () => st.qa.maxLengthRatio, (n) => { st.qa.maxLengthRatio = Math.max(1, n ?? 1.8); }, { step: '0.1', hint: 'Chuỗi giao diện ngắn vượt tỷ lệ này bị coi là lỗi (dễ tràn nút bấm).' })),
    card('Chi phí',
      h('div', { class: 'grid3' },
        num('Trần ngân sách (USD)', () => st.budget.capUsd, (n) => { st.budget.capUsd = n; }, { step: '0.5', nullable: true, hint: 'Để trống = không giới hạn. Chạm trần sẽ tự tạm dừng.' }),
        num('Giá token vào (USD/1 triệu)', () => st.budget.priceInPerMTok, (n) => { st.budget.priceInPerMTok = n; }, { step: '0.01', nullable: true }),
        num('Giá token ra (USD/1 triệu)', () => st.budget.priceOutPerMTok, (n) => { st.budget.priceOutPerMTok = n; }, { step: '0.01', nullable: true })),
      h('p', { class: 'muted small' }, 'Nhập giá theo bảng giá của nhà cung cấp để thấy ước tính và chi phí thực tế.')),
    card('Dữ liệu',
      h('div', { class: 'row gap wrap' }, btn('Sao lưu dự án', () => void backup()), btn('Xoá toàn bộ dự án', async () => {
        if (!confirm('Xoá toàn bộ dự án, bản dịch và thuật ngữ? Không thể hoàn tác.')) return;
        await S.storage.clearProject(); S.meta = null; S.parse = null; S.entries = []; S.index.clear(); S.glossary = []; S.characters = []; S.examples = []; S.log = []; S.pilotIds = []; toast('Đã xoá dự án.', 'ok'); go('upload');
      }, 'danger', !S.meta))),
  );
}

// ======================= KHUNG ỨNG DỤNG =======================
let renderQueued = false;
function scheduleRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; const a = document.activeElement; if (a && (a.tagName === 'TEXTAREA') && root.contains(a)) return; render(); }); }

let progTimer = 0;
function onProgress() {
  updateHeader();
  if (progTimer) return;
  progTimer = window.setTimeout(() => { progTimer = 0; if (S.tab === 'dashboard') render(); }, 600);
}

function updateHeader() {
  const el = document.getElementById('hdr-fill');
  const txt = document.getElementById('hdr-text');
  if (!el || !txt) return;
  const p = computeProgress(S.entries);
  el.style.width = `${p.translatedPct}%`;
  txt.textContent = S.meta ? `${pct(p.translatedPct)} • ${fmt(p.verified)}/${fmt(p.total - p.excluded)} đạt QA${S.running ? (S.paused ? ' • tạm dừng' : ' • đang dịch…') : ''}` : 'Chưa có dự án';
}

function render() {
  const view = ({ dashboard: dashboardView, upload: uploadView, editor: editorView, glossary: glossaryView, export: exportView, settings: settingsView } as Record<Tab, () => HTMLElement>)[S.tab]();
  const nav = h('nav', { class: 'tabs', 'aria-label': 'Điều hướng' }, TABS.map(([id, label, icon]) => h('button', { type: 'button', class: `tab ${S.tab === id ? 'on' : ''}`, 'aria-current': S.tab === id ? 'page' : null, on: { click: (() => go(id)) as EventListener } }, h('span', { class: 'ic', 'aria-hidden': 'true' }, icon), h('span', null, label))));
  const fill = h('div', { id: 'hdr-fill', class: 'fill' });
  const header = h('header', { class: 'top' },
    h('div', { class: 'brand' }, h('b', null, 'EN→VI'), h('span', { class: 'muted' }, S.meta ? S.meta.fileName : 'Dịch en.json'), h('a', { class: 'link', href: 'accounts.html' }, 'Điều phối tài khoản')),
    h('div', { class: 'hdr-bar' }, h('div', { class: 'bar' }, fill), h('small', { id: 'hdr-text' })));
  root.replaceChildren(header, nav, h('main', null, view));
  updateHeader();
}

async function boot() {
  S.onChange = scheduleRender; S.onProgress = onProgress; S.notify = toast;
  await initStore();
  if (S.meta) S.tab = 'dashboard'; else S.tab = 'upload';
  render();
}
void boot();
void lineCol;
