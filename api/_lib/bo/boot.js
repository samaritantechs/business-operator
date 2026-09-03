import { rows, one, count, insertOne, getSettings, permissionsOf, restrictionInfo, int, iso, text, mustText } from './_shared.js';
import { hintsForRole } from './hints.js';

/* =====================================================================================
   BOOT -- everything the app needs to draw its first screen, in ONE trip.
   =====================================================================================
   The Apps Script page made seven separate calls after a login (getLoadingTime, currency,
   hint settings, auto-sync seconds, session timeout, restriction, permissions) and drew the
   workspace while they trickled in. Here login, `me` and `boot` all answer with this one
   payload, so a returning phone is on its dashboard after a single request.

   THE COST, per call: settings (1), hints (1), branches (1), partners (1), the serialized
   count (1) = 5 reads for a business user; a RESTRICTED vendor adds the sales read behind
   the payment notice (1) and, when the caller is not the admin, the admin's name (1) = 7 at
   most. A manager pays 3 (settings, hints, global partners). Sequential on purpose -- the
   pool discipline in api/_lib/supabase.js. */

const BRANCH_COLS = 'id, vendor_id, name, location, active, created_at';
const PARTNER_COLS = 'id, vendor_id, name, contact, active, created_at';
const WHATSAPP_DEFAULT = '255756749261';

function announcementOf(settings) {
  return {
    enabled: settings.announcement_enabled === 'Yes',
    title: settings.announcement_title || "What's New",
    text: settings.announcement_text || '',
    audience: settings.announcement_audience || 'both',
    version: settings.announcement_version || '',
  };
}

/** The five timings as numbers. Legacy fell back to 5 / 300 for the hint pair and 0 for
    the rest; loading time is 0 here (DECISIONS #15) rather than the old 2-second loader. */
function timingsOf(settings) {
  return {
    hintLifetime: int(settings.hintLifetime) || 5,
    hintInterval: int(settings.hintInterval) || 300,
    autoSyncSeconds: Math.max(0, int(settings.autoSyncSeconds)),
    sessionTimeoutMinutes: Math.max(0, int(settings.sessionTimeoutMinutes)),
    loadingTime: Math.max(0, int(settings.loadingTime)),
  };
}

/** perms exactly as the legacy getPermissionsForUser: admins and managers see everything;
    a seller's flags come from the vendor's permission profile (DECISIONS #7 honours them). */
function permsOf(user, vendor) {
  if (user.is_admin || user.is_manager) return { canDownloadReport: true, showDashboard: true };
  const p = permissionsOf(vendor);
  return { canDownloadReport: p.sellerCanDownloadReport === true, showDashboard: p.dashboardVisible !== false };
}

export async function buildBoot(db, user, nowMs = Date.now()) {
  // The session cache hands back the same object every time; never write on it.
  const { password_hash, password_salt, ...safeUser } = user;
  const vendor = user.vendor || null;
  const vendorId = user.is_manager ? null : (user.vendor_id || null);

  const settings = await getSettings(db);
  const hints = await hintsForRole(db, user.role);

  let restriction = { restricted: false, notice: '' };
  if (vendor && vendor.restricted && !user.is_manager) {
    // The notice names the vendor's admin; a seller of a restricted shop needs that looked up.
    let adminName = user.is_admin ? user.name : '';
    if (!adminName) {
      const a = await one(db, 'profiles', q => q.select('name').eq('vendor_id', vendor.id).eq('role', 'admin').eq('active', true)
        .order('created_at', { ascending: true }).limit(1));
      adminName = (a && a.name) || '';
    }
    restriction = await restrictionInfo(db, vendor, settings, nowMs, adminName);
  }

  const branches = vendorId
    ? await rows(db, 'branches', q => q.select(BRANCH_COLS).eq('vendor_id', vendorId).eq('active', true).order('name', { ascending: true }).limit(200))
    : [];
  const partners = await rows(db, 'financing_partners', q => (vendorId
    ? q.select(PARTNER_COLS).or('vendor_id.eq.' + vendorId + ',vendor_id.is.null')
    : q.select(PARTNER_COLS).is('vendor_id', null)).eq('active', true).order('name', { ascending: true }).limit(200));
  const serialized = vendorId ? await count(db, 'products', q => q.eq('vendor_id', vendorId).eq('is_serialized', true)) : 0;

  return {
    user: safeUser,
    vendor,
    perms: permsOf(user, vendor),
    hints,
    timings: timingsOf(settings),
    restriction,
    branches,
    partners,
    features: { has_branches: branches.length > 0, has_serialized: serialized > 0 },
    announcement: announcementOf(settings),
    whatsapp: process.env.WHATSAPP_NUMBER || WHATSAPP_DEFAULT,
  };
}

export const FN = {
  async boot(db, user, args, nowMs) { return buildBoot(db, user, nowMs); },

  /** The feedback form. The only write a restricted vendor may still make (bo-core), because
      it is how they reach the people who can lift the restriction. */
  async suggestion(db, user, args, nowMs) {
    const message = mustText(args.message, 'A message');
    await insertOne(db, 'suggestions', {
      profile_id: user.id, user_name: user.name || null, vendor_id: user.vendor_id || null,
      category: text(args.category) || 'General', message, created_at: iso(nowMs),
    });
    return { message: 'Thank you! Your suggestion has been saved.' };
  },
};

export const WRITES = ['suggestion'];
