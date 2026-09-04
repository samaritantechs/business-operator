import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookDb, richBook, emptyBook, NOW, PASSWORD } from './_book.mjs';
import { accountApi, ACCOUNT_FUNCTIONS, FN } from '../api/_lib/bo/account.js';
import { SESSION_DAYS, verifyPassword } from '../api/_lib/auth.js';
import { APP_NAME } from '../api/_lib/brand.js';

/* The doors before a session: who gets in, who is refused with the one generic sentence, and
   the register / reset flows end to end against the fake PostgREST. */

const BAD = 'Invalid credentials or inactive account.';
const login = (db, id, password, deps) => accountApi(db, 'login', { id, password }, NOW, deps || {});
const rejects = (p, status, re) => assert.rejects(p, e => { assert.equal(e.status, status, 'status of: ' + e.message); if (re) assert.match(e.message, re); return true; });

test('the contract names exactly eight account functions', () => {
  assert.deepEqual(ACCOUNT_FUNCTIONS.slice().sort(), ['login', 'logout', 'me', 'register', 'requestReset', 'resetPassword', 'setupManager', 'setupState']);
  assert.equal(Object.keys(FN).length, 8);
});

test('login by handle mints a session and answers with the boot payload', async () => {
  const db = bookDb();
  const out = await login(db, 'frank', PASSWORD, { userAgent: 'test-ua' });
  assert.equal(typeof out.token, 'string');
  assert.equal(out.token.length, 48);
  assert.equal(out.user.id, 'ADM1');
  assert.equal(out.user.is_admin, true);
  assert.equal(out.user.password_hash, undefined);
  assert.equal(out.user.password_salt, undefined);
  assert.equal(out.vendor.id, 'V1');
  assert.deepEqual(out.perms, { canDownloadReport: true, showDashboard: true });
  assert.ok(Array.isArray(out.hints) && Array.isArray(out.branches) && Array.isArray(out.partners));
  const s = db._dump('sessions').find(r => r.token === out.token);
  assert.ok(s, 'session row written');
  assert.equal(s.profile_id, 'ADM1');
  assert.equal(s.user_agent, 'test-ua');
  assert.equal(s.expires_at, new Date(NOW + SESSION_DAYS * 86400000).toISOString());
});

test('login by email, and by either in the wrong case', async () => {
  const db = bookDb();
  assert.equal((await login(db, 'frank@fromville.tz', PASSWORD)).user.id, 'ADM1');
  assert.equal((await login(db, 'FRANK', PASSWORD)).user.id, 'ADM1');
  assert.equal((await login(db, 'Frank@Fromville.TZ', PASSWORD)).user.id, 'ADM1');
  assert.equal((await login(db, '  juma  ', PASSWORD)).user.id, 'SEL1');
  const m = await login(db, 'markii', PASSWORD);
  assert.equal(m.user.is_manager, true);
  assert.equal(m.vendor, null);
});

test('a LIKE wildcard in the id matches nothing, not somebody', async () => {
  const db = bookDb();
  await rejects(login(db, '%', PASSWORD), 401, /Invalid credentials/);
  await rejects(login(db, 'fran_', PASSWORD), 401);
});

test('wrong password, unknown id, inactive profile and inactive vendor all get the same 401', async () => {
  const db = bookDb();
  await rejects(login(db, 'frank', 'nope1234'), 401, new RegExp(BAD));
  await rejects(login(db, 'nobody', PASSWORD), 401, new RegExp(BAD));
  await rejects(login(db, 'gone', PASSWORD), 401, new RegExp(BAD));           // OLD: active false
  await rejects(login(db, 'old@fromville.tz', PASSWORD), 401);
  const book = richBook();
  book.vendors.find(v => v.id === 'V1').active = false;
  const db2 = bookDb(book);
  await rejects(login(db2, 'frank', PASSWORD), 401, new RegExp(BAD));
  await rejects(login(db2, 'juma', PASSWORD), 401);
  assert.equal((await login(db2, 'markii', PASSWORD)).user.id, 'MGR');       // a manager has no vendor to be inactive
});

