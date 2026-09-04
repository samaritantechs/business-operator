import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookDb, userOf, richBook, NOW, TODAY } from './_book.mjs';
import { FN, WRITES } from '../api/_lib/bo/stockops.js';

/* stockops.js against the shared book: V1 has branches Sinza (B1) and Kariakoo (B2),
   serialized P1 (U1, U2 at B1, U3 at B2, U4 sold) and P2 (U5, U6 at B2), and counted P3
   (40 = 25 at B1 + 15 at B2). Every stock change is checked on the row AND in the ledger. */

const rejects = (p, status, re) => assert.rejects(p, e => {
  assert.equal(e.status, status, 'expected ' + status + ' but got ' + e.status + ': ' + e.message);
  if (re) assert.match(e.message, re);
  return true;
});
const moves = db => db._dump('stock_movements').filter(m => !/^M\d$/.test(String(m.id)));
const product = (db, id) => db._dump('products').find(p => p.id === id);
const unit = (db, id) => db._dump('product_units').find(u => u.id === id);
const branchQty = (db, pid, bid) => { const r = db._dump('branch_stock').find(x => x.product_id === pid && x.branch_id === bid); return r ? r.qty : null; };
const ADM = () => userOf(richBook(), 'ADM1'), SEL = () => userOf(richBook(), 'SEL1'), MGR = () => userOf(richBook(), 'MGR'), ADM2 = () => userOf(richBook(), 'ADM2');

test('the contract names, nothing more', () => {
  assert.deepEqual(Object.keys(FN).sort(), ['addUnits', 'adjustStock', 'branchStock', 'branches', 'movements', 'partners', 'saveBranch', 'savePartner', 'transferStock', 'unitHistory', 'units', 'updateUnit']);
  assert.deepEqual([...WRITES].sort(), ['addUnits', 'adjustStock', 'saveBranch', 'savePartner', 'transferStock', 'updateUnit']);
});

/* ------------------------------------------------------------------ branches */
test('branches: the vendor list by name, inactive included; manager scope', async () => {
  const db = bookDb();
  assert.deepEqual((await FN.branches(db, ADM(), {}, NOW)).rows.map(b => b.name), ['Kariakoo', 'Sinza']);
  assert.equal((await FN.branches(db, SEL(), {}, NOW)).rows.length, 2);
  assert.equal((await FN.branches(db, ADM2(), { vendor_id: 'V1' }, NOW)).rows.length, 0);     // pinned to V2 whatever they send
  assert.equal((await FN.branches(db, MGR(), { vendor_id: 'V1' }, NOW)).rows.length, 2);
  assert.equal((await FN.branches(db, MGR(), {}, NOW)).rows.length, 2);
  await FN.saveBranch(db, ADM(), { name: 'Mbezi', active: false }, NOW);
  assert.deepEqual((await FN.branches(db, ADM(), {}, NOW)).rows.map(b => b.name), ['Kariakoo', 'Mbezi', 'Sinza']);
});

test('saveBranch: insert, update, unique name per vendor, who may', async () => {
  const db = bookDb();
  const { branch } = await FN.saveBranch(db, ADM(), { name: ' Mbezi ', location: 'Mbezi Beach' }, NOW);
  assert.equal(branch.vendor_id, 'V1');
  assert.equal(branch.name, 'Mbezi');
  assert.equal(branch.location, 'Mbezi Beach');
  assert.equal(branch.active, true);
  assert.ok(branch.id);
  await rejects(FN.saveBranch(db, ADM(), { name: 'Sinza' }, NOW), 400, /already exists/);
  await rejects(FN.saveBranch(db, ADM(), { id: 'B2', name: 'Sinza' }, NOW), 400, /already exists/);
  const up = await FN.saveBranch(db, ADM(), { id: 'B1', name: 'Sinza', location: 'Sinza Mori, opposite the market', active: false }, NOW);
  assert.equal(up.branch.id, 'B1');
  assert.equal(up.branch.location, 'Sinza Mori, opposite the market');
  assert.equal(up.branch.active, false);
  await rejects(FN.saveBranch(db, ADM(), { id: 'B1', name: '' }, NOW), 400);
  await rejects(FN.saveBranch(db, ADM2(), { id: 'B1', name: 'Taken' }, NOW), 404);          // not V2's branch
  await rejects(FN.saveBranch(db, SEL(), { name: 'Nope' }, NOW), 403);
  await rejects(FN.saveBranch(db, MGR(), { name: 'Nope' }, NOW), 400, /business/i);
  const m = await FN.saveBranch(db, MGR(), { name: 'Kariakoo', vendor_id: 'V2' }, NOW);     // same name, other vendor: fine
  assert.equal(m.branch.vendor_id, 'V2');
  assert.equal(db._dump('branches').length, 4);
});

