import { rows, rowsAll, insertOne, update, badRequest, num, int, money, text, mustText, iso, vendorScope, mustProduct, PRODUCT_COLS } from './_shared.js';
import { requireAdmin } from '../auth.js';
import { changeStock } from './stock.js';
import { decodeDataUrl, uploadImage, BUCKETS } from '../storage.js';
import { mustVendorId, writeVendor, mustBranch, BRANCH_COLS, PARTNER_COLS } from './stockops.js';

/* =====================================================================================
   PRODUCTS -- the catalogue: what a business sells, at what price, how many are left.
   =====================================================================================
   A 1:1 port of the Apps Script getProducts / getProductsWithRows / addNewProduct /
   updateProduct / toggleProductActive / addStockToProduct / uploadProductImage, with one
   change that matters: a quantity is never written here. Opening stock, a restock and a
   changed number on the edit form all go through stock.changeStock, so a stock_movements
   row exists for each of them (requirement #10) and a serialized product's count stays what
   its units say. Sellers and admins are pinned to their own business; a manager may name
   one on reads and must name one on writes. */

const listingType = v => (String(v || '').trim() === 'Rent' ? 'Rent' : 'Sale');
const boolArg = v => !(v === undefined || v === null || v === false || v === 'false' || v === 'No' || v === 0 || v === '0' || v === '');

/** The next P001-style id for a vendor: max over its existing /^P(\d+)$/ ids, plus one --
    exactly the legacy walk, on one paged read of one column. (Two admins adding at the same
    second could mint the same id; there is no unique constraint, as there was none before.) */
