// E2E SP-6.4: dịch xong → bật kiểm tra chéo → chuỗi bị chấm thấp thành "Cần xem". Chạy: NODE_PATH=$(npm root -g) node tests/e2e-review.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const OUT = process.env.E2E_OUT ?? '/tmp/e2e';
const PORT = 8098;
const srv = spawn('node', ['scripts/serve.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

let translateCalls = 0, reviewCalls = 0, reviewedModel = '';
const reply = (route, obj) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 100, output_tokens: 50 }, stop_reason: 'end_turn' }) });
await page.route('https://api.anthropic.com/**', async (route) => {
  const body = JSON.parse(route.request().postData());
  const user = JSON.parse(body.messages[0].content);
  if (/KHÔNG dịch lại/.test(body.system)) {
    reviewCalls++; reviewedModel = body.model;
    // Chấm thấp mọi chuỗi đầu tiên của mỗi lô, còn lại đạt
    return reply(route, { reviews: user.items.map((i, k) => ({ id: i.id, accuracy: k === 0 ? 2 : 5, fluency: 5, issue: k === 0 ? 'Sai nghĩa (giả lập)' : '' })) });
  }
  translateCalls++;
  return reply(route, { translations: user.items.map((i) => ({ id: i.id, vi: 'Việt ' + i.text })) });
});

try {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('.tabs');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Chọn file' }).click()]);
  await chooser.setFiles('tests/fixtures/sample-en.json');
  await page.getByText('JSON hợp lệ').waitFor();
  await page.getByRole('button', { name: 'Tạo dự án và phân loại chuỗi' }).click();
  await page.getByText('Kết quả phân loại').waitFor();
  await page.getByRole('button', { name: 'Dịch tất cả' }).first().click();

  await page.getByRole('button', { name: /Cài đặt/ }).click();
  await page.locator('select').first().selectOption('DIRECT');
  await page.locator('input[type=password]').fill('sk-test-123');
  await page.locator('input[type=password]').blur();

  await page.getByRole('button', { name: /Tổng quan/ }).click();
  assert.equal(await page.getByText('Kiểm tra chéo bằng AI').count(), 0, 'mặc định không hiện thẻ kiểm tra chéo');
  await page.getByRole('button', { name: /Dịch tất cả/ }).click();
  await page.getByText('Đủ điều kiện xuất bản hoàn tất').waitFor({ timeout: 15000 });
  assert.ok(translateCalls >= 1);

  // Bật trong Cài đặt
  await page.getByRole('button', { name: /Cài đặt/ }).click();
  await page.getByLabel('Bật kiểm tra chéo bằng AI (SP-6.4, tốn thêm chi phí)').check();
  await page.getByPlaceholder('Để trống = dùng cùng mô hình dịch').fill('claude-review-x');
  await page.getByPlaceholder('Để trống = dùng cùng mô hình dịch').blur();
  await page.screenshot({ path: `${OUT}/r1-settings.png`, fullPage: true });

  await page.getByRole('button', { name: /Tổng quan/ }).click();
  await page.getByText('Kiểm tra chéo bằng AI (tuỳ chọn)').waitFor();
  await page.getByRole('button', { name: 'Kiểm tra mẫu ngẫu nhiên' }).click();
  await page.getByText(/Lần gần nhất: \d+\/\d+ chuỗi được chấm; [1-9]\d* bị đánh dấu/).waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${OUT}/r2-dashboard-reviewed.png`, fullPage: true });
  assert.ok(reviewCalls >= 1, 'đã gọi lượt kiểm tra');
  assert.equal(reviewedModel, 'claude-review-x', 'dùng mô hình kiểm tra riêng');

  // Chuỗi bị đánh dấu xuất hiện trong Biên tập với lý do
  await page.getByRole('button', { name: /Biên tập/ }).click();
  await page.getByText(/Kiểm tra chéo AI: nghĩa 2\/5/).first().waitFor();
  await page.screenshot({ path: `${OUT}/r3-editor-flagged.png`, fullPage: true });
  // Không còn đủ điều kiện hoàn tất vì có chuỗi cần xem
  await page.getByRole('button', { name: /Tổng quan/ }).click();
  assert.equal(await page.getByText('Đủ điều kiện xuất bản hoàn tất').count(), 0);
  assert.deepEqual(errors, [], 'không có lỗi console');
  console.log(`E2E REVIEW OK — dịch: ${translateCalls} lần, kiểm tra: ${reviewCalls} lần`);
} catch (e) {
  await page.screenshot({ path: `${OUT}/r-fail.png`, fullPage: true }).catch(() => {});
  console.error('E2E FAIL', e); process.exitCode = 1;
} finally { await browser.close(); srv.kill(); }
