import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/* =====================================================================================
   PASSWORD HASHING, ON ITS OWN, IMPORTING NOTHING.
   =====================================================================================
   This lives apart from auth.js for one practical reason: auth.js reaches the database, so
   importing it builds a Supabase client at load time and throws "supabaseUrl is required"
   when the environment is not set. The migration scripts need to HASH a password before they
   have any reason to talk to a database -- `migrate/run.js --dry-run` has no credentials at
   all by design -- and a tool that dies on import cannot even print its own usage message.

   scrypt with a per-password salt, the parameters written down rather than defaulted, and a
   constant-time comparison. auth.js re-exports both so nothing else has to know they moved. */

const KEYLEN = 32;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, KEYLEN, SCRYPT).toString('hex');
  return { hash, salt };
}

/** False for an account with no password set -- a migrated row whose sheet cell was blank can
    never be signed into with an empty string. Constant-time comparison. */
export function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const given = String(password == null ? '' : password);
  if (!given) return false;
  let derived;
  try { derived = scryptSync(given, salt, KEYLEN, SCRYPT); } catch { return false; }
  const stored = Buffer.from(String(hash), 'hex');
  if (stored.length !== derived.length) return false;
  return timingSafeEqual(stored, derived);
}
