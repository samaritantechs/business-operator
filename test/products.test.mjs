import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookDb, userOf, richBook, NOW } from './_book.mjs';
import { FN, WRITES } from '../api/_lib/bo/products.js';

/* products.js against the shared book. Every stock number here is checked TWICE: on the
   product row and as a stock_movements row, because the second is the whole point. */

const PNG = 'data:image/png;base64,' + Buffer.from('not-really-a-png').toString('base64');
const rejects = (p, status, re) => assert.rejects(p, e => {
  assert.equal(e.status, status, 'expected ' + status + ' but got ' + e.status + ': ' + e.message);
  if (re) assert.match(e.message, re);
  return true;
});
const moves = db => db._dump('stock_movements').filter(m => !/^M\d$/.test(String(m.id)));   // only what a test wrote
const product = (db, id) => db._dump('products').find(p => p.id === id);

test('the contract names, nothing more', () => {
  assert.deepEqual(Object.keys(FN).sort(), ['addProduct', 'addStock', 'productOptions', 'products', 'toggleProduct', 'updateProduct', 'uploadProductImage']);
  assert.deepEqual([...WRITES].sort(), ['addProduct', 'addStock', 'toggleProduct', 'updateProduct', 'uploadProductImage']);
});

test('addProduct mints the next P-number per vendor: P005 for V1, P003 for V2', async () => {
  const db = bookDb();
  const a = await FN.addProduct(db, userOf(richBook(), 'ADM1'), { name: 'Infinix Hot 40', category: 'Phones', price: 250000, stock: 0, brand: 'Infinix', model: 'Hot 40', is_serialized: true }, NOW);
  assert.equal(a.product.legacy_id, 'P005');
  assert.equal(a.product.vendor_id, 'V1');
  assert.equal(a.product.is_serialized, true);
  assert.equal(a.product.reorder_point, 20);
  assert.equal(a.product.listing_type, 'Sale');
  assert.equal(a.product.price_unit, '');
  assert.equal(a.product.active, true);
  assert.equal(a.product.created_at, new Date(NOW).toISOString());
  const b = await FN.addProduct(db, userOf(richBook(), 'ADM2'), { name: 'Rice 5kg', category: 'Groceries', price: 15000, stock: 0 }, NOW);
  assert.equal(b.product.legacy_id, 'P003');
  // and the next one for V1 counts the one just added
  const c = await FN.addProduct(db, userOf(richBook(), 'ADM1'), { name: 'Earphones', category: 'Accessories', price: 9000, stock: 0 }, NOW);
  assert.equal(c.product.legacy_id, 'P006');
});

test('addProduct: opening stock on a counted product is a received movement, at the branch', async () => {
  const db = bookDb();
  const { product: p } = await FN.addProduct(db, userOf(richBook(), 'ADM1'), { name: 'Screen Guard', category: 'Accessories', price: 3000, stock: 12, branch_id: 'B1', reorder_point: 5, listing_type: 'Rent', price_unit: 'per day' }, NOW);
  assert.equal(p.stock, 12);
  assert.equal(product(db, p.id).stock, 12);
  assert.equal(p.reorder_point, 5);
  assert.equal(p.listing_type, 'Rent');
  assert.equal(p.price_unit, 'per day');
  const m = moves(db);
  assert.equal(m.length, 1);
  assert.equal(m[0].type, 'received');
  assert.equal(m[0].qty, 12);
  assert.equal(m[0].to_branch_id, 'B1');
  assert.equal(m[0].from_branch_id, null);
  assert.equal(m[0].note, 'Opening stock');
  assert.equal(m[0].by_user, 'ADM1');
  assert.equal(m[0].product_id, p.id);
  const bs = db._dump('branch_stock').find(r => r.product_id === p.id && r.branch_id === 'B1');
  assert.equal(bs.qty, 12);
});

