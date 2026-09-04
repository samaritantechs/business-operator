import { rows, rowsAll, update, insertOne, rpcOr, one, num, int, iso, badRequest, notFound, isMissingFunction, dbErr } from './_shared.js';
import { runQuery } from '../supabase.js';

/* =====================================================================================
   EVERY STOCK CHANGE GOES THROUGH HERE -- requirement #10 is this file.
   =====================================================================================
   Sales, lendings, returns, cancellations, restocks, transfers and adjustments all change stock
   by calling changeStock(). It updates the product total (atomically, through bo_adjust_stock,
   with a read-then-write fallback for a database that has not run the function yet), the
   branch quantity when the vendor uses branches, the units when the product is serialized, and
   writes exactly one stock_movements row. A module that touches products.stock any other way
   is a bug. */

/** Adds `delta` (signed) to a product's stock and returns the new total. */
export async function adjustProductStock(db, productId, delta) {
  const d = int(delta);
  if (!d) {
    const p = await one(db, 'products', q => q.select('stock').eq('id', productId));
    return p ? num(p.stock) : 0;
  }
  const out = await rpcOr(db, 'bo_adjust_stock', { p_product: productId, p_delta: d }, async () => {
    const p = await one(db, 'products', q => q.select('stock').eq('id', productId));
    if (!p) throw notFound('Product not found.');
    const next = num(p.stock) + d;
    await update(db, 'products', { stock: next }, q => q.eq('id', productId));
    return next;
  }, { scalar: true });
  return Array.isArray(out) ? num(out[0] && (out[0].bo_adjust_stock != null ? out[0].bo_adjust_stock : out[0])) : num(out);
}

/** Adds `delta` to a (product, branch) quantity, creating the row at delta if absent. */
export async function adjustBranchStock(db, productId, branchId, delta) {
  const d = int(delta);
  if (!branchId || !d) return null;
  const out = await rpcOr(db, 'bo_adjust_branch_stock', { p_product: productId, p_branch: branchId, p_delta: d }, async () => {
    const r = await one(db, 'branch_stock', q => q.select('qty').eq('product_id', productId).eq('branch_id', branchId));
    const next = num(r && r.qty) + d;
    const { error } = await runQuery(() => db.from('branch_stock').upsert({ product_id: productId, branch_id: branchId, qty: next }, { onConflict: 'product_id,branch_id' }));
    if (error) throw dbErr(error);
    return next;
  }, { scalar: true });
  return Array.isArray(out) ? num(out[0] && (out[0].bo_adjust_branch_stock != null ? out[0].bo_adjust_branch_stock : out[0])) : num(out);
}

/** Sets products.stock of a serialized product to its count of in-stock units. */
export async function recountSerialized(db, productId) {
  const out = await rpcOr(db, 'bo_recount_units', { p_product: productId }, async () => {
    const list = await rowsAll(db, 'product_units', q => q.select('id').eq('product_id', productId).eq('status', 'in_stock'));
    await update(db, 'products', { stock: list.length }, q => q.eq('id', productId));
    return list.length;
  }, { scalar: true });
  return Array.isArray(out) ? num(out[0] && (out[0].bo_recount_units != null ? out[0].bo_recount_units : out[0])) : num(out);
}

export const MOVEMENT_TYPES = ['received', 'sold', 'transfer_out', 'transfer_in', 'returned', 'adjustment', 'cancelled_restock', 'lent',
  'adjustment_in', 'adjustment_out'];

/* A stock take goes both ways, and 'adjustment' recorded only that one happened. qty is always
   positive and the type is what carries direction, so "-3, damaged" and "+3, found again" were
   written as the same row twice over: replaying the ledger for that product gave +6, -6 or 0
   with equal justification, and the Stock Movements report counted neither in its totals.
   changeStock resolves it from the delta, so no caller has to remember to. The bare value is
   still accepted -- rows written before this keep it -- and stays out of both report totals. */
const DIRECTED_ADJUSTMENT = d => (d < 0 ? 'adjustment_out' : 'adjustment_in');

/** Writes the audit row for one stock change. Always positive qty; `type` says the direction. */
export async function writeMovement(db, m, nowMs = Date.now()) {
  const row = {
    vendor_id: m.vendor_id, product_id: m.product_id, product_name: m.product_name || null,
    unit_id: m.unit_id || null, imei: m.imei || null,
    type: m.type, qty: Math.abs(int(m.qty) || 1),
    from_branch_id: m.from_branch_id || null, to_branch_id: m.to_branch_id || null,
    reference_sale_id: m.reference_sale_id || null, reference_lending_id: m.reference_lending_id || null,
    by_user: (m.user && m.user.id) || m.by_user || null, by_name: (m.user && m.user.name) || m.by_name || null,
    note: m.note || null, created_at: iso(nowMs),
  };
  return insertOne(db, 'stock_movements', row);
}

