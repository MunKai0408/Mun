// Sửa tay trong Translation Editor: chạy QA lại; người dùng có thể chấp nhận dù còn cảnh báo.
import type { GlossaryTerm, AppSettings, StringEntry, AuditRecord } from '../../contracts/types.js';
import { runQa } from '../qa/validate.js';
import { transition } from './state.js';

export function applyManualEdit(
  entry: StringEntry,
  text: string,
  ctx: { glossary: GlossaryTerm[]; settings: AppSettings['qa'] },
  opts: { acceptWithWarnings?: boolean } = {},
  now = Date.now(),
): { entry: StringEntry; audit: AuditRecord[] } {
  const audits: AuditRecord[] = [];
  let e = entry;
  // Đưa về TRANSLATED trước (EXCLUDED/PENDING phải mở trước)
  if (e.status === 'EXCLUDED') { const r = transition(e, 'PENDING', { note: 'Người dùng gỡ loại trừ' }, now); e = r.entry; audits.push(r.audit); }
  const nfc = text.normalize('NFC');
  const qa = runQa(e.original, nfc, { glossary: ctx.glossary, settings: ctx.settings, kind: e.kind, now });
  const patch = { translation: nfc, qa, manualEdit: true, translationSource: 'MANUAL' as const };
  if (e.status === 'PENDING') {
    const r = transition(e, 'TRANSLATED', patch, now); e = r.entry; audits.push(r.audit);
  } else if (e.status === 'TRANSLATED' || e.status === 'VERIFIED' || e.status === 'QA_FAILED' || e.status === 'REVIEW_REQUIRED') {
    const r = transition(e, 'TRANSLATED', patch, now);
    e = r.entry; audits.push(r.audit);
  } else {
    // TRANSLATING/RETRYING: đưa về PENDING rồi sang TRANSLATED
    const r1 = transition(e, 'PENDING', { note: 'Sửa tay' }, now); audits.push(r1.audit);
    const r2 = transition(r1.entry, 'TRANSLATED', patch, now); e = r2.entry; audits.push(r2.audit);
  }
  if (qa.passed || opts.acceptWithWarnings) {
    const r = transition(e, 'VERIFIED', { verifiedLevel: 'HUMAN', note: qa.passed ? 'Người dùng sửa, QA đạt' : 'Người dùng chấp nhận dù còn cảnh báo' }, now);
    e = r.entry; audits.push(r.audit);
  } else {
    const r = transition(e, 'QA_FAILED', { note: 'Sửa tay chưa đạt QA' }, now);
    e = r.entry; audits.push(r.audit);
  }
  return { entry: { ...e, locked: true }, audit: audits };
}

/** Người dùng quyết định chuỗi nghi ngờ: dịch hoặc giữ nguyên (loại trừ). */
export function resolveClassifyReview(entry: StringEntry, decision: 'TRANSLATE' | 'KEEP', now = Date.now()): StringEntry {
  if (entry.status !== 'PENDING') return entry;
  if (decision === 'KEEP') {
    return transition({ ...entry, needsClassifyReview: false }, 'EXCLUDED', { excludeReason: entry.excludeReason ?? 'USER_MANUAL' }, now).entry;
  }
  const { excludeReason: _drop, ...rest } = entry;
  return { ...rest, needsClassifyReview: false, updatedAt: now };
}
