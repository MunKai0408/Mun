// SP-6.4 Chạy kiểm tra chéo bằng AI trên một mẫu chuỗi VERIFIED(AUTO). Chỉ đánh dấu REVIEW_REQUIRED, không sửa bản dịch.
import type { AppError, AuditRecord, GlossaryTerm, StringEntry } from '../../contracts/types.js';
import { transition } from '../../core/state/state.js';
import { selectReviewSample, shouldFlag, summarizeReview, toReviewItem, type ReviewItem, type ReviewStats, type ReviewVerdict, type SampleOptions } from '../../core/review/review.js';

export interface ReviewCallResult {
  verdicts: ReviewVerdict[];
  missing: string[];
  usage: { inputTokens: number; outputTokens: number; costUsd?: number };
}
export type ReviewFn = (items: ReviewItem[], glossary: Pick<GlossaryTerm, 'source' | 'target' | 'keepAsIs'>[], opts: { signal?: AbortSignal; timeoutMs: number }) => Promise<ReviewCallResult>;

export interface ReviewDeps {
  review: ReviewFn;
  entries: StringEntry[];
  glossary: GlossaryTerm[];
  applyChanges: (changed: StringEntry[], audit: AuditRecord[]) => Promise<void>;
  timeoutMs: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface ReviewOptions extends SampleOptions {
  /** Số chuỗi mỗi lần gọi. Mặc định 15. */
  batchSize?: number;
  /** Ngưỡng điểm: dưới ngưỡng thì đánh dấu. Mặc định 4. */
  minScore?: number;
  /** Trần chi phí (USD) cho lần kiểm tra này; vượt thì dừng. */
  capUsd?: number | null;
}

export interface ReviewSummary extends ReviewStats {
  sampled: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  stoppedReason?: 'cancelled' | 'budget' | 'error';
  error?: AppError;
}

const asAppError = (e: unknown): AppError => (e && typeof e === 'object' && 'code' in e && 'message' in e ? (e as AppError) : { code: 'INTERNAL', message: e instanceof Error ? e.message : String(e), retryable: false });

export async function runLlmReview(deps: ReviewDeps, opts: ReviewOptions = {}): Promise<ReviewSummary> {
  const minScore = opts.minScore ?? 4;
  const batchSize = Math.max(1, opts.batchSize ?? 15);
  const sample = selectReviewSample(deps.entries, opts);
  const glossary = deps.glossary.map((g) => ({ source: g.source, target: g.target, keepAsIs: g.keepAsIs }));
  const all: ReviewVerdict[] = [];
  let missing = 0;
  let costUsd = 0, inputTokens = 0, outputTokens = 0;
  let stoppedReason: ReviewSummary['stoppedReason'];
  let error: AppError | undefined;

  for (let i = 0; i < sample.length; i += batchSize) {
    if (deps.signal?.aborted) { stoppedReason = 'cancelled'; break; }
    if (opts.capUsd != null && costUsd >= opts.capUsd) { stoppedReason = 'budget'; break; }
    const chunk = sample.slice(i, i + batchSize);
    let res: ReviewCallResult;
    try {
      res = await deps.review(chunk.map(toReviewItem), glossary, { timeoutMs: deps.timeoutMs, ...(deps.signal ? { signal: deps.signal } : {}) });
    } catch (e) {
      if (deps.signal?.aborted) { stoppedReason = 'cancelled'; break; }
      error = asAppError(e); stoppedReason = 'error'; break;
    }
    costUsd += res.usage.costUsd ?? 0; inputTokens += res.usage.inputTokens; outputTokens += res.usage.outputTokens;
    missing += res.missing.length;

    const byId = new Map(chunk.map((c) => [c.id, c]));
    const changed: StringEntry[] = [];
    const audit: AuditRecord[] = [];
    for (const v of res.verdicts) {
      all.push(v);
      const cur = byId.get(v.id);
      if (!cur || !shouldFlag(v, minScore)) continue;
      const note = `Kiểm tra chéo AI: nghĩa ${v.accuracy}/5, tự nhiên ${v.fluency}/5${v.issue ? ` — ${v.issue}` : ''}`;
      const next = transition(cur, 'REVIEW_REQUIRED', {
        qa: { passed: false, score: cur.qa?.score ?? 0, checkedAt: Date.now(), issues: [...(cur.qa?.issues ?? []), { code: 'LLM_REVIEW', severity: 'MINOR', message: note }] },
        qaHint: note,
        note,
      });
      changed.push(next.entry); audit.push(next.audit);
    }
    if (changed.length) await deps.applyChanges(changed, audit);
    deps.onProgress?.(Math.min(sample.length, i + chunk.length), sample.length);
  }

  return { ...summarizeReview(all, missing, minScore), sampled: sample.length, costUsd, inputTokens, outputTokens, ...(stoppedReason ? { stoppedReason } : {}), ...(error ? { error } : {}) };
}
