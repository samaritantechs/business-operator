/* WHAT THE SHOP EARNED, AND WHO BOUGHT IT.
 *
 * Two things the old app could not answer and this one now can, and one thing it must never
 * answer for the wrong person: a seller may not see what the shop paid. That last is the point
 * of most of this file. Cost is the number that tells a member of staff exactly what the owner
 * is making per handset, in a trade where the next shop is fifty metres away. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { richBook, bookDb, userOf, NOW } from './_book.mjs';

const { FN: SALES } = await import('../api/_lib/bo/sales.js');
const { FN: PRODUCTS } = await import('../api/_lib/bo/products.js');
const { FN: REPORTS } = await import('../api/_lib/bo/reports.js');
const { boApi } = await import('../api/_lib/bo-core.js');

const ADM = () => userOf(richBook(), 'ADM1');
const SEL = () => userOf(richBook(), 'SEL1');
const MGR = () => userOf(richBook(), 'MGR');
const saleOf = (db, id) => db._dump('sales').find(s => s.id === id);
const rowFor = (rep, name) => rep.rows.find(r => r.product_name === name);
const report = (db, user, args) => REPORTS.reportData(db, user, args, NOW);
async function rejects(p, status, re) {
  await assert.rejects(p, e => { assert.equal(e.status, status, e.message); if (re) assert.match(e.message, re); return true; });
}

/* ------------------------------------------------------------------ the snapshot */

test('a sale freezes the cost of the thing sold, so a later restock cannot rewrite history', async () => {
  const db = bookDb();
  const r = await SALES.recordSale(db, SEL(), { items: [{ product_id: 'P3', qty: 2 }], payment_method: 'Cash' }, NOW);
  assert.equal(saleOf(db, r.sale_ids[0]).unit_cost, 3000);

  // The supplier puts the price up. Yesterday's margin must not move with it.
  await PRODUCTS.updateProduct(db, ADM(), { id: 'P3', cost_price: 4200 }, NOW);
  assert.equal(saleOf(db, r.sale_ids[0]).unit_cost, 3000, 'the sale keeps the cost it was sold at');

  const after = await SALES.recordSale(db, SEL(), { items: [{ product_id: 'P3', qty: 1 }], payment_method: 'Cash' }, NOW);
  assert.equal(saleOf(db, after.sale_ids[0]).unit_cost, 4200, 'and the next sale takes the new one');
});

test('a product with no cost recorded sells at unit_cost 0 rather than failing', async () => {
  const db = bookDb();
  const r = await SALES.recordSale(db, userOf(richBook(), 'SEL3'), { items: [{ product_id: 'P5', qty: 1 }], payment_method: 'Cash' }, NOW);
  assert.equal(saleOf(db, r.sale_ids[0]).unit_cost, 0);
});

/* ------------------------------------------------------------------ who may see it */

test('a seller never receives cost_price, on any read that reaches them', async () => {
  const db = bookDb();
  const seller = SEL();

  const opts = await PRODUCTS.productOptions(db, seller, {});
  for (const p of opts.products) assert.equal('cost_price' in p, false, 'productOptions feeds the till: no cost there');

  /* salesDetail is the seller-facing dashboard drill-down, and its rows come from the sales
     table where unit_cost now lives. This is the read that would have leaked it. */
  const detail = await SALES.salesDetail(db, seller, { period: 'today' }, NOW);
  for (const g of detail.groups) for (const row of g.rows) {
    assert.equal('unit_cost' in row, false, 'a seller must not be handed the margin on their own sale');
  }
});

test('an admin and a manager do see it', async () => {
  const db = bookDb();
  const detail = await SALES.salesDetail(db, ADM(), { period: 'today' }, NOW);
  const rows = detail.groups.flatMap(g => g.rows);
  assert.ok(rows.length);
  assert.ok(rows.some(r => 'unit_cost' in r), 'the owner is the person the figure is for');
  const mgr = await SALES.salesDetail(db, MGR(), { period: 'today', vendor_id: 'V1' }, NOW);
  assert.ok(mgr.groups.flatMap(g => g.rows).some(r => 'unit_cost' in r));
});

