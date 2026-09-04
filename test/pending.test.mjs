/* PENDING SALES -- "hold the A05 for me, I'll come Friday".
 *
 * The whole feature rests on one decision: a hold takes the goods off the shelf through the same
 * changeStock() everything else uses, as a 'reserved' movement out. That makes products.stock
 * mean AVAILABLE, which is why the till cannot sell a held handset twice -- not because the till
 * learned about holds, but because the number is already gone. Most of this file is about that
 * and about what happens when a hold ends: collected, cancelled, or refused halfway through. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { richBook, bookDb, userOf, NOW } from './_book.mjs';

const { FN } = await import('../api/_lib/bo/pending.js');
const { FN: SALES } = await import('../api/_lib/bo/sales.js');
const { FN: PRODUCTS } = await import('../api/_lib/bo/products.js');
const { boApi } = await import('../api/_lib/bo-core.js');

const ADM = () => userOf(richBook(), 'ADM1');
const SEL = () => userOf(richBook(), 'SEL1');
const ADM2 = () => userOf(richBook(), 'ADM2');
const MGR = () => userOf(richBook(), 'MGR');
const product = (db, id) => db._dump('products').find(p => p.id === id);
const unit = (db, id) => db._dump('product_units').find(u => u.id === id);
const bs = (db, p, b) => (db._dump('branch_stock').find(x => x.product_id === p && x.branch_id === b) || { qty: 0 }).qty;
const moves = db => db._dump('stock_movements').filter(m => !/^M\d$/.test(m.id));
async function rejects(p, status, re) {
  await assert.rejects(p, e => { assert.equal(e.status, status, e.message); if (re) assert.match(e.message, re); return true; });
}
const hold = (db, user, args) => FN.createPendingSale(db, user || SEL(), args, NOW);
const only = async (db, user) => (await FN.pendingSales(db, user || ADM(), {}, NOW)).rows[0];

/* ------------------------------------------------------------------ holding */

test('a hold takes the goods off the shelf, as a movement like any other', async () => {
  const db = bookDb();
  const before = product(db, 'P3').stock, beforeBranch = bs(db, 'P3', 'B1');
  const r = await hold(db, null, { items: [{ product_id: 'P3', qty: 3 }], customer_name: 'Neema Mushi', customer_phone: '0712000111', deposit: 5000 });
  assert.match(r.message, /HOLD-0001: 1 item held for Neema Mushi \(15,000 TZS, 5,000 deposit\)/);

  assert.equal(product(db, 'P3').stock, before - 3, 'stock now means AVAILABLE');
  assert.equal(bs(db, 'P3', 'B1'), beforeBranch - 3, 'and at the shop holding them');
  const m = moves(db);
  assert.equal(m.length, 1);
  assert.equal(m[0].type, 'reserved');
  assert.match(m[0].note, /Held for Neema Mushi \(HOLD-0001\)/);

  const h = await only(db);
  assert.equal(h.status, 'held');
  assert.equal(h.total, 15000);
  assert.equal(h.deposit, 5000);
  assert.equal(h.balance, 10000, 'what is still to be paid');
});

test('a held handset disappears from the till, without the till knowing about holds', async () => {
  const db = bookDb();
  const before = (await PRODUCTS.productOptions(db, SEL(), {})).products.find(p => p.id === 'P1');
  assert.ok(before.units.some(u => u.id === 'U1'), 'U1 is on the shelf to begin with');

  await hold(db, null, { items: [{ product_id: 'P1', qty: 1, unit_ids: ['U1'] }], customer_name: 'Neema Mushi' });
  assert.equal(unit(db, 'U1').status, 'reserved');

  const after = (await PRODUCTS.productOptions(db, SEL(), {})).products.find(p => p.id === 'P1');
  assert.equal(after.units.some(u => u.id === 'U1'), false, 'the IMEI picker asks for in_stock, and always did');
  await rejects(SALES.recordSale(db, SEL(), { items: [{ product_id: 'P1', qty: 1, unit_ids: ['U1'] }], payment_method: 'Cash' }, NOW), 400, /not in stock \(reserved\)/);
});