test('addProduct: zero opening stock writes nothing; a serialized product starts at 0 whatever was typed', async () => {
  const db = bookDb();
  const a = await FN.addProduct(db, userOf(richBook(), 'ADM1'), { name: 'Cable', category: 'Accessories', price: 2000, stock: 0 }, NOW);
  assert.equal(a.product.stock, 0);
  const b = await FN.addProduct(db, userOf(richBook(), 'ADM1'), { name: 'Redmi 13', category: 'Phones', price: 300000, stock: 7, is_serialized: true }, NOW);
  assert.equal(b.product.stock, 0);
  assert.equal(moves(db).length, 0);
  await rejects(FN.addProduct(db, userOf(richBook(), 'ADM1'), { name: '', price: 1 }, NOW), 400, /name/i);
  await rejects(FN.addProduct(db, userOf(richBook(), 'ADM1'), { name: 'X', price: -1 }, NOW), 400);
  await rejects(FN.addProduct(db, userOf(richBook(), 'ADM1'), { name: 'X', price: 1, stock: 5, branch_id: 'NOPE' }, NOW), 404);
});

test('addProduct: a seller is refused; a manager must name the vendor', async () => {
  const db = bookDb();
  await rejects(FN.addProduct(db, userOf(richBook(), 'SEL1'), { name: 'X', price: 1 }, NOW), 403);
  await rejects(FN.addProduct(db, userOf(richBook(), 'MGR'), { name: 'X', price: 1 }, NOW), 400, /business/i);
  const r = await FN.addProduct(db, userOf(richBook(), 'MGR'), { name: 'X', price: 1, vendor_id: 'V2' }, NOW);
  assert.equal(r.product.vendor_id, 'V2');
  assert.equal(r.product.legacy_id, 'P003');
  await rejects(FN.addProduct(db, userOf(richBook(), 'MGR'), { name: 'X', price: 1, vendor_id: 'V9' }, NOW), 404);
});

test('updateProduct: fields as given; a changed stock is an adjustment for the difference', async () => {
  const db = bookDb();
  const { product: p } = await FN.updateProduct(db, userOf(richBook(), 'ADM1'), { id: 'P3', name: 'Phone Cover (silicone)', category: 'Accessories', price: 5500, stock: 35, reorder_point: 12, listing_type: 'Sale', price_unit: '', location: 'Sinza', brand: 'Generic', model: 'S1' }, NOW);
  assert.equal(p.name, 'Phone Cover (silicone)');
  assert.equal(p.price, 5500);
  assert.equal(p.stock, 35);
  assert.equal(p.reorder_point, 12);
  assert.equal(p.brand, 'Generic');
  assert.equal(p.location, 'Sinza');
  assert.equal(product(db, 'P3').stock, 35);
  const m = moves(db);
  assert.equal(m.length, 1);
  assert.equal(m[0].type, 'adjustment');
  assert.equal(m[0].qty, 5);
  assert.equal(m[0].note, 'Edited on product form');
  assert.equal(m[0].from_branch_id, null);
  assert.equal(m[0].to_branch_id, null);
  // upwards too
  await FN.updateProduct(db, userOf(richBook(), 'ADM1'), { id: 'P3', name: 'Phone Cover', stock: 41 }, NOW);
  assert.equal(product(db, 'P3').stock, 41);
  assert.equal(moves(db).length, 2);
  assert.equal(moves(db)[1].qty, 6);
});

