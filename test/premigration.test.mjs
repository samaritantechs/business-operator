/* THE DAY THE CODE SHIPS AND THE MIGRATION HAS NOT BEEN RUN.
 *
 * Migrations here are run BY HAND in the Supabase SQL editor, and the code deploys itself the
 * moment a branch merges. So every release spends some window — minutes, or a weekend — with
 * new code talking to an old database. CLAUDE.md: "Every code path that depends on one must
 * work without it — fall back, never fail."
 *
 * PostgREST does not skip an unknown column and hand back the rest. It refuses the WHOLE query.
 * So when cost_price joined PRODUCT_COLS and unit_cost joined SALE_COLS, the blast radius was
 * not the two new screens — it was every screen that reads a product or a sale, including
 * recordSale, which reads the product before it sells it and then writes unit_cost onto the
 * sale. A shop would have found out by being unable to sell anything.
 *
 * Every test here fails against the code as merged. They are the proof that the fallback works,
 * on both halves: the read that must narrow itself, and the write that must drop the column.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { richBook, userOf, NOW, TABLES } from './_book.mjs';
import { fakeDb } from './fake-db.mjs';
import { readFileSync } from 'node:fs';

const { absentColumns } = await import('../api/_lib/bo/_shared.js');
const { boApi } = await import('../api/_lib/bo-core.js');
const { FN: SALES } = await import('../api/_lib/bo/sales.js');
const { FN: PRODUCTS } = await import('../api/_lib/bo/products.js');
const { FN: REPORTS } = await import('../api/_lib/bo/reports.js');
const { FN: LENDINGS } = await import('../api/_lib/bo/lendings.js');

/* Exactly what db/RUN-ME-002 adds. A database that has not run it has none of them. */
const NOT_YET = {
  products: ['cost_price'],
  sales: ['unit_cost', 'customer_name', 'customer_phone'],
};

/** The book as it stands on a database that has not run the migration: the columns are gone
    from the schema AND from every row, because a column that does not exist has no values. */
function oldBook() {
  const book = richBook();
  for (const [table, cols] of Object.entries(NOT_YET)) {
    book[table] = (book[table] || []).map(r => {
      const copy = { ...r };
      for (const c of cols) delete copy[c];
      return copy;
    });
  }
  return book;
}
const oldDb = () => fakeDb(oldBook(), { missingColumns: NOT_YET });

const ADM = () => userOf(richBook(), 'ADM1');
const SEL = () => userOf(richBook(), 'SEL1');
const MGR = () => userOf(richBook(), 'MGR');

/* Each test starts from a process that has learned nothing, so it exercises the discovery,
   not a flag some earlier test happened to leave behind. */
test.beforeEach(() => absentColumns.clear());
test.after(() => absentColumns.clear());

test('THE TILL STILL SELLS — the read narrows itself and the write drops the column', async () => {
  const db = oldDb();
  const before = db._dump('products').find(p => p.id === 'P3').stock;

  const r = await SALES.recordSale(db, SEL(), {
    items: [{ product_id: 'P3', qty: 3, price: 5000, discount: 500 }],
    payment_method: 'Cash', customer_name: 'Neema Mushi', customer_phone: '0712000111',
  }, NOW);

  assert.equal(r.grand_total, 13500, 'the sale is priced exactly as it would have been');
  assert.equal(db._dump('products').find(p => p.id === 'P3').stock, before - 3, 'and the stock moved');

  const sale = db._dump('sales').find(s => s.id === r.sale_ids[0]);
  assert.ok(sale, 'the sale row exists');
  assert.equal('unit_cost' in sale, false, 'the column it has nowhere to go is simply not written');
  assert.equal('customer_name' in sale, false);
  assert.equal(sale.total, 13500, 'everything the old schema CAN hold is still there');
  assert.equal(sale.discount, 500);

  assert.deepEqual(absentColumns.list().sort(),
    ['products.cost_price', 'sales.customer_name', 'sales.customer_phone', 'sales.unit_cost'],
    'and it has learned, so the next sale costs no failed round trips');
});

test('a second sale asks the database nothing it has already been refused', async () => {
  /* The fallback is worth having only if it is paid for once. A per-sale extra round trip on
     the till is the cost rule 1 exists to prevent. */
  const db = oldDb();
  await SALES.recordSale(db, SEL(), { items: [{ product_id: 'P3', qty: 1 }], payment_method: 'Cash' }, NOW);
  const learned = absentColumns.list().length;

  let refusals = 0;
  const counting = new Proxy(db, {
    get(target, prop) {
      if (prop !== 'from') return target[prop];
      return name => {
        const q = target.from(name);
        const then = q.then.bind(q);
        q.then = (res, rej) => then(v => { if (v && v.error) refusals++; return res ? res(v) : v; }, rej);
        return q;
      };
    },
  });
  await SALES.recordSale(counting, SEL(), { items: [{ product_id: 'P3', qty: 1 }], payment_method: 'Cash' }, NOW);
  assert.equal(refusals, 0, 'the second sale is refused nothing — what was learned is remembered');
  assert.equal(absentColumns.list().length, learned);
});

test('every screen that reads a product still draws', async () => {
  const db = oldDb();
  const cat = await PRODUCTS.products(db, ADM(), {});
  assert.ok(cat.rows.length, 'the catalogue');
  assert.equal('cost_price' in cat.rows[0], false, 'without a column that is not there');

  const opts = await PRODUCTS.productOptions(db, SEL(), {});
  assert.ok(opts.products.length, 'the sell form');

  const board = await boApi(db, ADM(), 'dashboard', {}, NOW);
  assert.ok(board, 'the dashboard');
  const boot = await boApi(db, SEL(), 'boot', {}, NOW);
  assert.ok(boot, 'and boot, which every screen waits on');
});

