import { randomUUID } from 'node:crypto';
import { rows, one, insertOne, insertMany, update, remove, num, int, money, fmtMoney, text, mustText, iso,
  badRequest, notFound, vendorScope, requireVendorUser, requireSameVendor,
  getSetting, currencyOf, vendorById, fillTemplate, PRODUCT_COLS } from './_shared.js';
import { requireAdmin } from '../auth.js';
import { changeStock, claimUnits } from './stock.js';
import { sendEmail, signature } from '../email.js';

/* =====================================================================================
   LENDINGS -- goods that left the shop without being sold, and who has them.
   =====================================================================================
   The Apps Script version kept one sheet row per borrowed line and grouped them by a LEND-id on
   every read. Here a lending is a header row plus its lending_items, and stock leaves and
   returns through stock.changeStock() like everything else (a 'lent' movement out, a
   'returned' movement back), so the movements report can answer "where is that phone" for a
   borrowed unit exactly as it does for a sold one. Every message and email keeps the legacy
   wording, so nobody who used the old app has to relearn what a screen says. */

/** Tests hand in a fetch to capture what would have been emailed; the Email Center passes its own. */
export const deps = { fetch: null };

/* The legacy reminder, verbatim: the manager's Settings screen can replace it (lendingReminderText). */
export const DEFAULT_LENDING_TEXT = '<h3>Lending Reminder</h3><p>Dear <strong>{borrowerName}</strong>,</p><p>You still have borrowed from <strong>{vendor}</strong>:</p><p style="padding:10px;background:#fff3cd;border-radius:8px;"><strong>{items}</strong></p><p>Total owed: <strong>{total}</strong></p><p>Borrowed <strong>{days}</strong> ago. Please return at your earliest convenience.</p>';

const LENDING_COLS = 'id, legacy_id, vendor_id, branch_id, borrower_name, borrower_email, borrower_phone, recorded_by, recorded_by_name, status, return_date, created_at';
const ITEM_COLS = 'id, lending_id, product_id, product_name, unit_id, qty, price, total';
const UNIT_COLS = 'id, product_id, vendor_id, branch_id, imei, serial_no, status';
const STATUSES = ['Active', 'Returned'];

/* Borrower names and product names land inside HTML we send; a "<" in a name must not become markup. */
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const emailOf = v => { const s = text(v); return s && s.includes('@') ? s : null; };
const mailer = d => ({ fetch: (d && d.fetch) || deps.fetch || undefined });

/* ------------------------------------------------------------------ reading */
/** Lendings as the page sees them (headers + items + vendor name), for one vendor or all, one
    status or all, or one id. Cost: 2 reads (headers, items) + 1 vendors read unless the caller
    already holds the only vendor involved + 1 units read only when a serialized item is in the
    list (the IMEI lives on the unit, not the item). Returns { rows, vendors: Map id -> row }. */
