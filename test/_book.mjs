/* THE SHARED FIXTURE: one populated Business Operator book every suite can open.

   Two vendors (one with branches and serialized phones, one plain grocery) plus a restricted
   one, a manager, an admin and sellers per vendor, products of both kinds, units, financing
   partners, a day of sales, lendings, a cash receipt, settings and hints. Every id is a readable
   string so a failing assertion names what it is looking at. Deliberately small: tests are about
   the SHAPE of reads and rules, not volume (test/speed.test.mjs builds its own big book). */
import { fakeDb } from './fake-db.mjs';
import { hashPassword } from '../api/_lib/auth.js';

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

export const NOW = Date.parse('2026-09-02T09:00:00Z');   // Wednesday 12:00 EAT
export const TODAY = '2026-09-02';
const D = TODAY;
/** An instant on TODAY at h:m East Africa Time, as ISO. */
export const T = (h, m) => new Date(Date.parse(D + 'T00:00:00+03:00') + h * 3600000 + (m || 0) * 60000).toISOString();

const PW = hashPassword('pass1234');
export const PASSWORD = 'pass1234';

export const TABLES = ['vendors', 'branches', 'profiles', 'sessions', 'password_resets', 'products', 'branch_stock',
  'product_units', 'financing_partners', 'sales', 'lendings', 'lending_items', 'cash_receipts', 'stock_movements',
  'settings', 'hints', 'product_clicks', 'suggestions', 'audit_log'];

export function emptyBook() {
  const t = {};
  for (const name of TABLES) t[name] = [];
  t.settings.push({ key: 'FreeRegistration', value: 'Yes' }, { key: 'commissionRate', value: '2' }, { key: 'trialDays', value: '60' },
    { key: 'hintLifetime', value: '5' }, { key: 'hintInterval', value: '300' }, { key: 'autoSyncSeconds', value: '120' },
    { key: 'sessionTimeoutMinutes', value: '0' }, { key: 'loadingTime', value: '0' });
  return t;
}

