import {
  rows, rowsAll, one, badRequest, forbidden, isManagerLevel, isAdminLevel, scopedVendor, vendorsList,
  rangeBounds, periodBounds, todayKey, addDaysKey, localNow, iso, num, money, fmtMoney, text, stockStatus,
  permissionsOf, currencyOf, getSettings, sel, PROFILE_COLS,
} from './_shared.js';
import { signTicket } from '../auth.js';
import { buildPdf } from '../pdf.js';
import { buildXlsx } from '../xlsx.js';
import { APP_BY } from '../brand.js';

/* =====================================================================================
   REPORTS -- fourteen questions, one answer shape, three outputs.
   =====================================================================================
   The Apps Script version built every report by copying rows into a throwaway Google Sheet
   and handing back its export URL: five functions, five column sets, and thirty seconds of
   Drive round trips per download. Here every report is ONE function that answers
   { title, subtitle, meta, columns, rows, totals, currency } -- the page draws that as a
   table, the PDF writer draws it as pages, the .xlsx writer as a sheet -- and the file is
   fetched with a five-minute signed ticket (DECISIONS 14) so no session token sits in a URL.

   SCOPE is decided once, in scopeFor(), before a single row is read: a seller sees only their
   own sales and only when the vendor allows it; an admin their vendor; a manager any vendor or
   every vendor at once. reportTicket() runs the same check, so a ticket is never minted for a
   report the caller could not open.

   COST. Every read is bounded by the vendor and the date range, and the big one is paged
   (rowsAll). Names are joined in code from one small read each -- sellers, products, brands
   and IMEIs are already snapshots on the sale row -- so a report is three or four round trips,
   not one per row. Each builder says its own cost above it. */

export const REPORT_TYPES = {
  sales:      { label: 'Sales Report',                stem: 'Sales',           dated: true },
  stock:      { label: 'Stock Report',                stem: 'Stock',           dated: false },
  cashdue:    { label: 'Cash Due Report',             stem: 'CashDue',         dated: false },
  lending:    { label: 'Lending Report',              stem: 'Lending',         dated: true },
  commission: { label: 'Commission Report',           stem: 'Commission',      dated: true, manager: true },
  brandmodel: { label: 'Sales by Brand & Model',      stem: 'BrandModel',      dated: true },
  partner:    { label: 'Financed Sales',              stem: 'FinancedSales',   dated: true },
  cancelled:  { label: 'Cancelled Sales',             stem: 'CancelledSales',  dated: true },
  employee:   { label: 'Sales by Employee',           stem: 'SalesByEmployee', dated: true },
  branch:     { label: 'Sales by Branch',             stem: 'SalesByBranch',   dated: true },
  payment:    { label: 'Sales by Payment Method',     stem: 'SalesByPayment',  dated: true },
  movements:  { label: 'Stock Movements',             stem: 'StockMovements',  dated: true },
  units:      { label: 'Serialized Stock',            stem: 'Units',           dated: false },
  imei:       { label: 'Sales by IMEI',               stem: 'SalesByIMEI',     dated: true },
  profit:     { label: 'Profit Report',                stem: 'Profit',          dated: true },
  customer:   { label: 'Sales by Customer',            stem: 'SalesByCustomer', dated: true },
};

const SALE_COLS = 'id, legacy_id, group_id, vendor_id, branch_id, seller_id, seller_name, customer_name, customer_phone, product_id, product_name, brand, model, '
  + 'imei, qty, list_price, discount, price, total, unit_cost, payment_method, financing_partner_id, partner_paid, partner_paid_at, status, '
  + 'cancelled_by_name, cancelled_at, cancel_reason, sold_at';

