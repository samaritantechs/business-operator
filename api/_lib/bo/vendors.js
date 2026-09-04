import { rows, rowsAll, update, badRequest, isManagerLevel, isAdminLevel, PROFILE_COLS, mustText, text, iso, num, money,
  periodBounds, rpcOr, vendorsList, mustVendor, requireVendorUser, vendorSalesSummary, stockValueByVendor,
  getSettings, trialDays, trialDaysRemaining, permissionsOf, DEFAULT_PERMISSIONS, restrictionInfo as restrictionOf } from './_shared.js';
import { requireManager, bustSessions } from '../auth.js';
import { mustProfile, resetAnchorIfReactivating, toBool } from './users.js';

/* =====================================================================================
   THE MANAGER'S VIEW OF EVERY BUSINESS.
   =====================================================================================
   In the sheet a "vendor" was a string on an admin's row: activating, restricting, permissions
   and the currency were all settings keyed `xxx_<vendor name>`, and the summary rescanned the
   whole Users, ProductsDB and Sales sheets for every vendor in turn. Here the business is a
   row, and the summary is five reads whatever the number of vendors -- the sales and stock
   totals come from _shared (an RPC with a paged fallback, and one catalogue read).

   Manager only, except restrictionInfo: every vendor user's auto-sync polls that, and it costs
   nothing at all while the business is not restricted. */

const TOP_N = 10;                       // the analytics panel's three lists are all top ten
const rank = a => (a.role === 'admin' ? 2 : 0) + (toBool(a.active) ? 1 : 0);
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' });

