import { buildSystemPrompt, buildUserPrompt, parseModelOutput } from '../../core/translate/prompt.js';
import { buildReviewSystemPrompt, buildReviewUserPrompt, parseReviewOutput } from '../../core/review/review.js';
export const DEFAULT_MODELS = {
    anthropic: 'claude-sonnet-5-5',
    openai: 'gpt-4o-mini',
};
const err = (code, message, retryable, details) => ({ code, message, retryable, ...(details ? { details } : {}) });
export function mapHttpError(status, bodyText, retryAfter) {
    let detail = '';
    try {
        const j = JSON.parse(bodyText);
        detail = j?.error?.message ?? j?.message ?? '';
    }
    catch {
        detail = bodyText.slice(0, 160);
    }
    const retryAfterMs = retryAfter && /^\d+(\.\d+)?$/.test(retryAfter) ? Math.round(Number(retryAfter) * 1000) : undefined;
    const d = retryAfterMs ? { retryAfterMs, status } : { status };
    if (status === 401 || status === 403)
        return err('API_AUTH', `API key không hợp lệ hoặc không có quyền (${status}). ${detail}`.trim(), false, d);
    if (status === 429)
        return err('API_RATE_LIMIT', `Bị giới hạn tốc độ/hạn mức (429). ${detail}`.trim(), true, d);
    if (status === 408 || status === 504)
        return err('API_TIMEOUT', `Nhà cung cấp phản hồi quá chậm (${status}).`, true, d);
    if (status === 529 || status === 503 || status === 502 || status >= 500)
        return err('API_PROVIDER_ERROR', `Nhà cung cấp đang quá tải/lỗi (${status}). ${detail}`.trim(), true, d);
    if (status === 400 && /credit|balance|billing|quota/i.test(detail))
        return err('BUDGET_EXCEEDED', `Hết hạn mức/tín dụng API. ${detail}`, false, d);
    return err('API_PROVIDER_ERROR', `Lỗi từ nhà cung cấp (${status}). ${detail}`.trim(), false, d);
}
/** Một lượt gọi mô hình: dựng request theo nhà cung cấp, xử lý lỗi HTTP/mạng/cắt token, trả văn bản thô + usage. */
async function chat(cfg, system, user, maxTokens, opts) {
    const model = cfg.model || DEFAULT_MODELS[cfg.provider];
    const timeout = AbortSignal.timeout(opts.timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    let url;
    let headers;
    let body;
    if (cfg.provider === 'anthropic') {
        url = (cfg.baseUrl ?? 'https://api.anthropic.com') + '/v1/messages';
        headers = { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' };
        if (cfg.browser)
            headers['anthropic-dangerous-direct-browser-access'] = 'true';
        body = { model, max_tokens: maxTokens, temperature: 0.2, system, messages: [{ role: 'user', content: user }] };
    }
    else {
        url = (cfg.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '') + '/chat/completions';
        headers = { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` };
        body = { model, temperature: 0.2, max_tokens: maxTokens, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
    }
    let res;
    try {
        res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    }
    catch (e) {
        if (opts.signal?.aborted)
            throw e;
        const n = e.name;
        if (n === 'TimeoutError' || n === 'AbortError')
            throw err('API_TIMEOUT', 'Nhà cung cấp phản hồi quá chậm.', true);
        throw err('API_NETWORK', cfg.browser ? 'Không kết nối được nhà cung cấp AI (mạng hoặc bị chặn CORS).' : 'Không kết nối được nhà cung cấp AI.', true);
    }
    const text = await res.text();
    if (!res.ok)
        throw mapHttpError(res.status, text, res.headers.get('retry-after'));
    let raw = '';
    let inTok = 0;
    let outTok = 0;
    try {
        const j = JSON.parse(text);
        if (cfg.provider === 'anthropic') {
            raw = (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
            inTok = j.usage?.input_tokens ?? 0;
            outTok = j.usage?.output_tokens ?? 0;
            if (j.stop_reason === 'max_tokens')
                throw err('API_BAD_RESPONSE', 'Phản hồi bị cắt do giới hạn token; sẽ chia nhỏ lô.', true);
        }
        else {
            raw = j.choices?.[0]?.message?.content ?? '';
            inTok = j.usage?.prompt_tokens ?? 0;
            outTok = j.usage?.completion_tokens ?? 0;
            if (j.choices?.[0]?.finish_reason === 'length')
                throw err('API_BAD_RESPONSE', 'Phản hồi bị cắt do giới hạn token; sẽ chia nhỏ lô.', true);
        }
    }
    catch (e) {
        if (e && typeof e === 'object' && 'code' in e)
            throw e;
        throw err('API_BAD_RESPONSE', 'Không đọc được phản hồi của nhà cung cấp.', true);
    }
    return { raw, inTok, outTok, model };
}
const costOf = (cfg, inTok, outTok) => cfg.priceInPerMTok != null && cfg.priceOutPerMTok != null ? (inTok * cfg.priceInPerMTok + outTok * cfg.priceOutPerMTok) / 1e6 : undefined;
export async function callProvider(cfg, req, opts) {
    const maxTokens = Math.min(8192, 600 + req.items.reduce((n, i) => n + Math.ceil(i.text.length / 2) + 60, 0));
    const { raw, inTok, outTok, model } = await chat(cfg, buildSystemPrompt(req), buildUserPrompt(req), maxTokens, opts);
    const parsed = parseModelOutput(raw, req.items.map((i) => i.id));
    if (parsed.error && parsed.results.size === 0)
        throw err('API_BAD_RESPONSE', parsed.error, true);
    const costUsd = costOf(cfg, inTok, outTok);
    return {
        batchId: req.batchId,
        results: [...parsed.results].map(([id, translation]) => ({ id, translation })),
        usage: { inputTokens: inTok, outputTokens: outTok, ...(costUsd !== undefined ? { costUsd } : {}) },
        provider: cfg.provider,
        model,
    };
}
/** SP-6.4: nhờ mô hình chấm bản dịch (không sửa). Có thể dùng mô hình/nhà cung cấp khác với lúc dịch qua cfg. */
export async function callReview(cfg, items, glossary, opts) {
    const maxTokens = Math.min(8192, 400 + items.length * 90);
    const { raw, inTok, outTok, model } = await chat(cfg, buildReviewSystemPrompt(glossary), buildReviewUserPrompt(items), maxTokens, opts);
    const parsed = parseReviewOutput(raw, items.map((i) => i.id));
    if (parsed.error && parsed.verdicts.size === 0)
        throw err('API_BAD_RESPONSE', parsed.error, true);
    const costUsd = costOf(cfg, inTok, outTok);
    return {
        verdicts: [...parsed.verdicts.values()],
        missing: parsed.missing,
        usage: { inputTokens: inTok, outputTokens: outTok, ...(costUsd !== undefined ? { costUsd } : {}) },
        provider: cfg.provider,
        model,
    };
}
