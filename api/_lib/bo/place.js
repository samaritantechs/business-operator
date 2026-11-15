import { badRequest } from './_shared.js';

/* =====================================================================================
   WHERE A SHOP IS -- the pin behind the marketplace's Location button.
   =====================================================================================
   A shopkeeper gives it in whichever way is in front of them, in ONE box:

     -6.792354, 39.208328                      what "Use my current location" writes
     https://maps.google.com/?q=-6.79,39.20    what WhatsApp sends when a location is shared
     https://www.google.com/maps/place/.../@-6.79,39.20,17z/data=...!3d-6.7924!4d39.2083
     https://maps.app.goo.gl/AbCdEf123         what the Google Maps app's Share button copies
     (nothing)                                 take the pin away

   and it is stored as numbers whenever numbers can be read out of it, because numbers are the
   only form that can be trusted to mean the same place tomorrow, and the only one anything
   else (distance, "near me") could ever be built on. A short share link carries no coordinates
   and following it would mean this server fetching an address a stranger typed -- so that one
   form is kept as the link itself, and only because its host is on the list below.

   THE LIST IS THE POINT. Whatever is stored here becomes a button on a PUBLIC page that opens
   in the customer's browser. An arbitrary address would turn every storefront into a way of
   sending strangers anywhere at all under this system's name, so nothing but Google Maps is
   accepted, and the same test is applied again on the way OUT (mapLinkOf), so a row written
   by hand in the SQL editor cannot put a foreign link on the page either. */

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';
const PAIR = new RegExp('^\\s*' + NUM + '\\s*[,;\\s]\\s*' + NUM + '\\s*$');
/* google.com and the East African country sites, each by name. A pattern like google.<anything>
   would also wave through a look-alike on a top-level domain Google never bought. */
const GOOGLE = /^(?:(?:www|maps|m)\.)?google\.(?:com|co\.tz|co\.ke|co\.ug)$/;
const MAX_URL = 600;

const round6 = n => Math.round(n * 1e6) / 1e6;

/** [lat, lng] when both are real coordinates, else null. 0,0 is the sea off Ghana and what a
    phone reports when it has no fix at all -- never a shop. */
function coords(a, b) {
  const lat = Number(a), lng = Number(b);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return [round6(lat), round6(lng)];
}

/** A Google Maps address, normalised to https, or null for anything else. */
export function safeMapUrl(input) {
  let s = String(input == null ? '' : input).trim();
  if (!s || s.length > MAX_URL || /\s/.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.username || u.password || (u.port && u.port !== '443')) return null;
  const host = u.hostname.toLowerCase(), path = u.pathname || '/';
  const ok = (host === 'maps.app.goo.gl' && path.length > 1)
    || (host === 'goo.gl' && /^\/maps\/./.test(path))
    /* On Google's own hosts only the MAP is let through, never the rest of the site: /maps...
       anywhere, and the bare "?q=" form on maps.google.com that WhatsApp sends. Not /url, which
       is Google's redirector and would make this button a way to anywhere after all. */
    || (GOOGLE.test(host) && (/^\/maps(\/|$)/.test(path) || (host.startsWith('maps.') && path === '/')));
  if (!ok) return null;
  u.protocol = 'https:';
  return u.toString();
}

/** The coordinates a Google Maps address carries, most exact first, or null. */
function coordsInUrl(url) {
  let s = url;
  try { s = decodeURIComponent(url); } catch { /* a stray % is not worth refusing a pin over */ }
  const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(s);          // the place itself
  if (pin) { const c = coords(pin[1], pin[2]); if (c) return c; }
  const q = /[?&](?:q|query|ll|destination|daddr|center)=(?:loc:)?(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i.exec(s);
  if (q) { const c = coords(q[1], q[2]); if (c) return c; }
  const at = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(s);                          // where the map was centred
  if (at) { const c = coords(at[1], at[2]); if (c) return c; }
  return null;
}

/** What the box held -> the three columns. '' clears all three. Throws a sentence a shopkeeper
    can act on for anything that is neither a pair of coordinates nor a Google Maps link. */
export function parsePlace(input) {
  const s = String(input == null ? '' : input).trim();
  if (!s) return { latitude: null, longitude: null, map_url: null };
  const pair = PAIR.exec(s);
  if (pair) {
    const c = coords(pair[1], pair[2]);
    if (!c) throw badRequest('Hizo si namba za mahali halisi. / Those are not the coordinates of a real place. '
      + 'Tap "Use my current location" while you are at the shop, or paste a Google Maps link.');
    return { latitude: c[0], longitude: c[1], map_url: null };
  }
  const url = safeMapUrl(s);
  if (!url) throw badRequest('Bandika kiungo cha Google Maps, au namba za mahali. / Paste a Google Maps link '
    + '(Share → Copy link in Google Maps), or coordinates like -6.7924, 39.2083. Other links are not accepted.');
  const c = coordsInUrl(url);
  return c ? { latitude: c[0], longitude: c[1], map_url: null } : { latitude: null, longitude: null, map_url: url };
}

/** The address the Location button opens: directions to the pin, else the stored share link,
    else '' -- and '' is the answer for a business that has given nothing. */
export function mapLinkOf(row) {
  if (!row) return '';
  const c = (row.latitude == null || row.longitude == null) ? null : coords(row.latitude, row.longitude);
  if (c) return 'https://www.google.com/maps/dir/?api=1&destination=' + c[0] + ',' + c[1];
  return safeMapUrl(row.map_url) || '';
}

/** The same three columns as the page's box shows them back. */
export function placeText(row) {
  if (!row) return '';
  const c = (row.latitude == null || row.longitude == null) ? null : coords(row.latitude, row.longitude);
  return c ? c[0] + ', ' + c[1] : (safeMapUrl(row.map_url) || '');
}