test('blank credentials are a 400, not a 401', async () => {
  const db = bookDb();
  await rejects(login(db, '', PASSWORD), 400);
  await rejects(login(db, 'frank', ''), 400);
  await rejects(accountApi(db, 'nothing', {}, NOW), 400, /Unknown account function/);
});

test('me: a live token answers the boot payload (no token key), an expired one is a 401', async () => {
  const db = bookDb();
  const out = await accountApi(db, 'me', { token: 'tok-sel1' }, NOW);
  assert.equal(out.user.id, 'SEL1');
  assert.equal('token' in out, false);
  assert.equal(out.vendor.id, 'V1');
  await rejects(accountApi(db, 'me', { token: 'tok-expired' }, NOW), 401, /expired/);
  await rejects(accountApi(db, 'me', { token: 'no-such' }, NOW), 401);
  await rejects(accountApi(db, 'me', {}, NOW), 401);
});

test('logout deletes the session row and the token stops working', async () => {
  const db = bookDb();
  assert.deepEqual(await accountApi(db, 'logout', { token: 'tok-adm1' }, NOW), {});
  assert.equal(db._dump('sessions').some(r => r.token === 'tok-adm1'), false);
  await rejects(accountApi(db, 'me', { token: 'tok-adm1' }, NOW), 401);
  assert.deepEqual(await accountApi(db, 'logout', {}, NOW), {});          // nothing to do is not an error
});

const REG = { business_name: 'Kilimanjaro Spares', business_type: 'Auto parts', phone: '255700000123', address: 'Moshi',
  admin_email: 'Owner@Kili.tz', admin_name: 'Neema Owner', admin_handle: 'neema', password: 'secret1' };

test('register: a vendor and its admin, active at once under free registration', async () => {
  const db = bookDb();
  const out = await accountApi(db, 'register', REG, NOW);
  assert.deepEqual(out, { message: 'Business registered! You can now log in.', active: true });
  const v = db._dump('vendors').find(x => x.name === 'Kilimanjaro Spares');
  assert.ok(v);
  assert.equal(v.legacy_name, 'Kilimanjaro Spares');
  assert.equal(v.business_type, 'Auto parts');
  assert.equal(v.phone, '255700000123');
  assert.equal(v.currency, 'TZS');
  assert.equal(v.registered_on, new Date(NOW).toISOString());
  assert.equal(v.active, true);
  assert.equal(v.restricted, false);
  assert.deepEqual(v.permissions, {});
  const p = db._dump('profiles').find(x => x.handle === 'neema');
  assert.ok(p);
  assert.equal(p.email, 'owner@kili.tz');
  assert.equal(p.role, 'admin');
  assert.equal(p.vendor_id, v.id);
  assert.equal(p.active, true);
  assert.ok(p.password_hash && p.password_salt);
  assert.notEqual(p.password_hash, 'secret1');
  const signed = await login(db, 'neema', 'secret1');
  assert.equal(signed.vendor.id, v.id);
  assert.equal(signed.user.role, 'admin');
});

test('register refuses a duplicate email or handle (any case) and a taken business name', async () => {
  const db = bookDb();
  await rejects(accountApi(db, 'register', { ...REG, admin_email: 'FRANK@fromville.tz' }, NOW), 400, /already exists/);
  await rejects(accountApi(db, 'register', { ...REG, admin_handle: 'Juma' }, NOW), 400, /already taken/);
  await rejects(accountApi(db, 'register', { ...REG, business_name: 'fromville phones' }, NOW), 400, /already registered/);
  assert.equal(db._dump('vendors').length, 3, 'nothing was written');
});

test('register validates its fields', async () => {
  const db = bookDb();
  await rejects(accountApi(db, 'register', { ...REG, business_name: '' }, NOW), 400, /Business name/);
  await rejects(accountApi(db, 'register', { ...REG, admin_email: 'not-an-email' }, NOW), 400, /valid email/);
  await rejects(accountApi(db, 'register', { ...REG, admin_name: ' ' }, NOW), 400, /Admin name/);
  await rejects(accountApi(db, 'register', { ...REG, admin_handle: 'two words' }, NOW), 400, /spaces/);
  await rejects(accountApi(db, 'register', { ...REG, password: '123' }, NOW), 400, /at least 4/);
  assert.equal(db._dump('profiles').length, 8);
});

