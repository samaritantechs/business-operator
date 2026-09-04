/* THE TWO HOME SCREENS, against the fixture's known day. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { richBook, bookDb, userOf, NOW } from './_book.mjs';
import { vendorSalesSummary } from '../api/_lib/bo/_shared.js';

const { FN } = await import('../api/_lib/bo/dashboard.js');

const ADM = () => userOf(richBook(), 'ADM1');
const SEL = () => userOf(richBook(), 'SEL1');
const ADM2 = () => userOf(richBook(), 'ADM2');
const MGR = () => userOf(richBook(), 'MGR');

test('the admin dashboard: today / week / month / year, chart, seller balances, stock, shops', async () => {
  const db = bookDb();
  const d = await FN.dashboard(db, ADM(), {}, NOW);
  assert.equal(d.currency, 'TZS');
  assert.equal(d.today_total, 355000);
  assert.equal(d.week_total, 355000);
  assert.equal(d.month_total, 355000);
  assert.equal(d.year_total, 378000);                     // + S5 (Aug 30) + S6 (Jul 15)
  assert.equal(d.chart.length, 7);
  assert.equal(d.chart[6].label, 'Today');
  assert.equal(d.chart[6].value, 355000);
  assert.equal(d.chart[3].value, 18000);                  // Aug 30 is three days before Sep 2
  assert.equal(d.low_count, 0);
  assert.equal(d.stock_value, 350000 * 3 + 280000 * 2 + 5000 * 40);
  assert.deepEqual(d.products.map(p => p.legacy_id), ['P001', 'P002', 'P003']);
  const juma = d.seller_rows.find(r => r.name === 'Juma Seller');
  assert.equal(juma.cash_sales, 10000); assert.equal(juma.lipa_sales, 0); assert.equal(juma.credit_sales, 340000);
  assert.equal(juma.cash_received, 6000); assert.equal(juma.cash_due, 4000);
  assert.equal(juma.lipa_received, 0); assert.equal(juma.lipa_due, 0);
  const asha = d.seller_rows.find(r => r.name === 'Asha Seller');
  assert.equal(asha.lipa_sales, 5000); assert.equal(asha.lipa_received, 5000); assert.equal(asha.lipa_due, 0);   // no receipt => Lipa counts as received
  assert.ok(!d.seller_rows.some(r => r.name === 'Gone Seller'));
  assert.deepEqual(d.branch_rows.map(b => b.name), ['Kariakoo', 'Sinza']);
  assert.equal(d.branch_rows.find(b => b.name === 'Sinza').today, 350000);
  assert.equal(d.branch_rows.find(b => b.name === 'Kariakoo').today, 5000);
});

test('a seller sees only their own figures, and no balances table', async () => {
  const db = bookDb();
  const d = await FN.dashboard(db, SEL(), {}, NOW);
  assert.equal(d.today_total, 350000);
  assert.equal(d.year_total, 373000);
  assert.deepEqual(d.self, { cash: 10000, lipa: 0, credit: 340000, items: 3 });
  assert.equal(d.seller_rows, undefined);
  assert.equal(d.products.length, 3);                      // stock is still the vendor's
});

test('a branch filter narrows the figures to that shop', async () => {
  const db = bookDb();
  const d = await FN.dashboard(db, ADM(), { branch_id: 'B2' }, NOW);
  assert.equal(d.today_total, 5000);
  assert.equal(d.branch_rows, undefined);
});

test('a vendor with no shops gets no shop rows; a manager must name a vendor', async () => {
  const db = bookDb();
  const d = await FN.dashboard(db, ADM2(), {}, NOW);
  assert.equal(d.today_total, 6400);
  assert.equal(d.branch_rows, undefined);
  assert.equal(d.low_count, 1);                            // sugar: 8 < reorder 10
  await assert.rejects(FN.dashboard(db, MGR(), {}, NOW), e => e.status === 400);
  const m = await FN.dashboard(db, MGR(), { vendor_id: 'V1' }, NOW);
  assert.equal(m.today_total, 355000);
});

test('the manager dashboard adds every business up', async () => {
  const db = bookDb();
  const d = await FN.managerDashboard(db, MGR(), {}, NOW);
  assert.equal(d.vendor_count, 3);
  assert.equal(d.today, 361400);
  assert.equal(d.year, 384400);
  assert.deepEqual(d.rows.map(r => r.name), ['Fromville Phones', 'Locked Shop', 'Mama Ntilie Grocery']);
  const v1 = d.rows[0];
  assert.equal(v1.admin_name, 'Frank Amos'); assert.equal(v1.admin_handle, 'frank'); assert.equal(v1.sellers, 2); assert.equal(v1.products, 3);
  await assert.rejects(FN.managerDashboard(db, ADM(), {}, NOW), e => e.status === 403);
});

test('the RPC path answers the same as the paged fallback', async () => {
  const withRpc = bookDb(richBook(), { rpc: {
    bo_vendor_sales_summary: (store, a) => {
      const out = new Map();
      for (const s of store.sales.rows) {
        if (s.status !== 'completed' || s.sold_at < a.p_year) continue;
        const r = out.get(s.vendor_id) || { vendor_id: s.vendor_id, today: 0, week: 0, month: 0, year: 0 };
        if (s.sold_at >= a.p_today) r.today += s.total;
        if (s.sold_at >= a.p_week) r.week += s.total;
        if (s.sold_at >= a.p_month) r.month += s.total;
        r.year += s.total;
        out.set(s.vendor_id, r);
      }
      return [...out.values()];
    },
  } });
  const a = await FN.managerDashboard(withRpc, MGR(), {}, NOW);
  const b = await FN.managerDashboard(bookDb(), MGR(), {}, NOW);
  assert.deepEqual(a, b);
});

/* Turning the dashboard off for sellers used to hide the nav button and nothing else, so the
   day's takings for the whole shop and the value of the shelves were still one request away
   from any seller who asked. reports.js enforces its seller permission; this one now does too. */
