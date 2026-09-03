import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookDb, richBook, userOf, NOW, MANAGER, ADMIN1, SELLER1, ADMIN3 } from './_book.mjs';
import { FN, WRITES } from '../api/_lib/bo/vendors.js';
import { iso, DEFAULT_PERMISSIONS } from '../api/_lib/bo/_shared.js';

/* vendors.js against the shared book: the manager's view of every business. */

const BOOK = richBook();
const user = id => userOf(BOOK, id);
const status = p => p.then(() => null, e => e.status);
const vendor = (db, id) => db._dump('vendors').find(v => v.id === id);
const profile = (db, id) => db._dump('profiles').find(p => p.id === id);

test('contract: nine manager functions, four writes', () => {
  assert.deepEqual(Object.keys(FN).sort(), ['allVendorPermissions', 'analytics', 'managerSummary', 'restrictionInfo', 'setAllVendorPermissions', 'setVendorActive', 'setVendorRestricted', 'updateAdmin', 'vendorList']);
  assert.deepEqual([...WRITES].sort(), ['setAllVendorPermissions', 'setVendorActive', 'setVendorRestricted', 'updateAdmin']);
});

test('managerSummary: every business with its admin, catalogue, today\'s sales, stock value and trial days', async () => {
  const db = bookDb();
  const { rows } = await FN.managerSummary(db, user(MANAGER), {}, NOW);
  assert.deepEqual(rows.map(r => r.name), ['Fromville Phones', 'Locked Shop', 'Mama Ntilie Grocery']);
  const v1 = rows[0], v3 = rows[1], v2 = rows[2];
  assert.equal(v1.admin_name, 'Frank Amos');
  assert.equal(v1.admin_handle, 'frank');
  assert.equal(v1.admin_email, 'frank@fromville.tz');
  assert.equal(v1.admin_active, true);
  assert.equal(v1.product_count, 3, 'active products only -- the Old Charger is off');
  assert.equal(v1.stock_value, 350000 * 3 + 280000 * 2 + 5000 * 40);
  assert.equal(v1.today_sales, 340000 + 10000 + 5000, 'the cancelled S4 is not counted');
  assert.equal(v1.trial_days_left, 28);
  assert.equal(v2.today_sales, 6400);
  assert.equal(v2.product_count, 2);
  assert.equal(v2.stock_value, 3200 * 8 + 150000);
  assert.ok(v2.trial_days_left < 0, 'registered in January -- the trial is long over');
  assert.equal(v3.today_sales, 0);
  assert.equal(v3.restricted, true);
  assert.equal(v3.admin_name, 'Locked Admin');
  // The face of the business is the active 'admin' row, not an assistant.
  db._dump('profiles').push({ id: 'ASST', email: 'a@fromville.tz', name: 'Aaron Assistant', handle: 'aaron', role: 'assistant-admin', vendor_id: 'V1', active: true, created_at: '2026-01-01T00:00:00.000Z' });
  assert.equal((await FN.managerSummary(db, user(MANAGER), {}, NOW)).rows[0].admin_name, 'Frank Amos');
  // Switched off, the admin is STILL the face -- shown inactive, so the manager can switch
  // them back on from this screen; an assistant only stands in when there is no admin at all.
  profile(db, 'ADM1').active = false;
  const off = (await FN.managerSummary(db, user(MANAGER), {}, NOW)).rows[0];
  assert.equal(off.admin_name, 'Frank Amos');
  assert.equal(off.admin_active, false);
  profile(db, 'ADM1').role = 'seller';
  assert.equal((await FN.managerSummary(db, user(MANAGER), {}, NOW)).rows[0].admin_name, 'Aaron Assistant');
  assert.equal(await status(FN.managerSummary(db, user(ADMIN1), {}, NOW)), 403);
  assert.equal(await status(FN.managerSummary(db, user(SELLER1), {}, NOW)), 403);
});