test('register with FreeRegistration=No parks the account until the manager activates it', async () => {
  const book = richBook();
  book.settings.find(s => s.key === 'FreeRegistration').value = 'No';
  const db = bookDb(book);
  const out = await accountApi(db, 'register', REG, NOW);
  assert.equal(out.active, false);
  assert.match(out.message, /system manager will activate/);
  assert.equal(db._dump('vendors').find(x => x.name === 'Kilimanjaro Spares').active, false);
  assert.equal(db._dump('profiles').find(x => x.handle === 'neema').active, false);
  await rejects(login(db, 'neema', 'secret1'), 401, new RegExp(BAD));
});

/* ---------------------------------------------------------------- password reset */
function withEnv(patch, fn) {
  const saved = {};
  for (const k of Object.keys(patch)) { saved[k] = process.env[k]; if (patch[k] === undefined) delete process.env[k]; else process.env[k] = patch[k]; }
  const restore = () => { for (const k of Object.keys(patch)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
  return Promise.resolve().then(fn).finally(restore);
}
function fetchStub(calls) {
  return async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body), headers: opts.headers }); return { ok: true, status: 200, json: async () => ({ id: 'em_1' }) }; };
}

test('reset flow end to end: request -> email with the link -> new password -> old sessions gone', async () => {
  await withEnv({ RESEND_API_KEY: 'x', APP_URL: 'https://bo.test' }, async () => {
    const db = bookDb();
    const calls = [];
    const out = await accountApi(db, 'requestReset', { email: 'FRANK@fromville.tz' }, NOW, { fetch: fetchStub(calls) });
    assert.equal(out.message, 'If that email has an account, a reset link has been sent (valid 10 minutes).');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].headers.Authorization, 'Bearer x');
    assert.deepEqual(calls[0].body.to, ['frank@fromville.tz']);
    assert.equal(calls[0].body.subject, '🔑 Password Reset – ' + APP_NAME);
    const m = calls[0].body.html.match(/https:\/\/bo\.test\/\?reset=([0-9a-f]+)/);
    assert.ok(m, 'the link is in the email');
    const token = m[1];
    const row = db._dump('password_resets').find(r => r.token === token);
    assert.ok(row);
    assert.equal(row.profile_id, 'ADM1');
    assert.equal(row.expires_at, new Date(NOW + 600000).toISOString());
    assert.equal(row.used_at, undefined);

    const done = await accountApi(db, 'resetPassword', { token, password: 'newpass99' }, NOW + 300000);
    assert.equal(done.message, 'Password updated. You can now log in.');
    assert.equal(db._dump('password_resets').find(r => r.token === token).used_at, new Date(NOW + 300000).toISOString());
    assert.equal(db._dump('sessions').some(r => r.profile_id === 'ADM1'), false, 'every device of that account is signed out');
    assert.ok(db._dump('sessions').some(r => r.token === 'tok-sel1'), 'other people keep their sessions');
    assert.equal((await login(db, 'frank', 'newpass99')).user.id, 'ADM1');
    await rejects(login(db, 'frank', PASSWORD), 401);
    await rejects(accountApi(db, 'resetPassword', { token, password: 'again999' }, NOW + 400000), 400, /Invalid or expired/);
  });
});