/* ------------------------------------------------------------------ partners */
test('partners: the vendor\'s plus the global ones; sellers see active only', async () => {
  const db = bookDb();
  await FN.savePartner(db, ADM(), { name: 'Old Lender', active: false }, NOW);
  assert.deepEqual((await FN.partners(db, ADM(), {}, NOW)).rows.map(p => p.name), ['MOGO', 'Old Lender', 'Watu Simu']);
  assert.deepEqual((await FN.partners(db, SEL(), {}, NOW)).rows.map(p => p.name), ['MOGO', 'Watu Simu']);
  assert.deepEqual((await FN.partners(db, ADM2(), {}, NOW)).rows.map(p => p.name), ['Watu Simu']);
  assert.deepEqual((await FN.partners(db, MGR(), { vendor_id: 'V2' }, NOW)).rows.map(p => p.name), ['Watu Simu']);
  assert.equal((await FN.partners(db, MGR(), {}, NOW)).rows.length, 3);
});

test('savePartner: an admin keeps their own list, a manager the global one', async () => {
  const db = bookDb();
  const a = await FN.savePartner(db, ADM(), { name: 'Onfone', contact: '0711 000 000' }, NOW);
  assert.equal(a.partner.vendor_id, 'V1');
  assert.equal(a.partner.contact, '0711 000 000');
  const g = await FN.savePartner(db, MGR(), { name: 'Watu Credit' }, NOW);
  assert.equal(g.partner.vendor_id, null);
  const named = await FN.savePartner(db, MGR(), { name: 'Halotel Pay', vendor_id: 'V2' }, NOW);
  assert.equal(named.partner.vendor_id, 'V2');
  const up = await FN.savePartner(db, ADM(), { id: 'FP1', name: 'MOGO Tanzania', active: false }, NOW);
  assert.equal(up.partner.name, 'MOGO Tanzania');
  assert.equal(up.partner.active, false);
  await rejects(FN.savePartner(db, ADM(), { id: 'FP2', name: 'Mine' }, NOW), 403, /manager/);
  await rejects(FN.savePartner(db, ADM2(), { id: 'FP1', name: 'Mine' }, NOW), 403);
  const mg = await FN.savePartner(db, MGR(), { id: 'FP2', name: 'Watu Simu Ltd' }, NOW);
  assert.equal(mg.partner.name, 'Watu Simu Ltd');
  await rejects(FN.savePartner(db, SEL(), { name: 'X' }, NOW), 403);
  await rejects(FN.savePartner(db, ADM(), { name: '' }, NOW), 400);
  await rejects(FN.savePartner(db, ADM(), { id: 'FP9', name: 'X' }, NOW), 404);
});

