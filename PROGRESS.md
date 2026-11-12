# PROGRESS

Trạng thái: NOT_STARTED | IN_PROGRESS | DONE_TESTED | DONE_UNTESTED | BLOCKED | DONE_DOCS (SP chỉ tài liệu, không có test chạy được).

| SP | Trạng thái | Phụ trách | Kết quả kiểm thử | Ngày |
|---|---|---|---|---|
| SP-0.0 | DONE_DOCS | C1 | Người dùng chưa trả lời → dùng giả định A-001..A-006 | 2026-11-12 |
| SP-0.1 | DONE_DOCS | C1 | PROJECT_SPEC.md đã tạo | 2026-11-12 |
| SP-0.2 | DONE_DOCS | C1 | ARCHITECTURE.md đã tạo | 2026-11-12 |
| SP-0.3 | DONE_DOCS | C1 | CONTRACTS.md đã tạo (chưa biên dịch thử bằng tsc — làm ở SP-1.1) | 2026-11-12 |
| SP-0.4 | DONE_DOCS | C1 | Bộ tài liệu đủ; chưa có người rà soát độc lập | 2026-11-12 |
| SP-1.1 | NOT_STARTED | C1 | — | — |
| SP-1.2 … SP-11.4 | NOT_STARTED | xem TASKS.md | — | — |

## Tổng quan
- Phase 0: hoàn thành phần tài liệu. Chưa có code nên chưa có test nào chạy.
- Việc phải làm đầu tiên ở SP-1.1: kiểm tra `CONTRACTS.md` biên dịch được dưới `tsc --strict` (các `declare function` chuyển sang file `.d.ts`/interface), và xác minh phiên bản gói bằng `npm view`.
