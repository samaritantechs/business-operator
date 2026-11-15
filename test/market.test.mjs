/* market -- the public storefront: who is on it, in what order, what each card carries, and
   that a burst of visitors costs the database one build a minute. Runs against the shared
   book (test/_book.mjs): V1 and V2 active, V3 restricted (its P7 must never appear), P4
   inactive, P3 with one recent + one old click, P5 with one recent click, P6 a rental. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bookDb, richBook, NOW, saleCountsRpc } from './_book.mjs';
import { FN, marketApi, MARKET_FUNCTIONS, clearMarketCache, clearMarketStats } from '../api/_lib/bo/market.js';
import { absentColumns } from '../api/_lib/bo/_shared.js';

const DAY = 86400000;
const ids = list => list.map(p => p.id);

/** The fake with every db.from / db.rpc counted, per table -- the only way to prove a
    warm call touches nothing. The wrapper is what the module sees, so the cache keys on it. */
function counted(book, opts) {
  const inner = bookDb(book, opts);
  const calls = { from: 0, rpc: 0, tables: {} };
  const db = {
    from(name) { calls.from += 1; calls.tables[name] = (calls.tables[name] || 0) + 1; return inner.from(name); },
    rpc(name, args) { calls.rpc += 1; return inner.rpc(name, args); },
    _dump(name) { return inner._dump(name); },
  };
  return { db, calls };
}

test('market: exports the three public functions and nothing else', () => {
  assert.deepEqual(MARKET_FUNCTIONS, ['market', 'click', 'hints']);
  assert.deepEqual(Object.keys(FN), MARKET_FUNCTIONS);
});

test('market: a restricted vendor, an inactive vendor and an inactive product stay off the page', async () => {
  const out = await FN.market(bookDb(), {}, NOW);
  assert.deepEqual(ids(out.products).sort(), ['P1', 'P2', 'P3', 'P5', 'P6']);   // no P4 (inactive), no P7 (V3 restricted)
  assert.deepEqual(out.vendors.map(v => v.id), ['V1', 'V2']);                    // no V3
  assert.ok(out.products.every(p => p.vendor_id !== 'V3'));

  // An inactive (not restricted) vendor is off the page too, products and all.
  const book = richBook();
  book.vendors.find(v => v.id === 'V2').active = false;
  const out2 = await FN.market(bookDb(book), {}, NOW);
  assert.deepEqual(ids(out2.products).sort(), ['P1', 'P2', 'P3']);
  assert.deepEqual(out2.vendors.map(v => v.id), ['V1']);
});

test('market: ranking -- in stock with clicks, then in stock without, then out of stock; recent clicks weigh more', async () => {
  const book = richBook();
  // P8: out of stock but heavily clicked -- popularity must NOT lift it past the stock gate.
  book.products.push({ id: 'P8', vendor_id: 'V1', legacy_id: 'P008', name: 'Sold-out Speaker', category: 'Audio', price: 90000, stock: 0, active: true, listing_type: 'Sale' });
  for (let i = 0; i < 5; i++) book.product_clicks.push({ id: 100 + i, product_id: 'P8', vendor_id: 'V1', clicked_at: new Date(NOW - i * DAY).toISOString() });
  // P9: in stock with TWO old clicks (pop 2) -- P5's ONE recent click (pop 3) must beat it.
  book.products.push({ id: 'P9', vendor_id: 'V2', legacy_id: 'P009', name: 'Rice 5kg', category: 'Groceries', price: 15000, stock: 5, active: true, listing_type: 'Sale' });
  book.product_clicks.push({ id: 200, product_id: 'P9', vendor_id: 'V2', clicked_at: new Date(NOW - 40 * DAY).toISOString() },
    { id: 201, product_id: 'P9', vendor_id: 'V2', clicked_at: new Date(NOW - 45 * DAY).toISOString() });

  const out = await FN.market(bookDb(book), {}, NOW);
  const order = ids(out.products);
  // Tier 3 (in stock + clicks) by popularity: P3 pop 4 (1 recent x3 + 1 old), P5 pop 3, P9 pop 2.
  assert.deepEqual(order.slice(0, 3), ['P3', 'P5', 'P9']);
  // Tier 2 (in stock, no clicks): P1, P2, P6 in a random rotation -- the cold-start slot.
  assert.deepEqual(order.slice(3, 6).sort(), ['P1', 'P2', 'P6']);
  // Tier 1: out of stock is last however popular.
  assert.equal(order[6], 'P8');
  assert.equal(out.products[6].clicks, 5);
  assert.equal(out.products[2].clicks, 2);                                       // P9's total is still reported
  assert.ok(!('score' in out.products[0]) && !('_score' in out.products[0]));
});

