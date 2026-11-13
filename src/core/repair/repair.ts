// SP-7.2 Auto Repair xác định (deterministic). Không bịa nội dung: chỉ sửa những lỗi có cách sửa chắc chắn.
import { diffTokens, findTokens } from '../qa/placeholders.js';
import { leadingWs, trailingWs } from '../qa/validate.js';

export interface RepairResult { text: string; applied: string[] }

const PREAMBLE_LINE_RE = /^\s*(?:dưới đây là[^\n]*|đây là bản dịch[^\n]*|bản dịch(?: tiếng việt)?\s*[:：][^\n]*|here(?:'s| is)[^\n]*:|translation\s*[:：][^\n]*)\n+/i;
const PREAMBLE_INLINE_RE = /^\s*(?:bản dịch(?: tiếng việt)?|tiếng việt|translation)\s*[:：]\s*/i;

const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();

export function repairTranslation(original: string, translation: string): RepairResult {
  const applied: string[] = [];
  let t = translation;
  const note = (s: string, next: string) => { if (next !== t) { applied.push(s); t = next; } };

  note('Chuẩn hoá NFC', t.normalize('NFC'));
  note('Đổi ký tự toàn chiều rộng sang ASCII', t.replace(/｛/g, '{').replace(/｝/g, '}').replace(/％/g, '%').replace(/＜/g, '<').replace(/＞/g, '>'));

  // Rác của AI
  note('Bỏ code fence', t.replace(/^\s*```[a-z]*\n?/i, '').replace(/\n?```\s*$/, ''));
  const origStartsPre = PREAMBLE_LINE_RE.test(original) || PREAMBLE_INLINE_RE.test(original);
  if (!origStartsPre) {
    note('Bỏ lời dẫn của AI', t.replace(PREAMBLE_LINE_RE, ''));
    note('Bỏ nhãn "Bản dịch:"', t.replace(PREAMBLE_INLINE_RE, ''));
  }
  const wrap = /^\s*(["“«])([\s\S]*)(["”»])\s*$/.exec(t);
  const origWrap = /^\s*(["“«])[\s\S]*(["”»])\s*$/.test(original);
  if (wrap && !origWrap) note('Bỏ dấu ngoặc kép bao ngoài', wrap[2] ?? t);

  // Sửa token bị biến dạng: {Name} → {name}, { 0 } → {0}, % s → %s ...
  const src = findTokens(original);
  const dst = findTokens(t);
  const d = diffTokens(src, dst);
  if (d.missing.length && d.extra.length) {
    for (const miss of [...d.missing]) {
      const idx = d.extra.findIndex((ex) => squash(ex) === squash(miss) || squash(ex.replace(/^%\s+/, '%')) === squash(miss));
      if (idx >= 0) {
        const bad = d.extra[idx] as string;
        note(`Sửa token ${bad} → ${miss}`, t.replace(bad, miss));
        d.extra.splice(idx, 1);
        d.missing.splice(d.missing.indexOf(miss), 1);
      }
    }
  }

  // printf bị tách bởi khoảng trắng: "% s" → "%s" (chỉ khi gốc có %s tương ứng bị thiếu)
  for (const miss of d.missing.filter((m) => /^%[^%]*[sdifuxXeEgGc@]$/.test(m))) {
    const conv = miss.slice(-1);
    const re = new RegExp(`%\\s+${conv.replace(/[@]/g, '\\@')}(?![\\p{L}\\p{N}])`, 'u');
    if (re.test(t)) note(`Sửa token ${miss}`, t.replace(re, miss));
  }

  // Xuống dòng: literal "\n" ↔ xuống dòng thật
  const realNl = (s: string) => (s.match(/\n/g) ?? []).length;
  const litNl = (s: string) => (s.match(/\\n/g) ?? []).length;
  if (realNl(t) < realNl(original) && litNl(t) - litNl(original) === realNl(original) - realNl(t)) {
    note('Đổi "\\n" thành xuống dòng thật', t.replace(/\\n/g, '\n'));
  } else if (litNl(original) > 0 && litNl(t) < litNl(original) && realNl(t) - realNl(original) === litNl(original) - litNl(t)) {
    note('Đổi xuống dòng thật thành "\\n"', t.replace(/\n/g, '\\n'));
  }

  // Khoảng trắng đầu/cuối theo bản gốc
  const core = t.trim();
  if (core !== '') note('Khôi phục khoảng trắng đầu/cuối', leadingWs(original) + core + trailingWs(original));

  return { text: t, applied };
}
