# TESTING

## Nguyên tắc
- Mỗi SP có test ngay trong SP đó. Không báo "đã test" nếu chưa chạy; ghi kết quả thật vào PROGRESS.md.
- Test không gọi API thật: dùng `MockProvider` (cấm trong build production). Có 1 bước thử API thật thủ công/E2E ở Phase 10–11.
- Core là hàm thuần → Vitest, không cần DOM.

## Lệnh (sau SP-1.1)
`npm run typecheck` · `npm run lint` · `npm test` · `npm run test:e2e` · `npm run build`

## Fixtures (`tests/fixtures/`)
flat.json · nested-deep.json · arrays.json · icu-plural.json · i18next-plural.json · unity-tags.json · bbcode.json · duplicate-keys.json · unicode-emoji.json · crlf-bom.json · empty-and-technical.json (ID, URL, hex, path, số) · already-vi.json · mixed-types.json · invalid-*.json (nhiều kiểu lỗi cú pháp) · generated-{1k,10k,50k}.json (sinh bằng script, không commit file lớn).
Khi có `en.json` thật: thêm bản đã ẩn danh vào `tests/fixtures/real/` (nếu người dùng cho phép).

## Bộ test bắt buộc theo module
- Parser: hợp lệ/lỗi (dòng/cột), key trùng, BOM, CRLF, số lớn, Unicode, fuzz.
- **Identity Round-trip:** `exportVi(parse(x), entries với translation = original) === x` (byte-for-byte).
- Extractor: id ổn định khi parse lại; key trùng có `dupIndex`.
- Classifier: bảng ca (chuỗi → kind/excludeReason); chuỗi nghi ngờ → `needsClassifyReview`.
- State machine: mọi chuyển hợp lệ/không hợp lệ.
- Batcher: không cắt chuỗi, tuân giới hạn, nhóm theo ngữ cảnh.
- Validators: placeholder (`{0}`, `%s`, `%1$s`, `{{x}}`, `${x}`, ICU), tag cân bằng, escape, còn tiếng Anh + ngoại lệ, rác AI.
- Orchestrator (Mock): 429, timeout, phản hồi thiếu/thừa ID, bisect, pause/resume, đóng tab giữa batch.
- Export Validation: key set, structure, value types, count, untouched equal.
- Stress (Mock): 10 / 1k / 10k / 50k — ghi thời gian, RAM, dung lượng IDB.
- E2E (Playwright, viewport iPhone): upload → pilot → dịch (Mock) → sửa tay → xuất.

## Bằng chứng
Dán đầu ra tóm tắt (số test pass/fail, thời gian) vào PROGRESS.md ở cột kết quả.
