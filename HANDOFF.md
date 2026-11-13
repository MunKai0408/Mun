# HANDOFF

**Cập nhật:** 2026-11-13 (phiên SP-6.4). **Trạng thái:** MVP đầy đủ luồng chính + LLM Review; đang deploy GitHub Pages; chưa thử API thật.

## Đã làm phiên này (SP-6.4)
Kiểm tra chéo bằng AI: `core/review/review.ts` (mẫu phân tầng, prompt, đọc phản hồi), `services/review/runner.ts` (lô, trần chi phí, huỷ), `callReview` (provider.ts), UI Tổng quan + Cài đặt. Quyết định: DECISIONS D-019. 72/72 test, 3 E2E đạt.

## Cấu trúc
- `src/` TypeScript → `tsc` → `site/js/` (đã commit, host tĩnh dùng được ngay).
- `src/core/*` hàm thuần; `src/services/*` orchestrator/AI/lưu trữ/review; `src/ui/*` giao diện.
- `netlify/functions/translate.mjs` dùng lại `site/js/services/ai/provider.js` → chạy `npm run build` trước khi deploy Functions.
- `tests/*.test.mjs` (72 test), `tests/e2e*.mjs` (Playwright toàn cục).

## Lệnh
`npm install && npm test` · `npm start` · `npm run test:e2e`

## Việc người dùng cần làm
1. Deploy: Pages workflow có bước tự lấy `site/` từ file zip ở gốc repo nếu chưa có thư mục `site/`. Khi đưa bản mới lên, xoá zip cũ hoặc đổi tên để workflow lấy đúng zip.
2. Cài đặt → "Trực tiếp" → dán API key → "Kiểm tra kết nối".
3. Thử `en.json` nhỏ thật; bật "kiểm tra chéo" (Cài đặt → Quy tắc QA) sau khi dịch xong; báo lại lỗi.

## Điều cần biết
- Không dùng React/Vite/Tailwind (D-015). Core không phụ thuộc UI.
- LLM Review chỉ ở chế độ DIRECT (KI-013).
