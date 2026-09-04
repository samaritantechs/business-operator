/* THE SPEED GUARD -- the same promise HOPE PMO keeps, written down as something that FAILS.
 *
 * ROUND TRIPS ARE THE UNIT. Each is a journey from the web server to the database and back,
 * 100 to 300 thousandths of a second on a good day; rows matter too, because a filtered
 * fetchAll costs one trip and can still drag a year of sales across the wire. So every screen
 * declares BOTH, on a book big enough that reading it carelessly shows up: thirty businesses,
 * thirty-six thousand sales, forty thousand stock movements.
 *
 * TWO NUMBERS PER SCREEN, because there are two live worlds: the database functions in
 * db/schema.sql (bo_vendor_sales_summary, bo_click_counts, bo_adjust_stock...) exist once the
 * file has been pasted into the SQL editor, and until then the same code pages rows and adds
 * them up itself. The pair keeps the slow path honest on a deployment that has not run the
 * schema yet, and makes the saving a fact rather than a claim.
 *
 * The budgets sit a little above what each screen costs today. They are a ceiling, not a
 * target: if a change needs more, ask "can the database do this instead of me?" first, and if
 * the answer is genuinely no, raise the number here IN THE SAME COMMIT so the cost is in the
 * diff and not on a phone in a shop. Run with SPEED_PRINT=1 to see the measured figures. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb, setPageCap } from './fake-db.mjs';
import { emptyBook, PASSWORD } from './_book.mjs';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
delete process.env.RESEND_API_KEY;
const { boApi } = await import('../api/_lib/bo-core.js');
const { marketApi, clearMarketCache } = await import('../api/_lib/bo/market.js');
const { accountApi } = await import('../api/_lib/bo/account.js');
const { hashPassword } = await import('../api/_lib/auth.js');

setPageCap(1000);                                          // the real PostgREST cap: paging shows up as trips
const NOW = Date.parse('2026-09-02T09:00:00Z');            // Wednesday noon EAT
const DAY = 86400000;
const iso = ms => new Date(ms).toISOString();
const VENDORS = 30, PRODUCTS = 150, SERIALIZED = 30, DAYS = 30, SALES_PER_DAY = 40;
const PW = hashPassword(PASSWORD);

/** A book big enough that a careless read shows. Deliberately modest per table -- this is
    about the SHAPE of the reads, and a wrong shape is wrong at any size. */
