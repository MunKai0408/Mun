// E2E bằng Chromium thật (cần Playwright toàn cục). Chạy: NODE_PATH=$(npm root -g) node tests/e2e.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const OUT = process.env.E2E_OUT ?? '/tmp/e2e';
const PORT = 8099;
const srv = spawn('node', ['scripts/serve.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// Nhà cung cấp AI giả (Anthropic) — chặn ở tầng mạng của trình duyệt
let apiCalls = 0;
await page.route('https://api.anthropic.com/**', async (route) => {
  apiCalls++;
  const body = JSON.parse(route.request().postData());
  const user = JSON.parse(body.messages[0].content);
  const out = { translations: user.items.map((i) => ({ id: i.id, vi: i.text.replace(/\{\{damage\}\}/, '{{damage}}').split('').length ? 'Việt ' + i.text : '' })) };
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(out) }], usage: { input_tokens: 500, output_tokens: 200 }, stop_reason: 'end_turn' }) });
});
await page.route('https://api.anthropic.com/**', (r) => r.fallback()); // giữ nguyên handler trên

try {
await page.goto(`http://localhost:${PORT}/`);
await page.waitForSelector('.tabs');
await page.screenshot({ path: `${OUT}/01-upload-empty.png` });

// Tải file
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Chọn file' }).click()]);
await chooser.setFiles('tests/fixtures/sample-en.json');
await page.getByText('JSON hợp lệ').waitFor();
await page.screenshot({ path: `${OUT}/02-parsed.png`, fullPage: true });
await page.getByRole('button', { name: 'Tạo dự án và phân loại chuỗi' }).click();
await page.getByText('Kết quả phân loại').waitFor();
await page.getByText('Cần xác nhận phân loại').waitFor(); // DarkKnight
await page.screenshot({ path: `${OUT}/03-classified.png`, fullPage: true });
await page.getByRole('button', { name: 'Dịch tất cả' }).first().click(); // duyệt chuỗi nghi ngờ = dịch

// Cài đặt
await page.getByRole('button', { name: /Cài đặt/ }).click();
await page.locator('select').first().selectOption('DIRECT');
await page.locator('input[type=password]').fill('sk-test-123');
await page.locator('input[type=password]').blur();
await page.getByRole('button', { name: 'Kiểm tra kết nối' }).click();
await page.getByText('✓ Kết nối được').waitFor();
await page.screenshot({ path: `${OUT}/04-settings.png`, fullPage: true });

// Dịch
await page.getByRole('button', { name: /Tổng quan/ }).click();
await page.getByRole('button', { name: /Dịch tất cả/ }).click();
await page.getByText('Đủ điều kiện xuất bản hoàn tất').waitFor({ timeout: 15000 });
await page.screenshot({ path: `${OUT}/05-dashboard-done.png`, fullPage: true });
assert.ok(apiCalls >= 2, 'đã gọi nhà cung cấp');

// Biên tập
await page.getByRole('button', { name: /Biên tập/ }).click();
await page.getByText('Việt Play').first().waitFor().catch(() => {});
const ta = page.locator('textarea').first();
await ta.fill('Chơi ngay');
await page.getByRole('button', { name: 'Lưu' }).first().click();
await page.getByText('Đã lưu.').waitFor();
await page.screenshot({ path: `${OUT}/06-editor.png`, fullPage: true });

// Tải lại trang: tiến độ còn nguyên
await page.reload();
await page.waitForSelector('.tabs');
await page.getByText('Đạt QA').first().waitFor();
const hdr = await page.locator('#hdr-text').innerText();
assert.match(hdr, /100%/, 'tiến độ phải còn sau khi tải lại: ' + hdr);

// Xuất
await page.getByRole('button', { name: /Xuất/ }).click();
await page.getByText('Hoàn tất: mọi chuỗi đã xử lý').waitFor();
await page.screenshot({ path: `${OUT}/07-export.png`, fullPage: true });
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Tải sample-en\.vi\.json/ }).click()]);
const path = await dl.path();
const out = JSON.parse(readFileSync(path, 'utf8'));
const src = JSON.parse(readFileSync('tests/fixtures/sample-en.json', 'utf8'));
const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, p + '/' + k) : [p + '/' + k]));
assert.deepEqual(keys(out), keys(src), 'key không đổi');
assert.equal(out.ui.menu.play, 'Chơi ngay');
assert.equal(out.items.sword_01.name, 'Việt Iron Sword');
assert.equal(out.items.potion_health.desc, 'Việt Restores <b>50</b> HP to the drinker.\nTastes of cherries.');
assert.equal(out.meta.icon, 'assets/ui/icon.png');
assert.equal(out.meta.version, '1.0.3');
assert.equal(out.count, 42);
assert.equal(out.ui.color, '#FF8800');
console.log('E2E OK — số lần gọi AI:', apiCalls);
if (errors.length) { console.log('Lỗi console/trang:', errors); process.exitCode = 1; }
} catch (e) {
  console.error('E2E FAIL:', e.message.split('\n').slice(0, 6).join('\n'));
  await page.screenshot({ path: `${OUT}/zz-fail.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  srv.kill();
}
