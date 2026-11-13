import { transition } from '../../core/state/state.js';
import { selectReviewSample, shouldFlag, summarizeReview, toReviewItem } from '../../core/review/review.js';
const asAppError = (e) => (e && typeof e === 'object' && 'code' in e && 'message' in e ? e : { code: 'INTERNAL', message: e instanceof Error ? e.message : String(e), retryable: false });
export async function runLlmReview(deps, opts = {}) {
    const minScore = opts.minScore ?? 4;
    const batchSize = Math.max(1, opts.batchSize ?? 15);
    const sample = selectReviewSample(deps.entries, opts);
    const glossary = deps.glossary.map((g) => ({ source: g.source, target: g.target, keepAsIs: g.keepAsIs }));
    const all = [];
    let missing = 0;
    let costUsd = 0, inputTokens = 0, outputTokens = 0;
    let stoppedReason;
    let error;
    for (let i = 0; i < sample.length; i += batchSize) {
        if (deps.signal?.aborted) {
            stoppedReason = 'cancelled';
            break;
        }
        if (opts.capUsd != null && costUsd >= opts.capUsd) {
            stoppedReason = 'budget';
            break;
        }
        const chunk = sample.slice(i, i + batchSize);
        let res;
        try {
            res = await deps.review(chunk.map(toReviewItem), glossary, { timeoutMs: deps.timeoutMs, ...(deps.signal ? { signal: deps.signal } : {}) });
        }
        catch (e) {
            if (deps.signal?.aborted) {
                stoppedReason = 'cancelled';
                break;
            }
            error = asAppError(e);
            stoppedReason = 'error';
            break;
        }
        costUsd += res.usage.costUsd ?? 0;
        inputTokens += res.usage.inputTokens;
        outputTokens += res.usage.outputTokens;
        missing += res.missing.length;
        const byId = new Map(chunk.map((c) => [c.id, c]));
        const changed = [];
        const audit = [];
        for (const v of res.verdicts) {
            all.push(v);
            const cur = byId.get(v.id);
            if (!cur || !shouldFlag(v, minScore))
                continue;
            const note = `Kiểm tra chéo AI: nghĩa ${v.accuracy}/5, tự nhiên ${v.fluency}/5${v.issue ? ` — ${v.issue}` : ''}`;
            const next = transition(cur, 'REVIEW_REQUIRED', {
                qa: { passed: false, score: cur.qa?.score ?? 0, checkedAt: Date.now(), issues: [...(cur.qa?.issues ?? []), { code: 'LLM_REVIEW', severity: 'MINOR', message: note }] },
                qaHint: note,
                note,
            });
            changed.push(next.entry);
            audit.push(next.audit);
        }
        if (changed.length)
            await deps.applyChanges(changed, audit);
        deps.onProgress?.(Math.min(sample.length, i + chunk.length), sample.length);
    }
    return { ...summarizeReview(all, missing, minScore), sampled: sample.length, costUsd, inputTokens, outputTokens, ...(stoppedReason ? { stoppedReason } : {}), ...(error ? { error } : {}) };
}
