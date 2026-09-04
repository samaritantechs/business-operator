import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookDb, richBook, userOf, NOW, MANAGER, ADMIN1, SELLER1, SELLER2, ADMIN2, PASSWORD } from './_book.mjs';
import { FN, WRITES, publicProfile, toBool } from '../api/_lib/bo/users.js';
import { verifyPassword, VENDOR_COLS } from '../api/_lib/auth.js';
import { iso } from '../api/_lib/bo/_shared.js';

/* users.js against the shared book: who may touch whom, passwords never leaving the server,
   and the anchor rule (reactivating a vendor's admin restarts its trial / billing cycle). */

const BOOK = richBook();
const user = id => userOf(BOOK, id);
const status = p => p.then(() => null, e => e.status);
const PNG = 'data:image/png;base64,' + Buffer.from('not-really-a-png').toString('base64');
const JPG = 'data:image/jpeg;base64,' + Buffer.from('not-really-a-jpg').toString('base64');
const profile = (db, id) => db._dump('profiles').find(p => p.id === id);
const vendor = (db, id) => db._dump('vendors').find(v => v.id === id);
const seller = (over) => ({ email: 'new@fromville.tz', name: 'New Person', role: 'seller', handle: 'newbie', password: 'secret1', ...over });

test('contract: the ten user / business-profile functions, eight of them writes', () => {
  assert.deepEqual(Object.keys(FN).sort(), ['addUser', 'businessProfile', 'changePassword', 'deleteUser', 'setBusinessProfile', 'toggleUser', 'updateUser', 'uploadLogo', 'uploadProfilePhoto', 'users']);
  assert.deepEqual([...WRITES].sort(), ['addUser', 'changePassword', 'deleteUser', 'setBusinessProfile', 'toggleUser', 'updateUser', 'uploadLogo', 'uploadProfilePhoto']);
  assert.deepEqual(publicProfile({ id: 'X', name: 'N', password_hash: 'h', password_salt: 's' }).password_hash, undefined);
  assert.deepEqual([toBool(true), toBool('Yes'), toBool('true'), toBool(1), toBool('false'), toBool(''), toBool(null)], [true, true, true, true, false, false, false]);
});

test('users: an admin lists their own people by name, with branch and business names and no secrets', async () => {
  const db = bookDb();
  const { rows } = await FN.users(db, user(ADMIN1), {}, NOW);
  assert.deepEqual(rows.map(r => r.name), ['Asha Seller', 'Frank Amos', 'Gone Seller', 'Juma Seller']);
  assert.ok(rows.every(r => r.password_hash === undefined && r.password_salt === undefined), 'no hash or salt leaves the server');
  assert.ok(rows.every(r => r.vendor_name === 'Fromville Phones'));
  assert.deepEqual(rows.map(r => r.branch_name), ['Kariakoo', '', '', 'Sinza']);
  assert.equal(rows[2].active, false);
  // The legacy searchUsers filter: name, role, handle or business name, case-blind.
  assert.deepEqual((await FN.users(db, user(ADMIN1), { q: 'JuMa' }, NOW)).rows.map(r => r.name), ['Juma Seller']);
  assert.deepEqual((await FN.users(db, user(ADMIN1), { q: 'seller' }, NOW)).rows.map(r => r.name), ['Asha Seller', 'Gone Seller', 'Juma Seller']);
  assert.equal((await FN.users(db, user(ADMIN1), { q: 'fromville' }, NOW)).rows.length, 4);
  assert.equal((await FN.users(db, user(ADMIN1), { q: 'nobody-here' }, NOW)).rows.length, 0);
  // vendor_id sent by an admin is ignored -- pinned to their own business.
  assert.equal((await FN.users(db, user(ADMIN1), { vendor_id: 'V2' }, NOW)).rows.length, 4);
});

test('users: a manager sees everybody or one business; a seller sees nobody', async () => {
  const db = bookDb();
  const all = (await FN.users(db, user(MANAGER), {}, NOW)).rows;
  assert.equal(all.length, 8);
  assert.equal(all.find(r => r.id === 'MGR').vendor_name, '');
  assert.equal(all.find(r => r.id === 'SEL3').vendor_name, 'Mama Ntilie Grocery');
  assert.deepEqual((await FN.users(db, user(MANAGER), { vendor_id: 'V2' }, NOW)).rows.map(r => r.name), ['Mama Ntilie', 'Pili Seller']);
  assert.equal((await FN.users(db, user(MANAGER), { vendor_id: 'ALL' }, NOW)).rows.length, 8);
  assert.equal(await status(FN.users(db, user(SELLER1), {}, NOW)), 403);
});