test('updateProduct: an unchanged stock writes nothing, a serialized product ignores it', async () => {
  const db = bookDb();
  await FN.updateProduct(db, userOf(richBook(), 'ADM1'), { id: 'P3', name: 'Phone Cover', stock: 40 }, NOW);
  await FN.updateProduct(db, userOf(richBook(), 'ADM1'), { id: 'P3', name: 'Phone Cover', stock: '' }, NOW);
  const { product: p1 } = await FN.updateProduct(db, userOf(richBook(), 'ADM1'), { id: 'P1', name: 'Samsung Galaxy A05', stock: 99, price: 360000 }, NOW);
  assert.equal(p1.stock, 3);
  assert.equal(p1.price, 360000);
  assert.equal(product(db, 'P1').stock, 3);
  assert.equal(moves(db).length, 0);
  await rejects(FN.updateProduct(db, userOf(richBook(), 'ADM1'), { id: 'P3', name: '' }, NOW), 400);
  await rejects(FN.updateProduct(db, userOf(richBook(), 'ADM1'), { id: 'P3', stock: -4 }, NOW), 400);
});

test('vendor walls: ADM2 cannot touch P1; a seller cannot write at all', async () => {
  const db = bookDb();
  const adm2 = userOf(richBook(), 'ADM2'), sel = userOf(richBook(), 'SEL1');
  await rejects(FN.updateProduct(db, adm2, { id: 'P1', name: 'Mine now' }, NOW), 404);
  await rejects(FN.toggleProduct(db, adm2, { id: 'P1', active: false }, NOW), 404);
  await rejects(FN.addStock(db, adm2, { product_id: 'P3', qty: 5 }, NOW), 404);
  await rejects(FN.uploadProductImage(db, adm2, { product_id: 'P3', slot: 1, data_url: PNG }, NOW), 404);
  await rejects(FN.updateProduct(db, sel, { id: 'P3', name: 'X' }, NOW), 403);
  await rejects(FN.toggleProduct(db, sel, { id: 'P3', active: false }, NOW), 403);
  await rejects(FN.addStock(db, sel, { product_id: 'P3', qty: 5 }, NOW), 403);
  await rejects(FN.uploadProductImage(db, sel, { product_id: 'P3', slot: 1, data_url: PNG }, NOW), 403);
  assert.equal(product(db, 'P1').name, 'Samsung Galaxy A05');
  assert.equal(product(db, 'P3').stock, 40);
});

test('toggleProduct hides and shows', async () => {
  const db = bookDb();
  const r = await FN.toggleProduct(db, userOf(richBook(), 'ADM1'), { id: 'P3', active: false }, NOW);
  assert.equal(r.message, 'Product deactivated.');
  assert.equal(product(db, 'P3').active, false);
  assert.ok(!(await FN.products(db, userOf(richBook(), 'ADM1'), {}, NOW)).rows.find(p => p.id === 'P3'));
  const r2 = await FN.toggleProduct(db, userOf(richBook(), 'ADM1'), { id: 'P4', active: true }, NOW);
  assert.equal(r2.message, 'Product activated.');
  assert.equal(product(db, 'P4').active, true);
});

test('addStock: received at a branch; a serialized product is refused; qty must be positive', async () => {
  const db = bookDb();
  const adm = userOf(richBook(), 'ADM1');
  const r = await FN.addStock(db, adm, { product_id: 'P3', qty: 10, branch_id: 'B2', note: 'From supplier' }, NOW);
  assert.equal(r.message, 'Stock updated. New qty: 50');
  assert.equal(r.stock, 50);
  assert.equal(product(db, 'P3').stock, 50);
  assert.equal(db._dump('branch_stock').find(x => x.product_id === 'P3' && x.branch_id === 'B2').qty, 25);
  assert.equal(db._dump('branch_stock').find(x => x.product_id === 'P3' && x.branch_id === 'B1').qty, 25);
  const m = moves(db);
  assert.equal(m.length, 1);
  assert.equal(m[0].type, 'received');
  assert.equal(m[0].qty, 10);
  assert.equal(m[0].to_branch_id, 'B2');
  assert.equal(m[0].note, 'From supplier');
  assert.equal(m[0].created_at, new Date(NOW).toISOString());
  await rejects(FN.addStock(db, adm, { product_id: 'P1', qty: 2 }, NOW), 400, /IMEI/);
  await rejects(FN.addStock(db, adm, { product_id: 'P3', qty: 0 }, NOW), 400);
  await rejects(FN.addStock(db, adm, { product_id: 'P3', qty: -3 }, NOW), 400);
  await rejects(FN.addStock(db, adm, { product_id: 'P4', qty: 3 }, NOW), 400, /inactive/);
  await rejects(FN.addStock(db, adm, { product_id: 'P3', qty: 3, branch_id: 'B9' }, NOW), 404);
  assert.equal(product(db, 'P3').stock, 50);
  assert.equal(moves(db).length, 1);
  // no branch: only the vendor total moves
  await FN.addStock(db, adm, { product_id: 'P3', qty: 1 }, NOW);
  assert.equal(product(db, 'P3').stock, 51);
  assert.equal(db._dump('branch_stock').length, 2);
});