/** THE ONE DOOR. `delta` is signed (+ received, - sold). For a serialized product pass `unit`
    (the product_units row) and `unitStatus` (what the unit becomes); the product total is
    then recounted from the units rather than added to.
    Returns { stock, branch_qty }. */
export async function changeStock(db, { product, delta, branchId, type: rawType, user, note, referenceSaleId, referenceLendingId, unit, unitStatus, unitPatch, toBranchId, fromBranchId }, nowMs = Date.now()) {
  if (!product || !product.id) throw badRequest('changeStock needs a product.');
  let type = rawType;
  if (!MOVEMENT_TYPES.includes(type)) throw badRequest('Unknown movement type: ' + type);
  const d = int(delta);
  if (type === 'adjustment') type = DIRECTED_ADJUSTMENT(d);
  let stock, branchQty = null;
  if (product.is_serialized) {
    if (!unit) throw badRequest('A serialized product moves unit by unit -- pick the IMEI.');
    const patch = { updated_at: iso(nowMs), ...(unitPatch || {}) };
    if (unitStatus) patch.status = unitStatus;
    if (toBranchId !== undefined) patch.branch_id = toBranchId || null;
    await update(db, 'product_units', patch, q => q.eq('id', unit.id));
    stock = await recountSerialized(db, product.id);
  } else {
    stock = await adjustProductStock(db, product.id, d);
    if (branchId) branchQty = await adjustBranchStock(db, product.id, branchId, d);
  }
  await writeMovement(db, {
    vendor_id: product.vendor_id, product_id: product.id, product_name: product.name,
    unit_id: unit && unit.id, imei: unit && unit.imei, type, qty: Math.abs(d) || 1,
    from_branch_id: fromBranchId !== undefined ? fromBranchId : (d < 0 ? branchId : null),
    to_branch_id: toBranchId !== undefined ? toBranchId : (d > 0 ? branchId : null),
    reference_sale_id: referenceSaleId, reference_lending_id: referenceLendingId, user, note,
  }, nowMs);
  return { stock, branch_qty: branchQty };
}

/** Units of a product available to sell/lend, optionally at one branch. */
export async function availableUnits(db, productId, branchId) {
  return rowsAll(db, 'product_units', q => {
    let b = q.select('id, product_id, vendor_id, branch_id, imei, serial_no, status, received_at').eq('product_id', productId).eq('status', 'in_stock');
    if (branchId) b = b.eq('branch_id', branchId);
    return b.order('received_at', { ascending: true });
  });
}

/** Loads and validates the units a checkout named: each must belong to the product and be in stock. */
export async function claimUnits(db, product, unitIds) {
  const ids = (unitIds || []).map(String).filter(Boolean);
  if (!ids.length) throw badRequest('"' + product.name + '" is tracked by IMEI/serial -- choose which unit(s) you are selling.');
  const list = await rows(db, 'product_units', q => q.select('id, product_id, vendor_id, branch_id, imei, serial_no, status').in('id', ids));
  for (const id of ids) {
    const u = list.find(x => String(x.id) === id);
    if (!u || String(u.product_id) !== String(product.id)) throw badRequest('Unit ' + id + ' does not belong to "' + product.name + '".');
    if (u.status !== 'in_stock') throw badRequest('Unit ' + (u.imei || u.serial_no || id) + ' is not in stock (' + u.status + ').');
  }
  return ids.map(id => list.find(x => String(x.id) === id));
}

export async function branchStockRows(db, vendorId, branchId) {
  // branch_stock has no vendor column; the product list does, so join in code on a bounded set.
  const prods = await rowsAll(db, 'products', q => q.select('id, name, category, brand, model, stock, is_serialized, reorder_point, active').eq('vendor_id', vendorId).eq('active', true));
  const ids = prods.map(p => p.id);
  if (!ids.length) return [];
  const bs = await rowsAll(db, 'branch_stock', q => (branchId ? q.select('product_id, branch_id, qty').in('product_id', ids).eq('branch_id', branchId) : q.select('product_id, branch_id, qty').in('product_id', ids)));
  return bs.map(r => ({ ...r, product: prods.find(p => String(p.id) === String(r.product_id)) })).filter(r => r.product);
}