test('managerSummary: an inactive business still appears; the summary survives a database without the RPC or with it', async () => {
  const db = bookDb(richBook(), { rpc: { bo_vendor_sales_summary: (store) => {
    // The stand-in for the Postgres GROUP BY: per-vendor sums over completed sales.
    const out = new Map();
    for (const s of store.sales.rows) {
      if (s.status !== 'completed') continue;
      const r = out.get(s.vendor_id) || { vendor_id: s.vendor_id, today: 0, week: 0, month: 0, year: 0 };
      if (s.sold_at >= '2026-09-01T21:00:00.000Z') r.today += s.total;
      r.year += s.total; out.set(s.vendor_id, r);
    }
    return [...out.values()];
  } } });
  vendor(db, 'V2').active = false;
  const { rows } = await FN.managerSummary(db, user(MANAGER), {}, NOW);
  assert.equal(rows.length, 3);
  assert.equal(rows[2].active, false);
  assert.equal(rows[0].today_sales, 355000);
  assert.equal(rows[2].today_sales, 6400);
});

test('vendorList: the active businesses, id / name / currency', async () => {
  const db = bookDb();
  vendor(db, 'V3').active = false;
  vendor(db, 'V2').currency = 'USD';
  assert.deepEqual((await FN.vendorList(db, user(MANAGER), {}, NOW)).rows, [{ id: 'V1', name: 'Fromville Phones', currency: 'TZS' }, { id: 'V2', name: 'Mama Ntilie Grocery', currency: 'USD' }]);
  assert.equal(await status(FN.vendorList(db, user(ADMIN1), {}, NOW)), 403);
});

test('updateAdmin: only what was sent changes; reactivating the admin restarts the cycle', async () => {
  const db = bookDb();
  assert.deepEqual(await FN.updateAdmin(db, user(MANAGER), { profile_id: 'ADM1', name: 'Frank A.', role: null, active: '' }, NOW), { message: 'Admin updated successfully.' });
  assert.equal(profile(db, 'ADM1').name, 'Frank A.');
  assert.equal(profile(db, 'ADM1').role, 'admin');
  assert.equal(profile(db, 'ADM1').active, true);
  await FN.updateAdmin(db, user(MANAGER), { profile_id: 'ADM1', role: 'assistant-admin' }, NOW);
  assert.equal(profile(db, 'ADM1').role, 'assistant-admin');
  await FN.updateAdmin(db, user(MANAGER), { profile_id: 'ADM1', role: 'admin', active: false }, NOW);
  assert.equal(profile(db, 'ADM1').active, false);
  const before = vendor(db, 'V1').registered_on;
  const on = await FN.updateAdmin(db, user(MANAGER), { profile_id: 'ADM1', active: 'true' }, NOW);
  assert.equal(on.message, 'Admin updated successfully. The trial / billing cycle starts again today.');
  assert.equal(vendor(db, 'V1').registered_on, iso(NOW));
  assert.notEqual(before, iso(NOW));
  assert.equal(await status(FN.updateAdmin(db, user(MANAGER), { profile_id: 'ADM1', role: 'seller' }, NOW)), 400);
  assert.equal(await status(FN.updateAdmin(db, user(MANAGER), { profile_id: 'SEL1', name: 'x' }, NOW)), 400, 'not an admin');
  assert.equal(await status(FN.updateAdmin(db, user(MANAGER), { profile_id: 'MGR', name: 'x' }, NOW)), 400, 'a manager is nobody\'s admin');
  assert.equal(await status(FN.updateAdmin(db, user(MANAGER), { profile_id: 'ADM1' }, NOW)), 400, 'nothing to change');
  assert.equal(await status(FN.updateAdmin(db, user(MANAGER), { profile_id: 'nobody', name: 'x' }, NOW)), 404);
  assert.equal(await status(FN.updateAdmin(db, user(ADMIN1), { profile_id: 'ADM1', name: 'x' }, NOW)), 403);
});