/* ------------------------------------------------------------------ units */
test('units: filters, IMEI search, product_name, bounded and vendor-scoped', async () => {
  const db = bookDb();
  const all = await FN.units(db, ADM(), {}, NOW);
  assert.equal(all.rows.length, 6);
  assert.equal(all.rows.find(u => u.id === 'U5').product_name, 'Tecno Spark 20');
  assert.ok(all.rows[0].received_at >= all.rows[5].received_at);   // newest first
  assert.deepEqual((await FN.units(db, ADM(), { product_id: 'P1' }, NOW)).rows.map(u => u.id).sort(), ['U1', 'U2', 'U3', 'U4']);
  assert.equal((await FN.units(db, ADM(), { status: 'in_stock' }, NOW)).rows.length, 5);
  assert.deepEqual((await FN.units(db, ADM(), { status: 'sold' }, NOW)).rows.map(u => u.id), ['U4']);
  assert.deepEqual((await FN.units(db, SEL(), { branch_id: 'B2' }, NOW)).rows.map(u => u.id).sort(), ['U3', 'U5', 'U6']);
  assert.deepEqual((await FN.units(db, ADM(), { q: '0005' }, NOW)).rows.map(u => u.id), ['U5']);
  assert.deepEqual((await FN.units(db, ADM(), { q: '35000000000000' }, NOW)).rows.length, 6);
  assert.deepEqual((await FN.units(db, ADM(), { q: 'a,b(c)%' }, NOW)).rows, []);                // punctuation cannot break the query
  assert.equal((await FN.units(db, ADM2(), {}, NOW)).rows.length, 0);
  assert.equal((await FN.units(db, MGR(), {}, NOW)).rows.length, 6);
  assert.equal((await FN.units(db, MGR(), { vendor_id: 'V2' }, NOW)).rows.length, 0);
  await rejects(FN.units(db, ADM(), { status: 'broken' }, NOW), 400);
});

test('addUnits: units in, one recount, one received movement each; every duplicate named', async () => {
  const db = bookDb();
  const r = await FN.addUnits(db, ADM(), { product_id: 'P1', branch_id: 'B1', units: [{ imei: '3500 0000 0000 0101' }, { imei: '350000000000102', serial_no: 'SN-102' }, { serial_no: 'SN-103' }] }, NOW);
  assert.equal(r.added, 3);
  assert.equal(r.stock, 6);
  assert.match(r.message, /Added 3 unit\(s\)/);
  assert.equal(product(db, 'P1').stock, 6);
  const made = db._dump('product_units').filter(u => !/^U\d$/.test(u.id));
  assert.equal(made.length, 3);
  assert.deepEqual(made.map(u => u.imei), ['3500000000000101', '350000000000102', null]);
  assert.deepEqual(made.map(u => u.serial_no), [null, 'SN-102', 'SN-103']);
  for (const u of made) {
    assert.equal(u.status, 'in_stock'); assert.equal(u.branch_id, 'B1'); assert.equal(u.vendor_id, 'V1');
    assert.equal(u.received_at, new Date(NOW).toISOString());
  }
  const m = moves(db);
  assert.equal(m.length, 3);
  assert.deepEqual(m.map(x => x.type), ['received', 'received', 'received']);
  assert.deepEqual(m.map(x => x.unit_id), made.map(u => u.id));
  assert.deepEqual(m.map(x => x.qty), [1, 1, 1]);
  assert.deepEqual(m.map(x => x.to_branch_id), ['B1', 'B1', 'B1']);
  assert.equal(m[0].imei, '3500000000000101');
  assert.equal(m[0].product_name, 'Samsung Galaxy A05');
  assert.equal(m[0].by_name, 'Frank Amos');

  // duplicates: within the request, then against the vendor's existing IMEIs -- nothing written
  await rejects(FN.addUnits(db, ADM(), { product_id: 'P1', units: [{ imei: '350000000000201' }, { imei: '350000000000201' }] }, NOW), 400, /350000000000201.*twice/);
  await rejects(FN.addUnits(db, ADM(), { product_id: 'P1', units: [{ imei: '350000000000202' }, { imei: '350000000000001' }] }, NOW), 400, /350000000000001.*already/);
  await rejects(FN.addUnits(db, ADM(), { product_id: 'P1', units: [{ serial_no: 'S' }, { serial_no: 'S' }] }, NOW), 400, /twice/);
  await rejects(FN.addUnits(db, ADM(), { product_id: 'P1', units: [{ imei: '12' }] }, NOW), 400, /14-16 digits/);
  await rejects(FN.addUnits(db, ADM(), { product_id: 'P1', units: [{ imei: '', serial_no: '' }] }, NOW), 400, /IMEI or a serial/);
  await rejects(FN.addUnits(db, ADM(), { product_id: 'P1', units: [] }, NOW), 400);
  await rejects(FN.addUnits(db, ADM(), { product_id: 'P3', units: [{ imei: '350000000000203' }] }, NOW), 400, /not tracked/);
  await rejects(FN.addUnits(db, ADM(), { product_id: 'P1', branch_id: 'B9', units: [{ imei: '350000000000203' }] }, NOW), 404);
  await rejects(FN.addUnits(db, ADM2(), { product_id: 'P1', units: [{ imei: '350000000000203' }] }, NOW), 404);
  await rejects(FN.addUnits(db, SEL(), { product_id: 'P1', units: [{ imei: '350000000000203' }] }, NOW), 403);
  await rejects(FN.addUnits(db, MGR(), { product_id: 'P1', units: [{ imei: '350000000000203' }] }, NOW), 400, /business/i);
  assert.equal(db._dump('product_units').length, 9);
  assert.equal(moves(db).length, 3);
  assert.equal(product(db, 'P1').stock, 6);
  // the same IMEI is fine for ANOTHER vendor (unique per vendor), and a manager naming the vendor may add
  const other = await FN.addUnits(db, MGR(), { product_id: 'P1', vendor_id: 'V1', units: [{ imei: '350000000000301' }] }, NOW);
  assert.equal(other.stock, 7);
});

