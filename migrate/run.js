// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node migrate/run.js <folder-with-csvs> [--dry-run] [--only=users,products,...]
//
// The nine Google Sheets tabs of the Apps Script Business Operator, exported one CSV each
// (Sheets -> File -> Download -> CSV) into one folder:
//
//   Users.csv  ProductsDB.csv  Sales.csv  Lendings.csv  CashTracking.csv
//   Settings.csv  Hints.csv  ProductClicks.csv  Suggestions.csv
//
// Runs in the order the foreign keys need (vendors <- users <- products <- sales ...), keeps
// every old identifier in a legacy_* column, hashes the plaintext passwords ONCE so nobody has
// to reset, and prints a count per table at the end to check against the sheets. Safe to run
// twice: rows are matched on their legacy identifiers and skipped when already present.
//
// --dry-run parses everything, prints the counts, writes nothing.
// The CSV folder must be git-ignored (legacy/data/ is): Users.csv carries plaintext passwords.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { createClient } from '@supabase/supabase-js';
import { hashPassword } from '../api/_lib/password.js';

const [, , dir, ...flags] = process.argv;
const DRY = flags.includes('--dry-run');
const ONLY = (flags.find(f => f.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
if (!dir) { console.error('Usage: node migrate/run.js <folder-with-csvs> [--dry-run] [--only=users,products]'); process.exit(1); }
if (!DRY && (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Supabase -> Project Settings -> API), or pass --dry-run.');
  process.exit(1);
}
const db = DRY ? null : createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

/* ------------------------------------------------------------------ reading a sheet */
const norm = h => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
function sheet(name) {
  const file = ['.csv', '.CSV'].map(ext => path.join(dir, name + ext)).find(f => fs.existsSync(f));
  if (!file) { console.log(`  (no ${name}.csv -- skipped)`); return []; }
  const rows = parse(fs.readFileSync(file, 'utf8'), { skip_empty_lines: true, relax_column_count: true, bom: true });
  if (!rows.length) return [];
  const header = rows[0].map(norm);
  return rows.slice(1).map(r => { const o = {}; header.forEach((h, i) => { o[h] = (r[i] == null ? '' : String(r[i])).trim(); }); return o; });
}
const yes = v => /^(yes|true|1)$/i.test(String(v || '').trim());
const num = v => { const n = Number(String(v == null ? '' : v).replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : 0; };
/** Sheets dates: '2026-08-01 14:03:00', '8/1/2026 14:03', a bare ISO, or a serial number. */
function when(v, dflt) {
  const s = String(v || '').trim();
  if (!s) return dflt || null;
  if (/^\d+(\.\d+)?$/.test(s)) return new Date(Math.round((Number(s) - 25569) * 86400000)).toISOString();   // a Sheets serial
  let t = Date.parse(s);
  if (!Number.isFinite(t)) { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/.exec(s); if (m) t = Date.parse(m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0') + (m[4] ? 'T' + m[4].trim() : 'T00:00:00') + '+03:00'); }
  if (!Number.isFinite(t)) { console.log('   ! unreadable date "' + s + '" -> ' + (dflt || 'null')); return dflt || null; }
  return new Date(t).toISOString();
}

/* ------------------------------------------------------------------ writing */
async function existing(table, cols) {
  if (DRY) return [];
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(table + ': ' + error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
async function insertAll(table, list) {
  if (!list.length) return 0;
  if (DRY) return list.length;
  let n = 0;
  for (let i = 0; i < list.length; i += 500) {
    const slice = list.slice(i, i + 500);
    const { error } = await db.from(table).insert(slice);
    if (error) throw new Error(`Insert into ${table} failed at row ${i}: ${error.message}`);
    n += slice.length;
    process.stdout.write(`\r  ${table}: ${n}/${list.length}`);
  }
  process.stdout.write('\n');
  return n;
}
const want = k => !ONLY.length || ONLY.includes(k);
const counts = {};

/* ------------------------------------------------------------------ 1. vendors + users */
console.log('Reading ' + dir);
const users = sheet('Users');
const settingsRows = sheet('Settings');
const setting = new Map(settingsRows.map(r => [r.key, r.value]));

const vendorByName = new Map();       // legacy vendor string -> uuid
const profileByHandle = new Map();    // legacy UserID (lower) -> uuid

if (want('users')) {
  console.log('\n1. Vendors (from admin rows) and users');
  const haveV = await existing('vendors', 'id, legacy_name');
  for (const v of haveV) vendorByName.set(v.legacy_name, v.id);
  const newVendors = [];
  for (const u of users) {
    const name = u.vendor, role = u.role.toLowerCase();
    if (!name || role !== 'admin' || vendorByName.has(name) || newVendors.some(v => v.legacy_name === name)) continue;
    let perms = {};
    try { perms = JSON.parse(setting.get('permissions_' + name) || '{}'); } catch { perms = {}; }
    newVendors.push({
      id: randomUUID(), legacy_name: name, name,
      business_type: u.businesstype || null, phone: u.phone || null, address: u.address || null,
      currency: (setting.get('currency_' + name) || 'TZS').toUpperCase(),
      logo_url: setting.get('logo_' + name) || null,
      registered_on: when(u.registeredon, new Date().toISOString()),
      active: yes(u.active), restricted: yes(setting.get('restricted_' + name)), permissions: perms,
    });
  }
  // A seller whose vendor has no admin row still needs a vendor to belong to.
  for (const u of users) {
    const name = u.vendor;
    if (name && !vendorByName.has(name) && !newVendors.some(v => v.legacy_name === name)) {
      newVendors.push({ id: randomUUID(), legacy_name: name, name, currency: (setting.get('currency_' + name) || 'TZS').toUpperCase(), registered_on: new Date().toISOString(), active: true, restricted: yes(setting.get('restricted_' + name)), permissions: {} });
    }
  }
  for (const v of newVendors) vendorByName.set(v.legacy_name, v.id);
  counts.vendors = await insertAll('vendors', newVendors);

  const haveP = await existing('profiles', 'id, handle, email');
  for (const p of haveP) profileByHandle.set(String(p.handle).toLowerCase(), p.id);
  const seenEmail = new Set(haveP.map(p => String(p.email).toLowerCase()));
  const newProfiles = [];
  for (const u of users) {
    const handle = u.userid, email = (u.email || '').toLowerCase();
    if (!handle) { console.log('   ! skipped a user row with no UserID: ' + JSON.stringify(u).slice(0, 80)); continue; }
    if (profileByHandle.has(handle.toLowerCase())) continue;
    if (!email || seenEmail.has(email)) { console.log('   ! ' + handle + ': ' + (email ? 'duplicate email ' + email : 'no email') + ' -- given a placeholder'); }
    const finalEmail = (email && !seenEmail.has(email)) ? email : (handle.toLowerCase().replace(/[^a-z0-9]/g, '') + '@no-email.business-operator.local');
    seenEmail.add(finalEmail);
    const role = ['seller', 'admin', 'assistant-admin', 'manager', 'assistant-manager'].includes(u.role.toLowerCase()) ? u.role.toLowerCase() : 'seller';
    const pw = u.password ? hashPassword(u.password) : { hash: null, salt: null };
    const row = {
      id: randomUUID(), email: finalEmail, name: u.name || handle, handle, role,
      vendor_id: u.vendor ? (vendorByName.get(u.vendor) || null) : null,
      active: yes(u.active), profile_photo_url: u.profilephoto || null,
      password_hash: pw.hash, password_salt: pw.salt,
    };
    profileByHandle.set(handle.toLowerCase(), row.id);
    newProfiles.push(row);
  }
  counts.profiles = await insertAll('profiles', newProfiles);
} else {
  for (const v of await existing('vendors', 'id, legacy_name')) vendorByName.set(v.legacy_name, v.id);
  for (const p of await existing('profiles', 'id, handle')) profileByHandle.set(String(p.handle).toLowerCase(), p.id);
}
const vendorId = name => vendorByName.get(String(name || '').trim()) || null;
const profileId = handle => profileByHandle.get(String(handle || '').trim().toLowerCase()) || null;

/* ------------------------------------------------------------------ 2. products */
const productKey = (vendor, pid) => (vendorId(vendor) || '') + '|' + String(pid).trim();
const productByKey = new Map();
if (want('products')) {
  console.log('\n2. Products');
  for (const p of await existing('products', 'id, vendor_id, legacy_id')) productByKey.set(p.vendor_id + '|' + p.legacy_id, p.id);
  const list = [];
  for (const r of sheet('ProductsDB')) {
    if (!r.productid) continue;
    const vid = vendorId(r.vendor);
    if (!vid) { console.log('   ! product ' + r.productid + ' has vendor "' + r.vendor + '" that no user row names -- skipped'); continue; }
    const key = vid + '|' + r.productid;
    if (productByKey.has(key)) continue;
    const row = {
      id: randomUUID(), vendor_id: vid, legacy_id: r.productid, name: r.name || r.productid, category: r.category || null,
      price: num(r.price), stock: Math.round(num(r.stock)), supplier: r.supplier || null, reorder_point: Math.round(num(r.reorderpoint)) || 20,
      active: r.active === '' ? true : yes(r.active), image1_url: r.image1 || null, image2_url: r.image2 || null,
      listing_type: /^rent$/i.test(r.listingtype) ? 'Rent' : 'Sale', price_unit: r.priceunit || null, location: r.location || null,
    };
    productByKey.set(key, row.id);
    list.push(row);
  }
  counts.products = await insertAll('products', list);
} else {
  for (const p of await existing('products', 'id, vendor_id, legacy_id')) productByKey.set(p.vendor_id + '|' + p.legacy_id, p.id);
}
const productId = (vendor, pid) => productByKey.get(productKey(vendor, pid)) || null;

/* ------------------------------------------------------------------ 3. sales */
if (want('sales')) {
  console.log('\n3. Sales');
  const have = new Set((await existing('sales', 'vendor_id, legacy_id')).map(s => s.vendor_id + '|' + s.legacy_id));
  const groups = new Map();
  const list = [];
  for (const r of sheet('Sales')) {
    if (!r.saleid) continue;
    const vid = vendorId(r.vendor);
    if (!vid || have.has(vid + '|' + r.saleid)) continue;
    const gid = r.groupid || randomUUID();
    if (!groups.has(gid)) groups.set(gid, /^[0-9a-f-]{36}$/i.test(gid) ? gid : randomUUID());
    const qty = Math.round(num(r.qty)) || 1, price = num(r.price), total = r.total === '' ? qty * price : num(r.total);
    list.push({
      id: randomUUID(), legacy_id: r.saleid, group_id: groups.get(gid), vendor_id: vid, seller_id: profileId(r.sellerid),
      seller_name: (users.find(u => u.userid === r.sellerid) || {}).name || r.sellerid,
      product_id: productId(r.vendor, r.productid), product_name: r.productname || r.productid,
      qty, list_price: price, discount: 0, price, total,
      payment_method: /lipa/i.test(r.paymentmethod) ? 'Lipa Number' : 'Cash',
      status: 'completed', sold_at: when(r.timestamp, new Date().toISOString()),
    });
  }
  counts.sales = await insertAll('sales', list);
}

/* ------------------------------------------------------------------ 4. lendings */
if (want('lendings')) {
  console.log('\n4. Lendings');
  const have = new Set((await existing('lendings', 'vendor_id, legacy_id')).map(l => l.vendor_id + '|' + l.legacy_id));
  const headers = new Map(), items = [];
  for (const r of sheet('Lendings')) {
    if (!r.lendingid) continue;
    const vid = vendorId(r.vendor);
    if (!vid || have.has(vid + '|' + r.lendingid)) continue;
    const key = vid + '|' + r.lendingid;
    if (!headers.has(key)) {
      headers.set(key, {
        id: randomUUID(), legacy_id: r.lendingid, vendor_id: vid, borrower_name: r.borrowername || '(unknown)', borrower_email: r.borroweremail || null,
        borrower_phone: r.borrowerphone || null, recorded_by: profileId(r.adminid), recorded_by_name: r.adminname || null,
        status: /returned/i.test(r.status) ? 'Returned' : 'Active', return_date: when(r.returndate, null), created_at: when(r.timestamp, new Date().toISOString()),
      });
    }
    const h = headers.get(key), qty = Math.round(num(r.qty)) || 1, price = num(r.price);
    items.push({ id: randomUUID(), lending_id: h.id, product_id: productId(r.vendor, r.productid), product_name: r.productname || r.productid, qty, price, total: r.total === '' ? qty * price : num(r.total) });
  }
  counts.lendings = await insertAll('lendings', [...headers.values()]);
  counts.lending_items = await insertAll('lending_items', items);
}

/* ------------------------------------------------------------------ 5. cash, clicks, suggestions, hints, settings */
if (want('cash')) {
  console.log('\n5. Cash receipts');
  const list = sheet('CashTracking').filter(r => r.timestamp).map(r => ({
    id: randomUUID(), vendor_id: vendorId(r.vendor), seller_id: profileId(r.sellerid), cash_amount: num(r.cashamount), lipa_amount: num(r.lipaamount), received_at: when(r.timestamp, new Date().toISOString()),
  })).filter(r => r.vendor_id);
  counts.cash_receipts = await insertAll('cash_receipts', list);
}
if (want('clicks')) {
  console.log('\n6. Product clicks');
  const list = sheet('ProductClicks').filter(r => r.productid).map(r => ({ product_id: productId(r.vendor, r.productid), vendor_id: vendorId(r.vendor), clicked_at: when(r.timestamp, new Date().toISOString()) })).filter(r => r.product_id);
  counts.product_clicks = await insertAll('product_clicks', list);
}
if (want('suggestions')) {
  console.log('\n7. Suggestions');
  const list = sheet('Suggestions').filter(r => r.message).map(r => ({ id: randomUUID(), profile_id: profileId(r.userid), user_name: r.username || null, vendor_id: vendorId(r.vendor), category: r.category || 'General', message: r.message, created_at: when(r.timestamp, new Date().toISOString()) }));
  counts.suggestions = await insertAll('suggestions', list);
}
if (want('hints')) {
  console.log('\n8. Hints');
  const have = new Set((await existing('hints', 'role, message_en')).map(h => h.role + '|' + h.message_en));
  const list = sheet('Hints').filter(r => r.role && r.message && !have.has(r.role + '|' + r.message)).map((r, i) => ({ id: randomUUID(), role: r.role.toLowerCase(), message_en: r.message, message_sw: r.swmessage || null, active: true, sort: i }));
  counts.hints = await insertAll('hints', list);
}
if (want('settings')) {
  console.log('\n9. Global settings');
  const GLOBAL = ['FreeRegistration', 'commissionRate', 'trialDays', 'hintLifetime', 'hintInterval', 'loadingTime', 'autoSyncSeconds', 'sessionTimeoutMinutes', 'paymentReminderText', 'lendingReminderText', 'announcement_enabled', 'announcement_title', 'announcement_text', 'announcement_audience', 'announcement_version'];
  const list = settingsRows.filter(r => GLOBAL.includes(r.key)).map(r => ({ key: r.key, value: r.value }));
  if (!DRY && list.length) { const { error } = await db.from('settings').upsert(list, { onConflict: 'key' }); if (error) throw new Error('settings: ' + error.message); }
  counts.settings = list.length;
}

/* ------------------------------------------------------------------ done */
console.log('\n' + (DRY ? 'DRY RUN -- nothing written. Would insert:' : 'Inserted:'));
for (const [k, v] of Object.entries(counts)) console.log('  ' + k.padEnd(16) + v);
if (!DRY) {
  console.log('\nNow in the database:');
  for (const t of ['vendors', 'profiles', 'products', 'sales', 'lendings', 'lending_items', 'cash_receipts', 'product_clicks', 'suggestions', 'hints']) {
    const { count } = await db.from(t).select('*', { count: 'exact', head: true });
    console.log('  ' + t.padEnd(16) + count);
  }
  console.log('\nCheck these against the sheets (rows minus the header), then delete the CSV folder: Users.csv holds plaintext passwords.');
}