test('setVendorActive: the business row only; coming back after a pause restarts the cycle', async () => {
  const db = bookDb();
  const before = vendor(db, 'V1').registered_on;
  assert.deepEqual(await FN.setVendorActive(db, user(MANAGER), { vendor_id: 'V1', active: false }, NOW), { message: 'Business deactivated: Fromville Phones. Its users can no longer sign in.' });
  assert.equal(vendor(db, 'V1').active, false);
  assert.equal(profile(db, 'ADM1').active, true, 'its people keep their own flags');
  assert.equal(vendor(db, 'V1').registered_on, before);
  assert.deepEqual(await FN.setVendorActive(db, user(MANAGER), { vendor_id: 'V1', active: 'Yes' }, NOW), { message: 'Business activated: Fromville Phones. The trial / billing cycle starts again today.' });
  assert.equal(vendor(db, 'V1').active, true);
  assert.equal(vendor(db, 'V1').registered_on, iso(NOW));
  assert.deepEqual(await FN.setVendorActive(db, user(MANAGER), { vendor_id: 'V2', active: true }, NOW), { message: 'Business activated: Mama Ntilie Grocery.' });
  assert.equal(vendor(db, 'V2').registered_on, '2026-01-10T06:00:00.000Z', 'already on -> the clock does not move');
  assert.equal(await status(FN.setVendorActive(db, user(MANAGER), { vendor_id: 'nope', active: true }, NOW)), 404);
  assert.equal(await status(FN.setVendorActive(db, user(MANAGER), { active: true }, NOW)), 400);
  assert.equal(await status(FN.setVendorActive(db, user(ADMIN1), { vendor_id: 'V1', active: false }, NOW)), 403);
});

test('setVendorRestricted: flips the flag with the legacy wording', async () => {
  const db = bookDb();
  const on = await FN.setVendorRestricted(db, user(MANAGER), { vendor_id: 'V1', restricted: true }, NOW);
  assert.match(on.message, /^Account RESTRICTED: Fromville Phones\./);
  assert.equal(vendor(db, 'V1').restricted, true);
  const off = await FN.setVendorRestricted(db, user(MANAGER), { vendor_id: 'V3', restricted: 'false' }, NOW);
  assert.match(off.message, /^Account REACTIVATED: Locked Shop\./);
  assert.equal(vendor(db, 'V3').restricted, false);
  assert.equal(await status(FN.setVendorRestricted(db, user(ADMIN1), { vendor_id: 'V1', restricted: false }, NOW)), 403);
  assert.equal(await status(FN.setVendorRestricted(db, user(MANAGER), { vendor_id: 'nope', restricted: true }, NOW)), 404);
});

test('allVendorPermissions / setAllVendorPermissions: seven flags, one profile for everybody, one write', async () => {
  const db = bookDb();
  const { rows } = await FN.allVendorPermissions(db, user(MANAGER), {}, NOW);
  assert.deepEqual(rows.map(r => r.name), ['Fromville Phones', 'Locked Shop', 'Mama Ntilie Grocery']);
  const keys = Object.keys(DEFAULT_PERMISSIONS).sort();
  for (const r of rows) assert.deepEqual(Object.keys(r.permissions).sort(), keys);
  assert.equal(rows[0].permissions.sellerCanDownloadReport, true);
  assert.equal(rows[2].permissions.sellerCanDownloadReport, false);
  assert.equal(rows[2].permissions.adminReceivesDaily, true, 'the default fills the gap');
  assert.equal(await status(FN.allVendorPermissions(db, user(ADMIN1), {}, NOW)), 403);

  const profile1 = { sellerCanDownloadReport: 'true', dashboardVisible: false, somethingElse: true };
  const a = await FN.setAllVendorPermissions(db, user(MANAGER), { profile: profile1 }, NOW);
  assert.equal(a.message, 'Permissions applied to 3 of 3 business(es).');
  const want = { ...DEFAULT_PERMISSIONS, sellerCanDownloadReport: true, dashboardVisible: false };
  for (const v of db._dump('vendors')) assert.deepEqual(v.permissions, want);
  const b = await FN.setAllVendorPermissions(db, user(MANAGER), { profile: profile1 }, NOW);
  assert.equal(b.message, 'Permissions applied to 0 of 3 business(es) (3 already matched).');
  vendor(db, 'V2').permissions = {};
  assert.equal((await FN.setAllVendorPermissions(db, user(MANAGER), { profile: profile1 }, NOW)).message, 'Permissions applied to 1 of 3 business(es) (2 already matched).');
  assert.equal(await status(FN.setAllVendorPermissions(db, user(MANAGER), {}, NOW)), 400);
  assert.equal(await status(FN.setAllVendorPermissions(db, user(MANAGER), { profile: [] }, NOW)), 400);
  assert.equal(await status(FN.setAllVendorPermissions(db, user(MANAGER), { profile: 'yes' }, NOW)), 400);
  assert.equal(await status(FN.setAllVendorPermissions(db, user(ADMIN1), { profile: profile1 }, NOW)), 403);
});

