import { rowsAll, one, insertOne, rpcOr, getSettings, num, int, iso, currencyOf, mustText, badRequest } from './_shared.js';
import { hintsForRole } from './hints.js';

/* =====================================================================================
   MARKET -- the PUBLIC marketplace: no sign-in. See docs/API-CONTRACT.md ("market").
   =====================================================================================
   This is the storefront the street QR codes land on, so it is the one screen that has no
   session, no vendor scope and no user: every product of every active, unrestricted vendor,
   ranked the way the Apps Script getMarketplaceData ranked them (FEATURES_LIBRARY E3):

     1. HARD TIER first -- an item you can actually buy outranks one you cannot, whatever its
        popularity (in stock + clicks > in stock, no clicks > out of stock).
     2. RECENCY-WEIGHTED popularity inside a tier -- a click in the last 30 days counts three
        times an older one, so last year's hit does not sit on top of this month's arrival.
     3. A RANDOM slot for the ties -- a brand-new product with no clicks is rotated among its
        peers instead of being buried in insertion order forever (the cold-start fix).

   THE COST. Cold: products (1, paged) + vendors (1) + click counts (1 RPC, or 1 paged read
   of product_clicks when the function is not installed yet) + hints (1) + settings (1) = 5
   round trips. Warm: 0 -- the whole answer is cached per client for a minute, so a burst of
   visitors scanning the same QR code costs the database one build. `click` is the only public
   write and costs 2 (one product look-up for its vendor_id, one insert). */

const CACHE_MS = 60 * 1000;
const RECENT_MS = 30 * 86400000;              // legacy cutoff: 2592000000 ms = 30 days
const VENDOR_COLS = 'id, name, business_type, phone, address, currency, logo_url';
const PRODUCT_COLS = 'id, vendor_id, legacy_id, name, category, brand, model, price, stock, image1_url, image2_url, listing_type, price_unit, location';

/* One cache per database client (WeakMap so a test's throwaway fake does not pin memory).
   The entry keeps the PROMISE, not just the answer: two visitors arriving together on a cold
   cache share one build instead of both paying for it. A click deliberately does NOT bust it --
   popularity may lag a minute, exactly as the legacy 120-second CacheService did, and that is
   a fair price for a storefront that never stampedes its database. */
const cache = new WeakMap();
export function clearMarketCache(db) { if (db) cache.delete(db); }

/** The two hint timings as numbers, with the legacy fallbacks (parseInt(...) || 5 / 300). */
function hintTimings(settings) {
  return { hintLifetime: int(settings.hintLifetime) || 5, hintInterval: int(settings.hintInterval) || 300 };
}

/** product_id -> { total, recent } for every product ever clicked, plus the grand total.
    The RPC (bo_click_counts) is a GROUP BY the database does in one pass; the fallback is the
    legacy unbounded scan of the whole click log -- kept only so a deployment that has not run
    db/schema.sql yet still has a marketplace, and the RPC is the fix for its cost. */
async function clickCounts(db, nowMs) {
  const cutoffMs = nowMs - RECENT_MS;
  const list = await rpcOr(db, 'bo_click_counts', { p_since: iso(cutoffMs) }, async () => {
    const byProduct = new Map();
    const log = await rowsAll(db, 'product_clicks', q => q.select('product_id, clicked_at'));
    for (const c of log) {
      const pid = String(c.product_id || '');
      if (!pid) continue;
      const r = byProduct.get(pid) || { product_id: pid, total: 0, recent: 0 };
      r.total += 1;
      const t = Date.parse(c.clicked_at);
      if (Number.isFinite(t) && t >= cutoffMs) r.recent += 1;
      byProduct.set(pid, r);
    }
    return [...byProduct.values()];
  });
  const counts = new Map();
  let totalClicks = 0;
  for (const r of (Array.isArray(list) ? list : [])) {
    const pid = String(r.product_id || '');
    if (!pid) continue;
    const total = num(r.total), recent = Math.min(num(r.recent), total);
    counts.set(pid, { total, recent });
    totalClicks += total;
  }
  return { counts, totalClicks };
}