function bigBook() {
  const t = emptyBook();
  t.profiles.push({ id: 'MGR', email: 'm@x.tz', name: 'Manager', handle: 'mgr', role: 'manager', vendor_id: null, branch_id: null, active: true, password_hash: PW.hash, password_salt: PW.salt, created_at: iso(NOW - 400 * DAY) });
  t.sessions.push({ token: 'tok-mgr', profile_id: 'MGR', created_at: iso(NOW - DAY), expires_at: iso(NOW + 30 * DAY), last_seen_at: iso(NOW - DAY) });
  t.financing_partners.push({ id: 'FG', vendor_id: null, name: 'Watu', contact: '', active: true, created_at: iso(NOW - 100 * DAY) });
  let click = 0, mv = 0;
  for (let v = 1; v <= VENDORS; v++) {
    const V = 'V' + v, reg = iso(NOW - (20 + v * 7) * DAY);
    t.vendors.push({ id: V, legacy_name: 'Vendor ' + v, name: 'Vendor ' + v, business_type: 'Electronics', phone: '+2557000000' + v, address: 'Dar', currency: 'TZS', logo_url: null, registered_on: reg, active: true, restricted: false, permissions: { dashboardVisible: true, sellerCanDownloadReport: true }, created_at: reg });
    const BA = 'B' + v + 'a', BB = 'B' + v + 'b';
    t.branches.push({ id: BA, vendor_id: V, name: 'Shop A', location: 'A', active: true, created_at: reg }, { id: BB, vendor_id: V, name: 'Shop B', location: 'B', active: true, created_at: reg });
    t.financing_partners.push({ id: 'F' + v, vendor_id: V, name: 'MOGO ' + v, contact: '', active: true, created_at: reg });
    t.profiles.push({ id: 'A' + v, email: 'a' + v + '@x.tz', name: 'Admin ' + v, handle: 'a' + v, role: 'admin', vendor_id: V, branch_id: null, active: true, password_hash: PW.hash, password_salt: PW.salt, created_at: reg });
    for (let s = 1; s <= 3; s++) t.profiles.push({ id: 'S' + v + s, email: 's' + v + s + '@x.tz', name: 'Seller ' + v + '-' + s, handle: 's' + v + s, role: 'seller', vendor_id: V, branch_id: s === 3 ? BB : BA, active: true, password_hash: PW.hash, password_salt: PW.salt, created_at: reg });
    for (let k = 0; k < PRODUCTS; k++) {
      const P = 'P' + v + '_' + k, serial = k < SERIALIZED;
      t.products.push({ id: P, vendor_id: V, legacy_id: 'P' + String(k + 1).padStart(3, '0'), name: (serial ? 'Phone ' : 'Item ') + k, category: serial ? 'Phones' : 'Accessories', brand: serial ? 'Brand' + (k % 5) : '', model: serial ? 'M' + k : '', price: serial ? 250000 : 5000, stock: serial ? 3 : 20, is_serialized: serial, supplier: '', reorder_point: 5, active: true, image1_url: null, image2_url: null, listing_type: 'Sale', price_unit: '', location: '', created_at: reg });
      if (serial) {
        for (let n = 0; n < 3; n++) {
          const U = 'U' + v + '_' + k + '_' + n;
          t.product_units.push({ id: U, product_id: P, vendor_id: V, branch_id: BA, imei: String(35000000000000 + v * 10000 + k * 10 + n), serial_no: null, status: 'in_stock', received_at: reg });
          t.stock_movements.push({ id: 'M' + (mv++), vendor_id: V, product_id: P, product_name: 'Phone ' + k, unit_id: U, imei: null, type: 'received', qty: 1, to_branch_id: BA, by_user: 'A' + v, by_name: 'Admin ' + v, created_at: reg });
        }
      } else {
        t.branch_stock.push({ product_id: P, branch_id: BA, qty: 12 }, { product_id: P, branch_id: BB, qty: 8 });
        t.stock_movements.push({ id: 'M' + (mv++), vendor_id: V, product_id: P, product_name: 'Item ' + k, type: 'received', qty: 20, to_branch_id: BA, by_user: 'A' + v, by_name: 'Admin ' + v, created_at: reg });
      }
      if (k % 5 === 0) for (let c = 0; c < (k % 3) + 1; c++) t.product_clicks.push({ id: ++click, product_id: P, vendor_id: V, clicked_at: iso(NOW - (c * 11 + k) % 60 * DAY) });
    }
    let n = 0;
    for (let d = 0; d < DAYS; d++) {
      for (let i = 0; i < SALES_PER_DAY; i++, n++) {
        const seller = 'S' + v + ((i % 3) + 1), k = SERIALIZED + (n % (PRODUCTS - SERIALIZED)), P = 'P' + v + '_' + k;
        const soldAt = iso(NOW - d * DAY - (i % 8) * 3600000), pay = i % 7 === 0 ? 'Credit' : i % 3 === 0 ? 'Lipa Number' : 'Cash';
        const S = 'S' + v + '_' + n, qty = (i % 3) + 1, cancelled = n % 50 === 0;
        t.sales.push({ id: S, legacy_id: 'SALE-' + n, group_id: 'G' + v + '_' + n, vendor_id: V, branch_id: i % 3 === 2 ? BB : BA, seller_id: seller, seller_name: 'Seller', product_id: P, product_name: 'Item ' + k, brand: '', model: '', unit_id: null, imei: null, qty, list_price: 5000, discount: 0, price: 5000, total: 5000 * qty, payment_method: pay, financing_partner_id: pay === 'Credit' ? 'F' + v : null, partner_paid: false, status: cancelled ? 'cancelled' : 'completed', cancelled_by: cancelled ? 'A' + v : null, cancelled_by_name: cancelled ? 'Admin' : null, cancelled_at: cancelled ? soldAt : null, cancel_reason: cancelled ? 'x' : null, sold_at: soldAt });
        t.stock_movements.push({ id: 'M' + (mv++), vendor_id: V, product_id: P, product_name: 'Item ' + k, type: 'sold', qty, from_branch_id: BA, reference_sale_id: S, by_user: seller, by_name: 'Seller', created_at: soldAt });
      }
      t.cash_receipts.push({ id: 'C' + v + '_' + d, vendor_id: V, seller_id: 'S' + v + '1', cash_amount: 40000, lipa_amount: 10000, note: null, recorded_by: 'A' + v, received_at: iso(NOW - d * DAY + 3600000) });
    }
    for (let l = 0; l < 20; l++) {
      const L = 'L' + v + '_' + l, active = l < 10;
      t.lendings.push({ id: L, legacy_id: 'LEND-' + v + '-' + l, vendor_id: V, branch_id: null, borrower_name: 'Borrower ' + l, borrower_email: l % 2 ? 'b' + l + '@x.tz' : '', borrower_phone: '', recorded_by: 'A' + v, recorded_by_name: 'Admin ' + v, status: active ? 'Active' : 'Returned', return_date: active ? null : iso(NOW - l * DAY), created_at: iso(NOW - (l + 3) * DAY) });
      t.lending_items.push({ id: 'LI' + v + '_' + l, lending_id: L, product_id: 'P' + v + '_' + (SERIALIZED + l), product_name: 'Item ' + (SERIALIZED + l), unit_id: null, qty: 1, price: 5000, total: 5000 });
    }
  }
  for (let h = 0; h < 20; h++) t.hints.push({ id: 'H' + h, role: ['seller', 'admin', 'all', 'marketplace'][h % 4], message_en: 'Tip ' + h, message_sw: '', active: true, sort: h });
  t.sessions.push({ token: 'tok-a1', profile_id: 'A1', created_at: iso(NOW - DAY), expires_at: iso(NOW + 30 * DAY), last_seen_at: iso(NOW - DAY) });
  return t;
}