test('you cannot hold more than is on the shelf, or hold the same handset twice', async () => {
  const db = bookDb();
  await rejects(hold(db, null, { items: [{ product_id: 'P3', qty: 999 }], customer_name: 'X' }), 400, /Not enough/);
  await hold(db, null, { items: [{ product_id: 'P1', qty: 1, unit_ids: ['U1'] }], customer_name: 'First' });
  await rejects(hold(db, null, { items: [{ product_id: 'P1', qty: 1, unit_ids: ['U1'] }], customer_name: 'Second' }), 400, /not in stock/);
});

test('a hold needs somebody it is being held FOR', async () => {
  /* Anonymous held stock is indistinguishable from stock that has gone missing. */
  const db = bookDb();
  await rejects(hold(db, null, { items: [{ product_id: 'P3', qty: 1 }] }), 400, /name is required/);
  await rejects(hold(db, null, { items: [{ product_id: 'P3', qty: 1 }], customer_name: '   ' }), 400, /name is required/);
  assert.equal(moves(db).length, 0, 'and a refused hold moves nothing');
});

test('a deposit bigger than the goods is refused, with what to do instead', async () => {
  const db = bookDb();
  await rejects(hold(db, null, { items: [{ product_id: 'P3', qty: 1 }], customer_name: 'X', deposit: 99999 }), 400, /more than the goods are worth/);
  await rejects(hold(db, null, { items: [{ product_id: 'P3', qty: 1 }], customer_name: 'X', deposit: -1 }), 400, /cannot be negative/);
});

test('nothing is written or moved when a line is bad', async () => {
  const db = bookDb();
  const before = product(db, 'P3').stock;
  await rejects(hold(db, null, { items: [{ product_id: 'P3', qty: 2 }, { product_id: 'P5', qty: 1 }], customer_name: 'X' }), 404, /not in your catalogue/);
  assert.equal(product(db, 'P3').stock, before);
  assert.equal(db._dump('pending_sales').length, 0);
  assert.equal(db._dump('pending_sale_items').length, 0);
});

/* ------------------------------------------------------------------ collecting */

test('collecting sells it through the ordinary sale, and says what is left to pay', async () => {
  const db = bookDb();
  const before = product(db, 'P3').stock;
  const h = await hold(db, null, { items: [{ product_id: 'P3', qty: 4, list_price: 5000, discount: 500 }], customer_name: 'Neema Mushi', customer_phone: '0712000111', deposit: 6000 });

  const r = await FN.completePendingSale(db, SEL(), { id: h.id, payment_method: 'Cash' }, NOW);
  assert.match(r.message, /HOLD-0001 collected by Neema Mushi\. Sale recorded/);
  assert.equal(r.grand_total, 18000, '4 x (5,000 less 500)');
  assert.equal(r.balance_due, 12000, 'the deposit comes off what is handed over now');

  assert.equal(product(db, 'P3').stock, before - 4, 'held, put back, then sold: net four gone');
  const sold = db._dump('sales').filter(s => s.group_id === r.group_id);
  assert.equal(sold.length, 1);
  assert.equal(sold[0].customer_name, 'Neema Mushi', 'the customer follows the hold onto the sale');
  assert.equal(sold[0].discount, 500, 'and so does the price that was agreed when it was held');
  assert.equal(sold[0].unit_cost, 3000, 'the cost snapshot happens at the till, as always');

  const types = moves(db).map(m => m.type);
  assert.deepEqual(types, ['reserved', 'unreserved', 'sold'], 'three movements, because that is what happened to it');
  assert.equal((await only(db)).status, 'completed');
  assert.equal((await only(db)).sale_group_id, r.group_id);
});

test('collecting a held handset sells that exact handset', async () => {
  const db = bookDb();
  const h = await hold(db, null, { items: [{ product_id: 'P1', qty: 1, unit_ids: ['U1'] }], customer_name: 'Neema Mushi' });
  const r = await FN.completePendingSale(db, SEL(), { id: h.id, payment_method: 'Cash' }, NOW);
  assert.equal(unit(db, 'U1').status, 'sold');
  const sold = db._dump('sales').filter(s => s.group_id === r.group_id);
  assert.equal(sold[0].unit_id, 'U1');
  assert.ok(sold[0].imei, 'and the IMEI is on the sale, which is the warranty claim');
  assert.equal(moves(db).filter(m => m.imei).length, 3, 'every movement about a handset carries its IMEI');
});