test('every screen that reads a sale still draws', async () => {
  const db = oldDb();
  assert.ok((await SALES.recentSales(db, ADM(), {})).rows.length, 'recent sales');
  assert.ok((await SALES.salesDetail(db, ADM(), { period: 'today' }, NOW)).groups.length, 'the dashboard drill-down');
  assert.ok((await SALES.saleReceipt(db, ADM(), { sale_id: 'S1' })).items.length, 'a receipt');
  assert.ok(await SALES.creditAndVoids(db, ADM(), {}, NOW), 'credit and voids');
  assert.ok((await REPORTS.reportData(db, ADM(), { type: 'sales', start: '2026-09-02', end: '2026-09-02' }, NOW)).rows.length, 'the sales report');
  assert.ok(await LENDINGS.lendings(db, ADM(), {}), 'lendings, which reads products for its items');
});

test('a receipt on the old schema is still a receipt, just without the customer', async () => {
  const db = oldDb();
  const r = await SALES.saleReceipt(db, ADM(), { sale_id: 'S1' });
  assert.equal(r.total, 340000, 'the money is right, which is what a receipt is for');
  assert.equal(r.customer_name, '', 'and a column that does not exist reads as blank, not as a crash');
  assert.ok(r.vendor.name);
});

test('the profit report degrades to the truth rather than to a lie', async () => {
  /* With no cost_price column there is no cost, so every line reads as pure margin. The report
     must not present that as fact — it already has the machinery to say so, and this checks it
     fires on the one database where the warning matters most. */
  const db = oldDb();
  const rep = await REPORTS.reportData(db, ADM(), { type: 'profit', start: '2026-09-02', end: '2026-09-02' }, NOW);
  assert.ok(rep.rows.length, 'it still draws');
  const warning = rep.meta.find(m => /WARNING/.test(m));
  assert.ok(warning, 'and it says the figure cannot be trusted yet');
  assert.match(warning, /no cost price recorded/);
  assert.match(warning, /HIGHEST it could be/);
});

test('the two screens whose TABLES are missing fail cleanly, and nothing else notices', async () => {
  /* Purchase orders and holds need tables, not columns, and there is no narrowing past that.
     What matters is that they fail on their own and take nothing else down with them. */
  const db = fakeDb(oldBook(), { missingColumns: { ...NOT_YET, purchase_orders: ['id'], pending_sales: ['id'] } });
  await assert.rejects(boApi(db, ADM(), 'purchaseOrders', {}, NOW), () => true);
  await assert.rejects(boApi(db, ADM(), 'pendingSales', {}, NOW), () => true);
  assert.ok(await boApi(db, ADM(), 'dashboard', {}, NOW), 'the dashboard is untouched by either');
  assert.ok((await SALES.recentSales(db, ADM(), {})).rows.length, 'and so is the sales table');
});

test('a column that is genuinely mistyped still fails loudly', async () => {
  /* The narrowing must never become "quietly drop anything the database rejects". A typo in a
     column name has to stay a red error, or a real bug becomes a silently narrower read. */
  const db = fakeDb(richBook(), { missingColumns: { sales: ['total'] } });
  await assert.rejects(SALES.recentSales(db, ADM(), {}), e => {
    assert.match(String(e.message), /total/);
    return true;
  });
  assert.equal(absentColumns.list().length, 0, 'and nothing is learned from it');
});

test('once the migration is run, the very next read uses the full column list again', async () => {
  const stale = oldDb();
  await SALES.recentSales(stale, ADM(), {});
  assert.ok(absentColumns.list().length, 'this process has learned the columns were missing');

  /* A serverless instance that learned the old shape keeps that knowledge for its lifetime,
     which is minutes. What must NOT happen is the knowledge outliving a fresh instance — so a
     cleared process reads the new database at full width immediately. */
  absentColumns.clear();
  const fresh = fakeDb(richBook());
  const rows = (await SALES.recentSales(fresh, ADM(), {})).rows;
  assert.equal(rows.find(r => r.id === 'S1').unit_cost, 290000, 'the cost is back');
  assert.equal(rows.find(r => r.id === 'S1').customer_name, 'Neema Mushi');
  assert.equal(absentColumns.list().length, 0, 'and nothing was refused');
});

test('the optional list is exactly what the migration adds — no more, no less', () => {
  /* The narrowing is a loaded gun: a column named optional here that is actually REQUIRED would
     be dropped silently and for ever, and the screen would just be missing a number nobody could
     explain. So the list is pinned to the migration file, and adding a column to one without the
     other turns this red. image3_url is excluded on purpose: it predates this migration and the
     file only re-adds it for a database old enough to have missed it. */
  const mig = readFileSync(new URL('../db/RUN-ME-002-profit-holds-purchasing.sql', import.meta.url).pathname, 'utf8');
  const added = [...mig.matchAll(/alter table if exists\s+(\w+)\s+add column if not exists\s+(\w+)/g)]
    .map(m => m[1] + '.' + m[2])
    .filter(c => c !== 'products.image3_url');
  assert.ok(added.length, 'the migration scanner stopped seeing ALTER TABLE lines');
  const declared = ['products.cost_price', 'sales.unit_cost', 'sales.customer_name', 'sales.customer_phone'];
  assert.deepEqual(added.sort(), declared.slice().sort(),
    'OPTIONAL_COLUMNS in api/_lib/bo/_shared.js must name exactly the columns db/RUN-ME-002 adds');

  const shared = readFileSync(new URL('../api/_lib/bo/_shared.js', import.meta.url).pathname, 'utf8');
  for (const c of declared) {
    const [, col] = c.split('.');
    assert.match(shared, new RegExp("'" + col + "'"), col + ' must be in OPTIONAL_COLUMNS');
  }
});
