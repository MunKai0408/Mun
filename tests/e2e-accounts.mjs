// E2E trang điều phối tài khoản. Chạy: NODE_PATH=$(npm root -g) node tests/e2e-accounts.mjs
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = process.env.E2E_OUT ?? '/tmp/e2e';
const srv = spawn('node', ['scripts/serve.mjs'], { env: { ...process.env, PORT: '8098' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
page.setDefaultTimeout(6000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto('http://localhost:8098/accounts.html');
  await page.getByText('5/5 sẵn sàng').waitFor();
  const cards = page.locator('article.acc');
  assert.equal(await cards.count(), 5);
  await cards.nth(0).getByRole('button', { name: 'Dùng tài khoản này' }).click();
  await cards.nth(0).locator('.qq button', { hasText: '50%' }).first().click();
  await cards.nth(1).getByRole('button', { name: 'Hết lượt 5h' }).click();
  await cards.nth(2).locator('.qq button', { hasText: '20%' }).nth(1).click(); // tuần còn 20%
  await page.getByText('4/5 sẵn sàng').waitFor();
  assert.match(await page.locator('.sum').innerText(), /Đang làm\s*Tài khoản 1/);
  await page.screenshot({ path: `${OUT}/acc-1.png`, fullPage: true });
  await page.reload();
  await page.getByText('4/5 sẵn sàng').waitFor(); // lưu bền vững
  assert.match(await page.locator('article.acc.lim').first().innerText(), /Hết lượt/);
  console.log('ACCOUNTS OK', errors.length ? errors : '');
} catch (e) { console.error('FAIL', e.message.split('\n')[0]); await page.screenshot({ path: `${OUT}/acc-fail.png` }); process.exitCode = 1; }
finally { await browser.close(); srv.kill(); }