test('addUser: an admin adds a seller to their own business, hashed, lower-cased, stamped', async () => {
  const db = bookDb();
  const out = await FN.addUser(db, user(ADMIN1), seller({ email: 'New@Fromville.TZ', branch_id: 'B1', vendor_id: 'V2' }), NOW);
  assert.equal(out.user.email, 'new@fromville.tz');
  assert.equal(out.user.vendor_id, 'V1', 'vendor_id sent by an admin is ignored');
  assert.equal(out.user.branch_id, 'B1');
  assert.equal(out.user.active, true);
  assert.equal(out.user.created_at, iso(NOW));
  assert.equal(out.user.password_hash, undefined);
  const row = db._dump('profiles').find(p => p.handle === 'newbie');
  assert.ok(row.password_hash && row.password_salt, 'stored hashed');
  assert.ok(verifyPassword('secret1', row.password_hash, row.password_salt));
  assert.ok(!verifyPassword('secret2', row.password_hash, row.password_salt));
});

test('addUser: refusals -- duplicates (case-blind), bad fields, roles above the caller, foreign branches', async () => {
  const db = bookDb();
  assert.equal(await status(FN.addUser(db, user(ADMIN1), seller({ email: 'FRANK@fromville.tz' }), NOW)), 400);
  assert.equal(await status(FN.addUser(db, user(ADMIN1), seller({ handle: 'JUMA' }), NOW)), 400);
  // A User ID may not be somebody's email, nor an email somebody's User ID: one namespace.
  assert.equal(await status(FN.addUser(db, user(ADMIN1), seller({ handle: 'asha@fromville.tz' }), NOW)), 400);
  assert.equal(await status(FN.addUser(db, user(ADMIN1), seller({ email: 'asha@fromville.tz' }), NOW)), 400);
  assert.equal(await status(FN.addUser(db, user(ADMIN1), seller({ email: 'not-an-email' }), NOW)), 400);
  assert.equal(await status(FN.addUser(db, user(ADMIN1), seller({ handle: 'has space' }), NOW)), 400);
  assert.equal(await status(FN.addUser(db, user(ADMIN1), seller({ password: 'abc' }), NOW)), 400);
  assert.equal(await status(FN.addUser(db, user(ADMIN1), seller({ name: '' }), NOW)), 400);
  assert.equal(await status(FN.addUser(db, user(ADMIN1), seller({ role: 'boss' }), NOW)), 400);
  assert.equal(await status(FN.addUser(db, user(ADMIN1), seller({ role: 'manager' }), NOW)), 403);
  assert.equal(await status(FN.addUser(db, user(ADMIN2), seller({ branch_id: 'B1' }), NOW)), 400, 'B1 belongs to V1, not V2');
  assert.equal(await status(FN.addUser(db, user(SELLER1), seller(), NOW)), 403);
  assert.equal(db._dump('profiles').length, 8, 'nothing was written');
});

test('addUser: a manager creates managers (no business) and vendor users (naming the business)', async () => {
  const db = bookDb();
  const m = await FN.addUser(db, user(MANAGER), seller({ role: 'assistant-manager', handle: 'helper', email: 'helper@samaritan.tz', branch_id: 'B1' }), NOW);
  assert.equal(m.user.vendor_id, null);
  assert.equal(m.user.branch_id, null);
  assert.equal(await status(FN.addUser(db, user(MANAGER), seller(), NOW)), 400, 'a seller needs a business');
  assert.equal(await status(FN.addUser(db, user(MANAGER), seller({ vendor_id: 'nope' }), NOW)), 404);
  const s = await FN.addUser(db, user(MANAGER), seller({ vendor_id: 'V2' }), NOW);
  assert.equal(s.user.vendor_id, 'V2');
});

