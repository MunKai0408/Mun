const ALLOWED = {
    PENDING: ['TRANSLATING', 'TRANSLATED', 'VERIFIED', 'EXCLUDED'],
    TRANSLATING: ['TRANSLATED', 'VERIFIED', 'QA_FAILED', 'RETRYING', 'REVIEW_REQUIRED', 'PENDING', 'EXCLUDED'],
    TRANSLATED: ['VERIFIED', 'QA_FAILED', 'TRANSLATED', 'PENDING', 'EXCLUDED'],
    QA_FAILED: ['RETRYING', 'TRANSLATED', 'VERIFIED', 'REVIEW_REQUIRED', 'PENDING', 'EXCLUDED'],
    RETRYING: ['TRANSLATING', 'REVIEW_REQUIRED', 'PENDING', 'EXCLUDED'],
    REVIEW_REQUIRED: ['TRANSLATED', 'VERIFIED', 'RETRYING', 'PENDING', 'EXCLUDED'],
    VERIFIED: ['TRANSLATED', 'PENDING', 'EXCLUDED', 'REVIEW_REQUIRED'],
    EXCLUDED: ['PENDING'],
};
export function canTransition(from, to) {
    return ALLOWED[from].includes(to);
}
export class InvalidTransitionError extends Error {
    from;
    to;
    appError;
    constructor(from, to, id) {
        super(`Chuyển trạng thái không hợp lệ ${from} → ${to} (${id})`);
        this.from = from;
        this.to = to;
        this.appError = { code: 'INVALID_TRANSITION', message: this.message, retryable: false };
    }
}
export function transition(entry, to, patch = {}, now = Date.now()) {
    if (!canTransition(entry.status, to))
        throw new InvalidTransitionError(entry.status, to, entry.id);
    if (to === 'EXCLUDED' && !(patch.excludeReason ?? entry.excludeReason)) {
        throw new InvalidTransitionError(entry.status, to, `${entry.id}: EXCLUDED cần excludeReason`);
    }
    const { note, ...rest } = patch;
    const next = { ...entry, ...rest, status: to, updatedAt: now };
    if (to !== 'VERIFIED' && !('verifiedLevel' in patch))
        delete next.verifiedLevel;
    if (to === 'PENDING' && !('excludeReason' in patch))
        delete next.excludeReason;
    if (to !== 'QA_FAILED' && to !== 'RETRYING' && to !== 'REVIEW_REQUIRED' && !('error' in patch))
        delete next.error;
    const audit = { id: entry.id, from: entry.status, to, at: now, ...(note ? { note } : {}) };
    return { entry: next, audit };
}
/** Khi tải lại trang: chuỗi đang TRANSLATING bị gián đoạn → trả về PENDING (SP-4.4). */
export function recoverInterrupted(entries, now = Date.now()) {
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
