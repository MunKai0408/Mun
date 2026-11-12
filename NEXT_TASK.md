# NEXT_TASK

**Vai trò:** CLAUDE 1 — PROJECT ARCHITECT (khung dự án)
**Nhiệm vụ:** SP-1.1 — Khởi tạo dự án Vite + React + TypeScript + công cụ chất lượng + CI.
**Cỡ:** M. Chỉ làm SP-1.1. Không viết logic nghiệp vụ.

## Đọc trước
HANDOFF.md → PROGRESS.md → ARCHITECTURE.md (§1, §5) → CONTRACTS.md → DECISIONS.md (D-001, D-010, D-012, D-014) → TESTING.md.

## Cần làm
1. Nếu có mạng/`npm`: dùng `npm view <pkg> version` để chọn phiên bản ổn định hiện hành cho: react, react-dom, vite, @vitejs/plugin-react, typescript, tailwindcss (Tailwind chỉ cài ở SP-1.2), vitest, @playwright/test, eslint (+ typescript-eslint, eslint-plugin-react-hooks), prettier, idb, @netlify/functions. Ghim phiên bản chính xác + lockfile. Nếu không có mạng: ghi `DONE_UNTESTED`, liệt kê phiên bản đề xuất kèm cảnh báo "chưa xác minh", để người dùng chạy `npm install`.
2. Tạo `package.json` với scripts: `dev`, `build`, `preview`, `typecheck` (`tsc --noEmit`), `lint`, `format`, `test` (vitest run), `test:watch`, `test:e2e`.
3. `tsconfig.json` strict (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`), alias `@/` → `src/`.
4. Tạo cây thư mục theo ARCHITECTURE §5 (thêm `.gitkeep` cho thư mục rỗng).
5. `src/contracts/`: chuyển CONTRACTS.md thành `types.ts` (các `declare function` thành khai báo kiểu hàm/`interface`), `defaults.ts` (AppSettings mặc định: batch 30/5000/2, retry 3/1000, qa 1.8/false, budget null, keyMode 'SERVER'), `index.ts`. **Không đổi tên/trường** — nếu cần đổi, sửa CONTRACTS.md + DECISIONS + CHANGELOG (BREAKING) trước.
6. `tests/unit/contracts.test.ts`: kiểm tra `defaults` thoả `AppSettings` và type-check pass.
7. ESLint + Prettier cấu hình; `.gitignore` (node_modules, dist, .env, .netlify); `.env.example` (`AI_PROVIDER`, `AI_API_KEY`, `ACCESS_TOKEN`, `ALLOWED_ORIGINS`).
8. `.github/workflows/ci.yml`: Node LTS, `npm ci`, typecheck, lint, test, build.
9. `netlify.toml` tối thiểu (build command, publish `dist`, functions dir) — chưa viết function.
10. `src/main.tsx` + `App.tsx` trang khung đơn giản (tiêu đề tiếng Việt) để build chạy.
11. Cập nhật PROGRESS.md, HANDOFF.md, CHANGELOG.md, NEXT_TASK.md (→ SP-1.2, Claude 3).

## KHÔNG được
Không cài Tailwind (SP-1.2); không viết IndexedDB (SP-1.3); không sửa MASTER_PROMPT/PROJECT_SPEC; không đổi contract.

## Hoàn thành khi
`npm ci && npm run typecheck && npm run lint && npm test && npm run build` đều chạy qua (báo kết quả thật). Nếu không chạy được lệnh nào → ghi DONE_UNTESTED và liệt kê lệnh cho người dùng chạy.

## Test cần chạy
`npm test` (contracts.test.ts), `npm run typecheck`, `npm run build`.