test('updateUser: an admin edits their own people -- branch kept unless sent, cleared when sent empty', async () => {
  const db = bookDb();
  const base = { id: 'SEL1', email: 'juma@fromville.tz', name: 'Juma K. Seller', role: 'seller', handle: 'juma' };
  const a = await FN.updateUser(db, user(ADMIN1), { ...base, branch_id: 'B2' }, NOW);
  assert.equal(a.user.name, 'Juma K. Seller');
  assert.equal(a.user.branch_id, 'B2');
  assert.equal(profile(db, 'SEL1').branch_id, 'B2');
  const b = await FN.updateUser(db, user(ADMIN1), base, NOW);
  assert.equal(b.user.branch_id, 'B2', 'not sent -> kept');
  const c = await FN.updateUser(db, user(ADMIN1), { ...base, branch_id: '' }, NOW);
  assert.equal(c.user.branch_id, null, 'sent empty -> no branch');
  assert.equal(await status(FN.updateUser(db, user(ADMIN2), { ...base, branch_id: 'B1' }, NOW)), 403, 'not their person');
  assert.equal(await status(FN.updateUser(db, user(ADMIN1), { ...base, handle: 'asha' }, NOW)), 400, 'handle taken');
  assert.equal(await status(FN.updateUser(db, user(ADMIN1), { ...base, email: 'ASHA@fromville.tz' }, NOW)), 400, 'email taken');
  assert.equal(await status(FN.updateUser(db, user(ADMIN1), { ...base, id: 'nobody' }, NOW)), 404);
  assert.equal(await status(FN.updateUser(db, user(ADMIN1), { ...base, id: '' }, NOW)), 400);
});

test('updateUser: managers are out of an admin\'s reach, so are passwords, own role and own active flag', async () => {
  const db = bookDb();
  const mgr = { id: 'MGR', email: 'samaritantechs@gmail.com', name: 'X', role: 'manager', handle: 'markii' };
  assert.equal(await status(FN.updateUser(db, user(ADMIN1), mgr, NOW)), 403);
  const me = { id: 'ADM1', email: 'frank@fromville.tz', name: 'Frank Amos', role: 'admin', handle: 'frank' };
  assert.equal(await status(FN.updateUser(db, user(ADMIN1), { ...me, active: false }, NOW)), 403);
  assert.equal(await status(FN.updateUser(db, user(ADMIN1), { ...me, role: 'seller' }, NOW)), 403);
  assert.equal(await status(FN.updateUser(db, user(ADMIN1), { ...me, role: 'manager' }, NOW)), 403);
  assert.equal(await status(FN.updateUser(db, user(ADMIN1), { ...me, password: 'newpass' }, NOW)), 403);
  assert.equal(profile(db, 'ADM1').password_hash, richBook().profiles[1].password_hash, 'untouched');
  // A manager may set anybody's password.
  await FN.updateUser(db, user(MANAGER), { ...me, password: 'newpass' }, NOW);
  const row = profile(db, 'ADM1');
  assert.ok(verifyPassword('newpass', row.password_hash, row.password_salt));
  assert.ok(!verifyPassword(PASSWORD, row.password_hash, row.password_salt));
  assert.equal(await status(FN.updateUser(db, user(MANAGER), { ...me, password: 'abc' }, NOW)), 400);
  assert.equal(await status(FN.updateUser(db, user(SELLER1), me, NOW)), 403);
});

test('the anchor rule: reactivating a vendor\'s ADMIN restarts its trial / billing cycle; a seller does not', async () => {
  const db = bookDb();
  const before = vendor(db, 'V1').registered_on;
  // A seller coming back moves nothing.
  await FN.toggleUser(db, user(ADMIN1), { id: 'OLD', active: 'true' }, NOW);
  assert.equal(profile(db, 'OLD').active, true);
  assert.equal(vendor(db, 'V1').registered_on, before);
  // The admin, switched off by the manager and switched on again, restarts the clock.
  assert.deepEqual(await FN.toggleUser(db, user(MANAGER), { id: 'ADM1', active: false }, NOW), { message: 'User deactivated.' });
  assert.equal(vendor(db, 'V1').registered_on, before);
  const on = await FN.toggleUser(db, user(MANAGER), { id: 'ADM1', active: 'Yes' }, NOW);
  assert.equal(on.message, 'User activated. The business trial / billing cycle starts again today.');
  assert.equal(vendor(db, 'V1').registered_on, iso(NOW));
  // Already active -> plain message, clock untouched.
  const again = await FN.toggleUser(db, user(MANAGER), { id: 'ADM1', active: true }, NOW);
  assert.equal(again.message, 'User activated.');
  // The same rule through updateUser.
  const db2 = bookDb();
  profile(db2, 'ADM1').active = false;
  await FN.updateUser(db2, user(MANAGER), { id: 'ADM1', email: 'frank@fromville.tz', name: 'Frank Amos', role: 'admin', handle: 'frank', active: true }, NOW);
  assert.equal(vendor(db2, 'V1').registered_on, iso(NOW));
});