test('market: hot = at least the average clicks among clicked products', async () => {
  const out = await FN.market(bookDb(), {}, NOW);
  const by = Object.fromEntries(out.products.map(p => [p.id, p]));
  assert.equal(out.totalClicks, 3);
  assert.equal(out.avgClicks, 1.5);                                              // 3 clicks over 2 clicked products
  assert.equal(by.P3.clicks, 2); assert.equal(by.P3.hot, true);                  // 2 >= 1.5
  assert.equal(by.P5.clicks, 1); assert.equal(by.P5.hot, false);                 // 1 < 1.5
  assert.equal(by.P1.clicks, 0); assert.equal(by.P1.hot, false);

  // No clicks at all: nothing is hot and the average is 0, not NaN.
  const book = richBook(); book.product_clicks = [];
  const quiet = await FN.market(bookDb(book), {}, NOW);
  assert.equal(quiet.avgClicks, 0); assert.equal(quiet.totalClicks, 0);
  assert.ok(quiet.products.every(p => p.hot === false && p.clicks === 0));
});

test('market: every card carries exactly what the page draws', async () => {
  const out = await FN.market(bookDb(), {}, NOW);
  assert.deepEqual(Object.keys(out).sort(), ['avgClicks', 'hints', 'products', 'release', 'timings', 'totalClicks', 'vendors']);
  assert.equal(out.release, null, 'no Android build published yet, and that is a null rather than an error');
  const by = Object.fromEntries(out.products.map(p => [p.id, p]));

  assert.deepEqual(by.P6, { id: 'P6', name: 'Wedding Gown', cat: 'Bridal', brand: '', model: '', price: 150000, stock: 1,
    vendor: 'Mama Ntilie Grocery', vendor_id: 'V2', image1: '', image2: '', image3: '', currency: 'TZS', vendorPhone: '+255756000002',
    vendorType: 'Groceries', listingType: 'Rent', priceUnit: 'per event', location: 'Kariakoo', clicks: 0, hot: false });
  assert.deepEqual(by.P1, { id: 'P1', name: 'Samsung Galaxy A05', cat: 'Phones', brand: 'Samsung', model: 'A05', price: 350000, stock: 3,
    vendor: 'Fromville Phones', vendor_id: 'V1', image1: '', image2: '', image3: '', currency: 'TZS', vendorPhone: '+255756000001',
    vendorType: 'Electronics', listingType: 'Sale', priceUnit: '', location: 'Sinza', clicks: 0, hot: false });
  assert.equal(by.P3.image1, 'https://drive.google.com/thumbnail?id=cov&sz=w400');
  assert.equal(by.P3.image2, '');
  assert.equal(by.P3.image3, '', 'the third slot is on every card, empty until a shop fills it');
  assert.equal(typeof by.P3.price, 'number'); assert.equal(typeof by.P3.stock, 'number');

  assert.deepEqual(out.vendors, [
    // ageDays: whole days since the row was created (1 Aug and 10 Jan, to 2 Sep). sales is null,
    // not 0: this database has no bo_vendor_sale_counts, so the count is not known. No pin: no map.
    { id: 'V1', name: 'Fromville Phones', admin: '', logo: '', businessType: 'Electronics', phone: '+255756000001', address: 'Sinza, Dar', currency: 'TZS', ageDays: 32, sales: null, map: '' },
    { id: 'V2', name: 'Mama Ntilie Grocery', admin: '', logo: 'https://drive.google.com/thumbnail?id=abc&sz=w200', businessType: 'Groceries', phone: '+255756000002', address: 'Kariakoo', currency: 'TZS', ageDays: 235, sales: null, map: '' },
  ]);
  assert.deepEqual(out.hints, [{ en: 'Use Refresh to see the latest numbers.', sw: 'Tumia Refresh kuona namba za sasa.' },
    { en: 'Tap any product to contact the seller.', sw: '' }]);
  assert.deepEqual(out.timings, { hintLifetime: 5, hintInterval: 300 });

  // A vendor without a currency falls back to TZS, and a category-less product to ''.
  const book = richBook();
  book.vendors.find(v => v.id === 'V2').currency = null;
  book.products.find(p => p.id === 'P5').category = null;
  const out2 = await FN.market(bookDb(book), {}, NOW);
  const p5 = out2.products.find(p => p.id === 'P5');
  assert.equal(p5.currency, 'TZS'); assert.equal(p5.cat, '');
});