test('reset refuses an expired, unknown or missing token and a short password', async () => {
  await withEnv({ RESEND_API_KEY: 'x' }, async () => {
    const db = bookDb();
    const calls = [];
    await accountApi(db, 'requestReset', { email: 'juma@fromville.tz' }, NOW, { fetch: fetchStub(calls) });
    const token = db._dump('password_resets')[0].token;
    assert.match(calls[0].body.html, new RegExp('/\\?reset=' + token), 'APP_URL unset: the link is relative');
    await rejects(accountApi(db, 'resetPassword', { token, password: 'newpass99' }, NOW + 601000), 400, /Invalid or expired/);
    await rejects(accountApi(db, 'resetPassword', { token: 'nope', password: 'newpass99' }, NOW), 400, /Invalid or expired/);
    await rejects(accountApi(db, 'resetPassword', { password: 'newpass99' }, NOW), 400, /Invalid or expired/);
    await rejects(accountApi(db, 'resetPassword', { token, password: '123' }, NOW), 400, /at least 4/);
    assert.equal((await login(db, 'juma', PASSWORD)).user.id, 'SEL1', 'the password did not change');
  });
});

test('requestReset says the same thing for an unknown email and sends nothing', async () => {
  await withEnv({ RESEND_API_KEY: 'x' }, async () => {
    const db = bookDb();
    const calls = [];
    const out = await accountApi(db, 'requestReset', { email: 'stranger@example.com' }, NOW, { fetch: fetchStub(calls) });
    assert.match(out.message, /If that email has an account/);
    assert.equal(calls.length, 0);
    assert.equal(db._dump('password_resets').length, 0);
    await rejects(accountApi(db, 'requestReset', { email: '' }, NOW, { fetch: fetchStub(calls) }), 400);
  });
});

test('requestReset without an email provider is an honest 400', async () => {
  await withEnv({ RESEND_API_KEY: undefined }, async () => {
    const db = bookDb();
    await rejects(accountApi(db, 'requestReset', { email: 'frank@fromville.tz' }, NOW, {}), 400, /not configured/);
  });
});

test('an empty database can still register its first business and sign in', async () => {
  const db = bookDb(emptyBook());
  await accountApi(db, 'register', REG, NOW);
  const out = await login(db, 'owner@kili.tz', 'secret1');
  assert.equal(out.user.handle, 'neema');
  assert.deepEqual(out.branches, []);
  assert.deepEqual(out.partners, []);
  assert.equal(out.hints.length, 9, 'the admin default hints');
});

/* ------------------------------------------------------------------ the first run
   A brand-new database has nobody in it. This is the one door that can make a manager, and
   it has to be shut the moment one exists -- otherwise the first stranger to find the URL
   owns the system. Both conditions are tested here, together and separately. */

test('setupState: a fresh system asks to be set up; one with a manager never does', async () => {
  process.env.BO_SETUP_KEY = 'the-deployment-key';
  assert.deepEqual(await FN.setupState(bookDb(emptyBook())), { needed: true, keyless: false });
  assert.deepEqual(await FN.setupState(bookDb()), { needed: false, keyless: false });
  // A vendor admin is not a manager: a system with businesses but no manager still needs one.
  const noMgr = richBook();
  noMgr.profiles = noMgr.profiles.filter(p => p.role !== 'manager' && p.role !== 'assistant-manager');
  assert.deepEqual(await FN.setupState(bookDb(noMgr)), { needed: true, keyless: false });
  // And it says plainly when the deployment has no key to check against.
  delete process.env.BO_SETUP_KEY; delete process.env.BO_SECRET;
  assert.deepEqual(await FN.setupState(bookDb(emptyBook())), { needed: true, keyless: true });
  assert.deepEqual(await FN.setupState(bookDb()), { needed: false, keyless: false });
});