test('a product list drops the cost for a seller and keeps it for an admin', async () => {
  const db = bookDb();
  const forAdmin = await PRODUCTS.products(db, ADM(), {});
  assert.equal(forAdmin.rows.find(p => p.id === 'P3').cost_price, 3000);
  const forSeller = await PRODUCTS.products(db, SEL(), {});
  assert.equal('cost_price' in forSeller.rows.find(p => p.id === 'P3'), false);
});

test('a seller cannot WRITE the cost either, even by sending the field', async () => {
  /* Reading is only half of it. If the edit request accepted cost_price from anybody, a seller
     could set it to zero and every profit figure in the business would read as pure margin. */
  const db = bookDb();
  await rejects(PRODUCTS.updateProduct(db, SEL(), { id: 'P3', cost_price: 0 }, NOW), 403);
  assert.equal(db._dump('products').find(p => p.id === 'P3').cost_price, 3000);
});

/* ------------------------------------------------------------------ the report */

test('the profit report: revenue, cost, margin and what was given away', async () => {
  const db = bookDb();
  const rep = await report(db, ADM(), { type: 'profit', start: '2026-09-02', end: '2026-09-02' });

  const phone = rowFor(rep, 'Samsung Galaxy A05');
  assert.equal(phone.units, 1);
  assert.equal(phone.revenue, 340000);            // 350,000 list less 10,000 off
  assert.equal(phone.cost, 290000);               // the SNAPSHOT, not today's 300,000
  assert.equal(phone.profit, 50000);
  assert.equal(phone.discount, 10000);
  assert.equal(phone.margin, '14.7%');

  const cover = rowFor(rep, 'Phone Cover');
  assert.equal(cover.units, 3);                   // S2 two + S3 one; the cancelled S4 is not counted
  assert.equal(cover.revenue, 15000);
  assert.equal(cover.cost, 9000);
  assert.equal(cover.profit, 6000);

  const totals = Object.fromEntries(rep.totals);
  assert.match(totals['REVENUE'], /355,000/);
  assert.match(totals['COST OF GOODS'], /299,000/);
  assert.match(totals['GROSS PROFIT'], /56,000/);
  assert.match(totals['GIVEN AWAY IN DISCOUNTS'], /10,000/);
  assert.equal(rep.rows[0].product_name, 'Samsung Galaxy A05', 'best earner first');
});

test('the profit report SAYS when a figure is only the best case', async () => {
  /* Silence reads as success (CLAUDE.md rule 2). A line sold before anybody recorded a cost
     counts as costing nothing, which makes the profit look better than it is -- so the report
     says so, in the report, rather than leaving an owner to trust a number that is wrong. */
  const db = bookDb();
  const withCost = await report(db, ADM(), { type: 'profit', start: '2026-09-02', end: '2026-09-02' }, NOW);
  assert.equal(withCost.meta.some(m => /WARNING/.test(m)), false, 'nothing to warn about when every line has a cost');

  const db2 = bookDb();
  await PRODUCTS.updateProduct(db2, ADM(), { id: 'P3', cost_price: 0 }, NOW);
  await SALES.recordSale(db2, SEL(), { items: [{ product_id: 'P3', qty: 5 }], payment_method: 'Cash' }, NOW);
  const rep = await report(db2, ADM(), { type: 'profit', start: '2026-09-02', end: '2026-09-02' });
  const warn = rep.meta.find(m => /WARNING/.test(m));
  assert.ok(warn, 'a costless line must be called out');
  assert.match(warn, /5 units were sold with no cost price/);
  assert.match(warn, /HIGHEST it could be/);
});

test('a seller cannot open the profit report at all', async () => {
  const db = bookDb();
  await rejects(report(db, SEL(), { type: 'profit', start: '2026-09-02', end: '2026-09-02' }, NOW), 403);
});

/* ------------------------------------------------------------------ the customer */

