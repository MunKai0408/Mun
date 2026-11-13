// Bảng điều phối nhiều tài khoản Claude: theo dõi lượt dùng, thời điểm mở lại, tài khoản đang làm và chuyển giao.
// Chỉ là sổ theo dõi do bạn tự cập nhật, lưu trong trình duyệt. KHÔNG lưu email/mật khẩu/token và không tự đăng nhập.
import { h, download, toast, pickFile, readFileText } from './dom.js';

const KEY = 'entr.accounts.v1';
const H5 = 5 * 3600_000;

interface Quota { remaining: number; resetAt: number | null }
interface Account { id: string; name: string; role: string; h5: Quota; week: Quota; note: string; lastUsedAt: number | null; current: boolean }
interface Model { accounts: Account[]; handoff: string }

const ROLES: [string, string][] = [
  ['', '— chưa gán —'], ['C1', 'Claude 1 · Architect'], ['C2', 'Claude 2 · Core Engine'], ['C3', 'Claude 3 · Frontend'],
  ['C4', 'Claude 4 · AI & QA'], ['C5', 'Claude 5 · Integration & Release'],
];
const BOOTSTRAP = `Bạn là một thành viên trong đội 5 Claude xây website dịch en.json → tiếng Việt.
Prompt đầy đủ nằm trong repo tại docs/MASTER_PROMPT.md. Quy trình bắt buộc:
1. Đọc theo thứ tự: NEXT_TASK.md → HANDOFF.md → PROGRESS.md. Chỉ đọc PROJECT_SPEC.md, ARCHITECTURE.md, CONTRACTS.md, DECISIONS.md khi nhiệm vụ cần.
2. Xác nhận vai trò (theo NEXT_TASK.md) và chỉ làm ĐÚNG nhiệm vụ trong đó.
3. Chỉ làm 1 Subphase (hoặc 1 Task nhỏ) mỗi phiên. Không mở rộng phạm vi.
4. Cập nhật HANDOFF.md sau MỖI Task nhỏ, vì phiên có thể bị cắt đột ngột.
5. Kết thúc bằng báo cáo theo mẫu mục 14 và cập nhật NEXT_TASK.md.
Không hỏi lại nhiều: thiếu thông tin thì chọn mặc định hợp lý, ghi vào DECISIONS.md rồi làm tiếp.`;

const uid = () => 'a' + Math.random().toString(36).slice(2, 8);
const mk = (i: number): Account => ({ id: uid(), name: `Tài khoản ${i}`, role: `C${i}`, h5: { remaining: 100, resetAt: null }, week: { remaining: 100, resetAt: null }, note: '', lastUsedAt: null, current: false });

function load(): Model {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Model | null;
    if (m && Array.isArray(m.accounts)) return { accounts: m.accounts, handoff: m.handoff ?? '' };
  } catch { /* bỏ qua */ }
  return { accounts: [1, 2, 3, 4, 5].map(mk), handoff: '' };
}
let M: Model = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(M)); } catch { toast('Không lưu được (trình duyệt chặn bộ nhớ).', 'err'); } };