test('updateUnit: lost and found go through the ledger; sold units are not edited; IMEI clash', async () => {
  const db = bookDb();
  const lost = await FN.updateUnit(db, ADM(), { unit_id: 'U1', status: 'lost', note: 'Missing after stock take' }, NOW);
  assert.equal(lost.unit.status, 'lost');
  assert.equal(lost.unit.branch_id, 'B1');          // we remember where it went missing
  assert.equal(lost.unit.note, 'Missing after stock take');
  assert.equal(product(db, 'P1').stock, 2);
  let m = moves(db);
  assert.equal(m.length, 1);
  assert.equal(m[0].type, 'adjustment_out');
  assert.equal(m[0].unit_id, 'U1');
  assert.equal(m[0].imei, '350000000000001');
  assert.equal(m[0].from_branch_id, 'B1');
  assert.equal(m[0].to_branch_id, null);
  assert.equal(m[0].note, 'Missing after stock take');
  const found = await FN.updateUnit(db, ADM(), { unit_id: 'U1', status: 'in_stock', branch_id: 'B2' }, NOW);
  assert.equal(found.unit.status, 'in_stock');
  assert.equal(found.unit.branch_id, 'B2');
  assert.equal(product(db, 'P1').stock, 3);
  m = moves(db);
  assert.equal(m.length, 2);
  assert.equal(m[1].type, 'adjustment_in');
  assert.equal(m[1].to_branch_id, 'B2');
  assert.equal(m[1].from_branch_id, null);
  // a plain edit is no movement
  const edit = await FN.updateUnit(db, ADM(), { unit_id: 'U2', imei: '350000000000022', serial_no: 'SN-22', branch_id: 'B2' }, NOW);
  assert.equal(edit.unit.imei, '350000000000022');
  assert.equal(edit.unit.serial_no, 'SN-22');
  assert.equal(edit.unit.branch_id, 'B2');
  assert.equal(edit.unit.updated_at, new Date(NOW).toISOString());
  assert.equal(moves(db).length, 2);
  await rejects(FN.updateUnit(db, ADM(), { unit_id: 'U2', imei: '350000000000003' }, NOW), 400, /already registered/);
  await rejects(FN.updateUnit(db, ADM(), { unit_id: 'U4', status: 'lost' }, NOW), 400, /sold/);
  await rejects(FN.updateUnit(db, ADM(), { unit_id: 'U3', status: 'sold' }, NOW), 400);
  await rejects(FN.updateUnit(db, ADM(), { unit_id: 'U3', branch_id: 'B9' }, NOW), 404);
  await rejects(FN.updateUnit(db, ADM2(), { unit_id: 'U3', status: 'lost' }, NOW), 404);
  await rejects(FN.updateUnit(db, SEL(), { unit_id: 'U3', status: 'lost' }, NOW), 403);
  assert.equal(unit(db, 'U4').status, 'sold');
  assert.equal(unit(db, 'U3').status, 'in_stock');
});

