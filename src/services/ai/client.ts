// SP-4.1 Client gọi /api/translate (Netlify Function). Key không bao giờ nằm trong bundle.
import type { AppError, TranslateFn, TranslateRequest, TranslateResponse } from '../../contracts/types.js';

export interface ClientAuth {
  mode: 'SERVER' | 'BYO';
  /** Chế độ SERVER: token truy cập do chủ site đặt (ACCESS_TOKEN). */
  accessToken?: string;
  /** Chế độ BYO: API key của người dùng (chỉ trong bộ nhớ/sessionStorage). */
  userKey?: string;
  provider?: string;
  endpoint?: string;
}

function httpError(status: number, body: unknown, retryAfter: string | null): AppError {
  const e = (body as { error?: Partial<AppError> } | null)?.error;
  const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : undefined;
  if (e?.code && typeof e.message === 'string') {
    return { code: e.code, message: e.message, retryable: !!e.retryable, ...(e.details || retryAfterMs ? { details: { ...(e.details ?? {}), ...(retryAfterMs ? { retryAfterMs } : {}) } } : {}) };
  }
  if (status === 401 || status === 403) return { code: 'API_AUTH', message: 'Sai hoặc thiếu token/API key.', retryable: false };
  if (status === 429) return { code: 'API_RATE_LIMIT', message: 'Bị giới hạn tốc độ, sẽ thử lại.', retryable: true, ...(retryAfterMs ? { details: { retryAfterMs } } : {}) };
  if (status === 404) return { code: 'API_PROVIDER_ERROR', message: 'Không tìm thấy /api/translate. Website cần chạy trên Netlify (có Functions) hoặc bằng `npm start`.', retryable: false };
  if (status === 408 || status === 502 || status === 503 || status === 504) return { code: 'API_TIMEOUT', message: `Máy chủ không phản hồi kịp (HTTP ${status}).`, retryable: true };
  return { code: 'API_PROVIDER_ERROR', message: `Lỗi máy chủ (HTTP ${status}).`, retryable: status >= 500 };
}

export function createTranslateFn(getAuth: () => ClientAuth): TranslateFn {
  return async (req: TranslateRequest, opts): Promise<TranslateResponse> => {
    const auth = getAuth();
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (auth.mode === 'BYO' && auth.userKey) { headers['x-user-key'] = auth.userKey; if (auth.provider) headers['x-provider'] = auth.provider; }
    else if (auth.accessToken) headers['authorization'] = `Bearer ${auth.accessToken}`;
    const timeout = AbortSignal.timeout(opts.timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await fetch(auth.endpoint ?? '/api/translate', { method: 'POST', headers, body: JSON.stringify(req), signal });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      if ((e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError') throw { code: 'API_TIMEOUT', message: 'Hết thời gian chờ phản hồi.', retryable: true } satisfies AppError;
      throw { code: 'API_NETWORK', message: 'Không kết nối được máy chủ. Kiểm tra mạng.', retryable: true } satisfies AppError;
    }
    let body: unknown = null;
    try { body = await res.json(); } catch { /* không phải JSON */ }
    if (!res.ok) throw httpError(res.status, body, res.headers.get('retry-after'));
    const data = body as TranslateResponse;
    if (!data || !Array.isArray(data.results)) throw { code: 'API_BAD_RESPONSE', message: 'Phản hồi máy chủ sai định dạng.', retryable: true } satisfies AppError;
    return data;
  };
}

// ---------- Chế độ gọi trực tiếp từ trình duyệt (GitHub Pages / không cần máy chủ) ----------
import { callProvider, type ProviderConfig } from './provider.js';

/** Trình duyệt gọi thẳng nhà cung cấp bằng API key của người dùng. Key chỉ ở bộ nhớ/sessionStorage trên máy họ. */
export function createDirectTranslateFn(getCfg: () => ProviderConfig): TranslateFn {
  return (req, opts) => {
    const cfg = getCfg();
    return callProvider({ ...cfg, browser: true, model: req.options?.model || cfg.model }, req, opts);
  };
}
