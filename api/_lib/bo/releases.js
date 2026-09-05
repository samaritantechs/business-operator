import { rows, one, insertOne, update, badRequest, notFound, text, mustText, int, num, iso, missingTable } from './_shared.js';
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

/* THE TABLE ITSELF CAN BE ABSENT. app_releases went into db/schema.sql without a RUN-ME file
   behind it, so a database created before it existed does not have it -- and PostgREST refuses
   the whole query for a missing table exactly as it does for a missing column. Everything that
   reads a release in PASSING must therefore carry on without one: /download already has its
   own notice, the phone's update check already swallows a failure, and the marketplace -- which
   is public, and is the shop window -- went down entirely over an app nobody had published.
   CLAUDE.md: "Every code path that depends on a migration must work without it."

   Only a table that is not there is tolerated. Any other database error still throws: a
   marketplace that quietly says "no app" because the database was briefly unreachable would be
   the same silence one layer down. */
const NEEDS_TABLE = 'Jedwali la app_releases halipo kwenye hifadhidata. Endesha db/RUN-ME-003-app-releases.sql kwenye Supabase. / '
  + 'The app_releases table is not in this database yet — run db/RUN-ME-003-app-releases.sql in the Supabase SQL editor.';

/** The row every phone and every download link follows. Null until a first APK is published --
    and null, rather than an outage, on a database that has not got the table at all. */
export async function currentRelease(db) {
  try {
    const hit = await rows(db, 'app_releases', q => q.select(COLS).eq('is_current', true).limit(1));
    return hit.length ? hit[0] : null;
  } catch (e) {
    if (missingTable(e)) return null;
    throw e;
  }
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

};

/* NOTHING HERE WRITES ANY MORE. Publishing is .github/workflows/android-apk.yml: it builds,
   signs, checks what it signed, uploads and registers the release, with the version number
   climbing on its own. tools/publish-apk.mjs is the same job runnable by hand.

   The four functions that used to live here -- releases, releaseUploadUrl, publishRelease,
   rollbackRelease -- are gone with the Settings card that called them. Not merely because
   nothing called them: a SECOND way to publish is a way for the two to disagree. A version
   code typed by hand that collided with the workflow's run number would tell every phone it
   was permanently out of date, and there is no way back from a code Android has already seen.
   One way to publish, in one place.

   What is left is the reading half, which several screens need: appRelease for the app's own
   update check, and currentRelease/publicRelease for /download and the marketplace button. */
export const WRITES = [];