async function nextLegacyId(db, vendorId) {
  const list = await rowsAll(db, 'products', q => q.select('legacy_id').eq('vendor_id', vendorId));
  let max = 0;
  for (const r of list) {
    const m = /^P(\d+)$/.exec(String(r.legacy_id || '').trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'P' + String(max + 1).padStart(3, '0');
}

/** In-stock unit counts per product for the serialized ones in `list`, 0 or 1 trip. */
async function unitCounts(db, list) {
  const ids = list.filter(p => p.is_serialized).map(p => p.id);
  const n = new Map();
  if (!ids.length) return n;
  const units = await rowsAll(db, 'product_units', q => q.select('product_id').in('product_id', ids).eq('status', 'in_stock'));
  for (const u of units) n.set(String(u.product_id), (n.get(String(u.product_id)) || 0) + 1);
  return n;
}

export const FN = {
  /** The Products tab. Active only unless include_inactive; ordered as the sheet was
      (legacy_id, then name). 1 trip, +1 when the vendor has serialized products. Any role;
      a manager may name a vendor (none = every vendor, paged). */
  products: async (db, user, args) => {
    const vendorId = vendorScope(user, args);
    const list = await rowsAll(db, 'products', q => {
      let s = q.select(PRODUCT_COLS);
      if (vendorId) s = s.eq('vendor_id', vendorId);
      if (!boolArg(args.include_inactive)) s = s.eq('active', true);
      return s.order('legacy_id').order('name');
    });
    const n = await unitCounts(db, list);
    for (const p of list) if (p.is_serialized) p.units_in_stock = n.get(String(p.id)) || 0;
    return { rows: list };
  },

  /** Everything the Sell / Lend form needs in one call: active products, the in-stock units
      of the serialized ones (at one branch when asked), the partners a Credit sale can name,
      and the branches. 4 trips at most. Any vendor role. */
  productOptions: async (db, user, args) => {
    const vendorId = mustVendorId(user, args);
    const branchId = text(args.branch_id);
    const list = await rowsAll(db, 'products', q => q.select('id, legacy_id, name, price, stock, is_serialized, brand, model')
      .eq('vendor_id', vendorId).eq('active', true).order('legacy_id').order('name'));
    const serial = list.filter(p => p.is_serialized).map(p => p.id);
    const units = serial.length ? await rowsAll(db, 'product_units', q => {
      let s = q.select('id, product_id, imei, serial_no, branch_id').in('product_id', serial).eq('status', 'in_stock');
      if (branchId) s = s.eq('branch_id', branchId);
      return s.order('received_at');                  // oldest first: the phone that came in first sells first
    }) : [];
    const partners = await rows(db, 'financing_partners', q => q.select(PARTNER_COLS).or('vendor_id.eq.' + vendorId + ',vendor_id.is.null').eq('active', true).order('name').limit(500));
    const branches = await rows(db, 'branches', q => q.select(BRANCH_COLS).eq('vendor_id', vendorId).eq('active', true).order('name').limit(500));
    const products = list.map(p => ({
      ...p,
      units: p.is_serialized
        ? units.filter(u => String(u.product_id) === String(p.id)).map(u => ({ id: u.id, imei: u.imei, serial_no: u.serial_no, branch_id: u.branch_id }))
        : [],
    }));
    return { products, partners, branches };
  },

  /** New product, id minted per vendor. Opening stock on a counted product is written as a
      `received` movement (so day one is in the ledger); a serialized product always starts at
      0 and gets its stock through addUnits. Trips: vendor (manager only), branch (if given),
      legacy ids, insert, + changeStock when there is opening stock. */
  addProduct: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const vendor = await writeVendor(db, user, args);
    const name = mustText(args.name, 'Product name');
    const price = money(args.price);
    if (price < 0) throw badRequest('Price cannot be negative.');
    const opening = int(args.stock);
    if (opening < 0) throw badRequest('Opening stock cannot be negative.');
    const serialized = boolArg(args.is_serialized);
    const branch = await mustBranch(db, vendor.id, args.branch_id);
    const legacyId = await nextLegacyId(db, vendor.id);
    const product = await insertOne(db, 'products', {
      vendor_id: vendor.id, legacy_id: legacyId, name,
      category: text(args.category), brand: text(args.brand), model: text(args.model),
      price, stock: 0, is_serialized: serialized, supplier: text(args.supplier),
      reorder_point: (args.reorder_point === undefined || args.reorder_point === null || args.reorder_point === '') ? 20 : int(args.reorder_point),
      active: true, image1_url: null, image2_url: null,
      listing_type: listingType(args.listing_type), price_unit: text(args.price_unit) || '', location: text(args.location) || '',
      created_at: iso(nowMs), updated_at: iso(nowMs),
    });
    if (opening > 0 && !serialized) {
      const r = await changeStock(db, { product, delta: opening, branchId: branch ? branch.id : null, type: 'received', user, note: 'Opening stock' }, nowMs);
      product.stock = r.stock;
    }
    return { product };
  },

  /** The edit form. Fields are applied as given; a changed `stock` on a counted product is
      the difference written as an `adjustment` (not a silent overwrite), and on a serialized
      product it is ignored -- the units are the truth. 2 trips + changeStock. */
  updateProduct: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const vendor = await writeVendor(db, user, args);
    const p = await mustProduct(db, args.id, vendor.id);
    const patch = { updated_at: iso(nowMs) };
    if (args.name !== undefined) patch.name = mustText(args.name, 'Product name');
    if (args.category !== undefined) patch.category = text(args.category);
    if (args.price !== undefined) { patch.price = money(args.price); if (patch.price < 0) throw badRequest('Price cannot be negative.'); }
    if (args.reorder_point !== undefined) patch.reorder_point = int(args.reorder_point);
    if (args.listing_type !== undefined) patch.listing_type = listingType(args.listing_type);
    if (args.price_unit !== undefined) patch.price_unit = text(args.price_unit) || '';
    if (args.location !== undefined) patch.location = text(args.location) || '';
    if (args.brand !== undefined) patch.brand = text(args.brand);
    if (args.model !== undefined) patch.model = text(args.model);
    const [fresh] = await update(db, 'products', patch, q => q.eq('id', p.id));
    let product = fresh || { ...p, ...patch };
    const stockGiven = args.stock !== undefined && args.stock !== null && String(args.stock).trim() !== '';
    if (stockGiven && !p.is_serialized) {
      const target = int(args.stock);
      if (target < 0) throw badRequest('Stock cannot be negative.');
      const delta = target - num(p.stock);
      if (delta) {
        const r = await changeStock(db, { product, delta, branchId: null, type: 'adjustment', user, note: 'Edited on product form' }, nowMs);
        product = { ...product, stock: r.stock };
      }
    }
    return { product };
  },

  /** Show / hide a product (the marketplace and the Sell form list active ones). 2 trips. */
  toggleProduct: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const vendor = await writeVendor(db, user, args);
    const p = await mustProduct(db, args.id, vendor.id);
    const active = boolArg(args.active);
    await update(db, 'products', { active, updated_at: iso(nowMs) }, q => q.eq('id', p.id));
    return { message: 'Product ' + (active ? 'activated' : 'deactivated') + '.' };
  },

  /** A restock of a counted product: `received`, at a branch when the vendor has them. A
      serialized product is restocked unit by unit (addUnits), never by a number. 1-2 trips
      + changeStock. */
  addStock: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const vendor = await writeVendor(db, user, args);
    const qty = int(args.qty);
    if (qty <= 0) throw badRequest('Enter a quantity above zero.');
    const p = await mustProduct(db, args.product_id, vendor.id);
    if (p.is_serialized) throw badRequest('"' + p.name + '" is tracked by IMEI/serial -- add its units on the Stock tab instead.');
    if (!p.active) throw badRequest('"' + p.name + '" is inactive -- activate it first.');
    const branch = await mustBranch(db, vendor.id, args.branch_id);
    const r = await changeStock(db, { product: p, delta: qty, branchId: branch ? branch.id : null, type: 'received', user, note: text(args.note) }, nowMs);
    return { message: 'Stock updated. New qty: ' + r.stock, stock: r.stock };
  },

  /** A product photo into Storage at a stable path per (vendor, product, slot) so a re-upload
      replaces the old one; the row keeps the public URL, as it kept a Drive URL before.
      1 trip + upload + 1 update. */
  uploadProductImage: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const vendor = await writeVendor(db, user, args);
    const slot = [1, 2, 3].find(n => String(args.slot) === String(n)) || 0;
    if (!slot) throw badRequest('Image slot must be 1, 2 or 3.');
    const p = await mustProduct(db, args.product_id, vendor.id);
    let img;
    try { img = decodeDataUrl(args.data_url); } catch (e) { throw badRequest(e.message); }
    const url = await uploadImage(db, BUCKETS.product, vendor.id + '/' + p.id + '-' + slot + '.' + img.ext, img, nowMs);
    await update(db, 'products', { ['image' + slot + '_url']: url, updated_at: iso(nowMs) }, q => q.eq('id', p.id));
    return { url };
  },
};

export const WRITES = ['addProduct', 'updateProduct', 'toggleProduct', 'addStock', 'uploadProductImage'];
