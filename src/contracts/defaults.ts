import type { AppSettings } from './types.js';

export const STYLE_GUIDE_VERSION = '0.1';

export const DEFAULT_SETTINGS: AppSettings = {
  batch: { maxItems: 20, maxChars: 3500, concurrency: 2 },
  retry: { max: 3, baseDelayMs: 1000 },
  qa: { maxLengthRatio: 1.8, enableLlmReview: false },
  budget: { capUsd: null, priceInPerMTok: null, priceOutPerMTok: null },
  keyMode: 'SERVER',
  provider: 'anthropic',
  baseUrl: '',
  model: '',
  timeoutMs: 28000,
};