test('unitHistory: U4 -- received, sold, and the sale it ended in (S1, MOGO, at Sinza)', async () => {
  const db = bookDb();
  const h = await FN.unitHistory(db, ADM(), { unit_id: 'U4' }, NOW);
  assert.equal(h.unit.id, 'U4');
  assert.equal(h.unit.status, 'sold');
  assert.equal(h.product.id, 'P1');
  assert.equal(h.product.name, 'Samsung Galaxy A05');
  assert.deepEqual(h.movements.map(m => m.id), ['M1', 'M2']);
  assert.equal(h.movements[0].to_branch_name, 'Sinza');
  assert.equal(h.movements[1].from_branch_name, 'Sinza');
  assert.equal(h.sale.id, 'S1');
  assert.equal(h.sale.legacy_id, 'SALE-0001');
  assert.equal(h.sale.partner_name, 'MOGO');
  assert.equal(h.sale.partner_paid, false);
  assert.equal(h.sale.branch_name, 'Sinza');
  assert.equal(h.sale.seller_name, 'Juma Seller');
  assert.equal(h.sale.discount, 10000);
  assert.equal(h.sale.total, 340000);
  assert.equal(h.sale.status, 'completed');
  assert.equal(h.sale.imei, '350000000000004');
  const byImei = await FN.unitHistory(db, ADM(), { imei: '350000-000000-004' }, NOW);
  assert.equal(byImei.unit.id, 'U4');
  const unsold = await FN.unitHistory(db, MGR(), { unit_id: 'U5' }, NOW);
  assert.equal(unsold.sale, null);
  assert.deepEqual(unsold.movements, []);
  await rejects(FN.unitHistory(db, ADM(), {}, NOW), 400);
  await rejects(FN.unitHistory(db, ADM(), { unit_id: 'U9' }, NOW), 404);
  await rejects(FN.unitHistory(db, ADM2(), { unit_id: 'U4' }, NOW), 404);
  await rejects(FN.unitHistory(db, SEL(), { unit_id: 'U4' }, NOW), 403);
});

/* ------------------------------------------------------------------ transfers */
test('transferStock (counted): qty leaves one branch and lands in the other, total untouched, two ledger rows', async () => {
  const db = bookDb();
  const r = await FN.transferStock(db, ADM(), { product_id: 'P3', from_branch_id: 'B1', to_branch_id: 'B2', qty: 10, note: 'Kariakoo ran out' }, NOW);
  assert.match(r.message, /Moved 10 x "Phone Cover" from Sinza to Kariakoo/);
  assert.equal(branchQty(db, 'P3', 'B1'), 15);
  assert.equal(branchQty(db, 'P3', 'B2'), 25);
  assert.equal(product(db, 'P3').stock, 40);
  const m = moves(db);
  assert.equal(m.length, 2);
  assert.deepEqual(m.map(x => x.type), ['transfer_out', 'transfer_in']);
  for (const x of m) {
    assert.equal(x.qty, 10); assert.equal(x.from_branch_id, 'B1'); assert.equal(x.to_branch_id, 'B2');
    assert.equal(x.product_id, 'P3'); assert.equal(x.note, 'Kariakoo ran out'); assert.equal(x.by_user, 'ADM1');
    assert.equal(x.created_at, new Date(NOW).toISOString());
  }
  await rejects(FN.transferStock(db, ADM(), { product_id: 'P3', from_branch_id: 'B1', to_branch_id: 'B2', qty: 16 }, NOW), 400, /Only 15/);
  await rejects(FN.transferStock(db, ADM(), { product_id: 'P3', from_branch_id: 'B1', to_branch_id: 'B1', qty: 1 }, NOW), 400, /different/);
  await rejects(FN.transferStock(db, ADM(), { product_id: 'P3', from_branch_id: 'B1', to_branch_id: 'B9', qty: 1 }, NOW), 404);
  await rejects(FN.transferStock(db, ADM(), { product_id: 'P3', from_branch_id: 'B1', to_branch_id: 'B2', qty: 0 }, NOW), 400);
  await rejects(FN.transferStock(db, ADM(), { product_id: 'P3', from_branch_id: '', to_branch_id: 'B2', qty: 1 }, NOW), 400);
  await rejects(FN.transferStock(db, SEL(), { product_id: 'P3', from_branch_id: 'B1', to_branch_id: 'B2', qty: 1 }, NOW), 403);
  await rejects(FN.transferStock(db, ADM2(), { product_id: 'P3', from_branch_id: 'B1', to_branch_id: 'B2', qty: 1 }, NOW), 404);
  assert.equal(branchQty(db, 'P3', 'B1'), 15);
  assert.equal(moves(db).length, 2);
  // a branch with no row yet counts as 0
  const { branch } = await FN.saveBranch(db, ADM(), { name: 'Mbezi' }, NOW);
  await rejects(FN.transferStock(db, ADM(), { product_id: 'P3', from_branch_id: branch.id, to_branch_id: 'B1', qty: 1 }, NOW), 400, /Only 0/);
  await FN.transferStock(db, ADM(), { product_id: 'P3', from_branch_id: 'B2', to_branch_id: branch.id, qty: 5 }, NOW);
  assert.equal(branchQty(db, 'P3', branch.id), 5);
  assert.equal(branchQty(db, 'P3', 'B2'), 20);
});