test('the payment method can be decided at collection, or promised at the hold', async () => {
  const db = bookDb();
  const promised = await hold(db, null, { items: [{ product_id: 'P3', qty: 1 }], customer_name: 'A', payment_method: 'Lipa Number' });
  const r = await FN.completePendingSale(db, SEL(), { id: promised.id }, NOW);
  assert.equal(db._dump('sales').find(s => s.group_id === r.group_id).payment_method, 'Lipa Number');

  const undecided = await hold(db, null, { items: [{ product_id: 'P3', qty: 1 }], customer_name: 'B' });
  await rejects(FN.completePendingSale(db, SEL(), { id: undecided.id }, NOW), 400, /How are they paying/);
});

test('if the sale is refused halfway, the goods go straight back ON hold', async () => {
  /* The dangerous moment: the stock has come off hold and the sale has not happened. Left there,
     the shelf shows four covers that a hold record still claims. */
  const db = bookDb();
  const before = product(db, 'P3').stock;
  const h = await hold(db, null, { items: [{ product_id: 'P3', qty: 2 }], customer_name: 'Neema Mushi' });
  await PRODUCTS.updateProduct(db, ADM(), { id: 'P3', active: false }, NOW).catch(() => {});
  db._dump('products').find(p => p.id === 'P3').active = false;

  await rejects(FN.completePendingSale(db, SEL(), { id: h.id, payment_method: 'Cash' }, NOW), 400);
  assert.equal(product(db, 'P3').stock, before - 2, 'still held, exactly as before the attempt');
  assert.equal((await only(db)).status, 'held', 'and the hold is still a hold');
  assert.deepEqual(moves(db).map(m => m.type), ['reserved', 'unreserved', 'reserved']);
});

/* ------------------------------------------------------------------ letting go */

test('cancelling puts the stock back and is honest about the deposit', async () => {
  const db = bookDb();
  const before = product(db, 'P3').stock;
  const h = await hold(db, null, { items: [{ product_id: 'P3', qty: 3 }], customer_name: 'Neema Mushi', deposit: 5000 });
  const r = await FN.cancelPendingSale(db, ADM(), { id: h.id, reason: 'never came back' }, NOW);
  assert.match(r.message, /the stock is back on the shelf/);
  assert.match(r.message, /5,000 deposit is not refunded by the system/, 'the app must not imply it moved money it did not move');
  assert.equal(product(db, 'P3').stock, before);
  const done = (await FN.pendingSales(db, ADM(), { status: 'cancelled' }, NOW)).rows[0];
  assert.equal(done.cancel_reason, 'never came back');
  assert.deepEqual(moves(db).map(m => m.type), ['reserved', 'unreserved']);
});

test('a hold released for going stale is marked expired, not cancelled', async () => {
  const db = bookDb();
  const h = await hold(db, null, { items: [{ product_id: 'P3', qty: 1 }], customer_name: 'X' });
  await FN.cancelPendingSale(db, ADM(), { id: h.id, expired: true, reason: 'held date passed' }, NOW);
  assert.equal((await FN.pendingSales(db, ADM(), { status: 'expired' }, NOW)).rows.length, 1);
});

test('a hold past its date is SAID to be overdue, and nothing acts on it', async () => {
  /* A system that silently released somebody's phone because a date went by would be worse than
     the shelf. The date is what was agreed; a person decides. */
  const db = bookDb();
  await hold(db, null, { items: [{ product_id: 'P3', qty: 1 }], customer_name: 'Late', hold_until: '2026-09-01' });
  await hold(db, null, { items: [{ product_id: 'P3', qty: 1 }], customer_name: 'Fine', hold_until: '2026-12-31' });
  const list = (await FN.pendingSales(db, ADM(), {}, NOW)).rows;
  assert.equal(list.find(h => h.customer_name === 'Late').overdue, true);
  assert.equal(list.find(h => h.customer_name === 'Fine').overdue, false);
  assert.equal(list.filter(h => h.status === 'held').length, 2, 'both still held; nothing expired itself');
});

