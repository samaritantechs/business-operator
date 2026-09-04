import { fetchAll, runQuery, friendlyDbError, rpcAll } from '../supabase.js';
import { AppError, badRequest, forbidden, notFound, isManagerLevel, isAdminLevel, vendorScope, VENDOR_COLS, PROFILE_COLS } from '../auth.js';
import { todayKey, weekMondayKey, addDaysKey, localNow } from '../time.js';
import { fillTemplate } from '../email.js';

export { badRequest, forbidden, notFound, AppError, isManagerLevel, isAdminLevel, vendorScope, VENDOR_COLS, PROFILE_COLS, fillTemplate };
export { todayKey, weekMondayKey, addDaysKey, localNow };

/* =====================================================================================
   THE SMALL VOCABULARY EVERY MODULE SPEAKS.
   =====================================================================================
   One place for "run a query and throw a clean error", for the EAT day/week/month boundaries,
   for money, for settings, for the trial and billing arithmetic the Apps Script version did in
   three different functions. A module that needs one of these imports it from here; nothing
   below reaches for the database client directly. */

export function dbErr(error) { return new AppError(friendlyDbError(error), 500); }

/** One bounded read. `build` receives the table builder and returns a query. */
export async function rows(db, table, build) {
  const { data, error } = await runQuery(() => build(db.from(table)));
  if (error) throw dbErr(error);
  return data || [];
}
/** A read that may exceed a page: paginates past PostgREST's silent cap. */
export async function rowsAll(db, table, build) {
  return fetchAll(() => build(db.from(table)));
}
export async function one(db, table, build) {
  const { data, error } = await runQuery(() => build(db.from(table)).maybeSingle());
  if (error) throw dbErr(error);
  return data || null;
}
export async function insertOne(db, table, row) {
  const { data, error } = await runQuery(() => db.from(table).insert(row).select().maybeSingle());
  if (error) throw dbErr(error);
  return data;
}
export async function insertMany(db, table, list) {
  if (!list || !list.length) return [];
  const { data, error } = await runQuery(() => db.from(table).insert(list).select());
  if (error) throw dbErr(error);
  return data || [];
}
/** update(db, 'products', { stock: 4 }, q => q.eq('id', id)) -> the updated rows. */
export async function update(db, table, patch, build) {
  const { data, error } = await runQuery(() => build(db.from(table).update(patch)).select());
  if (error) throw dbErr(error);
  return data || [];
}
export async function remove(db, table, build) {
  const { data, error } = await runQuery(() => build(db.from(table).delete()).select());
  if (error) throw dbErr(error);
  return data || [];
}
/** A head-only exact count: the cheapest read there is. */
export async function count(db, table, build) {
  const { count: n, error } = await runQuery(() => build(db.from(table).select('id', { count: 'exact', head: true })));
  if (error) throw dbErr(error);
  return n || 0;
}
/** rpc with a JavaScript fallback when the function is not in the database yet (PGRST202). */
export async function rpcOr(db, fn, args, fallback, opts = {}) {
  /* A function that returns ONE value (a new stock count) is not a set, and paging it through
     rpcAll would turn 42 into []. Scalar functions are asked once, plainly; set-returning ones
     page past the 1000-row cap the same way a table read does. */
  const { data, error } = opts.scalar
    ? await runQuery(() => db.rpc(fn, args))
    : await rpcAll(db, fn, args);
  if (!error) return data;
  if (isMissingFunction(error)) return fallback();
  throw dbErr(error);
}
export function isMissingFunction(error) {
  const m = String((error && error.message) || error || '');
  return (error && error.code === 'PGRST202') || /Could not find the function|no rpc|function .* does not exist/i.test(m);
}

