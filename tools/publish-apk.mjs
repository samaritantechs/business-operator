/* PUBLISH AN APK WITHOUT ANYBODY UPLOADING ANYTHING.
 * =====================================================================================
 * Settings -> Android app exists so a manager CAN publish a build by hand. This is the same
 * job done by the workflow instead, so that nobody has to: it puts the file in the bucket and
 * writes the release row, and from then on /download and the marketplace button point at it.
 *
 * It deliberately mirrors publishRelease() in api/_lib/bo/releases.js rather than calling it --
 * that path is an authenticated HTTP function and this runs in CI with no session. Mirroring
 * means the invariants have to be repeated here, so they are stated where they are enforced:
 *
 *   - EXACTLY ONE ROW IS CURRENT. There is a partial unique index saying so, so the old one is
 *     stood down BEFORE the new one is written, never after and never in the same breath.
 *   - THE FILE LANDS FIRST. A row pointing at a file that is not there is a /download link
 *     that 404s, which reads to a shopkeeper as "this business is fake".
 *   - A REPEATED versionCode IS REFUSED, by a unique index and by this script, because Android
 *     will not install over an equal code and the download would look broken.
 *
 * Usage:  node tools/publish-apk.mjs <path-to.apk> <versionCode> <versionName> [notes]
 * Needs:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'app-releases';

const [apkPath, codeArg, nameArg, ...noteParts] = process.argv.slice(2);
const notes = noteParts.join(' ').trim() || null;

function die(msg) { console.error('publish-apk: ' + msg); process.exit(1); }

if (!apkPath || !codeArg || !nameArg) die('usage: node tools/publish-apk.mjs <apk> <versionCode> <versionName> [notes]');
const versionCode = Number.parseInt(codeArg, 10);
if (!Number.isInteger(versionCode) || versionCode < 1) die('versionCode must be a whole number above zero, got ' + codeArg);
const versionName = String(nameArg).trim();
if (!versionName) die('versionName is empty');
if (!/\.apk$/i.test(apkPath)) die(apkPath + ' is not an .apk');

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) die('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set');

const bytes = readFileSync(apkPath);
const size = statSync(apkPath).size;
if (size < 100 * 1024) die('that file is ' + size + ' bytes -- too small to be a real APK');

/* The same name the manual path would have produced, so the two routes cannot leave two files
   claiming the same build. */
const safeName = versionName.replace(/[^A-Za-z0-9._-]/g, '') || 'app';
const fileName = 'samaritan-industrial-' + safeName + '-' + versionCode + '.apk';

const db = createClient(url, key, { auth: { persistSession: false } });

/* REFUSE A REPEAT BEFORE UPLOADING, not after: an aborted publish that has already overwritten
   the bucket leaves the previous release's file replaced by a build nobody registered. */
const { data: clash, error: clashErr } = await db
  .from('app_releases').select('id, version_code, version_name').eq('version_code', versionCode).maybeSingle();
if (clashErr) {
  if (/schema cache|does not exist/i.test(clashErr.message || '')) {
    die('the app_releases table is not in this database yet -- run db/RUN-ME-003-app-releases.sql');
  }
  die('could not read app_releases: ' + clashErr.message);
}
if (clash) die('version code ' + versionCode + ' is already published (as ' + clash.version_name + '). Every build needs a higher one.');

/* THE BUCKET MAKES ITSELF. Telling somebody to go and create it by hand is one more step that
   has to be done exactly right, on a screen they visit twice a year, before anything works --
   and the whole point of this script is that nobody has to do anything. It is created PUBLIC
   because /download redirects a phone straight at the object URL and the marketplace button
   links to it: a private bucket here means every shopkeeper gets a 400.
   Idempotent by construction -- an existing bucket comes back as an error saying so, which is
   success as far as this is concerned. It is never made private again, and never deleted. */
async function ensureBucket() {
  const { data: found } = await db.storage.getBucket(BUCKET);
  if (found) {
    if (found.public === false) {
      die('the "' + BUCKET + '" bucket exists but is PRIVATE. Make it public in Supabase Storage, '
        + 'or the download link will fail for everybody.');
    }
    return 'already there';
  }
  const { error } = await db.storage.createBucket(BUCKET, { public: true });
  if (!error) return 'created';
  if (/exist/i.test(error.message || '')) return 'already there';   // raced with another run
  die('could not create the "' + BUCKET + '" bucket: ' + error.message
    + ' -- create it by hand in Supabase Storage, public, and run this again.');
}
console.log('bucket "' + BUCKET + '": ' + await ensureBucket());

const up = await db.storage.from(BUCKET).upload(fileName, bytes, {
  contentType: 'application/vnd.android.package-archive', upsert: true,
});
if (up.error) die('upload failed: ' + up.error.message);

const publicUrl = String(url).replace(/\/+$/, '') + '/storage/v1/object/public/' + BUCKET + '/' + fileName;

/* Stand the old one down first. Two current rows is a state the index forbids, and the write
   that would create it fails -- better that this fails than that /download becomes ambiguous. */
const { error: standDownErr } = await db.from('app_releases').update({ is_current: false }).eq('is_current', true);
if (standDownErr) die('could not stand down the previous release: ' + standDownErr.message);

const { data: row, error: insErr } = await db.from('app_releases').insert({
  version_name: versionName, version_code: versionCode, file_name: fileName,
  url: publicUrl, size_bytes: size, notes, is_current: true,
  published_at: new Date().toISOString(),
}).select().maybeSingle();
if (insErr) die('the file uploaded but the release row did not save: ' + insErr.message);

console.log('published ' + versionName + ' (code ' + versionCode + '), ' + Math.round(size / 1024) + ' KB');
console.log(publicUrl);
console.log('row id ' + (row && row.id));
