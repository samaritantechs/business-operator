import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookDb, richBook, userOf, NOW, MANAGER, ADMIN1, SELLER1, ADMIN2 } from './_book.mjs';
import { FN, WRITES, deps, sendRemindersFor, DEFAULT_LENDING_TEXT } from '../api/_lib/bo/lendings.js';
import { iso } from '../api/_lib/bo/_shared.js';
import { APP_BY } from '../api/_lib/brand.js';

/* Every email the module tries to send lands here instead of at Resend. */
process.env.RESEND_API_KEY = 'test-key';
let sent = [];
deps.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: 'em-' + sent.length }) }; };
const reset = () => { sent = []; };

const BOOK = richBook();                     // users are read off one book; each test opens its own db
const user = id => userOf(BOOK, id);
const status = p => p.then(() => null, e => e.status);
const rowsOf = (db, t) => db._dump(t);
const find = (db, t, id) => rowsOf(db, t).find(r => r.id === id);

test('contract: exactly the six functions, five of them writes', () => {
  assert.deepEqual(Object.keys(FN).sort(), ['deleteLending', 'lendings', 'markLendingReturned', 'recordLending', 'sendLendingReminder', 'sendLendingReminders']);
  assert.deepEqual([...WRITES].sort(), ['deleteLending', 'markLendingReturned', 'recordLending', 'sendLendingReminder', 'sendLendingReminders']);
});

test('lendings: admin sees own vendor, newest first, with items and grand_total', async () => {
  const db = bookDb();
  const { rows } = await FN.lendings(db, user(ADMIN2), {}, NOW);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.id), ['L1', 'L2']);
  const l1 = rows[0];
  assert.deepEqual(Object.keys(l1).sort(), ['borrower_email', 'borrower_name', 'borrower_phone', 'branch_id', 'created_at', 'grand_total', 'id', 'items', 'legacy_id', 'recorded_by_name', 'return_date', 'status', 'vendor_id', 'vendor_name'].sort());
  assert.equal(l1.vendor_name, 'Mama Ntilie Grocery');
  assert.equal(l1.grand_total, 150000);
  assert.deepEqual(l1.items, [{ product_id: 'P6', product_name: 'Wedding Gown', unit_id: null, qty: 1, price: 150000, total: 150000, imei: null }]);
  assert.equal(rows[1].status, 'Returned');
  assert.equal(rows[1].grand_total, 0);
});

test('lendings: status filter, other vendor sees nothing, manager sees all or one', async () => {
  const db = bookDb();
  const active = await FN.lendings(db, user(ADMIN2), { status: 'Active' }, NOW);
  assert.deepEqual(active.rows.map(r => r.id), ['L1']);
  const returned = await FN.lendings(db, user(ADMIN2), { status: 'Returned' }, NOW);
  assert.deepEqual(returned.rows.map(r => r.id), ['L2']);
  assert.equal((await FN.lendings(db, user(ADMIN1), { status: 'ALL' }, NOW)).rows.length, 0);
  // A seller sees the vendor's lendings too; a manager may ask for one vendor or every vendor.
  assert.equal((await FN.lendings(db, user('SEL3'), {}, NOW)).rows.length, 2);
  assert.equal((await FN.lendings(db, user(MANAGER), {}, NOW)).rows.length, 2);
  assert.equal((await FN.lendings(db, user(MANAGER), { vendor_id: 'ALL' }, NOW)).rows.length, 2);
  assert.equal((await FN.lendings(db, user(MANAGER), { vendor_id: 'V1' }, NOW)).rows.length, 0);
  // Even a vendor_id sent by an admin is ignored: pinned to their own.
  assert.equal((await FN.lendings(db, user(ADMIN1), { vendor_id: 'V2' }, NOW)).rows.length, 0);
});

