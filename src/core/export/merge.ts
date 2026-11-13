// SP-9.1–9.3 Merger (splice vào văn bản gốc) + Export Validation. Giữ nguyên key/thứ tự/định dạng (D-004).
import type { ExportValidationReport, ParseResult, StringEntry } from '../../contracts/types.js';
import { parseJson } from '../json/parse.js';
import { diffTokens, findTokens } from '../qa/placeholders.js';

export type ExportMode = 'FINAL' | 'PARTIAL';

const encode = (s: string) => JSON.stringify(s.normalize('NFC'));

/** Bản dịch dùng khi xuất: chỉ TRANSLATED/VERIFIED. Các trạng thái khác giữ nguyên văn gốc. */
export function usableTranslation(e: StringEntry): string | null {
  if ((e.status === 'TRANSLATED' || e.status === 'VERIFIED') && e.translation !== null) return e.translation;
  return null;
}

export function spliceStrings(source: string, replacements: { start: number; end: number; text: string }[]): string {
  const sorted = [...replacements].sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const r of sorted) {
    out += source.slice(pos, r.start) + r.text;
    pos = r.end;
  }
  return out + source.slice(pos);
}

export function mergeTranslations(parse: ParseResult, entries: StringEntry[]): string {
  const reps: { start: number; end: number; text: string }[] = [];
  for (const e of entries) {
    const t = usableTranslation(e);
    if (t === null || t === e.original) continue; // không đổi → giữ nguyên literal gốc (kể cả cách escape)
    reps.push({ start: e.span.start, end: e.span.end, text: encode(t) });
  }
  return (parse.hasBom ? '﻿' : '') + spliceStrings(parse.source, reps);
}

/** Bỏ nội dung các literal chuỗi (giá trị) để so sánh phần "khung" của hai file. */
function skeleton(p: ParseResult): string {
  return spliceStrings(p.source, p.strings.map((s) => ({ start: s.span.start, end: s.span.end, text: '""' })));
}

export function exportVi(parse: ParseResult, entries: StringEntry[]): { text: string; report: ExportValidationReport } {
  const text = mergeTranslations(parse, entries);
  return { text, report: validateExport(parse, entries, text) };
}

export function validateExport(parse: ParseResult, entries: StringEntry[], outText: string): ExportValidationReport {
  const issues: string[] = [];
  const out = parseJson(outText);
  const rep: ExportValidationReport = {
    ok: false, keySetEqual: false, structureEqual: false, valueTypesEqual: false, stringCountEqual: false,
    placeholdersOk: true, tagsOk: true, untouchedEqual: false, identityRoundTripOk: false, issues,
  };
  if (!out.ok) {
    issues.push('File xuất không phải JSON hợp lệ: ' + (out.issues[0]?.message ?? ''));
    return rep;
  }
  rep.stringCountEqual = out.strings.length === parse.strings.length;
  if (!rep.stringCountEqual) issues.push(`Số chuỗi khác nhau (gốc ${parse.strings.length}, xuất ${out.strings.length}).`);
  rep.keySetEqual = rep.stringCountEqual && out.strings.every((s, i) => s.pointer === parse.strings[i]!.pointer && s.dupIndex === parse.strings[i]!.dupIndex);
  if (!rep.keySetEqual) issues.push('Tập key/đường dẫn khác bản gốc.');
  rep.structureEqual = rep.keySetEqual && out.maxDepth === parse.maxDepth;
  rep.valueTypesEqual = out.nonStringCount === parse.nonStringCount;
  if (!rep.valueTypesEqual) issues.push('Số giá trị không phải chuỗi khác bản gốc.');
  rep.untouchedEqual = skeleton(parse) === skeleton(out);
  if (!rep.untouchedEqual) issues.push('Phần không phải giá trị chuỗi (key, số, cấu trúc, định dạng) đã bị thay đổi.');

  // Placeholder/tag từng chuỗi
  const byKey = new Map(out.strings.map((s) => [`${s.pointer}#${s.dupIndex}`, s.value]));
  for (const e of entries) {
    const v = byKey.get(`${e.pointer}#${e.dupIndex}`);
    if (v === undefined) continue;
    const d1 = diffTokens(findTokens(e.original).filter((t) => t.type === 'placeholder' || t.type === 'escape'), findTokens(v).filter((t) => t.type === 'placeholder' || t.type === 'escape'));
    if (d1.missing.length || d1.extra.length) { rep.placeholdersOk = false; issues.push(`Placeholder lệch tại ${e.pointer}`); }
    const d2 = diffTokens(findTokens(e.original).filter((t) => t.type === 'tag' || t.type === 'entity'), findTokens(v).filter((t) => t.type === 'tag' || t.type === 'entity'));
    if (d2.missing.length || d2.extra.length) { rep.tagsOk = false; issues.push(`Thẻ lệch tại ${e.pointer}`); }
    if (issues.length > 50) break;
  }

  // Identity round-trip: dịch = nguyên văn thì phải ra đúng file gốc
  const identity = mergeTranslations(parse, entries.map((e) => ({ ...e, translation: e.original, status: 'VERIFIED' as const })));
  rep.identityRoundTripOk = identity === (parse.hasBom ? '﻿' : '') + parse.source;
  if (!rep.identityRoundTripOk) issues.push('Identity round-trip thất bại.');

  rep.ok = rep.keySetEqual && rep.structureEqual && rep.valueTypesEqual && rep.stringCountEqual && rep.untouchedEqual && rep.placeholdersOk && rep.tagsOk && rep.identityRoundTripOk;
  return rep;
}

// ---------- Báo cáo ----------
const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`;

export function errorsCsv(entries: StringEntry[]): string {
  const rows = [['id', 'pointer', 'status', 'kind', 'original', 'translation', 'issues'].join(',')];
  for (const e of entries) {
    if (!['QA_FAILED', 'REVIEW_REQUIRED', 'RETRYING', 'PENDING'].includes(e.status) && !(e.qa && e.qa.issues.some((i) => i.severity !== 'INFO'))) continue;
    rows.push([e.id, e.pointer, e.status, e.kind, e.original, e.translation ?? '', (e.qa?.issues ?? []).map((i) => `${i.severity}:${i.code}`).join(' ') + (e.error ? ' ' + e.error.code : '')].map(csvCell).join(','));
  }
  return '﻿' + rows.join('\r\n');
}