test('market: cache -- one build a minute per client, a click does not bust it, clearMarketCache does', async () => {
  const { db, calls } = counted(richBook());
  const first = await FN.market(db, {}, NOW);
  // Cold, without the RPCs installed: vendors, products, product_clicks (fallback), hints,
  // settings, and the Android release the Download button points at. Two functions are asked
  // for and both are missing: the click counts fall back to the log, the sales count to nothing.
  assert.equal(calls.from, 6); assert.equal(calls.rpc, 2);
  assert.deepEqual(calls.tables, { vendors: 1, products: 1, product_clicks: 1, hints: 1, settings: 1, app_releases: 1 });

  const again = await FN.market(db, {}, NOW);
  assert.equal(calls.from, 6); assert.equal(calls.rpc, 2);                        // warm: nothing read
  assert.equal(again, first);

  // A view logged in between is not on the page yet: popularity may lag a minute, as before.
  await FN.click(db, { product_id: 'P1' }, NOW + 1000);
  const afterClick = calls.from;
  const warm = await FN.market(db, {}, NOW + 59999);
  assert.equal(calls.from, afterClick);
  assert.equal(warm.products.find(p => p.id === 'P1').clicks, 0);

  // A minute later the page is rebuilt and the click is counted.
  const later = await FN.market(db, {}, NOW + 61000);
  // +1 function call, not +2: the sales count is good for fifteen minutes, not one.
  assert.equal(calls.from, afterClick + 6); assert.equal(calls.rpc, 3);
  assert.equal(later.products.find(p => p.id === 'P1').clicks, 1);

  // clearMarketCache drops the entry even inside the minute.
  clearMarketCache(db);
  await FN.market(db, {}, NOW + 61000);
  assert.equal(calls.from, afterClick + 12);
  clearMarketCache(undefined);                                                    // harmless
});

test('market: two visitors on a cold cache share one build', async () => {
  const { db, calls } = counted(richBook());
  const [a, b] = await Promise.all([FN.market(db, {}, NOW), FN.market(db, {}, NOW)]);
  assert.equal(a, b);
  assert.equal(calls.from, 6);
});

test('market: a failed build is not cached', async () => {
  const { db, calls } = counted(richBook());
  const broken = { from(name) { calls.from += 1; if (name === 'products') throw new Error('boom'); return db.from(name); }, rpc: db.rpc, _dump: db._dump };
  await assert.rejects(FN.market(broken, {}, NOW));
  const n = calls.from;
  await assert.rejects(FN.market(broken, {}, NOW));                               // tried again, not served the failure
  assert.ok(calls.from > n);
});

