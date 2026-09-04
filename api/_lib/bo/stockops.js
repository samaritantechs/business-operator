import { rows, rowsAll, one, insertOne, insertMany, update, badRequest, forbidden, notFound, num, int, text, mustText, iso,
  isManagerLevel, vendorScope, scopedVendor, mustProduct, productById, rangeBounds, PRODUCT_COLS } from './_shared.js';
import { requireAdmin } from '../auth.js';
import { changeStock, claimUnits, recountSerialized, adjustBranchStock, branchStockRows, writeMovement, MOVEMENT_TYPES } from './stock.js';

/* =====================================================================================
   STOCK OPERATIONS -- Frank Amos's phone-retail additions (handoff §12: #1, #5, #7, #10).
   =====================================================================================
   Branches (shops), financing partners, serialized units (one row per IMEI), transfers between
   shops, corrections, and the movement ledger that answers "received / sold / transferred /
   remaining". None of this touches products.stock, branch_stock.qty or product_units.status
   directly: every quantity change goes through stock.js so exactly one stock_movements row
   exists for it. A vendor with no branches and no serialized products never needs this file.

   SCOPE. Sellers and admins are pinned to their own business whatever they send; a manager may
   name one with vendor_id on reads, and MUST name one for a write that needs a vendor. */

export const BRANCH_COLS = 'id, vendor_id, name, location, active, created_at';
export const PARTNER_COLS = 'id, vendor_id, name, contact, active, created_at';
export const UNIT_COLS = 'id, product_id, vendor_id, branch_id, imei, serial_no, status, received_at, sold_sale_id, sold_at, note, updated_at';
const MOVEMENT_COLS = 'id, vendor_id, product_id, product_name, unit_id, imei, type, qty, from_branch_id, to_branch_id, reference_sale_id, reference_lending_id, by_user, by_name, note, created_at';
const SALE_COLS = 'id, legacy_id, group_id, vendor_id, branch_id, seller_name, product_name, brand, model, unit_id, imei, qty, list_price, discount, price, total, payment_method, financing_partner_id, partner_paid, status, cancelled_by_name, cancelled_at, cancel_reason, sold_at';
const UNIT_STATUSES = ['in_stock', 'sold', 'lent', 'lost'];
const PICK_VENDOR = 'Chagua biashara kwanza. / Pick a business first (vendor_id).';

/* ------------------------------------------------------------------ scope helpers
   These two belong in _shared.js next to scopedVendor; they live here (and products.js
   imports them) only because _shared.js is not this module's to edit. */

/** The one vendor a call is about, with no trip: the caller's own, or the one a manager named.
    "Every vendor" is not an answer a branch or stock screen can work with. */
export function mustVendorId(user, args) {
  const id = vendorScope(user, args);
  if (!id) throw badRequest(PICK_VENDOR);
  return id;
}
/** Same, for a write: the vendor ROW, verified to exist when a manager named it (mustVendor). */
export async function writeVendor(db, user, args) {
  const v = await scopedVendor(db, user, args);
  if (!v) throw badRequest(PICK_VENDOR);
  return v;
}
/** A branch id from the page, checked to be this vendor's. Nothing given -> null (no branch),
    which is how a vendor without shops uses every function here. 1 trip when given. */
export async function mustBranch(db, vendorId, id, label) {
  const bid = text(id);
  if (!bid) return null;
  const b = await one(db, 'branches', q => q.select(BRANCH_COLS).eq('id', bid).eq('vendor_id', vendorId));
  if (!b) throw notFound((label || 'Branch') + ' not found for your business.');
  return b;
}

/* ------------------------------------------------------------------ small vocabulary */
const nameOf = (list, id) => { const r = id ? list.find(x => String(x.id) === String(id)) : null; return r ? r.name : null; };
const quoted = p => '"' + (p && p.name) + '"';
/** An IMEI as typed on a phone box: spaces and dashes dropped, then 14-16 digits or refused. */
function imeiOf(v) {
  const s = String(v == null ? '' : v).replace(/[\s-]/g, '');
  if (!s) return null;
  if (!/^\d{14,16}$/.test(s)) throw badRequest('IMEI "' + s + '" must be 14-16 digits.');
  return s;
}
/** A search string made safe inside a PostgREST `or` clause: a comma or bracket would end the
    clause early, and % _ \ are LIKE wildcards the person did not mean. */
