/* INVOICES, AND THE BLOCK THAT FOLLOWS AN UNPAID ONE.
 * =====================================================================================
 * A restricted vendor is refused every write, recordSale included -- so a wrong block is a shop
 * that cannot sell, mid-morning, with a customer at the counter. Blocking a day late costs the
 * owner 0.6% of one shop's one day. Blocking a day early costs the shop its whole day and the
 * owner that customer for good.
 *
 * Every test below is one of the guards standing between an arithmetic slip and somebody's till.
 * They are written from the shop's side on purpose: most of them assert that nothing happened. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './_env.mjs';
import { FN, outstandingOf, dueAt } from '../api/_lib/bo/billing.js';
import { bookDb, richBook, userOf, MANAGER, ADMIN1 } from './_book.mjs';

const at = s => new Date(s + 'T12:00:00.000Z').getTime();
const mgr = () => userOf(richBook(), MANAGER);
const rejects = (p, status, re) => assert.rejects(p, e => { assert.equal(e.status, status, e.message); if (re) assert.match(e.message, re); return true; });

/** A book whose V1 registered in June, so several periods have closed by September. */
function billBook(over = {}) {
  const book = richBook();
  const v = book.vendors.find(x => x.id === 'V1');
  v.registered_on = '2026-06-02T06:00:00.000Z';
  /* OVERRIDES REPLACE, THEY DO NOT APPEND. getSettings takes the FIRST row for a key, so
     pushing a second { autoBlockEnabled: 'Yes' } behind the default left the default winning and
     silently tested the wrong thing -- every blocking test passed for the wrong reason. */
  const base = {
    commissionRate: '0.6', trialDays: '0', autoBlockEnabled: 'No', invoiceGraceDays: '7',
    /* Ten, not the real default of a thousand: 0.6% of this fixture's sales is about 108 TZS,
       so a realistic minimum would mask every other guard under test. The minimum has its own
       test below, with its own explicit value. */
    minInvoiceAmount: '10',
  };
  book.settings = Object.entries({ ...base, ...over }).map(([key, value]) => ({ key, value: String(value) }));
  book.invoices = [];
  return book;
}
const setting = (book, key, value) => { book.settings = book.settings.filter(s => s.key !== key).concat([{ key, value: String(value) }]); return book; };

/* ------------------------------------------------------------------ issuing */

test('issuing bills the period that has CLOSED, never the one still running', async () => {
  /* Invoicing a period in progress bills a shop for a month it has not finished trading, and the
     figure would move under them afterwards -- the one thing a document a business keeps must
     never do. */
  const db = bookDb(billBook());
  const r = await FN.issueInvoices(db, mgr(), {}, at('2026-09-10'));
  const inv = db._dump('invoices').find(i => i.vendor_id === 'V1');
  assert.ok(inv, 'V1 was invoiced');
  assert.ok(new Date(inv.period_end).getTime() <= at('2026-09-10'), 'the period it bills has already ended');
  assert.ok(new Date(inv.period_start) < new Date(inv.period_end));
  assert.equal(inv.status, 'unpaid');
  assert.equal(Number(inv.rate), 0.6);
});

test('issuing twice does not bill the same period twice', async () => {
  /* A second invoice for money already owed once is how a shop ends up paying twice, or
     refusing to pay at all. */
  const db = bookDb(billBook());
  await FN.issueInvoices(db, mgr(), {}, at('2026-09-10'));
  const after1 = db._dump('invoices').length;
  const r2 = await FN.issueInvoices(db, mgr(), {}, at('2026-09-11'));
  assert.equal(db._dump('invoices').length, after1, 'nothing new was written');
  assert.equal(r2.issued, 0);
  assert.ok(r2.skipped.some(s => /already invoiced/.test(s.why)));
});

test('a rate of zero issues nothing at all', async () => {
  const db = bookDb(setting(billBook(), 'commissionRate', '0'));
  const r = await FN.issueInvoices(db, mgr(), {}, at('2026-09-10'));
  assert.equal(r.issued, 0);
  assert.equal(db._dump('invoices').length, 0);
  assert.match(r.message, /rate is 0/i);
});

test('a vendor still on trial is not invoiced', async () => {
  const db = bookDb(setting(billBook(), 'trialDays', '3650'));
  const r = await FN.issueInvoices(db, mgr(), {}, at('2026-09-10'));
  assert.equal(r.issued, 0);
  assert.ok(r.skipped.some(s => /trial/.test(s.why)));
});

test('only a manager may issue, pay or waive', async () => {
  const db = bookDb(billBook());
  const adm = userOf(richBook(), ADMIN1);
  await rejects(FN.issueInvoices(db, adm, {}, at('2026-09-10')), 403);
  await rejects(FN.recordInvoicePayment(db, adm, { id: 'x', amount: 1, method: 'Cash', reference: 'r' }, at('2026-09-10')), 403);
  await rejects(FN.waiveInvoice(db, adm, { id: 'x', reason: 'r' }, at('2026-09-10')), 403);
  await rejects(FN.runAutoBlock(db, adm, {}, at('2026-09-10')), 403);
});