test('market: the click-count RPC is used when the database has it', async () => {
  let seen = null;
  const { db, calls } = counted(richBook(), { rpc: { bo_click_counts: (store, args) => {
    seen = args;
    // Deliberately different from the rows in the book, to prove this answer is the one used.
    return [{ product_id: 'P5', total: 7, recent: 7 }, { product_id: 'P3', total: 2, recent: 0 }];
  } } });
  const out = await FN.market(db, {}, NOW);
  assert.deepEqual(seen, { p_since: new Date(NOW - 30 * DAY).toISOString() });
  assert.equal(calls.rpc, 2);                                                     // + the sales count, asked and missing
  assert.equal(calls.tables.product_clicks, undefined);                           // the log itself is never read
  assert.equal(calls.from, 5);   // +1: the Android release row
  assert.deepEqual(ids(out.products).slice(0, 2), ['P5', 'P3']);                  // pop 21 vs pop 2
  const by = Object.fromEntries(out.products.map(p => [p.id, p]));
  assert.equal(by.P5.clicks, 7); assert.equal(by.P3.clicks, 2);
  assert.equal(out.totalClicks, 9); assert.equal(out.avgClicks, 4.5);
  assert.equal(by.P5.hot, true); assert.equal(by.P3.hot, false);
});

test('market: without the RPC the click log is counted in code, recency and all', async () => {
  const { db, calls } = counted(richBook());
  const out = await FN.market(db, {}, NOW);
  assert.equal(calls.rpc, 2);                                                     // both asked, both told PGRST202
  assert.equal(calls.tables.product_clicks, 1);                                   // one fell back to the log...
  assert.equal(calls.tables.sales, undefined);                                    // ...and the other, on purpose, to nothing
  const by = Object.fromEntries(out.products.map(p => [p.id, p]));
  assert.equal(by.P3.clicks, 2); assert.equal(by.P5.clicks, 1);
  assert.deepEqual(ids(out.products).slice(0, 2), ['P3', 'P5']);                  // pop 4 (1 recent, 1 old) over pop 3
  assert.equal(out.totalClicks, 3);
});

test('click: logs the view with the product\'s vendor and refuses an unknown product', async () => {
  const db = bookDb();
  const before = db._dump('product_clicks').length;
  assert.deepEqual(await FN.click(db, { product_id: 'P6' }, NOW), {});
  const log = db._dump('product_clicks');
  assert.equal(log.length, before + 1);
  const row = log[log.length - 1];
  assert.equal(row.product_id, 'P6');
  assert.equal(row.vendor_id, 'V2');
  assert.equal(row.clicked_at, new Date(NOW).toISOString());

  await assert.rejects(FN.click(db, { product_id: 'NOPE' }, NOW), e => e.status === 400);
  await assert.rejects(FN.click(db, {}, NOW), e => e.status === 400);
  assert.equal(db._dump('product_clicks').length, before + 1);                    // nothing written on refusal
});

test('hints: the marketplace tips with numeric timings; the built-in list when the table is empty', async () => {
  const out = await FN.hints(bookDb(), {}, NOW);
  assert.deepEqual(out, {
    hints: [{ en: 'Use Refresh to see the latest numbers.', sw: 'Tumia Refresh kuona namba za sasa.' }, { en: 'Tap any product to contact the seller.', sw: '' }],
    timings: { hintLifetime: 5, hintInterval: 300 },
  });

  const book = richBook();
  book.hints = [];
  book.settings = book.settings.filter(s => s.key !== 'hintLifetime').concat([{ key: 'hintInterval', value: 'soon' }]);
  const dflt = await FN.hints(bookDb(book), {}, NOW);
  // five about the marketplace, one about the eye on a password box, and five for what the
  // shopfront learnt next: saving, the lens, the Location button, age-and-sales, swiping a tip away
  assert.equal(dflt.hints.length, 11);
  for (const word of ['bookmark', 'lens', 'Location', 'how many sales', 'Swipe']) assert.ok(dflt.hints.some(h => h.en.includes(word)), 'no built-in marketplace tip mentions "' + word + '"');
  // The built-in marketplace tips are bilingual now: a visitor who reads Kiswahili gets Kiswahili.
  assert.ok(dflt.hints.every(h => typeof h.en === 'string' && h.en && typeof h.sw === 'string' && h.sw));
  assert.deepEqual(dflt.timings, { hintLifetime: 5, hintInterval: 300 });        // missing / unparseable => legacy defaults
});