test('toggleUser: scope is the same as updateUser', async () => {
  const db = bookDb();
  await FN.toggleUser(db, user(ADMIN1), { id: 'SEL1', active: false }, NOW);
  assert.equal(profile(db, 'SEL1').active, false);
  assert.equal(await status(FN.toggleUser(db, user(ADMIN1), { id: 'ADM1', active: false }, NOW)), 403, 'not yourself');
  assert.equal(await status(FN.toggleUser(db, user(ADMIN1), { id: 'ADM2', active: false }, NOW)), 403, 'not another business');
  assert.equal(await status(FN.toggleUser(db, user(ADMIN1), { id: 'MGR', active: false }, NOW)), 403, 'not a manager');
  assert.equal(await status(FN.toggleUser(db, user(SELLER1), { id: 'SEL2', active: false }, NOW)), 403);
  assert.equal(await status(FN.toggleUser(db, user(MANAGER), { id: 'nobody', active: false }, NOW)), 404);
});

test('deleteUser: manager only, never yourself, and their sessions go with them', async () => {
  const db = bookDb();
  assert.equal(await status(FN.deleteUser(db, user(ADMIN1), { id: 'OLD' }, NOW)), 403);
  assert.equal(await status(FN.deleteUser(db, user(MANAGER), { id: 'MGR' }, NOW)), 403);
  assert.equal(await status(FN.deleteUser(db, user(MANAGER), { id: 'nobody' }, NOW)), 404);
  assert.deepEqual(await FN.deleteUser(db, user(MANAGER), { id: 'ADM1' }, NOW), { message: 'User deleted.' });
  assert.equal(profile(db, 'ADM1'), undefined);
  assert.deepEqual(db._dump('sessions').filter(s => s.profile_id === 'ADM1'), []);
  assert.equal(db._dump('sessions').length, 4);
});

test('uploadProfilePhoto: yourself, an admin for their own people, a manager for anybody', async () => {
  const db = bookDb();
  const me = await FN.uploadProfilePhoto(db, user(SELLER1), { profile_id: 'SEL1', data_url: PNG }, NOW);
  assert.match(me.url, /^https:\/\/test\.invalid\/storage\/v1\/object\/public\/profile-photos\/SEL1\.png\?v=\d+$/);
  assert.equal(profile(db, 'SEL1').profile_photo_url, me.url);
  assert.ok(db._storageDump('profile-photos')['SEL1.png']);
  const theirs = await FN.uploadProfilePhoto(db, user(ADMIN1), { profile_id: 'SEL2', data_url: JPG }, NOW);
  assert.match(theirs.url, /SEL2\.jpg\?v=/);
  assert.match((await FN.uploadProfilePhoto(db, user(MANAGER), { profile_id: 'ADM2', data_url: PNG }, NOW)).url, /ADM2\.png/);
  assert.equal(await status(FN.uploadProfilePhoto(db, user(SELLER1), { profile_id: 'SEL2', data_url: PNG }, NOW)), 403);
  assert.equal(await status(FN.uploadProfilePhoto(db, user(ADMIN1), { profile_id: 'ADM2', data_url: PNG }, NOW)), 403);
  assert.equal(await status(FN.uploadProfilePhoto(db, user(SELLER1), { profile_id: 'SEL1', data_url: 'hello' }, NOW)), 400);
  assert.equal(await status(FN.uploadProfilePhoto(db, user(SELLER1), { profile_id: 'SEL1', data_url: 'data:text/plain;base64,aGk=' }, NOW)), 400);
  assert.equal(await status(FN.uploadProfilePhoto(db, user(SELLER1), { profile_id: 'nobody', data_url: PNG }, NOW)), 404);
});