test('a checkout records the customer on every one of its lines, or nothing at all', async () => {
  const db = bookDb();
  const named = await SALES.recordSale(db, SEL(), {
    items: [{ product_id: 'P3', qty: 1 }, { product_id: 'P3', qty: 2 }],
    payment_method: 'Cash', customer_name: '  Neema Mushi  ', customer_phone: ' 0712000111 ',
  }, NOW);
  for (const id of named.sale_ids) {
    assert.equal(saleOf(db, id).customer_name, 'Neema Mushi', 'trimmed, and on every line');
    assert.equal(saleOf(db, id).customer_phone, '0712000111');
  }

  const walkIn = await SALES.recordSale(db, SEL(), { items: [{ product_id: 'P3', qty: 1 }], payment_method: 'Cash' }, NOW);
  assert.equal(saleOf(db, walkIn.sale_ids[0]).customer_name, null, 'a walk-in stays blank, not "" and not "unknown"');
  assert.equal(saleOf(db, walkIn.sale_ids[0]).customer_phone, null);

  const blank = await SALES.recordSale(db, SEL(), { items: [{ product_id: 'P3', qty: 1 }], payment_method: 'Cash', customer_name: '   ' }, NOW);
  assert.equal(saleOf(db, blank.sale_ids[0]).customer_name, null, 'whitespace is not a name');
});

test('the customer report groups by phone, counts visits, and keeps walk-ins visible', async () => {
  const db = bookDb();
  const rep = await report(db, ADM(), { type: 'customer', start: '2026-09-02', end: '2026-09-02' }, NOW);

  const neema = rep.rows.find(r => r.customer_phone === '0712000111');
  assert.ok(neema, 'the named customer is there');
  assert.equal(neema.customer_name, 'Neema Mushi');
  assert.equal(neema.visits, 2, 'two separate checkouts, not four sale lines');
  assert.equal(neema.total, 350000);

  const walkIn = rep.rows.find(r => /Walk-in/.test(r.customer_name));
  assert.ok(walkIn, '"how much of today was people we cannot call back" is the point of the report');
  assert.equal(walkIn.total, 5000);
  assert.equal(rep.rows[0].customer_phone, '0712000111', 'most valuable first');
});

test('the sales report carries the customer, and a manager can still read every vendor', async () => {
  const db = bookDb();
  const rep = await report(db, ADM(), { type: 'sales', start: '2026-09-02', end: '2026-09-02' }, NOW);
  assert.ok(rep.columns.some(c => c.key === 'customer_name'), 'the column exists');
  assert.equal(rep.rows.find(r => r.sale_id === 'SALE-0001').customer_name, 'Neema Mushi');
  assert.equal(rep.rows.find(r => r.sale_id === 'SALE-0003').customer_name, '', 'a walk-in reads as blank, not "null"');

  const all = await report(db, MGR(), { type: 'profit', start: '2026-09-02', end: '2026-09-02' }, NOW);
  assert.ok(all.columns.some(c => c.key === 'vendor_name'), "a manager's every-vendor report names the vendor");
});

test('recordSale still refuses what it always refused, with a customer attached', async () => {
  const db = bookDb();
  await rejects(SALES.recordSale(db, SEL(), { items: [{ product_id: 'P3', qty: 999 }], payment_method: 'Cash', customer_name: 'X' }, NOW), 400, /Insufficient stock/);
  assert.equal(db._dump('sales').filter(s => s.customer_name === 'X').length, 0, 'a refused sale writes nothing');
});

test('the whole thing goes through the API surface a browser actually calls', async () => {
  const db = bookDb();
  const r = await boApi(db, ADM(), 'reportData', { type: 'profit', start: '2026-09-02', end: '2026-09-02' }, NOW);
  assert.ok(r.rows.length);
  assert.ok(r.totals.some(t => t[0] === 'GROSS PROFIT'));
});