async function loadLendings(db, { vendorId, status, id, limit = 300, knownVendor = null }) {
  const heads = await rows(db, 'lendings', q => {
    let s = q.select(LENDING_COLS);
    if (id) s = s.eq('id', id);
    if (vendorId) s = s.eq('vendor_id', vendorId);
    if (status && STATUSES.includes(status)) s = s.eq('status', status);
    return s.order('created_at', { ascending: false }).limit(limit);
  });
  if (!heads.length) return { rows: [], vendors: new Map() };
  const items = await rows(db, 'lending_items', q => q.select(ITEM_COLS).in('lending_id', heads.map(h => h.id)));

  const unitIds = [...new Set(items.map(i => i.unit_id).filter(Boolean))];
  const units = unitIds.length ? await rows(db, 'product_units', q => q.select('id, imei, serial_no').in('id', unitIds)) : [];
  const imeiOf = new Map(units.map(u => [String(u.id), u.imei || u.serial_no || null]));

  const vendors = new Map();
  if (knownVendor) vendors.set(String(knownVendor.id), knownVendor);
  const missing = [...new Set(heads.map(h => String(h.vendor_id)))].filter(v => !vendors.has(v));
  if (missing.length) {
    const vs = await rows(db, 'vendors', q => q.select('id, name, currency').in('id', missing));
    for (const v of vs) vendors.set(String(v.id), v);
  }

  const out = heads.map(h => {
    const its = items.filter(i => String(i.lending_id) === String(h.id)).map(i => ({
      product_id: i.product_id, product_name: i.product_name, unit_id: i.unit_id || null,
      qty: int(i.qty), price: num(i.price), total: num(i.total),
      imei: i.unit_id ? (imeiOf.get(String(i.unit_id)) || null) : null,
    }));
    const v = vendors.get(String(h.vendor_id));
    return {
      id: h.id, legacy_id: h.legacy_id, created_at: h.created_at,
      borrower_name: h.borrower_name, borrower_email: h.borrower_email, borrower_phone: h.borrower_phone,
      recorded_by_name: h.recorded_by_name, vendor_id: h.vendor_id, vendor_name: v ? v.name : '',
      branch_id: h.branch_id || null, status: h.status, return_date: h.return_date || null,
      items: its, grand_total: its.reduce((a, i) => a + i.total, 0),
    };
  });
  return { rows: out, vendors };
}

/** One lending header or a 404; the caller's vendor unless they are a manager. */
async function loadLending(db, user, lendingId) {
  const l = await one(db, 'lendings', q => q.select(LENDING_COLS).eq('id', String(lendingId || '')));
  if (!l) throw notFound('Lending not found.');
  requireSameVendor(user, l);
  return l;
}

/** The vendor row behind a lending: the caller's own when it is, else one read. */
async function vendorOf(db, user, vendorId) {
  if (user.vendor && String(user.vendor.id) === String(vendorId)) return user.vendor;
  return vendorById(db, vendorId);
}

/* 'qty× name [imei] (price each)' -- the legacy line, plus the IMEI when the item is a unit. */
const itemLine = it => int(it.qty) + '× ' + it.product_name + (it.imei ? ' [' + it.imei + ']' : '')
  + (num(it.price) > 0 ? ' (' + fmtMoney(it.price) + ' each)' : '');

/* ------------------------------------------------------------------ stock in and out */
/** Puts every item of a lending back: +qty for a plain product, the unit back to in_stock at
    the branch it sits in. Cost: 1 products read + 1 units read (when any) + changeStock per item. */
async function restoreItems(db, user, lending, items, note, nowMs) {
  if (!items.length) return;
  const products = await rows(db, 'products', q => q.select(PRODUCT_COLS).in('id', [...new Set(items.map(i => i.product_id).filter(Boolean))]));
  const unitIds = items.map(i => i.unit_id).filter(Boolean);
  const units = unitIds.length ? await rows(db, 'product_units', q => q.select(UNIT_COLS).in('id', unitIds)) : [];
  for (const it of items) {
    const product = products.find(p => String(p.id) === String(it.product_id));
    if (!product) continue;                          // the product row is gone: nothing to put it back on
    const common = { product, type: 'returned', user, note, referenceLendingId: lending.id };
    if (it.unit_id) {
      const unit = units.find(u => String(u.id) === String(it.unit_id));
      if (!unit) continue;
      await changeStock(db, { ...common, delta: 1, unit, unitStatus: 'in_stock', toBranchId: unit.branch_id }, nowMs);
    } else {
      await changeStock(db, { ...common, delta: int(it.qty), branchId: lending.branch_id || null }, nowMs);
    }
  }
}

