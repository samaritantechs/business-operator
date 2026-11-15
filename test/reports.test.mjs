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


/* =====================================================================================
   A COLUMN WITH NOTHING IN IT IS NOT PRINTED, and a figure is never broken in two.
   ===================================================================================== */
const labels = r => r.columns.map(c => c.label);
const WIDE = { start: '2026-07-01', end: TODAY };

test('a shop that sells no phones gets no empty phone columns -- in the preview, the sheet and the PDF alike', async () => {
  const db = bookDb();
  // The grocery: no brand, no IMEI, no discount, no partner, no branch, no customer on record.
  const sales = await FN.reportData(db, ADM2(), { type: 'sales', ...WIDE }, NOW);
  assert.deepEqual(labels(sales), ['#', 'Sale ID', 'Date/Time', 'Seller', 'Product', 'Qty', 'Unit Price', 'Total', 'Payment', 'Group ID']);
  // List Price went with Discount: without a discount between them it says only what Unit Price says.
  assert.ok(!labels(sales).includes('List Price'));
  assert.deepEqual(labels(await FN.reportData(db, ADM2(), { type: 'stock' }, NOW)), ['ID', 'Name', 'Category', 'Price', 'Stock', 'Value', 'Status']);
  const profit = await FN.reportData(db, ADM2(), { type: 'profit', ...WIDE }, NOW);
  assert.deepEqual(labels(profit), ['Product', 'Units', 'Revenue', 'Cost', 'Profit', 'Margin']);
  assert.ok(!profit.totals.some(t => /DISCOUNT/.test(t[0])), 'a shop with no discounts has no "given away" line');
  // The page gets plain columns: the marks that decided this are not part of the answer.
  assert.ok(sales.columns.every(c => !('skipEmpty' in c) && !('with' in c)));

  // The phone shop's rows HAVE those things, so its report still shows them. Decided by the data.
  const phone = await FN.reportData(db, ADM(), { type: 'sales', ...WIDE }, NOW);
  for (const want of ['Brand', 'Model', 'IMEI', 'List Price', 'Discount', 'Partner', 'Branch']) assert.ok(labels(phone).includes(want), want + ' left the phone shop\'s report');
  assert.ok((await FN.reportData(db, ADM(), { type: 'profit', ...WIDE }, NOW)).totals.some(t => /DISCOUNT/.test(t[0])));

  // The sheet has exactly the preview's columns -- one decision, made once.
  const { pruneColumns } = await import('../api/_lib/bo/reports.js');
  const cols = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B', skipEmpty: true }, { key: 'c', label: 'C', with: 'b' }, { key: 'd', label: 'D', skipEmpty: true }];
  assert.deepEqual(pruneColumns(cols, [{ a: 1, b: '', c: 5, d: 'x' }, { a: 2, b: 0, c: 6, d: '' }]).map(c => c.key), ['a', 'd'], 'b is empty everywhere and takes c with it');
  assert.deepEqual(pruneColumns(cols, [{ a: 1, b: 'x', c: 5 }]).map(c => c.key), ['a', 'b', 'c']);
  assert.deepEqual(pruneColumns(cols, []).map(c => c.key), ['a'], 'a report with no rows shows only what every report of its kind has');
  assert.deepEqual(pruneColumns([{ key: 'a', label: 'A' }], [{ a: '' }]).map(c => c.key), ['a'], 'an unmarked column is never dropped, however empty');
});

