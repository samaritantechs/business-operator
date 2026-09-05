import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookDb, richBook, emptyBook, userOf, NOW, MANAGER, ADMIN1, SELLER1 } from './_book.mjs';
import { FN, WRITES, currentRelease, publicRelease } from '../api/_lib/bo/releases.js';

/* The Android app is a window onto this site, so ordinary updates need no APK at all. These
   are the rules for the rare rebuild: one current release, a version code that only goes up,
   and never a row pointing at a file that is not there. */

const BOOK = richBook();
const user = id => userOf(BOOK, id);
const status = p => p.then(() => null, e => e.status);

/** A fake whose storage knows about one uploaded object, the way Supabase would report it. */
function dbWith(files = [], seed) {
  const db = bookDb(seed || emptyBook());
  const store = files.slice();
  db.storage = { from: () => ({
    list: async (_p, opts) => ({ data: store.filter(f => !opts || !opts.search || f.name === opts.search), error: null }),
    createSignedUploadUrl: async (name) => ({ data: { signedUrl: 'https://upload.example/' + name, token: 'tok', path: name }, error: null }),
  }) };
  return db;
}
const APK = { name: 'samaritan-industrial-1.3-4.apk', metadata: { size: 12345678 } };

test('the contract: five functions, three of them writes', () => {
  assert.deepEqual(Object.keys(FN).sort(), ['appRelease', 'publishRelease', 'releaseUploadUrl', 'releases', 'rollbackRelease']);
  assert.deepEqual([...WRITES].sort(), ['publishRelease', 'releaseUploadUrl', 'rollbackRelease']);
  assert.equal(publicRelease(null), null);
});

test('appRelease: nothing published yet is null, not an error', async () => {
  assert.deepEqual(await FN.appRelease(dbWith()), { release: null });
  assert.equal(await currentRelease(dbWith()), null);
});

test('publishRelease: records an uploaded APK and makes it the one /download hands out', async () => {
  const db = dbWith([APK]);
  const out = await FN.publishRelease(db, user(MANAGER), { version_name: '1.3', version_code: 4, file_name: APK.name, notes: 'First build' }, NOW);
  assert.equal(out.release.version_name, '1.3');
  assert.equal(out.release.version_code, 4);
  assert.match(out.release.url, /\/storage\/v1\/object\/public\/app-releases\/samaritan-industrial-1\.3-4\.apk$/);
  assert.equal(out.release.size_bytes, 12345678, 'the size comes off the uploaded object when not given');
  const row = db._dump('app_releases')[0];
  assert.equal(row.is_current, true);
  assert.equal(row.published_by, 'MGR');
  assert.deepEqual((await FN.appRelease(db)).release.version_code, 4);
});

test('publishRelease: never points at a file that is not there, and never repeats a version code', async () => {
  const db = dbWith([APK]);
  // Nothing uploaded under that name.
  assert.equal(await status(FN.publishRelease(db, user(MANAGER), { version_name: '9.9', version_code: 99 }, NOW)), 400);
  assert.equal(db._dump('app_releases').length, 0, 'and nothing was written');

  await FN.publishRelease(db, user(MANAGER), { version_name: '1.3', version_code: 4, file_name: APK.name }, NOW);
  // Android refuses to install over an equal or lower version code, so we refuse first.
  assert.equal(await status(FN.publishRelease(db, user(MANAGER), { version_name: '1.4', version_code: 4, file_name: APK.name }, NOW)), 400);
  assert.equal(await status(FN.publishRelease(db, user(MANAGER), { version_name: '1.4', version_code: 0, file_name: APK.name }, NOW)), 400);
  assert.equal(await status(FN.publishRelease(db, user(MANAGER), { version_name: '', version_code: 5, file_name: APK.name }, NOW)), 400);
  assert.equal(await status(FN.publishRelease(db, user(MANAGER), { version_name: '1.4', version_code: 5, file_name: 'notes.txt' }, NOW)), 400);
  assert.equal(db._dump('app_releases').length, 1);
});

