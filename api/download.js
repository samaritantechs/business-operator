import { supabase } from './_lib/supabase.js';
import { currentRelease } from './_lib/bo/releases.js';
import { APP_NAME } from './_lib/brand.js';

/* GET /download -- the address a printed QR code points at.
 *
 * It names no version, so the code on a shop counter is printed ONCE and keeps working after
 * every future build: this looks up whichever release is current and sends the phone there.
 * Public on purpose -- handing the APK to whoever scans the sticker is the entire job.
 *
 * With nothing published yet it answers a plain page rather than a 404, because "not found"
 * on a printed code reads as "this business is fake" to the person holding the phone. */
export default async function handler(req, res) {
  try {
    const release = await currentRelease(supabase);
    if (release && release.url) {
      res.setHeader('Cache-Control', 'no-store');          // the current build changes; the URL must not be cached
      res.writeHead(302, { Location: release.url });
      return res.end();
    }
  } catch (e) {
    // Fall through to the notice: a database hiccup should not show a stack trace to a customer.
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 200;
  return res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + APP_NAME + '</title>'
    + '<div style="font:16px/1.6 system-ui,sans-serif;max-width:34rem;margin:14vh auto;padding:0 1.25rem;color:#141922">'
    + '<h1 style="font-size:1.4rem;margin:0 0 .6rem">' + APP_NAME + '</h1>'
    + '<p>The Android app has not been published yet.</p>'
    + '<p>You can use the system in this browser in the meantime:</p>'
    + '<p><a href="/" style="color:#2563EB">Open ' + APP_NAME + '</a></p></div>');
}
