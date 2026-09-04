/* PURCHASE ORDERS -- the gap between "I have ordered forty covers" and "forty covers are here".
 *
 * Two rules hold the whole feature up, and most of this file is about them.
 *
 *   Receiving is the ONLY way an order becomes stock, and it goes through changeStock() like
 *   every other quantity change -- so a delivery leaves a 'received' movement, the per-shop
 *   figure moves with the business total, and there is no second path by which a number changes.
 *
 *   A partial delivery is the normal case. A supplier who owes forty sends twenty-eight. So
 *   receiving TOPS UP a line rather than replacing it, the order stays open until it is square,
 *   and receiving the same delivery twice is refused rather than doubled. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { richBook, bookDb, userOf, NOW } from './_book.mjs';

const { FN } = await import('../api/_lib/bo/purchasing.js');
const { boApi } = await import('../api/_lib/bo-core.js');

const ADM = () => userOf(richBook(), 'ADM1');
const SEL = () => userOf(richBook(), 'SEL1');
const ADM2 = () => userOf(richBook(), 'ADM2');
const MGR = () => userOf(richBook(), 'MGR');
const product = (db, id) => db._dump('products').find(p => p.id === id);
const bs = (db, p, b) => (db._dump('branch_stock').find(x => x.product_id === p && x.branch_id === b) || { qty: 0 }).qty;
const moves = db => db._dump('stock_movements').filter(m => !/^M\d$/.test(m.id));
async function rejects(p, status, re) {
  await assert.rejects(p, e => { assert.equal(e.status, status, e.message); if (re) assert.match(e.message, re); return true; });
}
const raise = (db, user, items, extra) => FN.createPurchaseOrder(db, user || ADM(), { items, ...(extra || {}) }, NOW);
const only = async (db, user) => (await FN.purchaseOrders(db, user || ADM(), {})).rows[0];

/* ------------------------------------------------------------------ raising */

