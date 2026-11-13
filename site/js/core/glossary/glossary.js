import { hashStr } from '../extract/extract.js';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function termRegex(term) {
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(term.source)}(?![\\p{L}\\p{N}_])`, term.caseSensitive ? 'u' : 'iu');
}
export function termsInText(text, glossary) {
    return glossary.filter((t) => t.source.trim() !== '' && termRegex(t).test(text));
}
/** Chỉ gửi cho AI các thuật ngữ thực sự xuất hiện trong batch (tiết kiệm token). */
export function relevantTerms(texts, glossary) {
    const joined = texts.join('\n');
    return termsInText(joined, glossary);
}
export function findGlossaryConflicts(glossary) {
    const seen = new Map();
    const out = [];
    for (const t of glossary) {
        const k = t.caseSensitive ? t.source : t.source.toLowerCase();
        const prev = seen.get(k);
        if (prev && prev.target !== t.target)
            out.push(`"${t.source}" có nhiều bản dịch: "${prev.target}" / "${t.target}"`);
        else
            seen.set(k, t);
    }
    return out;
}
const COMMON_CAPS = new Set(['the', 'you', 'your', 'a', 'an', 'i', 'it', 'we', 'he', 'she', 'they', 'this', 'that', 'there', 'what', 'when', 'where', 'who', 'why', 'how', 'if', 'and', 'but', 'or', 'not', 'no', 'yes', 'ok', 'press', 'click', 'tap', 'to', 'in', 'on', 'for', 'with', 'from', 'by', 'at', 'of', 'new', 'all', 'my', 'our', 'their', 'his', 'her', 'is', 'are', 'was', 'be', 'do', 'don', 'let', 'please', 'welcome', 'hello', 'thank', 'thanks']);
/** Terminology Pre-pass: gợi ý tên riêng/thuật ngữ để người dùng duyệt TRƯỚC khi dịch hàng loạt. */
export function extractTermCandidates(entries, glossary, minCount = 2, limit = 300) {
    const known = new Set(glossary.map((g) => g.source.toLowerCase()));
    const map = new Map();
    const add = (s, kind, weight = 1) => {
        const key = s.trim();
        if (key.length < 2 || known.has(key.toLowerCase()))
            return;
        const cur = map.get(key) ?? { count: 0, kinds: new Set() };
        cur.count += weight;
        cur.kinds.add(kind);
        map.set(key, cur);
    };
    const CAP_SEQ = /\b[A-Z][\p{L}'’-]+(?:\s+(?:of|the|de|du|van|von)?\s*[A-Z][\p{L}'’-]+)*/gu;
    for (const e of entries) {
        if (e.status === 'EXCLUDED')
            continue;
        const words = e.original.trim().split(/\s+/);
        // Chuỗi ngắn thuộc loại tên (nhân vật/vật phẩm/kỹ năng) là ứng viên trực tiếp.
        if (words.length <= 4 && (e.kind === 'CHARACTER' || e.kind === 'ITEM' || e.kind === 'SKILL') && /^[A-Z]/.test(e.original)) {
            add(e.original.trim(), e.kind, minCount);
        }
        for (const m of e.original.matchAll(CAP_SEQ)) {
            const phrase = m[0];
            const idx = m.index ?? 0;
            const first = phrase.split(/\s+/)[0] ?? '';
            const singleWord = !/\s/.test(phrase);
            const atSentenceStart = idx === 0 || /[.!?…:"“]\s*$/.test(e.original.slice(Math.max(0, idx - 3), idx));
            if (singleWord && (COMMON_CAPS.has(first.toLowerCase()) || atSentenceStart))
                continue;
            if (COMMON_CAPS.has(first.toLowerCase()) && !/\s/.test(phrase))
                continue;
            add(phrase, e.kind);
        }
    }
    return [...map.entries()]
        .filter(([, v]) => v.count >= minCount)
        .map(([source, v]) => ({ source, count: v.count, kinds: [...v.kinds], suggestKeep: v.kinds.has('CHARACTER') }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}
// ---------------- Translation Memory ----------------
export const tmKey = (source, kind) => hashStr(`${kind}\u0000${source}`);
export function tmFromEntries(entries, now = Date.now()) {
    const out = new Map();
    for (const e of entries) {
        if (e.status !== 'VERIFIED' || !e.translation || !e.verifiedLevel)
            continue;
        const key = tmKey(e.original, e.kind);
        const prev = out.get(key);
        // Ưu tiên bản người xác nhận
        if (!prev || (prev.verifiedLevel === 'AUTO' && e.verifiedLevel === 'HUMAN')) {
            out.set(key, { key, source: e.original, kind: e.kind, target: e.translation, verifiedLevel: e.verifiedLevel, updatedAt: now });
        }
    }
    return [...out.values()];
}
