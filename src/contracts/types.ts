// Contracts v1.1.0 — khớp CONTRACTS.md. Đổi ở đây phải đổi CONTRACTS.md + DECISIONS + CHANGELOG.

export type EntryId = string;
export type JsonPointer = string;

export type StringKind =
  | 'UI' | 'DIALOGUE' | 'ITEM' | 'SKILL' | 'CHARACTER' | 'QUEST'
  | 'TUTORIAL' | 'SYSTEM' | 'DESCRIPTION' | 'OTHER';

export type EntryStatus =
  | 'PENDING' | 'TRANSLATING' | 'TRANSLATED' | 'QA_FAILED'
  | 'RETRYING' | 'REVIEW_REQUIRED' | 'VERIFIED' | 'EXCLUDED';

export type VerifiedLevel = 'AUTO' | 'HUMAN';

export type ExcludeReason =
  | 'EMPTY' | 'NO_LETTERS' | 'ID_OR_CODE' | 'PATH_OR_URL' | 'COLOR_OR_HEX' | 'NUMERIC'
  | 'ALREADY_VIETNAMESE' | 'NOT_ENGLISH' | 'USER_RULE' | 'USER_MANUAL' | 'KEEP_AS_IS_GLOSSARY';

export type Severity = 'BLOCKER' | 'MAJOR' | 'MINOR' | 'INFO';

export type ErrorCode =
  | 'JSON_SYNTAX' | 'JSON_DUPLICATE_KEY' | 'JSON_TOO_DEEP' | 'JSON_TOO_LARGE'
  | 'API_TIMEOUT' | 'API_RATE_LIMIT' | 'API_AUTH' | 'API_BAD_RESPONSE' | 'API_PROVIDER_ERROR' | 'API_NETWORK'
  | 'BATCH_ID_MISMATCH' | 'BUDGET_EXCEEDED' | 'QA_FAILED'
  | 'STORAGE_QUOTA' | 'STORAGE_CORRUPT' | 'EXPORT_VALIDATION_FAILED' | 'INVALID_TRANSITION' | 'INTERNAL';

export interface AppError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface JsonSpan { start: number; end: number }

export interface ParsedStringLiteral {
  pointer: JsonPointer;
  dupIndex: number;
  keyPath: string[];
  value: string;
  rawLiteral: string;
  span: JsonSpan;
}

export interface ParseIssue { severity: Severity; code: ErrorCode; message: string; line: number; column: number }

export interface ParseResult {
  ok: boolean;
  source: string;
  hasBom: boolean;
  newline: 'LF' | 'CRLF' | 'MIXED';
  strings: ParsedStringLiteral[];
  nonStringCount: number;
  maxDepth: number;
  issues: ParseIssue[];
}

export interface QaIssue { code: string; severity: Severity; message: string; evidence?: string }
export interface QaResult { passed: boolean; score: number; issues: QaIssue[]; checkedAt: number }

export interface StringEntry {
  id: EntryId;
  projectId: string;
  pointer: JsonPointer;
  dupIndex: number;
  keyPath: string[];
  original: string;
  originalHash: string;
  span: JsonSpan;

  kind: StringKind;
  kindConfidence: number;
  needsClassifyReview: boolean;

  translation: string | null;
  status: EntryStatus;
  verifiedLevel?: VerifiedLevel;
  excludeReason?: ExcludeReason;

  translationSource?: 'AI' | 'TM' | 'GLOSSARY' | 'MANUAL';
  provider?: string;
  model?: string;

  qa: QaResult | null;
  retryCount: number;
  error?: AppError;
  qaHint?: string;
  locked: boolean;
  manualEdit: boolean;
  updatedAt: number;
}

export interface GlossaryTerm {
  id: string;
  source: string;
  target: string;
  category: 'ITEM' | 'SKILL' | 'CHARACTER' | 'LOCATION' | 'UI' | 'GENERAL';
  keepAsIs: boolean;
  caseSensitive: boolean;
  note?: string;
}

export interface CharacterProfile {
  id: string;
  name: string;
  viName?: string;
  gender?: 'M' | 'F' | 'N';
  age?: string;
  role?: string;
  voice?: string;
  selfPronoun?: string;
  addressMap?: Record<string, string>;
}

export interface TmRecord { key: string; source: string; kind: StringKind; target: string; verifiedLevel: VerifiedLevel; updatedAt: number }

export interface BatchItem { id: EntryId; text: string; kind: StringKind; context?: string; fix?: string }
export interface TranslateRequest {
  projectId: string;
  batchId: string;
  items: BatchItem[];
  neighbors?: { id: EntryId; text: string }[];
  glossary: Pick<GlossaryTerm, 'source' | 'target' | 'keepAsIs'>[];
  characters?: CharacterProfile[];
  styleGuideVersion: string;
  examples?: { source: string; target: string }[];
  options?: { provider?: string; model?: string };
}
export interface TranslateResponse {
  batchId: string;
  results: { id: EntryId; translation: string }[];
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
  provider: string;
  model: string;
}
export type TranslateFn = (req: TranslateRequest, opts: { signal?: AbortSignal; timeoutMs: number }) => Promise<TranslateResponse>;

export interface AppSettings {
  batch: { maxItems: number; maxChars: number; concurrency: number };
  retry: { max: number; baseDelayMs: number };
  qa: { maxLengthRatio: number; enableLlmReview: boolean; /** Mô hình dùng cho kiểm tra chéo; trống = dùng cùng mô hình dịch. */ reviewModel?: string };
  budget: { capUsd: number | null; priceInPerMTok: number | null; priceOutPerMTok: number | null };
  /** SERVER: máy chủ Netlify giữ key | BYO: key người dùng đi qua máy chủ | DIRECT: trình duyệt gọi thẳng nhà cung cấp (GitHub Pages) */
  keyMode: 'SERVER' | 'BYO' | 'DIRECT';
  provider: 'anthropic' | 'openai';
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export interface ProgressSummary {
  total: number; pending: number; translating: number; translated: number; qaFailed: number;
  retrying: number; reviewRequired: number; verified: number; excluded: number; needsClassifyReview: number;
  translatedPct: number; verifiedPct: number;
}

export interface CompletenessReport {
  total: number; toTranslate: number; pending: number; inProgress: number; translated: number;
  verifiedAuto: number; verifiedHuman: number; excluded: number; excludedWithoutReason: number;
  reviewRequired: number; qaFailed: number; unclassified: number; blockerOpen: number; majorOpen: number;
  canFinalize: boolean; blockers: string[];
}

export interface ExportValidationReport {
  ok: boolean; keySetEqual: boolean; structureEqual: boolean; valueTypesEqual: boolean;
  stringCountEqual: boolean; placeholdersOk: boolean; tagsOk: boolean; untouchedEqual: boolean;
  identityRoundTripOk: boolean; issues: string[];
}

export interface AuditRecord { id: EntryId; from: EntryStatus; to: EntryStatus; at: number; note?: string }
