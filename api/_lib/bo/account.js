import { rows, one, insertOne, update, remove, getSetting, text, mustText, iso, badRequest, PROFILE_COLS, isManagerLevel } from './_shared.js';
import { AppError, unauthorized, hashPassword, verifyPassword, createSession, resolveSession, destroySession, bustSessions, newToken, loadUser } from '../auth.js';
import { sendEmail, signature } from '../email.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { buildBoot } from './boot.js';
import { APP_NAME } from '../brand.js';

/* =====================================================================================
   ACCOUNT -- the doors that exist before there is a session.
   =====================================================================================
   login / register / requestReset / resetPassword / logout / me. No `user` argument here:
   these are the calls that MAKE one. Handlers are (db, args, nowMs, deps); `deps.userAgent`
   is stamped on the session row, `deps.fetch` lets a test see the reset email go out.

   The legacy validateLogin compared a plaintext cell and answered one sentence for every
   failure -- wrong id, wrong password, inactive -- so a stranger could not tell which. That
   one sentence is kept, on purpose. */

const BAD_LOGIN = 'Invalid credentials or inactive account.';
const RESET_TTL_MS = 10 * 60000;
const MIN_PASSWORD = 4;
const LOGIN_COLS = PROFILE_COLS + ', password_hash, password_salt';

/** `%` and `_` are LIKE wildcards: a typed id must match itself, not a pattern. */
const likeEscape = s => String(s).replace(/([\\%_])/g, '\\$1');

/** A profile by handle or email, case-insensitively. Two exact reads first (citext in
    Postgres makes them case-insensitive already), then an escaped ilike for a database --
    or the test fake -- whose columns are plain text. An ilike that matches two rows is no
    match: it must name ONE person. */
async function findProfile(db, id) {
  const hit = await one(db, 'profiles', q => q.select(LOGIN_COLS).eq('handle', id))
    || await one(db, 'profiles', q => q.select(LOGIN_COLS).eq('email', id));
  if (hit) return hit;
  for (const col of ['handle', 'email']) {
    const list = await rows(db, 'profiles', q => q.select(LOGIN_COLS).ilike(col, likeEscape(id)).limit(2));
    if (list.length === 1) return list[0];
  }
  return null;
}

async function profileExists(db, col, value) {
  const list = await rows(db, 'profiles', q => q.select('id').ilike(col, likeEscape(value)).limit(1));
  return list.length > 0;
}

function passwordArg(v) {
  const p = String(v == null ? '' : v).trim();
  if (p.length < MIN_PASSWORD) throw badRequest('Password must be at least ' + MIN_PASSWORD + ' characters.');
  return p;
}


/* ------------------------------------------------------------------ first run
   A database that has just been created has NOBODY in it, and `register` only ever makes a
   business and its admin -- deliberately, because a manager can activate businesses, restrict
   them, change system settings and send email, and that must never be self-service.

   So the very first manager is made here, once, and TWO things have to be true at the same
   time: the system still has no manager at all, and the caller knows the setup key that was
   put in the deployment's own environment variables. Either alone would not be enough -- the
   first stranger to find a fresh URL would otherwise own the system, and a leaked key would
   otherwise stay useful forever. Once a manager exists this door is shut for good, and further
   accounts are made from Users inside the app.

   (migrate/create-manager.js does the same job from a terminal, for whoever prefers one.) */

/** The setup key from the deployment's environment. BO_SETUP_KEY if it is set, otherwise
    BO_SECRET, which every deployment is told to set anyway. Null when neither exists, and
    that is refused rather than waved through: a setup door with no key is not a door. */
function setupKey() {
  const k = String(process.env.BO_SETUP_KEY || process.env.BO_SECRET || '').trim();
  return k || null;
}
/** Constant-time, and length-blind because the hashes are always 32 bytes. */
function keyMatches(given, expected) {
  const a = createHash('sha256').update(String(given == null ? '' : given)).digest();
  const b = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(a, b);
}
/** Is there any manager at all? One bounded read. */
async function hasManager(db) {
  const list = await rows(db, 'profiles', q => q.select('id').in('role', ['manager', 'assistant-manager']).limit(1));
  return list.length > 0;
}