test('the PDF never breaks a figure or an ID in two, however many columns there are', async () => {
  const { planLayout, buildPdf } = await import('../api/_lib/pdf.js');
  // A stand-in for the font: every character half as wide as the type is tall. Good enough to prove the rule.
  const widthOf = (t, size) => String(t).length * size * 0.5;
  const C = (key, label, right) => ({ key, label, ...(right ? { align: 'right' } : {}) });
  const columns = [C('n', '#', 1), C('id', 'Sale ID'), C('at', 'Date/Time'), C('seller', 'Seller'), C('cust', 'Customer'), C('phone', 'Customer Phone'),
    C('prod', 'Product'), C('brand', 'Brand'), C('model', 'Model'), C('imei', 'IMEI'), C('qty', 'Qty', 1), C('list', 'List Price', 1), C('disc', 'Discount', 1),
    C('price', 'Unit Price', 1), C('total', 'Total', 1), C('pay', 'Payment'), C('partner', 'Partner'), C('branch', 'Branch'), C('group', 'Group ID')];
  const rows = Array.from({ length: 30 }, (_, i) => ({ n: i + 1, id: 'SALE-' + (1000 + i), at: '15/11/2026 18:24', seller: 'Juma Seller', cust: 'Mwanaidi Abdallah Mohamed',
    phone: '+255 712 345 678', prod: 'Samsung Galaxy A05 128GB Dual SIM', brand: 'Samsung', model: 'A05', imei: '356938035643809', qty: 3, list: 1350000, disc: 50000,
    price: 1300000, total: 3900000, pay: 'Credit', partner: 'MOGO', branch: 'Sinza', group: 'aaaaaaaa' }));
  const avail = 841.89 - 72;
  const plan = planLayout({ columns, rows, avail, widthOf, pad: 4, startSize: 7.5 });
  assert.equal(plan.fits, true);
  assert.ok(plan.size >= 5.5 && plan.size <= 7.5);
  assert.ok(Math.abs(plan.widths.reduce((a, b) => a + b, 0) - avail) < 0.01, 'the table is exactly as wide as the page');
  const inner = i => plan.widths[i] - 8;
  columns.forEach((c, i) => {
    // Every figure whole; every word of every text cell whole; every word of every heading whole.
    for (const r of rows) {
      const t = typeof r[c.key] === 'number' ? r[c.key].toLocaleString('en-US') : String(r[c.key]);
      const pieces = c.align === 'right' ? [t] : t.split(' ');
      for (const piece of pieces) assert.ok(widthOf(piece, plan.size) <= inner(i) + 1e-6, '"' + piece + '" does not fit the ' + c.label + ' column');
    }
    for (const w of c.label.split(' ')) assert.ok(widthOf(w, plan.size) <= inner(i) + 1e-6, 'the heading word "' + w + '" does not fit');
  });

  // Room to spare goes to the long text, so a name wraps as little as it can.
  const few = planLayout({ columns: columns.slice(0, 7), rows, avail, widthOf, pad: 4, startSize: 8.5 });
  assert.equal(few.size, 8.5, 'type is not shrunk when there is room');
  assert.ok(few.widths[6] > few.widths[0] * 3, 'the product column should be much wider than the row number');

  // Too many columns even for the smallest type: the figures still keep their width, and it says it did not fit.
  const many = Array.from({ length: 60 }, (_, i) => C('k' + i, 'Heading' + i, i % 2));
  const big = planLayout({ columns: many, rows: [Object.fromEntries(many.map((c, i) => [c.key, i % 2 ? 1234567 : 'Somebody Longname']))], avail, widthOf, pad: 4, startSize: 7.5 });
  assert.equal(big.fits, false); assert.equal(big.size, 5.5);
  assert.ok(Math.abs(big.widths.reduce((a, b) => a + b, 0) - avail) < 0.01);

  // And the real thing, with real fonts: every sale ID and every total comes back whole from the file.
  const bytes = await buildPdf({ title: 'T', columns, rows, totals: [['GRAND TOTAL', '117,000,000 TZS']] });
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), '%PDF');
  // Six columns are an upright page -- unless what is in them cannot fit one at full size, in
  // which case the page is turned sideways before the type is made any smaller.
  const { PDFDocument } = await import('pdf-lib');
  const pageOf = async b => (await PDFDocument.load(b)).getPage(0).getSize();
  const easy = await pageOf(await buildPdf({ title: 'T', columns: columns.slice(0, 6), rows }));
  assert.ok(easy.height > easy.width, 'six columns that fit upright stay upright');
  const six = Array.from({ length: 6 }, (_, i) => C('w' + i, 'Reference' + i));
  const wideRows = [Object.fromEntries(six.map((c, i) => [c.key, 'REF-0000000000000000000' + i]))];   // 24 unbreakable characters each
  const turned = await pageOf(await buildPdf({ title: 'T', columns: six, rows: wideRows }));
  assert.ok(turned.width > turned.height, 'six columns too wide for an upright page should have gone sideways');
  const tiny = await buildPdf({ title: 'T', columns: [C('n', '#', 1), C('pay', 'Payment')], rows });
  const up = (await PDFDocument.load(tiny)).getPage(0).getSize();
  assert.ok(up.height > up.width, 'two small columns stay upright');
});
