import { rows, one, insertOne, update, badRequest, notFound, text, mustText, int, num, iso } from './_shared.js';
import { requireManager } from '../auth.js';
import { publicUrl } from '../storage.js';

/* =====================================================================================
   THE ANDROID APP'S RELEASES.
   =====================================================================================
   The app on a phone is a WebView onto this site, so a feature or a fix reaches every shop
   the moment it deploys -- nobody sends anybody an APK. A new APK is needed only when the
   address or the WebView's allowlist changes, which is rare and deliberate.

   When that happens the file goes into the `app-releases` bucket and gets a row here, and
   /download follows whichever row is current. That indirection is the whole point: the QR
   code on a shop counter is printed once and never goes stale, because it names /download
   and not a version.

   WHY THE UPLOAD DOES NOT COME THROUGH THIS API. An APK is ten to twenty megabytes and the
   serverless request body caps out around four and a half, so pushing one through /api/bo
   would fail at whatever size the cap happens to be that month. `uploadUrl` hands the browser
   a short-lived signed URL and the file goes straight from the manager's laptop to storage,
   never through this function. `publishRelease` then records what landed. */

const COLS = 'id, version_name, version_code, file_name, url, size_bytes, notes, is_current, published_at, published_by';
const BUCKET = 'app-releases';
const MAX_APK_BYTES = 200 * 1024 * 1024;

/** The row every phone and every download link follows. Null until a first APK is published. */
export async function currentRelease(db) {
  const hit = await rows(db, 'app_releases', q => q.select(COLS).eq('is_current', true).limit(1));
  return hit.length ? hit[0] : null;
}

/** What a page needs to draw a download button and an update notice; never the whole row. */
export function publicRelease(r) {
  if (!r) return null;
  return {
    version_name: String(r.version_name || ''), version_code: num(r.version_code),
    url: String(r.url || ''), size_bytes: num(r.size_bytes) || null,
    notes: r.notes || '', published_at: r.published_at,
  };
}

/** A file name that cannot escape the bucket or collide by accident. */
function apkName(versionName, versionCode) {
  const v = String(versionName).replace(/[^A-Za-z0-9._-]/g, '');
  return 'samaritan-industrial-' + (v || 'app') + '-' + versionCode + '.apk';
}

export const FN = {
  /** {} -> { release } for anyone signed in: what the Download button points at, and what an
      APK compares itself against. One bounded read. */
  async appRelease(db) {
    return { release: publicRelease(await currentRelease(db)) };
  },

  /** {} -> { rows } every release, newest first. Manager only -- it is the release history,
      not something a shop needs. One bounded read. */
  async releases(db, user) {
    requireManager(user);
    const list = await rows(db, 'app_releases', q => q.select(COLS).order('version_code', { ascending: false }).limit(100));
    return { rows: list.map(r => ({ ...publicRelease(r), id: r.id, file_name: r.file_name, is_current: !!r.is_current })) };
  },

  /** { version_name, version_code } -> { upload_url, file_name, path }. A signed URL the
      BROWSER uploads the APK to directly, because the file is far too big to come through a
      serverless request body. Manager only, and the URL is short-lived by construction. */
  async releaseUploadUrl(db, user, args) {
    requireManager(user);
    const versionName = mustText(args.version_name, 'Version name');
    const versionCode = int(args.version_code);
    if (!(versionCode > 0)) throw badRequest('Version code must be a whole number above zero.');
    const fileName = apkName(versionName, versionCode);
    const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(fileName, { upsert: true });
    if (error || !data) throw badRequest('Could not start the upload: ' + ((error && error.message) || 'no signed URL returned'));
    return { upload_url: data.signedUrl, token: data.token || null, file_name: fileName, path: data.path || fileName };
  },

  /** { version_name, version_code, file_name, size_bytes?, notes? } -> { release }. Records
      an APK that is already in the bucket and makes it the one /download hands out. The old
      current row is stood down FIRST, because the database refuses two current rows and would
      rather this fail than serve an ambiguous answer. Manager only. */
  async publishRelease(db, user, args, nowMs) {
    requireManager(user);
    const versionName = mustText(args.version_name, 'Version name');
    const versionCode = int(args.version_code);
    if (!(versionCode > 0)) throw badRequest('Version code must be a whole number above zero.');
    const fileName = text(args.file_name) || apkName(versionName, versionCode);
    if (!/\.apk$/i.test(fileName)) throw badRequest('That is not an .apk file.');
    const size = num(args.size_bytes);
    if (size > MAX_APK_BYTES) throw badRequest('That file is larger than 200MB -- it is probably not an APK.');

    // It must actually be there. Publishing a row that points at nothing is how /download
    // starts handing people a 404 that looks like the app is broken.
    const { data: listed, error: listErr } = await db.storage.from(BUCKET).list('', { search: fileName, limit: 100 });
    if (listErr) throw badRequest('Could not check the uploaded file: ' + listErr.message);
    const found = (listed || []).find(f => f && f.name === fileName);
    if (!found) throw badRequest('No file called ' + fileName + ' is in storage yet. Upload it first, then publish.');

    const clash = await one(db, 'app_releases', q => q.select('id, version_code').eq('version_code', versionCode));
    if (clash) throw badRequest('Version code ' + versionCode + ' has already been published. Every build needs a higher one, or Android will refuse to install over the old app.');

    await update(db, 'app_releases', { is_current: false }, q => q.eq('is_current', true));
    const row = await insertOne(db, 'app_releases', {
      version_name: versionName, version_code: versionCode, file_name: fileName,
      url: publicUrl(BUCKET, fileName), size_bytes: size || (found.metadata && found.metadata.size) || null,
      notes: text(args.notes) || null, is_current: true,
      published_at: iso(nowMs), published_by: user.id,
    });
    return { release: publicRelease(row) };
  },

  /** { id } -> { release }. Puts an older build back in front of everybody, for when a new
      one turns out to be wrong. Manager only. */
  async rollbackRelease(db, user, args) {
    requireManager(user);
    const id = mustText(args.id, 'Which release');
    const target = await one(db, 'app_releases', q => q.select(COLS).eq('id', id));
    if (!target) throw notFound('That release does not exist.');
    await update(db, 'app_releases', { is_current: false }, q => q.eq('is_current', true));
    const [row] = await update(db, 'app_releases', { is_current: true }, q => q.eq('id', target.id));
    return { release: publicRelease(row || { ...target, is_current: true }) };
  },
};

export const WRITES = ['releaseUploadUrl', 'publishRelease', 'rollbackRelease'];