test('marketApi: routes by name and refuses an unknown function with 400', async () => {
  const db = bookDb();
  const out = await marketApi(db, 'market', {}, NOW);
  assert.ok(Array.isArray(out.products));
  assert.deepEqual(await marketApi(db, 'click', { product_id: 'P1' }, NOW), {});
  await assert.rejects(marketApi(db, 'nope', {}, NOW), e => e.status === 400);
  await assert.rejects(marketApi(db, undefined, {}, NOW), e => e.status === 400);
});


/* =====================================================================================
   "3 MONTHS · 30 SALES" AND THE PIN -- what a business has to show for itself.
   ===================================================================================== */
const SALES_RPC = { rpc: { bo_vendor_sale_counts: saleCountsRpc } };
const vendorOf = (out, id) => out.vendors.find(v => v.id === id);

test('market: a business says how long it has been here and how many sales it has completed', async () => {
  const book = richBook();
  const mine = book.sales.filter(s => s.vendor_id === 'V1');
  const done = mine.filter(s => s.status === 'completed');
  assert.ok(done.length >= 2 && mine.length > done.length, 'the book needs completed AND cancelled V1 sales for this to prove anything');
  const out = await FN.market(bookDb(book, SALES_RPC), {}, NOW);
  // Completed sale records only: a cancelled sale is not a sale.
  assert.equal(vendorOf(out, 'V1').sales, done.length);
  // The business has been here since its FIRST SALE when that is older than its row: an import
  // creates the row the day it runs, long after the shop started trading.
  const first = Math.min(...done.map(s => Date.parse(s.sold_at)));
  assert.ok(first < Date.parse('2026-08-01T06:00:00.000Z'), 'the book\'s first V1 sale should predate the vendor row');
  assert.equal(vendorOf(out, 'V1').ageDays, Math.floor((NOW - first) / DAY));
  // Every card of a business says the same thing: it is the shop's figure, joined by name on the page.
  assert.ok(out.products.filter(p => p.vendor_id === 'V1').length >= 2);

  // A reactivation moves registered_on FORWARD (it is the billing anchor). The age must not shrink.
  const moved = richBook();
  moved.vendors.find(v => v.id === 'V2').registered_on = new Date(NOW - 2 * DAY).toISOString();
  assert.equal(vendorOf(await FN.market(bookDb(moved), {}, NOW), 'V2').ageDays, 235);

  // Known and none is 0; not known is null. They are different answers and the page treats them differently.
  const quiet = richBook(); quiet.sales = quiet.sales.filter(s => s.vendor_id !== 'V2');
  assert.equal(vendorOf(await FN.market(bookDb(quiet, SALES_RPC), {}, NOW), 'V2').sales, 0);
  assert.equal(vendorOf(await FN.market(bookDb(quiet), {}, NOW), 'V2').sales, null);

  // A date that cannot be read, or one from the future, is no age at all rather than a wrong one.
  const odd = richBook(); const v = odd.vendors.find(x => x.id === 'V2');
  v.created_at = 'not a date'; v.registered_on = new Date(NOW + 5 * DAY).toISOString();
  assert.equal(vendorOf(await FN.market(bookDb(odd), {}, NOW), 'V2').ageDays, null);
});

