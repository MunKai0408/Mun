// SP-3.2 Batcher: chia lô theo thứ tự tài liệu (giữ mạch ngữ cảnh), không cắt chuỗi, gộp chuỗi trùng.
import type { BatchItem, StringEntry } from '../../contracts/types.js';
import { tmKey } from '../glossary/glossary.js';

export interface Batch {
  id: string;
  items: BatchItem[];
  neighbors: { id: string; text: string }[];
  /** id đại diện → danh sách entry trùng (cùng nguồn + loại) sẽ nhận lại bản dịch */
  followers: Map<string, string[]>;
}

export interface BatchLimits { maxItems: number; maxChars: number }

export function contextOf(e: StringEntry): string {
  return e.keyPath.join('.');
}

/**
 * @param candidates entry cần dịch (đã lọc), theo thứ tự tài liệu
 * @param all toàn bộ entry theo thứ tự tài liệu (để lấy chuỗi lân cận chỉ để tham khảo)
 */
export function makeBatches(candidates: StringEntry[], all: StringEntry[], limits: BatchLimits, idPrefix = 'b'): Batch[] {
  const indexById = new Map<string, number>();
  all.forEach((e, i) => indexById.set(e.id, i));

  // Gộp trùng: cùng (original, kind) chỉ gửi một lần
  const reps = new Map<string, StringEntry>();
  const followersByKey = new Map<string, string[]>();
  const ordered: StringEntry[] = [];
  for (const e of candidates) {
    const k = tmKey(e.original, e.kind) + (e.qaHint ? `#${e.id}` : ''); // chuỗi có gợi ý sửa lỗi gửi riêng
    const rep = reps.get(k);
    if (rep) followersByKey.get(k)!.push(e.id);
    else { reps.set(k, e); followersByKey.set(k, []); ordered.push(e); }
  }
  const followersOf = new Map<string, string[]>();
  for (const [k, rep] of reps) followersOf.set(rep.id, followersByKey.get(k) ?? []);

  const batches: Batch[] = [];
  let cur: StringEntry[] = [];
  let chars = 0;
  const flush = () => {
    if (!cur.length) return;
    const first = indexById.get(cur[0]!.id) ?? 0;
    const last = indexById.get(cur[cur.length - 1]!.id) ?? first;
    const inBatch = new Set(cur.map((c) => c.id));
    const neighbors: { id: string; text: string }[] = [];
    for (const idx of [first - 2, first - 1, last + 1, last + 2]) {
      const n = all[idx];
      if (n && !inBatch.has(n.id) && n.original.trim() !== '') neighbors.push({ id: n.id, text: n.original.slice(0, 300) });
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
    if (cur.length && (cur.length >= limits.maxItems || chars + len > limits.maxChars)) flush();
    cur.push(e);
    chars += len; // chuỗi dài hơn maxChars vẫn đi một mình trong lô riêng
  }
  flush();
  return batches;
}
