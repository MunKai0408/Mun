# Dịch en.json sang tiếng Việt

Website nhận `en.json`, dịch qua AI, kiểm tra chất lượng (QA) tự động, cho bạn xem/sửa, rồi xuất `vi.json` giữ nguyên key, cấu trúc và định dạng. Dùng được trên iPhone và máy tính. Có kèm trang **Điều phối tài khoản** (`accounts.html`) để theo dõi lượt dùng và bàn giao giữa nhiều tài khoản Claude.

## Cách chạy nhanh (máy tính)
```bash
npm install        # chỉ cài TypeScript
npm test           # biên dịch + chạy toàn bộ test
npm start          # http://localhost:8080 (có cả /api/translate)
```
`site/js` là mã đã biên dịch và được commit sẵn nên có thể đưa thẳng thư mục `site/` lên bất kỳ host tĩnh nào.

## Cách 1 — GitHub Pages (khuyên dùng, không cần máy chủ)
1. Đẩy repo lên GitHub (nên để **private** nếu dữ liệu game không công khai; Pages cho repo private cần gói trả phí, nếu không hãy để public vì web không chứa dữ liệu của bạn).
2. Settings → Pages → Source: **GitHub Actions**. Workflow `pages.yml` tự chạy test, build và đăng `site/`.
3. Mở trang → **Cài đặt** → chế độ **Trực tiếp** → dán API key (Anthropic hoặc OpenAI/tương thích) → **Kiểm tra kết nối**.
   API key chỉ nằm trong trình duyệt của bạn và gửi thẳng tới nhà cung cấp AI.

## Cách 2 — Netlify (key giữ ở máy chủ)
1. Nối repo với Netlify (build/publish đã có trong `netlify.toml`).
2. Đặt biến môi trường theo `.env.example` (bắt buộc `ACCESS_TOKEN` và `AI_API_KEY`).
3. Trong **Cài đặt** chọn "Máy chủ Netlify" và nhập `ACCESS_TOKEN`.

## Quy trình dùng
Tải lên → kiểm tra/phân loại (duyệt chuỗi nghi ngờ) → quét thuật ngữ → dịch thử 40 chuỗi → chấp nhận làm mẫu văn phong → dịch tất cả → xem chuỗi "Cần xem" → xuất (nút hoàn tất chỉ bật khi đủ điều kiện).
Hãy **Sao lưu dự án** thường xuyên (Safari có thể dọn bộ nhớ trình duyệt).

## Giới hạn đã biết
Xem `KNOWN_ISSUES.md`. Chất lượng bản dịch được kiểm bằng QA tự động (placeholder, thẻ, số, thuật ngữ, chữ còn tiếng Anh…), không đảm bảo đúng tuyệt đối — hãy xem lại các chuỗi quan trọng.