test('market: the sales count is asked for four times an hour, never once a minute, and never by reading sales', async () => {
  let asked = 0;
  const { db, calls } = counted(richBook(), { rpc: { bo_vendor_sale_counts: store => { asked += 1; return saleCountsRpc(store); } } });
  await FN.market(db, {}, NOW);
  assert.equal(asked, 1);
  for (const min of [1.1, 5, 10, 14.9]) await FN.market(db, {}, NOW + min * 60000);   // four rebuilds of the page...
  assert.equal(asked, 1, 'the count must ride its own fifteen-minute cache, not the storefront\'s one-minute one');
  await FN.market(db, {}, NOW + 16.5 * 60000);                     // the first rebuild past the quarter hour
  assert.equal(asked, 2);
  // A product edit clears the storefront. It must not make the next visitor recount every sale.
  clearMarketCache(db);
  await FN.market(db, {}, NOW + 16.6 * 60000);
  assert.equal(asked, 2);
  clearMarketStats(db); clearMarketStats(undefined);
  await FN.market(db, {}, NOW + 18 * 60000);
  assert.equal(asked, 3);
  assert.equal(calls.tables.sales, undefined, 'the public page read the sales table');
});

test('market: a slow sales count is not waited for, and is used the moment it does arrive', async () => {
  const before = process.env.BO_MARKET_STATS_BUDGET_MS;
  process.env.BO_MARKET_STATS_BUDGET_MS = '20';
  try {
    let asked = 0;
    // Late, not never: a promise that never settles would hang the test runner itself.
    const slow = store => new Promise(resolve => { asked += 1; setTimeout(() => resolve(saleCountsRpc(store)), 120); });
    const { db } = counted(richBook(), { rpc: { bo_vendor_sale_counts: slow } });
    const t0 = Date.now();
    const first = await FN.market(db, {}, NOW);
    assert.ok(Date.now() - t0 < 110, 'the storefront waited for the count (' + (Date.now() - t0) + ' ms)');
    assert.equal(vendorOf(first, 'V1').sales, null, 'nothing is claimed while the count is not in');
    assert.equal(typeof vendorOf(first, 'V1').ageDays, 'number', 'the age needs no count and is still there');
    await new Promise(r => setTimeout(r, 160));                    // the answer lands, late
    const second = await FN.market(db, {}, NOW + 61000);
    assert.equal(asked, 1, 'the late answer was thrown away and asked for again');
    assert.equal(vendorOf(second, 'V1').sales, richBook().sales.filter(s => s.vendor_id === 'V1' && s.status === 'completed').length);

    // A count that FAILS is the same as a slow one: the page is built, and it looks again soon -- not next build.
    let tries = 0;
    const { db: bad } = counted(richBook(), { rpc: { bo_vendor_sale_counts: () => { tries += 1; throw new Error('statement timeout'); } } });
    assert.equal(vendorOf(await FN.market(bad, {}, NOW), 'V1').sales, null);
    await FN.market(bad, {}, NOW + 61000);
    assert.equal(tries, 1, 'a failing count must not be retried on the very next build');
    await FN.market(bad, {}, NOW + 3 * 60000);
    assert.equal(tries, 2);
  } finally {
    if (before === undefined) delete process.env.BO_MARKET_STATS_BUDGET_MS; else process.env.BO_MARKET_STATS_BUDGET_MS = before;
  }
});

test('market: the pin becomes a Google Maps link, and nothing else ever reaches the page', async () => {
  const book = richBook();
  Object.assign(book.vendors.find(v => v.id === 'V1'), { latitude: -6.7924, longitude: 39.2083, map_url: null });
  Object.assign(book.vendors.find(v => v.id === 'V2'), { latitude: null, longitude: null, map_url: 'https://maps.app.goo.gl/AbCdEf123' });
  const out = await FN.market(bookDb(book), {}, NOW);
  assert.equal(vendorOf(out, 'V1').map, 'https://www.google.com/maps/dir/?api=1&destination=-6.7924,39.2083');
  assert.equal(vendorOf(out, 'V2').map, 'https://maps.app.goo.gl/AbCdEf123');
  // The raw columns are not on the page, only the address they make.
  assert.ok(!('latitude' in vendorOf(out, 'V1')) && !('map_url' in vendorOf(out, 'V2')));

  // A row typed straight into the SQL editor bypasses the form. It still cannot put a foreign link,
  // or a script, on a public page under this system's name.
  for (const bad of ['https://evil.example/maps', 'javascript:alert(1)', 'https://www.google.com.evil.example/maps', 'https://www.google.com/search?q=x']) {
    const b = richBook(); Object.assign(b.vendors.find(v => v.id === 'V1'), { latitude: null, longitude: null, map_url: bad });
    assert.equal(vendorOf(await FN.market(bookDb(b), {}, NOW), 'V1').map, '', bad + ' reached the page');
  }
  // Coordinates outside the world are no pin, rather than a link to nowhere.
  const off = richBook(); Object.assign(off.vendors.find(v => v.id === 'V1'), { latitude: 123, longitude: 39 });
  assert.equal(vendorOf(await FN.market(bookDb(off), {}, NOW), 'V1').map, '');
});