test('uploadProductImage: into the product-images bucket at vendor/product-slot, URL on the row', async () => {
  const db = bookDb();
  const r = await FN.uploadProductImage(db, userOf(richBook(), 'ADM1'), { product_id: 'P3', slot: 2, data_url: PNG }, NOW);
  assert.match(r.url, /\/storage\/v1\/object\/public\/product-images\/V1\/P3-2\.png\?v=\d+$/);
  const files = db._storageDump('product-images');
  assert.ok(files['V1/P3-2.png'], Object.keys(files).join());
  assert.equal(files['V1/P3-2.png'].contentType, 'image/png');
  assert.equal(product(db, 'P3').image2_url, r.url);
  assert.equal(product(db, 'P3').image1_url, 'https://drive.google.com/thumbnail?id=cov&sz=w400');   // the old Drive URL stays
  const r1 = await FN.uploadProductImage(db, userOf(richBook(), 'ADM1'), { product_id: 'P3', slot: '1', data_url: 'data:image/jpeg;base64,' + Buffer.from('jpg').toString('base64') }, NOW);
  assert.equal(product(db, 'P3').image1_url, r1.url);
  assert.ok(db._storageDump('product-images')['V1/P3-1.jpg']);
  await rejects(FN.uploadProductImage(db, userOf(richBook(), 'ADM1'), { product_id: 'P3', slot: 3, data_url: PNG }, NOW), 400, /slot/);
  await rejects(FN.uploadProductImage(db, userOf(richBook(), 'ADM1'), { product_id: 'P3', slot: 1, data_url: 'hello' }, NOW), 400);
  await rejects(FN.uploadProductImage(db, userOf(richBook(), 'ADM1'), { product_id: 'P3', slot: 1, data_url: 'data:text/plain;base64,aGk=' }, NOW), 400);
});

test('products: the vendor catalogue, ordered, with units_in_stock on serialized rows', async () => {
  const db = bookDb();
  const { rows } = await FN.products(db, userOf(richBook(), 'ADM1'), {}, NOW);
  assert.deepEqual(rows.map(p => p.id), ['P1', 'P2', 'P3']);
  assert.equal(rows[0].units_in_stock, 3);
  assert.equal(rows[1].units_in_stock, 2);
  assert.equal(rows[2].units_in_stock, undefined);
  assert.equal(rows[2].stock, 40);
  assert.ok('image1_url' in rows[0] && 'reorder_point' in rows[0] && 'legacy_id' in rows[0]);
  const all = await FN.products(db, userOf(richBook(), 'ADM1'), { include_inactive: true }, NOW);
  assert.deepEqual(all.rows.map(p => p.id), ['P1', 'P2', 'P3', 'P4']);
  // a seller may read; another admin sees only their own
  assert.equal((await FN.products(db, userOf(richBook(), 'SEL1'), {}, NOW)).rows.length, 3);
  assert.deepEqual((await FN.products(db, userOf(richBook(), 'ADM2'), { vendor_id: 'V1' }, NOW)).rows.map(p => p.id), ['P5', 'P6']);
  // a manager names a vendor, or gets every vendor
  assert.deepEqual((await FN.products(db, userOf(richBook(), 'MGR'), { vendor_id: 'V2' }, NOW)).rows.map(p => p.id), ['P5', 'P6']);
  assert.equal((await FN.products(db, userOf(richBook(), 'MGR'), {}, NOW)).rows.length, 6);
});

