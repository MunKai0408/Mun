function httpError(status, body, retryAfter) {
    const e = body?.error;
    const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : undefined;
    if (e?.code && typeof e.message === 'string') {
        return { code: e.code, message: e.message, retryable: !!e.retryable, ...(e.details || retryAfterMs ? { details: { ...(e.details ?? {}), ...(retryAfterMs ? { retryAfterMs } : {}) } } : {}) };
    }
    if (status === 401 || status === 403)
        return { code: 'API_AUTH', message: 'Sai hoặc thiếu token/API key.', retryable: false };
    if (status === 429)
        return { code: 'API_RATE_LIMIT', message: 'Bị giới hạn tốc độ, sẽ thử lại.', retryable: true, ...(retryAfterMs ? { details: { retryAfterMs } } : {}) };
    if (status === 404)
        return { code: 'API_PROVIDER_ERROR', message: 'Không tìm thấy /api/translate. Website cần chạy trên Netlify (có Functions) hoặc bằng `npm start`.', retryable: false };
    if (status === 408 || status === 502 || status === 503 || status === 504)
        return { code: 'API_TIMEOUT', message: `Máy chủ không phản hồi kịp (HTTP ${status}).`, retryable: true };
    return { code: 'API_PROVIDER_ERROR', message: `Lỗi máy chủ (HTTP ${status}).`, retryable: status >= 500 };
}
export function createTranslateFn(getAuth) {
    return async (req, opts) => {
        const auth = getAuth();
        const headers = { 'content-type': 'application/json' };
        if (auth.mode === 'BYO' && auth.userKey) {
            headers['x-user-key'] = auth.userKey;
            if (auth.provider)
                headers['x-provider'] = auth.provider;
        }
        else if (auth.accessToken)
            headers['authorization'] = `Bearer ${auth.accessToken}`;
        const timeout = AbortSignal.timeout(opts.timeoutMs);
        const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
        let res;
        try {
            res = await fetch(auth.endpoint ?? '/api/translate', { method: 'POST', headers, body: JSON.stringify(req), signal });
        }
        catch (e) {
            if (opts.signal?.aborted)
                throw e;
            if (e.name === 'TimeoutError' || e.name === 'AbortError')
                throw { code: 'API_TIMEOUT', message: 'Hết thời gian chờ phản hồi.', retryable: true };
            throw { code: 'API_NETWORK', message: 'Không kết nối được máy chủ. Kiểm tra mạng.', retryable: true };
        }
        let body = null;
        try {
            body = await res.json();
        }
        catch { /* không phải JSON */ }
        if (!res.ok)
            throw httpError(res.status, body, res.headers.get('retry-after'));
        const data = body;
        if (!data || !Array.isArray(data.results))
            throw { code: 'API_BAD_RESPONSE', message: 'Phản hồi máy chủ sai định dạng.', retryable: true };
        return data;
    };
}
// ---------- Chế độ gọi trực tiếp từ trình duyệt (GitHub Pages / không cần máy chủ) ----------
import { callProvider } from './provider.js';
/** Trình duyệt gọi thẳng nhà cung cấp bằng API key của người dùng. Key chỉ ở bộ nhớ/sessionStorage trên máy họ. */
export function createDirectTranslateFn(getCfg) {
    return (req, opts) => {
        const cfg = getCfg();
        return callProvider({ ...cfg, browser: true, model: req.options?.model || cfg.model }, req, opts);
    };
}