/* The database functions of db/schema.sql, as stand-ins over the fake's store. */
const RPCS = {
  bo_click_counts: (store, { p_since }) => {
    const m = new Map();
    for (const c of store.product_clicks.rows) { const r = m.get(c.product_id) || { product_id: c.product_id, total: 0, recent: 0 }; r.total++; if (c.clicked_at >= p_since) r.recent++; m.set(c.product_id, r); }
    return [...m.values()];
  },
  bo_vendor_sales_summary: (store, a) => {
    const m = new Map();
    for (const s of store.sales.rows) {
      if (s.status !== 'completed' || s.sold_at < a.p_year) continue;
      const r = m.get(s.vendor_id) || { vendor_id: s.vendor_id, today: 0, week: 0, month: 0, year: 0 };
      if (s.sold_at >= a.p_today) r.today += s.total; if (s.sold_at >= a.p_week) r.week += s.total; if (s.sold_at >= a.p_month) r.month += s.total; r.year += s.total;
      m.set(s.vendor_id, r);
    }
    return [...m.values()];
  },
  bo_adjust_stock: (store, a) => { const p = store.products.rows.find(x => x.id === a.p_product); p.stock = Number(p.stock) + Number(a.p_delta); return p.stock; },
  bo_adjust_branch_stock: (store, a) => {
    let r = store.branch_stock.rows.find(x => x.product_id === a.p_product && x.branch_id === a.p_branch);
    if (!r) { r = { product_id: a.p_product, branch_id: a.p_branch, qty: 0 }; store.branch_stock.rows.push(r); }
    r.qty = Number(r.qty) + Number(a.p_delta); return r.qty;
  },
  bo_recount_units: (store, a) => { const n = store.product_units.rows.filter(u => u.product_id === a.p_product && u.status === 'in_stock').length; const p = store.products.rows.find(x => x.id === a.p_product); if (p) p.stock = n; return n; },
  bo_stock_value_by_vendor: (store, a) => {
    const m = new Map();
    for (const p of store.products.rows) {
      if (!p.active || (a.p_vendor && p.vendor_id !== a.p_vendor)) continue;
      const r = m.get(p.vendor_id) || { vendor_id: p.vendor_id, value: 0, count: 0 };
      r.value += Number(p.price) * Number(p.stock); r.count += 1; m.set(p.vendor_id, r);
    }
    return [...m.values()];
  },
  bo_top_selling: (store, a) => {
    const m = new Map();
    for (const x of store.sales.rows) {
      if (x.status !== 'completed' || x.sold_at < a.p_since) continue;
      const k = x.product_name + '||' + x.vendor_id;
      const r = m.get(k) || { vendor_id: x.vendor_id, product_name: x.product_name, qty: 0, revenue: 0 };
      r.qty += Number(x.qty); r.revenue += Number(x.total); m.set(k, r);
    }
    return [...m.values()].sort((p, q) => q.qty - p.qty || q.revenue - p.revenue).slice(0, a.p_limit);
  },
};

