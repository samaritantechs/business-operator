import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookDb, richBook, userOf, NOW, MANAGER, ADMIN1, SELLER1, ADMIN2, ADMIN3 } from './_book.mjs';
import { buildBoot, FN, WRITES } from '../api/_lib/bo/boot.js';
import { DEFAULT_HINTS } from '../api/_lib/bo/hints.js';

/* The one payload the app boots from: its exact shape per role, the permission flags, the
   restriction notice with its placeholders filled, and what it costs. */

const KEYS = ['user', 'vendor', 'perms', 'hints', 'timings', 'restriction', 'branches', 'partners', 'features', 'announcement', 'whatsapp'];

/** A db that counts the round trips (every db.from is one request on the real client). */
function counted(db) {
  let n = 0;
  const from = db.from.bind(db);
  return { db: { ...db, from(t) { n++; return from(t); } }, trips: () => n };
}

test('seller: the full contract shape, honouring the vendor permission flags', async () => {
  const book = richBook();
  const db = bookDb(book);
  const out = await buildBoot(db, userOf(book, SELLER1), NOW);
  assert.deepEqual(Object.keys(out).sort(), KEYS.slice().sort());
  assert.equal(out.user.id, 'SEL1');
  assert.equal(out.user.role, 'seller');
  assert.equal(out.vendor.id, 'V1');
  assert.deepEqual(out.perms, { canDownloadReport: true, showDashboard: true });      // V1 grants the seller report
  assert.deepEqual(out.hints, [
    { en: 'Your User ID is your login.', sw: 'Kitambulisho chako ndiyo login yako.' },
    { en: 'Use Refresh to see the latest numbers.', sw: 'Tumia Refresh kuona namba za sasa.' },
  ]);
  assert.deepEqual(out.timings, { hintLifetime: 5, hintInterval: 300, autoSyncSeconds: 120, sessionTimeoutMinutes: 0, loadingTime: 0 });
  for (const v of Object.values(out.timings)) assert.equal(typeof v, 'number');
  assert.deepEqual(out.restriction, { restricted: false, notice: '' });
  assert.deepEqual(out.branches.map(b => b.name), ['Kariakoo', 'Sinza']);
  assert.deepEqual(Object.keys(out.branches[0]).sort(), ['active', 'created_at', 'id', 'location', 'name', 'vendor_id']);
  assert.deepEqual(out.partners.map(p => p.name), ['MOGO', 'Watu Simu']);
  assert.deepEqual(out.features, { has_branches: true, has_serialized: true });
  assert.deepEqual(out.announcement, { enabled: false, title: "What's New", text: '', audience: 'both', version: '' });
  assert.equal(out.whatsapp, '255756749261');
});

test('seller flags off: no report, no dashboard', async () => {
  const book = richBook();
  book.vendors.find(v => v.id === 'V1').permissions = { sellerCanDownloadReport: false, dashboardVisible: false };
  const db = bookDb(book);
  const out = await buildBoot(db, userOf(book, SELLER1), NOW);
  assert.deepEqual(out.perms, { canDownloadReport: false, showDashboard: false });
  // Permissions stored as a JSON string (a migrated row) read the same way.
  book.vendors.find(v => v.id === 'V1').permissions = JSON.stringify({ dashboardVisible: false });
  const out2 = await buildBoot(bookDb(book), userOf(book, SELLER1), NOW);
  assert.deepEqual(out2.perms, { canDownloadReport: false, showDashboard: false });
});

test('admin: everything allowed; hints are the "all" rows when the role has none of its own', async () => {
  const book = richBook();
  const out = await buildBoot(bookDb(book), userOf(book, ADMIN1), NOW);
  assert.deepEqual(out.perms, { canDownloadReport: true, showDashboard: true });
  assert.deepEqual(out.hints.map(h => h.en), ['Use Refresh to see the latest numbers.']);
  assert.equal(out.features.has_serialized, true);
  const plain = await buildBoot(bookDb(book), userOf(book, ADMIN2), NOW);
  assert.deepEqual(plain.branches, []);
  assert.deepEqual(plain.partners.map(p => p.name), ['Watu Simu'], 'only the global partner');
  assert.deepEqual(plain.features, { has_branches: false, has_serialized: false });
});

test('manager: no vendor, no branches, global partners only, never restricted', async () => {
  const book = richBook();
  book.vendors.forEach(v => { v.restricted = true; });
  const out = await buildBoot(bookDb(book), userOf(book, MANAGER), NOW);
  assert.equal(out.vendor, null);
  assert.deepEqual(out.perms, { canDownloadReport: true, showDashboard: true });
  assert.deepEqual(out.branches, []);
  assert.deepEqual(out.partners.map(p => p.name), ['Watu Simu']);
  assert.deepEqual(out.features, { has_branches: false, has_serialized: false });
  assert.deepEqual(out.restriction, { restricted: false, notice: '' });
  assert.deepEqual(out.hints.map(h => h.en), ['Use Refresh to see the latest numbers.']);
});

