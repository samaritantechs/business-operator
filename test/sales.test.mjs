/* SELLING, CANCELLING, AND WHAT THE BOOK SHOWS AFTERWARDS. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { richBook, bookDb, userOf, NOW, T } from './_book.mjs';

const { FN, deps } = await import('../api/_lib/bo/sales.js');
const { boApi } = await import('../api/_lib/bo-core.js');

const ADM = () => userOf(richBook(), 'ADM1');
const SEL = () => userOf(richBook(), 'SEL1');
const ADM2 = () => userOf(richBook(), 'ADM2');
const MGR = () => userOf(richBook(), 'MGR');
const product = (db, id) => db._dump('products').find(p => p.id === id);
const unit = (db, id) => db._dump('product_units').find(u => u.id === id);
const moves = db => db._dump('stock_movements').filter(m => !/^M\d$/.test(m.id));
const bs = (db, p, b) => db._dump('branch_stock').find(x => x.product_id === p && x.branch_id === b).qty;
async function rejects(p, status, re) {
  await assert.rejects(p, e => { assert.equal(e.status, status, e.message); if (re) assert.match(e.message, re); return true; });
}

test('recordSale: a counted product decrements stock and the branch count, and writes one sold movement', async () => {
  const db = bookDb();
  const r = await FN.recordSale(db, SEL(), { items: [{ product_id: 'P3', qty: 3, price: 5000, discount: 500 }], payment_method: 'Cash' }, NOW);
  assert.match(r.message, /Sale recorded \(1 item\)/);
  assert.equal(r.grand_total, 13500);
  assert.equal(r.sale_ids.length, 1);
  assert.equal(product(db, 'P3').stock, 37);
  assert.equal(bs(db, 'P3', 'B1'), 22);                   // the seller's own branch
  const s = db._dump('sales').find(x => x.id === r.sale_ids[0]);
  assert.equal(s.list_price, 5000); assert.equal(s.discount, 500); assert.equal(s.price, 4500); assert.equal(s.total, 13500);
  assert.equal(s.seller_name, 'Juma Seller'); assert.equal(s.branch_id, 'B1'); assert.equal(s.status, 'completed');
  assert.equal(s.legacy_id, 'SALE-0007');                 // six sales of V1 already
  const m = moves(db);
  assert.equal(m.length, 1); assert.equal(m[0].type, 'sold'); assert.equal(m[0].qty, 3); assert.equal(m[0].reference_sale_id, s.id); assert.equal(m[0].from_branch_id, 'B1');
});

test('recordSale: a serialized product is sold unit by unit, the unit is marked sold and the count recounted', async () => {
  const db = bookDb();
  const r = await FN.recordSale(db, ADM(), { items: [{ product_id: 'P1', qty: 2, price: 350000, unit_ids: ['U1', 'U2'] }], payment_method: 'Credit', financing_partner_id: 'FP1', branch_id: 'B1' }, NOW);
  assert.equal(r.sale_ids.length, 2);
  assert.equal(r.grand_total, 700000);
  assert.equal(unit(db, 'U1').status, 'sold'); assert.equal(unit(db, 'U1').sold_sale_id, r.sale_ids[0]);
  assert.equal(product(db, 'P1').stock, 1);               // U3 remains
  const rows = db._dump('sales').filter(x => r.sale_ids.includes(x.id));
  assert.deepEqual(rows.map(x => x.imei), ['350000000000001', '350000000000002']);
  assert.ok(rows.every(x => x.qty === 1 && x.payment_method === 'Credit' && x.financing_partner_id === 'FP1' && x.brand === 'Samsung'));
  assert.equal(moves(db).length, 2);
});

test('recordSale: every line is checked before anything is written', async () => {
  const db = bookDb();
  await rejects(FN.recordSale(db, SEL(), { items: [{ product_id: 'P3', qty: 1, price: 5000 }, { product_id: 'P3', qty: 45, price: 5000 }], payment_method: 'Cash' }, NOW), 400, /Insufficient stock/);
  await rejects(FN.recordSale(db, SEL(), { items: [{ product_id: 'P1', qty: 2, price: 1, unit_ids: ['U1'] }], payment_method: 'Cash' }, NOW), 400, /exactly 2/);
  await rejects(FN.recordSale(db, SEL(), { items: [{ product_id: 'P1', qty: 1, price: 1, unit_ids: ['U4'] }], payment_method: 'Cash' }, NOW), 400, /not in stock/);
  await rejects(FN.recordSale(db, SEL(), { items: [{ product_id: 'P3', qty: 1, price: 5000 }], payment_method: 'Credit' }, NOW), 400, /financing partner/);
  await rejects(FN.recordSale(db, ADM2(), { items: [{ product_id: 'P5', qty: 1 }], payment_method: 'Credit', financing_partner_id: 'FP1' }, NOW), 400, /not available/);
  await rejects(FN.recordSale(db, SEL(), { items: [{ product_id: 'P3', qty: 1, price: 5000, discount: 6000 }], payment_method: 'Cash' }, NOW), 400, /Discount/);
  await rejects(FN.recordSale(db, SEL(), { items: [{ product_id: 'P5', qty: 1 }], payment_method: 'Cash' }, NOW), 404);   // another vendor's product
  await rejects(FN.recordSale(db, MGR(), { items: [{ product_id: 'P3', qty: 1 }], payment_method: 'Cash' }, NOW), 403);
  await rejects(FN.recordSale(db, SEL(), { items: [], payment_method: 'Cash' }, NOW), 400);
  assert.equal(product(db, 'P3').stock, 40);
  assert.equal(db._dump('sales').length, 7);
  assert.equal(moves(db).length, 0);
});

test('recordSale: a blank price means the list price; the global partner works for any vendor', async () => {
  const db = bookDb();
  const r = await FN.recordSale(db, ADM2(), { items: [{ product_id: 'P5', qty: 2 }], payment_method: 'Credit', financing_partner_id: 'FP2' }, NOW);
  assert.equal(r.grand_total, 6400);
  assert.equal(product(db, 'P5').stock, 6);
});

test('cancelSale: soft-cancel restores stock, records who and why, and refuses a second time', async () => {
  const db = bookDb();
  deps.fetch = async () => ({ ok: true, json: async () => ({ id: 'm1' }) });
  process.env.RESEND_API_KEY = 'x';
  const r = await FN.cancelSale(db, ADM(), { sale_id: 'S2', reason: 'Customer returned it' }, NOW);
  assert.match(r.message, /cancelled and stock restored/);
  assert.match(r.message, /Seller notified/);
  const s = db._dump('sales').find(x => x.id === 'S2');
  assert.equal(s.status, 'cancelled'); assert.equal(s.cancelled_by, 'ADM1'); assert.equal(s.cancelled_by_name, 'Frank Amos'); assert.equal(s.cancel_reason, 'Customer returned it');
  assert.equal(product(db, 'P3').stock, 42);
  assert.equal(bs(db, 'P3', 'B1'), 27);
  const m = moves(db);
  assert.equal(m.length, 1); assert.equal(m[0].type, 'cancelled_restock'); assert.equal(m[0].reference_sale_id, 'S2');
  await rejects(FN.cancelSale(db, ADM(), { sale_id: 'S2', reason: 'again' }, NOW), 400, /already cancelled/);
  await rejects(FN.cancelSale(db, ADM(), { sale_id: 'S3', reason: '' }, NOW), 400);
  await rejects(FN.cancelSale(db, ADM2(), { sale_id: 'S3', reason: 'not mine' }, NOW), 403);
  await rejects(FN.cancelSale(db, SEL(), { sale_id: 'S3', reason: 'seller' }, NOW), 403);
  delete process.env.RESEND_API_KEY; deps.fetch = null;
});

test('cancelSale: a serialized sale puts the unit back in stock at its branch', async () => {
  const db = bookDb();
  const r = await FN.cancelSale(db, MGR(), { sale_id: 'S1', reason: 'Phone faulty' }, NOW);
  assert.match(r.message, /stock restored/);
  assert.equal(unit(db, 'U4').status, 'in_stock'); assert.equal(unit(db, 'U4').sold_sale_id, null);
  assert.equal(product(db, 'P1').stock, 4);
  assert.equal(moves(db)[0].to_branch_id, 'B1');
});

test('markPartnerPaid: only a credit sale, only its vendor', async () => {
  const db = bookDb();
  const r = await FN.markPartnerPaid(db, ADM(), { sale_id: 'S1', paid: true }, NOW);
  assert.match(r.message, /paid by the partner/);
  const s = db._dump('sales').find(x => x.id === 'S1');
  assert.equal(s.partner_paid, true); assert.ok(s.partner_paid_at);
  await rejects(FN.markPartnerPaid(db, ADM(), { sale_id: 'S2', paid: true }, NOW), 400, /credit sale/);
  await rejects(FN.markPartnerPaid(db, ADM2(), { sale_id: 'S1', paid: true }, NOW), 404);
  await rejects(FN.markPartnerPaid(db, SEL(), { sale_id: 'S1', paid: true }, NOW), 403);
  const back = await FN.markPartnerPaid(db, ADM(), { group_id: 'G1', paid: false }, NOW);
  assert.match(back.message, /not yet paid/);
  assert.equal(db._dump('sales').find(x => x.id === 'S1').partner_paid, false);
});

test('recentSales: newest first, completed only unless asked, names joined, bounded', async () => {
  const db = bookDb();
  const r = await FN.recentSales(db, ADM(), {}, NOW);
  assert.deepEqual(r.rows.map(x => x.id), ['S3', 'S2', 'S1', 'S5', 'S6']);
  const s1 = r.rows.find(x => x.id === 'S1');
  assert.equal(s1.partner_name, 'MOGO'); assert.equal(s1.branch_name, 'Sinza'); assert.equal(s1.imei, '350000000000004'); assert.equal(s1.discount, 10000);
  const all = await FN.recentSales(db, ADM(), { include_cancelled: true, limit: 2 }, NOW);
  assert.equal(all.rows.length, 2);
  const withCancelled = await FN.recentSales(db, ADM(), { include_cancelled: true }, NOW);
  assert.ok(withCancelled.rows.some(x => x.id === 'S4' && x.status === 'cancelled' && x.cancelled_by_name === 'Frank Amos'));
  const b2 = await FN.recentSales(db, ADM(), { branch_id: 'B2' }, NOW);
  assert.deepEqual(b2.rows.map(x => x.id), ['S3']);
  await rejects(FN.recentSales(db, SEL(), {}, NOW), 403);
  await rejects(FN.recentSales(db, MGR(), {}, NOW), 400);
  assert.equal((await FN.recentSales(db, MGR(), { vendor_id: 'V2' }, NOW)).rows.length, 1);
});

test('salesDetail: grouped by seller for the period; a seller sees only their own; stock is the product table', async () => {
  const db = bookDb();
  const today = await FN.salesDetail(db, ADM(), { period: 'today' }, NOW);
  assert.equal(today.kind, 'sales');
  assert.deepEqual(today.groups.map(g => g.seller_name), ['Asha Seller', 'Juma Seller']);
  assert.equal(today.groups[1].total, 350000);
  assert.equal(today.grand_total, 355000);
  assert.equal(today.currency, 'TZS');
  const year = await FN.salesDetail(db, ADM(), { period: 'year' }, NOW);
  assert.equal(year.grand_total, 378000);
  const own = await FN.salesDetail(db, SEL(), { period: 'today' }, NOW);
  assert.deepEqual(own.groups.map(g => g.seller_name), ['Juma Seller']);
  const stock = await FN.salesDetail(db, ADM(), { period: 'stock' }, NOW);
  assert.equal(stock.kind, 'stock');
  assert.deepEqual(stock.rows.map(p => p.legacy_id), ['P001', 'P002', 'P003']);
  const all = await FN.salesDetail(db, MGR(), { period: 'today' }, NOW);
  assert.equal(all.grand_total, 361400);                  // V1 + V2, in TZS
  await rejects(FN.salesDetail(db, ADM(), { period: 'decade' }, NOW), 400);
});

test('a restricted vendor cannot sell, through the one door', async () => {
  const db = bookDb();
  const locked = userOf(richBook(), 'ADM3');
  await assert.rejects(boApi(db, locked, 'recordSale', { items: [{ product_id: 'P7', qty: 1 }], payment_method: 'Cash' }, NOW),
    e => e.status === 403 && e.restricted === true);
  // Reads still answer, so the person can see what they owe and who to call.
  const d = await boApi(db, locked, 'salesDetail', { period: 'today' }, NOW);
  assert.equal(d.kind, 'sales');
});