/** Counts every request the code sends, exactly as fetchAll / rpcAll issue them: each answered
    page is a trip, and the rows it carried are rows. An RPC goes through the same wrapper. */
function counting(tables, opts) {
  const db0 = fakeDb(tables, opts);
  let trips = 0, rows = 0;
  const wrap = q => new Proxy(q, { get(o, p) {
    if (p === 'then') return (res, rej) => o.then(r => { trips++; if (Array.isArray(r.data)) rows += r.data.length; else if (r.data) rows += 1; return res(r); }, rej);
    const v = o[p];
    return typeof v === 'function' ? (...a) => { const out = v.apply(o, a); return out === o ? wrap(o) : out; } : v;
  } });
  return { db: { from: n => wrap(db0.from(n)), rpc: (n, a) => wrap(db0.rpc(n, a)), storage: db0.storage, _dump: n => db0._dump(n) },
           stat: () => ({ trips, rows }) };
}

const BOOK = bigBook();
const V1 = BOOK.vendors[0];
const MANAGER = { id: 'MGR', name: 'Manager', handle: 'mgr', email: 'm@x.tz', role: 'manager', vendor_id: null, branch_id: null, active: true, vendor: null, is_admin: false, is_manager: true };
const ADMIN = { id: 'A1', name: 'Admin 1', handle: 'a1', email: 'a1@x.tz', role: 'admin', vendor_id: 'V1', branch_id: null, active: true, vendor: { ...V1 }, is_admin: true, is_manager: false };
const SELLER = { id: 'S11', name: 'Seller 1-1', handle: 's11', email: 's11@x.tz', role: 'seller', vendor_id: 'V1', branch_id: 'B1a', active: true, vendor: { ...V1 }, is_admin: false, is_manager: false };
const MONTH = { start: '2026-08-03', end: '2026-09-02' };
const IMEIS = Array.from({ length: 10 }, (_, i) => ({ imei: String(36000000000000 + i) }));

/* screen, api, function, args, who, TRIPS, ROWS, TRIPS (schema functions in place), ROWS (idem)
   -- measured on this fixture with a little headroom. */