test('recordLending: a plain product leaves stock, the branch count and writes a lent movement', async () => {
  const db = bookDb(); reset();
  const out = await FN.recordLending(db, user(SELLER1), {
    items: [{ product_id: 'P3', qty: 5, price: 5000 }], borrower_name: 'Mzee Ali', borrower_email: 'ali@example.com', borrower_phone: '0700',
  }, NOW);
  assert.equal(out.message, 'Lending recorded for Mzee Ali. Items: 1. Total owed: 25,000 TZS.');
  const head = find(db, 'lendings', out.lending_id);
  assert.match(head.legacy_id, /^LEND-[0-9A-F]{8}$/);
  assert.equal(head.vendor_id, 'V1');
  assert.equal(head.branch_id, 'B1');                       // the seller's own branch
  assert.equal(head.status, 'Active');
  assert.equal(head.recorded_by, 'SEL1');
  assert.equal(head.recorded_by_name, 'Juma Seller');
  assert.equal(head.created_at, iso(NOW));
  const items = rowsOf(db, 'lending_items').filter(i => i.lending_id === out.lending_id);
  assert.equal(items.length, 1);
  assert.deepEqual({ ...items[0], id: undefined }, { id: undefined, lending_id: out.lending_id, product_id: 'P3', product_name: 'Phone Cover', unit_id: null, qty: 5, price: 5000, total: 25000 });
  assert.equal(find(db, 'products', 'P3').stock, 35);
  assert.equal(rowsOf(db, 'branch_stock').find(b => b.product_id === 'P3' && b.branch_id === 'B1').qty, 20);
  const mv = rowsOf(db, 'stock_movements').filter(m => m.reference_lending_id === out.lending_id);
  assert.equal(mv.length, 1);
  assert.equal(mv[0].type, 'lent');
  assert.equal(mv[0].qty, 5);
  assert.equal(mv[0].from_branch_id, 'B1');
  assert.equal(mv[0].by_user, 'SEL1');
  // The borrower got the confirmation.
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['ali@example.com']);
  assert.equal(sent[0].subject, '📋 Lending Confirmation – Fromville Phones');
  assert.ok(sent[0].html.includes('Mzee Ali') && sent[0].html.includes('5× Phone Cover (5,000 each)') && sent[0].html.includes('25,000 TZS'));
});

test('recordLending: a serialized product goes out unit by unit', async () => {
  const db = bookDb(); reset();
  const out = await FN.recordLending(db, user(ADMIN1), {
    items: [{ product_id: 'P1', qty: 2, unit_ids: ['U1', 'U2'] }], borrower_name: 'Repair Shop',
  }, NOW);
  assert.equal(out.message, 'Lending recorded for Repair Shop. Items: 1.');   // price 0 => no total
  assert.equal(find(db, 'product_units', 'U1').status, 'lent');
  assert.equal(find(db, 'product_units', 'U2').status, 'lent');
  assert.equal(find(db, 'product_units', 'U1').branch_id, 'B1');           // still sits at its branch
  assert.equal(find(db, 'products', 'P1').stock, 1);                       // U3 is the one left
  const items = rowsOf(db, 'lending_items').filter(i => i.lending_id === out.lending_id);
  assert.deepEqual(items.map(i => [i.unit_id, i.qty, i.total]), [['U1', 1, 0], ['U2', 1, 0]]);
  const mv = rowsOf(db, 'stock_movements').filter(m => m.reference_lending_id === out.lending_id);
  assert.deepEqual(mv.map(m => [m.type, m.unit_id, m.imei, m.from_branch_id]), [['lent', 'U1', '350000000000001', 'B1'], ['lent', 'U2', '350000000000002', 'B1']]);
  assert.equal(sent.length, 0);                                            // no email, no mail
  // The listing shows the IMEI on each unit line.
  const { rows } = await FN.lendings(db, user(ADMIN1), { status: 'Active' }, NOW);
  assert.deepEqual(rows[0].items.map(i => i.imei), ['350000000000001', '350000000000002']);
});

