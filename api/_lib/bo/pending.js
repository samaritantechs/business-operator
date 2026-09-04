import { rows, rowsAll, one, insertOne, insertMany, update, remove, num, int, money, fmtMoney, text, mustText, iso,
  badRequest, notFound, vendorScope, requireVendorUser, currencyOf, sel, PRODUCT_COLS } from './_shared.js';
import { requireAdmin } from '../auth.js';
import { changeStock, claimUnits } from './stock.js';
import { mustBranch, writeVendor } from './stockops.js';
import { FN as SALES } from './sales.js';

/* =====================================================================================
   PENDING SALES -- "hold the A05 for me, I'll come Friday".
   =====================================================================================
   The most ordinary sentence in a phone shop, and the system had no way to hear it. So the
   handset stayed on the shelf, somebody else bought it, and on Friday there was an argument.

   A hold RESERVES the goods, and it does so the honest way: through the same changeStock()
   everything else uses, as a 'reserved' movement out. That single decision does three things
   at once --

     products.stock becomes what is genuinely AVAILABLE, so the till simply cannot sell a
     reserved handset: the number is already gone. No new column to drift, and no extra read on
     the sell screen, which is the one screen that must never get slower.

     A serialized unit goes to status 'reserved' and stops appearing in the IMEI picker, because
     that picker already asks for 'in_stock' and always did.

     The movements report gains two types it can already draw, so "where is that phone" answers
     "held for Neema since Tuesday" instead of going quiet.

   COMPLETING one does not reimplement selling. The stock goes back ('unreserved') and then
   recordSale takes it from there, so every rule about stock, IMEIs, discounts, financing
   partners, receipts and cost snapshots is the rule that was already written. Three movements
   for one handset -- reserved, unreserved, sold -- is not noise; it is what happened to it.

   Nothing expires by itself. hold_until is what was AGREED, shown in red once it is past, and a
   person decides. A system that silently released somebody's phone because a date went by would
   be worse than the shelf. */

const PENDING_COLS = 'id, legacy_id, vendor_id, branch_id, customer_name, customer_phone, deposit, payment_method, '
  + 'financing_partner_id, notes, status, hold_until, created_by, created_by_name, created_at, closed_at, closed_by_name, '
  + 'cancel_reason, sale_group_id';
const ITEM_COLS = 'id, pending_id, product_id, product_name, unit_id, qty, list_price, discount, total';

