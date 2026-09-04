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

test('setting a cost price on the old schema is REFUSED, not silently swallowed', async () => {
  /* The flaw in the fallback above. Dropping a column is right for a write that merely carries
     one -- recordSale must still record the sale. It is wrong for a write that EXISTS to set it:
     the owner reads the profit report telling him to set a cost price, types one, is told it
     saved, and nothing changes. He can do that all afternoon. */
  const db = oldDb();
  await SALES.recordSale(db, SEL(), { items: [{ product_id: 'P3', qty: 1 }], payment_method: 'Cash' }, NOW);
  assert.ok(absentColumns.has('products', 'cost_price'), 'the process now knows the column is missing');

  await assert.rejects(PRODUCTS.updateProduct(db, ADM(), { id: 'P3', cost_price: 3000 }, NOW), e => {
    assert.equal(e.status, 400);
    assert.match(e.message, /RUN-ME-002/, 'and it says exactly what to do about it');
    return true;
  });

  /* Everything else on the same form still saves -- being unable to record a cost must not stop
     somebody fixing a price or a name. */
  const ok = await PRODUCTS.updateProduct(db, ADM(), { id: 'P3', name: 'Phone Cover XL', price: 5500 }, NOW);
  assert.equal(ok.product.name, 'Phone Cover XL');
  assert.equal(db._dump('products').find(p => p.id === 'P3').price, 5500);
});

test('the Cash Due report still draws when there is no holds table at all', async () => {
  /* It reads pending_sales for the deposit columns. On a database that has not run the migration
     that table does not exist, and a report that cannot be opened is worse than one without a
     column somebody has never seen. */
  const db = fakeDb(oldBook(), { missingColumns: { ...NOT_YET, pending_sales: ['id', 'deposit'] } });
  const rep = await REPORTS.reportData(db, ADM(), { type: 'cashdue' }, NOW);
  assert.ok(rep.rows.length, 'it still lists the sellers');
  assert.ok(rep.rows.every(r => r.dep_taken === 0 && r.dep_applied === 0), 'with nothing to account for');
});

test('the whole sales table is learned from ONE refusal, not one per column', async () => {
  /* PostgREST names a single missing column per error, and sales declares three. Learning them
     one at a time cost three refused inserts on recordSale -- the hottest write in the system --
     on every cold instance while the migration was pending. */
  const db = oldDb();
  let refusals = 0;
  const counting = new Proxy(db, {
    get(t, k) {
      if (k !== 'from') return t[k];
      return name => {
        const q = t.from(name);
        const then = q.then.bind(q);
        q.then = (res, rej) => then(v => { if (v && v.error) refusals++; return res ? res(v) : v; }, rej);
        return q;
      };
    },
  });
  await SALES.recordSale(counting, SEL(), { items: [{ product_id: 'P3', qty: 1 }], payment_method: 'Cash' }, NOW);
  assert.ok(refusals <= 2, 'at most one refusal per table (products, then sales) — got ' + refusals);
  assert.deepEqual(absentColumns.list().sort(),
    ['products.cost_price', 'sales.customer_name', 'sales.customer_phone', 'sales.unit_cost'],
    'and all four are known after that one pass');
});

test('what was learned is forgotten again, so a warm instance heals after the migration', async () => {
  /* A lambda alive across the migration used to remember the columns as missing for the rest of
     its life. A read that is a column short heals when the instance recycles; a WRITE that is a
     column short is gone for good -- every sale that instance rang up afterwards had no cost
     snapshot, and the owner was told it saved. */
  const stale = oldDb();
  await SALES.recordSale(stale, SEL(), { items: [{ product_id: 'P3', qty: 1 }], payment_method: 'Cash' }, NOW);
  assert.equal(absentColumns.has('sales', 'unit_cost'), true);

  absentColumns.age();                       // the same process, ten minutes later
  assert.equal(absentColumns.has('sales', 'unit_cost'), false, 'it is willing to ask again');

  const migrated = fakeDb(richBook());       // and by now somebody has run RUN-ME-002
  const r = await SALES.recordSale(migrated, SEL(), { items: [{ product_id: 'P3', qty: 2 }], payment_method: 'Cash', customer_name: 'Neema' }, NOW);
  const sale = migrated._dump('sales').find(s => s.id === r.sale_ids[0]);
  assert.equal(sale.unit_cost, 3000, 'the cost snapshot is back without a redeploy');
  assert.equal(sale.customer_name, 'Neema');
});

test('and a write that exists to set an expired-absent column stops refusing once it can work', async () => {
  const stale = oldDb();
  await PRODUCTS.products(stale, ADM(), {});
  await assert.rejects(PRODUCTS.updateProduct(stale, ADM(), { id: 'P3', cost_price: 3000 }, NOW), () => true);
  absentColumns.age();
  const migrated = fakeDb(richBook());
  const ok = await PRODUCTS.updateProduct(migrated, ADM(), { id: 'P3', cost_price: 3200 }, NOW);
  assert.equal(ok.product.cost_price, 3200);
});

