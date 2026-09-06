/* THE BILLING CYCLE, AND WHAT A VENDOR IS CHARGED FOR IT.
 * =====================================================================================
 * The commission is Samaritan Techs' whole revenue, and until now not one line of it was
 * tested. Two of the three bugs below were found by running the function and reading what it
 * said, not by reasoning about it.
 *
 * An invoice is a document a business keeps and argues with. Every property asserted here is
 * one somebody could dispute: which days it covers, which sales fall inside it, and whether
 * asking the same question next month gives the same answer. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './_env.mjs';
import { cyclePeriodStart, cyclePeriod, commissionDue, todayKey } from '../api/_lib/bo/_shared.js';
import { bookDb, richBook } from './_book.mjs';

const at = s => new Date(s + 'T12:00:00.000Z').getTime();
/* COMPARED IN EAST AFRICA TIME, because that is what the period is now expressed in and what
   every report the vendor checks it against uses. Comparing the UTC face of the instant would
   read EAT midnight as the previous day and quietly assert the wrong thing. */
const day = d => todayKey(new Date(d).getTime());

test('a vendor registered on the 31st keeps the 31st, and is clamped only where the month is short', () => {
  /* THE BUG, verbatim from running the old code with anchor 2026-01-31:
       on 2026-03-15 the period starts 2026-03-03      <- three days into March
       on 2026-04-15 the period starts 2026-04-03
       on 2026-05-15 the period starts 2026-05-03      ... and the 3rd, forever after.
     Date.UTC(y, m + 1, 31) rolls February's overflow into March and the anchor day is destroyed
     permanently -- every future period inherits the corrupted date, so the vendor is billed on
     a day that has nothing to do with when they joined. A shop registered on the 30th lands on
     the 2nd. Nobody would ever have reported this as "billing is wrong on the 3rd of March";
     they would have said the invoice looked odd and given up. */
  const anchor = '2026-01-31T09:00:00.000Z';
  assert.equal(day(cyclePeriodStart(anchor, at('2026-02-15'))), '2026-01-31');
  assert.equal(day(cyclePeriodStart(anchor, at('2026-03-15'))), '2026-02-28', 'February is short, so it clamps');
  assert.equal(day(cyclePeriodStart(anchor, at('2026-04-15'))), '2026-03-31', 'and March gets the 31st BACK');
  assert.equal(day(cyclePeriodStart(anchor, at('2026-05-15'))), '2026-04-30', 'April has thirty days');
  assert.equal(day(cyclePeriodStart(anchor, at('2026-06-15'))), '2026-05-31', 'May gets it back again');
});

test('a vendor registered on the 30th is not dragged to the 2nd either', () => {
  const anchor = '2026-01-30T09:00:00.000Z';
  assert.equal(day(cyclePeriodStart(anchor, at('2026-03-15'))), '2026-02-28');
  assert.equal(day(cyclePeriodStart(anchor, at('2026-04-15'))), '2026-03-30');
});

test('an ordinary day in the month is untouched by the clamp', () => {
  const anchor = '2026-01-14T09:00:00.000Z';
  for (const [now, want] of [['2026-02-20', '2026-02-14'], ['2026-03-20', '2026-03-14'], ['2026-12-20', '2026-12-14']]) {
    assert.equal(day(cyclePeriodStart(anchor, at(now))), want, 'on ' + now);
  }
});

test('a period has an END, because an invoice cannot say "everything since"', () => {
  /* commissionDue read `.gte(cycle_start)` and nothing else. For the banner that says what you
     owe right now, that is correct. For an invoice it is not a period at all -- and the same
     invoice re-rendered a week later would carry a bigger number, which is the one thing a
     document a business keeps must never do. */
  const p = cyclePeriod('2026-01-14T09:00:00.000Z', at('2026-03-20'));
  assert.equal(day(p.start), '2026-03-14');
  assert.equal(day(p.end), '2026-04-14', 'the end is the next period start');
  assert.ok(p.end > p.start);
});

