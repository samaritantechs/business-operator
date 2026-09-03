/* market -- the public storefront: who is on it, in what order, what each card carries, and
   that a burst of visitors costs the database one build a minute. Runs against the shared
   book (test/_book.mjs): V1 and V2 active, V3 restricted (its P7 must never appear), P4
   inactive, P3 with one recent + one old click, P5 with one recent click, P6 a rental. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bookDb, richBook, NOW } from './_book.mjs';
import { FN, marketApi, MARKET_FUNCTIONS, clearMarketCache } from '../api/_lib/bo/market.js';

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
  assert.deepEqual(Object.keys(out).sort(), ['avgClicks', 'hints', 'products', 'timings', 'totalClicks', 'vendors']);
  const by = Object.fromEntries(out.products.map(p => [p.id, p]));

  assert.deepEqual(by.P6, { id: 'P6', name: 'Wedding Gown', cat: 'Bridal', brand: '', model: '', price: 150000, stock: 1,
    vendor: 'Mama Ntilie Grocery', vendor_id: 'V2', image1: '', image2: '', currency: 'TZS', vendorPhone: '255756000002',
    vendorType: 'Groceries', listingType: 'Rent', priceUnit: 'per event', location: 'Kariakoo', clicks: 0, hot: false });
  assert.deepEqual(by.P1, { id: 'P1', name: 'Samsung Galaxy A05', cat: 'Phones', brand: 'Samsung', model: 'A05', price: 350000, stock: 3,
    vendor: 'Fromville Phones', vendor_id: 'V1', image1: '', image2: '', currency: 'TZS', vendorPhone: '+255 756 000 001',
    vendorType: 'Electronics', listingType: 'Sale', priceUnit: '', location: 'Sinza', clicks: 0, hot: false });
  assert.equal(by.P3.image1, 'https://drive.google.com/thumbnail?id=cov&sz=w400');
  assert.equal(by.P3.image2, '');
  assert.equal(typeof by.P3.price, 'number'); assert.equal(typeof by.P3.stock, 'number');

  assert.deepEqual(out.vendors, [
    { id: 'V1', name: 'Fromville Phones', admin: '', logo: '', businessType: 'Electronics', phone: '+255 756 000 001', address: 'Sinza, Dar', currency: 'TZS' },
    { id: 'V2', name: 'Mama Ntilie Grocery', admin: '', logo: 'https://drive.google.com/thumbnail?id=abc&sz=w200', businessType: 'Groceries', phone: '255756000002', address: 'Kariakoo', currency: 'TZS' },
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
  // Cold, without the RPC installed: vendors, products, product_clicks (fallback), hints, settings.
  assert.equal(calls.from, 5); assert.equal(calls.rpc, 1);
  assert.deepEqual(calls.tables, { vendors: 1, products: 1, product_clicks: 1, hints: 1, settings: 1 });

  const again = await FN.market(db, {}, NOW);
  assert.equal(calls.from, 5); assert.equal(calls.rpc, 1);                        // warm: nothing read
  assert.equal(again, first);

  // A view logged in between is not on the page yet: popularity may lag a minute, as before.
  await FN.click(db, { product_id: 'P1' }, NOW + 1000);
  const afterClick = calls.from;
  const warm = await FN.market(db, {}, NOW + 59999);
  assert.equal(calls.from, afterClick);
  assert.equal(warm.products.find(p => p.id === 'P1').clicks, 0);

  // A minute later the page is rebuilt and the click is counted.
  const later = await FN.market(db, {}, NOW + 61000);
  assert.equal(calls.from, afterClick + 5); assert.equal(calls.rpc, 2);
  assert.equal(later.products.find(p => p.id === 'P1').clicks, 1);

  // clearMarketCache drops the entry even inside the minute.
  clearMarketCache(db);
  await FN.market(db, {}, NOW + 61000);
  assert.equal(calls.from, afterClick + 10);
  clearMarketCache(undefined);                                                    // harmless
});

test('market: two visitors on a cold cache share one build', async () => {
  const { db, calls } = counted(richBook());
  const [a, b] = await Promise.all([FN.market(db, {}, NOW), FN.market(db, {}, NOW)]);
  assert.equal(a, b);
  assert.equal(calls.from, 5);
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
  assert.equal(calls.rpc, 1);
  assert.equal(calls.tables.product_clicks, undefined);                           // the log itself is never read
  assert.equal(calls.from, 4);
  assert.deepEqual(ids(out.products).slice(0, 2), ['P5', 'P3']);                  // pop 21 vs pop 2
  const by = Object.fromEntries(out.products.map(p => [p.id, p]));
  assert.equal(by.P5.clicks, 7); assert.equal(by.P3.clicks, 2);
  assert.equal(out.totalClicks, 9); assert.equal(out.avgClicks, 4.5);
  assert.equal(by.P5.hot, true); assert.equal(by.P3.hot, false);
});

test('market: without the RPC the click log is counted in code, recency and all', async () => {
  const { db, calls } = counted(richBook());
  const out = await FN.market(db, {}, NOW);
  assert.equal(calls.rpc, 1);                                                     // asked, told PGRST202, fell back
  assert.equal(calls.tables.product_clicks, 1);
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
  assert.equal(dflt.hints.length, 5);
  assert.ok(dflt.hints.every(h => typeof h.en === 'string' && h.en && h.sw === ''));
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