test('a hold cannot be collected or cancelled twice', async () => {
  const db = bookDb();
  const h = await hold(db, null, { items: [{ product_id: 'P3', qty: 1 }], customer_name: 'X' });
  await FN.completePendingSale(db, SEL(), { id: h.id, payment_method: 'Cash' }, NOW);
  await rejects(FN.completePendingSale(db, SEL(), { id: h.id, payment_method: 'Cash' }, NOW), 400, /already completed/);
  await rejects(FN.cancelPendingSale(db, ADM(), { id: h.id }, NOW), 400, /already completed/);
});

/* ------------------------------------------------------------------ who */

test('a seller may hold and collect; nothing crosses a business', async () => {
  const db = bookDb();
  const h = await hold(db, SEL(), { items: [{ product_id: 'P3', qty: 1 }], customer_name: 'X' });
  assert.equal((await FN.pendingSales(db, SEL(), {}, NOW)).rows.length, 1, 'a seller must see what is held before promising it again');

  await rejects(FN.completePendingSale(db, ADM2(), { id: h.id, payment_method: 'Cash' }, NOW), 404);
  await rejects(FN.cancelPendingSale(db, ADM2(), { id: h.id }, NOW), 404);
  assert.equal((await FN.pendingSales(db, ADM2(), {}, NOW)).rows.length, 0);
  await rejects(FN.pendingSales(db, MGR(), {}, NOW), 400, /Pick a business/);
  assert.equal((await FN.pendingSales(db, MGR(), { vendor_id: 'V1' }, NOW)).rows.length, 1);
});

test('the page reaches it through the same door as everything else', async () => {
  const db = bookDb();
  const r = await boApi(db, SEL(), 'createPendingSale', { items: [{ product_id: 'P3', qty: 2 }], customer_name: 'Neema Mushi' }, NOW);
  assert.match(r.message, /held for Neema Mushi/);
  const list = await boApi(db, ADM(), 'pendingSales', {}, NOW);
  assert.equal(list.rows.length, 1);
  assert.equal(list.currency, 'TZS');
});

/* =====================================================================================
   WHAT AN ADVERSARIAL REVIEW FOUND, AFTER THIS SHIPPED.
   =====================================================================================
   Seven defects, four of them here, every one a way for stock to be created or destroyed. They
   are grouped together because they share a cause: I wrote the hold path by analogy with the
   sale path and did not carry over the guards the sale path had already learned. */

test('a hold cannot be collected twice, however fast the second tap is', async () => {
  /* Reading the status and writing it back afterwards is not a lock. Two taps on "They collected
     it" both read 'held', both released the stock, and both sold it. lendings.js already did this
     correctly and says why -- I wrote that guard and then did not apply it here. */
  const db = bookDb();
  const before = product(db, 'P3').stock;
  const h = await hold(db, null, { items: [{ product_id: 'P3', qty: 4 }], customer_name: 'Neema Mushi' });

  const both = await Promise.allSettled([
    FN.completePendingSale(db, SEL(), { id: h.id, payment_method: 'Cash' }, NOW),
    FN.completePendingSale(db, SEL(), { id: h.id, payment_method: 'Cash' }, NOW),
  ]);
  const won = both.filter(r => r.status === 'fulfilled');
  assert.equal(won.length, 1, 'exactly one collection may win');
  assert.match(String(both.find(r => r.status === 'rejected').reason.message), /already been dealt with|already completed/);

  assert.equal(product(db, 'P3').stock, before - 4, 'four held, four sold — not eight');
  const group = won[0].value.group_id;
  assert.equal(db._dump('sales').filter(s => s.group_id === group).length, 1, 'the winner wrote one sale');
  const holdSales = db._dump('sales').filter(s => s.customer_name === 'Neema Mushi' && s.qty === 4);
  assert.equal(holdSales.length, 1, 'and the loser wrote none — one collection, one sale');
  assert.equal((await only(db)).status, 'completed');
});

