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

## Bổ sung 2026-11-13
- **D-015** Phiên xây dựng không có mạng (npm bị chặn) → dùng TypeScript biên dịch bằng `tsc` ra ESM chạy thẳng trên trình duyệt; giao diện bằng DOM thuần + CSS tự viết. Hoãn React/Vite/Tailwind (D-001 vẫn là hướng đích nếu cần). Lý do kỹ thuật: không thể cài gói. Core/services độc lập UI nên chuyển đổi sau không ảnh hưởng.
- **D-016** Thêm chế độ `DIRECT`: trình duyệt gọi thẳng nhà cung cấp AI bằng key của người dùng → chạy được trên GitHub Pages không cần backend. Key chỉ ở sessionStorage (tuỳ chọn localStorage), không gửi tới máy chủ nào khác. Anthropic cần header `anthropic-dangerous-direct-browser-access`. Chế độ `SERVER`/`BYO` qua Netlify vẫn giữ.
- **D-017** `provider.ts` là nguồn duy nhất gọi nhà cung cấp, dùng chung cho trình duyệt và Netlify Function.
- **D-018** Trang `accounts.html`: sổ điều phối nhiều tài khoản Claude, do người dùng tự cập nhật (localStorage). Không lưu email/mật khẩu/token; không đăng nhập hay tự đọc lượt dùng.
- **D-019** Mặc định batch 20 chuỗi / 3.500 ký tự / 2 luồng để an toàn với timeout Netlify (D-002); lỗi timeout tự chia đôi lô.
- **D-020** Chuỗi "nghi ngờ" (PascalCase, kebab/dotted, key kiểu id…) KHÔNG được dịch cho tới khi người dùng xác nhận; chỉ loại tự động khi chắc chắn.

## D-019 — LLM Review (SP-6.4)
- Chỉ kiểm tra chuỗi VERIFIED mức AUTO, chưa khoá/sửa tay; mẫu ~10% phân tầng theo loại (tối thiểu 3/loại, trần 200), có hạt giống để tái hiện.
- Chỉ ĐÁNH DẤU: thêm chuyển `VERIFIED → REVIEW_REQUIRED` vào máy trạng thái. Không sửa bản dịch; lý do ghi vào `qaHint` và QA issue `LLM_REVIEW` (MINOR) để nút "Dịch lại chuỗi lỗi" và Biên tập hiển thị được.
- Ngưỡng đánh dấu: accuracy < 4 hoặc fluency < 4 (thang 1–5). Trần chi phí của lượt kiểm tra = 20% trần ngân sách.
- `AppSettings.qa.reviewModel` (tuỳ chọn, không BREAKING) cho phép dùng mô hình khác lúc dịch.
- `provider.ts` tách `chat()` dùng chung cho dịch và kiểm tra.
