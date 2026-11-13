# Hướng dẫn sử dụng — Dịch en.json sang tiếng Việt

Dành cho người dùng cuối (ưu tiên iPhone). Cách cài đặt/deploy xem `README.md`.

## Trước khi bắt đầu
- Bạn cần một **API key** của nhà cung cấp AI (Anthropic hoặc OpenAI/tương thích). Dịch tự động **có chi phí**; web không tặng miễn phí năng lực dịch.
- Nội dung `en.json` sẽ được gửi tới nhà cung cấp AI bạn chọn. Đừng dùng dữ liệu không được phép chia sẻ.
- Game cần có **font hỗ trợ đầy đủ dấu tiếng Việt**, nếu không chữ sẽ lỗi dù bản dịch đúng.

## 1. Kết nối AI (làm một lần)
**Cài đặt → Kết nối AI**
1. Chế độ: chọn **Trực tiếp** (dùng key của bạn, chạy trên GitHub Pages).
2. Chọn nhà cung cấp, dán **API key**, (tuỳ chọn) nhập tên model.
3. Bấm **Kiểm tra kết nối**. Thấy dòng "✓ Kết nối được" là xong.
4. **Chi phí**: nhập giá token theo bảng giá của nhà cung cấp và **Trần ngân sách (USD)**. Chạm trần, web tự tạm dừng.

Key chỉ nằm trong trình duyệt của bạn. Bỏ tick "Ghi nhớ key" nếu dùng máy chung.

## 2. Tải file lên
**Tải lên → Chọn file** (hoặc kéo thả trên máy tính), chọn `en.json`.
- Web báo JSON có hợp lệ không, có **key trùng** không (JSON thường âm thầm làm mất key trùng; web thì báo cho bạn).
- Bấm **Tạo dự án và phân loại chuỗi**.

## 3. Duyệt phân loại
Web tự chia chuỗi: giao diện, hội thoại, vật phẩm… và **loại trừ** những thứ không phải văn bản (ID, đường dẫn, mã màu, số…).
- Chuỗi chưa rõ là văn bản hay mã kỹ thuật được xếp vào **Cần xác nhận**: chọn **Vẫn dịch** hoặc **Giữ nguyên**.
- Có thể thêm luật riêng (theo đường dẫn key hoặc regex), rồi **Áp dụng luật (phân loại lại)**.

## 4. Thuật ngữ và nhân vật (nên làm trước khi dịch hàng loạt)
**Thuật ngữ → Quét file** gợi ý tên riêng và từ lặp nhiều. Với mỗi mục, đặt bản dịch hoặc **Giữ nguyên**. Có thể thêm **hồ sơ nhân vật** (giới tính, cách xưng hô) để hội thoại nhất quán.
Làm kỹ bước này, độ nhất quán của cả file tăng rõ rệt.

## 5. Dịch thử rồi dịch tất cả
**Tổng quan**
1. Xem ô **Ước tính** (số lô, token, chi phí).
2. **Dịch thử (pilot 40 chuỗi)** → mở **Biên tập**, xem và sửa văn phong → **Chấp nhận pilot làm mẫu**. Các bản bạn duyệt trở thành ví dụ cho phần còn lại.
3. **Dịch tất cả**. Có thể **Tạm dừng / Tiếp tục / Huỷ**. Đóng tab hoặc tải lại trang không mất tiến độ; mở lại và bấm tiếp.

## 6. Xử lý chuỗi lỗi
Mỗi chuỗi dịch xong được QA tự động (placeholder, thẻ, số, thuật ngữ, còn tiếng Anh, độ dài…). Lỗi nhẹ được tự sửa; lỗi còn lại được dịch lại tối đa vài lần.
- Chuỗi vẫn không đạt thành **Cần xem**. Vào **Biên tập**, lọc theo trạng thái, sửa tay rồi **Lưu**, hoặc tick chấp nhận dù có cảnh báo.
- **Dịch lại chuỗi lỗi** đưa chúng về hàng đợi.

## 7. Kiểm tra chéo bằng AI (tuỳ chọn)
**Cài đặt → Quy tắc QA → Bật kiểm tra chéo**, rồi ở **Tổng quan** bấm **Kiểm tra mẫu ngẫu nhiên**. Một lượt AI thứ hai chấm nghĩa/độ tự nhiên trên mẫu ~10%. Chuỗi bị chấm thấp được đánh dấu **Cần xem** kèm lý do; **bản dịch không bị sửa**. Tốn thêm chi phí; chỉ dùng ở chế độ Trực tiếp.
Mẫu bị đánh dấu nhiều là dấu hiệu nên xem lại thuật ngữ/văn phong rồi dịch lại.

## 8. Xuất file
**Xuất**
- Mục **Kiểm tra trước khi xuất** cho biết còn chuỗi nào chưa xong và file xuất có đủ key, cấu trúc, placeholder, thẻ hay không.
- **⇩ Tải vi.json (hoàn tất)**: chỉ bật khi không còn chuỗi chưa dịch/lỗi nặng và file xuất qua mọi kiểm tra.
- **Tải bản tạm**: lấy trước khi xong; chuỗi chưa dịch giữ tiếng Anh. File tên `….partial.json`.
- Có thêm: **Danh sách chuỗi lỗi (CSV)**, **Báo cáo tiến độ**, **Glossary**, **Translation Memory**, và mục **Kiểm tra phông chữ tiếng Việt** (liệt kê ký tự có dấu để đối chiếu với font game).

## 9. Sao lưu (rất quan trọng trên iPhone)
Safari có thể xoá bộ nhớ trình duyệt nếu lâu không dùng.
- **Xuất → Sao lưu dự án** (hoặc Cài đặt → Dữ liệu) thường xuyên, lưu file vào Files/iCloud.
- Mất dữ liệu: **Khôi phục từ bản sao lưu**.
- Nên **Thêm vào Màn hình chính** (Chia sẻ → Thêm vào MH chính) để Safari ít dọn dữ liệu hơn.

## Giới hạn cần biết
- Không có gì đảm bảo bản dịch đúng tuyệt đối. Web chỉ đảm bảo: mọi chuỗi cần dịch đã được xử lý, và đã qua các kiểm tra tự động. Hãy xem kỹ các chuỗi quan trọng (hội thoại chính, tên kỹ năng, nhiệm vụ).
- Danh sách giới hạn kỹ thuật: `KNOWN_ISSUES.md`.

## Xử lý sự cố nhanh
| Hiện tượng | Cách xử lý |
|---|---|
| "API key không hợp lệ" | Dán lại key, kiểm tra nhà cung cấp/model đúng |
| Lỗi 429 liên tục | Giảm "Số lô chạy song song" về 1 trong Cài đặt |
| "Không kết nối được … CORS" | Nhà cung cấp chặn gọi từ trình duyệt; dùng nhà cung cấp tương thích khác hoặc chế độ Netlify |
| Chữ vỡ trong game | Font game thiếu glyph tiếng Việt |
| Web trắng | Kiểm tra Settings → Pages → Source = GitHub Actions và job deploy đã xanh |