test('receiving a delivery SAYS when it could not record the cost', async () => {
  /* The admin hint promises "receiving it updates the cost price for you". On a database without
     the column that quietly did nothing -- the same lie requireColumn was added to stop on the
     products form. The stock is in by now and must stay in, so this reports rather than refuses. */
  const { FN: PO } = await import('../api/_lib/bo/purchasing.js');
  const db = oldDb();
  const po = await PO.createPurchaseOrder(db, ADM(), { items: [{ product_id: 'P3', qty: 40, unit_cost: 2800 }] }, NOW);
  const before = db._dump('products').find(p => p.id === 'P3').stock;

  const r = await PO.receivePurchaseOrder(db, ADM(), { id: po.id }, NOW);
  assert.equal(db._dump('products').find(p => p.id === 'P3').stock, before + 40, 'the delivery still lands');
  assert.deepEqual(r.cost_unrecorded, ['Phone Cover']);
  assert.match(r.message, /cost price could NOT be saved/);
  assert.match(r.message, /RUN-ME-002/);
});

test('a product can still be edited before the migration — only a CHANGED cost is refused', async () => {
  /* The edit form posts every field it holds, and on a database with no cost_price it holds a 0.
     Requiring the column on "is it in the request" therefore blocked every product edit: the
     name, the price, and any queued photos, which upload inside this call's success. */
  const db = oldDb();
  await PRODUCTS.products(db, ADM(), {});                       // learn the column is missing

  const ok = await PRODUCTS.updateProduct(db, ADM(), { id: 'P3', name: 'Phone Cover XL', price: 5500, cost_price: 0 }, NOW);
  assert.equal(ok.product.name, 'Phone Cover XL', 'the edit goes through');
  assert.equal(db._dump('products').find(p => p.id === 'P3').price, 5500);

  await assert.rejects(PRODUCTS.updateProduct(db, ADM(), { id: 'P3', cost_price: 3000 }, NOW), e => {
    assert.match(e.message, /RUN-ME-002/, 'and a cost somebody actually typed is still refused');
    return true;
  });
});

test('a COLD instance cannot refuse a cost price it has not learned about yet — so it says so afterwards', async () => {
  /* The hole in the test above. requireColumn only fires once something has already been
     refused for that column, and on a lambda's FIRST request nothing has: the insert itself is
     the discovery. It is refused, the fallback learns, retries without cost_price, and the
     product lands — correct in every other respect and with the cost silently gone. The owner
     typed 1,500 and the screen said "added".

     Refusing at that point would be a lie in the other direction: an error on screen and a
     product in the list, and a second one typed in to fix it. So it reports. CLAUDE.md: "Say
     what was not done. Silence reads as success." */
  const db = oldDb();
  assert.equal(absentColumns.list().length, 0, 'nothing has touched the products table yet');

  const r = await PRODUCTS.addProduct(db, ADM(), {
    name: 'Screen Protector', category: 'Accessories', price: 4000, cost_price: 1500, stock: 10,
  }, NOW);

  assert.ok(r.product && r.product.id, 'the product IS created — the insert retried and landed');
  assert.equal(db._dump('products').find(p => p.id === r.product.id).name, 'Screen Protector');
  assert.equal(r.cost_unrecorded, true, 'and the answer says the 1,500 did not go in');
  assert.match(String(r.message || ''), /RUN-ME-002/, 'with what to do about it');
  assert.equal(r.product.stock, 10, 'everything the old schema CAN hold still happened');
});

test('the same product added with no cost price says nothing, and neither does a migrated database', async () => {
  const db = oldDb();
  const quiet = await PRODUCTS.addProduct(db, ADM(), { name: 'Free Sticker', category: 'Accessories', price: 0, stock: 1 }, NOW);
  assert.ok(!quiet.cost_unrecorded, 'a zero is "not recorded", not a loss');
  assert.equal(quiet.message, undefined, 'and nothing to warn about');

  absentColumns.clear();                     // a different process, on a database that HAS the column
  const migrated = fakeDb(richBook());
  const ok = await PRODUCTS.addProduct(migrated, ADM(), { name: 'Screen Protector', category: 'Accessories', price: 4000, cost_price: 1500 }, NOW);
  assert.ok(!ok.cost_unrecorded, 'a database that HAS the column says nothing at all');
  assert.equal(migrated._dump('products').find(p => p.id === ok.product.id).cost_price, 1500);
});

test('a WARM instance still refuses outright — the cheaper answer is still the better one', async () => {
  /* Once the column is known missing, addProduct must not create a product it cannot record the
     cost of and then apologise: it can say so before anything is written. */
  const db = oldDb();
  await SALES.recordSale(db, SEL(), { items: [{ product_id: 'P3', qty: 1 }], payment_method: 'Cash' }, NOW);
  assert.ok(absentColumns.has('products', 'cost_price'));
  const before = db._dump('products').length;

  await assert.rejects(PRODUCTS.addProduct(db, ADM(), { name: 'Screen Protector', category: 'Accessories', price: 4000, cost_price: 1500 }, NOW), e => {
    assert.equal(e.status, 400);
    assert.match(e.message, /RUN-ME-002/);
    return true;
  });
  assert.equal(db._dump('products').length, before, 'and nothing was written');
});
