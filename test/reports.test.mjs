/* EVERY REPORT, AGAINST THE FIXTURE'S KNOWN DAY -- and the files they become. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { richBook, bookDb, userOf, NOW, TODAY } from './_book.mjs';

const { FN, reportFile, REPORT_TYPES } = await import('../api/_lib/bo/reports.js');
const { readTicket } = await import('../api/_lib/auth.js');

const ADM = () => userOf(richBook(), 'ADM1');
const SEL = () => userOf(richBook(), 'SEL1');
const SEL3 = () => userOf(richBook(), 'SEL3');           // V2: sellers may not download
const ADM2 = () => userOf(richBook(), 'ADM2');
const MGR = () => userOf(richBook(), 'MGR');
const D = { start: TODAY, end: TODAY };
const colKey = (r, re) => { const c = r.columns.find(x => re.test(x.label)); assert.ok(c, 'column ' + re + ' in ' + r.columns.map(x => x.label).join('|')); return c.key; };
const totalOf = (r, re) => { const t = (r.totals || []).find(x => re.test(x[0])); assert.ok(t, 'total ' + re + ' in ' + JSON.stringify(r.totals)); return t[1]; };
async function rejects(p, status) { await assert.rejects(p, e => { assert.equal(e.status, status, e.message); return true; }); }

test('the shape every report shares, and the type list', async () => {
  const db = bookDb();
  for (const type of Object.keys(REPORT_TYPES)) {
    const r = await FN.reportData(db, MGR(), { type, ...D }, NOW);
    assert.ok(r.title && Array.isArray(r.columns) && Array.isArray(r.rows) && Array.isArray(r.totals) && r.currency, type + ' shape');
    assert.ok(r.columns.every(c => c.key && c.label), type + ' columns');
  }
  await rejects(FN.reportData(db, ADM(), { type: 'nonsense', ...D }, NOW), 400);
});

test('sales: today for Fromville is three completed lines, cancelled excluded, discount and IMEI shown', async () => {
  const db = bookDb();
  const r = await FN.reportData(db, ADM(), { type: 'sales', ...D }, NOW);
  assert.match(r.title, /Fromville Phones/);
  assert.equal(r.rows.length, 3);
  assert.equal(r.currency, 'TZS');
  const total = colKey(r, /^total$/i), imei = colKey(r, /imei/i), disc = colKey(r, /discount/i);
  assert.equal(r.rows.reduce((a, x) => a + Number(x[total] || 0), 0), 355000);
  assert.ok(r.rows.some(x => String(x[imei]) === '350000000000004' && Number(x[disc]) === 10000));
  assert.match(String(totalOf(r, /grand total/i)), /355,000/);
  const b2 = await FN.reportData(db, ADM(), { type: 'sales', ...D, branch_id: 'B2' }, NOW);
  assert.equal(b2.rows.length, 1);
  const yr = await FN.reportData(db, ADM(), { type: 'sales', start: '2026-01-01', end: TODAY }, NOW);
  assert.equal(yr.rows.length, 5);
  await rejects(FN.reportData(db, ADM(), { type: 'sales', start: TODAY, end: '2026-01-01' }, NOW), 400);
});

test('a seller gets only their own sales report, and only when the vendor allows it', async () => {
  const db = bookDb();
  const r = await FN.reportData(db, SEL(), { type: 'sales', ...D }, NOW);
  const seller = colKey(r, /seller/i);
  assert.equal(r.rows.length, 2);
  assert.ok(r.rows.every(x => x[seller] === 'Juma Seller'));
  await rejects(FN.reportData(db, SEL(), { type: 'stock' }, NOW), 403);
  await rejects(FN.reportData(db, SEL3(), { type: 'sales', ...D }, NOW), 403);
  await rejects(FN.reportData(db, ADM(), { type: 'commission', ...D }, NOW), 403);
});

test('stock, cash due, lending, commission: the legacy four', async () => {
  const db = bookDb();
  const stock = await FN.reportData(db, ADM(), { type: 'stock' }, NOW);
  assert.equal(stock.rows.length, 3);
  const status = colKey(stock, /status/i);
  assert.deepEqual(stock.rows.map(x => x[status]), ['OK', 'OK', 'OK']);
  assert.match(String(totalOf(stock, /total/i)), /1,810,000/);

  const cash = await FN.reportData(db, ADM(), { type: 'cashdue' }, NOW);
  const sellerCol = colKey(cash, /seller/i), bal = colKey(cash, /balance/i), rec = colKey(cash, /cash received/i);
  const juma = cash.rows.find(x => /Juma/.test(x[sellerCol]));
  assert.equal(Number(juma[rec]), 6000);
  assert.equal(Number(juma[bal]), 4000);
  assert.ok(!cash.rows.some(x => /Gone/.test(x[sellerCol])));

  const lend = await FN.reportData(db, ADM2(), { type: 'lending', start: '2026-08-01', end: TODAY, status: 'ALL' }, NOW);
  assert.equal(lend.rows.length, 2);
  const active = await FN.reportData(db, ADM2(), { type: 'lending', start: '2026-08-01', end: TODAY, status: 'Active' }, NOW);
  assert.equal(active.rows.length, 1);

  const comm = await FN.reportData(db, MGR(), { type: 'commission', ...D }, NOW);
  const vendor = colKey(comm, /vendor/i), due = colKey(comm, /due/i);
  assert.equal(Number(comm.rows.find(x => /Fromville/.test(x[vendor]))[due]), 7100);
});

test('the phone-retail reports: brand & model, partner, cancelled, employee, branch, payment, movements, units, imei', async () => {
  const db = bookDb();
  const bm = await FN.reportData(db, ADM(), { type: 'brandmodel', ...D }, NOW);
  const brand = colKey(bm, /brand/i), units = colKey(bm, /units/i);
  const sam = bm.rows.find(x => x[brand] === 'Samsung');
  assert.equal(Number(sam[units]), 1);

  const partner = await FN.reportData(db, ADM(), { type: 'partner', ...D }, NOW);
  assert.equal(partner.rows.length, 1);
  const pn = colKey(partner, /partner/i), settled = colKey(partner, /settled|paid/i);
  assert.equal(partner.rows[0][pn], 'MOGO');
  assert.match(String(partner.rows[0][settled]), /No/);
  assert.ok(partner.totals.some(t => /MOGO/.test(t[0])));

  const cancelled = await FN.reportData(db, ADM(), { type: 'cancelled', ...D }, NOW);
  assert.equal(cancelled.rows.length, 1);
  const by = colKey(cancelled, /cancelled by/i), reason = colKey(cancelled, /reason/i);
  assert.equal(cancelled.rows[0][by], 'Frank Amos'); assert.equal(cancelled.rows[0][reason], 'wrong item');

  const emp = await FN.reportData(db, ADM(), { type: 'employee', ...D }, NOW);
  const es = colKey(emp, /seller|employee/i), et = colKey(emp, /sales total|^total/i);
  assert.equal(Number(emp.rows.find(x => /Juma/.test(x[es]))[et]), 350000);
  assert.equal(Number(emp.rows.find(x => /Asha/.test(x[es]))[et]), 5000);

  const br = await FN.reportData(db, ADM(), { type: 'branch', ...D }, NOW);
  const bn = colKey(br, /branch|shop/i), bt = colKey(br, /sales total|^total/i);
  assert.equal(Number(br.rows.find(x => x[bn] === 'Sinza')[bt]), 350000);
  const noShops = await FN.reportData(db, ADM2(), { type: 'branch', ...D }, NOW);
  assert.equal(noShops.rows.length, 1);

  const pay = await FN.reportData(db, ADM(), { type: 'payment', ...D }, NOW);
  const pm = colKey(pay, /payment/i), pt = colKey(pay, /sales total|^total/i);
  assert.equal(Number(pay.rows.find(x => x[pm] === 'Credit')[pt]), 340000);
  assert.equal(Number(pay.rows.find(x => x[pm] === 'Cash')[pt]), 10000);
  assert.equal(Number(pay.rows.find(x => x[pm] === 'Lipa Number')[pt]), 5000);

  const mv = await FN.reportData(db, ADM(), { type: 'movements', start: '2026-08-01', end: TODAY }, NOW);
  assert.equal(mv.rows.length, 2);
  const from = colKey(mv, /^from$/i), typ = colKey(mv, /type/i);
  assert.ok(mv.rows.some(x => x[typ] === 'sold' && x[from] === 'Sinza'));

  const un = await FN.reportData(db, ADM(), { type: 'units' }, NOW);
  assert.equal(un.rows.length, 6);

  const im = await FN.reportData(db, ADM(), { type: 'imei', ...D }, NOW);
  assert.equal(im.rows.length, 1);
});

test('the manager may ask for every vendor at once, in TZS, with a vendor column', async () => {
  const db = bookDb();
  const r = await FN.reportData(db, MGR(), { type: 'sales', ...D }, NOW);
  assert.equal(r.rows.length, 4);                          // V1's three + V2's one
  assert.equal(r.currency, 'TZS');
  colKey(r, /vendor/i);
  const one = await FN.reportData(db, MGR(), { type: 'sales', ...D, vendor_id: 'V2' }, NOW);
  assert.equal(one.rows.length, 1);
  assert.match(one.title, /Mama Ntilie/);
});

test('a ticket names exactly one report, can be read back, and is refused for a report the caller could not open', async () => {
  const db = bookDb();
  const { url } = await FN.reportTicket(db, ADM(), { type: 'sales', ...D, format: 'xlsx' }, NOW);
  assert.match(url, /^\/api\/report\?t=/);
  const payload = readTicket(url.split('t=')[1], NOW + 1000);
  assert.equal(payload.uid, 'ADM1');
  assert.equal(payload.report.type, 'sales');
  assert.equal(payload.report.format, 'xlsx');
  await assert.throws(() => readTicket(url.split('t=')[1], NOW + 6 * 60000), /expired/);
  await rejects(FN.reportTicket(db, SEL(), { type: 'stock' }, NOW), 403);
  await rejects(FN.reportTicket(db, ADM(), { type: 'commission', ...D }, NOW), 403);
});

test('reportFile: a real PDF and a real .xlsx', async () => {
  const db = bookDb();
  const pdf = await reportFile(db, ADM(), { type: 'sales', ...D, format: 'pdf' });
  assert.equal(pdf.contentType, 'application/pdf');
  assert.match(pdf.filename, /\.pdf$/);
  assert.equal(String.fromCharCode(...pdf.bytes.slice(0, 4)), '%PDF');
  assert.equal(pdf.inline, true);

  const x = await reportFile(db, ADM(), { type: 'sales', ...D, format: 'xlsx' });
  assert.equal(x.contentType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.match(x.filename, /\.xlsx$/);
  const buf = Buffer.from(x.bytes);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  // Walk the local headers and inflate the worksheet to prove it is a sheet with the title in it.
  let off = 0, sheet = '';
  while (buf.readUInt32LE(off) === 0x04034b50) {
    const nameLen = buf.readUInt16LE(off + 26), extraLen = buf.readUInt16LE(off + 28), comp = buf.readUInt32LE(off + 18);
    const name = buf.slice(off + 30, off + 30 + nameLen).toString('utf8');
    const data = buf.slice(off + 30 + nameLen + extraLen, off + 30 + nameLen + extraLen + comp);
    if (name === 'xl/worksheets/sheet1.xml') sheet = inflateRawSync(data).toString('utf8');
    off += 30 + nameLen + extraLen + comp;
  }
  assert.match(sheet, /Fromville Phones/);
  assert.match(sheet, /SALE-0001/);
  await rejects(reportFile(db, SEL3(), { type: 'sales', ...D, format: 'pdf' }), 403);
});
