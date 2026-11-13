# CHANGELOG

## [Chưa phát hành]
### 2026-11-12 — Phase 0 (Claude 1)
- Thêm: PROJECT_SPEC, ARCHITECTURE, CONTRACTS v1.0.0, DECISIONS (A-001..A-006, D-001..D-014), STYLE_GUIDE_VI v0.1, TASKS, PROGRESS, HANDOFF, NEXT_TASK, KNOWN_ISSUES, TESTING, docs/MASTER_PROMPT.md (V2).
- Ảnh hưởng module khác: CONTRACTS.md là nguồn sự thật cho mọi interface.

### 2026-11-13 — MVP chạy được
- Thêm: parser giữ offset, validator, extractor, classifier, state machine, batcher, prompt engine, QA (placeholder/ICU/tag/số/thuật ngữ…), Auto Repair, orchestrator (retry/bisect/pause/ngân sách), Glossary/Pre-pass/TM, completeness, merger/export validation, IndexedDB + backup, AI provider (Anthropic/OpenAI-compatible), Netlify Function, giao diện web (6 tab), trang `accounts.html`, CI + workflow GitHub Pages, README.
- Test: 61 unit/integration + 2 E2E (Chromium, iPhone).
- Lệch kế hoạch: không React/Vite/Tailwind (D-015).

## 2026-11-13 — SP-6.4 LLM Review
- Mới: `src/core/review/review.ts`, `src/services/review/runner.ts`, `callReview` trong `provider.ts`, thẻ "Kiểm tra chéo bằng AI" ở Tổng quan, mục bật/tắt + mô hình kiểm tra ở Cài đặt.
- Máy trạng thái: thêm `VERIFIED → REVIEW_REQUIRED` (không BREAKING). `AppSettings.qa.reviewModel?` (tuỳ chọn).
- Test: `tests/review.test.mjs` (11), `tests/e2e-review.mjs`.