test('a hold cannot be released twice either', async () => {
  const db = bookDb();
  const before = product(db, 'P3').stock;
  const h = await hold(db, null, { items: [{ product_id: 'P3', qty: 3 }], customer_name: 'X' });
  const both = await Promise.allSettled([
    FN.cancelPendingSale(db, ADM(), { id: h.id, reason: 'a' }, NOW),
    FN.cancelPendingSale(db, ADM(), { id: h.id, reason: 'b' }, NOW),
  ]);
  assert.equal(both.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(product(db, 'P3').stock, before, 'the three come back once, not twice');
});

test('releasing a hold never resurrects a handset that is no longer reserved', async () => {
  /* release() forced 'in_stock' whatever the unit's current status. A handset that had escaped
     the hold and been sold, or been marked lost, was put back on the shelf by the release and
     could be sold a second time. */
  const db = bookDb();
  const h = await hold(db, null, { items: [{ product_id: 'P1', qty: 1, unit_ids: ['U1'] }], customer_name: 'Neema' });
  db._dump('product_units').find(u => u.id === 'U1').status = 'sold';     // it got out some other way
  const stock = product(db, 'P1').stock;

  await FN.cancelPendingSale(db, ADM(), { id: h.id, reason: 'gone' }, NOW);
  assert.equal(unit(db, 'U1').status, 'sold', 'a sold handset stays sold');
  assert.equal(product(db, 'P1').stock, stock, 'and the count is not inflated by a phone that is gone');
});

test('a hold never moves the handset between shops', async () => {
  /* changeStock rewrites a unit's branch whenever toBranchId is passed, and release passed the
     HOLD's branch. A seller at Sinza taking a booking for a phone in the Kariakoo drawer moved
     that phone to Sinza in the book; an admin with no branch dropped it out of every shop. */
  const db = bookDb();
  const where = unit(db, 'U3').branch_id;
  assert.ok(where, 'U3 starts at a shop');

  const h = await hold(db, ADM(), { items: [{ product_id: 'P1', qty: 1, unit_ids: ['U3'] }], customer_name: 'Neema' });
  assert.equal(unit(db, 'U3').branch_id, where, 'reserving never moved it');
  await FN.cancelPendingSale(db, ADM(), { id: h.id, reason: 'never came' }, NOW);
  assert.equal(unit(db, 'U3').branch_id, where, 'and releasing must not move it either');
});

test('a hold cannot take more out of a shop than that shop holds', async () => {
  /* recordSale carries this check with a comment describing exactly what happens without it: the
     shop's row goes negative and the per-shop figures stop adding up to the business total. The
     hold path reserved through the same branch and checked only the business-wide total. */
  const db = bookDb();
  const total = product(db, 'P3').stock, here = bs(db, 'P3', 'B2');
  assert.ok(total > here, 'the business holds more than this one shop does');

  await rejects(FN.createPendingSale(db, userOf(richBook(), 'SEL2'),
    { items: [{ product_id: 'P3', qty: here + 5 }], customer_name: 'X', branch_id: 'B2' }, NOW), 400, /short at this shop/);
  assert.equal(bs(db, 'P3', 'B2'), here, 'and the shop row is untouched, not negative');
  assert.equal(product(db, 'P3').stock, total);
});

test('every handset on a hold is charged the price IT was held at', async () => {
  /* Two of the same model, one discounted, collapsed onto the first line's price: a hold agreed
     at 650,000 was rung up at 700,000, and which line won depended on the row order. */
  const db = bookDb();
  const h = await hold(db, null, {
    items: [{ product_id: 'P1', qty: 1, unit_ids: ['U1'], list_price: 350000, discount: 0 },
            { product_id: 'P1', qty: 1, unit_ids: ['U2'], list_price: 350000, discount: 50000 }],
    customer_name: 'Neema Mushi',
  });
  assert.equal((await only(db)).total, 650000, 'the hold says 650,000');

  const r = await FN.completePendingSale(db, SEL(), { id: h.id, payment_method: 'Cash' }, NOW);
  assert.equal(r.grand_total, 650000, 'and the customer is charged 650,000, not 700,000');
  const sold = db._dump('sales').filter(s => s.group_id === r.group_id);
  assert.deepEqual(sold.map(s => s.discount).sort((a, b) => a - b), [0, 50000], 'each handset keeps its own discount');
});
