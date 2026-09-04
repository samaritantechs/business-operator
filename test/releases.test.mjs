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
