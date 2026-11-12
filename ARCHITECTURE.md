# ARCHITECTURE

## 1. Tổng quan
```
Trình duyệt (React + TS)                       Netlify
┌───────────────────────────────────┐        ┌───────────────────────────┐
│ UI (pages/components)             │        │ functions/translate.ts    │
│   ↕ hooks/stores                  │  HTTPS │  - auth token + rate limit│
│ Orchestrator (hàng đợi dịch)  ────┼───────►│  - validate input         │
│   ↕                               │        │  - gọi AI Provider        │
│ Core (thuần, không DOM):          │        │  - trả JSON có cấu trúc   │
│  parser · extractor · classifier  │◄───────┼───────────────────────────┘
│  batch · prompt · qa · repair     │        │ (stateless, không lưu dữ liệu)
│  merger · exporter · glossary/TM  │
│   ↕                               │
│ Web Worker (parse/QA/merge lớn)   │
│ Storage: IndexedDB (idb)          │
└───────────────────────────────────┘
```
Nguyên tắc: `src/core/**` là hàm thuần, không import React/DOM/IndexedDB → test bằng Vitest nhanh, chạy được trong Worker. Phụ thuộc chỉ đi một chiều: `ui → services → core`; `core` không phụ thuộc ngược.

## 2. Quyết định kiến trúc then chốt
1. **Parser giữ token + vị trí (offset).** Export thực hiện bằng cách *thay thế nguyên văn* các literal chuỗi tại offset đã ghi trong văn bản gốc (splice), không serialize lại cả cây. Nhờ đó giữ nguyên key, thứ tự, thụt lề, CRLF, BOM, escape của mọi phần không dịch; Identity Round-trip là byte-for-byte. (DECISIONS D-004)
2. **Orchestrator ở client.** Mỗi request tới Function chỉ chứa một batch. Không phụ thuộc request dài. (D-002)
3. **Trạng thái chỉ ở IndexedDB.** Server stateless. Ghi theo giao dịch sau mỗi batch (checkpoint). (D-006)
4. **QA độc lập với Translation Engine.** `core/qa` không import `core/translate`. (Phase 6)
5. **Provider adapter.** Interface `AiProvider` + `MockProvider` cho test. (D-007)
6. **Ranh giới an toàn:** nội dung chuỗi luôn là dữ liệu; hiển thị bằng text node, không `innerHTML`. (D-011)

## 3. Luồng dữ liệu & vòng đời chuỗi
`StringEntry` được tạo ở Extract (status PENDING). Chuyển trạng thái chỉ qua `transition()` trong `core/state` (kiểm tra bảng chuyển hợp lệ + ghi audit log):
```
PENDING ─► TRANSLATING ─► TRANSLATED ─► VERIFIED (qua QA bắt buộc)
                              │
                              └─► QA_FAILED ─► RETRYING ─► TRANSLATING …
                                       │
                          vượt retry ──┴─► REVIEW_REQUIRED ─► (người dùng) TRANSLATED/VERIFIED
mọi trạng thái ─► EXCLUDED (bắt buộc có reasonCode)      EXCLUDED ─► PENDING (gỡ loại trừ)
```
Người dùng sửa tay: → TRANSLATED + cờ `manualEdit`, chạy QA lại; người dùng bấm xác nhận → VERIFIED-HUMAN.

## 4. Module & trách nhiệm
| Module | Đường dẫn | Phase | Owner |
|---|---|---|---|
| Types/Contracts | `src/contracts/` | 0–1 | Claude 1 |
| JSON tokenizer/parser | `src/core/json/parse.ts` | 2.1 | Claude 2 |
| Validator | `src/core/json/validate.ts` | 2.2 | Claude 2 |
| Extractor | `src/core/extract/extract.ts` | 2.3 | Claude 2 |
| Classifier | `src/core/classify/` | 2.4 | Claude 2 |
| Batcher | `src/core/batch/` | 3.2 | Claude 2 |
| Progress | `src/core/progress/` | 3.3 | Claude 2 |
| State machine | `src/core/state/` | 3.1/6.5 | Claude 2 (bảng) + Claude 4 (QA) |
| Storage | `src/services/storage/` | 1.3 | Claude 1/3 |
| AI adapter | `src/services/ai/` + `netlify/functions/` | 4.1 | Claude 4 |
| Prompt engine | `src/core/translate/prompt.ts` | 4.2 | Claude 4 |
| Orchestrator | `src/services/orchestrator/` | 4.3–4.4 | Claude 4 |
| Glossary/TM/Character | `src/core/glossary/`, `src/core/tm/` | 5 | Claude 4 |
| QA validators | `src/core/qa/` | 6 | Claude 4 |
| Repair | `src/core/repair/` | 7 | Claude 4 |
| Completeness | `src/core/completeness/` | 7.4 | Claude 4 |
| Merger/Exporter | `src/core/export/` | 9 | Claude 2 |
| UI | `src/ui/` | 8 | Claude 3 |

## 5. Cây thư mục mục tiêu
```
en-json-translator/
├─ docs/MASTER_PROMPT.md, STYLE_GUIDE_VI.md, USER_GUIDE.md (Phase 11)
├─ PROJECT_SPEC.md ARCHITECTURE.md CONTRACTS.md DECISIONS.md TASKS.md
├─ PROGRESS.md HANDOFF.md NEXT_TASK.md CHANGELOG.md KNOWN_ISSUES.md TESTING.md
├─ netlify.toml  .env.example  package.json  vite.config.ts  tsconfig.json
├─ netlify/functions/translate.ts  netlify/functions/_lib/*
├─ src/
│  ├─ contracts/ (types dùng chung — khớp CONTRACTS.md)
│  ├─ core/ {json,extract,classify,batch,progress,state,translate,glossary,tm,qa,repair,completeness,export}
│  ├─ services/ {storage,ai,orchestrator,backup,cost}
│  ├─ workers/
│  ├─ ui/ {pages,components,hooks}
│  └─ main.tsx
├─ tests/ {unit,integration,e2e,fixtures}
└─ .github/workflows/ci.yml
```

## 6. Lưu trữ (IndexedDB, DB `entr`)
Stores: `projects`, `entries` (key: `projectId+id`), `batches`, `glossary`, `characters`, `tm`, `auditLog`, `snapshots`, `settings`, `sources` (văn bản gốc nguyên vẹn, bất biến). Schema có `version` + migration. Ghi theo giao dịch. Yêu cầu `navigator.storage.persist()`.

## 7. API Function
`POST /.netlify/functions/translate` — header `Authorization: Bearer <accessToken>` (chế độ A) hoặc `X-User-Key` (chế độ B, không log). Body/response xem CONTRACTS.md (`TranslateRequest`/`TranslateResponse`). Giới hạn: số chuỗi/batch, tổng ký tự, Origin allowlist, rate limit.

## 8. Lỗi
Mọi lỗi dùng `AppError {code, message, retryable, details?}` (CONTRACTS.md). Không nuốt lỗi lặng lẽ. Lỗi một chuỗi/batch không dừng toàn tiến trình.
