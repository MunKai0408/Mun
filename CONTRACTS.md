# CONTRACTS — Nguồn sự thật về kiểu dữ liệu & interface dùng chung

**Quy tắc:** mã trong `src/contracts/` phải khớp file này. Muốn đổi → sửa file này + DECISIONS.md + CHANGELOG.md (đánh dấu `BREAKING`) TRƯỚC khi sửa code. Phiên bản contract: `1.0.0`.

```ts
// ---------- Cơ bản ----------
export type EntryId = string;        // "s_" + hash ổn định của pointer (+ "#dupN" nếu key trùng)
export type JsonPointer = string;    // RFC 6901, ví dụ "/ui/buttons/0/label"

export type StringKind =
  | 'UI' | 'DIALOGUE' | 'ITEM' | 'SKILL' | 'CHARACTER' | 'QUEST'
  | 'TUTORIAL' | 'SYSTEM' | 'DESCRIPTION' | 'OTHER';

export type EntryStatus =
  | 'PENDING' | 'TRANSLATING' | 'TRANSLATED' | 'QA_FAILED'
  | 'RETRYING' | 'REVIEW_REQUIRED' | 'VERIFIED' | 'EXCLUDED';

export type VerifiedLevel = 'AUTO' | 'HUMAN';

export type ExcludeReason =
  | 'EMPTY' | 'ID_OR_CODE' | 'PATH_OR_URL' | 'COLOR_OR_HEX' | 'NUMERIC'
  | 'ALREADY_VIETNAMESE' | 'NOT_ENGLISH' | 'USER_RULE' | 'USER_MANUAL' | 'KEEP_AS_IS_GLOSSARY';

export type Severity = 'BLOCKER' | 'MAJOR' | 'MINOR' | 'INFO';

// ---------- Lỗi ----------
export type ErrorCode =
  | 'JSON_SYNTAX' | 'JSON_DUPLICATE_KEY' | 'JSON_TOO_LARGE'
  | 'API_TIMEOUT' | 'API_RATE_LIMIT' | 'API_AUTH' | 'API_BAD_RESPONSE' | 'API_PROVIDER_ERROR'
  | 'BATCH_ID_MISMATCH' | 'BUDGET_EXCEEDED'
  | 'STORAGE_QUOTA' | 'STORAGE_CORRUPT' | 'EXPORT_VALIDATION_FAILED' | 'INTERNAL';

export interface AppError {
  code: ErrorCode;
  message: string;          // tiếng Việt, hiển thị được cho người dùng
  retryable: boolean;
  details?: Record<string, unknown>;
}

// ---------- JSON parse (core/json) ----------
export interface JsonSpan { start: number; end: number }   // offset trong văn bản gốc, [start, end)

export interface ParsedStringLiteral {
  pointer: JsonPointer;
  dupIndex: number;         // 0 nếu không trùng key
  keyPath: string[];        // đường dẫn key/chỉ số dạng mảng
  value: string;            // giá trị đã giải escape
  rawLiteral: string;       // nguyên văn kể cả dấu ngoặc kép
  span: JsonSpan;           // vị trí literal trong source
}

export interface ParseIssue { severity: Severity; code: ErrorCode; message: string; line: number; column: number }

export interface ParseResult {
  ok: boolean;
  source: string;           // văn bản gốc nguyên vẹn (đã bỏ BOM, hasBom ghi riêng)
  hasBom: boolean;
  newline: 'LF' | 'CRLF' | 'MIXED';
  strings: ParsedStringLiteral[];   // theo thứ tự xuất hiện
  nonStringCount: number;
  issues: ParseIssue[];
}
export declare function parseJson(text: string): ParseResult;

// ---------- Entry (dữ liệu dịch) ----------
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
  kindConfidence: number;          // 0..1
  needsClassifyReview: boolean;

  translation: string | null;
  status: EntryStatus;
  verifiedLevel?: VerifiedLevel;
  excludeReason?: ExcludeReason;

  translationSource?: 'AI' | 'TM' | 'GLOSSARY' | 'MANUAL';
  provider?: string; model?: string;

  qa: QaResult | null;
  retryCount: number;
  error?: AppError;
  locked: boolean;                 // người dùng khoá → không dịch lại
  manualEdit: boolean;
  contextNeighbors?: EntryId[];    // chuỗi lân cận chỉ để tham khảo
  updatedAt: number;
}

export interface QaIssue { code: string; severity: Severity; message: string; evidence?: string }
export interface QaResult { passed: boolean; score: number; issues: QaIssue[]; checkedAt: number }

// ---------- Glossary / Character / TM ----------
export interface GlossaryTerm {
  id: string; source: string; target: string;
  category: 'ITEM'|'SKILL'|'CHARACTER'|'LOCATION'|'UI'|'GENERAL';
  keepAsIs: boolean; caseSensitive: boolean; note?: string;
}
export interface CharacterProfile {
  id: string; name: string; viName?: string; gender?: 'M'|'F'|'N';
  age?: string; role?: string; voice?: string;
  selfPronoun?: string;                       // xưng
  addressMap?: Record<string, string>;        // gọi nhân vật khác bằng gì
}
export interface TmRecord { key: string; /* hash(source + kind) */ source: string; kind: StringKind; target: string; verifiedLevel: VerifiedLevel; updatedAt: number }

// ---------- Batch & API ----------
export interface BatchItem { id: EntryId; text: string; kind: StringKind; hint?: string }
export interface TranslateRequest {
  projectId: string;
  batchId: string;
  items: BatchItem[];
  neighbors?: { id: EntryId; text: string }[];     // chỉ tham khảo, KHÔNG dịch
  glossary: Pick<GlossaryTerm,'source'|'target'|'keepAsIs'>[];
  characters?: CharacterProfile[];
  styleGuideVersion: string;
  examples?: { source: string; target: string }[]; // few-shot đã duyệt
  options?: { provider?: string; model?: string };
}
export interface TranslateResponse {
  batchId: string;
  results: { id: EntryId; translation: string }[];
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
  provider: string; model: string;
}

export interface AiProvider {
  name: string;
  translate(req: TranslateRequest, opts: { signal?: AbortSignal; timeoutMs: number }): Promise<TranslateResponse>;
}

// ---------- Cấu hình (giá trị mặc định ở một nơi: src/contracts/defaults.ts) ----------
export interface AppSettings {
  batch: { maxItems: number; maxChars: number; concurrency: number };   // mặc định 30 / 5000 / 2
  retry: { max: number; baseDelayMs: number };                          // mặc định 3 / 1000
  qa:    { maxLengthRatio: number; enableLlmReview: boolean };          // mặc định 1.8 / false
  budget:{ capUsd: number | null };
  keyMode: 'SERVER' | 'BYO';
}

// ---------- Completeness & Export ----------
export interface CompletenessReport {
  total: number; pending: number; inProgress: number; translated: number;
  verifiedAuto: number; verifiedHuman: number; excluded: number;
  reviewRequired: number; qaFailed: number; blockerOpen: number; majorOpen: number;
  canFinalize: boolean; blockers: string[];
}
export interface ExportValidationReport {
  ok: boolean; keySetEqual: boolean; structureEqual: boolean; valueTypesEqual: boolean;
  stringCountEqual: boolean; placeholdersOk: boolean; tagsOk: boolean; untouchedEqual: boolean;
  identityRoundTripOk: boolean; issues: string[];
}
export declare function exportVi(source: ParseResult, entries: StringEntry[],
  mode: 'FINAL' | 'PARTIAL'): { text: string; report: ExportValidationReport };
```