test('transferStock (serialized): the named units change branch; a unit not at `from` refuses the lot', async () => {
  const db = bookDb();
  const r = await FN.transferStock(db, ADM(), { product_id: 'P1', from_branch_id: 'B1', to_branch_id: 'B2', unit_ids: ['U1', 'U2'] }, NOW);
  assert.match(r.message, /Moved 2 unit\(s\) of "Samsung Galaxy A05" from Sinza to Kariakoo/);
  assert.equal(unit(db, 'U1').branch_id, 'B2');
  assert.equal(unit(db, 'U2').branch_id, 'B2');
  assert.equal(unit(db, 'U1').status, 'in_stock');
  assert.equal(product(db, 'P1').stock, 3);
  const m = moves(db);
  assert.deepEqual(m.map(x => x.type), ['transfer_out', 'transfer_in', 'transfer_out', 'transfer_in']);
  assert.deepEqual(m.map(x => x.unit_id), ['U1', 'U1', 'U2', 'U2']);
  for (const x of m) { assert.equal(x.from_branch_id, 'B1'); assert.equal(x.to_branch_id, 'B2'); assert.equal(x.qty, 1); }
  assert.equal(m[0].imei, '350000000000001');
  // U3 is at B2, not B1: nothing moves
  await rejects(FN.transferStock(db, ADM(), { product_id: 'P1', from_branch_id: 'B1', to_branch_id: 'B2', unit_ids: ['U3'] }, NOW), 400, /350000000000003 is at Kariakoo/);
  await rejects(FN.transferStock(db, ADM(), { product_id: 'P1', from_branch_id: 'B1', to_branch_id: 'B2', unit_ids: ['U4'] }, NOW), 400, /not in stock/);
  await rejects(FN.transferStock(db, ADM(), { product_id: 'P1', from_branch_id: 'B1', to_branch_id: 'B2', unit_ids: ['U5'] }, NOW), 400, /does not belong/);
  await rejects(FN.transferStock(db, ADM(), { product_id: 'P1', from_branch_id: 'B1', to_branch_id: 'B2', unit_ids: [] }, NOW), 400);
  await rejects(FN.transferStock(db, ADM(), { product_id: 'P1', from_branch_id: 'B1', to_branch_id: 'B2', qty: 1 }, NOW), 400);   // a number is not a unit
  assert.equal(unit(db, 'U3').branch_id, 'B2');
  assert.equal(moves(db).length, 4);
});

