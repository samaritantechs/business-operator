import { randomUUID } from 'node:crypto';
import { rows, rowsAll, one, insertMany, update, count, iso, num, money, text, mustText, fmtMoney, badRequest, forbidden, notFound,
  isAdminLevel, isManagerLevel, vendorScope, scopedVendor, requireVendorUser, requireSameVendor, mustProduct, productById, vendorById,
  currencyOf, periodBounds, localNow } from './_shared.js';
import { requireAdmin } from '../auth.js';
import { changeStock, claimUnits } from './stock.js';
import { sendEmail, signature } from '../email.js';
import { productRows } from './dashboard.js';
import { APP_NAME } from '../brand.js';

/* =====================================================================================
   SELLING, AND UNDOING A SALE.
   =====================================================================================
   A checkout is one group_id and one sales row per line -- per UNIT for a phone, because an
   IMEI is sold one at a time and the row is where its snapshot lives. Every line is checked
   before anything is written, so a bad second line cannot leave a half-written checkout, and
   the rows are written BEFORE the stock moves so every movement carries the sale it belongs
   to. Stock itself only ever changes through stock.changeStock (DECISIONS #9).

   Nothing here is deleted: a sale is cancelled (DECISIONS #8) -- who, when, why -- and the
   stock or the unit comes back through a cancelled_restock movement. */

export const deps = { fetch: null };                      // tests capture the seller's email here

const PAYMENT_METHODS = ['Cash', 'Lipa Number', 'Credit'];
const SALE_COLS = 'id, legacy_id, group_id, vendor_id, branch_id, seller_id, seller_name, product_id, product_name, brand, model, unit_id, imei, '
  + 'qty, list_price, discount, price, total, payment_method, financing_partner_id, partner_paid, partner_paid_at, status, '
  + 'cancelled_by, cancelled_by_name, cancelled_at, cancel_reason, sold_at';

const isBlank = v => v == null || String(v).trim() === '';
const uniq = list => [...new Set(list.filter(Boolean).map(String))];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* recordSale -- round trips: 1 count + 1 insert + (Credit: 1 partner) + (branch: 1) + per
   distinct product 1 + per serialized line 1 (its units) + per line the stock move (2-3). */