export const FN = {
  async login(db, args, nowMs, deps) {
    const id = text(args.id), password = String(args.password == null ? '' : args.password).trim();
    if (!id || !password) throw badRequest('Please enter your credentials.');
    const p = await findProfile(db, id);
    if (!p || !verifyPassword(password, p.password_hash, p.password_salt)) throw unauthorized(BAD_LOGIN);
    const user = await loadUser(db, p.id);
    if (!user || !user.active) throw unauthorized(BAD_LOGIN);
    if (user.vendor && !user.vendor.active && !isManagerLevel(user.role)) throw unauthorized(BAD_LOGIN);
    const token = await createSession(db, user.id, deps && deps.userAgent, nowMs);
    return { token, ...(await buildBoot(db, user, nowMs)) };
  },

  /** A business and its first admin, in that order. Active at once when the manager allows
      free registration (setting FreeRegistration), otherwise parked until activated. */
  async register(db, args, nowMs) {
    const businessName = mustText(args.business_name, 'Business name');
    const email = mustText(args.admin_email, 'Admin email').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Enter a valid email address.');
    const adminName = mustText(args.admin_name, 'Admin name');
    const handle = mustText(args.admin_handle, 'User ID');
    if (/\s/.test(handle)) throw badRequest('The User ID cannot contain spaces.');
    const password = passwordArg(args.password);

    if (await profileExists(db, 'email', email)) throw badRequest('An account with this email already exists. Please use a different email or login instead.');
    if (await profileExists(db, 'handle', handle)) throw badRequest('That User ID is already taken. Please choose another.');
    const sameName = await rows(db, 'vendors', q => q.select('id').ilike('name', likeEscape(businessName)).limit(1));
    if (sameName.length) throw badRequest('A business with this name is already registered. Please use a different name or login instead.');

    const active = (await getSetting(db, 'FreeRegistration')) === 'Yes';
    const vendor = await insertOne(db, 'vendors', {
      legacy_name: businessName, name: businessName, business_type: text(args.business_type) || '',
      phone: text(args.phone) || '', address: text(args.address) || '', currency: 'TZS',
      registered_on: iso(nowMs), active, restricted: false, permissions: {},
    });
    const pw = hashPassword(password);
    await insertOne(db, 'profiles', {
      email, name: adminName, handle, role: 'admin', vendor_id: vendor.id, branch_id: null, active,
      password_hash: pw.hash, password_salt: pw.salt, created_at: iso(nowMs),
    });
    bustSessions(db);
    return {
      message: active ? 'Business registered! You can now log in.' : 'Registration submitted. The system manager will activate your account.',
      active,
    };
  },

  /** Always the same sentence, so the form cannot be used to find out which emails have
      accounts. The link is APP_URL/?reset=TOKEN and dies in ten minutes or one use. */
  async requestReset(db, args, nowMs, deps) {
    const email = mustText(args.email, 'Your email');
    const msg = 'If that email has an account, a reset link has been sent (valid 10 minutes).';
    const list = await rows(db, 'profiles', q => q.select('id, email, name').ilike('email', likeEscape(email)).limit(2));
    if (list.length !== 1) return { message: msg };
    const p = list[0];
    const token = newToken();
    await insertOne(db, 'password_resets', { token, profile_id: p.id, expires_at: iso(nowMs + RESET_TTL_MS), created_at: iso(nowMs) });
    const url = (process.env.APP_URL || '') + '/?reset=' + token;
    try {
      await sendEmail({
        to: p.email,
        subject: '🔑 Password Reset – ' + APP_NAME,
        html: '<p>Click below to reset your password (valid 10 minutes):</p><p><a href="' + url + '">' + url + '</a></p>' + signature(),
      }, { fetch: deps && deps.fetch });
    } catch (e) {
      // Legacy said 'Could not send email.'; the real reason (usually "not configured") is more use.
      throw new AppError(e.message || 'Could not send email.', 400);
    }
    return { message: msg };
  },

  async resetPassword(db, args, nowMs) {
    const password = passwordArg(args.password);
    const bad = () => badRequest('Invalid or expired reset link.');
    const token = text(args.token);
    if (!token) throw bad();
    const r = await one(db, 'password_resets', q => q.select('token, profile_id, expires_at, used_at').eq('token', token));
    if (!r || r.used_at || !(Date.parse(r.expires_at) > nowMs)) throw bad();
    const pw = hashPassword(password);
    const hit = await update(db, 'profiles', { password_hash: pw.hash, password_salt: pw.salt, updated_at: iso(nowMs) }, q => q.eq('id', r.profile_id));
    if (!hit.length) throw bad();
    await update(db, 'password_resets', { used_at: iso(nowMs) }, q => q.eq('token', token));
    // A reset usually means the old password is in the wrong hands: every device signs out.
    await remove(db, 'sessions', q => q.eq('profile_id', r.profile_id));
    bustSessions(db);
    return { message: 'Password updated. You can now log in.' };
  },

  /** {} -> { needed, keyless }. What the sign-in page asks before drawing anything: is this
      a brand-new system that still needs its first manager, and does the deployment actually
      have a setup key set? `keyless` lets the page say what is wrong instead of failing at
      the last step. One read, and only while the system is empty -- once a manager exists
      this answers false and costs the same one read. */
  async setupState(db) {
    const needed = !(await hasManager(db));
    return { needed, keyless: needed && !setupKey() };
  },

  /** { setup_key, email, name, handle, password } -> { token, ...boot }. The first manager,
      and then never again. Signs them straight in, because they have just proved they hold
      the deployment's own key and making them type it all again helps nobody. */
  async setupManager(db, args, nowMs, deps) {
    const expected = setupKey();
    if (!expected) {
      throw badRequest('This deployment has no setup key. Add BO_SETUP_KEY (or BO_SECRET) to its environment variables, redeploy, and try again.');
    }
    if (await hasManager(db)) throw new AppError('This system already has a manager account. Sign in, then use Users to add more.', 403);
    if (!keyMatches(args.setup_key, expected)) throw unauthorized('That setup key is not right.');

    const email = mustText(args.email, 'Email').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Enter a valid email address.');
    const name = mustText(args.name, 'Your name');
    const handle = mustText(args.handle, 'User ID');
    if (/\s/.test(handle)) throw badRequest('The User ID cannot contain spaces.');
    const password = passwordArg(args.password);
    if (await profileExists(db, 'email', email)) throw badRequest('An account with this email already exists.');
    if (await profileExists(db, 'handle', handle)) throw badRequest('That User ID is already taken.');

    const pw = hashPassword(password);
    const row = await insertOne(db, 'profiles', {
      email, name, handle, role: 'manager', vendor_id: null, branch_id: null, active: true,
      profile_photo_url: null, password_hash: pw.hash, password_salt: pw.salt, created_at: iso(nowMs),
    });
    bustSessions(db);
    const user = await loadUser(db, row.id);
    const token = await createSession(db, user.id, deps && deps.userAgent, nowMs);
    return { token, ...(await buildBoot(db, user, nowMs)) };
  },

  async logout(db, args) {
    await destroySession(db, text(args.token));
    return {};
  },

  async me(db, args, nowMs) {
    const user = await resolveSession(db, text(args.token), nowMs);
    return buildBoot(db, user, nowMs);
  },
};

export async function accountApi(db, fn, args, nowMs = Date.now(), deps = {}) {
  const h = FN[fn];
  if (!h) { const e = new Error('Unknown account function: ' + fn); e.status = 400; throw e; }
  return h(db, args || {}, nowMs, deps);
}
export const ACCOUNT_FUNCTIONS = Object.keys(FN);
