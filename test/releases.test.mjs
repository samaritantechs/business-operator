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

test('the contract: one function, and it only reads', () => {
  /* Publishing left this file for .github/workflows/android-apk.yml, and the Settings card
     that used to drive it went with it. A second way to publish is a way for the two to
     disagree -- a hand-typed version code colliding with the workflow's run number tells every
     phone it is permanently out of date, and Android never forgets a code it has seen. What is
     left is the reading half, which /download, the marketplace and the app's update check all
     need. */
  assert.deepEqual(Object.keys(FN).sort(), ['appRelease']);
  assert.deepEqual([...WRITES], [], 'nothing here writes any more');
  assert.equal(publicRelease(null), null);
});

test('appRelease: nothing published yet is null, not an error', async () => {
  assert.deepEqual(await FN.appRelease(dbWith()), { release: null });
  assert.equal(await currentRelease(dbWith()), null);
});

/* ------------------------------------------------------- a database without the table at all */

/* `app_releases` went into db/schema.sql and never got a RUN-ME file, so a database created
   before it existed does not have it -- and PostgREST refuses the whole query for a missing
   TABLE exactly as it does for a missing column: PGRST205, "Could not find the table
   'public.app_releases' in the schema cache". CLAUDE.md: "Every code path that depends on a
   migration must work without it -- fall back, never fail." */

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