async function recordSale(db, user, args, nowMs) {
  if (isManagerLevel(user.role)) throw forbidden('Managers do not sell -- sign in as a seller or admin of the business.');
  const vid = requireVendorUser(user);
  const items = Array.isArray(args.items) ? args.items : [];
  if (!items.length) throw badRequest('Add at least one item.');
  const method = text(args.payment_method);
  if (!PAYMENT_METHODS.includes(method)) throw badRequest('Payment method must be Cash, Lipa Number or Credit.');

  // Credit: the partner who will pay the shop must be real, active, and the vendor's own or global.
  let partnerId = null;
  if (method === 'Credit') {
    partnerId = text(args.financing_partner_id);
    if (!partnerId) throw badRequest('A credit sale needs the financing partner (MOGO, Watu ...).');
    const fp = await one(db, 'financing_partners', q => q.select('id, vendor_id, active').eq('id', partnerId));
    if (!fp || !fp.active || (fp.vendor_id && String(fp.vendor_id) !== String(vid))) throw badRequest('That financing partner is not available to your business.');
  }

  const branchId = text(args.branch_id) || user.branch_id || null;
  if (branchId) {
    const br = await one(db, 'branches', q => q.select('id, active').eq('id', branchId).eq('vendor_id', vid));
    if (!br) throw badRequest('That shop does not belong to your business.');
    if (!br.active) throw badRequest('That shop is closed.');
  }

  /* Check every line first. A product named twice is read once and its quantities are added
     up, so two lines of 30 cannot both pass against a stock of 40. */
  const lines = [], products = new Map(), asked = new Map(), seenUnits = new Set();
  const branchHave = new Map();          // product -> what THIS shop holds, read at most once each
  for (const item of items) {
    const pid = text(item && item.product_id);
    if (!pid) throw badRequest('Each item needs a product.');
    let p = products.get(pid);
    if (!p) { p = await mustProduct(db, pid, vid); products.set(pid, p); }
    if (!p.active) throw badRequest('"' + p.name + '" is not active.');
    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1) throw badRequest('Quantity for "' + p.name + '" must be a whole number of at least 1.');
    const list = money(isBlank(item.price) ? p.price : item.price);     // a blank price means "the list price"
    if (list < 0) throw badRequest('Price for "' + p.name + '" cannot be negative.');
    const discount = money(item.discount);
    if (discount < 0 || discount > list) throw badRequest('Discount for "' + p.name + '" must be between 0 and ' + fmtMoney(list) + '.');
    const price = money(list - discount);
    const line = { product: p, qty, list, discount, price, total: money(qty * price), units: null };
    if (p.is_serialized) {
      const ids = Array.isArray(item.unit_ids) ? item.unit_ids.map(String).filter(Boolean) : [];
      if (ids.length !== qty) throw badRequest('"' + p.name + '": choose exactly ' + qty + ' IMEI/serial' + (qty > 1 ? 's' : '') + ' (' + ids.length + ' chosen).');
      for (const id of ids) { if (seenUnits.has(id)) throw badRequest('Unit ' + id + ' is listed twice.'); seenUnits.add(id); }
      line.units = await claimUnits(db, p, ids);
    } else {
      const soFar = (asked.get(pid) || 0) + qty;
      asked.set(pid, soFar);
      if (num(p.stock) < soFar) throw badRequest('Insufficient stock for "' + p.name + '". Available: ' + num(p.stock));
      /* AND the shop it is sold from must actually hold it. The business total alone let a
         counter sell thirty covers out of a shop holding fifteen: the sale went through, the
         business total came down correctly, and that shop's row went to MINUS fifteen -- so
         the per-shop figures stopped adding up to the total and Stock & Shops showed a
         negative quantity. One bounded read per product in the basket, cached. */
      if (branchId) {
        let have = branchHave.get(pid);
        if (have === undefined) {
          const r = await one(db, 'branch_stock', q => q.select('qty').eq('product_id', pid).eq('branch_id', branchId));
          have = num(r && r.qty);
          branchHave.set(pid, have);
        }
        if (have < soFar) throw badRequest('"' + p.name + '" is short at this shop. Here: ' + have + ', for the whole business: ' + num(p.stock) + '. Transfer some in, or sell from the shop that holds them.');
      }
    }
    lines.push(line);
  }

  /* The legacy_id is the receipt label the old app printed ('SALE-' + sheet row). Here it is
     the vendor's running number from one head-only count -- the cheapest read there is. It is
     cosmetic: the uuid is the key and nothing joins on the label, so two tills that count at
     the same instant and print the same label is a tolerable rarity, not worth a lock. */
  const n = await count(db, 'sales', q => q.eq('vendor_id', vid));
  const label = k => 'SALE-' + String(k).padStart(4, '0');
  const groupId = randomUUID(), soldAt = iso(nowMs);
  let seq = n;
  const rowsIn = [];
  for (const l of lines) {
    const base = {
      group_id: groupId, vendor_id: vid, branch_id: branchId, seller_id: user.id, seller_name: user.name,
      product_id: l.product.id, product_name: l.product.name, brand: l.product.brand || null, model: l.product.model || null,
      list_price: l.list, discount: l.discount, price: l.price, payment_method: method, financing_partner_id: partnerId,
      partner_paid: false, status: 'completed', sold_at: soldAt,
    };
    // A serialized line is one row per unit; the IMEI column carries the serial when there is no IMEI.
    if (l.units) for (const u of l.units) rowsIn.push({ ...base, legacy_id: label(++seq), unit_id: u.id, imei: u.imei || u.serial_no || null, qty: 1, total: l.price });
    else rowsIn.push({ ...base, legacy_id: label(++seq), unit_id: null, imei: null, qty: l.qty, total: l.total });
  }
  const saved = await insertMany(db, 'sales', rowsIn);
  if (saved.length !== rowsIn.length) throw new Error('The sale was not fully saved -- check the recent sales before selling again.');

  // Now the stock, each move stamped with the sale row it belongs to.
  let k = 0;
  for (const l of lines) {
    if (l.units) {
      for (const u of l.units) {
        const s = saved[k++];
        await changeStock(db, { product: l.product, delta: -1, unit: u, unitStatus: 'sold', unitPatch: { sold_sale_id: s.id, sold_at: soldAt },
          type: 'sold', user, fromBranchId: u.branch_id || null, referenceSaleId: s.id }, nowMs);
      }
    } else {
      const s = saved[k++];
      await changeStock(db, { product: l.product, delta: -l.qty, branchId, type: 'sold', user, referenceSaleId: s.id }, nowMs);
    }
  }
  const grand = money(rowsIn.reduce((a, r) => a + num(r.total), 0));
  return { message: 'Sale recorded (' + items.length + ' item' + (items.length > 1 ? 's' : '') + ')', group_id: groupId, grand_total: grand, sale_ids: saved.map(s => s.id) };
}