async function buildMarket(db, nowMs) {
  // Vendors first: they are the gate. A restricted or inactive vendor is simply not in this
  // map, and every product whose vendor is missing from it falls off the page -- the same join
  // the marketplace_products view does, done here because the fake has no views.
  const vendors = await rowsAll(db, 'vendors', q => q.select(VENDOR_COLS).eq('active', true).eq('restricted', false).order('name', { ascending: true }));
  const vmap = new Map(vendors.map(v => [String(v.id), v]));
  const products = await rowsAll(db, 'products', q => q.select(PRODUCT_COLS).eq('active', true));
  const { counts, totalClicks } = await clickCounts(db, nowMs);
  // The average is over every product that has EVER been clicked, on the page or not -- what
  // the legacy clickMap keys gave it. A product is "hot" when it has at least its share.
  const avgClicks = counts.size ? totalClicks / counts.size : 0;

  const ranked = [];
  for (const p of products) {
    const v = vmap.get(String(p.vendor_id));
    if (!v) continue;
    const c = counts.get(String(p.id)) || { total: 0, recent: 0 };
    const stock = num(p.stock);
    const pop = c.recent * 3 + (c.total - c.recent);
    const tier = stock > 0 ? (pop > 0 ? 3 : 2) : 1;
    const score = tier * 1000000 + pop * 1000 + Math.floor(Math.random() * 1000);
    ranked.push({ score, row: {
      id: String(p.id), name: String(p.name || ''), cat: String(p.category || ''), brand: String(p.brand || ''), model: String(p.model || ''),
      price: num(p.price), stock,
      vendor: String(v.name || ''), vendor_id: String(v.id),
      image1: String(p.image1_url || ''), image2: String(p.image2_url || ''),
      currency: currencyOf(v), vendorPhone: String(v.phone || ''), vendorType: String(v.business_type || ''),
      listingType: String(p.listing_type || '').trim() === 'Rent' ? 'Rent' : 'Sale',
      priceUnit: String(p.price_unit || ''), location: String(p.location || ''),
      clicks: c.total, hot: c.total > 0 && avgClicks > 0 && c.total >= avgClicks,
    } });
  }
  ranked.sort((a, b) => b.score - a.score);

  const hints = await hintsForRole(db, 'marketplace');
  const settings = await getSettings(db, ['hintLifetime', 'hintInterval']);
  return {
    products: ranked.map(r => r.row),
    // `admin` stays '' on purpose: the page never draws it and looking it up is a whole extra
    // read of profiles for nothing. The field is kept so the payload shape matches the legacy.
    vendors: vendors.map(v => ({
      id: String(v.id), name: String(v.name || ''), admin: '', logo: String(v.logo_url || ''),
      businessType: String(v.business_type || ''), phone: String(v.phone || ''), address: String(v.address || ''), currency: currencyOf(v),
    })),
    avgClicks, totalClicks, hints, timings: hintTimings(settings),
  };
}

export const FN = {
  /** The whole storefront, ranked; one build a minute per client, everybody else rides on it. */
  async market(db, args, nowMs) {
    const hit = cache.get(db);
    if (hit && nowMs >= hit.at && nowMs - hit.at < CACHE_MS) return hit.promise;
    const promise = buildMarket(db, nowMs);
    cache.set(db, { at: nowMs, promise });
    // A failed build must not be served for a minute: drop it so the next visitor retries.
    promise.catch(() => { if (cache.get(db) && cache.get(db).promise === promise) cache.delete(db); });
    return promise;
  },

  /** A product view. vendor_id is copied onto the row because the analytics count views per
      business without joining products, and a product can move or be deleted later. */
  async click(db, args, nowMs) {
    const id = mustText(args.product_id, 'product_id');
    const p = await one(db, 'products', q => q.select('id, vendor_id').eq('id', id));
    if (!p) throw badRequest('Product not found. / Bidhaa haipatikani.');
    await insertOne(db, 'product_clicks', { product_id: p.id, vendor_id: p.vendor_id, clicked_at: iso(nowMs) });
    return {};
  },

  /** The rotating visitor tips and how fast to rotate them -- what the landing page polls
      on its own, without paying for the whole market payload. */
  async hints(db) {
    const hints = await hintsForRole(db, 'marketplace');
    const settings = await getSettings(db, ['hintLifetime', 'hintInterval']);
    return { hints, timings: hintTimings(settings) };
  },
};

export async function marketApi(db, fn, args, nowMs = Date.now()) {
  const h = FN[fn];
  if (!h) { const e = new Error('Unknown marketplace function: ' + fn); e.status = 400; throw e; }
  return h(db, args || {}, nowMs);
}
export const MARKET_FUNCTIONS = Object.keys(FN);