/* ------------------------------------------------------------------ small helpers */
const pad2 = n => String(n).padStart(2, '0');
/** 'dd/MM/yyyy HH:mm' on the East Africa clock -- the one date format every report prints. */
export function fmtDateTime(isoTs) {
  if (!isoTs) return '';
  const t = Date.parse(isoTs);
  if (!Number.isFinite(t)) return '';
  const d = localNow(t);
  return pad2(d.getUTCDate()) + '/' + pad2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
}
/** 'dd/MM/yyyy' of a yyyy-mm-dd key. */
export const fmtKey = k => (k ? k.slice(8, 10) + '/' + k.slice(5, 7) + '/' + k.slice(0, 4) : '');
const label = (v, dash = '') => ((v == null || v === '') ? dash : String(v));
const slug = s => String(s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Report';
const col = (key, name, opts) => ({ key, label: name, ...(opts || {}) });
const R = { align: 'right' };                 // money
const I = { align: 'right', int: true };      // counts
const cur = (s, v) => fmtMoney(v) + ' ' + s.currency;
const bump = (map, key, make) => { let r = map.get(key); if (!r) { r = make(); map.set(key, r); } return r; };
function mapById(list, key = 'name') { const m = new Map(); for (const r of list || []) m.set(String(r.id), r[key]); return m; }
const nameOf = (map, id, dash = '') => (id == null ? dash : label(map && map.get(String(id)), dash));
const shortId = id => (id ? String(id).slice(0, 8) : '');

/* ------------------------------------------------------------------ scope */
/** Who may see what, decided before any row is read. Also used by reportTicket, so a ticket is
    only ever minted for a report the caller could open. Costs at most two reads: the vendor a
    manager named, and the branch a filter named. */
async function scopeFor(db, user, args, nowMs) {
  const a = args || {};
  const type = String(a.type || '').trim().toLowerCase();
  const def = REPORT_TYPES[type];
  if (!def) throw badRequest('Chagua aina ya ripoti. / Pick a report type.');
  const manager = isManagerLevel(user.role);
  const seller = !manager && !isAdminLevel(user.role);
  if (seller) {
    if (type !== 'sales') throw forbidden('Wauzaji wanapata ripoti ya mauzo yao tu. / Sellers may only download their own sales report.');
    if (!permissionsOf(user.vendor).sellerCanDownloadReport) {
      throw forbidden('Ripoti hazijaruhusiwa kwa wauzaji wa biashara hii. / Report downloads are not enabled for sellers of this business.');
    }
  }
  if (def.manager && !manager) throw forbidden('Ripoti hii ni ya meneja tu. / Only the system manager can see this report.');
  const vendor = await scopedVendor(db, user, a);          // null = every vendor (manager)
  const today = todayKey(nowMs);
  const range = def.dated ? rangeBounds(a.start || today, a.end || today) : rangeBounds(today, today);
  let branch = null;
  const branchId = text(a.branch_id);
  if (branchId) {
    branch = await one(db, 'branches', q => q.select('id, name, vendor_id').eq('id', branchId));
    if (!branch || (vendor && String(branch.vendor_id) !== String(vendor.id))) throw badRequest('Tawi halipo. / Branch not found for this business.');
  }
  return {
    type, def, manager, all: !vendor, vendor, vendor_id: vendor ? vendor.id : null,
    currency: vendor ? currencyOf(vendor) : 'TZS',
    seller_id: seller ? user.id : null, seller_name: seller ? user.name : null,
    branch, branch_id: branch ? branch.id : null,
    status: text(a.status), partner_id: text(a.partner_id),
    range, today, nowMs,
  };
}

/* ------------------------------------------------------------------ shared reads */
/** Sales in the range for this scope -- the one paged read most reports stand on. */
function salesIn(db, s, status = 'completed', extra) {
  return rowsAll(db, 'sales', q => {
    let x = q.select(sel('sales', SALE_COLS)).eq('status', status).gte('sold_at', s.range.from).lt('sold_at', s.range.to);
    if (s.vendor_id) x = x.eq('vendor_id', s.vendor_id);
    if (s.seller_id) x = x.eq('seller_id', s.seller_id);
    if (s.branch_id) x = x.eq('branch_id', s.branch_id);
    if (extra) x = extra(x);
    return x.order('sold_at');
  });
}
/** id -> name maps, one small read each, only the ones asked for. Vendors only for 'ALL'. */
async function nameMaps(db, s, want) {
  const out = {};
  if (want.branches) {
    out.branches = mapById(await rowsAll(db, 'branches', q => (s.vendor_id ? q.select('id, name, vendor_id').eq('vendor_id', s.vendor_id) : q.select('id, name, vendor_id'))));
  }
  if (want.partners) {
    out.partners = mapById(await rowsAll(db, 'financing_partners', q =>
      (s.vendor_id ? q.select('id, name, vendor_id').or('vendor_id.eq.' + s.vendor_id + ',vendor_id.is.null') : q.select('id, name, vendor_id'))));
  }
  if (want.vendors && s.all) out.vendors = mapById(await vendorsList(db, true));
  return out;
}
/** A manager's every-vendor report carries a Vendor column; everybody else's does not. */
const withVendor = (s, columns) => (s.all ? [...columns, col('vendor_name', 'Vendor')] : columns);
const vendorName = (s, maps, r) => (s.all ? nameOf(maps.vendors, r.vendor_id, '—') : undefined);
/** Cash / Lipa / Credit buckets, the split every "sales by ..." report shows. */
function bucketOf(pm) { return pm === 'Cash' ? 'cash' : pm === 'Lipa Number' ? 'lipa' : pm === 'Credit' ? 'credit' : 'other'; }
const emptyAgg = () => ({ units: 0, total: 0, cash: 0, lipa: 0, credit: 0 });
function addSale(agg, r) { agg.units += num(r.qty); agg.total += num(r.total); const b = bucketOf(r.payment_method); if (b !== 'other') agg[b] += num(r.total); }

/* ------------------------------------------------------------------ builders */
/* sales -- the legacy column set plus brand, model, IMEI, discount, partner and branch.
   Cost: 1 paged read of sales (range + vendor/seller/branch), 1 partners, 1 branches,
   +1 vendors for a manager's ALL. */
async function salesReport(db, s) {
  const list = await salesIn(db, s);
  const maps = await nameMaps(db, s, { partners: true, branches: true, vendors: true });
  let grand = 0;
  const out = list.map((r, i) => {
    grand += num(r.total);
    return {
      n: i + 1, sale_id: label(r.legacy_id, shortId(r.id)), sold_at: fmtDateTime(r.sold_at), seller_name: label(r.seller_name),
      customer_name: label(r.customer_name), customer_phone: label(r.customer_phone),
      product_name: label(r.product_name), brand: label(r.brand), model: label(r.model), imei: label(r.imei),
      qty: num(r.qty), list_price: num(r.list_price), discount: num(r.discount), price: num(r.price), total: num(r.total),
      payment_method: label(r.payment_method), partner_name: nameOf(maps.partners, r.financing_partner_id),
      branch_name: nameOf(maps.branches, r.branch_id), group_id: shortId(r.group_id), vendor_name: vendorName(s, maps, r),
    };
  });
  const columns = withVendor(s, [
    col('n', '#', I), col('sale_id', 'Sale ID'), col('sold_at', 'Date/Time'), col('seller_name', 'Seller'),
    col('customer_name', 'Customer'), col('customer_phone', 'Customer Phone'), col('product_name', 'Product'),
    col('brand', 'Brand'), col('model', 'Model'), col('imei', 'IMEI'), col('qty', 'Qty', I), col('list_price', 'List Price', R),
    col('discount', 'Discount', R), col('price', 'Unit Price', R), col('total', 'Total', R), col('payment_method', 'Payment'),
    col('partner_name', 'Partner'), col('branch_name', 'Branch'), col('group_id', 'Group ID'),
  ]);
  return { columns, rows: out, totals: [['GRAND TOTAL', cur(s, grand)]] };
}

/* stock -- active products, valued at price x stock, with the OK/LOW/OUT rule every screen uses.
   Cost: 1 paged read of products (+1 vendors for ALL). */
async function stockReport(db, s) {
  const list = await rowsAll(db, 'products', q => {
    let x = q.select('id, vendor_id, legacy_id, name, category, brand, model, price, stock, reorder_point, is_serialized').eq('active', true);
    if (s.vendor_id) x = x.eq('vendor_id', s.vendor_id);
    return x.order('created_at');
  });
  const maps = await nameMaps(db, s, { vendors: true });
  let total = 0;
  const out = list.map(p => {
    const value = num(p.price) * num(p.stock);
    total += value;
    return { legacy_id: label(p.legacy_id), name: label(p.name), category: label(p.category), brand: label(p.brand), model: label(p.model),
      price: num(p.price), stock: num(p.stock), value, status: stockStatus(p), vendor_name: vendorName(s, maps, p) };
  });
  const columns = withVendor(s, [col('legacy_id', 'ID'), col('name', 'Name'), col('category', 'Category'), col('brand', 'Brand'), col('model', 'Model'),
    col('price', 'Price', R), col('stock', 'Stock', I), col('value', 'Value', R), col('status', 'Status')]);
  return { columns, rows: out, totals: [['TOTAL', cur(s, total)]] };
}

/* cashdue -- what each active seller owes the till TODAY, the legacy arithmetic: a Lipa sale
   with nothing recorded against it is assumed received; a Credit sale is the financing
   partner's debt, not the seller's (DECISIONS 12), so it is shown but never in the balance.
   Ignores start/end on purpose. Cost: 1 sellers, 1 paged sales (today), 1 receipts (today). */
async function cashDueReport(db, s) {
  const b = periodBounds(s.nowMs);
  const sellers = await rowsAll(db, 'profiles', q => {
    let x = q.select('id, name, handle, vendor_id').eq('role', 'seller').eq('active', true);
    if (s.vendor_id) x = x.eq('vendor_id', s.vendor_id);
    return x.order('name');
  });
  const sales = await rowsAll(db, 'sales', q => {
    let x = q.select('seller_id, vendor_id, total, payment_method, group_id').eq('status', 'completed').gte('sold_at', b.today).lt('sold_at', b.tomorrow);
    if (s.vendor_id) x = x.eq('vendor_id', s.vendor_id);
    return x;
  });
  /* A DEPOSIT IS CASH THAT CROSSED THE COUNTER ON A DIFFERENT DAY, and this report had no idea.
     Juma takes 40,000 to hold twenty covers on Monday; nothing records it, so Monday's balance is
     40,000 light. Neema collects on Friday, 60,000 changes hands, and recordSale books the whole
     100,000 as Friday's cash sale -- so Friday's balance bills Juma for 100,000 when 60,000 came
     in. The owner counts the drawer against that and finds it short, with nothing on the screen
     explaining the gap.

     Both halves are counted here, from the holds themselves: what was taken today (cash held with
     no sale behind it yet) and what was applied today (part of a sale total that was paid
     earlier). Bounded to today, and the read is skipped entirely when the table is not there --
     a database that has not run the migration has no holds to account for. */
  let deposits = [], depositsFailed = '';
  try {
    /* `rows`, not `rowsAll`: fetchAll appends .range() per page, which overwrites the very
       'limit' key .limit() sets, so a cap written inside a paged read does not exist. This one
       has to be a real cap, so it is a single bounded read. */
    deposits = await rows(db, 'pending_sales', q => {
      let x = q.select('id, vendor_id, deposit, status, created_by, created_at, closed_at, sale_group_id').gt('deposit', 0);
      if (s.vendor_id) x = x.eq('vendor_id', s.vendor_id);
      return x.gte('created_at', addDaysKey(s.today, -365)).order('created_at', { ascending: false }).limit(2000);
    });
  } catch (e) {
    /* A bare catch put "the table is not there yet" and "the database just timed out" in the same
       branch, and both produced silently wrong balances -- the exact silent shortfall the deposit
       columns were added to remove. Only the missing table is normal; anything else is said. */
    const msg = String((e && e.message) || e);
    if (/does not exist|schema cache|PGRST205|42P01/i.test(msg)) deposits = [];
    else { deposits = []; depositsFailed = msg.slice(0, 140); }
  }
  const receipts = await rowsAll(db, 'cash_receipts', q => {
    let x = q.select('seller_id, vendor_id, cash_amount, lipa_amount').gte('received_at', b.today).lt('received_at', b.tomorrow);
    if (s.vendor_id) x = x.eq('vendor_id', s.vendor_id);
    return x;
  });
  const maps = await nameMaps(db, s, { vendors: true });
  const by = new Map();
  const rowFor = id => bump(by, String(id), () => ({ cash_sales: 0, lipa_sales: 0, credit_sales: 0, cash_received: 0, lipa_received: 0, dep_taken: 0, dep_applied: 0 }));
  const sellerOfGroup = new Map();
  for (const r of sales) if (r.group_id) sellerOfGroup.set(String(r.group_id), r.seller_id);
  for (const r of sales) { const a = rowFor(r.seller_id); const k = bucketOf(r.payment_method); if (k === 'lipa') a.lipa_sales += num(r.total); else if (k === 'credit') a.credit_sales += num(r.total); else a.cash_sales += num(r.total); }
  for (const r of receipts) { const a = rowFor(r.seller_id); a.cash_received += num(r.cash_amount); a.lipa_received += num(r.lipa_amount); }
  /* THE DAY IS THE EAT DAY. Slicing a UTC timestamp gave the wrong date for the three hours
     after midnight East Africa time, so a deposit taken or a hold collected at 01:30 fell on the
     day before -- while the SALE it belongs to was counted for today by periodBounds, which does
     use the EAT clock. The two halves of one balance disagreed and a seller was billed for money
     they never took. Every day comparison in this report goes through the same clock. */
  const dayOf = ts => (ts ? todayKey(Date.parse(ts)) : '');
  for (const d of deposits) {
    if (dayOf(d.created_at) === s.today && d.created_by) rowFor(d.created_by).dep_taken += num(d.deposit);
    const applied = d.status === 'completed' && dayOf(d.closed_at) === s.today;
    const who = applied && d.sale_group_id ? sellerOfGroup.get(String(d.sale_group_id)) : null;
    if (who) rowFor(who).dep_applied += num(d.deposit);
  }
  let grand = 0;
  const out = sellers.map(p => {
    const a = by.get(String(p.id)) || rowFor(p.id);
    const lipaReceived = a.lipa_received === 0 ? a.lipa_sales : a.lipa_received;
    // + what they took as a deposit today (cash in hand, no sale yet), - what today's sales were
    // already paid for by a deposit taken on some earlier day.
    const balance = a.cash_sales - a.cash_received + a.lipa_sales - lipaReceived + a.dep_taken - a.dep_applied;
    grand += balance;
    return { seller_id: p.id, seller: p.name + ' (' + label(p.handle) + ')', cash_sales: money(a.cash_sales), lipa_sales: money(a.lipa_sales), credit_sales: money(a.credit_sales),
      cash_received: money(a.cash_received), lipa_received: money(lipaReceived),
      dep_taken: money(a.dep_taken), dep_applied: money(a.dep_applied),
      balance: money(balance), vendor_name: vendorName(s, maps, p) };
  });
  const columns = withVendor(s, [col('seller', 'Seller'), col('cash_sales', 'Cash Sales', R), col('lipa_sales', 'Lipa Sales', R), col('credit_sales', 'Credit Sales', R),
    col('cash_received', 'Cash Received', R), col('lipa_received', 'Lipa Received', R),
    col('dep_taken', 'Deposits Taken', R), col('dep_applied', 'Deposits Applied', R), col('balance', 'Balance', R)]);
  const meta = [];
  if (depositsFailed) {
    meta.push('WARNING: the hold deposits could not be read (' + depositsFailed + '), so the Deposits columns '
      + 'are blank and every Balance below may be wrong by the deposits taken or applied today. Try again in a moment.');
  }
  if (out.some(r => r.dep_taken || r.dep_applied)) {
    meta.push('Deposits Taken is cash held today against a hold that has not been collected. '
      + 'Deposits Applied is the part of today\u2019s sales that was paid on an earlier day. '
      + 'Both are in the Balance, so the drawer should match it.');
  }
  return { columns, rows: out, totals: [['TOTAL', cur(s, grand)]], subtitle: fmtKey(s.today), meta };
}

/* lending -- one row per borrowed line, Active / Returned / ALL, by the date it was recorded.
   Cost: 1 paged read of lendings (range + vendor + status), 1 of their items, +1 of the units
   named by serialized items (for the IMEI), +1 vendors for ALL. */
async function lendingReport(db, s) {
  const st = String(s.status || 'ALL').toLowerCase();
  const status = st === 'active' ? 'Active' : st === 'returned' ? 'Returned' : st === 'all' ? 'ALL' : null;
  if (!status) throw badRequest('Status must be Active, Returned or ALL.');
  const lendings = await rowsAll(db, 'lendings', q => {
    let x = q.select('id, legacy_id, vendor_id, borrower_name, borrower_email, borrower_phone, status, return_date, created_at')
      .gte('created_at', s.range.from).lt('created_at', s.range.to);
    if (s.vendor_id) x = x.eq('vendor_id', s.vendor_id);
    if (status !== 'ALL') x = x.eq('status', status);
    return x.order('created_at');
  });
  const ids = lendings.map(l => l.id);
  const items = ids.length ? await rowsAll(db, 'lending_items', q => q.select('id, lending_id, product_name, unit_id, qty, price, total').in('lending_id', ids)) : [];
  const unitIds = [...new Set(items.map(i => i.unit_id).filter(Boolean))];
  const units = unitIds.length ? mapById(await rowsAll(db, 'product_units', q => q.select('id, imei').in('id', unitIds)), 'imei') : new Map();
  const maps = await nameMaps(db, s, { vendors: true });
  const byLending = new Map();
  for (const it of items) bump(byLending, String(it.lending_id), () => []).push(it);
  let grand = 0;
  const out = [];
  for (const l of lendings) {
    for (const it of (byLending.get(String(l.id)) || [])) {
      grand += num(it.total);
      out.push({ lending_id: label(l.legacy_id, shortId(l.id)), created_at: fmtDateTime(l.created_at), borrower_name: label(l.borrower_name),
        borrower_email: label(l.borrower_email), borrower_phone: label(l.borrower_phone), product_name: label(it.product_name),
        imei: nameOf(units, it.unit_id), qty: num(it.qty), price: num(it.price), total: num(it.total), status: label(l.status),
        return_date: fmtDateTime(l.return_date), vendor_name: vendorName(s, maps, l) });
    }
  }
  const columns = withVendor(s, [col('lending_id', 'Lending ID'), col('created_at', 'Date'), col('borrower_name', 'Borrower'), col('borrower_email', 'Email'),
    col('borrower_phone', 'Phone'), col('product_name', 'Product'), col('imei', 'IMEI'), col('qty', 'Qty', I), col('price', 'Unit Price', R),
    col('total', 'Total', R), col('status', 'Status'), col('return_date', 'Returned On')]);
  return { columns, rows: out, totals: [['GRAND TOTAL', cur(s, grand)]], title: 'Lending Report (' + status + ')' };
}

/* profit -- what the shop actually EARNED, per product, and where it was given away.
   The old app could tell you a phone sold for 250,000 and that 20,000 came off the sticker; it
   could not say whether that left anything. Revenue is what was taken, cost is qty x the
   unit_cost SNAPSHOTTED at the till, and the gap is the margin. The discount column is the
   "rejareja" question in full: how much of the list price was handed back over the counter.

   A line sold before cost_price existed carries unit_cost 0, which would read as pure profit
   and be a lie. Those are counted separately and SAID so in the meta, rather than quietly
   inflating the total -- see rule 2 in CLAUDE.md: a figure nobody can account for is worse
   than a figure that is missing.

   Cost: 1 paged read of sales (range + vendor/branch), +1 vendors for a manager's ALL. */
async function profitReport(db, s) {
  const list = await salesIn(db, s);
  const maps = await nameMaps(db, s, { vendors: true });
  const byProduct = new Map();
  let noCost = 0;
  for (const r of list) {
    const key = (s.all ? String(r.vendor_id) + '|' : '') + label(r.product_name, '(unnamed)');
    const a = bump(byProduct, key, () => ({
      product_name: label(r.product_name, '(unnamed)'), brand: label(r.brand), model: label(r.model),
      units: 0, revenue: 0, cost: 0, discount: 0, vendor_name: vendorName(s, maps, r), priced: 0,
    }));
    const qty = num(r.qty);
    a.units += qty;
    a.revenue += num(r.total);
    a.cost += qty * num(r.unit_cost);
    a.discount += qty * num(r.discount);
    if (num(r.unit_cost) > 0) a.priced += qty; else noCost += qty;
  }
  let revenue = 0, cost = 0, discount = 0;
  const out = [...byProduct.values()].map(a => {
    revenue += a.revenue; cost += a.cost; discount += a.discount;
    const profit = money(a.revenue - a.cost);
    return { product_name: a.product_name, brand: a.brand, model: a.model, units: a.units,
      revenue: money(a.revenue), cost: money(a.cost), discount: money(a.discount), profit,
      margin: a.revenue > 0 ? (profit / a.revenue * 100).toFixed(1) + '%' : '—',
      vendor_name: a.vendor_name };
  }).sort((a, b) => b.profit - a.profit);
  const grossProfit = money(revenue - cost);
  const columns = withVendor(s, [
    col('product_name', 'Product'), col('brand', 'Brand'), col('model', 'Model'), col('units', 'Units', I),
    col('revenue', 'Revenue', R), col('cost', 'Cost', R), col('profit', 'Profit', R), col('margin', 'Margin'),
    col('discount', 'Discounted', R),
  ]);
  const meta = ['Cost is the price recorded on the product at the moment of each sale, not today\'s.'];
  if (noCost) {
    meta.push('WARNING: ' + noCost + ' unit' + (noCost === 1 ? ' was' : 's were') + ' sold with no cost price recorded, '
      + 'and count here as costing nothing. The profit below is therefore the HIGHEST it could be. '
      + 'Set a cost price on those products and the figure will come down to the truth.');
  }
  return {
    columns, rows: out, meta,
    totals: [['REVENUE', cur(s, money(revenue))], ['COST OF GOODS', cur(s, money(cost))],
      ['GROSS PROFIT', cur(s, grossProfit)],
      ['MARGIN', revenue > 0 ? (grossProfit / revenue * 100).toFixed(1) + '%' : '—'],
      ['GIVEN AWAY IN DISCOUNTS', cur(s, money(discount))]],
  };
}

/* customer -- who bought, how much and how often, most valuable first. Walk-ins (no name and
   no phone) are one row of their own rather than being dropped, because "how much of the month
   was people we cannot call back" is the point of the report.
   Cost: 1 paged read of sales (range + vendor/branch), +1 vendors for a manager's ALL. */
async function customerReport(db, s) {
  const list = await salesIn(db, s);
  const maps = await nameMaps(db, s, { vendors: true });
  /* ONE PERSON, ONE ROW. Keying on "the phone, or else the name" split a regular into two rows the
     moment a seller recorded her number on some visits and not others -- so "most valuable first"
     ranked her by the smaller half and no row stated what she had actually spent. And the
     backfill line written for exactly that case could never fire: a group keyed BY the phone
     already had one.

     So names are resolved to phones in a first pass. A name seen with a phone anywhere in the
     range belongs to that phone everywhere in it, and a name learned later fills in a group that
     started anonymous. Two people who share a name and neither leaves a number still merge -- but
     that was already true, and a report that under-counts a regular is the worse of the two. */
  const phoneOfName = new Map();
  for (const r of list) {
    const phone = label(r.customer_phone), name = label(r.customer_name).toLowerCase();
    if (phone && name && !phoneOfName.has(name)) phoneOfName.set(name, phone);
  }
  const byCustomer = new Map();
  for (const r of list) {
    const phone = label(r.customer_phone), name = label(r.customer_name);
    const walkIn = !phone && !name;
    const key = walkIn ? '\u0000walk-in' : (phone || phoneOfName.get(name.toLowerCase()) || name.toLowerCase());
    const a = bump(byCustomer, key, () => ({
      customer_name: walkIn ? 'Walk-in (not recorded)' : (name || '(no name)'), customer_phone: phone,
      visits: new Set(), units: 0, total: 0, last: '', vendor_name: vendorName(s, maps, r),
    }));
    a.visits.add(String(r.group_id));
    a.units += num(r.qty);
    a.total += num(r.total);
    if (!a.last || r.sold_at > a.last) a.last = r.sold_at;
    // A group that started from a sale carrying only one of the two fields learns the other here.
    if (!a.customer_phone && phone) a.customer_phone = phone;
    if ((!a.customer_name || a.customer_name === '(no name)') && name) a.customer_name = name;
  }
  let grand = 0;
  const out = [...byCustomer.values()].map(a => {
    grand += a.total;
    return { customer_name: a.customer_name, customer_phone: a.customer_phone, visits: a.visits.size,
      units: a.units, total: money(a.total), last_bought: fmtDateTime(a.last), vendor_name: a.vendor_name };
  }).sort((a, b) => b.total - a.total);
  const columns = withVendor(s, [col('customer_name', 'Customer'), col('customer_phone', 'Phone'),
    col('visits', 'Purchases', I), col('units', 'Units', I), col('total', 'Total Spent', R), col('last_bought', 'Last Bought')]);
  return { columns, rows: out, totals: [['GRAND TOTAL', cur(s, money(grand))]] };
}

/* commission (manager) -- every vendor's completed sales in the range x the commission rate.
   Cost: 1 vendors, 1 admins, 1 settings, 1 paged read of sales (range, all vendors or one). */
async function commissionReport(db, s) {
  const settings = await getSettings(db, ['commissionRate']);
  const rate = num(settings.commissionRate);
  const vendors = (await vendorsList(db, true)).filter(v => !s.vendor_id || String(v.id) === String(s.vendor_id));
  const admins = await rowsAll(db, 'profiles', q => q.select('id, name, vendor_id, role, created_at').eq('role', 'admin').order('created_at'));
  const adminOf = new Map();
  for (const p of admins) if (p.vendor_id && !adminOf.has(String(p.vendor_id))) adminOf.set(String(p.vendor_id), p.name);
  const sales = await rowsAll(db, 'sales', q => {
    let x = q.select('vendor_id, total').eq('status', 'completed').gte('sold_at', s.range.from).lt('sold_at', s.range.to);
    if (s.vendor_id) x = x.eq('vendor_id', s.vendor_id);
    return x;
  });
  const totals = new Map();
  for (const r of sales) totals.set(String(r.vendor_id), (totals.get(String(r.vendor_id)) || 0) + num(r.total));
  let grand = 0;
  const out = vendors.map(v => {
    const total = totals.get(String(v.id)) || 0;
    const due = money(total * rate / 100);
    grand += due;
    return { vendor_id: v.id, vendor_name: v.name, admin_name: label(adminOf.get(String(v.id))), status: v.active ? 'Active' : 'Inactive',
      currency: currencyOf(v), total: money(total), rate: rate + '%', due };
  });
  const columns = [col('vendor_name', 'Vendor'), col('admin_name', 'Admin'), col('status', 'Status'), col('currency', 'Currency'),
    col('total', 'Total Sales', R), col('rate', 'Rate'), col('due', 'Commission Due', R)];
  return { columns, rows: out, totals: [['TOTAL COMMISSION DUE', fmtMoney(money(grand))]], meta: ['Commission rate: ' + rate + '%'] };
}

/* brandmodel -- units and revenue per brand + model, best sellers first. An unbranded product
   keeps its own line under its name. Cost: 1 paged read of sales. */
async function brandModelReport(db, s) {
  const list = await salesIn(db, s);
  const by = new Map();
  for (const r of list) {
    const branded = (r.brand && String(r.brand).trim()) || (r.model && String(r.model).trim());
    const key = branded ? label(r.brand) + '|' + label(r.model) : 'product|' + label(r.product_name);
    const a = bump(by, key, () => ({ brand: branded ? label(r.brand, '—') : '—', model: branded ? label(r.model, '—') : label(r.product_name), units: 0, revenue: 0 }));
    a.units += num(r.qty); a.revenue += num(r.total);
  }
  const out = [...by.values()].sort((a, b) => b.units - a.units || b.revenue - a.revenue)
    .map(a => ({ ...a, revenue: money(a.revenue), avg_price: a.units ? money(a.revenue / a.units) : 0 }));
  const units = out.reduce((n, r) => n + r.units, 0), revenue = out.reduce((n, r) => n + r.revenue, 0);
  const columns = [col('brand', 'Brand'), col('model', 'Model'), col('units', 'Units', I), col('revenue', 'Revenue', R), col('avg_price', 'Avg Price', R)];
  return { columns, rows: out, totals: [['TOTAL UNITS', String(units)], ['TOTAL REVENUE', cur(s, revenue)]] };
}

/* partner -- every Credit sale in the range: who financed it and whether they have settled
   (the hoop/hooploan model, DECISIONS 12). Totals per partner, outstanding and settled.
   Cost: 1 paged read of sales (Credit only), 1 partners, +1 vendors for ALL. */
async function partnerReport(db, s) {
  const list = await salesIn(db, s, 'completed', q => (s.partner_id ? q.eq('payment_method', 'Credit').eq('financing_partner_id', s.partner_id) : q.eq('payment_method', 'Credit')));
  const maps = await nameMaps(db, s, { partners: true, vendors: true });
  const per = new Map();
  let grand = 0;
  const out = list.map(r => {
    const partner = nameOf(maps.partners, r.financing_partner_id, '—');
    const a = bump(per, partner, () => ({ outstanding: 0, settled: 0 }));
    a[r.partner_paid ? 'settled' : 'outstanding'] += num(r.total);
    grand += num(r.total);
    return { sold_at: fmtDateTime(r.sold_at), sale_id: label(r.legacy_id, shortId(r.id)), partner_name: partner, product_name: label(r.product_name),
      imei: label(r.imei), total: num(r.total), settled: r.partner_paid ? 'Yes' : 'No', partner_paid_at: fmtDateTime(r.partner_paid_at), vendor_name: vendorName(s, maps, r) };
  });
  const totals = [];
  for (const [name, a] of [...per.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    totals.push([name + ' — outstanding', cur(s, a.outstanding)], [name + ' — settled', cur(s, a.settled)]);
  }
  totals.push(['TOTAL FINANCED', cur(s, grand)]);
  const columns = withVendor(s, [col('sold_at', 'Date'), col('sale_id', 'Sale ID'), col('partner_name', 'Partner'), col('product_name', 'Product'),
    col('imei', 'IMEI'), col('total', 'Total', R), col('settled', 'Settled'), col('partner_paid_at', 'Settled On')]);
  return { columns, rows: out, totals };
}

/* cancelled -- sales cancelled (DECISIONS 8), by the day they were SOLD, so a range reads the
   same as the sales report it corrects. Cost: 1 paged read of sales, +1 vendors for ALL. */
async function cancelledReport(db, s) {
  const list = await salesIn(db, s, 'cancelled');
  const maps = await nameMaps(db, s, { vendors: true });
  let grand = 0;
  const out = list.map(r => {
    grand += num(r.total);
    return { sold_at: fmtDateTime(r.sold_at), sale_id: label(r.legacy_id, shortId(r.id)), product_name: label(r.product_name), imei: label(r.imei),
      qty: num(r.qty), total: num(r.total), seller_name: label(r.seller_name), cancelled_by_name: label(r.cancelled_by_name),
      cancelled_at: fmtDateTime(r.cancelled_at), cancel_reason: label(r.cancel_reason), vendor_name: vendorName(s, maps, r) };
  });
  const columns = withVendor(s, [col('sold_at', 'Date'), col('sale_id', 'Sale ID'), col('product_name', 'Product'), col('imei', 'IMEI'), col('qty', 'Qty', I),
    col('total', 'Total', R), col('seller_name', 'Seller'), col('cancelled_by_name', 'Cancelled By'), col('cancelled_at', 'Cancelled On'), col('cancel_reason', 'Reason')]);
  return { columns, rows: out, totals: [['CANCELLED TOTAL', cur(s, grand)]] };
}

/* employee -- units and value per seller, split by payment method. Cost: 1 paged read of sales
   (+1 vendors for ALL). Seller names are the snapshot on the sale. */
async function employeeReport(db, s) {
  const list = await salesIn(db, s);
  const maps = await nameMaps(db, s, { vendors: true });
  const by = new Map();
  for (const r of list) {
    const key = (s.all ? String(r.vendor_id) + '|' : '') + String(r.seller_id || r.seller_name || '');
    addSale(bump(by, key, () => ({ seller_id: r.seller_id, seller_name: label(r.seller_name, shortId(r.seller_id) || '—'), vendor_name: vendorName(s, maps, r), ...emptyAgg() })), r);
  }
  const out = [...by.values()].sort((a, b) => b.total - a.total).map(a => ({ ...a, total: money(a.total), cash: money(a.cash), lipa: money(a.lipa), credit: money(a.credit) }));
  const grand = out.reduce((n, r) => n + r.total, 0);
  const columns = withVendor(s, [col('seller_name', 'Seller'), col('units', 'Units', I), col('total', 'Sales Total', R), col('cash', 'Cash', R), col('lipa', 'Lipa', R), col('credit', 'Credit', R)]);
  return { columns, rows: out, totals: [['TOTAL', cur(s, grand)]] };
}

/* branch -- units and value per shop (Frank's #1). A vendor with no branches gets one row,
   'Main'; a branch with no sales still shows, at zero. Cost: 1 paged read of sales, 1 branches
   (+1 vendors for ALL). */
async function branchReport(db, s) {
  const list = await salesIn(db, s);
  const maps = await nameMaps(db, s, { vendors: true });
  const branches = await rowsAll(db, 'branches', q => {
    let x = q.select('id, name, vendor_id').eq('active', true);
    if (s.vendor_id) x = x.eq('vendor_id', s.vendor_id);
    if (s.branch_id) x = x.eq('id', s.branch_id);
    return x.order('name');
  });
  const by = new Map();
  const keyOf = (vendorId, branchId) => (s.all ? String(vendorId) + '|' : '') + String(branchId || 'main');
  const rowOf = (vendorId, branchId, name) => bump(by, keyOf(vendorId, branchId), () => ({ branch_id: branchId || null, branch_name: name, vendor_name: s.all ? nameOf(maps.vendors, vendorId, '—') : undefined, ...emptyAgg() }));
  const branchName = mapById(branches);
  for (const b of branches) rowOf(b.vendor_id, b.id, b.name);
  for (const r of list) addSale(rowOf(r.vendor_id, r.branch_id, nameOf(branchName, r.branch_id, 'Main')), r);
  if (!s.all && !by.size) rowOf(s.vendor_id, null, 'Main');
  const out = [...by.values()].sort((a, b) => b.total - a.total || a.branch_name.localeCompare(b.branch_name))
    .map(a => ({ ...a, total: money(a.total), cash: money(a.cash), lipa: money(a.lipa), credit: money(a.credit) }));
  const grand = out.reduce((n, r) => n + r.total, 0);
  const columns = withVendor(s, [col('branch_name', 'Branch'), col('units', 'Units', I), col('total', 'Sales Total', R), col('cash', 'Cash', R), col('lipa', 'Lipa', R), col('credit', 'Credit', R)]);
  return { columns, rows: out, totals: [['TOTAL', cur(s, grand)]] };
}

/* payment -- units and value per payment method; the three known methods always appear, so a
   day with no Credit sales still says so. Cost: 1 paged read of sales. */
async function paymentReport(db, s) {
  const list = await salesIn(db, s);
  const by = new Map();
  for (const m of ['Cash', 'Lipa Number', 'Credit']) by.set(m, { payment_method: m, units: 0, total: 0 });
  for (const r of list) { const a = bump(by, label(r.payment_method, '—'), () => ({ payment_method: label(r.payment_method, '—'), units: 0, total: 0 })); a.units += num(r.qty); a.total += num(r.total); }
  const out = [...by.values()].map(a => ({ ...a, total: money(a.total) }));
  const grand = out.reduce((n, r) => n + r.total, 0), units = out.reduce((n, r) => n + r.units, 0);
  const columns = [col('payment_method', 'Payment Method'), col('units', 'Units', I), col('total', 'Sales Total', R)];
  return { columns, rows: out, totals: [['TOTAL UNITS', String(units)], ['TOTAL', cur(s, grand)]] };
}

/* movements -- every stock change in the range (Frank's #10): received, sold, transferred,
   returned, adjusted. A branch filter matches either end of a transfer. Cost: 1 paged read of
   stock_movements, 1 branches (+1 vendors for ALL). */
async function movementsReport(db, s) {
  const list = await rowsAll(db, 'stock_movements', q => {
    let x = q.select('id, vendor_id, product_name, imei, type, qty, from_branch_id, to_branch_id, reference_sale_id, reference_lending_id, by_name, note, created_at')
      .gte('created_at', s.range.from).lt('created_at', s.range.to);
    if (s.vendor_id) x = x.eq('vendor_id', s.vendor_id);
    if (s.branch_id) x = x.or('from_branch_id.eq.' + s.branch_id + ',to_branch_id.eq.' + s.branch_id);
    return x.order('created_at');
  });
  const maps = await nameMaps(db, s, { branches: true, vendors: true });
  /* 'adjustment' -- with no direction -- is in neither, and cannot be: it is what rows written
     before adjustment_in/out look like, and guessing would make the totals a fiction. */
  const IN = new Set(['received', 'transfer_in', 'returned', 'cancelled_restock', 'adjustment_in', 'unreserved']);
  const OUT = new Set(['sold', 'lent', 'transfer_out', 'adjustment_out', 'reserved']);
  let qtyIn = 0, qtyOut = 0;
  const out = list.map(m => {
    if (IN.has(m.type)) qtyIn += num(m.qty); else if (OUT.has(m.type)) qtyOut += num(m.qty);
    const ref = m.reference_sale_id ? 'Sale ' + shortId(m.reference_sale_id) : m.reference_lending_id ? 'Lending ' + shortId(m.reference_lending_id) : '';
    return { created_at: fmtDateTime(m.created_at), product_name: label(m.product_name), imei: label(m.imei), type: label(m.type), qty: num(m.qty),
      from_branch: nameOf(maps.branches, m.from_branch_id), to_branch: nameOf(maps.branches, m.to_branch_id), by_name: label(m.by_name),
      note: label(m.note), reference: ref, vendor_name: vendorName(s, maps, m) };
  });
  const columns = withVendor(s, [col('created_at', 'Date/Time'), col('product_name', 'Product'), col('imei', 'IMEI'), col('type', 'Type'), col('qty', 'Qty', I),
    col('from_branch', 'From'), col('to_branch', 'To'), col('by_name', 'By'), col('note', 'Note'), col('reference', 'Reference')]);
  return { columns, rows: out, totals: [['TOTAL IN', String(qtyIn)], ['TOTAL OUT', String(qtyOut)], ['RECORDS', String(out.length)]] };
}

/* units -- the serialized stock list (Frank's #5): every IMEI the vendor holds or has sold,
   optionally one status. Bounded at 5,000 units. Cost: 1 read of product_units, 1 of the
   vendor's products (names), 1 branches (+1 vendors for ALL). */
async function unitsReport(db, s) {
  const st = s.status ? String(s.status).toLowerCase() : null;
  if (st && !['in_stock', 'sold', 'lent', 'lost', 'reserved'].includes(st)) throw badRequest('Status must be in_stock, sold, lent, lost or reserved.');
  const list = await rows(db, 'product_units', q => {
    let x = q.select('id, product_id, vendor_id, branch_id, imei, serial_no, status, received_at, sold_at');
    if (s.vendor_id) x = x.eq('vendor_id', s.vendor_id);
    if (s.branch_id) x = x.eq('branch_id', s.branch_id);
    if (st) x = x.eq('status', st);
    return x.order('received_at').limit(5000);
  });
  const products = await rowsAll(db, 'products', q => (s.vendor_id ? q.select('id, name, brand, model').eq('vendor_id', s.vendor_id) : q.select('id, name, brand, model').eq('is_serialized', true)));
  const prod = new Map(products.map(p => [String(p.id), p]));
  const maps = await nameMaps(db, s, { branches: true, vendors: true });
  let inStock = 0;
  const out = list.map(u => {
    if (u.status === 'in_stock') inStock++;
    const p = prod.get(String(u.product_id)) || {};
    return { imei: label(u.imei), serial_no: label(u.serial_no), product_name: label(p.name), brand: label(p.brand), model: label(p.model),
      branch_name: nameOf(maps.branches, u.branch_id), status: label(u.status), received_at: fmtDateTime(u.received_at), sold_at: fmtDateTime(u.sold_at),
      vendor_name: vendorName(s, maps, u) };
  });
  const columns = withVendor(s, [col('imei', 'IMEI'), col('serial_no', 'Serial'), col('product_name', 'Product'), col('brand', 'Brand'), col('model', 'Model'),
    col('branch_name', 'Branch'), col('status', 'Status'), col('received_at', 'Received'), col('sold_at', 'Sold On')]);
  return { columns, rows: out, totals: [['UNITS', String(out.length)], ['IN STOCK', String(inStock)]], meta: st ? ['Status: ' + st] : [] };
}

/* imei -- which phone went out when, through whom, at which shop: the sales that carry an
   IMEI. Cost: 1 paged read of sales, 1 partners, 1 branches (+1 vendors for ALL). */
async function imeiReport(db, s) {
  const list = await salesIn(db, s, 'completed', q => q.not('imei', 'is', null).neq('imei', ''));
  const maps = await nameMaps(db, s, { partners: true, branches: true, vendors: true });
  let grand = 0;
  const out = list.map(r => {
    grand += num(r.total);
    return { sold_at: fmtDateTime(r.sold_at), sale_id: label(r.legacy_id, shortId(r.id)), imei: label(r.imei), product_name: label(r.product_name), brand: label(r.brand),
      model: label(r.model), seller_name: label(r.seller_name), branch_name: nameOf(maps.branches, r.branch_id), payment_method: label(r.payment_method),
      partner_name: nameOf(maps.partners, r.financing_partner_id), total: num(r.total), vendor_name: vendorName(s, maps, r) };
  });
  const columns = withVendor(s, [col('sold_at', 'Date'), col('sale_id', 'Sale ID'), col('imei', 'IMEI'), col('product_name', 'Product'), col('brand', 'Brand'), col('model', 'Model'),
    col('seller_name', 'Seller'), col('branch_name', 'Branch'), col('payment_method', 'Payment'), col('partner_name', 'Partner'), col('total', 'Total', R)]);
  return { columns, rows: out, totals: [['GRAND TOTAL', cur(s, grand)]] };
}

const BUILDERS = {
  sales: salesReport, stock: stockReport, cashdue: cashDueReport, lending: lendingReport, commission: commissionReport,
  brandmodel: brandModelReport, partner: partnerReport, cancelled: cancelledReport, employee: employeeReport,
  profit: profitReport, customer: customerReport,
  branch: branchReport, payment: paymentReport, movements: movementsReport, units: unitsReport, imei: imeiReport,
};

/* ------------------------------------------------------------------ the answer */
async function buildReport(db, user, args, nowMs) {
  const s = await scopeFor(db, user, args, nowMs);
  const part = await BUILDERS[s.type](db, s);
  const who = s.vendor ? s.vendor.name : 'All Vendors';
  const subtitle = part.subtitle || (s.def.dated ? fmtKey(s.range.startKey) + ' – ' + fmtKey(s.range.endKey) : 'As at ' + fmtDateTime(iso(nowMs)));
  const meta = ['Generated by ' + APP_BY, 'Generated: ' + fmtDateTime(iso(nowMs)) + ' EAT'];
  if (s.seller_name) meta.push('Seller: ' + s.seller_name);
  if (s.branch) meta.push('Branch: ' + s.branch.name);
  for (const m of (part.meta || [])) meta.push(m);
  return {
    type: s.type, title: who + ' – ' + (part.title || s.def.label), subtitle, meta,
    columns: part.columns, rows: part.rows, totals: part.totals || [], currency: s.currency,
    start: s.range.startKey, end: s.range.endKey, vendor_name: who,
  };
}

const TICKET_KEYS = ['type', 'start', 'end', 'vendor_id', 'branch_id', 'status', 'partner_id'];

export const FN = {
  reportData: (db, user, args, nowMs) => buildReport(db, user, args, nowMs),

  /* The same scope check as the report itself, then a five-minute ticket naming exactly this
     report. Nothing is built here -- the file is made when the ticket is presented. */
  reportTicket: async (db, user, args, nowMs) => {
    const a = args || {};
    const format = String(a.format || 'pdf').toLowerCase();
    if (format !== 'pdf' && format !== 'xlsx') throw badRequest('Format must be pdf or xlsx.');
    await scopeFor(db, user, a, nowMs);
    const report = { format };
    for (const k of TICKET_KEYS) if (a[k] != null && a[k] !== '') report[k] = String(a[k]);
    return { url: '/api/report?t=' + signTicket({ uid: user.id, report }, nowMs) };
  },
};
export const WRITES = [];

/* ------------------------------------------------------------------ the file */
function sheetOf(data) {
  const cell = v => (v == null ? '' : v);
  const out = [[{ v: data.title, b: true }], [data.subtitle], ...data.meta.map(m => [m]), [], data.columns.map(c => ({ v: c.label, b: true }))];
  for (const r of data.rows) out.push(data.columns.map(c => cell(r[c.key])));
  out.push([]);
  for (const t of data.totals) out.push([{ v: t[0], b: true }, { v: t[1], b: true }]);
  const widths = data.columns.map(c => {
    let w = String(c.label).length;
    for (const r of data.rows.slice(0, 500)) w = Math.max(w, Math.min(40, String(cell(r[c.key])).length));
    return w + 2;
  });
  return { name: REPORT_TYPES[data.type].label.replace(/[\\/?*[\]:]/g, ' '), rows: out, widths };
}

/** The report as bytes: { bytes, contentType, filename, inline }. PDF opens in the tab (inline);
    .xlsx downloads. Numbers stay numbers in the sheet; the PDF writer formats them. */
export async function reportFile(db, user, report, nowMs = Date.now()) {
  const r = report || {};
  const format = String(r.format || 'pdf').toLowerCase();
  if (format !== 'pdf' && format !== 'xlsx') throw badRequest('Format must be pdf or xlsx.');
  const data = await buildReport(db, user, r, nowMs);
  const stem = REPORT_TYPES[data.type].stem + '_' + slug(data.vendor_name) + '_' + data.start + '_to_' + data.end;
  if (format === 'xlsx') {
    return {
      bytes: buildXlsx([sheetOf(data)], nowMs),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: stem + '.xlsx', inline: false,
    };
  }
  const bytes = await buildPdf({ title: data.title, subtitle: data.subtitle, meta: data.meta, columns: data.columns, rows: data.rows, totals: data.totals, generatedAt: new Date(nowMs) });
  return { bytes, contentType: 'application/pdf', filename: stem + '.pdf', inline: true };
}