/* cancelSale -- round trips: sale 1, product 1, (unit 1), flip 1, stock move 2-3, seller 1,
   (manager: vendor 1). The email is best effort and never fails the write. */
async function cancelSale(db, user, args, nowMs) {
  requireAdmin(user);
  const id = mustText(args.sale_id, 'The sale');
  const reason = mustText(args.reason, 'A reason');
  const sale = await one(db, 'sales', q => q.select(SALE_COLS).eq('id', id));
  if (!sale) throw notFound('Sale not found.');
  requireSameVendor(user, sale);
  if (sale.status !== 'completed') throw badRequest('This sale is already cancelled.');
  const product = await productById(db, sale.product_id);
  if (!product) throw notFound('The product of this sale no longer exists.');
  let unit = null;
  if (product.is_serialized && sale.unit_id) {
    unit = await one(db, 'product_units', q => q.select('id, product_id, vendor_id, branch_id, imei, serial_no, status').eq('id', sale.unit_id));
  }

  /* The status flip is also the lock: two admins cancelling the same sale both read
     'completed', but only the one whose update finds it still completed gets a row back --
     the other is told it is already done and restores nothing. */
  const flipped = await update(db, 'sales',
    { status: 'cancelled', cancelled_by: user.id, cancelled_by_name: user.name, cancelled_at: iso(nowMs), cancel_reason: reason },
    q => q.eq('id', id).eq('status', 'completed'));
  if (!flipped.length) throw badRequest('This sale is already cancelled.');

  let restored = true;
  if (!product.is_serialized) {
    await changeStock(db, { product, delta: num(sale.qty), branchId: sale.branch_id || null, type: 'cancelled_restock', user, referenceSaleId: sale.id, note: reason }, nowMs);
  } else if (unit) {
    await changeStock(db, { product, delta: 1, unit, unitStatus: 'in_stock', unitPatch: { sold_sale_id: null, sold_at: null },
      type: 'cancelled_restock', user, toBranchId: unit.branch_id || null, referenceSaleId: sale.id, note: reason }, nowMs);
  } else {
    restored = false;                                     // a serialized sale with no unit (migrated): nothing to put back
  }

  // The old app mailed the seller when a sale was deleted; the wording now says cancelled and why.
  let notified = false;
  const seller = sale.seller_id ? await one(db, 'profiles', q => q.select('id, name, email').eq('id', sale.seller_id)) : null;
  if (seller && seller.email) {
    const vendor = (user.vendor && String(user.vendor.id) === String(sale.vendor_id)) ? user.vendor : await vendorById(db, sale.vendor_id);
    try {
      await sendEmail(cancelEmail(seller, sale, vendor || {}, user, reason), deps);
      notified = true;
    } catch { /* best effort: the cancellation stands whether or not the mail went */ }
  }
  return { message: (restored ? 'Sale cancelled and stock restored.' : 'Sale cancelled (no unit to restore).') + (notified ? ' Seller notified.' : '') };
}

