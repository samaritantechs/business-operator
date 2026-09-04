import { rows, rowsAll, one, insertOne, insertMany, update, remove, num, int, money, fmtMoney, text, mustText, iso,
  badRequest, notFound, vendorScope, requireVendorUser, currencyOf, sel, PRODUCT_COLS } from './_shared.js';
import { requireAdmin } from '../auth.js';
import { changeStock } from './stock.js';
import { mustBranch, writeVendor } from './stockops.js';

/* =====================================================================================
   PURCHASE ORDERS -- stock you have ordered and not yet got.
   =====================================================================================
   The first the system used to hear of a delivery was somebody typing a restock after the boxes
   were already open. Everything between "I have ordered forty covers" and "forty covers are on
   the shelf" lived in a WhatsApp thread, so three questions had no answer: what is on its way,
   what did the supplier actually send, and what is it costing this time.

   TWO RULES HOLD THE WHOLE THING UP.

   1. Receiving is the only way an order becomes stock, and it goes through changeStock() like
      every other quantity change. A delivery is a 'received' movement exactly as a manual
      restock is, so the movements report can still answer "where did these come from" and the
      per-shop figures still add up to the business total. Nothing here touches products.stock.

   2. A partial delivery is the normal case. A supplier who owes forty sends twenty-eight. So a
      line carries what was ORDERED and what has been RECEIVED so far, receiving tops the line
      up rather than replacing it, and the order stays open until they meet. Receiving the same
      delivery twice by accident is refused rather than doubled.

   And one thing it does that nothing else could: receiving updates the product's cost_price to
   what this delivery cost. That is the only way the profit figures stay honest without somebody
   remembering to go and retype a number after every delivery. */

const PO_COLS = 'id, legacy_id, vendor_id, branch_id, supplier, reference, notes, status, expected_at, '
  + 'created_by, created_by_name, created_at, closed_at, closed_by_name, cancel_reason';
const ITEM_COLS = 'id, po_id, product_id, product_name, qty, received_qty, unit_cost, total';