test('productOptions: products with their in-stock units, partners and branches, one call; branch filter', async () => {
  const db = bookDb();
  const r = await FN.productOptions(db, userOf(richBook(), 'SEL1'), {}, NOW);
  assert.deepEqual(r.products.map(p => p.id), ['P1', 'P2', 'P3']);
  const p1 = r.products[0];
  assert.deepEqual(Object.keys(p1).sort(), ['brand', 'id', 'is_serialized', 'legacy_id', 'model', 'name', 'price', 'stock', 'units']);
  assert.deepEqual(p1.units.map(u => u.id), ['U1', 'U2', 'U3']);
  assert.deepEqual(Object.keys(p1.units[0]).sort(), ['branch_id', 'id', 'imei', 'serial_no']);
  assert.deepEqual(r.products[1].units.map(u => u.id), ['U5', 'U6']);
  assert.deepEqual(r.products[2].units, []);
  assert.deepEqual(r.partners.map(p => p.id), ['FP1', 'FP2']);
  assert.deepEqual(r.branches.map(b => b.name), ['Kariakoo', 'Sinza']);
  const atB1 = await FN.productOptions(db, userOf(richBook(), 'SEL1'), { branch_id: 'B1' }, NOW);
  assert.deepEqual(atB1.products[0].units.map(u => u.id), ['U1', 'U2']);
  assert.deepEqual(atB1.products[1].units, []);
  // another vendor sees none of V1's partners, only the global one
  const v2 = await FN.productOptions(db, userOf(richBook(), 'ADM2'), {}, NOW);
  assert.deepEqual(v2.partners.map(p => p.id), ['FP2']);
  assert.deepEqual(v2.branches, []);
  await rejects(FN.productOptions(db, userOf(richBook(), 'MGR'), {}, NOW), 400);
  assert.equal((await FN.productOptions(db, userOf(richBook(), 'MGR'), { vendor_id: 'V1' }, NOW)).products.length, 3);
});

test('stock arithmetic: the JS fallback when the database has no bo_adjust_stock, and the RPC when it has', async () => {
  // The fake has no rpc by default -> rpcOr falls back to read-then-write (what every test above used).
  const plain = bookDb();
  assert.equal((await FN.addStock(plain, userOf(richBook(), 'ADM1'), { product_id: 'P3', qty: 2 }, NOW)).stock, 42);
  assert.equal(product(plain, 'P3').stock, 42);
  // With the function present, the table is changed through it and the movement is still written.
  let calls = 0;
  const withRpc = bookDb(richBook(), { rpc: {
    bo_adjust_stock: (store, a) => { calls++; const p = store.products.rows.find(x => x.id === a.p_product); p.stock = Number(p.stock) + a.p_delta; return p.stock; },
    bo_adjust_branch_stock: (store, a) => { const r = store.branch_stock.rows.find(x => x.product_id === a.p_product && x.branch_id === a.p_branch); r.qty = Number(r.qty) + a.p_delta; return r.qty; },
  } });
  const r = await FN.addStock(withRpc, userOf(richBook(), 'ADM1'), { product_id: 'P3', qty: 2, branch_id: 'B1' }, NOW);
  assert.equal(calls, 1);
  assert.equal(product(withRpc, 'P3').stock, 42);
  assert.equal(r.stock, 42);
  assert.equal(withRpc._dump('branch_stock').find(x => x.product_id === 'P3' && x.branch_id === 'B1').qty, 27);
  assert.equal(moves(withRpc).length, 1);
});