test('recordLending: bad lines are refused before anything is written', async () => {
  const db = bookDb(); reset();
  const before = () => [rowsOf(db, 'lendings').length, rowsOf(db, 'lending_items').length, rowsOf(db, 'stock_movements').length,
    find(db, 'products', 'P3').stock, find(db, 'products', 'P1').stock, find(db, 'product_units', 'U1').status];
  const snap = before();
  const call = args => FN.recordLending(db, user(ADMIN1), { borrower_name: 'X', ...args }, NOW);
  // qty and unit_ids disagree
  assert.equal(await status(call({ items: [{ product_id: 'P1', qty: 2, unit_ids: ['U1'] }] })), 400);
  // insufficient stock, legacy wording
  await assert.rejects(call({ items: [{ product_id: 'P3', qty: 41 }] }), { status: 400, message: 'Insufficient stock for "Phone Cover". Available: 40' });
  // the same product twice adds up
  assert.equal(await status(call({ items: [{ product_id: 'P3', qty: 30 }, { product_id: 'P3', qty: 11 }] })), 400);
  // a good first line does not survive a bad second one
  assert.equal(await status(call({ items: [{ product_id: 'P3', qty: 1 }, { product_id: 'P1', qty: 1, unit_ids: ['U4'] }] })), 400);   // U4 is sold
  assert.equal(await status(call({ items: [{ product_id: 'P3', qty: 0 }] })), 400);
  assert.equal(await status(call({ items: [{ product_id: 'P3', qty: 1, price: -5 }] })), 400);
  assert.equal(await status(call({ items: [{ product_id: 'P5', qty: 1 }] })), 404);          // another vendor's product
  assert.equal(await status(call({ items: [{ product_id: 'P4', qty: 1 }] })), 400);          // inactive
  assert.equal(await status(call({ items: [] })), 400);
  assert.equal(await status(call({ items: [{ product_id: 'P3', qty: 1 }], borrower_name: '' })), 400);
  assert.equal(await status(call({ items: [{ product_id: 'P3', qty: 1 }], branch_id: 'B9' })), 404);
  assert.deepEqual(before(), snap);
  assert.equal(sent.length, 0);
  // A manager has no shop to lend from.
  assert.equal(await status(FN.recordLending(db, user(MANAGER), { items: [{ product_id: 'P3', qty: 1 }], borrower_name: 'X' }, NOW)), 403);
});

test('markLendingReturned: stock comes back with a returned movement, borrower is told', async () => {
  const db = bookDb(); reset();
  const out = await FN.markLendingReturned(db, user(ADMIN2), { lending_id: 'L1' }, NOW);
  assert.equal(out.message, 'Marked as returned. Stock restored.');
  const l1 = find(db, 'lendings', 'L1');
  assert.equal(l1.status, 'Returned');
  assert.equal(l1.return_date, iso(NOW));
  assert.equal(find(db, 'products', 'P6').stock, 2);
  const mv = rowsOf(db, 'stock_movements').filter(m => m.reference_lending_id === 'L1');
  assert.deepEqual(mv.map(m => [m.type, m.qty, m.product_id, m.by_user]), [['returned', 1, 'P6', 'ADM2']]);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['halima@example.com']);
  assert.equal(sent[0].subject, '✅ Return Confirmed – Mama Ntilie Grocery');
  assert.ok(sent[0].html.includes('Bibi Halima'));
  // Twice is refused.
  await assert.rejects(FN.markLendingReturned(db, user(ADMIN2), { lending_id: 'L1' }, NOW), { status: 400 });
  assert.equal(find(db, 'products', 'P6').stock, 2);
});

test('markLendingReturned: refuses another vendor, a seller, and a returned lending; manager may', async () => {
  const db = bookDb(); reset();
  assert.equal(await status(FN.markLendingReturned(db, user(ADMIN1), { lending_id: 'L1' }, NOW)), 403);
  assert.equal(await status(FN.markLendingReturned(db, user('SEL3'), { lending_id: 'L1' }, NOW)), 403);
  assert.equal(await status(FN.markLendingReturned(db, user(ADMIN2), { lending_id: 'L2' }, NOW)), 400);
  assert.equal(await status(FN.markLendingReturned(db, user(ADMIN2), { lending_id: 'L9' }, NOW)), 404);
  assert.equal(find(db, 'lendings', 'L1').status, 'Active');
  await FN.markLendingReturned(db, user(MANAGER), { lending_id: 'L1' }, NOW);
  assert.equal(find(db, 'lendings', 'L1').status, 'Returned');
});