export function richBook() {
  const t = emptyBook();
  t.vendors.push(
    { id: 'V1', legacy_name: 'Fromville Phones', name: 'Fromville Phones', business_type: 'Electronics', phone: '+255 756 000 001',
      address: 'Sinza, Dar', currency: 'TZS', logo_url: null, registered_on: '2026-08-01T06:00:00.000Z', active: true, restricted: false,
      permissions: { adminReceivesDaily: true, sellerCanDownloadReport: true, dashboardVisible: true }, created_at: '2026-08-01T06:00:00.000Z' },
    { id: 'V2', legacy_name: 'Mama Ntilie Grocery', name: 'Mama Ntilie Grocery', business_type: 'Groceries', phone: '255756000002',
      address: 'Kariakoo', currency: 'TZS', logo_url: 'https://drive.google.com/thumbnail?id=abc&sz=w200', registered_on: '2026-01-10T06:00:00.000Z',
      active: true, restricted: false, permissions: {}, created_at: '2026-01-10T06:00:00.000Z' },
    { id: 'V3', legacy_name: 'Locked Shop', name: 'Locked Shop', business_type: 'Hardware', phone: '', address: '', currency: 'TZS',
      registered_on: '2026-02-01T06:00:00.000Z', active: true, restricted: true, permissions: {}, created_at: '2026-02-01T06:00:00.000Z' });
  t.branches.push(
    { id: 'B1', vendor_id: 'V1', name: 'Sinza', location: 'Sinza Mori', active: true, created_at: '2026-08-01T06:00:00.000Z' },
    { id: 'B2', vendor_id: 'V1', name: 'Kariakoo', location: 'Kariakoo', active: true, created_at: '2026-08-01T06:00:00.000Z' });
  t.profiles.push(
    { id: 'MGR', email: 'samaritantechs@gmail.com', name: 'Markii Samaritan', handle: 'markii', role: 'manager', vendor_id: null, branch_id: null, active: true, password_hash: PW.hash, password_salt: PW.salt, created_at: '2026-01-01T06:00:00.000Z' },
    { id: 'ADM1', email: 'frank@fromville.tz', name: 'Frank Amos', handle: 'frank', role: 'admin', vendor_id: 'V1', branch_id: null, active: true, password_hash: PW.hash, password_salt: PW.salt, created_at: '2026-08-01T06:00:00.000Z' },
    { id: 'SEL1', email: 'juma@fromville.tz', name: 'Juma Seller', handle: 'juma', role: 'seller', vendor_id: 'V1', branch_id: 'B1', active: true, password_hash: PW.hash, password_salt: PW.salt, created_at: '2026-08-02T06:00:00.000Z' },
    { id: 'SEL2', email: 'asha@fromville.tz', name: 'Asha Seller', handle: 'asha', role: 'seller', vendor_id: 'V1', branch_id: 'B2', active: true, password_hash: PW.hash, password_salt: PW.salt, created_at: '2026-08-02T06:00:00.000Z' },
    { id: 'ADM2', email: 'mama@ntilie.tz', name: 'Mama Ntilie', handle: 'mama', role: 'admin', vendor_id: 'V2', branch_id: null, active: true, password_hash: PW.hash, password_salt: PW.salt, created_at: '2026-01-10T06:00:00.000Z' },
    { id: 'SEL3', email: 'pili@ntilie.tz', name: 'Pili Seller', handle: 'pili', role: 'seller', vendor_id: 'V2', branch_id: null, active: true, password_hash: PW.hash, password_salt: PW.salt, created_at: '2026-01-11T06:00:00.000Z' },
    { id: 'ADM3', email: 'locked@shop.tz', name: 'Locked Admin', handle: 'locked', role: 'admin', vendor_id: 'V3', branch_id: null, active: true, password_hash: PW.hash, password_salt: PW.salt, created_at: '2026-02-01T06:00:00.000Z' },
    { id: 'OLD', email: 'old@fromville.tz', name: 'Gone Seller', handle: 'gone', role: 'seller', vendor_id: 'V1', branch_id: null, active: false, password_hash: PW.hash, password_salt: PW.salt, created_at: '2026-08-02T06:00:00.000Z' });
  t.sessions.push(
    { token: 'tok-mgr', profile_id: 'MGR', created_at: T(8), expires_at: '2026-10-01T00:00:00.000Z', last_seen_at: T(8) },
    { token: 'tok-adm1', profile_id: 'ADM1', created_at: T(8), expires_at: '2026-10-01T00:00:00.000Z', last_seen_at: T(8) },
    { token: 'tok-sel1', profile_id: 'SEL1', created_at: T(8), expires_at: '2026-10-01T00:00:00.000Z', last_seen_at: T(8) },
    { token: 'tok-adm2', profile_id: 'ADM2', created_at: T(8), expires_at: '2026-10-01T00:00:00.000Z', last_seen_at: T(8) },
    { token: 'tok-adm3', profile_id: 'ADM3', created_at: T(8), expires_at: '2026-10-01T00:00:00.000Z', last_seen_at: T(8) },
    { token: 'tok-expired', profile_id: 'ADM1', created_at: '2026-07-01T00:00:00.000Z', expires_at: '2026-08-01T00:00:00.000Z', last_seen_at: '2026-07-01T00:00:00.000Z' });
  t.products.push(
    { id: 'P1', vendor_id: 'V1', legacy_id: 'P001', name: 'Samsung Galaxy A05', category: 'Phones', brand: 'Samsung', model: 'A05', price: 350000, stock: 3, is_serialized: true, supplier: 'Watu', reorder_point: 2, active: true, image1_url: null, image2_url: null, listing_type: 'Sale', price_unit: '', location: 'Sinza', created_at: '2026-08-01T07:00:00.000Z' },
    { id: 'P2', vendor_id: 'V1', legacy_id: 'P002', name: 'Tecno Spark 20', category: 'Phones', brand: 'Tecno', model: 'Spark 20', price: 280000, stock: 2, is_serialized: true, supplier: '', reorder_point: 2, active: true, listing_type: 'Sale', price_unit: '', location: '', created_at: '2026-08-01T07:00:00.000Z' },
    { id: 'P3', vendor_id: 'V1', legacy_id: 'P003', name: 'Phone Cover', category: 'Accessories', brand: '', model: '', price: 5000, stock: 40, is_serialized: false, supplier: '', reorder_point: 10, active: true, image1_url: 'https://drive.google.com/thumbnail?id=cov&sz=w400', listing_type: 'Sale', price_unit: '', location: '', created_at: '2026-08-01T07:00:00.000Z' },
    { id: 'P4', vendor_id: 'V1', legacy_id: 'P004', name: 'Old Charger', category: 'Accessories', price: 8000, stock: 0, is_serialized: false, reorder_point: 5, active: false, listing_type: 'Sale', created_at: '2026-08-01T07:00:00.000Z' },
    { id: 'P5', vendor_id: 'V2', legacy_id: 'P001', name: 'Sugar 1kg', category: 'Groceries', price: 3200, stock: 8, is_serialized: false, reorder_point: 10, active: true, listing_type: 'Sale', created_at: '2026-01-10T07:00:00.000Z' },
    { id: 'P6', vendor_id: 'V2', legacy_id: 'P002', name: 'Wedding Gown', category: 'Bridal', price: 150000, stock: 1, is_serialized: false, reorder_point: 0, active: true, listing_type: 'Rent', price_unit: 'per event', location: 'Kariakoo', created_at: '2026-01-10T07:00:00.000Z' },
    { id: 'P7', vendor_id: 'V3', legacy_id: 'P001', name: 'Hammer', category: 'Tools', price: 12000, stock: 5, is_serialized: false, reorder_point: 2, active: true, listing_type: 'Sale', created_at: '2026-02-01T07:00:00.000Z' });
  t.branch_stock.push({ product_id: 'P3', branch_id: 'B1', qty: 25 }, { product_id: 'P3', branch_id: 'B2', qty: 15 });
  t.product_units.push(
    { id: 'U1', product_id: 'P1', vendor_id: 'V1', branch_id: 'B1', imei: '350000000000001', serial_no: null, status: 'in_stock', received_at: '2026-08-05T07:00:00.000Z' },
    { id: 'U2', product_id: 'P1', vendor_id: 'V1', branch_id: 'B1', imei: '350000000000002', serial_no: null, status: 'in_stock', received_at: '2026-08-05T07:00:00.000Z' },
    { id: 'U3', product_id: 'P1', vendor_id: 'V1', branch_id: 'B2', imei: '350000000000003', serial_no: null, status: 'in_stock', received_at: '2026-08-05T07:00:00.000Z' },
    { id: 'U4', product_id: 'P1', vendor_id: 'V1', branch_id: 'B1', imei: '350000000000004', serial_no: null, status: 'sold', received_at: '2026-08-05T07:00:00.000Z', sold_sale_id: 'S1', sold_at: T(9) },
    { id: 'U5', product_id: 'P2', vendor_id: 'V1', branch_id: 'B2', imei: '350000000000005', serial_no: null, status: 'in_stock', received_at: '2026-08-06T07:00:00.000Z' },
    { id: 'U6', product_id: 'P2', vendor_id: 'V1', branch_id: 'B2', imei: '350000000000006', serial_no: null, status: 'in_stock', received_at: '2026-08-06T07:00:00.000Z' });
  t.financing_partners.push(
    { id: 'FP1', vendor_id: 'V1', name: 'MOGO', contact: '0700000000', active: true, created_at: '2026-08-01T07:00:00.000Z' },
    { id: 'FP2', vendor_id: null, name: 'Watu Simu', contact: '', active: true, created_at: '2026-08-01T07:00:00.000Z' });
  t.sales.push(
    { id: 'S1', legacy_id: 'SALE-0001', group_id: 'G1', vendor_id: 'V1', branch_id: 'B1', seller_id: 'SEL1', seller_name: 'Juma Seller', product_id: 'P1', product_name: 'Samsung Galaxy A05', brand: 'Samsung', model: 'A05', unit_id: 'U4', imei: '350000000000004', qty: 1, list_price: 350000, discount: 10000, price: 340000, total: 340000, payment_method: 'Credit', financing_partner_id: 'FP1', partner_paid: false, status: 'completed', sold_at: T(9) },
    { id: 'S2', legacy_id: 'SALE-0002', group_id: 'G2', vendor_id: 'V1', branch_id: 'B1', seller_id: 'SEL1', seller_name: 'Juma Seller', product_id: 'P3', product_name: 'Phone Cover', qty: 2, list_price: 5000, discount: 0, price: 5000, total: 10000, payment_method: 'Cash', status: 'completed', sold_at: T(10) },
    { id: 'S3', legacy_id: 'SALE-0003', group_id: 'G3', vendor_id: 'V1', branch_id: 'B2', seller_id: 'SEL2', seller_name: 'Asha Seller', product_id: 'P3', product_name: 'Phone Cover', qty: 1, list_price: 5000, discount: 0, price: 5000, total: 5000, payment_method: 'Lipa Number', status: 'completed', sold_at: T(11) },
    { id: 'S4', legacy_id: 'SALE-0004', group_id: 'G4', vendor_id: 'V1', branch_id: 'B1', seller_id: 'SEL1', seller_name: 'Juma Seller', product_id: 'P3', product_name: 'Phone Cover', qty: 3, list_price: 5000, discount: 0, price: 5000, total: 15000, payment_method: 'Cash', status: 'cancelled', cancelled_by: 'ADM1', cancelled_by_name: 'Frank Amos', cancelled_at: T(11, 30), cancel_reason: 'wrong item', sold_at: T(8, 30) },
    { id: 'S5', legacy_id: 'SALE-0005', group_id: 'G5', vendor_id: 'V1', branch_id: 'B1', seller_id: 'SEL1', seller_name: 'Juma Seller', product_id: 'P3', product_name: 'Phone Cover', qty: 4, list_price: 5000, discount: 500, price: 4500, total: 18000, payment_method: 'Cash', status: 'completed', sold_at: '2026-08-30T08:00:00.000Z' },
    { id: 'S6', legacy_id: 'SALE-0006', group_id: 'G6', vendor_id: 'V1', branch_id: 'B1', seller_id: 'SEL1', seller_name: 'Juma Seller', product_id: 'P3', product_name: 'Phone Cover', qty: 1, list_price: 5000, discount: 0, price: 5000, total: 5000, payment_method: 'Cash', status: 'completed', sold_at: '2026-07-15T08:00:00.000Z' },
    { id: 'S7', legacy_id: 'SALE-0001', group_id: 'G7', vendor_id: 'V2', branch_id: null, seller_id: 'SEL3', seller_name: 'Pili Seller', product_id: 'P5', product_name: 'Sugar 1kg', qty: 2, list_price: 3200, discount: 0, price: 3200, total: 6400, payment_method: 'Cash', status: 'completed', sold_at: T(9, 15) });
  t.lendings.push(
    { id: 'L1', legacy_id: 'LEND-AAAA1111', vendor_id: 'V2', branch_id: null, borrower_name: 'Bibi Halima', borrower_email: 'halima@example.com', borrower_phone: '+255700000009', recorded_by: 'ADM2', recorded_by_name: 'Mama Ntilie', status: 'Active', return_date: null, created_at: '2026-08-28T08:00:00.000Z' },
    { id: 'L2', legacy_id: 'LEND-BBBB2222', vendor_id: 'V2', branch_id: null, borrower_name: 'Kaka John', borrower_email: '', borrower_phone: '', recorded_by: 'ADM2', recorded_by_name: 'Mama Ntilie', status: 'Returned', return_date: '2026-08-20T08:00:00.000Z', created_at: '2026-08-10T08:00:00.000Z' });
  t.lending_items.push(
    { id: 'LI1', lending_id: 'L1', product_id: 'P6', product_name: 'Wedding Gown', unit_id: null, qty: 1, price: 150000, total: 150000 },
    { id: 'LI2', lending_id: 'L2', product_id: 'P5', product_name: 'Sugar 1kg', unit_id: null, qty: 3, price: 0, total: 0 });
  t.cash_receipts.push({ id: 'C1', vendor_id: 'V1', seller_id: 'SEL1', cash_amount: 6000, lipa_amount: 0, note: null, recorded_by: 'ADM1', received_at: T(11, 45) });
  t.stock_movements.push(
    { id: 'M1', vendor_id: 'V1', product_id: 'P1', product_name: 'Samsung Galaxy A05', unit_id: 'U4', imei: '350000000000004', type: 'received', qty: 1, to_branch_id: 'B1', by_user: 'ADM1', by_name: 'Frank Amos', created_at: '2026-08-05T07:00:00.000Z' },
    { id: 'M2', vendor_id: 'V1', product_id: 'P1', product_name: 'Samsung Galaxy A05', unit_id: 'U4', imei: '350000000000004', type: 'sold', qty: 1, from_branch_id: 'B1', reference_sale_id: 'S1', by_user: 'SEL1', by_name: 'Juma Seller', created_at: T(9) });
  t.hints.push(
    { id: 'H1', role: 'seller', message_en: 'Your User ID is your login.', message_sw: 'Kitambulisho chako ndiyo login yako.', active: true, sort: 0 },
    { id: 'H2', role: 'all', message_en: 'Use Refresh to see the latest numbers.', message_sw: 'Tumia Refresh kuona namba za sasa.', active: true, sort: 1 },
    { id: 'H3', role: 'marketplace', message_en: 'Tap any product to contact the seller.', message_sw: '', active: true, sort: 2 });
  t.product_clicks.push(
    { id: 1, product_id: 'P3', vendor_id: 'V1', clicked_at: T(8) },
    { id: 2, product_id: 'P3', vendor_id: 'V1', clicked_at: '2026-06-01T08:00:00.000Z' },
    { id: 3, product_id: 'P5', vendor_id: 'V2', clicked_at: T(8, 5) });
  return t;
}

/** A user object exactly as resolveSession builds it, for calling modules directly. */
export function userOf(book, profileId) {
  const p = book.profiles.find(x => x.id === profileId);
  if (!p) throw new Error('no profile ' + profileId);
  const { password_hash, password_salt, ...rest } = p;
  const vendor = p.vendor_id ? book.vendors.find(v => v.id === p.vendor_id) : null;
  return { ...rest, vendor: vendor ? { ...vendor } : null,
    is_admin: p.role === 'admin' || p.role === 'assistant-admin',
    is_manager: p.role === 'manager' || p.role === 'assistant-manager' };
}

export function bookDb(book = richBook(), opts) { return fakeDb(book, opts); }
export const MANAGER = 'MGR', ADMIN1 = 'ADM1', SELLER1 = 'SEL1', SELLER2 = 'SEL2', ADMIN2 = 'ADM2', ADMIN3 = 'ADM3';
