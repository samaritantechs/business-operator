/* THE EMAIL CENTER: what goes out, to whom, and what is counted. Resend is a stub that records
   every body; nothing leaves the process. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { richBook, bookDb, userOf, NOW } from './_book.mjs';

const { FN, deps } = await import('../api/_lib/bo/emails.js');
const lend = await import('../api/_lib/bo/lendings.js');

const MGR = () => userOf(richBook(), 'MGR');
const ADM = () => userOf(richBook(), 'ADM1');

function stub() {
  const sent = [];
  const f = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ id: 'm' + sent.length }) }; };
  deps.fetch = f; lend.deps.fetch = f;
  process.env.RESEND_API_KEY = 'test-key';
  process.env.MANAGER_EMAIL = 'boss@samaritan.test';
  return sent;
}
function unstub() { deps.fetch = null; lend.deps.fetch = null; delete process.env.RESEND_API_KEY; }

test('daily reports: every admin who wants one gets the PDF; sellers only when the vendor says so', async () => {
  const book = richBook();
  book.vendors[1].permissions = { adminReceivesDaily: true, sellerReceivesEmail: true, sellerReceivesDaily: true };
  const db = bookDb(book);
  const sent = stub();
  try {
    const r = await FN.emailDaily(db, MGR(), {}, NOW);
    assert.equal(r.admins, 3);                              // V1, V2 and V3's admins all default to daily
    assert.equal(r.sellers, 1);                             // V2's Pili
    const frank = sent.find(m => m.to.includes('frank@fromville.tz'));
    assert.ok(frank, 'Frank got his report');
    assert.match(frank.subject, /Daily Sales Report – Fromville Phones/);
    assert.ok(frank.attachments && frank.attachments[0].filename.endsWith('.pdf'));
    assert.ok(Buffer.from(frank.attachments[0].content, 'base64').slice(0, 4).toString() === '%PDF');
    const pili = sent.find(m => m.to.includes('pili@ntilie.tz'));
    assert.match(pili.html, /6,400 TZS/);
    assert.ok(!sent.some(m => m.to.includes('juma@fromville.tz')), 'V1 sellers are not on the daily list');
    assert.match(r.message, /3 admin\(s\), 1 seller\(s\)/);
  } finally { unstub(); }
});

test('weekly and monthly go only to the vendors flagged for them', async () => {
  const book = richBook();
  book.vendors[0].permissions = { adminReceivesWeekly: true };
  book.vendors[1].permissions = { adminReceivesMonthly: true };
  const db = bookDb(book);
  const sent = stub();
  try {
    const w = await FN.emailWeekly(db, MGR(), {}, NOW);
    assert.equal(w.admins, 1);
    assert.match(sent[0].subject, /Weekly Sales Report – Fromville Phones/);
    const m = await FN.emailMonthly(db, MGR(), {}, NOW);
    assert.equal(m.admins, 1);
    assert.match(sent[1].subject, /Monthly Sales Report – Mama Ntilie Grocery/);
  } finally { unstub(); }
});

test('commission invoices: only past the trial, only when something is owed, manager in bcc', async () => {
  const db = bookDb();
  const sent = stub();
  try {
    const r = await FN.emailCommission(db, MGR(), {}, NOW);
    assert.equal(r.sent, 1);                                // V2 (trial ended, sales this cycle); V1 still on trial; V3 no sales
    assert.equal(sent[0].to[0], 'mama@ntilie.tz');
    assert.deepEqual(sent[0].bcc, ['boss@samaritan.test']);
    assert.match(sent[0].html, /2%/);
    assert.match(sent[0].html, /128 TZS/);                  // 2% of 6,400
    const off = bookDb(Object.assign(richBook(), { settings: [{ key: 'commissionRate', value: '0' }] }));
    assert.equal((await FN.emailCommission(off, MGR(), {}, NOW)).sent, 0);
  } finally { unstub(); }
});

test('payment reminders reach every restricted vendor with an admin email', async () => {
  const db = bookDb();
  const sent = stub();
  try {
    const r = await FN.emailPaymentReminders(db, MGR(), {}, NOW);
    assert.equal(r.sent, 1);
    assert.equal(sent[0].to[0], 'locked@shop.tz');
    assert.match(sent[0].subject, /Payment Required – Locked Shop/);
    assert.match(sent[0].html, /restricted/i);
    assert.match(r.message, /Sent 1 payment reminder/);
  } finally { unstub(); }
});

test('lending reminders and the manager summary', async () => {
  const db = bookDb();
  const sent = stub();
  try {
    const l = await FN.emailLendingReminders(db, MGR(), {}, NOW);
    assert.equal(l.sent, 1);                                // Bibi Halima has an email
    assert.match(sent[0].subject, /Reminder: Borrowed Items – Mama Ntilie Grocery/);
    const s = await FN.emailManagerSummary(db, MGR(), {}, NOW);
    assert.equal(s.sent, 1);
    const sum = sent[sent.length - 1];
    assert.equal(sum.to[0], 'boss@samaritan.test');
    assert.match(sum.html, /Fromville Phones/);
    assert.match(sum.html, /355,000 TZS/);
  } finally { unstub(); }
});

test('an unconfigured mailbox is said out loud, and only a manager may send', async () => {
  const db = bookDb();
  unstub();
  await assert.rejects(FN.emailManagerSummary(db, MGR(), {}, NOW), e => e.status === 400 && /RESEND_API_KEY/.test(e.message));
  await assert.rejects(FN.emailDaily(db, ADM(), {}, NOW), e => e.status === 403);
});