test('markLendingReturned: units go back to in_stock at their branch and the count follows', async () => {
  const db = bookDb(); reset();
  const { lending_id } = await FN.recordLending(db, user(SELLER1), { items: [{ product_id: 'P1', qty: 1, unit_ids: ['U2'] }, { product_id: 'P3', qty: 4, price: 5000 }], borrower_name: 'Tech' }, NOW);
  assert.equal(find(db, 'products', 'P1').stock, 2);
  assert.equal(find(db, 'products', 'P3').stock, 36);
  await FN.markLendingReturned(db, user(ADMIN1), { lending_id }, NOW + 3600000);
  assert.equal(find(db, 'product_units', 'U2').status, 'in_stock');
  assert.equal(find(db, 'product_units', 'U2').branch_id, 'B1');
  assert.equal(find(db, 'products', 'P1').stock, 3);
  assert.equal(find(db, 'products', 'P3').stock, 40);
  assert.equal(rowsOf(db, 'branch_stock').find(b => b.product_id === 'P3' && b.branch_id === 'B1').qty, 25);
  const back = rowsOf(db, 'stock_movements').filter(m => m.reference_lending_id === lending_id && m.type === 'returned');
  assert.deepEqual(back.map(m => [m.unit_id, m.qty, m.to_branch_id]), [['U2', 1, 'B1'], [null, 4, 'B1']]);
  assert.equal(sent.length, 0);
});

test('deleteLending: an active one restores stock, a returned one just goes', async () => {
  const db = bookDb(); reset();
  const a = await FN.deleteLending(db, user(ADMIN2), { lending_id: 'L1' }, NOW);
  assert.equal(a.message, 'Lending deleted. Stock restored.');
  assert.equal(find(db, 'lendings', 'L1'), undefined);
  assert.equal(rowsOf(db, 'lending_items').filter(i => i.lending_id === 'L1').length, 0);
  assert.equal(find(db, 'products', 'P6').stock, 2);
  const mv = rowsOf(db, 'stock_movements').filter(m => m.reference_lending_id === 'L1');
  assert.deepEqual(mv.map(m => [m.type, m.qty, m.note]), [['returned', 1, 'Lending deleted']]);
  const b = await FN.deleteLending(db, user(ADMIN2), { lending_id: 'L2' }, NOW);
  assert.equal(b.message, 'Lending deleted. (Was already returned.)');
  assert.equal(find(db, 'lendings', 'L2'), undefined);
  assert.equal(find(db, 'products', 'P5').stock, 8);
  assert.equal(rowsOf(db, 'stock_movements').filter(m => m.reference_lending_id === 'L2').length, 0);
  assert.equal(sent.length, 0);
  // Guards.
  const db2 = bookDb();
  assert.equal(await status(FN.deleteLending(db2, user(ADMIN1), { lending_id: 'L1' }, NOW)), 403);
  assert.equal(await status(FN.deleteLending(db2, user('SEL3'), { lending_id: 'L1' }, NOW)), 403);
  assert.equal(await status(FN.deleteLending(db2, user(ADMIN2), { lending_id: 'nope' }, NOW)), 404);
  assert.ok(find(db2, 'lendings', 'L1'));
});

test('sendLendingReminder: the default template with every placeholder filled', async () => {
  const db = bookDb(); reset();
  const out = await FN.sendLendingReminder(db, user(ADMIN2), { lending_id: 'L1' }, NOW);
  assert.equal(out.message, 'Reminder sent to halima@example.com');
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.deepEqual(m.to, ['halima@example.com']);
  assert.equal(m.subject, '⏰ Reminder: Borrowed Items – Mama Ntilie Grocery');
  assert.ok(m.html.includes('Dear <strong>Bibi Halima</strong>'));
  assert.ok(m.html.includes('from <strong>Mama Ntilie Grocery</strong>'));
  assert.ok(m.html.includes('<strong>1× Wedding Gown (150,000 each)</strong>'));
  assert.ok(m.html.includes('Total owed: <strong>150,000 TZS</strong>'));
  assert.ok(m.html.includes('Borrowed <strong>5 days</strong> ago'));           // 28 Aug 08:00Z -> 2 Sep 09:00Z
  assert.ok(m.html.includes(APP_BY));           // the signature
  assert.equal(m.html.indexOf('{'), -1);                                       // nothing left unfilled
});

