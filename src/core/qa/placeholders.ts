// SP-6.1/6.2 Nhận diện token cần bảo toàn: placeholder, ICU, printf, tag, entity, escape.
export type TokenType = 'placeholder' | 'tag' | 'entity' | 'escape';
export interface Token { raw: string; key: string; type: TokenType; start: number; end: number }

const ICU_HEADER_RE = /^\{\s*([A-Za-z_][\w.]*)\s*,\s*(plural|selectordinal|select)\s*,/;
const BB_NAMES = 'b|i|u|s|color|size|url|img|center|quote|code|font|list|sprite|align|style|spoiler|sup|sub|mark|link|indent';
const TAG_RE = new RegExp(`<\\/?[A-Za-z][^<>]*>|\\[\\/?(?:${BB_NAMES})(?:[=\\s][^\\[\\]]*)?\\]`, 'g');
const ENTITY_RE = /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;
const PRINTF_RE = /%%|%(?:\d+\$)?[-+0#]*(?:\d+|\*)?(?:\.\d+)?(?:ll|l|h)?[sdifuxXeEgGc@]/g;
const I18N_NEST_RE = /\$t\([^)]*\)/g;
const ESC_RE = /\\[nrt"\\]/g;

/** Tìm khối {...} cân bằng bắt đầu tại i; trả về chỉ số '}' hoặc -1. */
function matchBrace(text: string, i: number): number {
  let depth = 0;
  for (let k = i; k < text.length; k++) {
    const c = text[k];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return k; }
  }
  return -1;
}

const SIMPLE_BLOCK_RE = /^\{+[\w.:,\-#\s%$@/]*\}+$/;

function scanBraces(text: string, base: number, out: Token[], inBranch: boolean): void {
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '#' && inBranch) {
      out.push({ raw: '#', key: 'plural#', type: 'placeholder', start: base + i, end: base + i + 1 });
      i++;
      continue;
    }
    if (c !== '{') { i++; continue; }
    const j = matchBrace(text, i);
    if (j < 0) { i++; continue; }
    const block = text.slice(i, j + 1);
    const hm = ICU_HEADER_RE.exec(block);
    if (hm) {
      const header = hm[0];
      out.push({ raw: header, key: `icu:${hm[1]},${hm[2]}`, type: 'placeholder', start: base + i, end: base + i + header.length });
      // Duyệt các nhánh: selector { nội dung }
      const inner = block.slice(header.length, block.length - 1);
      let p = 0;
      while (p < inner.length) {
        const bm = /(=\d+|[A-Za-z_]\w*)\s*\{/y;
        bm.lastIndex = p;
        const m = bm.exec(inner);
        if (!m) { p++; continue; }
        const open = p + m[0].length - 1;
        const close = matchBrace(inner, open);
        if (close < 0) break;
        const selStart = base + i + header.length + p;
        out.push({ raw: m[0], key: `icu-sel:${m[1]}`, type: 'placeholder', start: selStart, end: selStart + m[0].length });
        scanBraces(inner.slice(open + 1, close), base + i + header.length + open + 1, out, hm[2] !== 'select');
        p = close + 1;
      }
    } else if (SIMPLE_BLOCK_RE.test(block) && block.length <= 60) {
      let start = i;
      if (i > 0 && text[i - 1] === '$') start = i - 1;
      const raw = text.slice(start, j + 1);
      out.push({ raw, key: raw, type: 'placeholder', start: base + start, end: base + j + 1 });
    } else {
      // Khối dài/không phải placeholder: quét nội dung bên trong như văn bản thường
      scanBraces(block.slice(1, -1), base + i + 1, out, inBranch);
    }
    i = j + 1;
  }
}

function regexTokens(text: string, re: RegExp, type: TokenType, out: Token[]): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({ raw: m[0], key: m[0], type, start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
}

export function findTokens(text: string): Token[] {
  const out: Token[] = [];
  scanBraces(text, 0, out, false);
  regexTokens(text, I18N_NEST_RE, 'placeholder', out);
  regexTokens(text, PRINTF_RE, 'placeholder', out);
  regexTokens(text, TAG_RE, 'tag', out);
  regexTokens(text, ENTITY_RE, 'entity', out);
  regexTokens(text, ESC_RE, 'escape', out);
  return out.sort((a, b) => a.start - b.start);
}

/** Thay mọi token bằng khoảng trắng (dùng để xét còn chữ để dịch hay không). */
export function stripProtected(text: string): string {
  const toks = findTokens(text);
  let out = '';
  let pos = 0;
  for (const t of toks) {
    if (t.start < pos) continue; // token lồng nhau
    out += text.slice(pos, t.start) + ' ';
    pos = t.end;
  }
  return out + text.slice(pos);
}

export interface TokenDiff { missing: string[]; extra: string[] }

/** So sánh tập (multiset) token theo `key`, bỏ qua thứ tự. */
export function diffTokens(src: Token[], dst: Token[]): TokenDiff {
  const count = new Map<string, number>();
  const rawOf = new Map<string, string>();
  for (const t of src) { count.set(t.key, (count.get(t.key) ?? 0) + 1); rawOf.set(t.key, t.raw); }
  const extra: string[] = [];
  for (const t of dst) {
    const n = count.get(t.key) ?? 0;
    if (n > 0) count.set(t.key, n - 1);
    else extra.push(t.raw);
  }
  const missing: string[] = [];
  for (const [k, n] of count) for (let i = 0; i < n; i++) missing.push(rawOf.get(k) ?? k);
  return { missing, extra };
}

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'wbr', 'sprite', 'meta', 'link', 'col', 'area']);

function tagName(raw: string): { name: string; kind: 'open' | 'close' | 'self' } {
  const m = /^[<\[]\s*(\/)?\s*([A-Za-z][\w-]*)/.exec(raw);
  const name = (m?.[2] ?? '').toLowerCase();
  const selfClosing = /\/\s*[>\]]$/.test(raw) || VOID_TAGS.has(name);
  if (m?.[1]) return { name, kind: 'close' };
  return { name, kind: selfClosing ? 'self' : 'open' };
}

/** Kiểm tra thẻ mở/đóng cân bằng. */
export function tagsBalanced(text: string): boolean {
  const stack: string[] = [];
  for (const t of findTokens(text)) {
    if (t.type !== 'tag') continue;
    const { name, kind } = tagName(t.raw);
    if (kind === 'self') continue;
    if (kind === 'open') stack.push(name);
    else {
      const top = stack.pop();
      if (top !== name) return false;
    }
  }
  return stack.length === 0;
}
