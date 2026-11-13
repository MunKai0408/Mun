import { DEFAULT_SETTINGS } from '../contracts/defaults.js';
import { parseJson } from '../core/json/parse.js';
import { extractEntries } from '../core/extract/extract.js';
import { classifyEntries } from '../core/classify/classify.js';
import { recoverInterrupted } from '../core/state/state.js';
import { tmKey } from '../core/glossary/glossary.js';
import { startTranslation } from '../services/orchestrator/runner.js';
import { createDirectTranslateFn, createTranslateFn } from '../services/ai/client.js';
import { callReview } from '../services/ai/provider.js';
import { runLlmReview } from '../services/review/runner.js';
import { IdbStorage, MemoryStorage, isBackup } from '../services/storage/storage.js';
export const S = {
    storage: null,
    persistent: false,
    meta: null,
    parse: null,
    entries: [],
    index: new Map(),
    glossary: [],
    characters: [],
    examples: [],
    rules: [],
    settings: DEFAULT_SETTINGS,
    tm: new Map(),
    secrets: { apiKey: '', accessToken: '', rememberKey: false, rememberToken: true },
    tab: 'dashboard',
    runner: null,
    running: false,
    paused: false,
    lastRun: null,
    runMode: '',
    pilotIds: [],
    log: [],
    liveCost: 0,
    review: { running: false, done: 0, total: 0, last: null, abort: null },
    batchCount: 0,
    onChange: (() => { }),
    onProgress: (() => { }),
    notify: ((_m, _k) => { }),
};
const SECRET_KEY = 'entr.secrets';
function loadSecrets() {
    try {
        const ls = JSON.parse(localStorage.getItem(SECRET_KEY) ?? '{}');
        const ss = JSON.parse(sessionStorage.getItem(SECRET_KEY) ?? '{}');
        S.secrets = { apiKey: ss.apiKey ?? ls.apiKey ?? '', accessToken: ss.accessToken ?? ls.accessToken ?? '', rememberKey: !!ls.apiKey, rememberToken: ls.accessToken !== undefined || ss.accessToken === undefined };
    }
    catch { /* trình duyệt chặn storage */ }
}
export function saveSecrets() {
    try {
        sessionStorage.setItem(SECRET_KEY, JSON.stringify({ apiKey: S.secrets.apiKey, accessToken: S.secrets.accessToken }));
        localStorage.setItem(SECRET_KEY, JSON.stringify({ ...(S.secrets.rememberKey ? { apiKey: S.secrets.apiKey } : {}), ...(S.secrets.rememberToken ? { accessToken: S.secrets.accessToken } : {}) }));
    }
    catch { /* bỏ qua */ }
}
export function reindex() { S.index = new Map(S.entries.map((e) => [e.id, e])); }
export async function initStore() {
    loadSecrets();
    loadRules();
    try {
        if (!('indexedDB' in globalThis))
            throw new Error('no idb');
        const idb = new IdbStorage();
        S.storage = idb;
        S.persistent = await idb.requestPersistence();
        const snap = await idb.loadProject();
        S.tm = new Map((await idb.loadTm()).map((r) => [r.key, r]));
        if (snap) {
            S.meta = snap.meta;
            S.parse = parseJson((snap.meta.source));
            const rec = recoverInterrupted(snap.entries);
            S.entries = rec.entries;
            if (rec.recovered) {
                await S.storage.putEntries(rec.entries.filter((e, i) => e !== snap.entries[i]));
                S.notify(`Đã khôi phục ${rec.recovered} chuỗi bị gián đoạn lần trước.`, 'info');
            }
            S.glossary = snap.glossary;
            S.characters = snap.characters;
            S.examples = snap.examples;
            S.settings = snap.settings;
            reindex();
        }
        else if (location.hostname.endsWith('github.io')) {
            S.settings = { ...S.settings, keyMode: 'DIRECT' };
        }
    }
    catch {
        S.storage = new MemoryStorage();
        S.notify('Trình duyệt không cho dùng IndexedDB: tiến độ sẽ mất khi đóng trang. Hãy dùng "Sao lưu" thường xuyên.', 'err');
    }
}
export async function createProject(fileName, text) {
    const parse = parseJson(text);
    if (!parse.ok)
        return { ok: false, message: parse.issues[0]?.message };
    const now = Date.now();
    const id = 'p_' + now.toString(36);
    const meta = { id, fileName, source: text, createdAt: now, updatedAt: now };
    const entries = classifyEntries(extractEntries(parse, id), S.rules);
    await S.storage.createProject(meta, entries);
    await S.storage.saveSettings(S.settings);
    S.meta = meta;
    S.parse = parse;
    S.entries = entries;
    S.glossary = [];
    S.characters = [];
    S.examples = [];
    S.pilotIds = [];
    S.log = [];
    reindex();
    S.onChange();
    return { ok: true };
}
export async function reclassify() {
    // Đưa các chuỗi chưa dịch / đã loại trừ tự động về trạng thái ban đầu rồi phân loại lại theo luật hiện tại.
    const reset = S.entries.map((e) => {
        const auto = (e.status === 'PENDING' || e.status === 'EXCLUDED') && !e.locked && e.excludeReason !== 'USER_MANUAL' && e.translation === null;
        if (!auto)
            return e;
        const { excludeReason: _drop, ...rest } = e;
        return { ...rest, status: 'PENDING', needsClassifyReview: false };
    });
    const out = classifyEntries(reset, S.rules);
    const changed = out.filter((e, i) => {
        const o = S.entries[i];
        return e.status !== o.status || e.kind !== o.kind || e.excludeReason !== o.excludeReason || e.needsClassifyReview !== o.needsClassifyReview;
    });
    await applyChanges(changed, []);
    S.onChange();
    return changed.length;
}
const RULES_KEY = 'entr.rules';
export function loadRules() { try {
    S.rules = JSON.parse(localStorage.getItem(RULES_KEY) ?? '[]');
}
catch {
    S.rules = [];
} }
export function saveRules() { try {
    localStorage.setItem(RULES_KEY, JSON.stringify(S.rules));
}
catch { /* bỏ qua */ } }
/** Cập nhật store + lưu bền vững (checkpoint). Dùng cho runner, sửa tay, duyệt phân loại. */
export async function applyChanges(changed, audit) {
    if (changed.length) {
        const m = new Map(changed.map((c) => [c.id, c]));
        S.entries = S.entries.map((e) => m.get(e.id) ?? e);
        for (const c of changed)
            S.index.set(c.id, c);
        const newTm = [];
        for (const c of changed) {
            if (c.status === 'VERIFIED' && c.translation && c.verifiedLevel) {
                const key = tmKey(c.original, c.kind);
                const prev = S.tm.get(key);
                if (!prev || prev.verifiedLevel === 'AUTO' || c.verifiedLevel === 'HUMAN') {
                    const rec = { key, source: c.original, kind: c.kind, target: c.translation, verifiedLevel: c.verifiedLevel, updatedAt: Date.now() };
                    S.tm.set(key, rec);
                    newTm.push(rec);
                }
            }
        }
        await S.storage.putEntries(changed);
        if (newTm.length)
            await S.storage.putTm(newTm);
    }
    if (audit.length)
        await S.storage.appendAudit(audit);
    S.onProgress();
}
export const saveGlossary = async () => { await S.storage.saveGlossary(S.glossary); S.onChange(); };
export const saveCharacters = async () => { await S.storage.saveCharacters(S.characters); S.onChange(); };
export const saveSettings = async () => { await S.storage.saveSettings(S.settings); };
export function buildTranslateFn() {
    const st = () => S.settings;
    if (st().keyMode === 'DIRECT') {
        return createDirectTranslateFn(() => ({
            provider: st().provider, apiKey: S.secrets.apiKey, model: st().model, ...(st().baseUrl ? { baseUrl: st().baseUrl } : {}),
            priceInPerMTok: st().budget.priceInPerMTok, priceOutPerMTok: st().budget.priceOutPerMTok,
        }));
    }
    return createTranslateFn(() => ({
        mode: st().keyMode === 'BYO' ? 'BYO' : 'SERVER', accessToken: S.secrets.accessToken, userKey: S.secrets.apiKey, provider: st().provider,
        endpoint: new URL('api/translate', document.baseURI).href.replace(/\/api\/translate$/, '/api/translate'),
    }));
}
/** Kiểm tra chéo bằng AI (SP-6.4). Cần gọi trực tiếp nhà cung cấp (chế độ DIRECT); máy chủ Netlify chưa có điểm cuối riêng. */
export function startReview() {
    const R = S.review;
    if (R.running)
        return;
    if (S.settings.keyMode !== 'DIRECT') {
        S.notify('Kiểm tra chéo hiện chỉ dùng được ở chế độ "Trực tiếp" (Cài đặt → Kết nối AI).', 'err');
        return;
    }
    if (!S.secrets.apiKey) {
        S.notify('Hãy nhập API key trong Cài đặt.', 'err');
        S.tab = 'settings';
        S.onChange();
        return;
    }
    const st = S.settings;
    const model = st.qa.reviewModel?.trim() || st.model;
    const cap = st.budget.capUsd;
    R.running = true;
    R.done = 0;
    R.total = 0;
    R.abort = new AbortController();
    S.onChange();
    void runLlmReview({
        review: (items, glossary, opts) => callReview({ provider: st.provider, apiKey: S.secrets.apiKey, model, browser: true, ...(st.baseUrl ? { baseUrl: st.baseUrl } : {}), priceInPerMTok: st.budget.priceInPerMTok, priceOutPerMTok: st.budget.priceOutPerMTok }, items, glossary, opts),
        entries: S.entries, glossary: S.glossary, applyChanges, timeoutMs: st.timeoutMs, signal: R.abort.signal,
        onProgress: (d, t) => { R.done = d; R.total = t; S.onProgress(); },
    }, { rate: 0.1, minPerKind: 3, maxTotal: 200, capUsd: cap === null ? null : Math.max(0, cap * 0.2) }).then((sum) => {
        R.running = false;
        R.abort = null;
        R.last = sum;
        if (sum.error)
            S.notify(sum.error.message, 'err');
        else if (sum.sampled === 0)
            S.notify('Chưa có chuỗi nào đạt QA tự động để kiểm tra chéo.', 'info');
        else
            S.notify(`Đã kiểm tra ${sum.reviewed}/${sum.sampled} chuỗi: ${sum.flagged} chuỗi bị đánh dấu "Cần xem".`, sum.flagged ? 'info' : 'ok');
        S.onChange();
    });
}
export function startRun(mode, ids, limit) {
    if (S.running)
        return;
    const needKey = S.settings.keyMode !== 'SERVER' ? !S.secrets.apiKey : !S.secrets.accessToken;
    if (needKey) {
        S.notify(S.settings.keyMode === 'SERVER' ? 'Hãy nhập Token truy cập trong Cài đặt.' : 'Hãy nhập API key trong Cài đặt.', 'err');
        S.tab = 'settings';
        S.onChange();
        return;
    }
    S.running = true;
    S.paused = false;
    S.runMode = mode;
    S.liveCost = 0;
    S.batchCount = 0;
    const logEv = (ev) => {
        const line = describeEvent(ev);
        if (line) {
            S.log.push(line);
            if (S.log.length > 60)
                S.log.shift();
        }
        if (ev.type === 'paused')
            S.paused = true;
        if (ev.type === 'resumed')
            S.paused = false;
        if (ev.type === 'batch-done') {
            S.batchCount++;
            if (S.batchCount % 25 === 0)
                S.notify('Nhớ bấm "Sao lưu dự án" để không mất dữ liệu nếu trình duyệt xoá bộ nhớ.', 'info');
        }
        if (ev.type === 'budget')
            S.notify('Đã chạm trần ngân sách — tạm dừng. Tăng trần trong Cài đặt rồi bấm Tiếp tục.', 'err');
        if (ev.type === 'finished') {
            S.running = false;
            S.paused = false;
            S.lastRun = ev.summary;
        }
        S.onProgress();
    };
    const ctl = startTranslation({
        translate: buildTranslateFn(),
        getContext: () => ({ projectId: S.meta?.id ?? 'p', glossary: S.glossary, characters: S.characters, examples: S.examples, settings: S.settings, tm: S.tm }),
        getEntries: () => S.entries,
        applyChanges,
        onEvent: logEv,
    }, { ...(ids ? { ids } : {}), ...(limit !== undefined ? { limit } : {}) });
    S.runner = ctl;
    ctl.promise.then((sum) => {
        S.running = false;
        S.paused = false;
        S.lastRun = sum;
        S.runner = null;
        if (sum.fatal)
            S.notify(sum.fatal.message, 'err');
        S.onChange();
    });
    S.onChange();
}
function describeEvent(ev) {
    switch (ev.type) {
        case 'started': return `Bắt đầu: ${ev.total} chuỗi`;
        case 'batch-error': return `Lô ${ev.batchId}: ${ev.error.message}${ev.willRetry ? ' (sẽ thử lại)' : ''}`;
        case 'retry-wait': return `Chờ ${(ev.ms / 1000).toFixed(1)}s rồi thử lại lô ${ev.batchId}`;
        case 'budget': return `Chạm trần ngân sách (${ev.costUsd.toFixed(3)} USD)`;
        case 'paused': return 'Đã tạm dừng';
        case 'resumed': return 'Tiếp tục';
        case 'fatal': return `Dừng: ${ev.error.message}`;
        case 'finished': return `Xong: ${ev.summary.verified} đạt QA, ${ev.summary.reviewRequired} cần xem, ${ev.summary.fromTm} từ TM`;
        default: return '';
    }
}
export { isBackup };