test('sendLendingReminder: the manager\'s own template, singular day, dash for a free lending', async () => {
  const db = bookDb(); reset();
  db._dump('settings').push({ key: 'lendingReminderText', value: 'Hi {borrowerName} - {items} - {total} - {currency} - {days} - {vendor}' });
  const oneDay = Date.parse('2026-08-28T08:00:00.000Z') + 86400000 + 60000;
  await FN.sendLendingReminder(db, user(MANAGER), { lending_id: 'L1' }, oneDay);
  assert.equal(sent[0].html, 'Hi Bibi Halima - 1× Wedding Gown (150,000 each) - 150,000 TZS - TZS - 1 day - Mama Ntilie Grocery' + sent[0].html.slice(sent[0].html.indexOf('<p')));
  // A lending with no price shows a dash for the total.
  reset();
  const { lending_id } = await FN.recordLending(db, user(ADMIN1), { items: [{ product_id: 'P3', qty: 2 }], borrower_name: 'Neighbour', borrower_email: 'n@example.com' }, NOW);
  reset();
  await FN.sendLendingReminder(db, user(ADMIN1), { lending_id }, NOW);
  assert.ok(sent[0].html.startsWith('Hi Neighbour - 2× Phone Cover - — - TZS - 0 days - Fromville Phones'));
});

test('sendLendingReminder: needs an email, an active lending, and the right vendor', async () => {
  const db = bookDb(); reset();
  const { lending_id } = await FN.recordLending(db, user(ADMIN1), { items: [{ product_id: 'P3', qty: 1 }], borrower_name: 'No Mail' }, NOW);
  await assert.rejects(FN.sendLendingReminder(db, user(ADMIN1), { lending_id }, NOW), { status: 400, message: 'Borrower has no email address on record.' });
  assert.equal(await status(FN.sendLendingReminder(db, user(ADMIN2), { lending_id: 'L2' }, NOW)), 400);   // returned
  assert.equal(await status(FN.sendLendingReminder(db, user(ADMIN1), { lending_id: 'L1' }, NOW)), 403);   // not theirs
  assert.equal(await status(FN.sendLendingReminder(db, user('SEL3'), { lending_id: 'L1' }, NOW)), 403);   // seller
  assert.equal(await status(FN.sendLendingReminder(db, user(ADMIN2), { lending_id: 'zz' }, NOW)), 404);
  assert.equal(sent.length, 0);
});

test('sendRemindersFor: counts sends and borrowers without an email, per vendor or all', async () => {
  const db = bookDb(); reset();
  assert.deepEqual(await sendRemindersFor(db, null, NOW, { fetch: deps.fetch }), { sent: 1, no_email: 0 });
  assert.equal(sent.length, 1);
  await FN.recordLending(db, user(SELLER1), { items: [{ product_id: 'P3', qty: 1 }], borrower_name: 'Quiet' }, NOW);
  reset();
  assert.deepEqual(await sendRemindersFor(db, null, NOW, { fetch: deps.fetch }), { sent: 1, no_email: 1 });
  assert.deepEqual(await sendRemindersFor(db, 'V1', NOW, { fetch: deps.fetch }), { sent: 0, no_email: 1 });
  assert.deepEqual(await sendRemindersFor(db, 'V2', NOW, { fetch: deps.fetch }), { sent: 1, no_email: 0 });
  assert.deepEqual(await sendRemindersFor(db, 'V3', NOW, { fetch: deps.fetch }), { sent: 0, no_email: 0 });
  // A provider refusal skips that borrower; a missing key is the honest error.
  reset();
  const refuse = async () => ({ ok: false, status: 422, json: async () => ({ message: 'bad address' }) });
  assert.deepEqual(await sendRemindersFor(db, 'V2', NOW, { fetch: refuse }), { sent: 0, no_email: 0 });
  const key = process.env.RESEND_API_KEY; delete process.env.RESEND_API_KEY;
  try { await assert.rejects(sendRemindersFor(db, 'V2', NOW, { fetch: deps.fetch }), { status: 400 }); }
  finally { process.env.RESEND_API_KEY = key; }
});