/* ------------------------------------------------------------------ time on the EAT clock */
export const iso = ms => new Date(ms).toISOString();
/** 00:00 East Africa Time of a yyyy-mm-dd key, as an ISO instant. */
export function eatStart(key) { return new Date(key + 'T00:00:00+03:00').toISOString(); }
/** The instant the day AFTER `key` starts -- an exclusive upper bound. */
export function eatEnd(key) { return eatStart(addDaysKey(key, 1)); }
export function monthStartKey(nowMs) { return todayKey(nowMs).slice(0, 7) + '-01'; }
export function yearStartKey(nowMs) { return todayKey(nowMs).slice(0, 4) + '-01-01'; }
/** Every boundary a dashboard wants, once: ISO instants plus the date keys they came from. */
export function periodBounds(nowMs = Date.now()) {
  const today = todayKey(nowMs), week = weekMondayKey(nowMs), month = monthStartKey(nowMs), year = yearStartKey(nowMs);
  return {
    todayKey: today, weekKey: week, monthKey: month, yearKey: year,
    today: eatStart(today), week: eatStart(week), month: eatStart(month), year: eatStart(year),
    tomorrow: eatEnd(today),
  };
}
/** yyyy-mm-dd on the EAT clock of an ISO instant. */
export function keyOf(isoTs) { return isoTs ? todayKey(Date.parse(isoTs)) : ''; }
/** Validates a yyyy-mm-dd string from a date picker. */
export function dateKeyArg(v, label) {
  const k = String(v == null ? '' : v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !Number.isFinite(Date.parse(k + 'T00:00:00Z'))) throw badRequest('Pick a valid ' + (label || 'date') + ' (yyyy-mm-dd).');
  return k;
}
/** A [start, end) instant pair for a date-range report, inclusive of both picked days. */
export function rangeBounds(start, end) {
  const s = dateKeyArg(start, 'start date'), e = dateKeyArg(end, 'end date');
  if (e < s) throw badRequest('The end date is before the start date.');
  return { startKey: s, endKey: e, from: eatStart(s), to: eatEnd(e) };
}

/* ------------------------------------------------------------------ numbers and text */
export const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const int = v => { const n = parseInt(String(v == null ? '' : v).replace(/[^0-9-]/g, ''), 10); return Number.isFinite(n) ? n : 0; };
export const money = v => Math.round(num(v) * 100) / 100;
export const fmtMoney = n => num(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
export const text = v => { const s = String(v == null ? '' : v).trim(); return s || null; };
export const mustText = (v, label) => { const s = text(v); if (!s) throw badRequest((label || 'A value') + ' is required.'); return s; };
export const digitsOnly = v => String(v == null ? '' : v).replace(/[^0-9]/g, '');
export const uuidLike = v => /^[0-9a-f-]{8,}$/i.test(String(v || ''));

/* ------------------------------------------------------------------ settings */
export const SETTING_KEYS = ['FreeRegistration', 'commissionRate', 'trialDays', 'hintLifetime', 'hintInterval',
  'loadingTime', 'autoSyncSeconds', 'sessionTimeoutMinutes', 'paymentReminderText', 'lendingReminderText',
  'announcement_enabled', 'announcement_title', 'announcement_text', 'announcement_audience', 'announcement_version'];
export const SETTING_DEFAULTS = {
  FreeRegistration: 'Yes', commissionRate: '0', trialDays: '60', hintLifetime: '5', hintInterval: '300',
  loadingTime: '0', autoSyncSeconds: '120', sessionTimeoutMinutes: '0', paymentReminderText: '', lendingReminderText: '',
  announcement_enabled: 'No', announcement_title: "What's New", announcement_text: '', announcement_audience: 'both', announcement_version: '',
};
export async function getSettings(db, keys) {
  const list = keys || SETTING_KEYS;
  const got = await rows(db, 'settings', q => q.select('key, value').in('key', list));
  const out = {};
  for (const k of list) { const r = got.find(x => x.key === k); out[k] = (r && r.value != null && String(r.value) !== '') ? String(r.value) : (SETTING_DEFAULTS[k] != null ? SETTING_DEFAULTS[k] : ''); }
  return out;
}
export async function getSetting(db, key) { return (await getSettings(db, [key]))[key]; }
export async function setSetting(db, key, value) {
  const { error } = await runQuery(() => db.from('settings').upsert({ key, value: value == null ? '' : String(value) }, { onConflict: 'key' }));
  if (error) throw dbErr(error);
  return 'OK';
}

/* ------------------------------------------------------------------ vendors */
export const DEFAULT_PERMISSIONS = {
  sellerCanDownloadReport: false, sellerReceivesEmail: false, adminReceivesDaily: true,
  adminReceivesWeekly: false, adminReceivesMonthly: false, sellerReceivesDaily: false, dashboardVisible: true,
};
export function permissionsOf(vendor) {
  let p = vendor && vendor.permissions;
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = null; } }
  return { ...DEFAULT_PERMISSIONS, ...(p && typeof p === 'object' ? p : {}) };
}
export const currencyOf = vendor => (vendor && vendor.currency) || 'TZS';
export async function vendorById(db, id) {
  if (!id) return null;
  return one(db, 'vendors', q => q.select(VENDOR_COLS).eq('id', id));
}
export async function mustVendor(db, id) {
  const v = await vendorById(db, id);
  if (!v) throw notFound('Business not found.');
  return v;
}
export async function vendorsList(db, includeInactive) {
  const list = await rowsAll(db, 'vendors', q => (includeInactive ? q.select(VENDOR_COLS) : q.select(VENDOR_COLS).eq('active', true)).order('name'));
  return list;
}
/** The vendor a call is about, loaded once: the caller's own, or the one a manager named. */
export async function scopedVendor(db, user, args) {
  const id = vendorScope(user, args);
  if (!id) return null;
  if (user.vendor && user.vendor.id === id) return user.vendor;
  return mustVendor(db, id);
}
/** Refuses a caller who is not attached to a business (a manager on a vendor-only screen). */
export function requireVendorUser(user) {
  if (!user.vendor_id || !user.vendor) throw forbidden('This screen belongs to a business account.');
  return user.vendor_id;
}
/** Sellers may only act on themselves; admins on their vendor; managers anywhere. */
export function requireSameVendor(user, row) {
  if (isManagerLevel(user.role)) return;
  if (!row || String(row.vendor_id || '') !== String(user.vendor_id || '')) throw forbidden('That record belongs to another business.');
}

