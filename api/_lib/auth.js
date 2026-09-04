import { randomBytes, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { runQuery, friendlyDbError } from './supabase.js';

/* =====================================================================================
   WHO IS ASKING, AND WHAT MAY THEY DO.
   =====================================================================================
   The Apps Script version kept passwords in clear text in a sheet and re-checked nothing after
   login: the browser simply remembered "I am admin of vendor X" and every call trusted it. Here:

     PASSWORDS   scrypt hashes with a per-account salt (same scheme as HOPE PMO's officer
                 passcodes). The migration hashes the legacy plaintext once, so nobody is asked
                 to reset -- but nobody, including a manager, can read a password back.
     SESSIONS    a login mints a random token stored in `sessions`. The browser keeps the token,
                 never the password, and every request carries it. Expired or deleted tokens
                 stop working at once; a deactivated account stops working within a minute.
     ROLES       resolved from the profile row on every request, never from the browser. A
                 seller cannot become an admin by editing localStorage.
     RESTRICTION a restricted vendor (unpaid) is refused every WRITE at the server, whatever the
                 page shows. The banner and overlay are a courtesy; this is the lock.

   THE COST. Cold, resolving a token is three reads (session, profile, vendor). Warm, it is zero:
   the answer is kept for a minute per token, in process, and dropped whenever a profile or
   vendor is written -- the same discipline as HOPE PMO's system-gate cache. */

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'AppError'; this.status = status; }
}
export const badRequest = m => new AppError(m, 400);
export const unauthorized = m => new AppError(m, 401);
export const forbidden = m => new AppError(m, 403);
export const notFound = m => new AppError(m, 404);

/* ------------------------------------------------------------------ passwords
   In password.js, which imports nothing, so a command-line tool can hash without a database
   client being built (and thrown) at import time. Re-exported here: this is still the door. */
export { hashPassword, verifyPassword } from './password.js';

/* ------------------------------------------------------------------ roles */
export const ROLES = ['seller', 'admin', 'assistant-admin', 'manager', 'assistant-manager'];
export const isAdminLevel = role => role === 'admin' || role === 'assistant-admin';
export const isManagerLevel = role => role === 'manager' || role === 'assistant-manager';

export function requireAdmin(user) {
  if (!user || !(isAdminLevel(user.role) || isManagerLevel(user.role))) {
    throw forbidden('Hujaruhusiwa. / Only a business admin can do this.');
  }
}
export function requireManager(user) {
  if (!user || !isManagerLevel(user.role)) throw forbidden('Hujaruhusiwa. / Only the system manager can do this.');
}
/** Sellers and admins share a vendor; managers see every vendor. Which vendor a call means:
    a manager may name one (or 'ALL' / nothing for every vendor); anybody else is pinned to
    their own, whatever they sent. Returns null for "all vendors". */
export function vendorScope(user, args) {
  if (isManagerLevel(user.role)) {
    const v = args && args.vendor_id;
    return (!v || v === 'ALL') ? null : String(v);
  }
  if (!user.vendor_id) throw forbidden('This account is not attached to a business.');
  return user.vendor_id;
}

/* ------------------------------------------------------------------ sessions */
export const SESSION_DAYS = 30;
const CACHE_TTL_MS = 60000;
const caches = new WeakMap();                 // db -> Map(token -> { at, user })

function bucket(db) { let m = caches.get(db); if (!m) { m = new Map(); caches.set(db, m); } return m; }
/** Drop every remembered session answer for this database (after any profile or vendor write). */
export function bustSessions(db) { caches.delete(db); }

export function newToken() { return randomBytes(24).toString('hex'); }

export async function createSession(db, profileId, userAgent, nowMs = Date.now()) {
  const token = newToken();
  const row = {
    token, profile_id: profileId,
    created_at: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + SESSION_DAYS * 86400000).toISOString(),
    last_seen_at: new Date(nowMs).toISOString(),
    user_agent: String(userAgent || '').slice(0, 200) || null,
  };
  const { error } = await runQuery(() => db.from('sessions').insert(row));
  if (error) throw new AppError(friendlyDbError(error), 500);
  return token;
}

export async function destroySession(db, token) {
  if (!token) return;
  bucket(db).delete(token);
  await runQuery(() => db.from('sessions').delete().eq('token', token));
}

/** The signed-in person behind a token, with their vendor row attached, or an AppError.
    Shape: { id, email, name, handle, role, vendor_id, branch_id, active, profile_photo_url,
             vendor: {...} | null, is_admin, is_manager }. */
