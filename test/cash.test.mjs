import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookDb, richBook, userOf, NOW, T, MANAGER, ADMIN1, SELLER1, ADMIN2 } from './_book.mjs';
import { FN, WRITES } from '../api/_lib/bo/cash.js';
import { iso } from '../api/_lib/bo/_shared.js';

const BOOK = richBook();                     // users are read off one book; each test opens its own db
const user = id => userOf(BOOK, id);
const status = p => p.then(() => null, e => e.status);

test('contract: recordCash and cashReceipts, one write', () => {
  assert.deepEqual(Object.keys(FN).sort(), ['cashReceipts', 'recordCash']);
  assert.deepEqual([...WRITES], ['recordCash']);
});

test('recordCash: an admin writes what a seller handed over, stamped with the clock', async () => {
  const db = bookDb();
  const out = await FN.recordCash(db, user(ADMIN1), { seller_id: 'SEL1', cash_amount: '12000', lipa_amount: 0, note: ' evening ' }, NOW);
  assert.deepEqual(out, { message: 'Payment recorded successfully.' });
  const r = db._dump('cash_receipts').find(x => x.id !== 'C1');
  assert.deepEqual({ ...r, id: undefined }, { id: undefined, vendor_id: 'V1', seller_id: 'SEL1', cash_amount: 12000, lipa_amount: 0, note: 'evening', recorded_by: 'ADM1', received_at: iso(NOW) });
  // Lipa only is fine too.
  await FN.recordCash(db, user(ADMIN1), { seller_id: 'SEL2', cash_amount: 0, lipa_amount: 3000 }, NOW);
  assert.equal(db._dump('cash_receipts').length, 3);
});

test('recordCash: the seller must be an active seller of the admin\'s own business', async () => {
  const db = bookDb();
  const ok = { cash_amount: 1000, lipa_amount: 0 };
  assert.equal(await status(FN.recordCash(db, user(ADMIN2), { seller_id: 'SEL1', ...ok }, NOW)), 400);   // another vendor's seller
  assert.equal(await status(FN.recordCash(db, user(ADMIN1), { seller_id: 'SEL3', ...ok }, NOW)), 400);   // idem, the other way
  assert.equal(await status(FN.recordCash(db, user(ADMIN1), { seller_id: 'OLD', ...ok }, NOW)), 400);    // inactive
  assert.equal(await status(FN.recordCash(db, user(ADMIN1), { seller_id: 'ADM1', ...ok }, NOW)), 400);   // not a seller
  assert.equal(await status(FN.recordCash(db, user(ADMIN1), { seller_id: 'nobody', ...ok }, NOW)), 400);
  assert.equal(await status(FN.recordCash(db, user(ADMIN1), { ...ok }, NOW)), 400);
  assert.equal(db._dump('cash_receipts').length, 1);
});

test('recordCash: amounts must be non-negative and not both zero; only a business admin', async () => {
  const db = bookDb();
  assert.equal(await status(FN.recordCash(db, user(ADMIN1), { seller_id: 'SEL1', cash_amount: 0, lipa_amount: 0 }, NOW)), 400);
  assert.equal(await status(FN.recordCash(db, user(ADMIN1), { seller_id: 'SEL1' }, NOW)), 400);
  assert.equal(await status(FN.recordCash(db, user(ADMIN1), { seller_id: 'SEL1', cash_amount: -5, lipa_amount: 100 }, NOW)), 400);
  assert.equal(await status(FN.recordCash(db, user(SELLER1), { seller_id: 'SEL1', cash_amount: 100, lipa_amount: 0 }, NOW)), 403);
  assert.equal(await status(FN.recordCash(db, user(MANAGER), { seller_id: 'SEL1', cash_amount: 100, lipa_amount: 0 }, NOW)), 403);
  assert.equal(db._dump('cash_receipts').length, 1);
});

test('cashReceipts: today on the EAT clock by default, newest first, with the seller\'s name', async () => {
  const db = bookDb();
  db._dump('cash_receipts').push(
    { id: 'C0', vendor_id: 'V1', seller_id: 'SEL2', cash_amount: 500, lipa_amount: 0, note: null, recorded_by: 'ADM1', received_at: '2026-09-01T20:59:00.000Z' },   // 23:59 EAT yesterday
    { id: 'C2', vendor_id: 'V1', seller_id: 'SEL2', cash_amount: 700, lipa_amount: 200, note: 'x', recorded_by: 'ADM1', received_at: T(0, 5) },
    { id: 'C3', vendor_id: 'V2', seller_id: 'SEL3', cash_amount: 900, lipa_amount: 0, note: null, recorded_by: 'ADM2', received_at: T(10) });
  const { rows } = await FN.cashReceipts(db, user(ADMIN1), {}, NOW);
  assert.deepEqual(rows.map(r => r.id), ['C1', 'C2']);
  assert.equal(rows[0].seller_name, 'Juma Seller');
  assert.equal(rows[0].seller_handle, 'juma');
  assert.equal(rows[0].cash_amount, 6000);
  assert.equal(rows[1].seller_name, 'Asha Seller');
  assert.equal(rows[1].lipa_amount, 200);
  // One seller only.
  assert.deepEqual((await FN.cashReceipts(db, user(ADMIN1), { seller_id: 'SEL2' }, NOW)).rows.map(r => r.id), ['C2']);
  // A range reaches yesterday; the end day is inclusive.
  assert.deepEqual((await FN.cashReceipts(db, user(ADMIN1), { start: '2026-09-01', end: '2026-09-02' }, NOW)).rows.map(r => r.id), ['C1', 'C2', 'C0']);
  assert.deepEqual((await FN.cashReceipts(db, user(ADMIN1), { start: '2026-09-01', end: '2026-09-01' }, NOW)).rows.map(r => r.id), ['C0']);
  assert.equal(await status(FN.cashReceipts(db, user(ADMIN1), { start: '2026-09-03', end: '2026-09-01' }, NOW)), 400);
  assert.equal(await status(FN.cashReceipts(db, user(ADMIN1), { start: 'soon', end: '2026-09-01' }, NOW)), 400);
});

test('cashReceipts: admins are pinned to their vendor; a manager names one or takes all; sellers may not', async () => {
  const db = bookDb();
  db._dump('cash_receipts').push({ id: 'C3', vendor_id: 'V2', seller_id: 'SEL3', cash_amount: 900, lipa_amount: 0, note: null, recorded_by: 'ADM2', received_at: T(10) });
  assert.deepEqual((await FN.cashReceipts(db, user(ADMIN2), { vendor_id: 'V1' }, NOW)).rows.map(r => r.id), ['C3']);
  assert.deepEqual((await FN.cashReceipts(db, user(MANAGER), { vendor_id: 'V1' }, NOW)).rows.map(r => r.id), ['C1']);
  assert.deepEqual((await FN.cashReceipts(db, user(MANAGER), {}, NOW)).rows.map(r => r.id).sort(), ['C1', 'C3']);
  assert.deepEqual((await FN.cashReceipts(db, user(MANAGER), { vendor_id: 'ALL' }, NOW)).rows.length, 2);
  assert.equal(await status(FN.cashReceipts(db, user(SELLER1), {}, NOW)), 403);
});