export const FN = {
  /** {} -> { rows }: each vendor (all columns, inactive ones too) with its admin, product count,
      today's completed sales, stock value and days of trial left. Exactly 5 round trips: vendors,
      admin profiles (paged), the per-vendor sales RPC or its fallback, the catalogue, one setting. */
  managerSummary: async (db, user, args, nowMs) => {
    requireManager(user);
    const vendors = await vendorsList(db, true);
    const admins = await rowsAll(db, 'profiles', q => q.select(PROFILE_COLS).in('role', ['admin', 'assistant-admin']).order('created_at'));
    const sales = await vendorSalesSummary(db, nowMs);
    const stock = await stockValueByVendor(db);
    const days = trialDays(await getSettings(db, ['trialDays']));
    // The face of the business: its (active) 'admin' row, else whichever admin-level row exists.
    const adminOf = new Map();
    for (const a of admins) {
      const k = String(a.vendor_id);
      const cur = adminOf.get(k);
      if (!cur || rank(a) > rank(cur)) adminOf.set(k, a);
    }
    const out = vendors.map(v => {
      const k = String(v.id), a = adminOf.get(k), s = sales.get(k), st = stock.get(k);
      return {
        ...v,
        admin_id: a ? a.id : null, admin_name: a ? a.name : '', admin_handle: a ? a.handle : '', admin_email: a ? a.email : '',
        admin_role: a ? a.role : '', admin_active: a ? toBool(a.active) : false,
        product_count: st ? st.count : 0, today_sales: s ? money(s.today) : 0, stock_value: st ? money(st.value) : 0,
        trial_days_left: trialDaysRemaining(v.registered_on, days, nowMs),
      };
    });
    out.sort(byName);
    return { rows: out };
  },

  /** {} -> { rows: [{ id, name, currency }] } of the active businesses. 1 read. */
  vendorList: async (db, user) => {
    requireManager(user);
    const list = await vendorsList(db, false);
    return { rows: list.map(v => ({ id: v.id, name: v.name, currency: v.currency || 'TZS' })) };
  },

  /** { profile_id, name?, role? (admin | assistant-admin), active? } -> { message }. The legacy
      updateAdminRole: only the fields sent change (null / '' = leave alone), and reactivating a
      vendor's admin restarts its trial / billing anchor. 1 read, 1-2 writes. */
  updateAdmin: async (db, user, args, nowMs) => {
    requireManager(user);
    const target = await mustProfile(db, args.profile_id);
    if (!isAdminLevel(target.role) || !target.vendor_id) throw badRequest('That account is not a business admin.');
    const patch = {};
    if (text(args.name)) patch.name = text(args.name);
    if (text(args.role) && String(args.role) !== 'null') {
      const role = text(args.role);
      if (!isAdminLevel(role)) throw badRequest('Role must be admin or assistant-admin.');
      patch.role = role;
    }
    if (args.active !== undefined && args.active !== null && args.active !== '' && args.active !== 'null') patch.active = toBool(args.active);
    if (!Object.keys(patch).length) throw badRequest('Nothing to change.');
    await update(db, 'profiles', patch, q => q.eq('id', target.id));
    const reset = patch.active === undefined ? false : await resetAnchorIfReactivating(db, target, patch.active, nowMs);
    bustSessions(db);
    return { message: reset ? 'Admin updated successfully. The trial / billing cycle starts again today.' : 'Admin updated successfully.' };
  },

  /** { vendor_id, active } -> { message }. The vendor row only: its people keep their own
      active flags, and the login check refuses anybody whose business is off. Reactivation
      (off -> on) resets registered_on -- deliberate, the business is coming back after a pause,
      not owing for it. 1 read, 1 write. */
  setVendorActive: async (db, user, args, nowMs) => {
    requireManager(user);
    const vendor = await mustVendor(db, mustText(args.vendor_id, 'Business'));
    const active = toBool(args.active);
    const reset = active && !toBool(vendor.active);
    const patch = reset ? { active, registered_on: iso(nowMs) } : { active };
    await update(db, 'vendors', patch, q => q.eq('id', vendor.id));
    bustSessions(db);
    return { message: active
      ? 'Business activated: ' + vendor.name + (reset ? '. The trial / billing cycle starts again today.' : '.')
      : 'Business deactivated: ' + vendor.name + '. Its users can no longer sign in.' };
  },

  /** { vendor_id, restricted } -> { message }, worded as the legacy setVendorRestricted was.
      The lock itself is bo-core's write gate; this only flips the flag. 1 read, 1 write. */
  setVendorRestricted: async (db, user, args) => {
    requireManager(user);
    const vendor = await mustVendor(db, mustText(args.vendor_id, 'Business'));
    const restricted = toBool(args.restricted);
    await update(db, 'vendors', { restricted }, q => q.eq('id', vendor.id));
    bustSessions(db);
    return { message: restricted
      ? 'Account RESTRICTED: ' + vendor.name + '. Owner and sellers now see the payment notice and cannot act until reactivated.'
      : 'Account REACTIVATED: ' + vendor.name + '. Full access restored.' };
  },

  /** {} -> { rows: [{ vendor_id, name, active, permissions }] }, every vendor, flags filled in
      from the defaults so the page always sees all seven. 1 read. */
  allVendorPermissions: async (db, user) => {
    requireManager(user);
    const list = await vendorsList(db, true);
    return { rows: list.map(v => ({ vendor_id: v.id, name: v.name, active: toBool(v.active), permissions: permissionsOf(v) })) };
  },

  /** { profile } -> { message }. The seven known flags, as booleans, become every vendor's
      permissions -- whatever else was in the profile is dropped. Vendors already holding exactly
      this profile are skipped, and because the payload is the same for all the rest it is ONE
      update (`where id in (...)`), not one per vendor. 1 read, 0-1 write. */
  setAllVendorPermissions: async (db, user, args) => {
    requireManager(user);
    const src = args.profile;
    if (!src || typeof src !== 'object' || Array.isArray(src)) throw badRequest('Send the permission profile to apply.');
    const profile = {};
    for (const k of Object.keys(DEFAULT_PERMISSIONS)) profile[k] = src[k] === undefined ? DEFAULT_PERMISSIONS[k] : toBool(src[k]);
    const vendors = await vendorsList(db, true);
    const changed = vendors.filter(v => { const cur = permissionsOf(v); return Object.keys(profile).some(k => !!cur[k] !== profile[k]); });
    if (changed.length) await update(db, 'vendors', { permissions: profile }, q => q.in('id', changed.map(v => v.id)));
    bustSessions(db);
    const skipped = vendors.length - changed.length;
    return { message: 'Permissions applied to ' + changed.length + ' of ' + vendors.length + ' business(es)' + (skipped ? ' (' + skipped + ' already matched).' : '.') };
  },

  /** {} -> marketplace analytics: views per product (all time, from the bo_click_counts GROUP
      BY), per vendor, and this year's best sellers. 4 round trips: the click counts, the
      clicked products' names, the vendors, this year's completed sales (paged). */
  analytics: async (db, user, args, nowMs) => {
    requireManager(user);
    const since = iso(nowMs - 30 * 86400000);
    /* The fallback pages the WHOLE product_clicks table -- it is append-only and grows with every
       marketplace tap, so this path is UNBOUNDED. It exists for a database that has not run
       db/schema.sql yet; the RPC is a single GROUP BY and is the real answer. */
    const counts = await rpcOr(db, 'bo_click_counts', { p_since: since }, async () => {
      const list = await rowsAll(db, 'product_clicks', q => q.select('product_id, clicked_at').not('product_id', 'is', null));
      const m = new Map();
      for (const c of list) {
        const k = String(c.product_id);
        const r = m.get(k) || { product_id: k, total: 0, recent: 0 };
        r.total += 1;
        if (String(c.clicked_at) >= since) r.recent += 1;
        m.set(k, r);
      }
      return [...m.values()];
    });
    const clicked = (Array.isArray(counts) ? counts : [])
      .map(r => ({ product_id: String(r.product_id), count: num(r.total) }))
      .filter(r => r.count > 0)
      .sort((a, b) => b.count - a.count || (a.product_id < b.product_id ? -1 : 1));
    const total_views = clicked.reduce((a, r) => a + r.count, 0);
    // The legacy average: total views over the products that were viewed at all.
    const avg_views = clicked.length ? total_views / clicked.length : 0;
    const products = await productsByIds(db, clicked.map(r => r.product_id));
    const vendorName = new Map((await vendorsList(db, true)).map(v => [String(v.id), v.name]));
    const top_viewed = clicked.slice(0, TOP_N).map(r => {
      const p = products.get(r.product_id);
      return { product_id: r.product_id, name: p ? p.name : '(deleted product)', vendor_name: p ? (vendorName.get(String(p.vendor_id)) || '') : '', count: r.count, hot: r.count >= avg_views };
    });
    const byVendor = new Map();
    for (const r of clicked) {
      const p = products.get(r.product_id);
      if (!p || !p.vendor_id) continue;
      const k = String(p.vendor_id);
      byVendor.set(k, (byVendor.get(k) || 0) + r.count);
    }
    const top_vendor_views = [...byVendor].map(([id, count]) => ({ vendor_name: vendorName.get(id) || '', count }))
      .sort((a, b) => b.count - a.count || a.vendor_name.localeCompare(b.vendor_name)).slice(0, TOP_N);
    /* Best sellers: completed sales since 1 January (EAT), grouped by product name + vendor as
       the sheet did. One RPC (bo_top_selling) groups, orders and cuts to ten in the database.
       The fallback pages the WHOLE YEAR of sales to show ten rows -- 36 round trips on a
       thirty-vendor book, and one more every thousand sales anybody makes. */
    const b = periodBounds(nowMs);
    const byKey = new Map();
    const grouped = await rpcOr(db, 'bo_top_selling', { p_since: b.year, p_limit: TOP_N }, async () => {
      const sales = await rowsAll(db, 'sales', q => q.select('vendor_id, product_name, qty, total').eq('status', 'completed').gte('sold_at', b.year));
      for (const s of sales) {
        const k = String(s.product_name || '') + '||' + String(s.vendor_id || '');
        const r = byKey.get(k) || { vendor_id: s.vendor_id, product_name: String(s.product_name || ''), qty: 0, revenue: 0 };
        r.qty += num(s.qty);
        r.revenue += num(s.total);
        byKey.set(k, r);
      }
      return null;
    });
    const sellRows = Array.isArray(grouped) ? grouped : [...byKey.values()];
    const top_selling = sellRows
      .map(r => ({ name: String(r.product_name || ''), vendor_name: vendorName.get(String(r.vendor_id)) || '', qty: num(r.qty), revenue: num(r.revenue) }))
      .sort((a, b2) => b2.qty - a.qty || b2.revenue - a.revenue || a.name.localeCompare(b2.name))
      .slice(0, TOP_N).map(r => ({ ...r, revenue: money(r.revenue) }));
    return { total_views, avg_views, top_viewed, top_vendor_views, top_selling };
  },

  /** {} -> { restricted, notice } for the caller's business -- what auto-sync polls. Managers
      and unrestricted vendors cost nothing (0 reads, the vendor row is on the session). A
      restricted vendor costs 3: its admin's name, the settings, this cycle's sales. */
  restrictionInfo: async (db, user, args, nowMs) => {
    if (isManagerLevel(user.role)) return { restricted: false, notice: '' };
    requireVendorUser(user);
    const vendor = user.vendor;
    if (!toBool(vendor.restricted)) return { restricted: false, notice: '' };
    const admin = await rows(db, 'profiles', q => q.select('name').eq('vendor_id', vendor.id).eq('role', 'admin').order('created_at').limit(1));
    return restrictionOf(db, vendor, null, nowMs, admin.length ? admin[0].name : '');
  },
};

/** id -> { id, name, vendor_id } for the products named. `.in()` puts every id in the URL, so
    past a few hundred it is safer (and no dearer) to page the whole catalogue's three columns. */
async function productsByIds(db, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const list = ids.length <= 300
    ? await rows(db, 'products', q => q.select('id, name, vendor_id').in('id', ids))
    : await rowsAll(db, 'products', q => q.select('id, name, vendor_id'));
  for (const p of list) out.set(String(p.id), p);
  return out;
}

export const WRITES = ['updateAdmin', 'setVendorActive', 'setVendorRestricted', 'setAllVendorPermissions'];