## Ghi chú hợp đồng
- `EntryId` ổn định giữa các lần mở lại cùng `en.json` (dựa pointer), nên tiến độ không lệch nếu người dùng upload lại cùng file.
- Merge dùng `span` để thay literal; chuỗi mới phải được encode JSON hợp lệ (escape `"`, `\`, điều khiển; giữ Unicode nguyên bản trừ khi file gốc dùng `\uXXXX` — xem D-004).
- `translation` luôn chuẩn hoá NFC.

---
## Thay đổi v1.1.0 (2026-11-13) — bản chuẩn thực thi: `src/contracts/types.ts`
- `ExcludeReason` thêm `NO_LETTERS`. `ErrorCode` thêm `JSON_TOO_DEEP`, `API_NETWORK`, `QA_FAILED`, `INVALID_TRANSITION`.
- `ParseResult.maxDepth`; `ParsedStringLiteral.dupIndex` là thứ tự xuất hiện trong số các chuỗi cùng pointer.
- `StringEntry.qaHint` (gợi ý sửa lỗi gửi kèm khi dịch lại). `BatchItem.fix` thay cho `hint`. `TranslateRequest.neighbors` bắt buộc chỉ để tham khảo.
- `AppSettings`: `keyMode: 'SERVER'|'BYO'|'DIRECT'`, thêm `provider`, `baseUrl`, `timeoutMs`; `budget` có `priceInPerMTok/priceOutPerMTok`. Mặc định batch 20/3500/2.
- `exportVi(parse, entries)` trả `{text, report}` (không có tham số `mode`; chuỗi chưa TRANSLATED/VERIFIED luôn giữ nguyên bản gốc).
- Thêm `ProgressSummary`, `AuditRecord`, `TranslateFn`.

### Thay đổi v1.2.0 (SP-6.4)
- `AppSettings.qa.reviewModel?: string` (tuỳ chọn). Chuyển trạng thái mới hợp lệ: `VERIFIED → REVIEW_REQUIRED`.
- Kiểu mới nội bộ (không nằm trong types.ts): `ReviewItem`, `ReviewVerdict` trong `src/core/review/review.ts`.
