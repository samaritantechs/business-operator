/* CREDIT & VOIDS -- the two piles of paper on a shopkeeper's desk.
 *
 * Both existed before the screen did, and neither was findable: an unsettled credit sale was a
 * badge to spot in a table, a cancelled one was a report to download. The screen is new; the
 * rules underneath it are the ones that were already there, which is what this file holds it to. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { richBook, bookDb, userOf, NOW } from './_book.mjs';

const { FN } = await import('../api/_lib/bo/sales.js');
const { boApi } = await import('../api/_lib/bo-core.js');

const ADM = () => userOf(richBook(), 'ADM1');
const SEL = () => userOf(richBook(), 'SEL1');
const ADM2 = () => userOf(richBook(), 'ADM2');
const MGR = () => userOf(richBook(), 'MGR');
async function rejects(p, status, re) {
  await assert.rejects(p, e => { assert.equal(e.status, status, e.message); if (re) assert.match(e.message, re); return true; });
}

test('unsettled credit is listed oldest first, with what it is worth and how long it has waited', async () => {
  const db = bookDb();
  const r = await FN.creditAndVoids(db, ADM(), {}, NOW);

  assert.equal(r.credit.length, 1, 'the book has one credit sale and it is not settled');
  const g = r.credit[0];
  assert.equal(g.total, 340000);
  assert.equal(g.partner_name, 'MOGO');
  assert.equal(g.customer_name, 'Neema Mushi');
  assert.equal(g.age_days, 0, 'sold today');
  assert.equal(r.credit_total, 340000);
  assert.deepEqual(r.by_partner, [{ partner_name: 'MOGO', checkouts: 1, total: 340000 }]);
});

test('a settled credit sale leaves the list, and settling is per checkout', async () => {
  const db = bookDb();
  // a second handset on the SAME docket: one conversation with the partner, not two
  const extra = await FN.recordSale(db, SEL(), {
    items: [{ product_id: 'P1', qty: 2, unit_ids: ['U1', 'U2'] }],
    payment_method: 'Credit', financing_partner_id: 'FP1',
  }, NOW);
  let r = await FN.creditAndVoids(db, ADM(), {}, NOW);
  assert.equal(r.credit.length, 2, 'two dockets outstanding');
  const two = r.credit.find(g => g.group_id === extra.group_id);
  assert.equal(two.items.length, 2, 'two handsets, folded back into the one checkout they were rung up as');

  await FN.markPartnerPaid(db, ADM(), { group_id: extra.group_id, paid: true }, NOW);
  r = await FN.creditAndVoids(db, ADM(), {}, NOW);
  assert.equal(r.credit.length, 1, 'settled, so it is off the desk');
  assert.equal(r.credit_total, 340000);
});

test('a cancelled sale shows who cancelled it, when, and why', async () => {
  const db = bookDb();
  const r = await FN.creditAndVoids(db, ADM(), {}, NOW);
  assert.equal(r.voids.length, 1);
  const v = r.voids[0];
  assert.equal(v.total, 15000);
  assert.equal(v.cancelled_by_name, 'Frank Amos');
  assert.equal(v.cancel_reason, 'wrong item');
  assert.equal(v.seller_name, 'Juma Seller', 'and who rang it up in the first place');
  assert.equal(r.voids_total, 15000);
});

test('the void window is what the screen asked for, and it is bounded', async () => {
  const db = bookDb();
  const wide = await FN.creditAndVoids(db, ADM(), { days: 365 }, NOW);
  assert.equal(wide.days, 365);
  assert.ok(wide.voids.length >= 1);

  /* A cancellation older than the window is not on the screen. The alternative -- reading every
     cancelled sale a business ever had -- is the read this bound exists to prevent. */
  const sales = db._dump('sales');
  const old = sales.find(s => s.id === 'S4');
  old.cancelled_at = '2024-01-01T00:00:00.000Z';
  const narrow = await FN.creditAndVoids(db, ADM(), { days: 7 }, NOW);
  assert.equal(narrow.voids.length, 0);
  assert.equal(narrow.voids_total, 0);

  /* Anything the screen sends is clamped into 1..365 rather than obeyed. A window is a bound on
     a read of the sales table, so it is the one number here that must not be argued with. */
  assert.equal((await FN.creditAndVoids(db, ADM(), { days: 99999 }, NOW)).days, 365);
  assert.equal((await FN.creditAndVoids(db, ADM(), { days: -5 }, NOW)).days, 1);
  assert.equal((await FN.creditAndVoids(db, ADM(), { days: 'banana' }, NOW)).days, 30, 'and no number at all means the default');
  assert.equal((await FN.creditAndVoids(db, ADM(), {}, NOW)).days, 30);
});

