import { rows, rowsAll, num, money, text, badRequest, isAdminLevel, isManagerLevel, vendorScope, scopedVendor,
  periodBounds, addDaysKey, eatStart, keyOf, currencyOf, stockStatus, vendorSalesSummary, stockValueByVendor, vendorsList } from './_shared.js';
import { requireManager } from '../auth.js';

/* =====================================================================================
   THE TWO HOME SCREENS: a business's dashboard and the manager's overview of every business.
   =====================================================================================
   The Apps Script version read the whole Sales sheet, the whole ProductsDB and the whole
   Users sheet on every dashboard open, for every vendor, then filtered in code. Here every
   read is narrowed to one vendor in the query and bounded to the window the screen actually
   shows: a week of chart plus the month to date. The year, which would be the one big read,
   comes from bo_vendor_sales_summary (or its paged fallback) -- one row per vendor. */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SALE_COLS = 'seller_id, branch_id, qty, total, payment_method, sold_at';

/** The product summary the dashboard table and the "stock" detail both show. null vendor =
    every vendor (the manager's stock detail). One paged read of active products. */
export async function productRows(db, vendorId) {
  const list = await rowsAll(db, 'products', q => {
    let s = q.select('id, vendor_id, legacy_id, name, brand, model, stock, price, reorder_point, is_serialized').eq('active', true);
    if (vendorId) s = s.eq('vendor_id', vendorId);
    return s.order('legacy_id', { ascending: true });
  });
  return list.map(p => ({
    id: p.id, vendor_id: p.vendor_id, legacy_id: p.legacy_id, name: p.name, brand: p.brand || '', model: p.model || '',
    stock: num(p.stock), price: num(p.price), value: money(num(p.price) * num(p.stock)), status: stockStatus(p), is_serialized: !!p.is_serialized,
  }));
}

/** today / week / month totals of a list of completed sales, on the EAT boundaries. Instants
    are compared as numbers: PostgREST spells a timestamptz "+00:00" and eatStart spells it
    "Z", so a string comparison would disagree with itself at an exact boundary. */
function sumPeriods(list, b) {
  const t = { today: 0, week: 0, month: 0, all: 0, units_today: 0 };
  const today = Date.parse(b.today), week = Date.parse(b.week), month = Date.parse(b.month);
  for (const s of list) {
    const at = Date.parse(s.sold_at), v = num(s.total);
    if (at >= today) { t.today += v; t.units_today += num(s.qty); }
    if (at >= week) t.week += v;
    if (at >= month) t.month += v;
    t.all += v;
  }
  return t;
}

/** The 7-day trend exactly as buildSalesTrend drew it: one bar per EAT day, the last one 'Today'. */
function trend(list, b) {
  const chart = [], at = new Map();
  for (let d = 6; d >= 0; d--) {
    const key = addDaysKey(b.todayKey, -d);
    at.set(key, chart.length);
    chart.push({ label: d === 0 ? 'Today' : DAY_NAMES[new Date(key + 'T12:00:00Z').getUTCDay()], value: 0 });
  }
  for (const s of list) {
    const i = at.get(keyOf(s.sold_at));
    if (i !== undefined) chart[i].value += num(s.total);
  }
  return chart;
}

/** { cash, lipa, credit, items } of one person's sales today. Credit is its own bucket: the
    partner pays the shop, so it is not cash in the seller's pocket and must not count as due. */
function todayByMethod(list, todayMs) {
  const t = { cash: 0, lipa: 0, credit: 0, items: 0 };
  for (const s of list) {
    if (Date.parse(s.sold_at) < todayMs) continue;
    const v = num(s.total);
    if (s.payment_method === 'Lipa Number') t.lipa += v;
    else if (s.payment_method === 'Credit') t.credit += v;
    else t.cash += v;                                      // Cash, and anything unknown, as the old code did
    t.items += num(s.qty);                                // units, which is what Frank asks per employee
  }
  return t;
}

/* dashboard -- round trips: admin 6 (sales, year summary, products, sellers, today's cash
   receipts, branches), manager 5 (+ the named vendor, - seller rows), seller 2 (own sales,
   products). The year summary is 1 with the RPC in place, 2 on the paged fallback. */
