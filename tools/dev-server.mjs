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
const { richBook, bookDb } = await import('../test/_book.mjs');
const { resolveSession, readTicket, loadUser } = await import('../api/_lib/auth.js');
const { boApi } = await import('../api/_lib/bo-core.js');
const { accountApi } = await import('../api/_lib/bo/account.js');
const { marketApi } = await import('../api/_lib/bo/market.js');
const { reportFile } = await import('../api/_lib/bo/reports.js');

const db = bookDb(richBook());
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
  console.log('Business Operator (local, in-memory book) on http://localhost:' + PORT);
  console.log('Sign in: frank / pass1234 (admin) · juma / pass1234 (seller) · mama / pass1234 (grocery admin) · markii / pass1234 (manager)');
});