/* ------------------------------------------------------------------ reminders */
/** The reminder email for one listing row: subject, html, and who it goes to. */
function reminderFor(row, vendor, tpl, nowMs) {
  const currency = currencyOf(vendor);
  const daysSince = Math.max(0, Math.floor((nowMs - Date.parse(row.created_at)) / 86400000));
  const body = fillTemplate(tpl, {
    borrowerName: esc(row.borrower_name), vendor: esc(vendor.name),
    items: esc(row.items.map(itemLine).join(', ')),
    total: row.grand_total > 0 ? fmtMoney(row.grand_total) + ' ' + currency : '—',
    currency, days: daysSince + ' day' + (daysSince !== 1 ? 's' : ''),
  });
  return { to: row.borrower_email, subject: '⏰ Reminder: Borrowed Items – ' + vendor.name, html: body + signature() };
}

async function reminderTemplate(db) {
  const t = await getSetting(db, 'lendingReminderText');
  return (t && String(t).trim()) ? t : DEFAULT_LENDING_TEXT;
}

/** Sends the lending reminder to every active borrower with an email (one vendor, or all when
    vendorId is null). Returns { sent, no_email }. The Email Center calls this.
    A borrower whose send is refused by the provider is skipped, as the old app skipped a failed
    MailApp call; email not being configured at all is one honest error, not zero sends. */
export async function sendRemindersFor(db, vendorId, nowMs = Date.now(), d = {}) {
  // Cost: the listing reads (2-4) + 1 settings read + one send per borrower with an email.
  const { rows: list, vendors } = await loadLendings(db, { vendorId, status: 'Active', limit: 1000 });
  const tpl = list.length ? await reminderTemplate(db) : DEFAULT_LENDING_TEXT;
  let sent = 0, no_email = 0;
  for (const row of list) {
    if (!emailOf(row.borrower_email)) { no_email++; continue; }
    const vendor = vendors.get(String(row.vendor_id)) || { name: '', currency: 'TZS' };
    try { await sendEmail(reminderFor(row, vendor, tpl, nowMs), mailer(d)); sent++; }
    catch (e) { if (e && e.status === 400) throw e; }
  }
  return { sent, no_email };
}