/* ------------------------------------------------------------------ the guards */

async function issued(over = {}, now = '2026-09-10') {
  const db = bookDb(billBook(over));
  await FN.issueInvoices(db, mgr(), {}, at(now));
  return db;
}
const vendor1 = db => db._dump('vendors').find(v => v.id === 'V1');

test('with automatic blocking OFF, nobody is blocked however overdue they are', async () => {
  const db = await issued();
  const r = await FN.runAutoBlock(db, mgr(), {}, at('2027-01-01'));
  assert.equal(r.enabled, false);
  assert.equal(r.blocked, 0);
  assert.equal(vendor1(db).restricted, false, 'the till still works');
  assert.ok(r.would_block.length >= 1, 'but it says who WOULD be blocked, so the owner can look before switching it on');
});

test('inside the grace period nobody is blocked', async () => {
  const db = await issued({ autoBlockEnabled: 'Yes', invoiceGraceDays: '7' });
  const inv = db._dump('invoices')[0];
  const dayAfterPeriod = new Date(inv.period_end).getTime() + 24 * 3600 * 1000;
  const r = await FN.runAutoBlock(db, mgr(), {}, dayAfterPeriod);
  assert.equal(r.blocked, 0, 'one day past the period is still inside the seven-day grace');
  assert.equal(vendor1(db).restricted, false);
});

test('grace is counted from the END OF THE PERIOD, so a late run cannot shorten it', async () => {
  const db = await issued({ autoBlockEnabled: 'Yes', invoiceGraceDays: '7' });
  const inv = db._dump('invoices')[0];
  const end = new Date(inv.period_end).getTime();
  assert.ok(dueAt(inv, 7) >= end + 6 * 24 * 3600 * 1000, 'due date is about a week after the period ends');
  assert.ok(dueAt(inv, 0) >= end, 'zero grace still never lands before the period is over');
});

test('a small balance never locks a till', async () => {
  /* A shop losing a day's trade over 300 shillings is a customer lost for good. */
  const db = await issued({ autoBlockEnabled: 'Yes', minInvoiceAmount: '1000' });
  for (const inv of db._dump('invoices')) { inv.due = 300; inv.amount_paid = 0; }
  const r = await FN.runAutoBlock(db, mgr(), {}, at('2027-01-01'));
  assert.equal(r.blocked, 0);
  assert.equal(vendor1(db).restricted, false);
});

test('a vendor who is past grace, over the minimum and off trial IS blocked', async () => {
  const db = await issued({ autoBlockEnabled: 'Yes' });
  const r = await FN.runAutoBlock(db, mgr(), { max: 9 }, at('2027-01-01'));
  assert.ok(r.blocked >= 1);
  assert.equal(vendor1(db).restricted, true);
  const inv = db._dump('invoices').find(i => i.vendor_id === 'V1');
  assert.ok(inv.blocked_at, 'and the invoice records when it happened');
});

test('a run that would block everybody blocks NOBODY and says so', async () => {
  /* If a rate was fat-fingered or a period boundary moved, the first symptom is a long list.
     Blocking none of them is recoverable. Blocking twenty shops is not. */
  const db = await issued({ autoBlockEnabled: 'Yes' });
  const invs = db._dump('invoices');
  const base = invs[0];
  for (const vid of ['V2', 'V3']) {
    invs.push({ ...base, id: 'I-' + vid, number: 'INV-' + vid, vendor_id: vid, blocked_at: null });
  }
  const r = await FN.runAutoBlock(db, mgr(), { max: 2 }, at('2027-01-01'));
  assert.equal(r.refused_too_many, true);
  assert.equal(r.blocked, 0, 'not one of them');
  assert.match(r.message, /REFUSED/);
  /* V3 "Locked Shop" is restricted BY HAND in the fixture and must stay that way -- the check
     is that this run blocked nobody new, not that nobody is restricted. */
  for (const id of ['V1', 'V2']) {
    assert.equal(db._dump('vendors').find(v => v.id === id).restricted, false, id + ' still trades');
  }
  assert.equal(db._dump('vendors').find(v => v.id === 'V3').restricted, true, 'and the hand-set one is untouched');
});

/* ------------------------------------------------------------------ getting unblocked */

test('paying in full unblocks the shop in the same breath', async () => {
  const db = await issued({ autoBlockEnabled: 'Yes' });
  await FN.runAutoBlock(db, mgr(), { max: 9 }, at('2027-01-01'));
  assert.equal(vendor1(db).restricted, true);

  const inv = db._dump('invoices').find(i => i.vendor_id === 'V1');
  const r = await FN.recordInvoicePayment(db, mgr(), { id: inv.id, amount: inv.due, method: 'Lipa Number', reference: 'CFJ8K2LM90' }, at('2027-01-02'));
  assert.equal(r.unblocked, true);
  assert.equal(vendor1(db).restricted, false, 'the till is back');
  const after = db._dump('invoices').find(i => i.id === inv.id);
  assert.equal(after.status, 'paid');
  assert.equal(after.paid_reference, 'CFJ8K2LM90', 'the only trace that the money arrived');
});