test('raising an order moves nothing: it is a promise, not a delivery', async () => {
  const db = bookDb();
  const before = product(db, 'P3').stock;
  const r = await raise(db, null, [{ product_id: 'P3', qty: 40, unit_cost: 2800 }], { supplier: 'Kariakoo Wholesale' });
  assert.match(r.message, /PO-0001 raised \(1 line/);
  assert.equal(product(db, 'P3').stock, before, 'stock does not move until the boxes do');
  assert.equal(moves(db).length, 0, 'and nothing is written to the movements ledger');

  const po = await only(db);
  assert.equal(po.status, 'ordered');
  assert.equal(po.supplier, 'Kariakoo Wholesale');
  assert.equal(po.total, 112000);
  assert.equal(po.outstanding, 40);
  assert.equal(po.items[0].product_name, 'Phone Cover', 'the name is a snapshot, as everywhere else');
  assert.equal(po.created_by_name, 'Frank Amos');
});

test('the order number runs per business, and a blank cost falls back to the catalogue', async () => {
  const db = bookDb();
  await raise(db, null, [{ product_id: 'P3', qty: 1 }]);
  await raise(db, null, [{ product_id: 'P3', qty: 1 }]);
  const rows = (await FN.purchaseOrders(db, ADM(), {})).rows.map(p => p.legacy_id).sort();
  assert.deepEqual(rows, ['PO-0001', 'PO-0002']);

  const po = (await FN.purchaseOrders(db, ADM(), {})).rows.find(p => p.legacy_id === 'PO-0001');
  assert.equal(po.items[0].unit_cost, 3000, "no cost given means what the product already costs");

  await raise(db, ADM2(), [{ product_id: 'P5', qty: 2 }]);
  assert.equal((await only(db, ADM2())).legacy_id, 'PO-0001', 'a second business starts at one again');
});

test('a half-written order is never written at all', async () => {
  const db = bookDb();
  await rejects(raise(db, null, [{ product_id: 'P3', qty: 5 }, { product_id: 'P5', qty: 5 }]), 404, /not in your catalogue/);
  await rejects(raise(db, null, [{ product_id: 'P3', qty: 0 }]), 400, /at least 1/);
  await rejects(raise(db, null, [{ product_id: 'P3', qty: 5, unit_cost: -1 }]), 400, /cannot be negative/);
  await rejects(raise(db, null, []), 400, /at least one product/);
  assert.equal(db._dump('purchase_orders').length, 0, 'nothing half-made is left behind');
  assert.equal(db._dump('purchase_order_items').length, 0);
});

/* ------------------------------------------------------------------ receiving */

test('receiving is what puts stock on the shelf, through the ordinary movement', async () => {
  const db = bookDb();
  const before = product(db, 'P3').stock, beforeBranch = bs(db, 'P3', 'B1');
  await raise(db, null, [{ product_id: 'P3', qty: 40, unit_cost: 2800 }], { branch_id: 'B1' });
  const po = await only(db);

  const r = await FN.receivePurchaseOrder(db, ADM(), { id: po.id }, NOW);
  assert.match(r.message, /40 items received into stock\. PO-0001 is complete\./);
  assert.equal(r.closed, true);
  assert.equal(product(db, 'P3').stock, before + 40);
  assert.equal(bs(db, 'P3', 'B1'), beforeBranch + 40, 'and at the shop it was delivered to');

  const m = moves(db);
  assert.equal(m.length, 1);
  assert.equal(m[0].type, 'received', 'the same movement a manual restock writes');
  assert.equal(m[0].qty, 40);
  assert.match(m[0].note, /Purchase order PO-0001/, 'so the ledger says where these came from');
  assert.equal((await only(db)).status, 'received');
});

test('a short delivery leaves the order open, and the next one tops it up', async () => {
  const db = bookDb();
  const before = product(db, 'P3').stock;
  await raise(db, null, [{ product_id: 'P3', qty: 40, unit_cost: 2800 }]);
  const po = await only(db);

  const first = await FN.receivePurchaseOrder(db, ADM(), { id: po.id, receipts: [{ item_id: po.items[0].id, qty: 28 }] }, NOW);
  assert.match(first.message, /28 items received into stock\. 12 still owed on PO-0001\./);
  assert.equal(first.closed, false);
  assert.equal(first.outstanding, 12);
  assert.equal(product(db, 'P3').stock, before + 28);

  let open = await only(db);
  assert.equal(open.status, 'ordered', 'still open, because it is');
  assert.equal(open.items[0].received_qty, 28);
  assert.equal(open.outstanding, 12);

  const second = await FN.receivePurchaseOrder(db, ADM(), { id: po.id, receipts: [{ item_id: po.items[0].id, qty: 12 }] }, NOW);
  assert.equal(second.closed, true);
  assert.equal(product(db, 'P3').stock, before + 40, 'topped up, not doubled');
  assert.equal((await only(db)).items[0].received_qty, 40);
  assert.equal(moves(db).length, 2, 'two deliveries, two movements -- the ledger tells the story');
});

test('you cannot receive more than was ordered, or receive it twice', async () => {
  const db = bookDb();
  await raise(db, null, [{ product_id: 'P3', qty: 10, unit_cost: 2800 }]);
  const po = await only(db);
  await rejects(FN.receivePurchaseOrder(db, ADM(), { id: po.id, receipts: [{ item_id: po.items[0].id, qty: 11 }] }, NOW), 400, /only 10 still owed/);

  await FN.receivePurchaseOrder(db, ADM(), { id: po.id }, NOW);
  await rejects(FN.receivePurchaseOrder(db, ADM(), { id: po.id }, NOW), 400, /already received/);
  assert.equal(moves(db).length, 1, 'and the second attempt moved nothing');
});

test('receiving nothing is refused rather than quietly closing the order', async () => {
  const db = bookDb();
  await raise(db, null, [{ product_id: 'P3', qty: 10 }]);
  const po = await only(db);
  await rejects(FN.receivePurchaseOrder(db, ADM(), { id: po.id, receipts: [] }, NOW), 400, /Nothing to receive/);
  await rejects(FN.receivePurchaseOrder(db, ADM(), { id: po.id, receipts: [{ item_id: po.items[0].id, qty: 0 }] }, NOW), 400, /Nothing to receive/);
  assert.equal((await only(db)).status, 'ordered');
});

test('THE COST FOLLOWS THE DELIVERY, which is how the profit figures stay honest', async () => {
  /* Otherwise cost_price is whatever somebody typed once, months ago, and every margin in the
     business drifts away from what the shop is really paying. */
  const db = bookDb();
  assert.equal(product(db, 'P3').cost_price, 3000);
  await raise(db, null, [{ product_id: 'P3', qty: 10, unit_cost: 3400 }]);
  await FN.receivePurchaseOrder(db, ADM(), { id: (await only(db)).id }, NOW);
  assert.equal(product(db, 'P3').cost_price, 3400, 'the supplier put the price up, and the book knows');
});

test('a zero on the order means "not recorded", not "free"', async () => {
  const db = bookDb();
  await raise(db, null, [{ product_id: 'P3', qty: 5, unit_cost: 0 }]);
  await FN.receivePurchaseOrder(db, ADM(), { id: (await only(db)).id }, NOW);
  assert.equal(product(db, 'P3').cost_price, 3000, 'the cost that was there is left alone');
});

test('a phone tracked by IMEI is not received as a number, and says so', async () => {
  /* A count would be a number the units then contradict, and the IMEIs are the whole point of
     tracking it that way. Better to refuse and point at the screen that can take them. */
  const db = bookDb();
  await raise(db, null, [{ product_id: 'P1', qty: 3, unit_cost: 300000 }]);
  await rejects(FN.receivePurchaseOrder(db, ADM(), { id: (await only(db)).id }, NOW), 400, /tracked by IMEI/);
  assert.equal(moves(db).length, 0);
});

/* ------------------------------------------------------------------ closing it off */

test('cancelling is only for an order nothing has arrived on', async () => {
  const db = bookDb();
  await raise(db, null, [{ product_id: 'P3', qty: 10, unit_cost: 2800 }]);
  const po = await only(db);
  await FN.receivePurchaseOrder(db, ADM(), { id: po.id, receipts: [{ item_id: po.items[0].id, qty: 4 }] }, NOW);

  /* Four are on the shelf. Calling the order cancelled would leave stock nothing accounts for. */
  await rejects(FN.cancelPurchaseOrder(db, ADM(), { id: po.id, reason: 'changed mind' }, NOW), 400, /already been received/);
  await rejects(FN.deletePurchaseOrder(db, ADM(), { id: po.id }), 400, /it is a record now/);

  const clean = await raise(db, null, [{ product_id: 'P3', qty: 2 }]);
  const r = await FN.cancelPurchaseOrder(db, ADM(), { id: clean.id, reason: 'supplier out of stock' }, NOW);
  assert.match(r.message, /PO-0002 cancelled/);
  const done = (await FN.purchaseOrders(db, ADM(), { status: 'cancelled' })).rows[0];
  assert.equal(done.cancel_reason, 'supplier out of stock');
  assert.equal(done.closed_by_name, 'Frank Amos');
});

test('an order raised by mistake can be deleted, lines and all', async () => {
  const db = bookDb();
  const po = await raise(db, null, [{ product_id: 'P3', qty: 2 }]);
  await FN.deletePurchaseOrder(db, ADM(), { id: po.id });
  assert.equal(db._dump('purchase_orders').length, 0);
  assert.equal(db._dump('purchase_order_items').length, 0, 'the lines go with it');
});

/* ------------------------------------------------------------------ who */

test('it is an admin screen, and it never crosses a business', async () => {
  const db = bookDb();
  await raise(db, null, [{ product_id: 'P3', qty: 5 }]);
  const po = await only(db);

  await rejects(FN.purchaseOrders(db, SEL(), {}), 403);
  await rejects(FN.createPurchaseOrder(db, SEL(), { items: [{ product_id: 'P3', qty: 1 }] }, NOW), 403);
  await rejects(FN.receivePurchaseOrder(db, SEL(), { id: po.id }, NOW), 403);

  assert.equal((await FN.purchaseOrders(db, ADM2(), {})).rows.length, 0, "another business sees none of it");
  await rejects(FN.receivePurchaseOrder(db, ADM2(), { id: po.id }, NOW), 404);
  await rejects(FN.purchaseOrders(db, MGR(), {}), 400, /Pick a business/);
  assert.equal((await FN.purchaseOrders(db, MGR(), { vendor_id: 'V1' })).rows.length, 1, 'a manager may name one');
});

test('the page reaches it through the same door as everything else', async () => {
  const db = bookDb();
  const r = await boApi(db, ADM(), 'createPurchaseOrder', { items: [{ product_id: 'P3', qty: 3, unit_cost: 2900 }] }, NOW);
  assert.match(r.message, /raised/);
  const list = await boApi(db, ADM(), 'purchaseOrders', {}, NOW);
  assert.equal(list.rows.length, 1);
  assert.equal(list.currency, 'TZS');
});