/* ------------------------------------------------------------------ corrections */
test('adjustStock: needs a reason, a non-zero difference, a counted product; never below zero', async () => {
  const db = bookDb();
  await rejects(FN.adjustStock(db, ADM(), { product_id: 'P3', delta: -5 }, NOW), 400, /reason/i);
  await rejects(FN.adjustStock(db, ADM(), { product_id: 'P3', delta: -5, note: '   ' }, NOW), 400, /reason/i);
  await rejects(FN.adjustStock(db, ADM(), { product_id: 'P3', delta: 0, note: 'x' }, NOW), 400);
  await rejects(FN.adjustStock(db, ADM(), { product_id: 'P1', delta: -1, note: 'x' }, NOW), 400, /IMEI/);
  await rejects(FN.adjustStock(db, ADM(), { product_id: 'P3', delta: -41, note: 'x' }, NOW), 400, /below zero/);
  await rejects(FN.adjustStock(db, ADM(), { product_id: 'P3', delta: -16, branch_id: 'B2', note: 'x' }, NOW), 400, /Kariakoo below zero/);
  await rejects(FN.adjustStock(db, SEL(), { product_id: 'P3', delta: -1, note: 'x' }, NOW), 403);
  assert.equal(moves(db).length, 0);
  const r = await FN.adjustStock(db, ADM(), { product_id: 'P3', delta: -5, branch_id: 'B2', note: 'Damaged in the rain' }, NOW);
  assert.equal(r.message, 'Stock updated. New qty: 35');
  assert.equal(r.stock, 35);
  assert.equal(product(db, 'P3').stock, 35);
  assert.equal(branchQty(db, 'P3', 'B2'), 10);
  const m = moves(db);
  assert.equal(m.length, 1);
  assert.equal(m[0].type, 'adjustment_out');
  assert.equal(m[0].qty, 5);
  assert.equal(m[0].from_branch_id, 'B2');
  assert.equal(m[0].to_branch_id, null);
  assert.equal(m[0].note, 'Damaged in the rain');
  const up = await FN.adjustStock(db, MGR(), { product_id: 'P3', delta: 3, vendor_id: 'V1', note: 'Found a box' }, NOW);
  assert.equal(up.stock, 38);
  assert.equal(moves(db)[1].to_branch_id, null);
});

/* ------------------------------------------------------------------ the ledger */
test('movements: bounded by date, newest first, branch names on, filters', async () => {
  const db = bookDb();
  const today = await FN.movements(db, ADM(), { start: TODAY, end: TODAY }, NOW);
  assert.deepEqual(today.rows.map(m => m.id), ['M2']);
  assert.equal(today.rows[0].from_branch_name, 'Sinza');
  assert.equal(today.rows[0].to_branch_name, null);
  const aug = await FN.movements(db, ADM(), { start: '2026-08-01', end: TODAY }, NOW);
  assert.deepEqual(aug.rows.map(m => m.id), ['M2', 'M1']);
  assert.equal(aug.rows[1].to_branch_name, 'Sinza');
  assert.deepEqual((await FN.movements(db, ADM(), { start: '2026-08-01', end: TODAY, type: 'received' }, NOW)).rows.map(m => m.id), ['M1']);
  assert.deepEqual((await FN.movements(db, ADM(), { start: '2026-08-01', end: TODAY, branch_id: 'B1' }, NOW)).rows.map(m => m.id), ['M2', 'M1']);
  assert.deepEqual((await FN.movements(db, ADM(), { start: '2026-08-01', end: TODAY, branch_id: 'B2' }, NOW)).rows, []);
  assert.deepEqual((await FN.movements(db, ADM(), { start: '2026-08-01', end: TODAY, product_id: 'P3' }, NOW)).rows, []);
  assert.deepEqual((await FN.movements(db, ADM(), { start: '2026-08-01', end: '2026-08-31' }, NOW)).rows.map(m => m.id), ['M1']);
  assert.deepEqual((await FN.movements(db, ADM2(), { start: '2026-08-01', end: TODAY }, NOW)).rows, []);
  assert.equal((await FN.movements(db, MGR(), { start: '2026-08-01', end: TODAY }, NOW)).rows.length, 2);
  assert.equal((await FN.movements(db, MGR(), { start: '2026-08-01', end: TODAY, vendor_id: 'V2' }, NOW)).rows.length, 0);
  await rejects(FN.movements(db, ADM(), { start: 'yesterday', end: TODAY }, NOW), 400);
  await rejects(FN.movements(db, ADM(), { start: TODAY, end: '2026-08-01' }, NOW), 400);
  await rejects(FN.movements(db, ADM(), { start: TODAY, end: TODAY, type: 'stolen' }, NOW), 400);
  await rejects(FN.movements(db, SEL(), { start: TODAY, end: TODAY }, NOW), 403);
  // what a transfer wrote today shows up at once, on top
  await FN.transferStock(db, ADM(), { product_id: 'P3', from_branch_id: 'B1', to_branch_id: 'B2', qty: 2 }, NOW);
  const now = await FN.movements(db, ADM(), { start: TODAY, end: TODAY }, NOW);
  assert.equal(now.rows.length, 3);
  assert.equal(now.rows[0].from_branch_name, 'Sinza');
  assert.equal(now.rows[0].to_branch_name, 'Kariakoo');
});

