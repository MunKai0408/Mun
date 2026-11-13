import { STYLE_GUIDE_VERSION } from '../../contracts/defaults.js';
import { makeBatches } from '../../core/batch/batch.js';
import { relevantTerms, tmKey } from '../../core/glossary/glossary.js';
import { describeIssues, runQa } from '../../core/qa/validate.js';
import { repairTranslation } from '../../core/repair/repair.js';
import { transition } from '../../core/state/state.js';
export function toAppError(e) {
    if (e && typeof e === 'object' && 'code' in e && 'retryable' in e && typeof e.message === 'string')
        return e;
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError'))
        return { code: 'API_TIMEOUT', message: 'Hết thời gian chờ phản hồi.', retryable: true };
    return { code: 'API_NETWORK', message: `Lỗi mạng hoặc lỗi không xác định: ${msg}`, retryable: true };
}
class Fatal extends Error {
    appError;
    constructor(appError) {
        super(appError.message);
        this.appError = appError;
    }
}
export function startTranslation(deps, opts = {}) {
    const abort = new AbortController();
    let paused = false;
    let cancelled = false;
    const waiters = [];
    const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const rnd = deps.random ?? Math.random;
    const emit = (ev) => { try {
        deps.onEvent?.(ev);
    }
    catch { /* UI lỗi không làm hỏng tiến trình */ } };
    const latest = new Map();
    const dirty = new Set();
    const audits = [];
    const touched = new Set();
    const summary = { processed: 0, verified: 0, qaFailed: 0, reviewRequired: 0, fromTm: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cancelled: false };
    // Bản mới nhất: ưu tiên thay đổi của runner chưa flush; nếu không thì lấy từ store (người dùng có thể vừa sửa tay).
    // Dùng chỉ mục để nhanh với 50k chuỗi.
    let storeIndex = null;
    const getFast = (id) => {
        if (dirty.has(id))
            return latest.get(id);
        if (!storeIndex)
            storeIndex = new Map(deps.getEntries().map((e) => [e.id, e]));
        return storeIndex.get(id) ?? latest.get(id);
    };
    const set = (e, a) => {
        latest.set(e.id, e);
        dirty.add(e.id);
        touched.add(e.id);
        if (a)
            audits.push(a);
    };
    const step = (id, to, patch = {}) => {
        const cur = getFast(id);
        if (!cur)
            return undefined;
        try {
            const r = transition(cur, to, patch);
            set(r.entry, r.audit);
            return r.entry;
        }
        catch {
            return undefined;
        }
    };
    const flush = async () => {
        if (!dirty.size)
            return;
        const changed = [...dirty].map((id) => latest.get(id)).filter(Boolean);
        const a = audits.splice(0, audits.length);
        dirty.clear();
        storeIndex = null; // làm mới chỉ mục sau khi store cập nhật
        await deps.applyChanges(changed, a);
        storeIndex = new Map(deps.getEntries().map((e) => [e.id, e]));
    };
    const gate = async () => {
        while (paused && !cancelled)
            await new Promise((r) => waiters.push(r));
    };
    let fatal;
    const ctx = () => deps.getContext();
    // ---- hoàn tất một chuỗi khi có bản dịch ----
    const finalize = (id, raw, source, meta) => {
        const e = getFast(id);
        if (!e || e.locked)
            return null;
        if (e.status !== 'TRANSLATING' && e.status !== 'PENDING' && e.status !== 'RETRYING')
            return null;
        const c = ctx();
        const qaCtx = { glossary: c.glossary, settings: c.settings.qa, kind: e.kind };
        let text = raw.normalize('NFC');
        let qa = runQa(e.original, text, qaCtx);
        let note = '';
        if (!qa.passed) {
            const rep = repairTranslation(e.original, text);
            if (rep.applied.length) {
                const qa2 = runQa(e.original, rep.text, qaCtx);
                if (qa2.passed || qa2.score > qa.score) {
                    text = rep.text;
                    qa = qa2;
                    note = 'Auto Repair: ' + rep.applied.join('; ');
                }
            }
        }
        if (source === 'TM' && !qa.passed)
            return null; // TM không đạt QA → để AI dịch
        let cur = e;
        if (cur.status === 'PENDING' || cur.status === 'RETRYING') {
            const r = step(id, 'TRANSLATING');
            if (!r)
                return null;
            cur = r;
        }
        const base = { translation: text, qa, translationSource: source, ...(meta.provider ? { provider: meta.provider } : {}), ...(meta.model ? { model: meta.model } : {}), error: undefined, qaHint: undefined };
        if (!step(id, 'TRANSLATED', { ...base, ...(note ? { note } : {}) }))
            return null;
        if (qa.passed)
            step(id, 'VERIFIED', { verifiedLevel: 'AUTO', note: source === 'TM' ? 'Từ Translation Memory' : 'QA đạt' });
        else
            step(id, 'QA_FAILED', { error: { code: 'QA_FAILED', message: describeIssues(qa), retryable: true }, qaHint: describeIssues(qa) });
        return text;
    };
    const failEntry = (id, err) => {
        const e = getFast(id);
        if (!e)
            return;
        const max = ctx().settings.retry.max;
        const n = e.retryCount + 1;
        if (e.status !== 'TRANSLATING' && e.status !== 'RETRYING' && e.status !== 'QA_FAILED')
            return;
        if (n >= max)
            step(id, 'REVIEW_REQUIRED', { retryCount: n, error: err, note: 'Hết lượt retry' });
        else if (e.status === 'TRANSLATING')
            step(id, 'RETRYING', { retryCount: n, error: err });
    };
    const markTranslating = (batch) => {
        for (const it of batch.items) {
            step(it.id, 'TRANSLATING');
            for (const f of batch.followers.get(it.id) ?? [])
                step(f, 'TRANSLATING');
        }
    };
    const revertTranslating = (ids) => {
        for (const id of ids) {
            const e = getFast(id);
            if (e && e.status === 'TRANSLATING')
                step(id, 'PENDING', { note: 'Dừng/huỷ' });
        }
    };
    const allIds = (b) => b.items.flatMap((i) => [i.id, ...(b.followers.get(i.id) ?? [])]);
    const buildRequest = (batch) => {
        const c = ctx();
        const texts = [...batch.items.map((i) => i.text), ...batch.neighbors.map((n) => n.text)];
        return {
            projectId: c.projectId, batchId: batch.id, items: batch.items, neighbors: batch.neighbors,
            glossary: relevantTerms(texts, c.glossary).map((g) => ({ source: g.source, target: g.target, keepAsIs: g.keepAsIs })),
            characters: c.characters.filter((ch) => texts.some((t) => t.includes(ch.name))),
            styleGuideVersion: STYLE_GUIDE_VERSION,
            examples: c.examples.slice(0, 8),
            ...(c.settings.model ? { options: { model: c.settings.model } } : {}),
        };
    };
    const backoff = (attempt, err) => {
        const base = ctx().settings.retry.baseDelayMs;
        const hinted = typeof err.details?.retryAfterMs === 'number' ? err.details.retryAfterMs : 0;
        return Math.max(hinted, base * 2 ** (attempt - 1) + rnd() * base);
    };
    const processBatch = async (batch, depth) => {
        await gate();
        if (cancelled)
            return;
        const c = ctx();
        if (depth === 0) {
            markTranslating(batch);
            await flush();
        }
        emit({ type: 'batch-start', batchId: batch.id, size: batch.items.length });
        const maxAttempts = Math.max(1, c.settings.retry.max);
        let resp;
        let lastErr;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (cancelled)
                return;
            try {
                resp = await deps.translate(buildRequest(batch), { signal: abort.signal, timeoutMs: c.settings.timeoutMs });
                lastErr = undefined;
                break;
            }
            catch (e) {
                if (cancelled)
                    return;
                const err = toAppError(e);
                lastErr = err;
                if (err.code === 'API_AUTH' || err.code === 'BUDGET_EXCEEDED')
                    throw new Fatal(err);
                const willRetry = err.retryable && attempt < maxAttempts;
                emit({ type: 'batch-error', batchId: batch.id, error: err, willRetry });
                if (!willRetry)
                    break;
                const ms = backoff(attempt, err);
                emit({ type: 'retry-wait', batchId: batch.id, ms, attempt });
                await sleep(ms);
                await gate();
            }
        }
        if (!resp) {
            // Cô lập chuỗi gây lỗi bằng cách chia đôi batch
            if (batch.items.length > 1 && !cancelled) {
                const mid = Math.ceil(batch.items.length / 2);
                for (const part of [batch.items.slice(0, mid), batch.items.slice(mid)]) {
                    const sub = { id: `${batch.id}.${part[0].id.slice(-3)}`, items: part, neighbors: batch.neighbors, followers: new Map(part.map((p) => [p.id, batch.followers.get(p.id) ?? []])) };
                    await processBatch(sub, depth + 1);
                }
            }
            else {
                const err = lastErr ?? { code: 'API_PROVIDER_ERROR', message: 'Lỗi không xác định', retryable: false };
                for (const id of allIds(batch))
                    failEntry(id, err);
                await flush();
            }
            return;
        }
        const byId = new Map(resp.results.map((r) => [r.id, r.translation]));
        const missing = [];
        let ok = 0;
        for (const it of batch.items) {
            const tr = byId.get(it.id);
            if (typeof tr !== 'string' || tr === '') {
                missing.push(it);
                continue;
            }
            const finalText = finalize(it.id, tr, 'AI', { provider: resp.provider, model: resp.model });
            if (finalText === null)
                continue;
            ok++;
            const fin = getFast(it.id);
            const textForFollowers = fin?.translation ?? finalText;
            for (const f of batch.followers.get(it.id) ?? [])
                finalize(f, textForFollowers, 'AI', { provider: resp.provider, model: resp.model });
        }
        // Chi phí
        const u = resp.usage;
        if (u) {
            summary.inputTokens += u.inputTokens;
            summary.outputTokens += u.outputTokens;
            const { priceInPerMTok: pi, priceOutPerMTok: po } = c.settings.budget;
            summary.costUsd += u.costUsd ?? (pi !== null && po !== null ? (u.inputTokens * pi + u.outputTokens * po) / 1e6 : 0);
        }
        await flush();
        emit({ type: 'batch-done', batchId: batch.id, ok });
        if (missing.length && !cancelled) {
            if (depth < 2) {
                const sub = { id: `${batch.id}m`, items: missing, neighbors: batch.neighbors, followers: new Map(missing.map((p) => [p.id, batch.followers.get(p.id) ?? []])) };
                await processBatch(sub, depth + 1);
            }
            else {
                const err = { code: 'BATCH_ID_MISMATCH', message: 'Phản hồi AI thiếu chuỗi.', retryable: true };
                for (const it of missing)
                    for (const id of [it.id, ...(batch.followers.get(it.id) ?? [])])
                        failEntry(id, err);
                await flush();
            }
        }
        const cap = c.settings.budget.capUsd;
        if (cap !== null && summary.costUsd >= cap && !paused) {
            paused = true;
            emit({ type: 'budget', costUsd: summary.costUsd });
            emit({ type: 'paused' });
        }
    };
    const run = async () => {
        const c0 = ctx();
        const all = deps.getEntries();
        let work = all.filter((e) => ((e.status === 'PENDING' && !e.needsClassifyReview) || e.status === 'RETRYING') && !e.locked && (!opts.ids || opts.ids.has(e.id)));
        if (opts.limit !== undefined)
            work = work.slice(0, opts.limit);
        emit({ type: 'started', total: work.length });
        // 1) Translation Memory
        const remaining = [];
        for (const e of work) {
            const rec = c0.tm.get(tmKey(e.original, e.kind));
            if (rec && finalize(e.id, rec.target, 'TM', {}) !== null) {
                summary.fromTm++;
                continue;
            }
            remaining.push(e);
        }
        await flush();
        // 2) AI — vòng đầu + tối đa `retry.max` vòng sửa lỗi QA/API
        let round = 0;
        let todo = remaining.map((e) => getFast(e.id)).filter(Boolean);
        while (todo.length && !cancelled) {
            const c = ctx();
            const everyone = deps.getEntries();
            const batches = makeBatches(todo, everyone, c.settings.batch, `r${round}b`);
            const queue = [...batches];
            const worker = async () => {
                while (queue.length && !cancelled) {
                    const b = queue.shift();
                    try {
                        await processBatch(b, 0);
                    }
                    catch (e) {
                        if (e instanceof Fatal) {
                            fatal = e.appError;
                            cancelled = true;
                            abort.abort();
                            for (const w of waiters.splice(0))
                                w();
                        }
                        else { // lỗi bất ngờ: đánh dấu batch lỗi, tiếp tục batch khác
                            const err = toAppError(e);
                            for (const id of allIds(b))
                                failEntry(id, err);
                            await flush();
                        }
                    }
                }
            };
            await Promise.all(Array.from({ length: Math.max(1, c.settings.batch.concurrency) }, worker));
            await flush();
            if (cancelled)
                break;
            // chuẩn bị vòng sau: QA_FAILED → RETRYING (kèm gợi ý sửa lỗi)
            const max = c.settings.retry.max;
            const next = [];
            for (const e0 of todo) {
                const e = getFast(e0.id);
                if (!e)
                    continue;
                if (e.status === 'QA_FAILED') {
                    if (e.retryCount >= max) {
                        step(e.id, 'REVIEW_REQUIRED', { note: 'Hết lượt retry' });
                        continue;
                    }
                    const r = step(e.id, 'RETRYING', { retryCount: e.retryCount + 1, qaHint: e.qaHint });
                    if (r)
                        next.push(r);
                }
                else if (e.status === 'RETRYING') {
                    next.push(e);
                }
            }
            await flush();
            todo = next;
            round++;
            if (round > c.settings.retry.max + 1)
                break;
        }
        // Phần còn dang dở (huỷ/dừng do lỗi nặng) → PENDING
        revertTranslating([...touched]);
        // Lượt RETRYING còn sót khi đã hết vòng → REVIEW_REQUIRED
        if (!cancelled)
            for (const id of touched) {
                const e = getFast(id);
                if (e && e.status === 'RETRYING')
                    step(id, 'REVIEW_REQUIRED', { note: 'Hết lượt retry' });
            }
        await flush();
        for (const id of touched) {
            const e = getFast(id);
            if (!e)
                continue;
            summary.processed++;
            if (e.status === 'VERIFIED')
                summary.verified++;
            else if (e.status === 'QA_FAILED')
                summary.qaFailed++;
            else if (e.status === 'REVIEW_REQUIRED')
                summary.reviewRequired++;
        }
        summary.cancelled = cancelled;
        if (fatal) {
            summary.fatal = fatal;
            emit({ type: 'fatal', error: fatal });
        }
        emit({ type: 'finished', summary });
        return summary;
    };
    const promise = run().catch((e) => {
        const err = toAppError(e);
        summary.fatal = err;
        summary.cancelled = true;
        emit({ type: 'fatal', error: err });
        return summary;
    });
    return {
        promise,
        pause() { if (!paused) {
            paused = true;
            emit({ type: 'paused' });
        } },
        resume() { if (paused) {
            paused = false;
            emit({ type: 'resumed' });
            for (const w of waiters.splice(0))
                w();
        } },
        cancel() { cancelled = true; abort.abort(); for (const w of waiters.splice(0))
            w(); },
        isPaused: () => paused,
    };
}
