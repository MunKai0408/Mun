# NEXT_TASK

**Vai trò:** CLAUDE 5 — INTEGRATION & RELEASE (phiên có mạng và API key thử).
**Mục tiêu:** xác thực với thế giới thật, rồi sửa lỗi phát hiện.

## Đọc trước
HANDOFF.md → PROGRESS.md → KNOWN_ISSUES.md → DECISIONS.md (D-015…D-019).

## Cần làm (theo thứ tự)
1. `npm install && npm test && npm run test:e2e` trên máy có mạng; ghi kết quả vào PROGRESS.md.
2. Thử `en.json` thật (≥200 dòng): xem Classifier có loại nhầm/bỏ sót (KI-001). Sửa `src/core/classify/classify.ts` + thêm test.
3. Gọi API thật (DIRECT) ~40 chuỗi (Pilot): kiểm tra CORS, định dạng JSON, tỷ lệ QA đạt (KI-006). Sau đó chạy "Kiểm tra chéo" trên mẫu thật: xem tỷ lệ bị đánh dấu có hợp lý không, hiệu chỉnh ngưỡng/prompt trong `review.ts` (KI-013).
4. Đo timeout Netlify thật (KI-004) nếu dùng; thử iPhone Safari thật (KI-007).
5. Còn thiếu: ảo hoá danh sách Editor (KI-009), test migration IndexedDB, Fuzzy TM (KI-008), security audit (SP-11.1).

## KHÔNG được
Đổi key/cấu trúc dữ liệu xuất; đổi `types.ts` mà không cập nhật CONTRACTS.md + CHANGELOG (BREAKING); dùng MockProvider trong luồng chạy thật; để LLM Review tự sửa bản dịch.

## Hoàn thành khi
Một vòng thật: en.json thật → vi.json xuất ra mở được trong game/công cụ đích, không mất key/placeholder.