test('branchStock: every active product with its per-shop quantities and the vendor total', async () => {
  const db = bookDb();
  const { rows } = await FN.branchStock(db, ADM(), {}, NOW);
  assert.deepEqual(rows.map(r => r.product_id), ['P1', 'P2', 'P3']);
  const p1 = rows[0], p3 = rows[2];
  assert.deepEqual(Object.keys(p1).sort(), ['branches', 'brand', 'is_serialized', 'model', 'name', 'product_id', 'total']);
  assert.equal(p1.is_serialized, true);
  assert.equal(p1.total, 3);
  assert.deepEqual(p1.branches, [{ branch_id: 'B2', name: 'Kariakoo', qty: 1 }, { branch_id: 'B1', name: 'Sinza', qty: 2 }]);
  assert.deepEqual(rows[1].branches, [{ branch_id: 'B2', name: 'Kariakoo', qty: 2 }]);
  assert.equal(p3.total, 40);
  assert.equal(p3.is_serialized, false);
  assert.deepEqual(p3.branches, [{ branch_id: 'B2', name: 'Kariakoo', qty: 15 }, { branch_id: 'B1', name: 'Sinza', qty: 25 }]);
  const atB2 = await FN.branchStock(db, ADM(), { branch_id: 'B2' }, NOW);
  assert.deepEqual(atB2.rows[2].branches, [{ branch_id: 'B2', name: 'Kariakoo', qty: 15 }]);
  assert.deepEqual(atB2.rows[0].branches, [{ branch_id: 'B2', name: 'Kariakoo', qty: 1 }]);
  assert.equal(atB2.rows[2].total, 40);
  // a vendor without branches: products, no per-branch rows
  const v2 = await FN.branchStock(db, ADM2(), {}, NOW);
  assert.deepEqual(v2.rows.map(r => [r.product_id, r.total, r.branches.length]), [['P5', 8, 0], ['P6', 1, 0]]);
  assert.equal((await FN.branchStock(db, MGR(), { vendor_id: 'V1' }, NOW)).rows.length, 3);
  await rejects(FN.branchStock(db, MGR(), {}, NOW), 400);
  await rejects(FN.branchStock(db, SEL(), {}, NOW), 403);
});

/* A stock take goes both ways, and 'adjustment' recorded only that one happened: qty is always
   positive and the type is what carries direction, so "-3 damaged" and "+3 found again" were
   written as the same row twice. Replaying the ledger gave +6, -6 or 0 with equal justification,
   and the Stock Movements report counted neither in TOTAL IN or TOTAL OUT. */
test('adjustStock: the ledger says which way a correction went', async () => {
  const db = bookDb();
  await FN.adjustStock(db, ADM(), { product_id: 'P3', delta: -3, note: 'damaged' }, NOW);
  await FN.adjustStock(db, ADM(), { product_id: 'P3', delta: 3, note: 'found again' }, NOW);
  const m = moves(db).filter(x => x.product_id === 'P3');
  assert.equal(m.length, 2);
  assert.deepEqual(m.map(x => x.type), ['adjustment_out', 'adjustment_in']);
  assert.deepEqual(m.map(x => x.qty), [3, 3], 'qty stays positive; the type carries the sign');
  // Replaying the ledger now lands back where it started, which it could not before.
  const net = m.reduce((a, x) => a + (x.type === 'adjustment_out' ? -x.qty : x.qty), 0);
  assert.equal(net, 0);
  assert.equal(product(db, 'P3').stock, 40);
});