test('publishRelease: exactly one release is ever current', async () => {
  const two = { name: 'samaritan-industrial-1.4-5.apk', metadata: { size: 999 } };
  const db = dbWith([APK, two]);
  await FN.publishRelease(db, user(MANAGER), { version_name: '1.3', version_code: 4, file_name: APK.name }, NOW);
  await FN.publishRelease(db, user(MANAGER), { version_name: '1.4', version_code: 5, file_name: two.name }, NOW);
  const all = db._dump('app_releases');
  assert.equal(all.length, 2);
  assert.deepEqual(all.filter(r => r.is_current).map(r => r.version_code), [5], 'the older one stood down');
  assert.equal((await FN.appRelease(db)).release.version_code, 5);

  // And a bad build can be put back behind the good one.
  const older = all.find(r => r.version_code === 4);
  const back = await FN.rollbackRelease(db, user(MANAGER), { id: older.id }, NOW);
  assert.equal(back.release.version_code, 4);
  assert.deepEqual(db._dump('app_releases').filter(r => r.is_current).map(r => r.version_code), [4]);
  assert.equal(await status(FN.rollbackRelease(db, user(MANAGER), { id: 'nope' }, NOW)), 404);
});

test('releaseUploadUrl: a signed URL so the APK never comes through the API body', async () => {
  const db = dbWith();
  const out = await FN.releaseUploadUrl(db, user(MANAGER), { version_name: '1.3', version_code: 4 }, NOW);
  assert.equal(out.file_name, 'samaritan-industrial-1.3-4.apk');
  assert.match(out.upload_url, /^https:\/\/upload\.example\//);
  assert.equal(await status(FN.releaseUploadUrl(db, user(MANAGER), { version_name: '1.3', version_code: 0 }, NOW)), 400);
});

test('only the manager publishes; anybody signed in may ask what the current build is', async () => {
  const db = dbWith([APK]);
  for (const who of [ADMIN1, SELLER1]) {
    assert.equal(await status(FN.publishRelease(db, user(who), { version_name: '1.3', version_code: 4, file_name: APK.name }, NOW)), 403);
    assert.equal(await status(FN.releaseUploadUrl(db, user(who), { version_name: '1.3', version_code: 4 }, NOW)), 403);
    assert.equal(await status(FN.rollbackRelease(db, user(who), { id: 'x' }, NOW)), 403);
    assert.equal(await status(FN.releases(db, user(who), {}, NOW)), 403);
    assert.deepEqual(await FN.appRelease(db, user(who), {}, NOW), { release: null }, 'but the download link is everybody\'s');
  }
});

/* ------------------------------------------------------- a database without the table at all */

/* `app_releases` went into db/schema.sql and never got a RUN-ME file, so a database created
   before it existed does not have it -- and PostgREST refuses the whole query for a missing
   TABLE exactly as it does for a missing column: PGRST205, "Could not find the table
   'public.app_releases' in the schema cache". CLAUDE.md: "Every code path that depends on a
   migration must work without it -- fall back, never fail." Three of these did not. */

const noTable = (book = richBook()) => bookDb(book, { missingTables: ['app_releases'] });

test('the MARKETPLACE does not go down because the app has never been published', async () => {
  /* The worst of the three by a distance. The storefront is public, it is what a customer sees,
     and the release rides its payload -- so one absent table took the whole shop window with
     it, on a database that is otherwise completely healthy. */
  const { FN: MARKET } = await import('../api/_lib/bo/market.js');
  const db = noTable();
  const r = await MARKET.market(db, {}, NOW);
  assert.ok(r.products.length, 'the products are still there');
  assert.ok(r.vendors.length, 'and the businesses');
  assert.equal(r.release, null, 'there is simply no app to download');
});

test('and neither does the phone asking whether it is out of date', async () => {
  const db = noTable();
  assert.deepEqual(await FN.appRelease(db), { release: null });
  assert.equal(await currentRelease(db), null);
});

test('the manager SEES why the Android screen is empty, instead of a schema-cache error', async () => {
  /* This screen is the one place the answer belongs: it is about releases, so "the table is not
     there" is the honest answer and the fix is a paste away. What it must not do is show
     PostgREST's own words to somebody who has never heard of a schema cache. */
  const db = noTable();
  const r = await FN.releases(db, user(MANAGER));
  assert.deepEqual(r.rows, []);
  assert.equal(r.missing_table, true);
  assert.match(r.notice, /RUN-ME-003/);
});

test('and publishing REFUSES clearly rather than half-writing a release', async () => {
  const db = dbWith([APK], emptyBook());
  const broken = { ...db, from: noTable(emptyBook()).from };
  await assert.rejects(
    FN.publishRelease(broken, user(MANAGER), { version_name: '1.3', version_code: 4, file_name: APK.name }, NOW),
    e => { assert.equal(e.status, 400); assert.match(e.message, /RUN-ME-003/); return true; });
});