/** The next PO-0001 for a vendor: one paged read of one column, exactly as products do it. */
async function nextLegacyId(db, vendorId) {
  const list = await rowsAll(db, 'purchase_orders', q => q.select('legacy_id').eq('vendor_id', vendorId));
  let max = 0;
  for (const r of list) {
    const m = /^PO-(\d+)$/.exec(String(r.legacy_id || '').trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'PO-' + String(max + 1).padStart(4, '0');
}

/** Orders plus their lines, for one vendor. 2 reads: the headers, then every line at once. */
async function loadOrders(db, { vendorId, status, id, limit = 200 }) {
  const heads = await rows(db, 'purchase_orders', q => {
    let x = q.select(PO_COLS);
    if (id) x = x.eq('id', id);
    if (vendorId) x = x.eq('vendor_id', vendorId);
    if (status) x = x.eq('status', status);
    return x.order('created_at', { ascending: false }).limit(limit);
  });
  if (!heads.length) return [];
  const ids = heads.map(h => h.id);
  const items = await rowsAll(db, 'purchase_order_items', q => q.select(ITEM_COLS).in('po_id', ids));
  const byPo = new Map();
  for (const it of items) {
    const list = byPo.get(String(it.po_id)) || [];
    list.push({ ...it, qty: num(it.qty), received_qty: num(it.received_qty), unit_cost: num(it.unit_cost), total: num(it.total) });
    byPo.set(String(it.po_id), list);
  }
  return heads.map(h => {
    const list = byPo.get(String(h.id)) || [];
    return {
      ...h,
      items: list,
      total: money(list.reduce((a, i) => a + i.total, 0)),
      /* What is still owed by the supplier -- the number the whole screen exists for. */
      outstanding: list.reduce((a, i) => a + Math.max(0, i.qty - i.received_qty), 0),
      received_value: money(list.reduce((a, i) => a + i.received_qty * i.unit_cost, 0)),
    };
  });
}

/** The order, or a clear "not yours". */
async function mustOrder(db, vendorId, id) {
  const [po] = await loadOrders(db, { vendorId, id: mustText(id, 'Purchase order') });
  if (!po) throw notFound('Oda hiyo si ya biashara yako. / That purchase order is not one of yours.');
  return po;
}

export const FN = {
  /** The Purchase Orders screen. 2 reads. Admin of the business, or a manager naming one. */
  purchaseOrders: async (db, user, args) => {
    requireAdmin(user);
    const vendorId = vendorScope(user, args);
    if (!vendorId) throw badRequest('Chagua biashara kuona oda zake. / Pick a business to see its purchase orders.');
    const status = text(args.status);
    if (status && !['ordered', 'received', 'cancelled'].includes(status)) throw badRequest('Hali iwe ordered, received au cancelled. / Status must be ordered, received or cancelled.');
    return { rows: await loadOrders(db, { vendorId, status }), currency: currencyOf(user.vendor) };
  },

  /** Raise one. Nothing moves: an order is a promise, not a delivery.
      Trips: vendor (manager only), branch, products, legacy ids, insert head, insert lines. */
  createPurchaseOrder: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const vendor = await writeVendor(db, user, args);
    const items = Array.isArray(args.items) ? args.items : [];
    if (!items.length) throw badRequest('Ongeza angalau bidhaa moja kwenye oda. / Add at least one product to the order.');
    const branch = await mustBranch(db, vendor.id, args.branch_id);

    /* Every line is checked before anything is written, the same discipline recordSale keeps:
       a half-written order is worse than none, because somebody will receive it. */
    const wanted = [...new Set(items.map(i => String((i && i.product_id) || '')))].filter(Boolean);
    const products = wanted.length ? await rows(db, 'products', q => q.select(sel('products', PRODUCT_COLS)).in('id', wanted).eq('vendor_id', vendor.id).limit(500)) : [];
    const lines = [];
    for (const it of items) {
      const p = products.find(x => String(x.id) === String(it && it.product_id));
      if (!p) throw notFound('Mojawapo ya bidhaa hizo haiko kwenye orodha yako. / One of those products is not in your catalogue.');
      const qty = int(it.qty);
      if (qty < 1) throw badRequest('Agiza angalau 1 ya "' + p.name + '". / Order at least 1 of "' + p.name + '".');
      const unitCost = money(it.unit_cost === undefined || it.unit_cost === null || it.unit_cost === '' ? p.cost_price : it.unit_cost);
      if (unitCost < 0) throw badRequest('Gharama ya "' + p.name + '" haiwezi kuwa hasi. / Cost for "' + p.name + '" cannot be negative.');
      lines.push({ product: p, qty, unitCost });
    }

    const po = await insertOne(db, 'purchase_orders', {
      legacy_id: await nextLegacyId(db, vendor.id), vendor_id: vendor.id, branch_id: branch ? branch.id : null,
      supplier: text(args.supplier), reference: text(args.reference), notes: text(args.notes),
      status: 'ordered', expected_at: text(args.expected_at),
      created_by: user.id, created_by_name: user.name, created_at: iso(nowMs),
    });
    await insertMany(db, 'purchase_order_items', lines.map(l => ({
      po_id: po.id, product_id: l.product.id, product_name: l.product.name,
      qty: l.qty, received_qty: 0, unit_cost: l.unitCost, total: money(l.qty * l.unitCost),
    })));
    const total = money(lines.reduce((a, l) => a + l.qty * l.unitCost, 0));
    return { message: 'Purchase order ' + po.legacy_id + ' raised (' + lines.length + ' line' + (lines.length > 1 ? 's' : '') + ', ' + fmtMoney(total) + ' ' + currencyOf(vendor) + ').', id: po.id, legacy_id: po.legacy_id };
  },

  /** The delivery arrives. `receipts` is [{ item_id, qty }]; a line left out receives nothing,
      so "twenty-eight of the forty came" is one call with one line in it.

      Trips: the order (2), the products (1), then per line the stock change (2-3) and its
      top-up write. Bounded by the number of lines on the order, which is a person's typing. */
  receivePurchaseOrder: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const vendorId = requireVendorUser(user);
    const po = await mustOrder(db, vendorId, args.id);
    if (po.status !== 'ordered') throw badRequest('Oda hiyo tayari ni ' + po.status + '. / That order is already ' + po.status + '.');

    const asked = Array.isArray(args.receipts) ? args.receipts : null;
    /* No list at all means "everything that is still owed arrived", which is the common case and
       should not require the screen to send a line per product to say so. */
    const plan = [];
    for (const it of po.items) {
      const owed = Math.max(0, it.qty - it.received_qty);
      let take = owed;
      if (asked) {
        const named = asked.find(r => String(r && r.item_id) === String(it.id));
        take = named ? int(named.qty) : 0;
      }
      if (take < 0) throw badRequest('Bidhaa zilizofika haziwezi kuwa hasi ("' + it.product_name + '"). / A delivery cannot be negative ("' + it.product_name + '").');
      if (take > owed) throw badRequest('"' + it.product_name + '": only ' + owed + ' still owed, but ' + take + ' entered. To take in more than was ordered, raise another order — otherwise the movements stop matching the paperwork.');
      if (take > 0) plan.push({ item: it, take });
    }
    if (!plan.length) throw badRequest('Hakuna cha kupokea. Andika zilizofika kweli. / Nothing to receive. Enter what actually arrived.');

    const ids = [...new Set(plan.map(p => String(p.item.product_id)))];
    const products = await rows(db, 'products', q => q.select(sel('products', PRODUCT_COLS)).in('id', ids).eq('vendor_id', vendorId).limit(500));
    for (const p of plan) {
      const product = products.find(x => String(x.id) === String(p.item.product_id));
      if (!product) throw notFound('"' + p.item.product_name + '" is no longer in your catalogue. Remove the line or restore the product.');
      /* A phone tracked by IMEI cannot arrive as a number -- each handset carries its own, and
         they go in under Stock & Shops where they can be typed. Saying so is better than
         silently inventing a count the units will then contradict. */
      if (product.is_serialized) {
        throw badRequest('"' + product.name + '" is tracked by IMEI, so a delivery of it is the IMEIs themselves. Add them under Stock & Shops, then mark this line received.');
      }
    }

    let taken = 0;
    for (const p of plan) {
      const product = products.find(x => String(x.id) === String(p.item.product_id));
      await changeStock(db, {
        product, delta: p.take, branchId: po.branch_id || null, type: 'received', user,
        note: 'Purchase order ' + (po.legacy_id || ''),
      }, nowMs);
      await update(db, 'purchase_order_items', { received_qty: p.item.received_qty + p.take }, q => q.eq('id', p.item.id));
      /* THE COST FOLLOWS THE DELIVERY. Otherwise cost_price is whatever somebody typed once,
         months ago, and every profit figure quietly drifts away from what the shop is really
         paying. A zero on the order means "no cost recorded", not "free", so it is left alone. */
      if (p.item.unit_cost > 0 && num(product.cost_price) !== p.item.unit_cost) {
        await update(db, 'products', { cost_price: p.item.unit_cost, updated_at: iso(nowMs) }, q => q.eq('id', product.id));
      }
      taken += p.take;
    }

    const stillOwed = po.items.reduce((a, i) => {
      const got = (plan.find(p => p.item.id === i.id) || { take: 0 }).take;
      return a + Math.max(0, i.qty - i.received_qty - got);
    }, 0);
    if (!stillOwed) {
      await update(db, 'purchase_orders', { status: 'received', closed_at: iso(nowMs), closed_by_name: user.name }, q => q.eq('id', po.id));
    }
    return {
      message: taken + ' item' + (taken === 1 ? '' : 's') + ' received into stock'
        + (stillOwed ? '. ' + stillOwed + ' still owed on ' + po.legacy_id + '.' : '. ' + po.legacy_id + ' is complete.'),
      closed: !stillOwed, outstanding: stillOwed,
    };
  },

  /** Called off. Nothing to undo unless something was already received, and then it is not a
      cancellation -- that stock is on the shelf and pretending otherwise would lose it. */
  cancelPurchaseOrder: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const vendorId = requireVendorUser(user);
    const po = await mustOrder(db, vendorId, args.id);
    if (po.status !== 'ordered') throw badRequest('Oda hiyo tayari ni ' + po.status + '. / That order is already ' + po.status + '.');
    const got = po.items.reduce((a, i) => a + i.received_qty, 0);
    if (got) throw badRequest(got + ' item' + (got === 1 ? ' has' : 's have') + ' already been received on ' + po.legacy_id
      + '. Receive the rest, or adjust the stock down under Stock & Shops — cancelling now would leave stock on the shelf that nothing accounts for.');
    await update(db, 'purchase_orders', {
      status: 'cancelled', closed_at: iso(nowMs), closed_by_name: user.name, cancel_reason: text(args.reason),
    }, q => q.eq('id', po.id));
    return { message: po.legacy_id + ' cancelled.' };
  },

  /** Raised in error, nothing received: it goes, lines and all. A cancelled order is history;
      one raised by mistake is noise, and a screen full of noise stops being read. */
  deletePurchaseOrder: async (db, user, args) => {
    requireAdmin(user);
    const vendorId = requireVendorUser(user);
    const po = await mustOrder(db, vendorId, args.id);
    const got = po.items.reduce((a, i) => a + i.received_qty, 0);
    if (got) throw badRequest('Something was received on ' + po.legacy_id + ', so it is a record now and stays.');
    await remove(db, 'purchase_order_items', q => q.eq('po_id', po.id));
    await remove(db, 'purchase_orders', q => q.eq('id', po.id));
    return { message: po.legacy_id + ' deleted.' };
  },
};

export const WRITES = ['createPurchaseOrder', 'receivePurchaseOrder', 'cancelPurchaseOrder', 'deletePurchaseOrder'];
