/* THE RECEIPT.
 *
 * Not a record -- a VIEW of one. Nothing is stored, so a receipt cannot drift from the sale it
 * came from; ask twice and you get the same answer because there is only one answer.
 *
 * The half of this that matters is who may ask. A receipt carries a customer's name and phone,
 * so a seller gets their own checkouts and nobody else's: "let me just look that sale up" is
 * not a reason to hand one member of staff another's customer list. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { richBook, bookDb, userOf, NOW } from './_book.mjs';

const { FN } = await import('../api/_lib/bo/sales.js');
const { boApi } = await import('../api/_lib/bo-core.js');

const ADM = () => userOf(richBook(), 'ADM1');
const SEL = () => userOf(richBook(), 'SEL1');
const SEL2 = () => userOf(richBook(), 'SEL2');
const ADM2 = () => userOf(richBook(), 'ADM2');
const MGR = () => userOf(richBook(), 'MGR');
async function rejects(p, status, re) {
  await assert.rejects(p, e => { assert.equal(e.status, status, e.message); if (re) assert.match(e.message, re); return true; });
}

test('a receipt is the whole checkout, not the one line you happened to name', async () => {
  const db = bookDb();
  const sale = await FN.recordSale(db, SEL(), {
    items: [{ product_id: 'P3', qty: 2 }, { product_id: 'P2', qty: 1, unit_ids: ['U5'] }],
    payment_method: 'Cash', customer_name: 'Neema Mushi', customer_phone: '0712000111',
  }, NOW);

  // ask by ONE of its sale ids and you still get all of it
  const r = await FN.saleReceipt(db, ADM(), { sale_id: sale.sale_ids[0] });
  assert.equal(r.items.length, 2);
  assert.equal(r.group_id, sale.group_id);
  assert.equal(r.total, sale.grand_total);
  assert.equal(r.customer_name, 'Neema Mushi');
  assert.equal(r.customer_phone, '0712000111');
  assert.equal(r.seller_name, 'Juma Seller');
  assert.equal(r.payment_method, 'Cash');
  assert.equal(r.vendor.name, richBook().vendors.find(v => v.id === 'V1').name);
  assert.equal(r.currency, 'TZS');
  assert.ok(r.items.some(i => i.imei), 'the IMEI is on the receipt, which is the warranty claim');

  const byGroup = await FN.saleReceipt(db, ADM(), { group_id: sale.group_id });
  assert.deepEqual(byGroup, r, 'the same checkout, whichever way you name it');
});

test('the arithmetic on the paper is the arithmetic in the book', async () => {
  const db = bookDb();
  const sale = await FN.recordSale(db, SEL(), {
    items: [{ product_id: 'P3', qty: 4, price: 5000, discount: 500 }],
    payment_method: 'Cash',
  }, NOW);
  const r = await FN.saleReceipt(db, SEL(), { group_id: sale.group_id });
  assert.equal(r.subtotal, 20000);       // 4 x the list price
  assert.equal(r.discount, 2000);        // 4 x 500 off
  assert.equal(r.total, 18000);          // and what was actually taken
  assert.equal(r.subtotal - r.discount, r.total);
});

test('the receipt number names the range when a checkout wrote several lines', async () => {
  const db = bookDb();
  const one = await FN.recordSale(db, SEL(), { items: [{ product_id: 'P3', qty: 1 }], payment_method: 'Cash' }, NOW);
  assert.match((await FN.saleReceipt(db, SEL(), { group_id: one.group_id })).receipt_no, /^SALE-\d{4}$/);

  const many = await FN.recordSale(db, SEL(), { items: [{ product_id: 'P3', qty: 1 }, { product_id: 'P1', qty: 2, unit_ids: ['U1', 'U2'] }] , payment_method: 'Cash' }, NOW);
  const r = await FN.saleReceipt(db, SEL(), { group_id: many.group_id });
  assert.match(r.receipt_no, /^SALE-\d{4} – SALE-\d{4}$/, 'one docket, three labels: say which');
  assert.equal(r.items.length, 3, 'a phone is one line per handset, because each has its own IMEI');
});

test('a cancelled sale still gets a receipt, and it says so', async () => {
  /* Somebody is standing there holding the old one. Refusing to print anything tells them
     nothing; what they need is the same document with CANCELLED across it. */
  const db = bookDb();
  const r = await FN.saleReceipt(db, ADM(), { sale_id: 'S4' });
  assert.equal(r.status, 'cancelled');
  assert.match(r.cancelled_note, /cancelled by Frank Amos: wrong item/);
  assert.equal(r.total, 15000, 'and it still shows what was charged');
});

/* ------------------------------------------------------------------ who may ask */

test('a seller gets their own checkouts and nobody else', async () => {
  const db = bookDb();
  await FN.saleReceipt(db, SEL(), { sale_id: 'S2' });                     // Juma's own
  await rejects(FN.saleReceipt(db, SEL(), { sale_id: 'S3' }), 403, /not your sale/);   // Asha's
  await FN.saleReceipt(db, SEL2(), { sale_id: 'S3' });                    // and Asha may have it
});

test('a receipt never crosses a business, for an admin or a seller', async () => {
  const db = bookDb();
  await rejects(FN.saleReceipt(db, ADM2(), { sale_id: 'S1' }), 404);      // V1's sale, V2's admin
  await rejects(FN.saleReceipt(db, SEL(), { sale_id: 'S7' }), 404);       // V2's sale, V1's seller
  const mgr = await FN.saleReceipt(db, MGR(), { sale_id: 'S7' });
  assert.equal(mgr.vendor.name, richBook().vendors.find(v => v.id === 'V2').name, 'a manager sees any of them');
});

test('a receipt for a sale that is not there is not found, not a blank page', async () => {
  const db = bookDb();
  await rejects(FN.saleReceipt(db, ADM(), { sale_id: 'nope' }), 404);
  await rejects(FN.saleReceipt(db, ADM(), { group_id: 'nope' }), 404);
  await rejects(FN.saleReceipt(db, ADM(), {}), 400, /Name the sale/);
});

test('nothing is written by asking for one', async () => {
  const db = bookDb();
  const before = JSON.stringify(db._dump('sales'));
  await FN.saleReceipt(db, ADM(), { sale_id: 'S1' });
  assert.equal(JSON.stringify(db._dump('sales')), before, 'a receipt is a read; printing twice changes nothing');
});

test('the page reaches it through the same door as everything else', async () => {
  const db = bookDb();
  const r = await boApi(db, SEL(), 'saleReceipt', { sale_id: 'S2' }, NOW);
  assert.equal(r.items.length, 1);
});