async function nextLegacyId(db, vendorId) {
  const list = await rowsAll(db, 'pending_sales', q => q.select('legacy_id').eq('vendor_id', vendorId));
  let max = 0;
  for (const r of list) {
    const m = /^HOLD-(\d+)$/.exec(String(r.legacy_id || '').trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'HOLD-' + String(max + 1).padStart(4, '0');
}

/** Holds plus their lines. 2 reads: the headers, then every line at once. */
async function loadHolds(db, { vendorId, status, id, nowMs, limit = 200 }) {
  const heads = await rows(db, 'pending_sales', q => {
    let x = q.select(PENDING_COLS);
    if (id) x = x.eq('id', id);
    if (vendorId) x = x.eq('vendor_id', vendorId);
    if (status) x = x.eq('status', status);
    return x.order('created_at', { ascending: false }).limit(limit);
  });
  if (!heads.length) return [];
  const ids = heads.map(h => h.id);
  const items = await rowsAll(db, 'pending_sale_items', q => q.select(ITEM_COLS).in('pending_id', ids).order('id'));
  const byHold = new Map();
  for (const it of items) {
    const list = byHold.get(String(it.pending_id)) || [];
    list.push({ ...it, qty: num(it.qty), list_price: num(it.list_price), discount: num(it.discount), total: num(it.total) });
    byHold.set(String(it.pending_id), list);
  }
  const today = nowMs ? iso(nowMs).slice(0, 10) : null;
  return heads.map(h => {
    const list = byHold.get(String(h.id)) || [];
    const total = money(list.reduce((a, i) => a + i.total, 0));
    return {
      ...h, items: list, total, deposit: num(h.deposit), balance: money(total - num(h.deposit)),
      /* Overdue is said, never acted on. */
      overdue: !!(h.status === 'held' && h.hold_until && today && h.hold_until < today),
    };
  });
}

async function mustHold(db, vendorId, id, nowMs) {
  const [h] = await loadHolds(db, { vendorId, id: mustText(id, 'Hold'), nowMs });
  if (!h) throw notFound('Hifadhi hiyo si ya biashara yako. / That hold is not one of yours.');
  return h;
}

/** The held units, read once so every movement written about them carries its IMEI. A movement
    row with a blank IMEI is the one row that cannot answer "where is that phone". */
async function heldUnits(db, hold) {
  const ids = hold.items.map(i => i.unit_id).filter(Boolean);
  if (!ids.length) return new Map();
  const list = await rows(db, 'product_units', q => q.select('id, product_id, branch_id, imei, serial_no, status').in('id', ids));
  return new Map(list.map(u => [String(u.id), u]));
}

/* Puts the goods back on the shelf, and RETURNS what it actually put back -- the rollback below
   has to re-reserve exactly that and nothing else.

   Two things it deliberately does not do:

   It does not touch the handset's BRANCH. changeStock rewrites product_units.branch_id whenever
   toBranchId is passed at all, and this used to pass the HOLD's branch: a seller at Sinza taking
   a booking for a phone sitting in Kariakoo would, on release, teleport that phone to Sinza in
   the book while it stayed in the Kariakoo drawer -- and an admin with no branch would drop it
   out of every per-shop view entirely. Reserving never moved it, so releasing must not either.

   And it does not force a unit that is NOT reserved back into stock. Anything else -- a handset
   somebody sold, or marked lost -- would be resurrected by the release and sold a second time. */
async function release(db, hold, products, units, user, nowMs, note) {
  const done = [];
  for (const it of hold.items) {
    const product = products.find(p => String(p.id) === String(it.product_id));
    if (!product) continue;                 // the product was deleted; the count has nowhere to go
    if (product.is_serialized) {
      const unit = units.get(String(it.unit_id));
      if (!unit || unit.status !== 'reserved') continue;
      await changeStock(db, { product, delta: 1, unit, unitStatus: 'in_stock',
        type: 'unreserved', user, note, toBranchId: unit.branch_id || null }, nowMs);
      unit.status = 'in_stock';
    } else {
      await changeStock(db, { product, delta: it.qty, branchId: hold.branch_id || null, type: 'unreserved', user, note }, nowMs);
    }
    done.push(it);
  }
  return done;
}
/** And takes them back off it -- the rollback when a sale is refused, over exactly what release
    handed back. Re-reserving a line release skipped would take stock that was never held. */
async function reserve(db, hold, items, products, units, user, nowMs, note) {
  for (const it of items) {
    const product = products.find(p => String(p.id) === String(it.product_id));
    if (!product) continue;
    if (product.is_serialized) {
      const unit = units.get(String(it.unit_id));
      if (!unit) continue;
      await changeStock(db, { product, delta: -1, unit, unitStatus: 'reserved', type: 'reserved', user, note, fromBranchId: unit.branch_id || null }, nowMs);
      unit.status = 'reserved';
    } else {
      await changeStock(db, { product, delta: -it.qty, branchId: hold.branch_id || null, type: 'reserved', user, note }, nowMs);
    }
  }
}

export const FN = {
  /** The Holds screen. 2 reads. Any vendor role: a seller has to be able to see what is held
      before promising the same handset to somebody else. */
  pendingSales: async (db, user, args, nowMs) => {
    const vendorId = vendorScope(user, args);
    if (!vendorId) throw badRequest('Chagua biashara kuona zilizowekwa. / Pick a business to see its holds.');
    const status = text(args.status);
    if (status && !['held', 'completed', 'cancelled', 'expired'].includes(status)) throw badRequest('Hali iwe held, completed, cancelled au expired. / Status must be held, completed, cancelled or expired.');
    return { rows: await loadHolds(db, { vendorId, status, nowMs }), currency: currencyOf(user.vendor) };
  },

  /** Hold it. The stock leaves the available count now, which is the entire point.
      Trips: branch, products, legacy ids, insert head, insert lines, + the stock move per line. */
  createPendingSale: async (db, user, args, nowMs) => {
    const vendorId = requireVendorUser(user);
    const items = Array.isArray(args.items) ? args.items : [];
    if (!items.length) throw badRequest('Ongeza angalau bidhaa moja ya kuweka. / Add at least one item to hold.');
    /* A hold with nobody's name on it is missing stock, so unlike a sale the name is required. */
    const customerName = mustText(args.customer_name, 'Jina la mteja / The customer\u2019s name');
    const branch = await mustBranch(db, vendorId, args.branch_id) || (user.branch_id ? { id: user.branch_id } : null);
    const branchId = branch ? branch.id : null;

    const wanted = [...new Set(items.map(i => String((i && i.product_id) || '')))].filter(Boolean);
    const products = wanted.length ? await rows(db, 'products', q => q.select(sel('products', PRODUCT_COLS)).in('id', wanted).eq('vendor_id', vendorId).limit(500)) : [];

    /* Everything is checked before anything is written or moved, the same discipline recordSale
       keeps. A half-made hold is stock nobody can find. */
    const lines = [], asked = new Map(), seenUnits = new Set();
    const branchHave = new Map();          // product -> what THIS shop holds, read at most once each
    for (const it of items) {
      const p = products.find(x => String(x.id) === String(it && it.product_id));
      if (!p) throw notFound('Mojawapo ya bidhaa hizo haiko kwenye orodha yako. / One of those products is not in your catalogue.');
      if (!p.active) throw badRequest('"' + p.name + '" haiko hai. / "' + p.name + '" is not active.');
      const qty = int(it.qty);
      if (qty < 1) throw badRequest('Weka angalau 1 ya "' + p.name + '". / Hold at least 1 of "' + p.name + '".');
      const list = money(it.list_price === undefined || it.list_price === null || it.list_price === '' ? p.price : it.list_price);
      const discount = money(it.discount);
      if (discount < 0 || discount > list) throw badRequest('Discount for "' + p.name + '" must be between 0 and ' + fmtMoney(list) + '.');
      if (p.is_serialized) {
        const ids = (Array.isArray(it.unit_ids) ? it.unit_ids : []).map(String).filter(Boolean);
        if (ids.length !== qty) throw badRequest('"' + p.name + '": choose exactly ' + qty + ' IMEI/serial' + (qty > 1 ? 's' : '') + ' to hold (' + ids.length + ' chosen).');
        for (const id of ids) { if (seenUnits.has(id)) throw badRequest('Unit ' + id + ' is listed twice.'); seenUnits.add(id); }
        lines.push({ product: p, qty, list, discount, units: await claimUnits(db, p, ids) });
      } else {
        const soFar = (asked.get(p.id) || 0) + qty;
        asked.set(p.id, soFar);
        if (num(p.stock) < soFar) throw badRequest('Hakuna "' + p.name + '" ya kutosha kuweka. Zilizopo: ' + num(p.stock)
          + ' / Not enough "' + p.name + '" to hold. Available: ' + num(p.stock));
        /* AND THE SHOP IT IS HELD AT MUST ACTUALLY HOLD IT. recordSale carries this check with a
           comment describing exactly what happens without it -- a counter holding fifteen takes
           thirty off its own row and that row goes to MINUS fifteen, so the per-shop figures stop
           adding up to the business total. The hold path reserves through the same branchId and
           repeated only the business-wide half, which let the same negative in through a new
           door. One bounded read per product, cached, as the till does it. */
        if (branchId) {
          let have = branchHave.get(p.id);
          if (have === undefined) {
            const r = await one(db, 'branch_stock', q => q.select('qty').eq('product_id', p.id).eq('branch_id', branchId));
            have = num(r && r.qty);
            branchHave.set(p.id, have);
          }
          if (have < soFar) throw badRequest('"' + p.name + '" hazitoshi kwenye duka hili. Hapa: ' + have + ', biashara nzima: ' + num(p.stock)
            + ' / "' + p.name + '" is short at this shop. Here: ' + have + ', for the whole business: ' + num(p.stock) + '.');
        }
        lines.push({ product: p, qty, list, discount, units: null });
      }
    }

    const total = money(lines.reduce((a, l) => a + l.qty * (l.list - l.discount), 0));
    const deposit = money(args.deposit);
    if (deposit < 0) throw badRequest('Amana haiwezi kuwa hasi. / A deposit cannot be negative.');
    if (deposit > total) throw badRequest('Amana inazidi thamani ya bidhaa. Kamilisha kama mauzo badala yake. / The deposit is more than the goods are worth. Take the rest as a sale instead.');

    const hold = await insertOne(db, 'pending_sales', {
      legacy_id: await nextLegacyId(db, vendorId), vendor_id: vendorId, branch_id: branchId,
      customer_name: customerName, customer_phone: text(args.customer_phone), deposit,
      payment_method: text(args.payment_method), financing_partner_id: text(args.financing_partner_id),
      notes: text(args.notes), status: 'held', hold_until: text(args.hold_until),
      created_by: user.id, created_by_name: user.name, created_at: iso(nowMs),
    });
    const itemRows = [];
    for (const l of lines) {
      const line = { pending_id: hold.id, product_id: l.product.id, product_name: l.product.name, list_price: l.list, discount: l.discount };
      // one row per handset, as a sale does, because each is a different phone
      if (l.units) for (const u of l.units) itemRows.push({ ...line, unit_id: u.id, qty: 1, total: money(l.list - l.discount) });
      else itemRows.push({ ...line, unit_id: null, qty: l.qty, total: money(l.qty * (l.list - l.discount)) });
    }
    await insertMany(db, 'pending_sale_items', itemRows);

    // and only now does the stock move
    const note = 'Held for ' + customerName + ' (' + hold.legacy_id + ')';
    for (const l of lines) {
      if (l.units) {
        for (const u of l.units) {
          await changeStock(db, { product: l.product, delta: -1, unit: u, unitStatus: 'reserved', type: 'reserved', user, note, fromBranchId: u.branch_id || null }, nowMs);
        }
      } else {
        await changeStock(db, { product: l.product, delta: -l.qty, branchId, type: 'reserved', user, note }, nowMs);
      }
    }
    return { message: hold.legacy_id + ': ' + itemRows.length + ' item' + (itemRows.length > 1 ? 's' : '') + ' held for ' + customerName
      + ' (' + fmtMoney(total) + ' ' + currencyOf(user.vendor) + (deposit ? ', ' + fmtMoney(deposit) + ' deposit' : '') + ').', id: hold.id, legacy_id: hold.legacy_id };
  },

  /** They came back. The goods go on the shelf and straight out again as a sale, so nothing
      about selling is reimplemented here. */
  completePendingSale: async (db, user, args, nowMs) => {
    const vendorId = requireVendorUser(user);
    const hold = await mustHold(db, vendorId, args.id, nowMs);
    if (hold.status !== 'held') throw badRequest('Hifadhi hiyo tayari ni ' + hold.status + '. / That hold is already ' + hold.status + '.');
    const method = text(args.payment_method) || hold.payment_method;
    if (!method) throw badRequest('Analipaje? Cash, Lipa Number au Credit. / How are they paying? Cash, Lipa Number or Credit.');

    const ids = [...new Set(hold.items.map(i => String(i.product_id)))];
    const products = await rows(db, 'products', q => q.select(sel('products', PRODUCT_COLS)).in('id', ids).eq('vendor_id', vendorId).limit(500));
    const missing = hold.items.find(i => !products.some(p => String(p.id) === String(i.product_id)));
    if (missing) throw badRequest('"' + missing.product_name + '" is no longer in your catalogue, so this hold cannot be sold. Cancel it and the stock comes back.');
    const units = await heldUnits(db, hold);

    /* CLAIM THE HOLD BEFORE MOVING ANYTHING. Reading the status and writing it back afterwards is
       not a lock: two taps on "They collected it" -- and the button did not even disable itself --
       both read 'held', both released the stock, and both sold it. Four covers on the shelf became
       eight sold and receipted; a held handset was written into TWO completed sales.

       lendings.js already does it this way, and says why: "one whose update still finds it Active
       gets a row back, and the other must stop here". I wrote that and then did not apply it here.
       The flip goes FIRST, conditional on the hold still being held; whoever loses gets nothing
       back and stops before a single unit moves. */
    const claimed = await update(db, 'pending_sales',
      { status: 'completed', closed_at: iso(nowMs), closed_by_name: user.name },
      q => q.eq('id', hold.id).eq('status', 'held'));
    if (!claimed.length) throw badRequest('Hifadhi hiyo tayari imeshughulikiwa. / That hold has already been dealt with.');

    let released;
    try {
      released = await release(db, hold, products, units, user, nowMs, 'Sold from hold ' + hold.legacy_id);
    } catch (e) {
      // Same reasoning as the cancel path: a half-released hold that is already closed is stock
      // nothing in the app can reach.
      await update(db, 'pending_sales', { status: 'held', closed_at: null, closed_by_name: null }, q => q.eq('id', hold.id));
      throw e;
    }

    /* The sale is the ordinary sale, with the ordinary rules. If it refuses -- a product
       deactivated while the phone sat behind the counter, a financing partner withdrawn -- the
       goods go straight back on hold rather than being left loose on the shelf with a hold
       record still claiming them. */
    const saleItems = [];
    for (const p of products) {
      const mine = hold.items.filter(i => String(i.product_id) === String(p.id));
      if (!mine.length) continue;
      if (p.is_serialized) {
        /* One line per PRICE, not one per product. Collapsing every handset onto mine[0] charged
           them all at the first line's discount: a hold of two phones, one at full price and one
           with 50,000 off, was agreed at 650,000 and rung up at 700,000 -- and with the rows
           coming back unordered, which line won was whatever the database felt like. */
        const byPrice = new Map();
        for (const i of mine) {
          const key = num(i.list_price) + '|' + num(i.discount);
          const g = byPrice.get(key) || { price: num(i.list_price), discount: num(i.discount), unit_ids: [] };
          g.unit_ids.push(i.unit_id);
          byPrice.set(key, g);
        }
        for (const g of byPrice.values()) {
          saleItems.push({ product_id: p.id, qty: g.unit_ids.length, price: g.price, discount: g.discount, unit_ids: g.unit_ids });
        }
      } else {
        for (const i of mine) saleItems.push({ product_id: p.id, qty: i.qty, price: i.list_price, discount: i.discount });
      }
    }
    let sale;
    try {
      sale = await SALES.recordSale(db, user, {
        items: saleItems, payment_method: method,
        financing_partner_id: text(args.financing_partner_id) || hold.financing_partner_id || undefined,
        branch_id: hold.branch_id || undefined,
        customer_name: hold.customer_name, customer_phone: hold.customer_phone || undefined,
      }, nowMs);
    } catch (e) {
      /* The sale was refused after the goods came off hold -- a product deactivated while the
         phone sat behind the counter, a financing partner withdrawn. Put back exactly what was
         released, and hand the hold back to whoever is holding it, rather than leaving the goods
         loose on the shelf with a completed hold record still claiming them. */
      await reserve(db, hold, released, products, units, user, nowMs, 'Re-held: ' + hold.legacy_id + ' could not be sold');
      await update(db, 'pending_sales', { status: 'held', closed_at: null, closed_by_name: null }, q => q.eq('id', hold.id));
      throw e;
    }

    await update(db, 'pending_sales', { sale_group_id: sale.group_id }, q => q.eq('id', hold.id));
    return {
      message: hold.legacy_id + ' collected by ' + hold.customer_name + '. ' + sale.message,
      group_id: sale.group_id, grand_total: sale.grand_total,
      /* What is still to hand over the counter, deposit taken off. */
      balance_due: money(sale.grand_total - hold.deposit), deposit: hold.deposit,
    };
  },

  /** They never came, or changed their mind. The goods go back and the hold says why. */
  cancelPendingSale: async (db, user, args, nowMs) => {
    const vendorId = requireVendorUser(user);
    const hold = await mustHold(db, vendorId, args.id, nowMs);
    if (hold.status !== 'held') throw badRequest('Hifadhi hiyo tayari ni ' + hold.status + '. / That hold is already ' + hold.status + '.');
    const expired = args.expired === true || String(args.expired) === 'true';
    const ids = [...new Set(hold.items.map(i => String(i.product_id)))];
    const products = await rows(db, 'products', q => q.select(sel('products', PRODUCT_COLS)).in('id', ids).eq('vendor_id', vendorId).limit(500));
    // The same claim-before-you-move lock as collection: two taps must not put the stock back twice.
    const claimed = await update(db, 'pending_sales', {
      status: expired ? 'expired' : 'cancelled', closed_at: iso(nowMs), closed_by_name: user.name, cancel_reason: text(args.reason),
    }, q => q.eq('id', hold.id).eq('status', 'held'));
    if (!claimed.length) throw badRequest('Hifadhi hiyo tayari imeshughulikiwa. / That hold has already been dealt with.');
    /* AND IF THE RELEASE CANNOT FINISH, THE CLAIM MUST COME BACK. Closing the hold first is what
       makes the double-tap impossible, but it also means a hold that is closed while its second
       handset is still 'reserved' has no door left: both hold actions answer "already dealt
       with", and updateUnit refuses to touch a reserved unit. The stock would be stranded with
       nothing in the app able to free it. So a failed release hands the hold back. */
    try {
      await release(db, hold, products, await heldUnits(db, hold), user, nowMs, 'Released from hold ' + hold.legacy_id);
    } catch (e) {
      await update(db, 'pending_sales', { status: 'held', closed_at: null, closed_by_name: null, cancel_reason: null }, q => q.eq('id', hold.id));
      throw e;
    }
    return {
      message: hold.legacy_id + ' released — the stock is back on the shelf.'
        + (hold.deposit ? ' The ' + fmtMoney(hold.deposit) + ' deposit is not refunded by the system; settle that at the counter.' : ''),
      deposit: hold.deposit,
    };
  },
};

export const WRITES = ['createPendingSale', 'completePendingSale', 'cancelPendingSale'];