test('setupManager: the key AND an empty system, or nothing happens', async () => {
  const good = { setup_key: 'the-deployment-key', email: 'boss@samaritan.tz', name: 'Markii', handle: 'markii', password: 'a-long-one' };

  // No key configured on the deployment at all -> refused, and it says what to set.
  delete process.env.BO_SETUP_KEY; delete process.env.BO_SECRET;
  await rejects(FN.setupManager(bookDb(emptyBook()), good, NOW), 400, /BO_SETUP_KEY/);

  process.env.BO_SETUP_KEY = 'the-deployment-key';
  // Wrong key -> 401, and nothing is written.
  const db1 = bookDb(emptyBook());
  await rejects(FN.setupManager(db1, { ...good, setup_key: 'guess' }, NOW), 401, /setup key/);
  await rejects(FN.setupManager(db1, { ...good, setup_key: '' }, NOW), 401);
  assert.equal(db1._dump('profiles').length, 0, 'a wrong key writes nothing');

  // A system that already has a manager -> 403 even WITH the right key.
  await rejects(FN.setupManager(bookDb(), good, NOW), 403, /already has a manager/);

  // The real thing: creates the manager and signs them in.
  const db = bookDb(emptyBook());
  const out = await FN.setupManager(db, good, NOW, { userAgent: 'test' });
  assert.ok(out.token, 'signed straight in');
  assert.equal(out.user.role, 'manager');
  assert.equal(out.user.handle, 'markii');
  assert.equal(out.user.vendor_id, null, 'a manager belongs to no business');
  const row = db._dump('profiles')[0];
  assert.equal(row.active, true);
  assert.ok(row.password_hash && row.password_salt, 'hashed, never stored readable');
  assert.equal(row.password, undefined);
  assert.ok(verifyPassword('a-long-one', row.password_hash, row.password_salt));
  assert.equal(db._dump('sessions').length, 1);

  // And now the door is shut, with the same key that just worked.
  await rejects(FN.setupManager(db, { ...good, email: 'other@x.tz', handle: 'other' }, NOW), 403);
  assert.deepEqual(await FN.setupState(db), { needed: false, keyless: false });
});

test('setupManager: BO_SECRET stands in when BO_SETUP_KEY is not set, and the fields are checked', async () => {
  delete process.env.BO_SETUP_KEY;
  process.env.BO_SECRET = 'the-signing-secret';
  const good = { setup_key: 'the-signing-secret', email: 'boss@samaritan.tz', name: 'Markii', handle: 'markii', password: 'a-long-one' };
  const db = bookDb(emptyBook());
  await rejects(FN.setupManager(db, { ...good, email: 'not-an-email' }, NOW), 400, /valid email/);
  await rejects(FN.setupManager(db, { ...good, handle: 'has space' }, NOW), 400, /spaces/);
  await rejects(FN.setupManager(db, { ...good, password: 'ab' }, NOW), 400, /at least/);
  await rejects(FN.setupManager(db, { ...good, name: '' }, NOW), 400);
  assert.equal(db._dump('profiles').length, 0);
  assert.ok((await FN.setupManager(db, good, NOW)).token, 'BO_SECRET is accepted as the key');
  delete process.env.BO_SECRET;
});

/* A User ID and an email are ONE namespace, because the sign-in box takes either and resolves
   both against both columns -- handle first. Checking a new handle only against other handles
   let a stranger register with somebody else's email AS their User ID, after which every
   sign-in with that email reached the stranger's row: their password worked and the real
   owner's did not. */
test('register: an identifier nobody else answers to, in either column', async () => {
  const db = bookDb();
  const shop = { business_name: 'Impostor Shop', admin_email: 'evil@x.tz', admin_name: 'Evil', admin_handle: 'frank@fromville.tz', password: 'pass1234' };
  await rejects(FN.register(db, shop, NOW), 400, /User ID is already taken/);
  await rejects(FN.register(db, { ...shop, admin_handle: 'FRANK@FROMVILLE.TZ' }, NOW), 400, /already taken/);
  await rejects(FN.register(db, { ...shop, admin_handle: 'evil2', admin_email: 'FRANK@fromville.tz' }, NOW), 400, /email already exists/);
  assert.equal(db._dump('profiles').length, 8, 'nothing was written');

  // The real owner still signs in with his own email, by either spelling.
  assert.equal((await FN.login(db, { id: 'frank@fromville.tz', password: PASSWORD }, NOW, {})).user.id, 'ADM1');
  assert.equal((await FN.login(db, { id: 'frank', password: PASSWORD }, NOW, {})).user.id, 'ADM1');
  // And an honest registration is untouched.
  const ok = await FN.register(db, { business_name: 'Honest Shop', admin_email: 'new@x.tz', admin_name: 'New', admin_handle: 'newshop', password: 'pass1234' }, NOW);
  assert.match(ok.message, /registered/);
});