const BUDGETS = [
  ['Boot (admin)',                    'bo', 'boot',             {},                                   ADMIN,    7,     60,   7,    60],
  ['Boot (seller)',                   'bo', 'boot',             {},                                   SELLER,   7,     60,   7,    60],
  ['Boot (manager)',                  'bo', 'boot',             {},                                   MANAGER,  5,     40,   5,    40],
  ['Restriction poll (unrestricted)', 'bo', 'restrictionInfo',  {},                                   ADMIN,    0,      0,   0,     0],
  ['Dashboard (admin)',               'bo', 'dashboard',        {},                                   ADMIN,   10,   2000,   8,   600],
  ['Dashboard (seller)',              'bo', 'dashboard',        {},                                   SELLER,   4,    700,   4,   700],
  /* THE THREE THE GUARD CAUGHT. Every one of these read the whole of something to show a
     handful of numbers: the manager's two screens paged the entire catalogue of every business
     for two figures each, and analytics paged a YEAR of sales for a top ten. bo_stock_value_by_vendor
     and bo_top_selling (db/schema.sql) end all three -- 45 trips to 4. The left-hand pair is what
     a deployment that has not run the schema still pays, which is why the fallbacks stay. */
  ['Manager dashboard',               'bo', 'managerDashboard', {},                                   MANAGER, 50,  45000,   6,   300],
  ['Manager summary',                 'bo', 'managerSummary',   {},                                   MANAGER, 50,  45000,   7,   200],
  /* Analytics keeps 5,400 rows migrated: past 300 clicked products it pages the catalogue for
     their names rather than putting 900 ids in a URL (productsByIds). Bounded by the catalogue. */
  ['Analytics',                       'bo', 'analytics',        {},                                   MANAGER, 50,  45000,  10,  6000],
  ['Products (admin)',                'bo', 'products',         {},                                   ADMIN,    4,    400,   4,   400],
  ['Sell form options (seller)',      'bo', 'productOptions',   {},                                   SELLER,   6,    400,   6,   400],
  ['Recent sales',                    'bo', 'recentSales',      {},                                   ADMIN,    5,    100,   5,   100],
  ['Sales detail (month)',            'bo', 'salesDetail',      { period: 'month' },                  ADMIN,    5,    200,   5,   200],
  ['Sales detail (stock)',            'bo', 'salesDetail',      { period: 'stock' },                  ADMIN,    3,    250,   3,   250],
  ['Lendings',                        'bo', 'lendings',         {},                                   ADMIN,    4,    100,   4,   100],
  ['Cash receipts (today)',           'bo', 'cashReceipts',     {},                                   ADMIN,    4,     50,   4,    50],
  ['Users (admin)',                   'bo', 'users',            {},                                   ADMIN,    4,     50,   4,    50],
  ['Users (manager, everybody)',      'bo', 'users',            {},                                   MANAGER,  5,    300,   5,   300],
  ['Branch stock',                    'bo', 'branchStock',      {},                                   ADMIN,    6,    800,   6,   800],
  ['Units (IMEI list)',               'bo', 'units',            {},                                   ADMIN,    4,    200,   4,   200],
  ['Movements (30 days)',             'bo', 'movements',        MONTH,                                ADMIN,    4,   1300,   4,  1300],
  ['Sales report (month)',            'bo', 'reportData',       { type: 'sales', ...MONTH },          ADMIN,    6,   1500,   6,  1500],
  /* A report over a range must read that range: there is no honest way to list every line sold
     by thirty businesses in a month without the lines. Narrowed to its columns and its window. */
  ['Sales report (month, everybody)', 'bo', 'reportData',       { type: 'sales', ...MONTH, vendor_id: 'ALL' }, MANAGER, 45, 40000, 45, 40000],
  ['Stock report',                    'bo', 'reportData',       { type: 'stock' },                    ADMIN,    3,    250,   3,   250],
  ['Brand & model report',            'bo', 'reportData',       { type: 'brandmodel', ...MONTH },     ADMIN,    4,   1400,   4,  1400],
  /* Commission is one read per business on purpose: each has its OWN cycle start, anchored on
     registered_on, so thirty different cutoffs cannot be one GROUP BY. */
  ['Commission report (everybody)',   'bo', 'reportData',       { type: 'commission', ...MONTH, vendor_id: 'ALL' }, MANAGER, 45, 40000, 45, 40000],
  /* THE ONE UNBOUNDED READ LEFT, and it is deliberate: the storefront fetches the whole
     catalogue once, ranks it and filters by category in the browser, which is what makes the
     grid instant and why one build is cached a minute for every visitor behind it. At a few
     thousand products that is the right trade. Past that it is a bounded read with paging on
     the server, and this budget is where that will show up first. */
  ['Marketplace home',                'market', 'market',       {},                                   null,    13,   7000,  11,  6000],
  ['Marketplace hints',               'market', 'hints',        {},                                   null,     3,     50,   3,    50],
  ['Sign in',                         'account', 'login',       { id: 'a1', password: PASSWORD },     null,    11,     60,  11,    60],
  /* Writes: what a tap costs. A sale of three lines is three products read, three stock changes
     and three movements; without the atomic functions each stock change is a read AND a write. */
  ['Record sale (3 lines)',           'bo', 'recordSale',       { items: [{ product_id: 'P1_40', qty: 1, price: 5000 }, { product_id: 'P1_41', qty: 2, price: 5000 }, { product_id: 'P1_42', qty: 1, price: 5000 }], payment_method: 'Cash' }, SELLER, 32, 40, 20, 30],
  ['Record sale (phone, credit)',     'bo', 'recordSale',       { items: [{ product_id: 'P1_0', qty: 1, price: 250000, unit_ids: ['U1_0_0'] }], payment_method: 'Credit', financing_partner_id: 'F1' }, ADMIN, 14, 20, 12, 20],
  ['Cancel sale',                     'bo', 'cancelSale',       { sale_id: 'S1_1', reason: 'wrong item' }, ADMIN, 14, 20, 10, 20],
  ['Record lending',                  'bo', 'recordLending',    { items: [{ product_id: 'P1_43', qty: 1 }], borrower_name: 'B' }, SELLER, 14, 20, 10, 20],
  ['Add stock',                       'bo', 'addStock',         { product_id: 'P1_44', qty: 5 },      ADMIN,    8,     10,   6,    10],
  ['Add 10 units (IMEIs)',            'bo', 'addUnits',         { product_id: 'P1_1', units: IMEIS }, ADMIN,   20,     45,  18,    30],
  ['Transfer stock',                  'bo', 'transferStock',    { product_id: 'P1_45', from_branch_id: 'B1a', to_branch_id: 'B1b', qty: 2 }, ADMIN, 14, 20, 10, 20],
  ['Record cash',                     'bo', 'recordCash',       { seller_id: 'S11', cash_amount: 1000, lipa_amount: 0 }, ADMIN, 4, 10, 4, 10],
];