function cancelEmail(seller, sale, vendor, user, reason) {
  const when = localNow(Date.parse(sale.sold_at)).toISOString().replace('T', ' ').slice(0, 16) + ' EAT';
  const row = (k, v) => '<tr><th align="left">' + k + '</th><td>' + esc(v) + '</td></tr>';
  return {
    to: seller.email,
    subject: '⚠️ Sale Cancelled – ' + (vendor.name || APP_NAME),
    html: '<p>Dear ' + esc(seller.name) + ',</p>'
      + '<p>A sale record linked to your account has been <strong>cancelled</strong> by management.</p>'
      + '<table border="1" cellpadding="6" style="border-collapse:collapse;">'
      + row('Sale ID', sale.legacy_id || sale.id) + row('Date', when)
      + row('Product', sale.product_name + (sale.imei ? ' (' + sale.imei + ')' : ''))
      + row('Qty', sale.qty) + row('Amount', fmtMoney(sale.total) + ' ' + currencyOf(vendor)) + row('Payment', sale.payment_method)
      + row('Reason', reason) + '</table>'
      + '<p>Cancelled by: ' + esc(user.name) + ' (' + esc(user.handle || user.id) + ')</p>' + signature(),
  };
}

/* markPartnerPaid -- round trips: 2 (the row or the group, then one update). The vendor is in
   the query for admins, so a foreign sale is simply "not found". */
async function markPartnerPaid(db, user, args, nowMs) {
  requireAdmin(user);
  const saleId = text(args.sale_id), groupId = text(args.group_id);
  if (!saleId && !groupId) throw badRequest('Name the sale or the checkout group.');
  const paid = args.paid === true || String(args.paid) === 'true' || String(args.paid) === '1';
  const vid = isManagerLevel(user.role) ? null : requireVendorUser(user);
  const list = await rows(db, 'sales', q => {
    let s = q.select('id, vendor_id, payment_method, status');
    s = saleId ? s.eq('id', saleId) : s.eq('group_id', groupId);
    if (vid) s = s.eq('vendor_id', vid);
    return s.limit(200);
  });
  if (!list.length) throw notFound('Sale not found.');
  const credit = list.filter(s => s.payment_method === 'Credit' && s.status === 'completed');
  if (!credit.length) throw badRequest(list.some(s => s.payment_method === 'Credit') ? 'That sale is cancelled.' : 'Only a credit sale has a partner to pay.');
  await update(db, 'sales', { partner_paid: paid, partner_paid_at: paid ? iso(nowMs) : null }, q => q.in('id', credit.map(s => s.id)));
  const n = credit.length + ' sale' + (credit.length > 1 ? 's' : '');
  return { message: paid ? 'Marked as paid by the partner (' + n + ').' : 'Marked as not yet paid (' + n + ').' };
}

/** partner and branch names for a list of sales: at most two small .in() reads. */
async function nameLookups(db, list) {
  const pids = uniq(list.map(s => s.financing_partner_id)), bids = uniq(list.map(s => s.branch_id));
  const partners = pids.length ? await rows(db, 'financing_partners', q => q.select('id, name').in('id', pids)) : [];
  const branches = bids.length ? await rows(db, 'branches', q => q.select('id, name').in('id', bids)) : [];
  const partner = new Map(partners.map(p => [String(p.id), p.name])), branch = new Map(branches.map(b => [String(b.id), b.name]));
  return s => ({ partner_name: s.financing_partner_id ? (partner.get(String(s.financing_partner_id)) || '') : '', branch_name: s.branch_id ? (branch.get(String(s.branch_id)) || '') : '' });
}