/* ------------------------------------------------------------------ the functions */
export const FN = {
  /** Cost: 2 reads (+1 vendors for a manager, +1 units when a phone is out). */
  lendings: async (db, user, args) => {
    const vendorId = vendorScope(user, args);
    const status = STATUSES.includes(args.status) ? args.status : null;
    const { rows: list } = await loadLendings(db, { vendorId, status, knownVendor: user.vendor });
    return { rows: list };
  },

  /** Cost: 1 products read + 1 units read per serialized line (+1 branches when a branch is
      named) to validate EVERYTHING before the first write; then 1 header + 1 items insert and
      changeStock per line/unit. */
  recordLending: async (db, user, args, nowMs) => {
    const vendorId = requireVendorUser(user);            // managers have no shop to lend from
    const borrowerName = mustText(args.borrower_name, 'Borrower name');
    const borrowerEmail = emailOf(args.borrower_email);
    const borrowerPhone = text(args.borrower_phone);
    const items = Array.isArray(args.items) ? args.items : [];
    if (!items.length) throw badRequest('Add at least one item to lend.');

    const branchId = text(args.branch_id) || user.branch_id || null;
    if (text(args.branch_id) && String(args.branch_id) !== String(user.branch_id || '')) {
      const b = await one(db, 'branches', q => q.select('id').eq('id', branchId).eq('vendor_id', vendorId).eq('active', true));
      if (!b) throw notFound('Branch not found for your business.');
    }

    /* Every line is checked before anything is written: the old app decremented as it went and
       left half a lending behind when line three failed. Stock is checked cumulatively so the
       same product on two lines cannot each pass against the same 40 pieces. */
    const products = await rows(db, 'products', q => q.select(PRODUCT_COLS).in('id', [...new Set(items.map(i => String(i && i.product_id || '')))]).eq('vendor_id', vendorId));
    const need = new Map(), claimed = new Set(), lines = [];
    for (const it of items) {
      const product = products.find(p => String(p.id) === String(it && it.product_id));
      if (!product) throw notFound('Product not found for your business.');
      if (!product.active) throw badRequest('Product ' + (product.legacy_id || product.name) + ' not found or not active.');
      const qty = int(it.qty);
      if (qty < 1) throw badRequest('Quantity must be at least 1 for "' + product.name + '".');
      const price = money(it.price);
      if (price < 0) throw badRequest('Price cannot be negative for "' + product.name + '".');
      let units = [];
      if (product.is_serialized) {
        const ids = (Array.isArray(it.unit_ids) ? it.unit_ids : []).map(String).filter(Boolean);
        if (ids.length !== qty) throw badRequest('"' + product.name + '" is tracked by IMEI/serial -- choose exactly ' + qty + ' unit(s).');
        for (const id of ids) { if (claimed.has(id)) throw badRequest('Unit ' + id + ' is listed twice.'); claimed.add(id); }
        units = await claimUnits(db, product, ids);
      } else {
        const total = (need.get(product.id) || 0) + qty;
        need.set(product.id, total);
        if (num(product.stock) < total) throw badRequest('Insufficient stock for "' + product.name + '". Available: ' + num(product.stock));
      }
      lines.push({ product, qty, price, units });
    }

    const lending = await insertOne(db, 'lendings', {
      legacy_id: 'LEND-' + randomUUID().slice(0, 8).toUpperCase(), vendor_id: vendorId, branch_id: branchId,
      borrower_name: borrowerName, borrower_email: borrowerEmail, borrower_phone: borrowerPhone,
      recorded_by: user.id, recorded_by_name: user.name, status: 'Active', return_date: null, created_at: iso(nowMs),
    });
    const itemRows = [];
    for (const l of lines) {
      if (l.product.is_serialized) {
        for (const u of l.units) itemRows.push({ lending_id: lending.id, product_id: l.product.id, product_name: l.product.name, unit_id: u.id, qty: 1, price: l.price, total: l.price });
      } else {
        itemRows.push({ lending_id: lending.id, product_id: l.product.id, product_name: l.product.name, unit_id: null, qty: l.qty, price: l.price, total: money(l.qty * l.price) });
      }
    }
    await insertMany(db, 'lending_items', itemRows);
    for (const l of lines) {
      const common = { product: l.product, type: 'lent', user, referenceLendingId: lending.id };
      if (l.product.is_serialized) {
        for (const u of l.units) await changeStock(db, { ...common, delta: -1, unit: u, unitStatus: 'lent', fromBranchId: u.branch_id }, nowMs);
      } else {
        await changeStock(db, { ...common, delta: -l.qty, branchId }, nowMs);
      }
    }

    const grandTotal = itemRows.reduce((a, r) => a + num(r.total), 0);
    const currency = currencyOf(user.vendor);
    if (borrowerEmail) {                                  // best effort, as MailApp was
      const names = lines.map(l => itemLine({ qty: l.qty, product_name: l.product.name, price: l.price, imei: l.units.map(u => u.imei || u.serial_no).filter(Boolean).join(', ') || null }));
      try {
        await sendEmail({
          to: borrowerEmail, subject: '📋 Lending Confirmation – ' + user.vendor.name,
          html: '<h3>Business Operator – Lending Confirmation</h3><p>Dear <strong>' + esc(borrowerName) + '</strong>,</p>'
            + '<p>You have borrowed the following from <strong>' + esc(user.vendor.name) + '</strong>:</p>'
            + '<p style="padding:10px;background:#eef4ff;border-radius:8px;"><strong>' + names.map(esc).join('<br>') + '</strong></p>'
            + (grandTotal > 0 ? '<p>Total value: <strong>' + fmtMoney(grandTotal) + ' ' + currency + '</strong></p>' : '')
            + '<p>Please return at your earliest convenience.</p>' + signature(),
        }, mailer());
      } catch { /* the lending stands whether or not the mail went */ }
    }
    return {
      message: 'Lending recorded for ' + borrowerName + '. Items: ' + lines.length + (grandTotal > 0 ? '. Total owed: ' + fmtMoney(grandTotal) + ' ' + currency : '') + '.',
      lending_id: lending.id,
    };
  },

  /** Cost: 1 header + 1 items read, 1 update, then restoreItems (2 reads + changeStock per item). */
  markLendingReturned: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const l = await loadLending(db, user, args.lending_id);
    if (l.status !== 'Active') throw badRequest('This lending is already returned.');
    const items = await rows(db, 'lending_items', q => q.select(ITEM_COLS).eq('lending_id', l.id));
    // The header flips first so a retry after a half-done restore cannot put the stock back twice.
    await update(db, 'lendings', { status: 'Returned', return_date: iso(nowMs) }, q => q.eq('id', l.id).eq('status', 'Active'));
    await restoreItems(db, user, l, items, null, nowMs);
    if (emailOf(l.borrower_email)) {
      try {
        const vendor = await vendorOf(db, user, l.vendor_id);
        await sendEmail({
          to: l.borrower_email, subject: '✅ Return Confirmed – ' + (vendor ? vendor.name : ''),
          html: '<p>Dear <strong>' + esc(l.borrower_name) + '</strong>,</p><p>Your borrowing has been marked as <strong>returned</strong>. Thank you!</p>' + signature(),
        }, mailer());
      } catch { /* best effort */ }
    }
    return { message: 'Marked as returned. Stock restored.' };
  },

  /** Cost: 1 header + 1 items read; if still out, 1 update + restoreItems; then 2 deletes. */
  deleteLending: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const l = await loadLending(db, user, args.lending_id);
    const wasActive = l.status === 'Active';
    if (wasActive) {
      const items = await rows(db, 'lending_items', q => q.select(ITEM_COLS).eq('lending_id', l.id));
      await update(db, 'lendings', { status: 'Returned', return_date: iso(nowMs) }, q => q.eq('id', l.id).eq('status', 'Active'));
      await restoreItems(db, user, l, items, 'Lending deleted', nowMs);
    }
    await remove(db, 'lending_items', q => q.eq('lending_id', l.id));
    await remove(db, 'lendings', q => q.eq('id', l.id));
    return { message: 'Lending deleted.' + (wasActive ? ' Stock restored.' : ' (Was already returned.)') };
  },

  /** Cost: the listing reads for one id (2-4) + 1 settings read + 1 send. A refused send is the error. */
  sendLendingReminder: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const { rows: list, vendors } = await loadLendings(db, { id: String(args.lending_id || ''), knownVendor: user.vendor });
    const row = list[0];
    if (!row) throw notFound('Lending not found.');
    requireSameVendor(user, row);
    if (row.status !== 'Active') throw badRequest('This lending is already returned.');
    if (!emailOf(row.borrower_email)) throw badRequest('Borrower has no email address on record.');
    const vendor = vendors.get(String(row.vendor_id)) || user.vendor;
    await sendEmail(reminderFor(row, vendor, await reminderTemplate(db), nowMs), mailer());
    return { message: 'Reminder sent to ' + row.borrower_email };
  },

  /** Admin: own vendor. Manager: vendor_id or every vendor. Cost: see sendRemindersFor. */
  sendLendingReminders: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const vendorId = vendorScope(user, args);
    const { sent, no_email } = await sendRemindersFor(db, vendorId, nowMs, { fetch: deps.fetch });
    const msg = 'Sent ' + sent + ' reminder' + (sent !== 1 ? 's' : '') + '.'
      + (no_email > 0 ? ' ' + no_email + ' borrower' + (no_email !== 1 ? 's' : '') + ' had no email.' : '');
    return { message: msg };
  },
};

/* Who may do what, in one place: requireVendorUser refuses a manager (no shop to lend from),
   requireAdmin refuses a seller, requireSameVendor refuses a neighbouring business. */
export const WRITES = ['recordLending', 'markLendingReturned', 'deleteLending', 'sendLendingReminder', 'sendLendingReminders'];
