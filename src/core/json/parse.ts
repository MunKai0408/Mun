// SP-2.1 JSON parser giữ offset. Không dùng JSON.parse để: (1) biết vị trí từng literal chuỗi,
// (2) phát hiện key trùng, (3) báo lỗi dòng/cột. Export dựa trên các span này (DECISIONS D-004).
import type { ParseIssue, ParseResult, ParsedStringLiteral } from '../../contracts/types.js';

const MAX_DEPTH = 500;

class SyntaxErr extends Error {
  constructor(message: string, public pos: number, public code: 'JSON_SYNTAX' | 'JSON_TOO_DEEP' = 'JSON_SYNTAX') {
    super(message);
  }
}

export function escapePointerSegment(s: string): string {
  return s.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function lineCol(text: string, pos: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < pos && i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) { line++; last = i; }
    else if (c === 13 && text.charCodeAt(i + 1) !== 10) { line++; last = i; }
  }
  return { line, column: pos - last };
}

function detectNewline(text: string): 'LF' | 'CRLF' | 'MIXED' {
  let crlf = 0, lf = 0, cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) { if (text.charCodeAt(i + 1) === 10) { crlf++; i++; } else cr++; }
    else if (c === 10) lf++;
  }
  const kinds = [crlf > 0, lf > 0, cr > 0].filter(Boolean).length;
  if (kinds > 1 || cr > 0) return 'MIXED';
  return crlf > 0 ? 'CRLF' : 'LF';
}

const NUM_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const CHUNK_RE = /[^"\\\u0000-\u001f]+/y;
const HEX4 = /^[0-9a-fA-F]{4}$/;

export function parseJson(input: string): ParseResult {
  let hasBom = false;
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) { hasBom = true; text = text.slice(1); }

  const strings: ParsedStringLiteral[] = [];
  const issues: ParseIssue[] = [];
  let nonString = 0;
  let maxDepth = 0;
  let i = 0;
  const pointerCount = new Map<string, number>();

  const fail = (msg: string, pos = i, code: 'JSON_SYNTAX' | 'JSON_TOO_DEEP' = 'JSON_SYNTAX'): never => {
    throw new SyntaxErr(msg, pos, code);
  };
  const ws = () => {
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++; else break;
    }
  };

  // Đọc một literal chuỗi bắt đầu tại text[i] === '"'. Trả về giá trị đã giải escape và span.
  const readString = (): { value: string; start: number; end: number } => {
    const start = i;
    i++;
    let out = '';
    for (;;) {
      CHUNK_RE.lastIndex = i;
      const m = CHUNK_RE.exec(text);
      if (m) { out += m[0]; i += m[0].length; }
      if (i >= text.length) fail('Chuỗi không được đóng bằng dấu "', start);
      const ch = text[i];
      if (ch === '"') { i++; return { value: out, start, end: i }; }
      if (ch === '\\') {
        const n = text[i + 1];
        switch (n) {
          case '"': out += '"'; i += 2; break;
          case '\\': out += '\\'; i += 2; break;
          case '/': out += '/'; i += 2; break;
          case 'b': out += '\b'; i += 2; break;
          case 'f': out += '\f'; i += 2; break;
          case 'n': out += '\n'; i += 2; break;
          case 'r': out += '\r'; i += 2; break;
          case 't': out += '\t'; i += 2; break;
          case 'u': {
            const hex = text.slice(i + 2, i + 6);
            if (!HEX4.test(hex)) fail('Escape \\u không hợp lệ', i);
            out += String.fromCharCode(parseInt(hex, 16));
            i += 6;
            break;
          }
          default: fail(`Escape không hợp lệ: \\${n ?? ''}`, i);
        }
      } else {
        fail('Ký tự điều khiển chưa được escape trong chuỗi', i);
      }
    }
  };

  const parseValue = (path: string[], depth: number): void => {
    if (depth > MAX_DEPTH) fail('JSON lồng quá sâu', i, 'JSON_TOO_DEEP');
    if (depth > maxDepth) maxDepth = depth;
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      ws();
      const seen = new Map<string, number>();
      if (text[i] === '}') { i++; nonString++; return; }
      for (;;) {
        ws();
        if (text[i] !== '"') fail('Key phải là chuỗi trong dấu "', i);
        const k = readString();
        ws();
        if (text[i] !== ':') fail('Thiếu dấu ":" sau key', i);
        i++;
        const n = (seen.get(k.value) ?? 0) + 1;
        seen.set(k.value, n);
        if (n > 1) {
          const lc = lineCol(text, k.start);
          issues.push({ severity: 'MAJOR', code: 'JSON_DUPLICATE_KEY', message: `Key trùng "${k.value}" tại ${'/' + [...path, k.value].map(escapePointerSegment).join('/')}`, ...lc });
        }
        parseValue([...path, k.value], depth + 1);
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; nonString++; return; }
        fail('Mong đợi "," hoặc "}"', i);
      }
    } else if (c === '[') {
      i++;
      ws();
      if (text[i] === ']') { i++; nonString++; return; }
      let idx = 0;
      for (;;) {
        parseValue([...path, String(idx++)], depth + 1);
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; nonString++; return; }
        fail('Mong đợi "," hoặc "]"', i);
      }
    } else if (c === '"') {
      const s = readString();
      const pointer = path.length ? '/' + path.map(escapePointerSegment).join('/') : '';
      const dupIndex = pointerCount.get(pointer) ?? 0;
      pointerCount.set(pointer, dupIndex + 1);
      strings.push({ pointer, dupIndex, keyPath: path, value: s.value, rawLiteral: text.slice(s.start, s.end), span: { start: s.start, end: s.end } });
    } else if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(text);
      if (!m) fail('Số không hợp lệ', i);
      i += m![0].length;
      nonString++;
    } else if (text.startsWith('true', i)) { i += 4; nonString++; }
    else if (text.startsWith('false', i)) { i += 5; nonString++; }
    else if (text.startsWith('null', i)) { i += 4; nonString++; }
    else if (c === undefined) fail('JSON kết thúc đột ngột', i);
    else fail(`Ký tự không hợp lệ "${c}"`, i);
  };

  let ok = true;
  try {
    parseValue([], 0);
    ws();
    if (i < text.length) fail('Còn dữ liệu thừa sau giá trị JSON', i);
  } catch (e) {
    if (e instanceof SyntaxErr) {
      ok = false;
      issues.unshift({ severity: 'BLOCKER', code: e.code, message: e.message, ...lineCol(text, e.pos) });
      strings.length = 0;
    } else throw e;
  }

  return { ok, source: text, hasBom, newline: detectNewline(text), strings, nonStringCount: nonString, maxDepth, issues };
}