test('dashboard: a business that hides it from sellers actually hides it', async () => {
  const book = richBook();
  book.vendors.find(v => v.id === 'V1').permissions = { dashboardVisible: false };
  const db = bookDb(book);
  await assert.rejects(FN.dashboard(db, userOf(book, 'SEL1'), {}, NOW), e => {
    assert.equal(e.status, 403);
    assert.match(e.message, /not enabled for sellers/);
    return true;
  });
  // The people who run the business still see it.
  assert.ok((await FN.dashboard(db, userOf(book, 'ADM1'), {}, NOW)).today_total > 0);
  // And a business that leaves it on is untouched -- including by the default, which is on.
  const open = bookDb();
  assert.ok((await FN.dashboard(open, userOf(richBook(), 'SEL1'), {}, NOW)).self);
  const dflt = richBook();
  dflt.vendors.find(v => v.id === 'V1').permissions = {};
  assert.ok((await FN.dashboard(bookDb(dflt), userOf(dflt, 'SEL1'), {}, NOW)).self, 'the default is visible');
});

/* The per-shop table used to carry a "Year" column filled with the sum of the admin's read
   window -- which starts at the month, not the year. A shop's month was being read as its
   year, in a column headed Year, next to a vendor total whose year was real. */
test('dashboard: the per-shop rows offer no year, because this read cannot honestly give one', async () => {
  const d = await FN.dashboard(bookDb(), userOf(richBook(), 'ADM1'), {}, NOW);
  assert.ok(d.branch_rows && d.branch_rows.length, 'the vendor has shops');
  for (const r of d.branch_rows) {
    assert.deepEqual(Object.keys(r).sort(), ['branch_id', 'month', 'name', 'today', 'units', 'week']);
    assert.equal(r.year, undefined);
  }
  // The vendor's own year is a real year and stays.
  assert.equal(typeof d.year_total, 'number');
});

/* The fallback summary compared timestamps as TEXT against the day's start. PostgREST spells a
   timestamptz in offset form, so a sale at 23:00+03:00 -- 20:00 UTC, an hour before the EAT day
   began -- sorted after the bound '...T21:00:00.000Z' and was counted in today's takings. */
test('vendorSalesSummary: the fallback bounds days by instant, not by spelling', async () => {
  const book = richBook();
  book.sales.push({ id: 'SX', vendor_id: 'V1', status: 'completed', total: 99999, sold_at: '2026-09-01T23:00:00+03:00' });
  const m = await vendorSalesSummary(bookDb(book), NOW);
  const v1 = m.get('V1');
  assert.equal(v1.today, 355000, 'a sale before the EAT day began is not today\'s');
  assert.equal(v1.year, 477999, 'but it is still this year\'s');
  // And one written the other way round, inside the day, is counted.
  const book2 = richBook();
  book2.sales.push({ id: 'SY', vendor_id: 'V1', status: 'completed', total: 500, sold_at: '2026-09-02T06:00:00+03:00' });
  assert.equal((await vendorSalesSummary(bookDb(book2), NOW)).get('V1').today, 355500);
});