test('changePassword: own account, against the current one', async () => {
  const db = bookDb();
  assert.equal(await status(FN.changePassword(db, user(SELLER1), { current: 'wrong', password: 'brandnew' }, NOW)), 400);
  assert.equal(await status(FN.changePassword(db, user(SELLER1), { current: PASSWORD, password: 'abc' }, NOW)), 400);
  // A stolen token outlives a password by up to thirty days, so changing one revokes them all.
  db._dump('sessions').push({ token: 'stolen', profile_id: 'SEL1', created_at: NOW, expires_at: '2026-10-01T00:00:00.000Z', last_seen_at: NOW });
  const before = db._dump('sessions').length;
  const out = await FN.changePassword(db, user(SELLER1), { current: PASSWORD, password: 'brandnew' }, NOW);
  assert.match(out.message, /Password changed/);
  assert.equal(out.signed_out, true, 'the page is told, so it can send them to sign in');
  assert.deepEqual(db._dump('sessions').filter(s2 => s2.profile_id === 'SEL1'), [], 'every device of theirs is signed out');
  assert.ok(db._dump('sessions').length < before);
  assert.ok(db._dump('sessions').some(s2 => s2.profile_id === 'ADM1'), 'and nobody else is touched');
  const row = profile(db, 'SEL1');
  assert.ok(verifyPassword('brandnew', row.password_hash, row.password_salt));
  assert.ok(!verifyPassword(PASSWORD, row.password_hash, row.password_salt));
  assert.equal(profile(db, 'SEL2').password_hash, richBook().profiles[3].password_hash, 'nobody else moved');
});

test('businessProfile / setBusinessProfile: the vendor row, currency normalised, admins only to write', async () => {
  const db = bookDb();
  const { vendor: v } = await FN.businessProfile(db, user(ADMIN1), {}, NOW);
  assert.deepEqual(Object.keys(v).sort(), VENDOR_COLS.split(',').map(s => s.trim()).sort());
  assert.equal(v.name, 'Fromville Phones');
  assert.equal((await FN.businessProfile(db, user(SELLER1), {}, NOW)).vendor.id, 'V1', 'a seller may read their business');
  assert.equal(await status(FN.businessProfile(db, user(MANAGER), {}, NOW)), 400);
  const set = await FN.setBusinessProfile(db, user(ADMIN1), { business_type: ' Phones ', phone: '0756 000 001', address: 'Sinza Mori', currency: 'usd' }, NOW);
  assert.equal(set.vendor.business_type, 'Phones');
  assert.equal(set.vendor.currency, 'USD');
  assert.equal(vendor(db, 'V1').address, 'Sinza Mori');
  assert.equal((await FN.setBusinessProfile(db, user(ADMIN1), { currency: '' }, NOW)).vendor.currency, 'TZS');
  assert.equal(vendor(db, 'V1').business_type, '', 'a blank field is written blank, as the form sent it');
  assert.equal(await status(FN.setBusinessProfile(db, user(ADMIN1), { currency: 'dollars' }, NOW)), 400);
  assert.equal(await status(FN.setBusinessProfile(db, user(SELLER1), { phone: '1' }, NOW)), 403);
  assert.equal(await status(FN.setBusinessProfile(db, user(MANAGER), { phone: '1' }, NOW)), 400);
});

test('uploadLogo: an admin\'s own business whatever they sent; a manager names one', async () => {
  const db = bookDb();
  const a = await FN.uploadLogo(db, user(ADMIN1), { vendor_id: 'V2', data_url: JPG }, NOW);
  assert.match(a.url, /\/logos\/V1\.jpg\?v=\d+$/);
  assert.equal(vendor(db, 'V1').logo_url, a.url);
  assert.notEqual(vendor(db, 'V2').logo_url, a.url);
  const m = await FN.uploadLogo(db, user(MANAGER), { vendor_id: 'V2', data_url: PNG }, NOW);
  assert.match(m.url, /\/logos\/V2\.png/);
  assert.equal(vendor(db, 'V2').logo_url, m.url);
  assert.equal(await status(FN.uploadLogo(db, user(MANAGER), { data_url: PNG }, NOW)), 400);
  assert.equal(await status(FN.uploadLogo(db, user(MANAGER), { vendor_id: 'nope', data_url: PNG }, NOW)), 404);
  assert.equal(await status(FN.uploadLogo(db, user(SELLER1), { data_url: PNG }, NOW)), 403);
  assert.equal(await status(FN.uploadLogo(db, user(ADMIN1), { data_url: 'x' }, NOW)), 400);
});
