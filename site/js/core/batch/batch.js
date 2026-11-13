import { tmKey } from '../glossary/glossary.js';
export function contextOf(e) {
    return e.keyPath.join('.');
}
/**
 * @param candidates entry cần dịch (đã lọc), theo thứ tự tài liệu
 * @param all toàn bộ entry theo thứ tự tài liệu (để lấy chuỗi lân cận chỉ để tham khảo)
 */
export function makeBatches(candidates, all, limits, idPrefix = 'b') {
    const indexById = new Map();
    all.forEach((e, i) => indexById.set(e.id, i));
    // Gộp trùng: cùng (original, kind) chỉ gửi một lần
    const reps = new Map();
    const followersByKey = new Map();
    const ordered = [];
    for (const e of candidates) {
        const k = tmKey(e.original, e.kind) + (e.qaHint ? `#${e.id}` : ''); // chuỗi có gợi ý sửa lỗi gửi riêng
        const rep = reps.get(k);
        if (rep)
            followersByKey.get(k).push(e.id);
        else {
            reps.set(k, e);
            followersByKey.set(k, []);
            ordered.push(e);
        }
    }
    const followersOf = new Map();
    for (const [k, rep] of reps)
        followersOf.set(rep.id, followersByKey.get(k) ?? []);
    const batches = [];
    let cur = [];
    let chars = 0;
    const flush = () => {
        if (!cur.length)
            return;
        const first = indexById.get(cur[0].id) ?? 0;
        const last = indexById.get(cur[cur.length - 1].id) ?? first;
        const inBatch = new Set(cur.map((c) => c.id));
        const neighbors = [];
        for (const idx of [first - 2, first - 1, last + 1, last + 2]) {
            const n = all[idx];
            if (n && !inBatch.has(n.id) && n.original.trim() !== '')
                neighbors.push({ id: n.id, text: n.original.slice(0, 300) });
        }
        batches.push({
            id: `${idPrefix}${batches.length + 1}`,
            items: cur.map((e) => ({ id: e.id, text: e.original, kind: e.kind, context: contextOf(e), ...(e.qaHint ? { fix: e.qaHint } : {}) })),
            neighbors,
            followers: new Map(cur.map((e) => [e.id, followersOf.get(e.id) ?? []])),
        });
        cur = [];
        chars = 0;
    };
    for (const e of ordered) {
        const len = e.original.length;
        if (cur.length && (cur.length >= limits.maxItems || chars + len > limits.maxChars))
            flush();
        cur.push(e);
        chars += len; // chuỗi dài hơn maxChars vẫn đi một mình trong lô riêng
    }
    flush();
    return batches;
}