test('outstanding credit is NOT windowed, because a debt does not expire', async () => {
  /* Voids are a recent-history screen; credit is a debt. A sale financed eight months ago and
     never settled is exactly the one somebody needs to see. */
  const db = bookDb();
  const sales = db._dump('sales');
  sales.find(s => s.id === 'S1').sold_at = '2025-06-01T08:00:00.000Z';
  const r = await FN.creditAndVoids(db, ADM(), { days: 7 }, NOW);
  assert.equal(r.credit.length, 1, 'still there');
  assert.ok(r.credit[0].age_days > 300, 'and it says how long: ' + r.credit[0].age_days + ' days');
});

test('a shop filter narrows both halves', async () => {
  const db = bookDb();
  const b1 = await FN.creditAndVoids(db, ADM(), { branch_id: 'B1' }, NOW);
  assert.equal(b1.credit.length, 1);
  assert.equal(b1.voids.length, 1);
  const b2 = await FN.creditAndVoids(db, ADM(), { branch_id: 'B2' }, NOW);
  assert.equal(b2.credit.length, 0);
  assert.equal(b2.voids.length, 0);
});

test('it is an admin screen, and it never crosses a business', async () => {
  const db = bookDb();
  await rejects(FN.creditAndVoids(db, SEL(), {}, NOW), 403);
  const other = await FN.creditAndVoids(db, ADM2(), {}, NOW);
  assert.equal(other.credit.length, 0, "V2 has no credit sales, and certainly not V1's");
  assert.equal(other.voids.length, 0);
  await rejects(FN.creditAndVoids(db, MGR(), {}, NOW), 400, /Pick a business/);
  const named = await FN.creditAndVoids(db, MGR(), { vendor_id: 'V1' }, NOW);
  assert.equal(named.credit.length, 1, 'a manager may name one');
});

test('the page reaches it through the same door as everything else', async () => {
  const db = bookDb();
  const r = await boApi(db, ADM(), 'creditAndVoids', { days: 30 }, NOW);
  assert.ok(Array.isArray(r.credit) && Array.isArray(r.voids));
  assert.equal(r.currency, 'TZS');
});

test('the unsettled-credit read is capped, and the screen SAYS when it is', async () => {
  /* "Not yet settled" is only a bound in a shop that settles. The shop that never taps Paid is
     exactly the one that most needs this screen, and its unsettled set grows for ever -- a year
     of six credit sales a day was already past the screen's whole budget, on a phone. */
  const book = richBook();
  const base = book.sales.find(s => s.id === 'S1');
  for (let i = 0; i < 620; i++) {
    book.sales.push({ ...base, id: 'BULK' + i, legacy_id: 'SALE-B' + i, group_id: 'GB' + i,
      sold_at: '2026-0' + (1 + (i % 8)) + '-1' + (i % 9) + 'T08:00:00.000Z' });
  }
  const db = bookDb(book);
  const r = await FN.creditAndVoids(db, ADM(), {}, NOW);

  assert.equal(r.credit.length, r.cap, 'capped at exactly the cap');
  assert.equal(r.credit_capped, true, 'and it admits the cut');
  assert.ok(r.credit[0].sold_at <= r.credit[r.credit.length - 1].sold_at, 'oldest first — the debt to chase');
});

test('an ordinary shop is not told anything was cut', async () => {
  const db = bookDb();
  const r = await FN.creditAndVoids(db, ADM(), {}, NOW);
  assert.equal(r.credit_capped, false);
  assert.equal(r.voids_capped, false);
});
