# PROJECT_SPEC — en.json EN→VI Translator

Nguồn gốc yêu cầu: `docs/MASTER_PROMPT.md` (V2). Tài liệu này là bản đặc tả rút gọn, có thể kiểm chứng. Khi mâu thuẫn: DECISIONS.md > PROJECT_SPEC.md > MASTER_PROMPT.md.

## 1. Mục tiêu
Website nhận `en.json`, dịch mọi chuỗi cần dịch sang tiếng Việt qua AI API, kiểm tra chất lượng (QA), tự sửa lỗi, cho người dùng xem/sửa, và xuất `vi.json` giữ nguyên key/cấu trúc/định dạng. Dùng tốt trên iPhone và máy tính.

## 2. Phạm vi
### Bắt buộc (MUST)
| ID | Chức năng |
|----|-----------|
| F-01 | Upload & đọc JSON lồng nhau (object/array), phát hiện JSON lỗi (dòng/cột), key trùng |
| F-02 | Trích xuất chuỗi + ID ổn định (JSON Pointer), giữ đường dẫn |
| F-03 | Phân loại chuỗi (UI/Dialogue/Item/Skill/Character/Quest/Tutorial/System/Description/Other) + phát hiện chuỗi không dịch |
| F-04 | Batch + hàng đợi dịch phía client, Tạm dừng/Tiếp tục/Huỷ |
| F-05 | AI Adapter qua Netlify Function, không lộ key, timeout/429/retry |
| F-06 | Glossary + Character Profile + Terminology Pre-pass |
| F-07 | Translation Memory (khớp chính xác theo nguồn + loại ngữ cảnh) |
| F-08 | Pilot Run 30–50 chuỗi để duyệt văn phong |
| F-09 | QA: placeholder, tag/format, chất lượng; máy trạng thái chuỗi |
| F-10 | Auto Repair + Retry giới hạn + REVIEW_REQUIRED |
| F-11 | Completeness Checker, xuất tạm/xuất hoàn tất |
| F-12 | Translation Editor (lọc, tìm, sửa, khoá, lịch sử) |
| F-13 | Lưu tiến độ IndexedDB, phục hồi sau tải lại; Sao lưu/Khôi phục dự án |
| F-14 | Export `vi.json` + Export Validation + Identity Round-trip |
| F-15 | Ước tính chi phí (Dry-run), theo dõi chi phí, trần ngân sách |
| F-16 | Responsive/iPhone, PWA |
### Tuỳ chọn (SHOULD / COULD)
LLM Review độc lập (S), Fuzzy TM gợi ý (C), bản song ngữ (C), Vietnamese Glyph Check (S), báo cáo CSV/Markdown (S), nhiều dự án song song (C), nhiều nhà cung cấp AI (S).
### Ngoài phạm vi
Dịch ngôn ngữ khác ngoài EN→VI; đăng nhập tài khoản/đồng bộ đám mây; chỉnh sửa file game dạng không phải JSON.

## 3. Quy trình hoạt động
Upload → Parse/Validate → Extract → Classify (người dùng duyệt chuỗi nghi ngờ) → Terminology Pre-pass (duyệt Glossary/Character) → Dry-run chi phí → Pilot Run (duyệt) → Batch dịch (TM/Glossary áp dụng) → QA → Auto Repair → Retry → Người dùng duyệt REVIEW_REQUIRED + mẫu → Completeness → Merge → Export Validation → Tải `vi.json` + báo cáo.

## 4. Giới hạn kỹ thuật đã biết
- Netlify sync Function: thời gian ngắn (~10 s mặc định) và payload ~6 MB → kiểm tra lại tài liệu hiện hành ở SP-4.1. Batch nhỏ, điều phối ở client.
- Safari/iOS có thể xoá IndexedDB khi lâu không dùng → persist() + sao lưu.
- Nhóm làm việc: 5 tài khoản Claude Free, hạn mức thấp, phiên có thể không chạy được code → xem mục trạng thái ở `PROGRESS.md`.
- Không có mẫu `en.json` thật (xem DECISIONS A-001) → dùng fixtures; khi có file thật phải chạy lại Classifier/Extractor test.

## 5. Tiêu chí nghiệm thu
Xem MASTER_PROMPT mục 16. Mỗi SP có tiêu chí riêng trong `TASKS.md`.

## 6. Thuật ngữ
- **Chuỗi (string entry):** một giá trị chuỗi trong JSON cần xử lý.
- **Coverage:** mọi chuỗi cần dịch đã xử lý (dịch hoặc EXCLUDED có lý do).
- **VERIFIED-AUTO / VERIFIED-HUMAN:** qua kiểm tra bắt buộc / người dùng xác nhận. Không đồng nghĩa dịch đúng tuyệt đối.
