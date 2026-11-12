# KNOWN_ISSUES

| ID | Mức | Mô tả | Module | Trạng thái |
|---|---|---|---|---|
| KI-001 | MAJOR | Chưa có `en.json` thật; luật Classifier/Extractor chỉ dựa trên fixtures giả định (A-001). | C2 (2.3–2.4) | Mở — cần mẫu từ người dùng |
| KI-002 | MINOR | Phiên bản gói npm chưa xác minh (Phase 0 không có mạng). | C1 (1.1) | Mở — xử lý ở SP-1.1 |
| KI-003 | MINOR | CONTRACTS.md chưa được `tsc` kiểm tra (dùng `declare function`). | C1 (1.1) | Mở — xử lý ở SP-1.1 |
| KI-004 | MAJOR | Giới hạn thực tế của Netlify Functions (timeout/payload) chưa kiểm tra theo tài liệu hiện hành. | C4 (4.1) | Mở — xác minh ở SP-4.1 |
| KI-005 | MINOR | Chưa chọn nhà cung cấp AI/ngân sách (A-004/A-005). | C4 | Mở |
