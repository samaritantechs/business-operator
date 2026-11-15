/* A LOCAL BUSINESS OPERATOR WITH NO SUPABASE.

   Serves public/ and answers the four API routes from the in-memory fake PostgREST used by the
   tests, seeded with test/_book.mjs's book -- so the whole app can be clicked through on a
   laptop (or driven by a browser check) before a single credential exists. Sign in as
   frank / pass1234 (admin of Fromville Phones), juma / pass1234 (seller), mama / pass1234
   (admin of the grocery) or markii / pass1234 (system manager).

       npm run dev            # http://localhost:8787
       PORT=9000 npm run dev

   Nothing here is used in production: Vercel serves public/ itself and runs api/*.js. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://local.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'local-key';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { richBook, emptyBook, bookDb, saleCountsRpc, NOW: BOOK_NOW } = await import('../test/_book.mjs');
const { resolveSession, readTicket, loadUser } = await import('../api/_lib/auth.js');
const { boApi } = await import('../api/_lib/bo-core.js');
const { accountApi } = await import('../api/_lib/bo/account.js');
const { marketApi, clearMarketCache, clearMarketStats } = await import('../api/_lib/bo/market.js');
const { reportFile } = await import('../api/_lib/bo/reports.js');

/* BO_DEV_EMPTY=1 starts with NOTHING in it -- no businesses, no people -- which is the state
   a real new deployment is in and the only way to see the first-run setup screen. */
const EMPTY = process.env.BO_DEV_EMPTY === '1';
/* The one database function this local copy answers for real: the marketplace's "30 sales" has
   no row-by-row fallback (api/_lib/bo/market.js says why), so without it the cards here would
   never show a sales count at all. BO_DEV_NO_RPC=1 takes it away again, which is a live
   database that has not run db/RUN-ME-006 yet. Every other function is left missing on
   purpose: the fallbacks are what a new deployment runs on, so they are what gets clicked. */
const RPC = process.env.BO_DEV_NO_RPC === '1' ? {} : { bo_vendor_sale_counts: saleCountsRpc };
/* THE BOOK IS ONE WEDNESDAY IN SEPTEMBER 2026, AND THE CLOCK IS NOT. Every date in it is written
   out by hand so the tests can pin the day -- and this server runs on the real one. Left alone,
   the book just gets older: "today" and "this week" on the dashboard are empty, and by November
   the last closed billing month had no sales in it at all, so the browser check that issues an
   invoice found nothing to invoice and failed with no change to the code. So every timestamp is
   moved forward by a whole number of days, until the book's own "now" is today. Whole days, so
   the time of day -- and with it which shift and which side of midnight a sale falls on -- is
   exactly as written. Only this local server does it; the tests still read the book as it is. */
function freshen(book) {
  const days = Math.floor((Date.now() - BOOK_NOW) / 86400000);
  if (!(days > 0)) return book;
  const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/, DATE = /^\d{4}-\d{2}-\d{2}$/;
  const move = v => typeof v !== 'string' ? v
    : STAMP.test(v) ? new Date(Date.parse(v) + days * 86400000).toISOString()
    : DATE.test(v) ? new Date(Date.parse(v + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10)
    : v;
  for (const rows of Object.values(book)) for (const r of rows) for (const k of Object.keys(r)) r[k] = move(r[k]);
  return book;
}
const db = bookDb(EMPTY ? emptyBook() : freshen(richBook()), { rpc: RPC });
if (EMPTY && !process.env.BO_SETUP_KEY) process.env.BO_SETUP_KEY = 'dev-setup-key';
const PORT = Number(process.env.PORT) || 8787;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const REWRITES = { '/': '/index.html', '/market': '/index.html', '/login': '/index.html', '/app': '/index.html' };

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise(resolve => { let s = ''; req.on('data', c => { s += c; }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } }); });
}
async function api(req, res, url) {
  try {
    if (url.pathname === '/api/auth') {
      const { fn, args } = await readBody(req);
      return json(res, 200, { ok: true, ...(await accountApi(db, fn, args, Date.now(), { userAgent: req.headers['user-agent'] })) });
    }
    if (url.pathname === '/api/bo') {
      const { token, fn, args } = await readBody(req);
      const user = await resolveSession(db, token);
      return json(res, 200, { ok: true, ...(await boApi(db, user, fn, args)) });
    }
    /* LOCAL ONLY: forget the storefront that was built up to a minute ago. The real one is
       cached for a minute per server on purpose; a browser check that saves a shop's pin and
       then looks for the Location button cannot wait a minute for it, and should not be made
       to pretend. Vercel has no such route -- api/ is the only thing it serves. */
    if (url.pathname === '/api/dev/forget-market') { clearMarketCache(db); clearMarketStats(db); return json(res, 200, { ok: true }); }
    if (url.pathname === '/api/market') {
      if (req.method === 'GET') return json(res, 200, { ok: true, ...(await marketApi(db, 'market', {})) });
      const { fn, args } = await readBody(req);
      return json(res, 200, { ok: true, ...(await marketApi(db, fn, args)) });
    }
    if (url.pathname === '/api/report') {
      const payload = readTicket(url.searchParams.get('t'));
      const user = await loadUser(db, payload.uid);
      const file = await reportFile(db, user, payload.report || {});
      res.writeHead(200, { 'Content-Type': file.contentType, 'Content-Disposition': (file.inline ? 'inline' : 'attachment') + '; filename="' + file.filename + '"' });
      return res.end(Buffer.from(file.bytes));
    }
    return json(res, 404, { ok: false, error: 'No such route' });
  } catch (e) {
    return json(res, e.status || 500, { ok: false, error: e.message || String(e), restricted: e.restricted || undefined });
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  let p = REWRITES[url.pathname] || url.pathname;
  const file = path.join(ROOT, 'public', path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log('Samaritan Industrial (local, in-memory book) on http://localhost:' + PORT);
  if (EMPTY) console.log('EMPTY system: the setup screen is showing. Setup key: ' + process.env.BO_SETUP_KEY);
  else console.log('Sign in: frank / pass1234 (admin) · juma / pass1234 (seller) · mama / pass1234 (grocery admin) · markii / pass1234 (manager)');
});