export async function resolveSession(db, token, nowMs = Date.now()) {
  if (!token) throw unauthorized('Tafadhali ingia. / Please sign in.');
  const b = bucket(db);
  const hit = b.get(token);
  if (hit && hit.at <= nowMs && nowMs - hit.at < CACHE_TTL_MS) return hit.user;

  const { data: s, error } = await runQuery(() =>
    db.from('sessions').select('token, profile_id, expires_at, last_seen_at').eq('token', token).maybeSingle());
  if (error) throw new AppError(friendlyDbError(error), 500);
  if (!s || Date.parse(s.expires_at) <= nowMs) throw unauthorized('Kikao kimeisha. / Your session has expired -- please sign in again.');

  const user = await loadUser(db, s.profile_id);
  if (!user) throw unauthorized('Akaunti haipo. / This account no longer exists.');
  if (!user.active) throw unauthorized('Akaunti imezimwa. / This account is inactive.');
  if (user.vendor && !user.vendor.active && !isManagerLevel(user.role)) {
    throw unauthorized('Biashara imezimwa. / This business has been deactivated.');
  }
  // A touch at most once an hour: enough to know a device is alive, cheap enough to ignore.
  if (!s.last_seen_at || nowMs - Date.parse(s.last_seen_at) > 3600000) {
    runQuery(() => db.from('sessions').update({ last_seen_at: new Date(nowMs).toISOString() }).eq('token', token))
      .catch(() => {});
  }
  b.set(token, { at: nowMs, user });
  return user;
}

export const PROFILE_COLS = 'id, email, name, handle, role, vendor_id, branch_id, active, profile_photo_url, created_at';
export const VENDOR_COLS = 'id, legacy_name, name, business_type, phone, address, currency, logo_url, registered_on, active, restricted, permissions, created_at';

export async function loadUser(db, profileId) {
  const { data: p, error } = await runQuery(() => db.from('profiles').select(PROFILE_COLS).eq('id', profileId).maybeSingle());
  if (error) throw new AppError(friendlyDbError(error), 500);
  if (!p) return null;
  let vendor = null;
  if (p.vendor_id) {
    const { data: v, error: e2 } = await runQuery(() => db.from('vendors').select(VENDOR_COLS).eq('id', p.vendor_id).maybeSingle());
    if (e2) throw new AppError(friendlyDbError(e2), 500);
    vendor = v || null;
  }
  return { ...p, vendor, is_admin: isAdminLevel(p.role), is_manager: isManagerLevel(p.role) };
}

/* ------------------------------------------------------------------ signed tickets
   A report download has to be a plain GET the phone's download manager can fetch, and a
   session token in a URL would be a session token in every browser history. So a download is
   authorised by a short-lived signed ticket that names exactly one report and nothing else:
   the server signs it, the browser opens it, and it is dead five minutes later. Stateless. */
function secret() {
  const s = process.env.BO_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-secret';
  return createHash('sha256').update('bo-ticket:' + s).digest();
}
const b64u = buf => Buffer.from(buf).toString('base64url');

export const TICKET_TTL_MS = 5 * 60000;
export function signTicket(payload, nowMs = Date.now()) {
  const body = b64u(JSON.stringify({ ...payload, exp: nowMs + TICKET_TTL_MS }));
  const mac = b64u(createHmac('sha256', secret()).update(body).digest());
  return body + '.' + mac;
}
export function readTicket(ticket, nowMs = Date.now()) {
  const [body, mac] = String(ticket || '').split('.');
  if (!body || !mac) throw unauthorized('Bad download ticket.');
  const want = createHmac('sha256', secret()).update(body).digest();
  const got = Buffer.from(mac, 'base64url');
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw unauthorized('Bad download ticket.');
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw unauthorized('Bad download ticket.'); }
  if (!payload.exp || payload.exp < nowMs) throw unauthorized('This download link has expired -- ask for the report again.');
  return payload;
}

/* ------------------------------------------------------------------ the route wrapper */
/** Wraps a Vercel handler so a thrown AppError becomes clean JSON with its status, and anything
    else a 500 with its message -- never a raw stack, never an HTML error page. Same as HOPE. */
export function withApi(handler) {
  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    try {
      const result = await handler(req, res);
      if (result !== undefined) res.status(200).json({ ok: true, ...result });
    } catch (e) {
      const status = e.status || 500;
      res.status(status).json({ ok: false, error: e.message || String(e), restricted: e.restricted || undefined });
    }
  };
}