/* ------------------------------------------------------------------ trial and billing */
export function trialDays(settings) { const n = parseInt(settings.trialDays, 10); return (Number.isFinite(n) && n >= 0) ? n : 60; }
export function trialDaysRemaining(registeredOn, days, nowMs = Date.now()) {
  if (!registeredOn) return null;
  const t = Date.parse(registeredOn);
  if (!Number.isFinite(t)) return null;
  return days - Math.floor((nowMs - t) / 86400000);
}
/** The start of the vendor's CURRENT monthly billing cycle, anchored on registered_on -- the
    same walk the Apps Script _cyclePeriodStart did. Falls back to the 1st of the month. */
export function cyclePeriodStart(anchor, nowMs = Date.now()) {
  const now = new Date(nowMs);
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (!anchor) return first;
  const a = new Date(anchor);
  if (!Number.isFinite(a.getTime())) return first;
  if (a > now) return a;
  let d = new Date(a.getTime());
  for (let i = 0; i < 1200; i++) {
    const nx = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
    if (nx > now) break;
    d = nx;
  }
  return d;
}

/* ------------------------------------------------------------------ products */
export const PRODUCT_COLS = 'id, vendor_id, legacy_id, name, category, brand, model, price, stock, is_serialized, supplier, reorder_point, active, image1_url, image2_url, image3_url, listing_type, price_unit, location, created_at';
export async function productById(db, id) {
  if (!id) return null;
  return one(db, 'products', q => q.select(PRODUCT_COLS).eq('id', id));
}
export async function mustProduct(db, id, vendorId) {
  const p = await productById(db, id);
  if (!p || (vendorId && String(p.vendor_id) !== String(vendorId))) throw notFound('Product not found for your business.');
  return p;
}
/** OK / LOW / OUT, the one stock rule every screen and report uses. */
export function stockStatus(p) {
  const s = num(p.stock), r = num(p.reorder_point);
  if (s <= 0) return 'OUT';
  if (s < r) return 'LOW';
  return 'OK';
}

/* ------------------------------------------------------------------ shared across modules
   Three answers more than one screen needs. Kept here so the modules that need them do not
   have to import each other: the manager panel and the dashboard both want per-vendor sales;
   boot, auto-sync and the manager's reminder emails all want the restriction notice. */

/** Per-vendor completed-sales totals for today / this week / this month / this year, as a Map
    vendor_id -> { today, week, month, year }. One RPC (bo_vendor_sales_summary); the fallback
    reads this year's completed sales, paged, and sums in code. */