test('the period is half-open, so a sale is billed once and never twice', () => {
  const p1 = cyclePeriod('2026-01-14T09:00:00.000Z', at('2026-02-20'));
  const p2 = cyclePeriod('2026-01-14T09:00:00.000Z', at('2026-03-20'));
  assert.equal(p1.end.toISOString(), p2.start.toISOString(),
    'one period ends exactly where the next begins -- no gap to lose a sale in, no overlap to bill it twice');
});

test('commissionDue charges only the sales inside the period', async () => {
  const book = richBook();
  const v = book.vendors.find(x => x.id === 'V1');
  v.registered_on = '2026-08-02T06:00:00.000Z';
  const db = bookDb(book);
  /* The fixture's V1 sales sit on 2026-09-02 (in period) and 2026-08-30 and 2026-07-15 (both
     in EARLIER periods). With no upper bound the July sale was billed again every month. */
  const r = await commissionDue(db, v, { commissionRate: '0.6' }, at('2026-09-10'));
  assert.equal(day(r.period_start), '2026-09-02');
  assert.equal(day(r.period_end), '2026-10-02');
  assert.equal(r.rate, 0.6);
  assert.ok(r.total > 0, 'the September sales are in it');
  assert.equal(r.due, Math.round(r.total * 0.6 / 100 * 100) / 100);

  const july = await commissionDue(db, v, { commissionRate: '0.6' }, at('2026-07-20'));
  assert.ok(july.total < r.total, 'an earlier period is its own, smaller, number');
});

test('asking twice for a period that has closed gives the same answer twice', async () => {
  const book = richBook();
  const v = book.vendors.find(x => x.id === 'V1');
  v.registered_on = '2026-08-02T06:00:00.000Z';
  const db = bookDb(book);
  const a = await commissionDue(db, v, { commissionRate: '0.6' }, at('2026-09-10'));
  const b = await commissionDue(db, v, { commissionRate: '0.6' }, at('2026-09-28'));
  assert.equal(a.total, b.total, 'the same closed period, the same figure -- an invoice that changes is not an invoice');
  assert.equal(a.due, b.due);
});

test('a zero rate bills nothing, and never a negative', async () => {
  const db = bookDb(richBook());
  const v = richBook().vendors.find(x => x.id === 'V1');
  const r = await commissionDue(db, v, { commissionRate: '0' }, at('2026-09-10'));
  assert.equal(r.due, 0);
  const bad = await commissionDue(db, v, { commissionRate: 'nonsense' }, at('2026-09-10'));
  assert.equal(bad.due, 0, 'an unreadable rate charges nothing rather than NaN');
});

test('the invoice number matches the period printed under it, and is stable', async () => {
  /* Derived from the vendor and the period rather than a counter, so re-issuing the same period
     yields the SAME number -- a second invoice for money already owed once is how a shop ends up
     paying twice, or refusing to pay at all. */
  const { commissionInvoice } = await import('../api/_lib/bo/_shared.js');
  const book = richBook();
  const v = book.vendors.find(x => x.id === 'V1');
  v.registered_on = '2026-08-02T06:00:00.000Z';
  const db = bookDb(book);
  const a = await commissionInvoice(db, v, { commissionRate: '0.6' }, at('2026-09-10'));
  const b = await commissionInvoice(db, v, { commissionRate: '0.6' }, at('2026-09-27'));

  assert.equal(a.period_start, '2026-09-02', 'the period starts on the day they registered');
  assert.equal(a.period_end, '2026-10-01', 'and is shown inclusive, so a person can read it');
  assert.equal(a.number, 'INV-FROMVI-20260902', 'the number carries the period start, in EAT');
  assert.equal(a.number, b.number, 'the same period is the same invoice, asked twice');
  assert.equal(a.due, b.due);
  assert.equal(a.due, Math.round(a.sales_total * 0.6) / 100);
});