test('a payment without a reference is refused, because "they said they paid" is not a record', async () => {
  const db = await issued({ autoBlockEnabled: 'Yes' });
  const inv = db._dump('invoices')[0];
  await rejects(FN.recordInvoicePayment(db, mgr(), { id: inv.id, amount: 100, method: 'Cash', reference: '' }, at('2027-01-02')), 400, /reference/i);
  await rejects(FN.recordInvoicePayment(db, mgr(), { id: inv.id, amount: 0, method: 'Cash', reference: 'x' }, at('2027-01-02')), 400, /amount/i);
});

test('a part payment leaves the balance owing and the shop blocked', async () => {
  const db = await issued({ autoBlockEnabled: 'Yes' });
  await FN.runAutoBlock(db, mgr(), { max: 9 }, at('2027-01-01'));
  const inv = db._dump('invoices').find(i => i.vendor_id === 'V1');
  const r = await FN.recordInvoicePayment(db, mgr(), { id: inv.id, amount: 1, method: 'Cash', reference: 'PART1' }, at('2027-01-02'));
  assert.equal(r.unblocked, false);
  assert.equal(vendor1(db).restricted, true);
  assert.equal(db._dump('invoices').find(i => i.id === inv.id).status, 'part_paid');
});

test('waiving releases the shop too, and keeps the reason', async () => {
  const db = await issued({ autoBlockEnabled: 'Yes' });
  await FN.runAutoBlock(db, mgr(), { max: 9 }, at('2027-01-01'));
  const inv = db._dump('invoices').find(i => i.vendor_id === 'V1');
  const r = await FN.waiveInvoice(db, mgr(), { id: inv.id, reason: 'paid me in cash last week, my mistake' }, at('2027-01-02'));
  assert.equal(r.unblocked, true);
  assert.equal(vendor1(db).restricted, false);
  const after = db._dump('invoices').find(i => i.id === inv.id);
  assert.equal(after.status, 'waived');
  assert.match(after.waived_reason, /cash last week/);
});

test('turning the feature OFF releases the people it blocked, rather than stranding them', async () => {
  const db = await issued({ autoBlockEnabled: 'Yes' });
  await FN.runAutoBlock(db, mgr(), { max: 9 }, at('2027-01-01'));
  assert.equal(vendor1(db).restricted, true);
  for (const i of db._dump('invoices')) i.status = 'paid';
  db._dump('settings').find(s => s.key === 'autoBlockEnabled').value = 'No';
  const r = await FN.runAutoBlock(db, mgr(), {}, at('2027-01-03'));
  assert.ok(r.unblocked >= 1, 'everybody this system blocked is released');
  assert.equal(vendor1(db).restricted, false);
  assert.equal(db._dump('vendors').find(v => v.id === 'V3').restricted, true,
    'but not the vendor a human restricted by hand -- billing does not overrule a decision it knows nothing about');
});

test('a vendor restricted BY HAND is never quietly unblocked by the billing run', async () => {
  /* Somebody restricted that shop for a reason of their own. Billing does not get to overrule
     a human decision it knows nothing about. */
  const db = bookDb(billBook());
  const v = vendor1(db); v.restricted = true;
  const r = await FN.runAutoBlock(db, mgr(), {}, at('2027-01-01'));
  assert.equal(r.unblocked, 0);
  assert.equal(vendor1(db).restricted, true, 'left exactly as the human set it');
});

/* ------------------------------------------------------------------ before the migration */

test('with no invoices table, nothing crashes and every screen says why', async () => {
  const db = bookDb(billBook(), { missingTables: ['invoices'] });
  const list = await FN.invoices(db, mgr(), {}, at('2026-09-10'));
  assert.deepEqual(list.rows, []);
  assert.equal(list.missing_table, true);
  assert.match(list.notice, /RUN-ME-004/);

  const block = await FN.runAutoBlock(db, mgr(), {}, at('2027-01-01'));
  assert.equal(block.blocked, 0, 'and above all it blocks NOBODY when it cannot see the invoices');
  assert.equal(block.missing_table, true);
  assert.equal(vendor1(db).restricted, false);

  await rejects(FN.issueInvoices(db, mgr(), {}, at('2026-09-10')), 400, /RUN-ME-004/);
});

test('outstanding never goes negative, so an overpayment is not a credit note', () => {
  assert.equal(outstandingOf({ due: 100, amount_paid: 250 }), 0);
  assert.equal(outstandingOf({ due: 100, amount_paid: 40 }), 60);
});