const likeSafe = v => String(v == null ? '' : v).trim().replace(/[,()]/g, '').replace(/[\\%_]/g, m => '\\' + m).slice(0, 40);
const boolArg = (v, dflt) => (v === undefined || v === null || v === '') ? dflt : !(v === false || v === 'false' || v === 'No' || v === 0 || v === '0');

/** The vendor's branches once, for naming from/to on rows. 1 trip. */
async function branchesOf(db, vendorId) {
  return rowsAll(db, 'branches', q => (vendorId ? q.select('id, vendor_id, name').eq('vendor_id', vendorId) : q.select('id, vendor_id, name')));
}
/** A sales row in the recentSales shape (docs/API-CONTRACT.md §sales), names filled in. */
function saleRow(s, branches, partner) {
  return {
    id: s.id, legacy_id: s.legacy_id, group_id: s.group_id, sold_at: s.sold_at, seller_name: s.seller_name,
    product_name: s.product_name, brand: s.brand, model: s.model, imei: s.imei, qty: s.qty,
    list_price: s.list_price, discount: s.discount, price: s.price, total: s.total, payment_method: s.payment_method,
    partner_name: partner ? partner.name : null, partner_paid: !!s.partner_paid, status: s.status,
    branch_name: nameOf(branches, s.branch_id), cancelled_by_name: s.cancelled_by_name, cancelled_at: s.cancelled_at, cancel_reason: s.cancel_reason,
  };
}