const saleRow = (s, names) => ({
  id: s.id, legacy_id: s.legacy_id, group_id: s.group_id, sold_at: s.sold_at, seller_id: s.seller_id, seller_name: s.seller_name,
  product_id: s.product_id, product_name: s.product_name, brand: s.brand || '', model: s.model || '', unit_id: s.unit_id, imei: s.imei || '',
  qty: num(s.qty), list_price: num(s.list_price), discount: num(s.discount), price: num(s.price), total: num(s.total),
  payment_method: s.payment_method, financing_partner_id: s.financing_partner_id, partner_paid: !!s.partner_paid, partner_paid_at: s.partner_paid_at || null,
  status: s.status, branch_id: s.branch_id, cancelled_by_name: s.cancelled_by_name || null, cancelled_at: s.cancelled_at || null, cancel_reason: s.cancel_reason || null,
  ...names(s),
});

/* recentSales -- round trips: 3 at most (sales, partner names, branch names). One vendor,
   always: "the latest sales of every business" is not a screen anybody has. */
async function recentSales(db, user, args) {
  requireAdmin(user);
  const vid = vendorScope(user, args);
  if (!vid) throw badRequest('Pick a vendor to see its recent sales.');
  const limit = Math.min(Math.max(parseInt(args.limit, 10) || 30, 1), 200);
  const branchId = text(args.branch_id);
  const list = await rows(db, 'sales', q => {
    let s = q.select(SALE_COLS).eq('vendor_id', vid);
    if (!args.include_cancelled) s = s.eq('status', 'completed');
    if (branchId) s = s.eq('branch_id', branchId);
    return s.order('sold_at', { ascending: false }).order('legacy_id', { ascending: false }).limit(limit);
  });
  const names = await nameLookups(db, list);
  return { rows: list.map(s => saleRow(s, names)) };
}

/* salesDetail -- round trips: 1 (stock) or 3 (sales, partner names, branch names), + 1 for a
   manager naming a vendor. A manager with no vendor gets every business added together, in
   TZS, exactly as getSalesDetail('ALL') did. The read is bounded by the period and the vendor;
   a whole year of one vendor's lines is the screen the old app drew from the entire sheet. */
async function salesDetail(db, user, args, nowMs) {
  const period = text(args.period);
  const vendor = await scopedVendor(db, user, args);
  const vid = vendor ? vendor.id : null;
  if (period === 'stock') return { kind: 'stock', rows: await productRows(db, vid) };
  if (!['today', 'week', 'month', 'year'].includes(period)) throw badRequest('Period must be today, week, month, year or stock.');
  const b = periodBounds(nowMs);
  const own = !isAdminLevel(user.role) && !isManagerLevel(user.role);   // a seller sees only their own lines
  const branchId = text(args.branch_id);
  const list = await rowsAll(db, 'sales', q => {
    let s = q.select(SALE_COLS).eq('status', 'completed').gte('sold_at', b[period]).lte('sold_at', iso(nowMs));
    if (vid) s = s.eq('vendor_id', vid);
    if (branchId) s = s.eq('branch_id', branchId);
    if (own) s = s.eq('seller_id', user.id);
    return s.order('sold_at', { ascending: true });
  });
  const names = await nameLookups(db, list);
  const groups = new Map();
  for (const s of list) {
    const name = s.seller_name || '(unknown seller)';
    let g = groups.get(name);
    if (!g) { g = { seller_name: name, total: 0, rows: [] }; groups.set(name, g); }
    g.total += num(s.total);
    g.rows.push(saleRow(s, names));
  }
  const out = [...groups.values()].sort((a, c) => a.seller_name.localeCompare(c.seller_name));
  for (const g of out) { g.total = money(g.total); g.rows.sort((a, c) => (a.sold_at < c.sold_at ? -1 : a.sold_at > c.sold_at ? 1 : 0)); }
  return { kind: 'sales', currency: vendor ? currencyOf(vendor) : 'TZS', groups: out, grand_total: money(out.reduce((a, g) => a + g.total, 0)) };
}

export const FN = { recordSale, cancelSale, markPartnerPaid, recentSales, salesDetail };
export const WRITES = ['recordSale', 'cancelSale', 'markPartnerPaid'];