test('sendLendingReminders: the legacy sentence, admin pinned to own vendor', async () => {
  const db = bookDb(); reset();
  assert.deepEqual(await FN.sendLendingReminders(db, user(ADMIN2), {}, NOW), { message: 'Sent 1 reminder.' });
  assert.deepEqual(await FN.sendLendingReminders(db, user(ADMIN1), { vendor_id: 'V2' }, NOW), { message: 'Sent 0 reminders.' });
  await FN.recordLending(db, user(SELLER1), { items: [{ product_id: 'P3', qty: 1 }], borrower_name: 'A' }, NOW);
  await FN.recordLending(db, user(SELLER1), { items: [{ product_id: 'P3', qty: 1 }], borrower_name: 'B' }, NOW);
  assert.deepEqual(await FN.sendLendingReminders(db, user(MANAGER), {}, NOW), { message: 'Sent 1 reminder. 2 borrowers had no email.' });
  assert.deepEqual(await FN.sendLendingReminders(db, user(MANAGER), { vendor_id: 'V1' }, NOW), { message: 'Sent 0 reminders. 2 borrowers had no email.' });
  assert.equal(await status(FN.sendLendingReminders(db, user(SELLER1), {}, NOW)), 403);
  assert.ok(DEFAULT_LENDING_TEXT.includes('{borrowerName}'));
});

/* The bug this guards: the status flip was written as a conditional update but its result was
   never looked at, so two admins clicking the tick together -- or one double-tapping it on a
   slow connection -- both went on to restore, and a borrowed item came back twice. */
test('markLendingReturned / deleteLending: the second caller restores nothing', async () => {
  const db = bookDb();
  const gown = () => db._dump('products').find(p => p.id === 'P6').stock;
  const before = gown();
  const both = await Promise.allSettled([
    FN.markLendingReturned(db, user(ADMIN2), { lending_id: 'L1' }, NOW),
    FN.markLendingReturned(db, user(ADMIN2), { lending_id: 'L1' }, NOW),
  ]);
  const ok = both.filter(r => r.status === 'fulfilled');
  const no = both.filter(r => r.status === 'rejected');
  assert.equal(ok.length, 1, 'exactly one caller may return a lending');
  assert.equal(no.length, 1);
  assert.equal(no[0].reason.status, 400);
  assert.match(no[0].reason.message, /already returned/);
  assert.equal(gown(), before + 1, 'the gown came back once, not twice');
  assert.equal(db._dump('stock_movements').filter(m => m.type === 'returned' && m.product_id === 'P6').length, 1);

  // And the same race on delete: both delete, only one restores.
  const db2 = bookDb();
  const g2 = () => db2._dump('products').find(p => p.id === 'P6').stock;
  const start = g2();
  const races = await Promise.allSettled([
    FN.deleteLending(db2, user(ADMIN2), { lending_id: 'L1' }, NOW),
    FN.deleteLending(db2, user(ADMIN2), { lending_id: 'L1' }, NOW),
  ]);
  assert.equal(races.filter(r => r.status === 'fulfilled').length, 2, 'deleting twice is not an error');
  assert.equal(races.filter(r => r.status === 'fulfilled' && /Stock restored/.test(r.value.message)).length, 1,
    'but only one of them restored the stock');
  assert.equal(g2(), start + 1);
  assert.equal(db2._dump('lendings').filter(x => x.id === 'L1').length, 0);
});
