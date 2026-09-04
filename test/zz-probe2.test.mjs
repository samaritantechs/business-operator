import test from 'node:test';
import { richBook, userOf, NOW } from './_book.mjs';
import { fakeDb } from './fake-db.mjs';
const { boApi, FN } = await import('../api/_lib/bo-core.js');

test('PROBE E: sweep every fn a SELLER can reach for cost_price / unit_cost', async () => {
  const names = Object.keys(FN);
  for (const n of names) {
    const book = richBook();
    // give the seller a hold and a PO to look at
    book.pending_sales.push({ id: 'PS1', legacy_id: 'HOLD-0001', vendor_id: 'V1', branch_id: null,
      customer_name: 'Neema Private', customer_phone: '0712999888', deposit: 5000, payment_method: null,
      financing_partner_id: null, notes: 'secret note', status: 'held', hold_until: '2026-09-10',
      created_by: 'ADM1', created_by_name: 'Frank Amos', created_at: '2026-09-01T06:00:00.000Z' });
    book.pending_sale_items.push({ id: 'PSI1', pending_id: 'PS1', product_id: 'P3', product_name: 'Phone Cover', unit_id: null, qty: 1, list_price: 5000, discount: 0, total: 5000 });
    const db = fakeDb(book);
    const user = userOf(book, 'SEL1');
    let out;
    try { out = await boApi(db, user, n, { period: 'today', type: 'sales', start: '2026-09-02', end: '2026-09-02' }, NOW); }
    catch (e) { continue; }
    const j = JSON.stringify(out);
    if (/cost_price|unit_cost/.test(j)) console.log('LEAK in ' + n + ': ' + j.slice(0, 400));
    if (/Neema Private|0712999888|secret note/.test(j)) console.log('HOLD PRIVACY ' + n + ': ' + j.slice(0, 500));
  }
});