test('analytics: marketplace views per product and vendor, and this year\'s best sellers', async () => {
  const check = async db => {
    const a = await FN.analytics(db, user(MANAGER), {}, NOW);
    assert.equal(a.total_views, 3);
    assert.equal(a.avg_views, 1.5);
    assert.deepEqual(a.top_viewed, [
      { product_id: 'P3', name: 'Phone Cover', vendor_name: 'Fromville Phones', count: 2, hot: true },
      { product_id: 'P5', name: 'Sugar 1kg', vendor_name: 'Mama Ntilie Grocery', count: 1, hot: false }]);
    assert.deepEqual(a.top_vendor_views, [{ vendor_name: 'Fromville Phones', count: 2 }, { vendor_name: 'Mama Ntilie Grocery', count: 1 }]);
    assert.deepEqual(a.top_selling, [
      { name: 'Phone Cover', vendor_name: 'Fromville Phones', qty: 8, revenue: 38000 },
      { name: 'Sugar 1kg', vendor_name: 'Mama Ntilie Grocery', qty: 2, revenue: 6400 },
      { name: 'Samsung Galaxy A05', vendor_name: 'Fromville Phones', qty: 1, revenue: 340000 }]);
  };
  await check(bookDb());                                                   // no RPC yet: paged fallback
  await check(bookDb(richBook(), { rpc: { bo_click_counts: () => [{ product_id: 'P3', total: 2, recent: 1 }, { product_id: 'P5', total: 1, recent: 1 }] } }));
  const db = bookDb();
  db._dump('product_clicks').push({ id: 4, product_id: 'GONE', vendor_id: 'V1', clicked_at: '2026-08-01T00:00:00.000Z' });
  const a = await FN.analytics(db, user(MANAGER), {}, NOW);
  assert.equal(a.total_views, 4);
  assert.equal(a.top_viewed.find(r => r.product_id === 'GONE').name, '(deleted product)');
  assert.equal(await status(FN.analytics(db, user(ADMIN1), {}, NOW)), 403);
});

test('restrictionInfo: free for managers and unrestricted vendors; the notice for a locked one', async () => {
  const db = bookDb();
  assert.deepEqual(await FN.restrictionInfo(db, user(MANAGER), {}, NOW), { restricted: false, notice: '' });
  assert.deepEqual(await FN.restrictionInfo(db, user(ADMIN1), {}, NOW), { restricted: false, notice: '' });
  const locked = await FN.restrictionInfo(db, user(ADMIN3), {}, NOW);
  assert.equal(locked.restricted, true);
  assert.match(locked.notice, /restricted/i);
  // A custom reminder text with placeholders is filled in.
  db._dump('settings').push({ key: 'paymentReminderText', value: 'Dear {admin} of {vendor}: pay {amount} {currency}.' });
  const custom = await FN.restrictionInfo(db, user(ADMIN3), {}, NOW);
  assert.equal(custom.notice, 'Dear Locked Admin of Locked Shop: pay 0 TZS.');
});