async function dashboard(db, user, args, nowMs) {
  const vid = vendorScope(user, args);
  if (!vid) throw badRequest('Pick a business (vendor_id) -- the overview of every business is managerDashboard.');
  const vendor = await scopedVendor(db, user, args);
  const b = periodBounds(nowMs);
  const own = !isAdminLevel(user.role) && !isManagerLevel(user.role);     // a seller sees only their own sales
  const branchId = text(args.branch_id);

  /* ONE read of completed sales gives today, week, month and the 7-day chart: the window
     starts at the earlier of the month start and six days ago. A seller's read goes back to
     the year start instead -- their year total exists nowhere else, and one person's year is
     a small read. The vendor's year is the RPC's job. */
  const chartStart = eatStart(addDaysKey(b.todayKey, -6));
  const windowStart = own ? b.year : (chartStart < b.month ? chartStart : b.month);
  const sales = await rowsAll(db, 'sales', q => {
    let s = q.select(SALE_COLS).eq('vendor_id', vid).eq('status', 'completed').gte('sold_at', windowStart);
    if (own) s = s.eq('seller_id', user.id);
    if (branchId) s = s.eq('branch_id', branchId);
    return s;
  });
  const t = sumPeriods(sales, b);

  /* The year: the seller's from their own rows; the vendor's from the summary. A branch filter
     has neither -- a per-branch year needs its own RPC (notes/sales-NOTES.md) -- so until then
     it is the sum of the rows in the window, i.e. the month to date, and says so here. */
  let yearTotal = t.all;
  if (!own && !branchId) {
    const summary = await vendorSalesSummary(db, nowMs, vid);
    const mine = summary.get(String(vid));
    yearTotal = mine ? mine.year : 0;
  }

  const products = await productRows(db, vid);           // vendor-wide even under a branch filter: stock is the vendor total
  let stockValue = 0, lowCount = 0;
  for (const p of products) { stockValue += p.value; if (p.status === 'LOW') lowCount++; }

  const out = {
    currency: currencyOf(vendor),
    today_total: money(t.today), week_total: money(t.week), month_total: money(t.month), year_total: money(yearTotal),
    low_count: lowCount, stock_value: money(stockValue), chart: trend(sales, b), products,
  };

  if (own) {
    out.self = todayByMethod(sales, Date.parse(b.today));
    return out;
  }

  if (isAdminLevel(user.role)) out.seller_rows = await sellerRows(db, vid, sales, b);

  /* Per-shop rows only when the vendor has shops, and only when the screen is not already
     narrowed to one (every other row would read 0). Units are today's, like the seller rows. */
  if (!branchId) {
    const branches = await rows(db, 'branches', q => q.select('id, name').eq('vendor_id', vid).eq('active', true).order('name').limit(200));
    if (branches.length) {
      out.branch_rows = branches.map(br => {
        const bt = sumPeriods(sales.filter(s => String(s.branch_id) === String(br.id)), b);
        return { branch_id: br.id, name: br.name, today: money(bt.today), week: money(bt.week), month: money(bt.month), year: money(bt.all), units: bt.units_today };
      });
    }
  }
  return out;
}

/** The admin's cash-due table: every ACTIVE seller of the vendor, today's sales by method
    against what they handed in today (cash_receipts). Two reads. The rule "no Lipa receipt
    recorded => Lipa counts as received" is the old app's: Lipa money goes straight to the
    owner's number, so it is only ever "due" when somebody recorded a short receipt. */
async function sellerRows(db, vid, sales, b) {
  const sellers = await rows(db, 'profiles', q => q.select('id, name, handle').eq('vendor_id', vid).eq('role', 'seller').eq('active', true).order('name').limit(500));
  const receipts = await rowsAll(db, 'cash_receipts', q => q.select('seller_id, cash_amount, lipa_amount').eq('vendor_id', vid).gte('received_at', b.today).lt('received_at', b.tomorrow));
  const todayMs = Date.parse(b.today);
  return sellers.map(u => {
    const st = todayByMethod(sales.filter(s => String(s.seller_id) === String(u.id)), todayMs);
    let cashRec = 0, lipaRec = 0;
    for (const r of receipts) if (String(r.seller_id) === String(u.id)) { cashRec += num(r.cash_amount); lipaRec += num(r.lipa_amount); }
    if (lipaRec === 0) lipaRec = st.lipa;
    return {
      seller_id: u.id, name: u.name, handle: u.handle,
      cash_sales: money(st.cash), lipa_sales: money(st.lipa), credit_sales: money(st.credit),
      cash_received: money(cashRec), lipa_received: money(lipaRec),
      cash_due: money(st.cash - cashRec), lipa_due: money(st.lipa - lipaRec),
    };
  });
}

/* managerDashboard -- round trips: 4 (vendors, sales summary, stock value, one profiles read
   for admins and active sellers together); 5 when the summary RPC is missing and falls back. */
async function managerDashboard(db, user, args, nowMs) {
  requireManager(user);
  const vendors = await vendorsList(db);
  const summary = await vendorSalesSummary(db, nowMs);
  const stock = await stockValueByVendor(db);
  const people = await rowsAll(db, 'profiles', q => q.select('id, name, handle, role, vendor_id, active').in('role', ['seller', 'admin']).not('vendor_id', 'is', null));

  const totals = { vendor_count: vendors.length, today: 0, week: 0, month: 0, year: 0, stock_value: 0 };
  const out = vendors.map(v => {
    const k = String(v.id);
    const s = summary.get(k) || { today: 0, week: 0, month: 0, year: 0 };
    const st = stock.get(k) || { value: 0, count: 0 };
    const mine = people.filter(p => String(p.vendor_id) === k);
    // The admin shown is the active one when there is one; a deactivated admin still names the business.
    const admin = mine.find(p => p.role === 'admin' && p.active) || mine.find(p => p.role === 'admin') || null;
    const sellers = mine.filter(p => p.role === 'seller' && p.active).length;
    totals.today += s.today; totals.week += s.week; totals.month += s.month; totals.year += s.year; totals.stock_value += st.value;
    return {
      vendor_id: v.id, name: v.name, admin_name: admin ? admin.name : '', admin_handle: admin ? admin.handle : '',
      today: money(s.today), week: money(s.week), month: money(s.month), year: money(s.year),
      products: st.count, sellers, stock_value: money(st.value), currency: currencyOf(v),
    };
  });
  return { ...totals, today: money(totals.today), week: money(totals.week), month: money(totals.month), year: money(totals.year), stock_value: money(totals.stock_value), rows: out };
}

export const FN = { dashboard, managerDashboard };
export const WRITES = [];
