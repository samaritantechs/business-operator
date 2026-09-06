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

const tabs = ['sale', 'holds', 'lendings', 'products', 'stock', 'po', 'cash', 'credit', 'users', 'reports', 'account'];
for (const t of tabs) {
  await step('tab renders: ' + t, async () => {
    await page.evaluate(n => switchTab(n), t);
    const id = { sale: 'saleContent', holds: 'holdsContent', lendings: 'lendingsContent', products: 'productsContent', stock: 'stockContent',
                 po: 'poContent', cash: 'cashContent', credit: 'creditContent', users: 'usersContent', reports: 'reportsContent', account: 'accountContent' }[t];
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

/* THE EDIT DIALOG, AS AN ADMIN. This is the bug this step exists for: the dialog's HTML was
   built at module load, when S.user is still null, so the admin-only Cost Price field was left
   out of it -- and edit() then tried to fill that missing field and threw before opening
   anything. The button did nothing, silently, for admins and managers only.
   No unit test could have seen it: the HTML is correct, the API is correct, and the two are
   only wrong about each other inside a browser after a real sign-in. */
await step('an admin can actually open the product Edit dialog', async () => {
  await page.evaluate(() => switchTab('products'));
  await page.waitForSelector('#productsContent table', { timeout: 10000 });
  const err = await page.evaluate(() => {
    try { BOProd.edit(0); return null; } catch (e) { return String(e && e.message || e); }
  });
  if (err) throw new Error('BOProd.edit(0) threw: ' + err);
  /* Bootstrap comes from a CDN and this app works without it, so a modal is "open" as either
     Bootstrap's .show or the fallback's .bo-fb. The smoke runs with the CDN blocked, so it is
     always the latter here -- match both rather than encode which one the network allowed. */
  await page.waitForSelector('#editProductModal.show, #editProductModal.bo-fb', { timeout: 5000 });
  const cost = await page.evaluate(() => !!document.getElementById('editProdCost'));
  if (!cost) throw new Error('the dialog opened without the Cost Price field an admin is allowed to see');
  const name = await page.evaluate(() => document.getElementById('editProdName').value);
  if (!name) throw new Error('the dialog opened empty -- nothing was filled in');
  await page.evaluate(() => closeModal('editProductModal'));
  console.log('       opened for "' + name + '", cost field present');
});

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

/* A HOLD, END TO END. The one thing only a browser can show: that holding a handset takes it out
   of the till's own IMEI picker, which is the whole mechanism -- the till was never taught about
   holds, the number simply left. */
await step('holding a phone takes it off the till, and collecting sells that exact handset', async () => {
  const out = await page.evaluate(async () => {
    const free = async () => {
      const p = (await BO.srv('productOptions', {})).products.find(x => x.id === 'P1');
      return (p.units || []).map(u => u.id);
    };
    const before = await free();
    /* The dev server's book is in memory and lives as long as the process, so a smoke run against
       a server that has already been smoked has fewer handsets than it started with. Say that,
       rather than failing later with "Unit null does not belong to ..." and sending the next
       person hunting a bug in the hold path. */
    if (!before.length) throw new Error('no free handsets left in the dev book — restart `npm run dev` and re-run');
    const h = await BO.srv('createPendingSale', { items: [{ product_id: 'P1', qty: 1, unit_ids: [before[0]] }], customer_name: 'Smoke Customer', deposit: 50000 });
    const during = await free();
    const done = await BO.srv('completePendingSale', { id: h.id, payment_method: 'Cash' });
    const after = await free();
    const sold = (await BO.srv('recentSales', { limit: 5 })).rows.find(s => s.group_id === done.group_id);
    return { held: before[0], before: before.length, during: during.length, after: after.length,
      stillThere: during.indexOf(before[0]), soldUnit: sold && sold.unit_id, balance: done.balance_due };
  });
  if (out.during !== out.before - 1) throw new Error('holding did not take the handset off the till: ' + JSON.stringify(out));
  if (out.stillThere !== -1) throw new Error('the held IMEI is still in the picker');
  if (out.soldUnit !== out.held) throw new Error('collecting sold a different handset: ' + out.soldUnit + ' vs ' + out.held);
  if (out.after !== out.during) throw new Error('the handset came back to the picker after being sold');
  await page.evaluate(() => { switchTab('holds'); BO.tabs.holds.load(); });
  await page.waitForSelector('#holdsContent .section-card', { timeout: 10000 });
  await page.screenshot({ path: OUT + '09-holds.png' });
  console.log('       held ' + out.held + ', till went ' + out.before + ' -> ' + out.during + ', balance due ' + out.balance);
});

/* A PURCHASE ORDER, END TO END. The suite proves the rules; only a browser proves the screen
   can raise one and receive it, and that the stock on the dashboard behind it actually moves. */
await step('raise a purchase order and receive it short', async () => {
  const out = await page.evaluate(async () => {
    const before = (await BO.srv('products', {})).rows.find(p => p.id === 'P3').stock;
    const po = await BO.srv('createPurchaseOrder', { items: [{ product_id: 'P3', qty: 40, unit_cost: 2800 }], supplier: 'Smoke Wholesale' });
    const open = (await BO.srv('purchaseOrders', { status: 'ordered' })).rows.find(r => r.id === po.id);
    const part = await BO.srv('receivePurchaseOrder', { id: po.id, receipts: [{ item_id: open.items[0].id, qty: 28 }] });
    const after = (await BO.srv('products', {})).rows.find(p => p.id === 'P3');
    const still = (await BO.srv('purchaseOrders', { status: 'ordered' })).rows.find(r => r.id === po.id);
    return { before, stock: after.stock, cost: after.cost_price, closed: part.closed, outstanding: still && still.outstanding };
  });
  if (out.stock !== out.before + 28) throw new Error('stock did not rise by 28: ' + out.before + ' -> ' + out.stock);
  if (out.cost !== 2800) throw new Error('the cost did not follow the delivery: ' + out.cost);
  if (out.closed !== false || out.outstanding !== 12) throw new Error('a short delivery must leave the order open, 12 owed; got ' + JSON.stringify(out));
  await page.evaluate(() => { switchTab('po'); BO.tabs.po.load(); });
  await page.waitForSelector('.po-card', { timeout: 10000 }).catch(async e => {
    const dump = await page.evaluate(() => {
      const el = document.getElementById('poContent');
      return { tab: (typeof S !== 'undefined' ? S.tab : '?'), html: el ? el.innerHTML.slice(0, 400) : 'NO ELEMENT',
               paneHidden: (document.getElementById('tab-po') || {}).className };
    });
    throw new Error('no .po-card — ' + JSON.stringify(dump));
  });
  await page.screenshot({ path: OUT + '08-purchase-orders.png' });
  console.log('       stock ' + out.before + ' -> ' + out.stock + ', cost now ' + out.cost + ', ' + out.outstanding + ' still owed');
});

/* LENDING FROM THE TILL. The server side is unchanged -- the same recordLending the Lendings
   screen has always called -- so what needs proving in a browser is the ROUTING: that picking
   Lending swaps the form over, demands a borrower, and sends the basket to the other door. */
await step('the till can lend instead of sell', async () => {
  await page.evaluate(() => switchTab('sale'));
  await page.waitForSelector('#payMethod', { timeout: 10000 });
  await page.selectOption('#payMethod', 'Lending');
  await page.waitForSelector('#borrowerWrap', { state: 'visible', timeout: 5000 });
  const label = await page.textContent('#saleSubmitBtn');
  if (!/Lending/.test(label)) throw new Error('the button still says "' + label.trim() + '"');

  const before = await page.evaluate(async () => (await BO.srv('lendings', {})).rows.length);
  const msg = await page.evaluate(async () => {
    const r = await BO.srv('recordLending', { items: [{ product_id: 'P3', qty: 1, price: 5000 }], borrower_name: 'Smoke Borrower', borrower_phone: '0700000000' });
    return r.message || 'ok';
  });
  const after = await page.evaluate(async () => (await BO.srv('lendings', {})).rows.length);
  if (!(after > before)) throw new Error('the lending did not land: ' + before + ' -> ' + after);
  console.log('       ' + msg + '; lendings ' + before + ' -> ' + after);
  await page.selectOption('#payMethod', 'Cash');
  await page.waitForSelector('#borrowerWrap', { state: 'hidden', timeout: 5000 });
});

/* THE RECEIPT ACTUALLY DRAWS. The suite proves the server builds one and the parser proves the
   file compiles; only a browser proves the modal opens, fills, and produces the plain text that
   goes into a WhatsApp message. */
await step('a receipt opens for the sale that was just made', async () => {
  const latest = await page.evaluate(async () => {
    const r = await BO.srv('recentSales', { limit: 1 });
    return { group_id: r.rows[0].group_id, product: r.rows[0].product_name };
  });
  await page.evaluate(g => BORcpt.open({ group_id: g }), latest.group_id);
  await page.waitForSelector('#rcptSheet .rcpt-total', { timeout: 10000 });
  const text = await page.evaluate(() => BORcpt.asText());
  if (!/TOTAL: /.test(text)) throw new Error('the copyable receipt has no total: ' + text.slice(0, 120));
  /* Whatever the newest sale actually was -- the order of the steps above has changed before and
     will again, so the check is against the sale, not against a product name typed in here. */
  if (text.indexOf(latest.product) === -1) throw new Error('"' + latest.product + '" is missing from the receipt text');
  await page.screenshot({ path: OUT + '06-receipt.png' });
  await page.evaluate(() => BO.closeDialog());
  await page.waitForSelector('#rcptSheet', { state: 'detached', timeout: 8000 }).catch(() => {});
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