function fmtLeft(ms: number): string {
  if (ms <= 0) return 'đã mở lại';
  const m = Math.ceil(ms / 60000);
  const d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d} ngày ${hh}h` : hh ? `${hh}h ${String(mm).padStart(2, '0')}m` : `${mm}m`;
}
const fmtAt = (t: number | null) => (t ? new Date(t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '—');
const toLocalInput = (t: number | null) => { if (!t) return ''; const d = new Date(t - new Date(t).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
const level = (r: number) => (r >= 50 ? 'good' : r >= 20 ? 'mid' : 'low');

/** Quota hết hạn reset → tự về 100%. Trả về true nếu có thay đổi. */
function expire(now = Date.now()): boolean {
  let ch = false;
  for (const a of M.accounts) for (const q of [a.h5, a.week]) if (q.resetAt && q.resetAt <= now) { q.remaining = 100; q.resetAt = null; ch = true; }
  return ch;
}
const isLimited = (a: Account) => a.h5.remaining <= 0 || a.week.remaining <= 0;
const status = (a: Account): [string, string] => a.current ? ['Đang làm', 'cur'] : isLimited(a) ? ['Hết lượt', 'lim'] : a.h5.remaining < 20 || a.week.remaining < 10 ? ['Sắp hết', 'low'] : ['Sẵn sàng', 'ok'];

function handoffText(a: Account): string {
  const role = ROLES.find((r) => r[0] === a.role)?.[1];
  return `${BOOTSTRAP}\n\n${role ? `Vai trò của phiên này: ${role}.\n\n` : ''}${M.handoff.trim() ? `===== NEXT_TASK / HANDOFF =====\n${M.handoff.trim()}\n` : '(Hãy đính kèm NEXT_TASK.md và HANDOFF.md hoặc ZIP repo vào cuộc trò chuyện.)'}`;
}
async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast('Đã sao chép lời bàn giao.', 'ok'); }
  catch { const t = h('textarea', { value: text }); document.body.append(t); (t as HTMLTextAreaElement).select(); try { document.execCommand('copy'); toast('Đã sao chép lời bàn giao.', 'ok'); } catch { toast('Không sao chép được — hãy chọn và copy thủ công.', 'err'); } t.remove(); }
}

function quotaRow(label: string, q: Quota, onChange: () => void, startsH5 = false): HTMLElement {
  const f = h('div', { class: `fill ${level(q.remaining)}` }); f.style.width = `${q.remaining}%`;
  const left = q.resetAt ? fmtLeft(q.resetAt - Date.now()) : 'chưa đặt giờ mở lại';
  return h('div', { class: 'q' },
    h('div', { class: 'qh' }, h('b', null, label), h('span', { class: `pct ${level(q.remaining)}` }, `${Math.round(q.remaining)}%`)),
    h('div', { class: 'bar' }, f),
    h('div', { class: 'qs muted' }, h('span', { 'data-reset': q.resetAt ?? '' }, q.resetAt ? `Mở lại ${fmtAt(q.resetAt)} · còn ${left}` : left),
      h('span', { class: 'qq' }, [100, 50, 20, 0].map((v) => h('button', { type: 'button', class: 'mini', on: { click: (() => { q.remaining = v; if (startsH5 && v < 100 && !q.resetAt) q.resetAt = Date.now() + H5; if (v === 100) q.resetAt = null; save(); onChange(); }) as EventListener } }, `${v}%`)))));
}

function cardFor(a: Account, rerender: () => void): HTMLElement {
  const [stText, stCls] = status(a);
  const ch = () => { save(); rerender(); };
  const resetInput = (q: Quota, label: string) => {
    const i = h('input', { type: 'datetime-local', value: toLocalInput(q.resetAt), 'aria-label': label });
    i.addEventListener('change', () => { const v = (i as HTMLInputElement).value; q.resetAt = v ? new Date(v).getTime() : null; ch(); });
    return h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), i);
  };
  const num = (q: Quota, label: string) => {
    const i = h('input', { type: 'number', min: '0', max: '100', value: String(Math.round(q.remaining)), inputmode: 'numeric', 'aria-label': label });
    i.addEventListener('change', () => { q.remaining = Math.max(0, Math.min(100, Number((i as HTMLInputElement).value) || 0)); ch(); });
    return h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), i);
  };
  const name = h('input', { class: 'nm', value: a.name, 'aria-label': 'Biệt danh tài khoản', maxlength: '40', placeholder: 'Biệt danh (không nhập email)' });
  name.addEventListener('change', () => { a.name = (name as HTMLInputElement).value.trim() || 'Tài khoản'; ch(); });
  const role = h('select', { 'aria-label': 'Vai trò' }, ROLES.map(([v, l]) => h('option', { value: v, selected: a.role === v }, l)));
  role.addEventListener('change', () => { a.role = (role as HTMLSelectElement).value; ch(); });
  const note = h('textarea', { rows: 2, value: a.note, placeholder: 'Ghi chú (đang làm SP nào, lưu ý…)', 'aria-label': 'Ghi chú' });
  note.addEventListener('change', () => { a.note = (note as HTMLTextAreaElement).value; save(); });
  return h('article', { class: `acc ${stCls}` },
    h('div', { class: 'ah' }, name, h('span', { class: `st ${stCls}` }, stText)),
    role,
    quotaRow('Phiên 5 giờ', a.h5, ch, true),
    quotaRow('Hằng tuần', a.week, ch),
    h('div', { class: 'qs muted' }, `Dùng gần nhất: ${a.lastUsedAt ? fmtAt(a.lastUsedAt) : '—'}`),
    h('div', { class: 'row wrap gap' },
      h('button', { type: 'button', class: 'btn primary', on: { click: (() => { for (const x of M.accounts) x.current = false; a.current = true; a.lastUsedAt = Date.now(); if (!a.h5.resetAt) a.h5.resetAt = Date.now() + H5; ch(); }) as EventListener } }, a.current ? '✓ Đang dùng' : 'Dùng tài khoản này'),
      h('button', { type: 'button', class: 'btn', on: { click: (() => { a.h5.remaining = 0; if (!a.h5.resetAt) a.h5.resetAt = Date.now() + H5; a.current = false; ch(); }) as EventListener } }, 'Hết lượt 5h'),
      h('button', { type: 'button', class: 'btn', on: { click: (() => { a.h5 = { remaining: 100, resetAt: null }; ch(); }) as EventListener } }, 'Làm mới 5h'),
      h('button', { type: 'button', class: 'btn', on: { click: (() => void copy(handoffText(a))) as EventListener } }, 'Sao chép lời bàn giao')),
    h('details', null, h('summary', null, 'Chỉnh tay'), h('div', { class: 'grid2' }, num(a.h5, '5h còn lại (%)'), resetInput(a.h5, 'Mở lại 5h lúc'), num(a.week, 'Tuần còn lại (%)'), resetInput(a.week, 'Mở lại tuần lúc')), note,
      h('button', { type: 'button', class: 'btn danger', on: { click: (() => { if (confirm(`Xoá "${a.name}" khỏi bảng?`)) { M.accounts = M.accounts.filter((x) => x.id !== a.id); ch(); } }) as EventListener } }, 'Xoá khỏi bảng')));
}

function suggestion(): Account | null {
  const c = M.accounts.filter((a) => !a.current && !isLimited(a));
  c.sort((x, y) => y.h5.remaining - x.h5.remaining || y.week.remaining - x.week.remaining || (x.lastUsedAt ?? 0) - (y.lastUsedAt ?? 0));
  return c[0] ?? null;
}

const root = document.getElementById('app') as HTMLElement;
function render() {
  const cur = M.accounts.find((a) => a.current);
  const sug = suggestion();
  const next = M.accounts.filter((a) => isLimited(a)).map((a) => [a.h5.remaining <= 0 ? a.h5.resetAt : a.week.resetAt, a] as const).filter((x): x is readonly [number, Account] => !!x[0]).sort((x, y) => x[0] - y[0])[0];
  const ready = M.accounts.filter((a) => !isLimited(a)).length;
  const handoff = h('textarea', { rows: 6, class: 'mono', value: M.handoff, placeholder: 'Dán nội dung NEXT_TASK.md và HANDOFF.md vào đây. Khi bấm “Sao chép lời bàn giao”, nội dung này được ghép sau đoạn BOOTSTRAP + vai trò của tài khoản.', 'aria-label': 'NEXT_TASK và HANDOFF' });
  handoff.addEventListener('change', () => { M.handoff = (handoff as HTMLTextAreaElement).value; save(); });
  root.replaceChildren(
    h('header', { class: 'top' }, h('div', { class: 'brand' }, h('b', null, 'Điều phối tài khoản'), h('span', { class: 'muted' }, `${ready}/${M.accounts.length} sẵn sàng`), h('a', { class: 'link', href: 'index.html' }, '← Về trang dịch'))),
    h('main', { class: 'wide' },
      h('section', { class: 'card sum' },
        h('div', null, h('div', { class: 'muted small' }, 'Đang làm'), h('b', null, cur ? `${cur.name}${cur.role ? ' · ' + cur.role : ''}` : 'Chưa chọn')),
        h('div', null, h('div', { class: 'muted small' }, 'Gợi ý tiếp theo'), sug ? h('span', null, h('b', null, sug.name), ` (5h còn ${Math.round(sug.h5.remaining)}%, tuần ${Math.round(sug.week.remaining)}%) `, h('button', { type: 'button', class: 'btn', on: { click: (() => void copy(handoffText(sug))) as EventListener } }, 'Sao chép bàn giao')) : h('b', null, 'Không có tài khoản sẵn sàng')),
        h('div', null, h('div', { class: 'muted small' }, 'Sớm nhất mở lại'), h('b', null, next ? `${next[1].name} · ${fmtAt(next[0])} (còn ${fmtLeft(next[0] - Date.now())})` : '—'))),
      h('div', { class: 'grid-acc' }, M.accounts.map((a) => cardFor(a, render))),
      h('section', { class: 'card' }, h('h2', null, 'Nội dung bàn giao'), handoff,
        h('div', { class: 'row wrap gap' },
          h('button', { type: 'button', class: 'btn', on: { click: (() => void copy(BOOTSTRAP)) as EventListener } }, 'Chỉ sao chép đoạn BOOTSTRAP'),
          h('button', { type: 'button', class: 'btn', on: { click: (() => { M.accounts.push(mk(M.accounts.length + 1)); save(); render(); }) as EventListener } }, '+ Thêm tài khoản'),
          h('button', { type: 'button', class: 'btn', on: { click: (() => download('tai-khoan-backup.json', JSON.stringify(M, null, 2))) as EventListener } }, 'Xuất JSON'),
          h('button', { type: 'button', class: 'btn', on: { click: (() => void pickFile('.json').then(async (f) => { if (!f) return; try { const d = JSON.parse(await readFileText(f)) as Model; if (!Array.isArray(d.accounts)) throw new Error('sai định dạng'); M = { accounts: d.accounts, handoff: d.handoff ?? '' }; save(); render(); } catch (e) { toast('Không nhập được: ' + (e as Error).message, 'err'); } })) as EventListener } }, 'Nhập JSON')),
        h('p', { class: 'muted small' }, 'Đây là sổ theo dõi do bạn tự cập nhật, lưu ngay trong trình duyệt này. Công cụ không đăng nhập, không đọc lượt dùng thật và không lưu email/mật khẩu/token — chỉ dùng biệt danh.')),
    ));
}

render();
setInterval(() => { if (expire()) { save(); render(); } else { for (const el of document.querySelectorAll<HTMLElement>('[data-reset]')) { const t = Number(el.dataset.reset); if (t) el.textContent = `Mở lại ${fmtAt(t)} · còn ${fmtLeft(t - Date.now())}`; } } }, 15_000);
if (expire()) { save(); render(); }
