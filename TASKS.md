# TASKS — Danh sách Phase/Subphase

Kích thước: S (≤1 phiên nhỏ), M (1 phiên), L (nên chia Task). Owner = vai trò chính. Mỗi SP phải có test đi kèm (xem TESTING.md).

| SP | Tên | Owner | Cỡ | Phụ thuộc | Nghiệm thu chính |
|---|---|---|---|---|---|
| SP-0.0 | Intake & giả định | C1 | S | — | DECISIONS A-001..A-006 |
| SP-0.1 | Phân tích yêu cầu | C1 | S | 0.0 | PROJECT_SPEC.md |
| SP-0.2 | Kiến trúc | C1 | M | 0.1 | ARCHITECTURE.md |
| SP-0.3 | Cấu trúc & contracts | C1 | M | 0.2 | CONTRACTS.md |
| SP-0.4 | Bộ tài liệu nền | C1 | S | 0.3 | đủ file bàn giao |
| SP-1.1 | Khởi tạo Vite/React/TS/ESLint/Vitest/CI | C1 | M | 0.4 | `npm run typecheck && lint && test && build` xanh |
| SP-1.2 | Tailwind, hệ màu, layout responsive, PWA manifest | C3 | M | 1.1 | trang khung chạy, khổ iPhone ổn |
| SP-1.3 | IndexedDB, lưu/phục hồi, backup, audit log | C1/C3 | L→2 task | 1.1 | test CRUD, migration, quota |
| SP-2.1 | JSON tokenizer/parser (offset, key trùng, BOM, CRLF) | C2 | L→2 task | 1.1 | fuzz + round-trip splice |
| SP-2.2 | Validator | C2 | S | 2.1 | báo lỗi dòng/cột, bất thường |
| SP-2.3 | Extractor + ID ổn định | C2 | M | 2.1 | id ổn định khi parse lại |
| SP-2.4 | Classifier + luật người dùng | C2 | M | 2.3 | bảng ca test phân loại, EXCLUDED có lý do |
| SP-3.1 | Data model + state machine (`transition`) | C2 | M | 2.3 | mọi chuyển hợp lệ/không hợp lệ được test |
| SP-3.2 | Batcher (giới hạn, nhóm theo ngữ cảnh, neighbors) | C2 | M | 3.1 | không cắt chuỗi, 50k chuỗi nhanh |
| SP-3.3 | Progress Manager | C2 | S | 3.1 | số liệu đúng, reload giữ trạng thái |
| SP-4.1 | AI Adapter + Netlify Function + Mock | C4 | L→2 | 3.2 | timeout/429/auth/size test |
| SP-4.2 | Prompt Engine + parser phản hồi + chống injection | C4 | M | 4.1 | test bằng Mock + ca injection |
| SP-4.3 | Orchestrator (queue, pause/resume, bisect) | C4 | L→2 | 4.2 | batch lỗi không dừng tổng |
| SP-4.4 | Recovery/checkpoint | C4 | M | 4.3 | đóng tab giữa batch vẫn nhất quán |
| SP-5.1 | Glossary Manager (+import/export) | C4 | M | 1.3 | CRUD, xung đột |
| SP-5.2 | Terminology Pre-pass + Character Profile | C4 | M | 5.1 | trích ứng viên từ fixture |
| SP-5.3 | Translation Memory | C4 | M | 5.1 | khớp theo (source,kind), dedupe |
| SP-5.4 | Context-aware + Pilot Run | C4 | M | 4.3,5.2 | pilot được duyệt → few-shot |
| SP-6.1 | Placeholder Validator | C4 | M | 3.1 | bộ ca ICU/printf/mustache |
| SP-6.2 | Tag & Format Validator | C4 | M | 3.1 | cân bằng thẻ, escape, độ dài |
| SP-6.3 | Quality Validator | C4 | M | 5.1 | còn tiếng Anh (+ngoại lệ), rác AI |
| SP-6.4 | LLM Review (tuỳ chọn) | C4 | M | 4.1 | chỉ gắn cờ, không tự sửa |
| SP-6.5 | QA scoring + gating VERIFIED | C4 | S | 6.1–6.3 | VERIFIED chỉ khi qua bắt buộc |
| SP-7.1 | Error detection/classification | C4 | S | 6.5 | mã lỗi + bằng chứng |
| SP-7.2 | Auto Repair xác định + re-ask AI | C4 | M | 7.1 | sửa đúng placeholder/tag |
| SP-7.3 | Retry management | C4 | S | 7.2 | giới hạn, REVIEW_REQUIRED |
| SP-7.4 | Completeness Checker | C4 | S | 7.3 | `canFinalize` đúng điều kiện |
| SP-8.1 | Dashboard | C3 | M | 3.3 | số liệu thật |
| SP-8.2 | Upload + preview + Dry-run | C3 | M | 2.x | nối parser/extractor thật |
| SP-8.3 | Translation Editor (virtualized) | C3 | L→2 | 3.1,6.5 | lọc/tìm/sửa/khoá/lịch sử |
| SP-8.4 | Settings/Glossary/TM/QA Center/Error mgmt | C3 | L→2 | 5,6,7 | nối module thật |
| SP-9.1 | Merger (splice) | C2 | M | 2.1 | identity round-trip |
| SP-9.2 | Export Engine + báo cáo | C2 | M | 9.1 | JSON/CSV/MD |
| SP-9.3 | Export Validation | C2 | M | 9.2 | chặn FINAL khi lỗi |
| SP-10.x | Tích hợp, E2E, Stress, Fuzz, Bug-fix | C5 | L | Phase 9 | MASTER_PROMPT §16 |
| SP-11.1 | Security audit | C5 | M | 10 | không lộ key, endpoint an toàn |
| SP-11.2 | Performance/iPhone | C5 | M | 10 | số đo ghi vào PROGRESS |
| SP-11.3 | GitHub/Netlify deploy | C5 | M | 11.1 | production gọi API thật |
| SP-11.4 | Final acceptance + tài liệu | C5 | M | 11.3 | RELEASE |

Ghi chú thứ tự: Phase 3.x có thể song song với 1.3 chỉ khi hợp đồng ổn định (CONTRACTS.md); nhưng chỉ một tài khoản làm một lúc (D-013), nên thứ tự mặc định là tuần tự theo bảng.