test('a hold deposit is cash on a different day, and the Cash Due report now says so', async () => {
  /* Juma takes a deposit on Monday against a hold; nothing recorded it, so Monday was light.
     Neema collects on Friday and recordSale books the WHOLE amount as Friday's cash sale, so
     Friday billed Juma for money that never crossed the counter that day. The owner counts the
     drawer against that figure and finds it short with nothing explaining the gap. */
  const { FN: HOLDS } = await import('../api/_lib/bo/pending.js');
  const db = bookDb();
  const before = (await report(db, ADM(), { type: 'cashdue' })).rows.find(r => /Juma/.test(r.seller));

  const h = await HOLDS.createPendingSale(db, SEL(), {
    items: [{ product_id: 'P3', qty: 20, list_price: 5000 }], customer_name: 'Neema Mushi', deposit: 40000,
  }, NOW);

  const held = (await report(db, ADM(), { type: 'cashdue' })).rows.find(r => /Juma/.test(r.seller));
  assert.equal(held.dep_taken, 40000, 'the 40,000 he is holding is on his row the day he takes it');
  assert.equal(held.balance, before.balance + 40000, 'and it is in what he owes the till');

  await HOLDS.completePendingSale(db, SEL(), { id: h.id, payment_method: 'Cash' }, NOW);
  const done = (await report(db, ADM(), { type: 'cashdue' })).rows.find(r => /Juma/.test(r.seller));
  assert.equal(done.dep_applied, 40000, 'on collection the deposit is named as already paid');
  assert.equal(done.cash_sales, before.cash_sales + 100000, 'the sale is still the full 100,000');
  assert.equal(done.balance, before.balance + 100000, 'but he is billed 100,000 once, not 140,000');

  const rep = await report(db, ADM(), { type: 'cashdue' });
  assert.ok(rep.meta.some(m => /Deposits Taken/.test(m)), 'and the report explains the two columns');
});

test('the Cash Due deposit columns use the East Africa day, like every other figure on it', async () => {
  /* Slicing a UTC timestamp put a deposit taken at 01:30 EAT on the day before, while the SALE it
     belongs to was counted for today by periodBounds, which does use the EAT clock. The two
     halves of one balance disagreed and a seller was billed for money they never took. */
  const { FN: HOLDS } = await import('../api/_lib/bo/pending.js');
  const at0130EAT = Date.parse('2026-09-04T22:30:00Z');       // 01:30 on 5 Sep, East Africa
  const db = bookDb();
  const h = await HOLDS.createPendingSale(db, SEL(), {
    items: [{ product_id: 'P3', qty: 20, list_price: 5000 }], customer_name: 'Neema', deposit: 40000,
  }, at0130EAT);
  await HOLDS.completePendingSale(db, SEL(), { id: h.id, payment_method: 'Cash' }, at0130EAT);

  const rep = await REPORTS.reportData(db, ADM(), { type: 'cashdue' }, at0130EAT);
  const juma = rep.rows.find(r => /Juma/.test(r.seller));
  assert.equal(juma.dep_taken, 40000, 'taken in the small hours still counts for that shop-day');
  assert.equal(juma.dep_applied, 40000, 'and so does applied');
});

test('a Cash Due report that could not read the deposits SAYS so', async () => {
  /* A bare catch put "the table is not there yet" and "the database just timed out" in the same
     branch, and both produced silently wrong balances -- the exact silent shortfall the deposit
     columns exist to remove. */
  const db = bookDb();
  const broken = new Proxy(db, {
    get(t, k) {
      if (k !== 'from') return t[k];
      return name => {
        if (name !== 'pending_sales') return t.from(name);
        const q = t.from(name);
        q.then = (res) => res({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
        return q;
      };
    },
  });
  const rep = await REPORTS.reportData(broken, ADM(), { type: 'cashdue' }, NOW);
  assert.ok(rep.rows.length, 'the report still opens');
  const warn = rep.meta.find(m => /WARNING/.test(m));
  assert.ok(warn, 'and it does not pretend the deposits were zero');
  assert.match(warn, /Balance below may be wrong/, 'it says which figures to distrust');
  /* The reason reaches the reader through friendlyDbError, so a shop is told "the database is
     briefly unreachable", not "canceling statement due to statement timeout". That is right --
     what matters is that SOMETHING is said, not that Postgres is quoted. */
  assert.match(warn, /briefly unreachable|haupatikani/);
});
