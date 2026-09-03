import { rows, rowsAll, one, insertOne, update, remove, badRequest, forbidden, notFound, AppError,
  isManagerLevel, isAdminLevel, vendorScope, PROFILE_COLS, VENDOR_COLS, text, mustText, iso,
  mustVendor, vendorsList, requireVendorUser } from './_shared.js';
import { requireAdmin, requireManager, ROLES, hashPassword, verifyPassword, bustSessions } from '../auth.js';
import { decodeDataUrl, uploadImage, BUCKETS } from '../storage.js';

/* =====================================================================================
   PEOPLE AND THE BUSINESS PROFILE.
   =====================================================================================
   The Users sheet held email, name, role, user id, PASSWORD IN CLEAR, active, vendor, photo,
   and -- bolted on later -- the business type, phone, address and the registration date, all
   on the admin's row. Here a person is a `profiles` row and the business is a `vendors` row,
   and two rules that were implicit in the sheet are written down:

     WHO MAY TOUCH WHOM   an admin edits their own vendor's people and can neither create nor
                          touch a manager; a manager edits anybody. Sellers see nothing here.
     PASSWORDS            never leave the server (PROFILE_COLS has no hash or salt), and only a
                          manager sets somebody else's -- an admin is pointed at Forgot Password,
                          because "the admin knows every seller's password" was the old model
                          and is the one this port is meant to end. A person changes their own
                          through changePassword, against their current one.

   THE ANCHOR RULE, ported from _resetCycleIfReactivating: `vendors.registered_on` is the trial
   and billing anchor, and reactivating a vendor's ADMIN restarts it. See resetAnchorIfReactivating.

   Every profile or vendor write ends with bustSessions(db): the resolved-session cache would
   otherwise keep serving a deactivated account or a stale vendor row for up to a minute. */

const PROFILE_KEYS = PROFILE_COLS.split(',').map(s => s.trim());
const VENDOR_KEYS = VENDOR_COLS.split(',').map(s => s.trim());
const VENDOR_ROLES = ['seller', 'admin', 'assistant-admin'];

/** A profile row as the page may see it: the public columns, never the hash or salt. Applied
    to every row that comes back from an insert/update, which return whole rows. */
export function publicProfile(row) {
  const out = {};
  for (const k of PROFILE_KEYS) out[k] = row && row[k] !== undefined ? row[k] : null;
  return out;
}
function pickVendor(row) {
  const out = {};
  for (const k of VENDOR_KEYS) out[k] = row && row[k] !== undefined ? row[k] : null;
  return out;
}

/** true / 'true' / 'Yes' / 1 -> true; the page and the legacy sheet spelt booleans every way. */
export const toBool = v => v === true || v === 1 || /^(true|yes|1|on)$/i.test(String(v == null ? '' : v).trim());
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' }) || String(a.handle || '').localeCompare(String(b.handle || ''));

export async function mustProfile(db, id) {
  const pid = text(id);
  if (!pid) throw badRequest('Which user?');
  const p = await one(db, 'profiles', q => q.select(PROFILE_COLS).eq('id', pid));
  if (!p) throw notFound('User not found.');
  return p;
}

/** THE ANCHOR RULE (port of _resetCycleIfReactivating). When a vendor's ADMIN account goes from
    inactive to active the business is coming back after a pause, so its trial / billing cycle
    starts again today rather than owing for the months it was switched off. Sellers and
    assistant admins do not move it. One vendor write, only when the rule fires. */
export async function resetAnchorIfReactivating(db, profile, becomesActive, nowMs) {
  if (!becomesActive || toBool(profile.active) || profile.role !== 'admin' || !profile.vendor_id) return false;
  await update(db, 'vendors', { registered_on: iso(nowMs) }, q => q.eq('id', profile.vendor_id));
  return true;
}