export async function vendorSalesSummary(db, nowMs = Date.now(), vendorId = null) {
  const b = periodBounds(nowMs);
  const out = new Map();
  const add = (vid, t, soldAt) => {
    let r = out.get(vid);
    if (!r) { r = { today: 0, week: 0, month: 0, year: 0 }; out.set(vid, r); }
    const v = num(t);
    if (soldAt >= b.today) r.today += v;
    if (soldAt >= b.week) r.week += v;
    if (soldAt >= b.month) r.month += v;
    r.year += v;
  };
  const rowsOut = await rpcOr(db, 'bo_vendor_sales_summary',
    { p_today: b.today, p_week: b.week, p_month: b.month, p_year: b.year },
    async () => {
      const list = await rowsAll(db, 'sales', q => {
        let s = q.select('vendor_id, total, sold_at').eq('status', 'completed').gte('sold_at', b.year);
        if (vendorId) s = s.eq('vendor_id', vendorId);
        return s;
      });
      for (const s of list) add(String(s.vendor_id), s.total, String(s.sold_at));
      return null;
    });
  if (Array.isArray(rowsOut)) {
    for (const r of rowsOut) {
      if (vendorId && String(r.vendor_id) !== String(vendorId)) continue;
      out.set(String(r.vendor_id), { today: num(r.today), week: num(r.week), month: num(r.month), year: num(r.year) });
    }
  }
  return out;
}

/** Stock value (price x stock) and active product count per vendor: Map vendor_id -> { value, count }.
    One RPC (bo_stock_value_by_vendor) -- a GROUP BY over the catalogue, one row per business.
    The fallback pages every active product and adds them up here, which is what the old app did
    on every dashboard load: two numbers per vendor bought with the whole catalogue, and it grows
    with every product anybody adds. That is why the function exists. */
export async function stockValueByVendor(db, vendorId = null) {
  const out = new Map();
  const rowsOut = await rpcOr(db, 'bo_stock_value_by_vendor', { p_vendor: vendorId }, async () => {
    const list = await rowsAll(db, 'products', q => {
      let s = q.select('vendor_id, price, stock').eq('active', true);
      if (vendorId) s = s.eq('vendor_id', vendorId);
      return s;
    });
    for (const p of list) {
      const k = String(p.vendor_id);
      const r = out.get(k) || { value: 0, count: 0 };
      r.value += num(p.price) * num(p.stock);
      r.count += 1;
      out.set(k, r);
    }
    return null;
  });
  if (Array.isArray(rowsOut)) {
    for (const r of rowsOut) {
      if (vendorId && String(r.vendor_id) !== String(vendorId)) continue;
      out.set(String(r.vendor_id), { value: num(r.value), count: num(r.product_count) });
    }
  }
  return out;
}

export const DEFAULT_PAYMENT_TEXT = '⚠️ Your account is currently restricted because of an outstanding payment. To restore full access, please settle your balance with Samaritan Techs and your account will be reactivated. Use the feedback button at the top of the page to reach us.';

/** Commission due this billing cycle for one vendor: completed sales since the cycle start
    (anchored on registered_on) x the commission rate. `settings` = getSettings() output. */
export async function commissionDue(db, vendor, settings, nowMs = Date.now()) {
  const rate = num(settings.commissionRate);
  const start = cyclePeriodStart(vendor.registered_on, nowMs).toISOString();
  const list = await rowsAll(db, 'sales', q => q.select('total').eq('vendor_id', vendor.id).eq('status', 'completed').gte('sold_at', start));
  const total = list.reduce((a, s) => a + num(s.total), 0);
  return { total, rate, due: money(total * rate / 100), cycle_start: start };
}

/** { restricted, notice } for a vendor -- the payment message with its placeholders filled
    ({vendor} {admin} {amount} {currency}). Not restricted => notice ''. `adminName` optional. */
export async function restrictionInfo(db, vendor, settings, nowMs = Date.now(), adminName = '') {
  if (!vendor || !vendor.restricted) return { restricted: false, notice: '' };
  const s = settings || await getSettings(db, ['commissionRate', 'paymentReminderText']);
  const c = await commissionDue(db, vendor, s, nowMs);
  const tpl = (s.paymentReminderText && String(s.paymentReminderText).trim()) ? s.paymentReminderText : DEFAULT_PAYMENT_TEXT;
  return { restricted: true, notice: fillTemplate(tpl, { vendor: vendor.name, admin: adminName || '', amount: c.due > 0 ? fmtMoney(c.due) : '0', currency: currencyOf(vendor) }) };
}
