# DECISIONS (ADR rút gọn)

Định dạng: ID | Ngày | Người quyết | Quyết định | Lý do/ảnh hưởng. Ngày: 2026-11-12.

## Giả định (do người dùng chưa trả lời Phase 0.0)
- **A-001** Chưa có `en.json` thật → dùng fixtures đa dạng; khi có file thật, Claude 2 chạy lại test Extractor/Classifier và cập nhật luật.
- **A-002** Nội dung là game, bối cảnh chưa rõ → văn phong trung tính-tự nhiên, UI xưng "bạn".
- **A-003** Engine/định dạng chuỗi chưa rõ → hỗ trợ đồng thời `{0}`, `{{x}}`, `%s`, ICU, i18next, tag Unity/BBCode.
- **A-004** Nhà cung cấp AI chưa chọn → adapter trung lập; triển khai đầu tiên: Anthropic Messages API; thêm adapter tương thích OpenAI sau (SP-4.1b).
- **A-005** Ngân sách chưa rõ → mặc định không trần; bắt buộc Dry-run Estimate trước khi dịch hàng loạt.
- **A-006** Repo nên để **private**; chưa có repo/Netlify site → tạo ở Phase 1/11.

## Quyết định
- **D-001** Stack: React + TS strict + Vite + Tailwind + Vitest + Playwright + Netlify Functions + IndexedDB (idb). Phiên bản cụ thể ghim ở SP-1.1 sau khi kiểm tra bằng `npm view` (phiên Phase 0 không có mạng nên chưa xác minh).
- **D-002** Điều phối dịch ở client (hàng đợi), mỗi request Function = 1 batch nhỏ (mặc định 30 chuỗi / 5.000 ký tự). Lý do: giới hạn thời gian/payload của Netlify.
- **D-003** Hai chế độ key: A (server env, mặc định, có token truy cập + rate limit) và B (BYO key, chỉ in-memory/sessionStorage). Không bao giờ yêu cầu dán key vào chat.
- **D-004** Parser tự viết giữ offset; Export = splice literal chuỗi vào văn bản gốc. Ghi chú encode: dùng UTF-8 trực tiếp cho ký tự có dấu; nếu literal gốc dùng `\uXXXX` cho ký tự non-ASCII, vẫn xuất UTF-8 (hợp lệ JSON) — ghi cờ `escapeStyle` trong ParseResult nếu Claude 2 thấy cần giữ.
- **D-005** `EntryId = "s_" + hash(pointer + "#dup"+n)`. Hash: FNV-1a 53-bit hoặc tương đương, không cần mật mã.
- **D-006** Trạng thái chỉ ở IndexedDB; server stateless; ghi theo giao dịch sau mỗi batch (checkpoint).
- **D-007** `AiProvider` interface + `MockProvider` (chỉ test/CI; cấm dùng trong luồng chạy thật — kiểm tra bằng cờ build).
- **D-008** Máy trạng thái chuỗi như ARCHITECTURE §3; VERIFIED có `AUTO|HUMAN`.
- **D-009** TM khoá theo `(source, kind)`; không gộp chuỗi ngắn đa nghĩa giữa các kind khác nhau.
- **D-010** Core là hàm thuần, chạy được trong Web Worker; UI không chứa logic nghiệp vụ.
- **D-011** Không dùng `innerHTML` với dữ liệu người dùng; chuỗi hiển thị bằng text node.
- **D-012** Ngôn ngữ: tài liệu/báo cáo/UI = tiếng Việt; identifier trong code = tiếng Anh.
- **D-013** Vai trò theo NEXT_TASK.md, không theo số thứ tự phiên; mỗi lúc một tài khoản làm việc, một branch mỗi SP.
- **D-014** Trạng thái hoàn thành SP: `DONE_TESTED` / `DONE_UNTESTED` / `BLOCKED` (xem PROGRESS.md).