test('restricted vendor: the notice is the payment message with every placeholder filled', async () => {
  const book = richBook();
  const db = bookDb(book);
  const out = await buildBoot(db, userOf(book, ADMIN3), NOW);
  assert.equal(out.restriction.restricted, true);
  assert.match(out.restriction.notice, /restricted because of an outstanding payment/);
  // A custom template shows exactly what was filled in: V3 has no sales, so the amount is 0.
  book.settings.push({ key: 'paymentReminderText', value: '{vendor}|{admin}|{amount}|{currency}' });
  const out2 = await buildBoot(bookDb(book), userOf(book, ADMIN3), NOW);
  assert.equal(out2.restriction.notice, 'Locked Shop|Locked Admin|0|TZS');
  // A seller of that shop gets the same notice, with the admin looked up.
  book.profiles.push({ id: 'SEL9', email: 's9@shop.tz', name: 'Shop Seller', handle: 's9', role: 'seller', vendor_id: 'V3', branch_id: null, active: true, created_at: '2026-02-02T06:00:00.000Z' });
  book.sales.push({ id: 'S9', group_id: 'G9', vendor_id: 'V3', seller_id: 'SEL9', product_id: 'P7', qty: 1, price: 100000, total: 100000, payment_method: 'Cash', status: 'completed', sold_at: '2026-09-01T08:00:00.000Z' });
  const out3 = await buildBoot(bookDb(book), userOf(book, 'SEL9'), NOW);
  assert.equal(out3.restriction.notice, 'Locked Shop|Locked Admin|2,000|TZS', '2% of 100,000 this cycle');
});

test('the boot payload costs at most 7 round trips', async () => {
  const book = richBook();
  book.profiles.push({ id: 'SEL9', email: 's9@shop.tz', name: 'Shop Seller', handle: 's9', role: 'seller', vendor_id: 'V3', branch_id: null, active: true });
  const seller = counted(bookDb(book));
  await buildBoot(seller.db, userOf(book, SELLER1), NOW);
  assert.equal(seller.trips(), 5, 'business user: settings, hints, branches, partners, serialized count');
  const mgr = counted(bookDb(book));
  await buildBoot(mgr.db, userOf(book, MANAGER), NOW);
  assert.equal(mgr.trips(), 3, 'manager: settings, hints, global partners');
  const locked = counted(bookDb(book));
  await buildBoot(locked.db, userOf(book, ADMIN3), NOW);
  assert.equal(locked.trips(), 6, 'restricted admin: + the sales behind the notice');
  const lockedSeller = counted(bookDb(book));
  await buildBoot(lockedSeller.db, userOf(book, 'SEL9'), NOW);
  assert.equal(lockedSeller.trips(), 7, 'restricted seller: + the admin name');
});

test('announcement and whatsapp come from settings and the environment', async () => {
  const book = richBook();
  book.settings.push({ key: 'announcement_enabled', value: 'Yes' }, { key: 'announcement_title', value: 'Hello' },
    { key: 'announcement_text', value: 'New reports!' }, { key: 'announcement_audience', value: 'app' }, { key: 'announcement_version', value: '123' });
  const saved = process.env.WHATSAPP_NUMBER;
  process.env.WHATSAPP_NUMBER = '255700000000';
  try {
    const out = await buildBoot(bookDb(book), userOf(book, SELLER1), NOW);
    assert.deepEqual(out.announcement, { enabled: true, title: 'Hello', text: 'New reports!', audience: 'app', version: '123' });
    assert.equal(out.whatsapp, '255700000000');
  } finally { if (saved === undefined) delete process.env.WHATSAPP_NUMBER; else process.env.WHATSAPP_NUMBER = saved; }
});

test('an empty hints table answers the legacy defaults; password fields never leave', async () => {
  const book = richBook();
  book.hints = [];
  const user = { ...userOf(book, SELLER1), password_hash: 'h', password_salt: 's' };
  const out = await buildBoot(bookDb(book), user, NOW);
  assert.deepEqual(out.hints, DEFAULT_HINTS.seller.map(en => ({ en, sw: '' })));
  assert.equal('password_hash' in out.user, false);
  assert.equal('password_salt' in out.user, false);
  assert.equal(user.password_hash, 'h', 'the caller object is not mutated');
});

test('FN.boot is buildBoot; FN.suggestion is the one write', async () => {
  assert.deepEqual(Object.keys(FN).sort(), ['boot', 'suggestion']);
  assert.deepEqual(WRITES, ['suggestion']);
  const book = richBook();
  const db = bookDb(book);
  const out = await FN.boot(db, userOf(book, SELLER1), {}, NOW);
  assert.equal(out.user.id, 'SEL1');
  const s = await FN.suggestion(db, userOf(book, SELLER1), { category: 'Idea', message: '  Add dark mode  ' }, NOW);
  assert.equal(s.message, 'Thank you! Your suggestion has been saved.');
  const row = db._dump('suggestions')[0];
  assert.equal(row.profile_id, 'SEL1');
  assert.equal(row.user_name, 'Juma Seller');
  assert.equal(row.vendor_id, 'V1');
  assert.equal(row.category, 'Idea');
  assert.equal(row.message, 'Add dark mode');
  assert.equal(row.created_at, new Date(NOW).toISOString());
  await FN.suggestion(db, userOf(book, MANAGER), { message: 'From the manager' }, NOW);
  const r2 = db._dump('suggestions')[1];
  assert.equal(r2.category, 'General');
  assert.equal(r2.vendor_id, null);
  await assert.rejects(FN.suggestion(db, userOf(book, SELLER1), { category: 'Idea', message: '  ' }, NOW), e => e.status === 400);
});