/* ------------------------------------------------------------------ argument checks */
function emailArg(v) {
  const e = mustText(v, 'Email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw badRequest('Enter a valid email address.');
  return e;
}
function handleArg(v) {
  const h = mustText(v, 'User ID');
  if (/\s/.test(h)) throw badRequest('User ID cannot contain spaces.');
  return h;
}
function passwordArg(v) {
  const p = String(v == null ? '' : v);
  if (p.length < 4) throw badRequest('Password must be at least 4 characters.');
  return p;
}
function hashed(password) { const { hash, salt } = hashPassword(password); return { password_hash: hash, password_salt: salt }; }
/** The role a caller may hand out: a manager any, an admin only the vendor ones. */
function roleArg(user, v) {
  const role = mustText(v, 'Role');
  if (!ROLES.includes(role)) throw badRequest('Unknown role: ' + role);
  if (!isManagerLevel(user.role) && !VENDOR_ROLES.includes(role)) throw forbidden('Only the system manager can create manager accounts.');
  return role;
}
function currencyArg(v) {
  const c = String(v == null ? '' : v).trim().toUpperCase();
  if (!c) return 'TZS';
  if (!/^[A-Z]{3,5}$/.test(c)) throw badRequest('Currency must be a 3-5 letter code, like TZS or USD.');
  return c;
}
/** An admin reaches only their own vendor's people and never a manager. */
function guardTarget(user, target) {
  if (isManagerLevel(user.role)) return;
  if (isManagerLevel(target.role)) throw forbidden('Only the system manager can edit manager accounts.');
  if (String(target.vendor_id || '') !== String(user.vendor_id || '')) throw forbidden('That user belongs to another business.');
}

/** Is `value` already somebody's email / handle? An exact match first (the unique index, and on
    the citext columns that is already case-blind), then an escaped ILIKE so a plain-text column
    or the test fake refuse 'FRANK' beside 'frank' too -- the same two looks HOPE's authCode
    takes. `%` and `_` are wildcards in LIKE, hence the escape. Two reads at most. */
async function taken(db, col, value, excludeId) {
  const look = (q, apply) => { let s = apply(q.select('id')); if (excludeId) s = s.neq('id', excludeId); return s.limit(1); };
  const exact = await rows(db, 'profiles', q => look(q, s => s.eq(col, value)));
  if (exact.length) return true;
  const pattern = String(value).replace(/([\\%_])/g, '\\$1');
  const loose = await rows(db, 'profiles', q => look(q, s => s.ilike(col, pattern)));
  return loose.length > 0;
}
async function ensureFree(db, email, handle, excludeId) {
  if (await taken(db, 'email', email, excludeId)) throw badRequest('Barua pepe tayari ipo. / That email is already in use.');
  if (await taken(db, 'handle', handle, excludeId)) throw badRequest('Kitambulisho tayari kipo. / That User ID is already taken.');
}
/** A branch id checked to belong to the vendor -- a seller cannot be filed under another shop's
    counter. Empty -> null (no branch). One read when given. */
async function branchFor(db, branchId, vendorId) {
  const id = text(branchId);
  if (!id) return null;
  const b = await one(db, 'branches', q => q.select('id, vendor_id').eq('id', id));
  if (!b || String(b.vendor_id) !== String(vendorId)) throw badRequest('That branch does not belong to this business.');
  return b.id;
}

/* ------------------------------------------------------------------ images */
function readImage(dataUrl) {
  try { return decodeDataUrl(dataUrl); }
  catch (e) { throw new AppError(e.message, e.status || 400); }
}
async function storeImage(db, bucket, path, img, nowMs) {
  try { return await uploadImage(db, bucket, path, img, nowMs); }
  catch (e) { throw new AppError(e.message, e.status || 502); }
}

/* ------------------------------------------------------------------ lookups for the list */
/** vendor id -> name for the rows about to be listed. 0 reads for an admin (their vendor is on
    the session), 1 for a manager (one vendor, or all of them). */
async function vendorNames(db, user, scope) {
  const m = new Map();
  if (scope) {
    const v = (user.vendor && String(user.vendor.id) === String(scope)) ? user.vendor : await mustVendor(db, scope);
    m.set(String(v.id), v.name);
  } else {
    for (const v of await vendorsList(db, true)) m.set(String(v.id), v.name);
  }
  return m;
}
/** branch id -> name, only for the branches these people are actually filed under. */
async function branchNames(db, list) {
  const ids = [...new Set(list.map(p => p.branch_id).filter(Boolean).map(String))];
  const m = new Map();
  if (!ids.length) return m;
  for (const b of await rows(db, 'branches', q => q.select('id, name').in('id', ids))) m.set(String(b.id), b.name);
  return m;
}

export const FN = {
  /** { q?, vendor_id? } -> { rows }. Admin: own vendor (one bounded read). Manager: everybody,
      paged, or one vendor. The search is the legacy searchUsers filter -- name, role, handle or
      business name, case-blind -- applied in code over that read. 2-3 round trips. */
  users: async (db, user, args) => {
    requireAdmin(user);
    const scope = vendorScope(user, args);
    const list = scope
      ? await rows(db, 'profiles', q => q.select(PROFILE_COLS).eq('vendor_id', scope).order('name'))
      : await rowsAll(db, 'profiles', q => q.select(PROFILE_COLS).order('name'));
    const vendorName = await vendorNames(db, user, scope);
    const branchName = await branchNames(db, list);
    const q = String(args.q == null ? '' : args.q).trim().toLowerCase();
    const out = [];
    for (const p of list) {
      const row = { ...publicProfile(p), vendor_name: vendorName.get(String(p.vendor_id)) || '', branch_name: branchName.get(String(p.branch_id)) || '' };
      if (q && ![row.name, row.role, row.handle, row.vendor_name].some(s => String(s || '').toLowerCase().includes(q))) continue;
      out.push(row);
    }
    out.sort(byName);
    return { rows: out };
  },

  /** { email, name, role, handle, password, branch_id?, vendor_id? (manager) } -> { user }.
      Reads: up to 4 uniqueness looks + the branch + (manager) the vendor; 1 insert. */
  addUser: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const email = emailArg(args.email), name = mustText(args.name, 'Name'), handle = handleArg(args.handle);
    const role = roleArg(user, args.role);
    const password = passwordArg(args.password);
    // A manager account belongs to no business; everybody else must belong to exactly one --
    // the admin's own, or the one a manager named.
    let vendorId = null;
    if (!isManagerLevel(role)) {
      vendorId = vendorScope(user, args);
      if (!vendorId) throw badRequest('Choose the business this user belongs to.');
      if (isManagerLevel(user.role)) await mustVendor(db, vendorId);
    }
    await ensureFree(db, email, handle, null);
    const branchId = vendorId ? await branchFor(db, args.branch_id, vendorId) : null;
    const row = await insertOne(db, 'profiles', {
      email, name, handle, role, vendor_id: vendorId, branch_id: branchId, active: true,
      profile_photo_url: null, created_at: iso(nowMs), ...hashed(password),
    });
    bustSessions(db);
    return { user: publicProfile(row) };
  },

  /** { id, email, name, role, handle, password?, active, branch_id? } -> { user }. Same checks as
      addUser, excluding the row itself from uniqueness; a non-empty password is a manager's to
      set; the anchor rule fires when this vendor's admin comes back. 1 read + ~4 looks + 1-2 writes. */
  updateUser: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const target = await mustProfile(db, args.id);
    guardTarget(user, target);
    const email = emailArg(args.email), name = mustText(args.name, 'Name'), handle = handleArg(args.handle);
    const role = roleArg(user, args.role);
    const active = args.active === undefined ? toBool(target.active) : toBool(args.active);
    const self = String(target.id) === String(user.id);
    if (self && !active) throw forbidden('You cannot deactivate your own account.');
    if (self && role !== target.role && !isManagerLevel(user.role)) throw forbidden('You cannot change your own role.');
    const password = String(args.password == null ? '' : args.password);
    if (password && !isManagerLevel(user.role)) throw forbidden('Ask the system manager to change passwords, or use Forgot Password.');
    if (password) passwordArg(password);
    let vendorId = target.vendor_id;
    if (isManagerLevel(role)) vendorId = null;
    else if (!vendorId) {
      vendorId = text(args.vendor_id);
      if (!vendorId) throw badRequest('Choose the business this user belongs to.');
      await mustVendor(db, vendorId);
    }
    const patch = { email, name, handle, role, active, vendor_id: vendorId };
    // A branch sent (even empty) is applied; one not sent is kept -- unless the vendor moved.
    if ('branch_id' in args || String(vendorId || '') !== String(target.vendor_id || '')) {
      patch.branch_id = vendorId ? await branchFor(db, 'branch_id' in args ? args.branch_id : target.branch_id, vendorId) : null;
    }
    if (password) Object.assign(patch, hashed(password));
    await ensureFree(db, email, handle, target.id);
    const [row] = await update(db, 'profiles', patch, q => q.eq('id', target.id));
    await resetAnchorIfReactivating(db, target, active, nowMs);
    bustSessions(db);
    return { user: publicProfile(row || { ...target, ...patch }) };
  },

  /** { id, active } -> { message }. Same scope as updateUser, same anchor rule. 1 read, 1-2 writes. */
  toggleUser: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const target = await mustProfile(db, args.id);
    guardTarget(user, target);
    const active = toBool(args.active);
    if (String(target.id) === String(user.id) && !active) throw forbidden('You cannot deactivate your own account.');
    await update(db, 'profiles', { active }, q => q.eq('id', target.id));
    const reset = await resetAnchorIfReactivating(db, target, active, nowMs);
    bustSessions(db);
    return { message: !active ? 'User deactivated.' : reset ? 'User activated. The business trial / billing cycle starts again today.' : 'User activated.' };
  },

  /** { id } -> { message }. Manager only. Their sessions go first so a signed-in device stops at
      once. A person with sales or lendings on their name cannot be deleted -- the database keeps
      the history -- so the answer is to deactivate them. 1 read, 2 deletes. */
  deleteUser: async (db, user, args) => {
    requireManager(user);
    const target = await mustProfile(db, args.id);
    if (String(target.id) === String(user.id)) throw forbidden('You cannot delete your own account.');
    await remove(db, 'sessions', q => q.eq('profile_id', target.id));
    try { await remove(db, 'profiles', q => q.eq('id', target.id)); }
    catch (e) {
      if (/foreign key|violates|referenced/i.test(String(e.message || ''))) throw badRequest('This user has sales or other records on their name and cannot be deleted -- deactivate them instead.');
      throw e;
    }
    bustSessions(db);
    return { message: 'User deleted.' };
  },

  /** { profile_id, data_url } -> { url }. Yourself, an admin for their own people, a manager for
      anybody. One object per person (`<id>.<ext>`, overwritten). 1 read, 1 upload, 1 write. */
  uploadProfilePhoto: async (db, user, args, nowMs) => {
    const target = await mustProfile(db, args.profile_id);
    const self = String(target.id) === String(user.id);
    const ownPeople = isAdminLevel(user.role) && target.vendor_id && String(target.vendor_id) === String(user.vendor_id);
    if (!self && !ownPeople && !isManagerLevel(user.role)) throw forbidden('You can only change your own photo.');
    const img = readImage(args.data_url);
    const url = await storeImage(db, BUCKETS.photo, target.id + '.' + img.ext, img, nowMs);
    await update(db, 'profiles', { profile_photo_url: url }, q => q.eq('id', target.id));
    bustSessions(db);
    return { url };
  },

  /** { current, password } -> { message }. Own account only, against the current password --
      the one path a person has to their own password. 1 read, 1 write. */
  changePassword: async (db, user, args) => {
    const row = await one(db, 'profiles', q => q.select('id, password_hash, password_salt').eq('id', user.id));
    if (!row) throw notFound('Account not found.');
    if (!verifyPassword(args.current, row.password_hash, row.password_salt)) throw badRequest('Nenosiri la sasa si sahihi. / The current password is wrong.');
    const password = passwordArg(args.password);
    await update(db, 'profiles', hashed(password), q => q.eq('id', user.id));
    bustSessions(db);
    return { message: 'Nenosiri limebadilishwa. / Password changed.' };
  },

  /** {} -> { vendor }. Read fresh (1) rather than off the session, so the form shows what was
      last saved. A manager has no business to profile. */
  businessProfile: async (db, user) => {
    if (isManagerLevel(user.role)) throw badRequest('A manager account has no business profile.');
    const vendorId = requireVendorUser(user);
    return { vendor: pickVendor(await mustVendor(db, vendorId)) };
  },

  /** { business_type, phone, address, currency } -> { vendor }. Admin, own vendor. The currency
      used to be a setting per vendor name; it is a column now, normalised to a 3-5 letter code
      (blank = TZS). 1 write. */
  setBusinessProfile: async (db, user, args) => {
    requireAdmin(user);
    if (isManagerLevel(user.role)) throw badRequest('A manager account has no business profile.');
    const vendorId = requireVendorUser(user);
    const patch = {
      business_type: text(args.business_type) || '', phone: text(args.phone) || '',
      address: text(args.address) || '', currency: currencyArg(args.currency),
    };
    const [v] = await update(db, 'vendors', patch, q => q.eq('id', vendorId));
    if (!v) throw notFound('Business not found.');
    bustSessions(db);
    return { vendor: pickVendor(v) };
  },

  /** { vendor_id?, data_url } -> { url }. Admin: own vendor whatever was sent; manager: the one
      named. One object per business (`<vendor_id>.<ext>`). 0-1 read, 1 upload, 1 write. */
  uploadLogo: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const vendorId = vendorScope(user, args);
    if (!vendorId) throw badRequest('Choose the business this logo belongs to.');
    const vendor = (user.vendor && String(user.vendor.id) === String(vendorId)) ? user.vendor : await mustVendor(db, vendorId);
    const img = readImage(args.data_url);
    const url = await storeImage(db, BUCKETS.logo, vendor.id + '.' + img.ext, img, nowMs);
    await update(db, 'vendors', { logo_url: url }, q => q.eq('id', vendor.id));
    bustSessions(db);
    return { url };
  },
};

export const WRITES = ['addUser', 'updateUser', 'toggleUser', 'deleteUser', 'uploadProfilePhoto', 'changePassword', 'setBusinessProfile', 'uploadLogo'];
