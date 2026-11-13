# KNOWN_ISSUES

| ID | Mức | Mô tả | Trạng thái |
|---|---|---|---|
| KI-001 | MAJOR | Chưa thử với `en.json` thật; luật Classifier dựa trên fixture giả định. Có thể loại nhầm/bỏ sót. | Mở |
| KI-004 | MAJOR | Giới hạn thời gian/payload thực tế của Netlify Functions chưa đo trên production. Nếu bị ngắt ~10s, giảm "số chuỗi mỗi lô" hoặc dùng chế độ Trực tiếp. | Mở |
| KI-005 | MINOR | Chưa chọn nhà cung cấp/ngân sách chính thức. | Mở |
| KI-006 | MAJOR | Chưa từng gọi API AI thật; mọi test dùng nhà cung cấp giả. Tỷ lệ QA đạt và chất lượng prompt chưa có số liệu. CORS trực tiếp của từng nhà cung cấp chưa xác minh (Anthropic dùng header riêng; OpenAI/OpenRouter chưa kiểm). | Mở |
| KI-007 | MAJOR | Chưa thử trên Safari iOS thật (chỉ giả lập iPhone bằng Chromium): tải xuống file, IndexedDB bị dọn, chọn file. | Mở |
| KI-008 | MINOR | Fuzzy TM chưa làm. (LLM Review đã xong ở SP-6.4.) | Mở |
| KI-009 | MINOR | Editor phân trang 40 dòng, chưa ảo hoá; chưa có migration IndexedDB nhiều phiên bản. | Mở |
| KI-010 | MINOR | Stress đầy đủ 10k/50k qua orchestrator chưa chạy (batcher 50k và runner 2k đã đạt). | Mở |
| KI-011 | MINOR | Phát hiện "còn tiếng Anh" và đếm số là heuristic: có thể báo nhầm với bản dịch hợp lệ (đã có checkbox "Chấp nhận dù có cảnh báo"). | Mở |
| KI-012 | INFO | Phiên bản TypeScript trong package.json (^5.6) chưa xác minh với `npm`; phiên xây dựng dùng `tsc` 7.0.2 cài sẵn. | Mở |
| KI-013 | MINOR | LLM Review chỉ chạy ở chế độ DIRECT (Netlify chưa có điểm cuối riêng); chất lượng chấm của mô hình thật và ngưỡng mặc định (<4/5) chưa được hiệu chỉnh. | Mở |
