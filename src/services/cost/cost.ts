// SP-4.x / F-15 Ước tính chi phí (Dry-run) và theo dõi chi phí.
import type { AppSettings, StringEntry } from '../../contracts/types.js';

export interface CostEstimate {
  strings: number;
  uniqueStrings: number;
  chars: number;
  batches: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

const PROMPT_OVERHEAD_TOKENS = 900; // system prompt + glossary trung bình mỗi lô

export function estimateCost(entries: StringEntry[], settings: AppSettings): CostEstimate {
  const todo = entries.filter((e) => e.status === 'PENDING' && !e.needsClassifyReview || e.status === 'RETRYING');
  const seen = new Set<string>();
  let chars = 0;
  let unique = 0;
  for (const e of todo) {
    const k = e.kind + '\u0000' + e.original;
    if (seen.has(k)) continue;
    seen.add(k);
    unique++;
    chars += e.original.length;
  }
  const batches = Math.max(unique === 0 ? 0 : 1, Math.ceil(unique / settings.batch.maxItems), Math.ceil(chars / settings.batch.maxChars));
  const inputTokens = Math.round(chars / 3.5) + unique * 18 + batches * PROMPT_OVERHEAD_TOKENS;
  const outputTokens = Math.round((chars / 3.5) * 1.6) + unique * 14;
  const { priceInPerMTok: pi, priceOutPerMTok: po } = settings.budget;
  const costUsd = pi !== null && po !== null ? (inputTokens * pi + outputTokens * po) / 1_000_000 : null;
  return { strings: todo.length, uniqueStrings: unique, chars, batches, inputTokens, outputTokens, costUsd };
}
