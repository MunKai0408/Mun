/** cyrb53 — hash 53-bit nhanh, không mật mã. */
export function hash53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
export const hashStr = (s) => hash53(s).toString(36);
export function extractEntries(parse, projectId, now = Date.now()) {
    const used = new Set();
    return parse.strings.map((s) => {
        let id = 's_' + hashStr(`${s.pointer}#${s.dupIndex}`);
        // Va chạm hash gần như không thể xảy ra, nhưng đảm bảo id luôn duy nhất.
        for (let n = 1; used.has(id); n++)
            id = 's_' + hashStr(`${s.pointer}#${s.dupIndex}#c${n}`);
        used.add(id);
        return {
            id, projectId, pointer: s.pointer, dupIndex: s.dupIndex, keyPath: s.keyPath,
            original: s.value, originalHash: hashStr(s.value), span: s.span,
            kind: 'OTHER', kindConfidence: 0, needsClassifyReview: false,
            translation: null, status: 'PENDING', qa: null, retryCount: 0,
            locked: false, manualEdit: false, updatedAt: now,
        };
    });
}