export const FN = {
  /* ================================================================ branches */

  /** Every branch of the vendor, inactive ones too (the editor shows them). 1 trip. Any role. */
  branches: async (db, user, args) => {
    const vendorId = vendorScope(user, args);
    const list = await rowsAll(db, 'branches', q => (vendorId ? q.select(BRANCH_COLS).eq('vendor_id', vendorId) : q.select(BRANCH_COLS)).order('name'));
    return { rows: list };
  },

  /** Create or rename a branch. A name is unique per vendor (the table says so too, but a
      constraint error is a 500 with Postgres's words; this is a 400 with ours). 2-3 trips. */
  saveBranch: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const vendor = await writeVendor(db, user, args);
    const name = mustText(args.name, 'Branch name');
    const id = text(args.id);
    const clash = await one(db, 'branches', q => q.select('id').eq('vendor_id', vendor.id).eq('name', name));
    if (clash && String(clash.id) !== String(id)) throw badRequest('A branch named "' + name + '" already exists.');
    const patch = { name, location: text(args.location), active: boolArg(args.active, true) };
    if (!id) {
      const branch = await insertOne(db, 'branches', { vendor_id: vendor.id, ...patch, created_at: iso(nowMs) });
      return { branch };
    }
    const [branch] = await update(db, 'branches', patch, q => q.eq('id', id).eq('vendor_id', vendor.id));
    if (!branch) throw notFound('Branch not found for your business.');
    return { branch };
  },

  /* ================================================================ financing partners */

  /** The vendor's partners plus the global ones (vendor_id null). Admins and managers see
      inactive rows too (they edit them); sellers only what they can pick at checkout. 1 trip. */
  partners: async (db, user, args) => {
    const vendorId = vendorScope(user, args);
    const editor = isManagerLevel(user.role) || user.is_admin;
    const list = await rowsAll(db, 'financing_partners', q => {
      let s = q.select(PARTNER_COLS);
      if (vendorId) s = s.or('vendor_id.eq.' + vendorId + ',vendor_id.is.null');
      if (!editor) s = s.eq('active', true);
      return s.order('name');
    });
    return { rows: list };
  },

  /** An admin keeps their own list; a manager without a vendor edits the global list every
      business sees (MOGO, Watu Simu...). 1-2 trips. */
  savePartner: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const vendorId = vendorScope(user, args);          // null only for a manager: a global row
    const name = mustText(args.name, 'Partner name');
    const id = text(args.id);
    const patch = { name, contact: text(args.contact), active: boolArg(args.active, true) };
    if (!id) {
      const partner = await insertOne(db, 'financing_partners', { vendor_id: vendorId, ...patch, created_at: iso(nowMs) });
      return { partner };
    }
    const cur = await one(db, 'financing_partners', q => q.select(PARTNER_COLS).eq('id', id));
    if (!cur) throw notFound('Partner not found.');
    if (!isManagerLevel(user.role)) {
      if (!cur.vendor_id) throw forbidden('That partner is shared by every business; only the manager can change it.');
      if (String(cur.vendor_id) !== String(vendorId)) throw forbidden('That partner belongs to another business.');
    }
    const [partner] = await update(db, 'financing_partners', patch, q => q.eq('id', id));
    return { partner };
  },

  /* ================================================================ units (IMEI / serial) */

  /** The unit list / IMEI search. Bounded at 500 newest; q matches IMEI or serial. 2 trips
      (units, then the product names). Any role: a seller scans an IMEI to find the phone. */
  units: async (db, user, args) => {
    const vendorId = vendorScope(user, args);
    const status = text(args.status);
    if (status && !UNIT_STATUSES.includes(status)) throw badRequest('Unknown unit status: ' + status);
    const q = likeSafe(args.q);
    const list = await rows(db, 'product_units', b => {
      let s = b.select(UNIT_COLS);
      if (vendorId) s = s.eq('vendor_id', vendorId);
      if (text(args.product_id)) s = s.eq('product_id', text(args.product_id));
      if (status) s = s.eq('status', status);
      if (text(args.branch_id)) s = s.eq('branch_id', text(args.branch_id));
      if (q) s = s.or('imei.ilike.%' + q + '%,serial_no.ilike.%' + q + '%');
      return s.order('received_at', { ascending: false }).limit(500);
    });
    const ids = [...new Set(list.map(u => String(u.product_id)))];
    const prods = ids.length ? await rows(db, 'products', b => b.select('id, name').in('id', ids)) : [];
    return { rows: list.map(u => ({ ...u, product_name: nameOf(prods, u.product_id) })) };
  },

  /** Receiving a box of phones: one unit per IMEI/serial, all at one branch. Duplicates are
      refused BEFORE anything is written -- within the list and against the vendor's existing
      IMEIs -- naming the offender, because a unique-constraint error names nothing useful.
      Trips: product, branch, duplicate check, insert, one recount, then one `received`
      movement per unit (N). */
  addUnits: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const vendor = await writeVendor(db, user, args);
    const product = await mustProduct(db, args.product_id, vendor.id);
    if (!product.is_serialized) throw badRequest(quoted(product) + ' is not tracked by IMEI/serial -- use "Add stock" for it.');
    const branch = await mustBranch(db, vendor.id, args.branch_id);
    const given = Array.isArray(args.units) ? args.units : [];
    if (!given.length) throw badRequest('Add at least one IMEI or serial number.');
    const seenImei = new Set(), seenSerial = new Set(), list = [];
    for (const u of given) {
      const imei = imeiOf(u && u.imei), serial = text(u && u.serial_no);
      if (!imei && !serial) throw badRequest('Every unit needs an IMEI or a serial number.');
      if (imei) { if (seenImei.has(imei)) throw badRequest('IMEI ' + imei + ' appears twice in this list.'); seenImei.add(imei); }
      if (serial) { if (seenSerial.has(serial)) throw badRequest('Serial ' + serial + ' appears twice in this list.'); seenSerial.add(serial); }
      list.push({ product_id: product.id, vendor_id: vendor.id, branch_id: branch ? branch.id : null, imei, serial_no: serial,
        status: 'in_stock', received_at: iso(nowMs), updated_at: iso(nowMs), note: null });
    }
    if (seenImei.size) {
      const taken = await rows(db, 'product_units', q => q.select('imei').eq('vendor_id', vendor.id).in('imei', [...seenImei]));
      if (taken.length) throw badRequest('IMEI ' + taken[0].imei + ' is already registered for your business.');
    }
    const made = await insertMany(db, 'product_units', list);
    const stock = await recountSerialized(db, product.id);
    for (const u of made) {
      await writeMovement(db, { vendor_id: vendor.id, product_id: product.id, product_name: product.name, unit_id: u.id, imei: u.imei,
        type: 'received', qty: 1, to_branch_id: branch ? branch.id : null, user, note: null }, nowMs);
    }
    return { message: 'Added ' + made.length + ' unit(s). ' + quoted(product) + ' now has ' + stock + ' in stock.', added: made.length, stock };
  },

  /** Correct a unit: its IMEI/serial, where it sits, or mark it lost / found. A status change
      is a stock change, so it goes through changeStock (adjustment movement + recount); the
      rest is a plain edit. A sold or lent unit is not edited here -- cancel the sale or mark
      the lending returned, so the ledger stays true. 3-6 trips. */
  updateUnit: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const vendor = await writeVendor(db, user, args);
    const unitId = mustText(args.unit_id, 'unit_id');
    const unit = await one(db, 'product_units', q => q.select(UNIT_COLS).eq('id', unitId).eq('vendor_id', vendor.id));
    if (!unit) throw notFound('Unit not found for your business.');
    const product = await mustProduct(db, unit.product_id, vendor.id);
    const patch = { updated_at: iso(nowMs) };
    if (args.imei !== undefined) {
      const imei = imeiOf(args.imei);
      if (imei && imei !== unit.imei) {
        const clash = await one(db, 'product_units', q => q.select('id').eq('vendor_id', vendor.id).eq('imei', imei));
        if (clash) throw badRequest('IMEI ' + imei + ' is already registered for your business.');
      }
      patch.imei = imei;
    }
    if (args.serial_no !== undefined) patch.serial_no = text(args.serial_no);
    if (args.note !== undefined) patch.note = text(args.note);
    let branch = null;
    if (args.branch_id !== undefined) { branch = await mustBranch(db, vendor.id, args.branch_id); patch.branch_id = branch ? branch.id : null; }
    if (patch.imei === null && (patch.serial_no === null || (patch.serial_no === undefined && !unit.serial_no))) throw badRequest('A unit needs an IMEI or a serial number.');
    const status = text(args.status);
    if (status && status !== unit.status) {
      if (!['in_stock', 'lost'].includes(status)) throw badRequest('A unit can only be set to in_stock or lost here.');
      if (unit.status === 'sold' || unit.status === 'lent') throw badRequest('This unit is ' + unit.status + ' -- cancel the sale or mark the lending returned instead.');
      const lost = status === 'lost';
      const { branch_id: _b, ...rest } = patch;            // changeStock sets branch_id itself via toBranchId
      await changeStock(db, {
        product, delta: lost ? -1 : 1, type: 'adjustment', user, unit, unitStatus: status, unitPatch: rest,
        note: text(args.note) || (lost ? 'Marked lost' : 'Back in stock'),
        fromBranchId: lost ? unit.branch_id : undefined,
        toBranchId: lost ? undefined : (patch.branch_id !== undefined ? patch.branch_id : unit.branch_id),
      }, nowMs);
    } else {
      await update(db, 'product_units', patch, q => q.eq('id', unit.id));
    }
    const fresh = await one(db, 'product_units', q => q.select(UNIT_COLS).eq('id', unit.id));
    return { unit: fresh };
  },

  /** One phone's whole life: received, transferred, sold, cancelled, lost -- and the sale it
      ended in, if any. Looked up by id or by IMEI. 5-6 trips. Admin / manager. */
  unitHistory: async (db, user, args) => {
    requireAdmin(user);
    const vendorId = vendorScope(user, args);
    const id = text(args.unit_id), imei = text(args.imei) ? String(args.imei).replace(/[\s-]/g, '') : null;
    if (!id && !imei) throw badRequest('Give a unit id or an IMEI.');
    const unit = await one(db, 'product_units', q => {
      let s = q.select(UNIT_COLS);
      s = id ? s.eq('id', id) : s.eq('imei', imei);
      if (vendorId) s = s.eq('vendor_id', vendorId);
      return s;
    });
    if (!unit) throw notFound('Unit not found' + (vendorId ? ' for your business.' : '.'));
    const product = await productById(db, unit.product_id);
    const branches = await branchesOf(db, unit.vendor_id);
    const movements = await rowsAll(db, 'stock_movements', q => q.select(MOVEMENT_COLS).eq('unit_id', unit.id).order('created_at'));
    // A unit sold, cancelled and sold again has two sales rows: the completed one is its story.
    const sales = await rows(db, 'sales', q => q.select(SALE_COLS).eq('unit_id', unit.id).order('sold_at', { ascending: false }).limit(5));
    const s = sales.find(x => x.status === 'completed') || sales[0] || null;
    const partner = s && s.financing_partner_id ? await one(db, 'financing_partners', q => q.select('id, name').eq('id', s.financing_partner_id)) : null;
    return {
      unit, product,
      movements: movements.map(m => ({ ...m, from_branch_name: nameOf(branches, m.from_branch_id), to_branch_name: nameOf(branches, m.to_branch_id) })),
      sale: s ? saleRow(s, branches, partner) : null,
    };
  },

  /* ================================================================ transfers and corrections */

  /** Shop-to-shop transfer (requirement #10). Non-serialized: a quantity leaves one branch's
      count and lands in the other's, the vendor total untouched, written as a transfer_out AND
      a transfer_in so each shop's ledger reads on its own. Serialized: the named units change
      branch, one pair of movements each. Trips: product, branches, then per kind:
      qty -> 1 read + 2 branch adjusts + 2 movements; units -> claim + per unit (out + in). */
  transferStock: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const vendor = await writeVendor(db, user, args);
    const product = await mustProduct(db, args.product_id, vendor.id);
    const fromId = mustText(args.from_branch_id, 'The branch to move from'), toId = mustText(args.to_branch_id, 'The branch to move to');
    if (fromId === toId) throw badRequest('Pick two different branches.');
    const both = await rows(db, 'branches', q => q.select(BRANCH_COLS).eq('vendor_id', vendor.id).in('id', [fromId, toId]));
    const from = both.find(b => String(b.id) === fromId), to = both.find(b => String(b.id) === toId);
    if (!from || !to) throw notFound('Branch not found for your business.');
    const note = text(args.note);
    const base = { vendor_id: vendor.id, product_id: product.id, product_name: product.name, from_branch_id: from.id, to_branch_id: to.id, user, note };

    if (!product.is_serialized) {
      const qty = int(args.qty);
      if (qty <= 0) throw badRequest('Enter a quantity above zero.');
      const at = await one(db, 'branch_stock', q => q.select('qty').eq('product_id', product.id).eq('branch_id', from.id));
      const have = num(at && at.qty);
      if (have < qty) throw badRequest('Only ' + have + ' of ' + quoted(product) + ' at ' + from.name + ' -- cannot move ' + qty + '.');
      await adjustBranchStock(db, product.id, from.id, -qty);
      await adjustBranchStock(db, product.id, to.id, qty);
      await writeMovement(db, { ...base, type: 'transfer_out', qty }, nowMs);
      await writeMovement(db, { ...base, type: 'transfer_in', qty }, nowMs);
      return { message: 'Moved ' + qty + ' x ' + quoted(product) + ' from ' + from.name + ' to ' + to.name + '.' };
    }
    const units = await claimUnits(db, product, args.unit_ids);
    for (const u of units) {
      if (String(u.branch_id || '') !== String(from.id)) throw badRequest('Unit ' + (u.imei || u.serial_no || u.id) + ' is at ' + (nameOf(both, u.branch_id) || 'no branch') + ', not at ' + from.name + '.');
    }
    for (const u of units) {
      await writeMovement(db, { ...base, type: 'transfer_out', qty: 1, unit_id: u.id, imei: u.imei }, nowMs);
      await changeStock(db, { product, delta: 0, unit: u, unitStatus: 'in_stock', type: 'transfer_in', user, note, fromBranchId: from.id, toBranchId: to.id }, nowMs);
    }
    return { message: 'Moved ' + units.length + ' unit(s) of ' + quoted(product) + ' from ' + from.name + ' to ' + to.name + '.' };
  },

  /** A counted correction (+/-) on a non-serialized product, with a reason -- the reason is
      the whole point of a correction being a ledger row and not an edit. A serialized product
      is corrected unit by unit (updateUnit: lost / found). 2-3 trips + changeStock. */
  adjustStock: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const vendor = await writeVendor(db, user, args);
    const delta = int(args.delta);
    if (!delta) throw badRequest('Enter the difference to apply (not zero).');
    const note = mustText(args.note, 'A reason for the adjustment');
    const product = await mustProduct(db, args.product_id, vendor.id);
    if (product.is_serialized) throw badRequest(quoted(product) + ' is tracked by IMEI/serial -- mark the unit lost or add units instead.');
    if (num(product.stock) + delta < 0) throw badRequest('That would take ' + quoted(product) + ' below zero (stock ' + num(product.stock) + ').');
    const branch = await mustBranch(db, vendor.id, args.branch_id);
    if (branch && delta < 0) {
      const at = await one(db, 'branch_stock', q => q.select('qty').eq('product_id', product.id).eq('branch_id', branch.id));
      if (num(at && at.qty) + delta < 0) throw badRequest('That would take ' + quoted(product) + ' at ' + branch.name + ' below zero (' + num(at && at.qty) + ' there).');
    }
    const r = await changeStock(db, { product, delta, branchId: branch ? branch.id : null, type: 'adjustment', user, note }, nowMs);
    return { message: 'Stock updated. New qty: ' + r.stock, stock: r.stock };
  },

  /* ================================================================ the ledger */

  /** The movement ledger for a date range, newest first, at most 2000 rows -- the date bounds
      are what keep this bounded, so they are required. 2 trips (movements, branch names). */
  movements: async (db, user, args) => {
    requireAdmin(user);
    const vendorId = vendorScope(user, args);
    const { from, to } = rangeBounds(args.start, args.end);
    const type = text(args.type);
    if (type && !MOVEMENT_TYPES.includes(type)) throw badRequest('Unknown movement type: ' + type);
    const branchId = text(args.branch_id), productId = text(args.product_id);
    const list = await rows(db, 'stock_movements', q => {
      let s = q.select(MOVEMENT_COLS).gte('created_at', from).lt('created_at', to);
      if (vendorId) s = s.eq('vendor_id', vendorId);
      if (productId) s = s.eq('product_id', productId);
      if (branchId) s = s.or('from_branch_id.eq.' + branchId + ',to_branch_id.eq.' + branchId);
      if (type) s = s.eq('type', type);
      return s.order('created_at', { ascending: false }).limit(2000);
    });
    const branches = await branchesOf(db, vendorId);
    return { rows: list.map(m => ({ ...m, from_branch_name: nameOf(branches, m.from_branch_id), to_branch_name: nameOf(branches, m.to_branch_id) })) };
  },

  /** "What is left in each shop": every active product with its per-branch quantities --
      branch_stock rows for counted products, in-stock units per branch for serialized ones --
      and the vendor total. 5 trips (products, branchStockRows x2, units, branches); the
      products read repeats the one inside branchStockRows so products with no branch row still
      appear. Admin / manager (a manager names the vendor). */
  branchStock: async (db, user, args) => {
    requireAdmin(user);
    const vendorId = mustVendorId(user, args);
    const branchId = text(args.branch_id);
    const prods = await rowsAll(db, 'products', q => q.select('id, legacy_id, name, brand, model, stock, is_serialized').eq('vendor_id', vendorId).eq('active', true).order('legacy_id').order('name'));
    const counted = await branchStockRows(db, vendorId, branchId);
    const serial = prods.filter(p => p.is_serialized).map(p => p.id);
    const units = serial.length ? await rowsAll(db, 'product_units', q => {
      let s = q.select('product_id, branch_id').in('product_id', serial).eq('status', 'in_stock');
      if (branchId) s = s.eq('branch_id', branchId);
      return s;
    }) : [];
    const branches = await branchesOf(db, vendorId);
    const byProduct = new Map();
    const bump = (pid, bid, qty) => {
      const key = String(pid);
      const m = byProduct.get(key) || new Map();
      const b = bid == null ? '' : String(bid);
      m.set(b, (m.get(b) || 0) + qty);
      byProduct.set(key, m);
    };
    for (const r of counted) bump(r.product_id, r.branch_id, num(r.qty));
    for (const u of units) bump(u.product_id, u.branch_id, 1);
    const out = prods.map(p => {
      const m = byProduct.get(String(p.id)) || new Map();
      const list = [...m.entries()].map(([bid, qty]) => ({ branch_id: bid || null, name: bid ? nameOf(branches, bid) : 'No branch', qty }));
      list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      return { product_id: p.id, name: p.name, brand: p.brand, model: p.model, is_serialized: !!p.is_serialized, total: num(p.stock), branches: list };
    });
    return { rows: out };
  },
};

export const WRITES = ['saveBranch', 'savePartner', 'addUnits', 'updateUnit', 'transferStock', 'adjustStock'];
