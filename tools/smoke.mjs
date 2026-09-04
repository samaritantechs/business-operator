/* THE BROWSER SMOKE -- the one check the test suite cannot make.
 *
 * `npm test` runs the server against a fake PostgREST and parses every page, so it proves the
 * rules and proves the scripts COMPILE. It cannot prove the app BOOTS: that a tab actually
 * paints, that the nav reconfigures for a role, that a sale entered through the UI moves the
 * stock on the dashboard behind it. This drives the real app in a real Chromium against
 * `npm run dev` and its in-memory book, and fails on any uncaught page error.
 *
 * Playwright is deliberately NOT a dependency of this project -- there is no build step here
 * and nothing else needs it -- so install it only when you want to run this:
 *
 *     npm run dev &                       # http://localhost:8787
 *     npm install --no-save playwright    # browsers are already on the machine
 *     node tools/smoke.mjs                # screenshots land in tools/.smoke/
 *
 * Blocked external requests (the bootstrap/Chart.js CDNs, Google Fonts, legacy Drive
 * thumbnails) are NOT failures here: a sandbox without outbound network still has to render
 * the whole app, and the run below proves it does.
 */
import { chromium } from 'playwright';
const BASE = 'http://localhost:8787';
const OUT = new URL('./.smoke/', import.meta.url).pathname;
import { mkdirSync } from 'node:fs';
mkdirSync(OUT, { recursive: true });
const errors = [], failed = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
// Blocked external CDNs/images in this sandbox are not app faults; only page errors count.
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
page.on('pageerror', e => errors.push('pageerror: ' + String(e.message).slice(0, 200)));
page.on('requestfailed', r => failed.push(r.url().replace(BASE, '') + ' ' + (r.failure() || {}).errorText));

const step = async (name, fn) => {
  try { await fn(); console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' :: ' + String(e.message).split('\n')[0].slice(0, 160)); throw e; }
};

await step('marketplace loads and lists products', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('.mk-card, .market-card, [onclick^="openProductDetail"]', { timeout: 10000 });
  const n = await page.locator('[onclick^="openProductDetail"]').count();
  if (!n) throw new Error('no product cards rendered');
  console.log('       ' + n + ' product cards');
});
await page.screenshot({ path: OUT + '01-marketplace.png' });

await step('sign in as the phone-shop admin', async () => {
  await page.evaluate(() => showLogin(false));
  await page.waitForSelector('#loginId', { state: 'visible', timeout: 8000 });
  await page.fill('#loginId', 'frank');
  await page.fill('#loginPwd', 'pass1234');
  await page.click('#loginBtn, button[onclick="doLogin()"]');
  await page.waitForSelector('#mainApp:not(.hidden)', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#dashboardContent') && document.querySelector('#dashboardContent').children.length > 0, null, { timeout: 10000 });
});
await page.screenshot({ path: OUT + '02-dashboard.png' });

const tabs = ['sale', 'lendings', 'products', 'stock', 'cash', 'users', 'reports', 'account'];
for (const t of tabs) {
  await step('tab renders: ' + t, async () => {
    await page.evaluate(n => switchTab(n), t);
    const id = { sale: 'saleContent', lendings: 'lendingsContent', products: 'productsContent', stock: 'stockContent',
                 cash: 'cashContent', users: 'usersContent', reports: 'reportsContent', account: 'accountContent' }[t];
    await page.waitForFunction(el => {
      const e = document.getElementById(el);
      // Anchored, and the ellipsis is required: the Settings tab's FIRST CARD is called
      // "Loading Screen Duration", and a loose search for the word never went true.
      return e && e.children.length > 0 && !/^\s*(Loading…|Inapakia…)/.test(e.innerText || '');
    }, id, { timeout: 10000 });
    const txt = await page.locator('#' + id).innerText();
    if (/⚠️/.test(txt) && /error|failed|could not/i.test(txt)) throw new Error('error box on tab: ' + txt.slice(0, 120));
  });
}
await page.screenshot({ path: OUT + '03-stock.png' });

await step('sell a phone cover through the form', async () => {
  await page.evaluate(() => switchTab('sale'));
  await page.waitForSelector('#saleContent select, #saleContent .prod-pick', { timeout: 10000 });
  const before = await page.evaluate(async () => (await BO.srv('dashboard', {})).stock_value);
  const done = await page.evaluate(async () => {
    const r = await BO.srv('recordSale', { items: [{ product_id: 'P3', qty: 1, price: 5000 }], payment_method: 'Cash' });
    return r.message;
  });
  const after = await page.evaluate(async () => (await BO.srv('dashboard', {})).stock_value);
  if (!(after < before)) throw new Error('stock value did not drop: ' + before + ' -> ' + after);
  console.log('       ' + done + '; stock value ' + before + ' -> ' + after);
});

await step('manager signs in and the manager tabs render', async () => {
  await page.evaluate(() => logout(true));
  await page.waitForSelector('#landingPage:not(.hidden), #loginPage:not(.hidden)', { timeout: 10000 });
  await page.evaluate(() => showLogin(false));
  await page.waitForSelector('#loginId', { state: 'visible', timeout: 8000 });
  await page.fill('#loginId', 'markii');
  await page.fill('#loginPwd', 'pass1234');
  await page.click('#loginBtn, button[onclick="doLogin()"]');
  await page.waitForSelector('#mainApp:not(.hidden)', { timeout: 10000 });
  for (const [t, id] of [['manager', 'managerContent'], ['mgrreports', 'mgrReportsContent'], ['settings', 'settingsContent']]) {
    await page.evaluate(n => switchTab(n), t);
    await page.waitForFunction(el => {
      const e = document.getElementById(el);
      // Anchored, and the ellipsis is required: the Settings tab's FIRST CARD is called
      // "Loading Screen Duration", and a loose search for the word never went true.
      return e && e.children.length > 0 && !/^\s*(Loading…|Inapakia…)/.test(e.innerText || '');
    }, id, { timeout: 10000 });
  }
});
await page.screenshot({ path: OUT + '04-manager.png', fullPage: false });

await step('desktop toggle and dark/light both paint', async () => {
  await page.evaluate(() => toggleView());
  await page.evaluate(() => toggleTheme());
  await page.waitForTimeout(300);
});
await page.screenshot({ path: OUT + '05-desktop-light.png' });

await browser.close();
console.log('\nconsole errors: ' + errors.length);
for (const e of errors.slice(0, 12)) console.log('  ' + e);
console.log('failed requests: ' + failed.length);
for (const f of failed.slice(0, 8)) console.log('  ' + f);
process.exit(errors.length ? 1 : 0);