test('market: a database that has not been given the pin columns still has a storefront', async () => {
  absentColumns.clear();
  try {
    const { db, calls } = counted(richBook(), { missingColumns: { vendors: ['latitude', 'longitude', 'map_url'] } });
    const out = await FN.market(db, {}, NOW);
    assert.equal(out.vendors.length, 2); assert.ok(out.products.length >= 5);
    assert.ok(out.vendors.every(v => v.map === '' && typeof v.ageDays === 'number'));
    /* Three, once: the paged reader tries a refused read a second time without its ordering
       (supabase.js fetchAll) before giving up, and then the narrower read succeeds. That is the
       whole price of a pending migration on this page, per server, per ten minutes. */
    assert.equal(calls.tables.vendors, 3, 'two refused reads, then the narrower one');
    // And it remembers: the next build asks only for what this database has.
    await FN.market(db, {}, NOW + 61000);
    assert.equal(calls.tables.vendors, 4);
  } finally { absentColumns.clear(); }
});


test('market: the count shows within minutes of the function being created, not a quarter of an hour', async () => {
  /* The person who has just run db/RUN-ME-006 goes straight to the marketplace to see the numbers.
     "Not in this database" is therefore remembered for two minutes -- an unknown function is
     refused by the API layer from its own cache, so asking again costs the database nothing. */
  const rpc = {};                                                  // a live database before the migration
  const { db } = counted(richBook(), { rpc });
  assert.equal(vendorOf(await FN.market(db, {}, NOW), 'V1').sales, null);
  rpc.bo_vendor_sale_counts = saleCountsRpc;                        // ...and somebody runs it
  assert.equal(vendorOf(await FN.market(db, {}, NOW + 61000), 'V1').sales, null, 'not on the very next build: it was asked a minute ago');
  const soon = vendorOf(await FN.market(db, {}, NOW + 2.2 * 60000), 'V1').sales;
  assert.equal(soon, richBook().sales.filter(s => s.vendor_id === 'V1' && s.status === 'completed').length);
});


test('market: a number saved the old way reaches the page as one WhatsApp can use, and a hopeless one as none', async () => {
  /* The WhatsApp button is built from this and nothing else. Shops that typed 07... before the
     number was checked must start working the day this ships, without opening their profile. */
  const book = richBook();
  book.vendors.find(v => v.id === 'V1').phone = '0756 000 001';
  book.vendors.find(v => v.id === 'V2').phone = '12345';
  const out = await FN.market(bookDb(book), {}, NOW);
  assert.equal(vendorOf(out, 'V1').phone, '+255756000001');
  assert.ok(out.products.filter(p => p.vendor_id === 'V1').every(p => p.vendorPhone === '+255756000001'));
  // Not a number at all: no button is better than a button that opens an error.
  assert.equal(vendorOf(out, 'V2').phone, '');
  assert.ok(out.products.filter(p => p.vendor_id === 'V2').every(p => p.vendorPhone === ''));
  // A shop that prices in shillings of another country is rung in that country.
  const ke = richBook(); Object.assign(ke.vendors.find(v => v.id === 'V1'), { phone: '0712 345 678', currency: 'KES' });
  assert.equal(vendorOf(await FN.market(bookDb(ke), {}, NOW), 'V1').phone, '+254712345678');
});
