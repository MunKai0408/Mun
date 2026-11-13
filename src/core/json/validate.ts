// SP-2.2 Validator: kiểm tra bất thường bổ sung sau khi parse thành công.
import type { ParseIssue, ParseResult } from '../../contracts/types.js';
import { lineCol } from './parse.js';

export interface ValidationSummary {
  ok: boolean;
  blockers: number;
  warnings: number;
  issues: ParseIssue[];
}

const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function validateParsed(p: ParseResult, opts: { maxStringLen?: number } = {}): ValidationSummary {
  const maxLen = opts.maxStringLen ?? 20000;
  const issues: ParseIssue[] = [...p.issues];
  if (p.ok) {
    if (p.strings.length === 0) {
      issues.push({ severity: 'MAJOR', code: 'JSON_SYNTAX', message: 'File JSON hợp lệ nhưng không chứa chuỗi nào để dịch.', line: 1, column: 1 });
    }
    for (const s of p.strings) {
      const lc = lineCol(p.source, s.span.start);
      if (s.value.length > maxLen) {
        issues.push({ severity: 'MINOR', code: 'JSON_TOO_LARGE', message: `Chuỗi rất dài (${s.value.length} ký tự) tại ${s.pointer}`, ...lc });
      }
      if (CONTROL_RE.test(s.value)) {
        issues.push({ severity: 'MINOR', code: 'JSON_SYNTAX', message: `Chuỗi chứa ký tự điều khiển lạ tại ${s.pointer}`, ...lc });
      }
    }
    if (p.newline === 'MIXED') {
      issues.push({ severity: 'INFO', code: 'JSON_SYNTAX', message: 'File dùng lẫn nhiều kiểu xuống dòng; công cụ giữ nguyên khi xuất.', line: 1, column: 1 });
    }
  }
  const blockers = issues.filter((x) => x.severity === 'BLOCKER').length;
  const warnings = issues.filter((x) => x.severity === 'MAJOR' || x.severity === 'MINOR').length;
  return { ok: p.ok && blockers === 0, blockers, warnings, issues };
}
