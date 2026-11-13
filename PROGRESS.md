# PROGRESS

Trạng thái: NOT_STARTED | IN_PROGRESS | DONE_TESTED | DONE_UNTESTED | PARTIAL | BLOCKED | DONE_DOCS.
"Tested" = test tự động đã chạy thật (Node 22 `node --test`, Chromium/Playwright giả lập iPhone). Chưa có lần chạy nào với API AI thật hay Safari iOS thật (xem KNOWN_ISSUES).

Kết quả lần chạy gần nhất (2026-11-13, phiên SP-6.4): `tsc` + `node --test` → 72/72 đạt; E2E `e2e.mjs`, `e2e-accounts.mjs`, `e2e-review.mjs` → OK.

| SP | Nội dung | Trạng thái | Ghi chú |
|---|---|---|---|
| 0.0–0.4 | Tài liệu nền | DONE_DOCS | |
| 1.1 | Khởi tạo dự án | DONE_TESTED (lệch kế hoạch) | TypeScript + `tsc`, không React/Vite (D-015) |
| 1.2 | Giao diện nền | DONE_TESTED (lệch kế hoạch) | CSS tự viết, không Tailwind; responsive + thanh điều hướng dưới trên iPhone |
| 1.3 | IndexedDB, lưu/phục hồi, backup | DONE_TESTED | MemoryStorage có unit test; IdbStorage chạy thật qua E2E (tải lại trang giữ tiến độ). Chưa test migration nhiều phiên bản |
| 2.1 | Parser (offset, key trùng, BOM, CRLF) | DONE_TESTED | |
| 2.2 | Validator | DONE_TESTED | |
| 2.3 | Extractor + ID ổn định | DONE_TESTED | |
| 2.4 | Classifier + luật người dùng | DONE_TESTED | Luật dựa trên fixture giả định (KI-001) |
| 3.1 | Data model + state machine | DONE_TESTED | |
| 3.2 | Batcher | DONE_TESTED | 50.000 chuỗi < 8s |
| 3.3 | Progress Manager | DONE_TESTED | |
| 4.1 | AI Adapter + Netlify Function | DONE_TESTED (mock) | Nhà cung cấp giả cục bộ + chặn mạng trình duyệt. Chưa gọi API thật |
| 4.2 | Prompt Engine + chống injection | DONE_TESTED (mock) | Chất lượng prompt chưa đo bằng mô hình thật |
| 4.3 | Orchestrator | DONE_TESTED | retry, 429, bisect, pause/resume/cancel, ngân sách |
| 4.4 | Recovery/checkpoint | DONE_TESTED | |
| 5.1 | Glossary | DONE_TESTED | |
| 5.2 | Terminology Pre-pass + Character Profile | PARTIAL | Pre-pass có test; hồ sơ nhân vật có UI + vào prompt, chưa có test UI |
| 5.3 | Translation Memory | DONE_TESTED | Chỉ khớp chính xác; fuzzy chưa làm |
| 5.4 | Context-aware + Pilot | PARTIAL | Pilot chạy qua UI, chưa có E2E riêng cho "chấp nhận pilot" |
| 6.1–6.3 | QA validators | DONE_TESTED | |
| 6.4 | LLM Review độc lập | DONE_TESTED (mock) | Lấy mẫu phân tầng, chấm nghĩa/tự nhiên, chỉ đánh dấu REVIEW_REQUIRED. 11 test + E2E. Chưa chạy với mô hình thật; chỉ chế độ DIRECT (KI-013) |
| 6.5 | QA scoring + gating VERIFIED | DONE_TESTED | |
| 7.1–7.4 | Repair, retry, completeness | DONE_TESTED | Repair chỉ sửa lỗi xác định |
| 8.1–8.4 | Dashboard, Upload, Editor, Settings/Glossary | DONE_TESTED (E2E luồng chính) | Editor phân trang 40 dòng, chưa ảo hoá |
| 9.1–9.3 | Merger, Export, Validation | DONE_TESTED | Round-trip byte-for-byte |
| — | Trang Điều phối tài khoản (`accounts.html`) | DONE_TESTED | Sổ theo dõi thủ công |
| 10.x | Stress/Fuzz đầy đủ | PARTIAL | 50k chuỗi chỉ ở batcher; runner 2k |
| 11.1 | Security audit | NOT_STARTED | Đã có: CSP, không innerHTML, token timing-safe, rate limit, kiểm tra input |
| 11.2 | Performance iPhone thật | NOT_STARTED | |
| 11.3 | Deploy GitHub Pages / Netlify | NOT_STARTED | Workflow + cấu hình đã viết, chưa chạy |
| 11.4 | Final acceptance + USER_GUIDE | NOT_STARTED | Có README |
