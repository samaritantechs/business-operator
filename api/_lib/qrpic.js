import { qrPng } from './qr.js';

/* =====================================================================================
   THE TWO CODES A SHOP PRINTS, AS FILES -- GET /api/download?qr=site | app
   =====================================================================================
   "Save this code as a picture" used to hand the browser a picture made inside the page. A
   browser saves that; the Android app cannot (a WebView's download goes to the phone's
   download manager, which fetches addresses and has nothing to fetch for a picture that only
   exists in the page), so the button did nothing there. This is the same picture at an
   ordinary https address, which every browser and every installed copy of the app can save.

   EXACTLY TWO PICTURES, AND THE ADDRESS IS NEVER TAKEN FROM THE CALLER. A route that drew a
   code for whatever text it was sent would let anybody mint a QR code served from this
   system's own address that leads somewhere else entirely -- a ready-made sticker for a
   fraud. So the only thing a request chooses is WHICH of the two, and both lead to the very
   host the request arrived on: the shopfront, and /download (which follows whichever build is
   current, so a printed sticker never goes stale).

   Nothing is read from the database: it costs no round trip at all. */
export const QR_PICTURES = {
  site: { path: '/', file: 'samaritan-industrial-site-qr.png' },
  app: { path: '/download', file: 'samaritan-industrial-app-qr.png' },
};

/** The address a picture carries: this deployment's own, as the browser reached it. Null when
    the host header is not a plain host name -- it is about to be drawn into a picture people
    print, so anything else is refused rather than cleaned up. */
export function qrAddress(which, headers) {
  const pic = QR_PICTURES[which];
  if (!pic) return null;
  const h = headers || {};
  const host = String(h['x-forwarded-host'] || h.host || '').split(',')[0].trim().toLowerCase();
  if (host.length > 110 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/.test(host)) return null;
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const said = String(h['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const proto = (said === 'http' || said === 'https') ? said : (local ? 'http' : 'https');
  return proto + '://' + host + pic.path;
}

/** { status, headers, body } -- the picture, or a refusal in words. */
export function qrPicture(which, headers) {
  const plain = (status, text) => ({ status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: text });
  const pic = QR_PICTURES[which];
  if (!pic) return plain(404, 'No such code. Ask for ?qr=site or ?qr=app.');
  const address = qrAddress(which, headers);
  const png = address ? qrPng(address, { scale: 16, margin: 4 }) : null;
  if (!png) return plain(422, 'This address cannot be drawn as a code.');
  return {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(png.length),
      'Content-Disposition': 'attachment; filename="' + pic.file + '"',
      /* Private and short: the picture depends on the host it was asked through, and a shared
         cache that forgot that would hand one deployment's sticker to another. */
      'Cache-Control': 'private, max-age=600',
    },
    body: png,
  };
}