const WORLDS = [['schema functions not created yet', undefined, 5, 6], ['schema functions in place', RPCS, 7, 8]];
const PRINT = !!process.env.SPEED_PRINT;

for (const [world, rpc, ti, ri] of WORLDS) {
  for (const [screen, api, fn, args, who, ...b] of BUDGETS) {
    const trips = b[ti - 5], rows = b[ri - 5];
    test(`${screen} [${world}]: <= ${trips} round trips, <= ${rows} rows`, async () => {
      const { db, stat } = counting(BOOK, { rpc });
      clearMarketCache(db);
      let err = null;
      try {
        if (api === 'bo') await boApi(db, who, fn, args, NOW);
        else if (api === 'market') await marketApi(db, fn, args, NOW);
        else await accountApi(db, fn, args, NOW);
      } catch (e) { err = e; }
      const s = stat();
      if (PRINT) console.log(`${screen.padEnd(34)} ${world.padEnd(34)} trips=${String(s.trips).padStart(3)} rows=${String(s.rows).padStart(6)}${err ? '  ERROR ' + err.message : ''}`);
      assert.equal(err, null, screen + ' failed: ' + (err && (err.stack || err.message)));
      assert.ok(s.trips <= trips, `${screen}: ${s.trips} round trips, budget ${trips}`);
      assert.ok(s.rows <= rows, `${screen}: ${s.rows} rows, budget ${rows}`);
    });
  }
}
