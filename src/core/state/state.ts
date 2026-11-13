// SP-3.1/6.5 Máy trạng thái chuỗi (ARCHITECTURE §3). Mọi đổi trạng thái đi qua transition().
import type { AppError, AuditRecord, EntryStatus, ExcludeReason, QaResult, StringEntry, VerifiedLevel } from '../../contracts/types.js';

const ALLOWED: Record<EntryStatus, EntryStatus[]> = {
  PENDING: ['TRANSLATING', 'TRANSLATED', 'VERIFIED', 'EXCLUDED'],
  TRANSLATING: ['TRANSLATED', 'VERIFIED', 'QA_FAILED', 'RETRYING', 'REVIEW_REQUIRED', 'PENDING', 'EXCLUDED'],
  TRANSLATED: ['VERIFIED', 'QA_FAILED', 'TRANSLATED', 'PENDING', 'EXCLUDED'],
  QA_FAILED: ['RETRYING', 'TRANSLATED', 'VERIFIED', 'REVIEW_REQUIRED', 'PENDING', 'EXCLUDED'],
  RETRYING: ['TRANSLATING', 'REVIEW_REQUIRED', 'PENDING', 'EXCLUDED'],
  REVIEW_REQUIRED: ['TRANSLATED', 'VERIFIED', 'RETRYING', 'PENDING', 'EXCLUDED'],
  VERIFIED: ['TRANSLATED', 'PENDING', 'EXCLUDED', 'REVIEW_REQUIRED'],
  EXCLUDED: ['PENDING'],
};

export function canTransition(from: EntryStatus, to: EntryStatus): boolean {
  return ALLOWED[from].includes(to);
}

export interface TransitionPatch {
  translation?: string | null;
  qa?: QaResult | null;
  verifiedLevel?: VerifiedLevel;
  excludeReason?: ExcludeReason;
  error?: AppError | undefined;
  retryCount?: number;
  qaHint?: string | undefined;
  translationSource?: StringEntry['translationSource'];
  provider?: string;
  model?: string;
  manualEdit?: boolean;
  note?: string;
}

export class InvalidTransitionError extends Error {
  readonly appError: AppError;
  constructor(public from: EntryStatus, public to: EntryStatus, id: string) {
    super(`Chuyển trạng thái không hợp lệ ${from} → ${to} (${id})`);
    this.appError = { code: 'INVALID_TRANSITION', message: this.message, retryable: false };
  }
}

export function transition(entry: StringEntry, to: EntryStatus, patch: TransitionPatch = {}, now = Date.now()): { entry: StringEntry; audit: AuditRecord } {
  if (!canTransition(entry.status, to)) throw new InvalidTransitionError(entry.status, to, entry.id);
  if (to === 'EXCLUDED' && !(patch.excludeReason ?? entry.excludeReason)) {
    throw new InvalidTransitionError(entry.status, to, `${entry.id}: EXCLUDED cần excludeReason`);
  }
  const { note, ...rest } = patch;
  const next: StringEntry = { ...entry, ...rest, status: to, updatedAt: now };
  if (to !== 'VERIFIED' && !('verifiedLevel' in patch)) delete next.verifiedLevel;
  if (to === 'PENDING' && !('excludeReason' in patch)) delete next.excludeReason;
  if (to !== 'QA_FAILED' && to !== 'RETRYING' && to !== 'REVIEW_REQUIRED' && !('error' in patch)) delete next.error;
  const audit: AuditRecord = { id: entry.id, from: entry.status, to, at: now, ...(note ? { note } : {}) };
  return { entry: next, audit };
}

/** Khi tải lại trang: chuỗi đang TRANSLATING bị gián đoạn → trả về PENDING (SP-4.4). */
export function recoverInterrupted(entries: StringEntry[], now = Date.now()): { entries: StringEntry[]; recovered: number } {
  let recovered = 0;
  const out = entries.map((e) => {
    if (e.status === 'TRANSLATING') {
      recovered++;
      return transition(e, 'PENDING', { note: 'Khôi phục sau gián đoạn' }, now).entry;
    }
    return e;
  });
  return { entries: out, recovered };
}
