import test from 'node:test';
import assert from 'node:assert/strict';
import { richBook, userOf, NOW, T } from './_book.mjs';
import { fakeDb } from './fake-db.mjs';

const { FN: REPORTS } = await import('../api/_lib/bo/reports.js');
const { FN: PENDING } = await import('../api/_lib/bo/pending.js');
const ADM = () => userOf(richBook(), 'ADM1');
const SEL = () => userOf(richBook(), 'SEL1');

test('PROBE C: a deposit taken yesterday, collected today on CREDIT, drives the balance negative', async () => {
  const book = richBook();
  // Juma takes a 40,000 deposit YESTERDAY on 20 covers at 5,000 = 100,000
  const yesterday = new Date(NOW - 86400000).toISOString();
  book.pending_sales.push({ id: 'PS1', legacy_id: 'HOLD-0001', vendor_id: 'V1', branch_id: null,
    customer_name: 'Neema', customer_phone: '0712', deposit: 40000, payment_method: null,
    financing_partner_id: null, notes: null, status: 'held', hold_until: null,
    created_by: 'SEL1', created_by_name: 'Juma Seller', created_at: yesterday });
  book.pending_sale_items.push({ id: 'PSI1', pending_id: 'PS1', product_id: 'P3', product_name: 'Phone Cover',
    unit_id: null, qty: 20, list_price: 5000, discount: 0, total: 100000 });
  // the stock is already reserved
  book.products.find(p => p.id === 'P3').stock = 20;
  const db = fakeDb(book);

  // TODAY she collects it, paying by Credit (a financing partner settles with the shop)
  const r = await PENDING.completePendingSale(db, SEL(), { id: 'PS1', payment_method: 'Credit', financing_partner_id: 'FP1' }, NOW);
  console.log('collected:', r.message, '| balance_due', r.balance_due);

  const rep = await REPORTS.reportData(db, ADM(), { type: 'cashdue' }, NOW);
  const juma = rep.rows.find(x => /Juma/.test(x.seller));
  console.log('JUMA ROW:', JSON.stringify(juma));
  console.log('TOTALS:', JSON.stringify(rep.totals));
});

test('PROBE D: same, paid by Lipa Number', async () => {
  const book = richBook();
  const yesterday = new Date(NOW - 86400000).toISOString();
  book.pending_sales.push({ id: 'PS1', legacy_id: 'HOLD-0001', vendor_id: 'V1', branch_id: null,
    customer_name: 'Neema', customer_phone: '0712', deposit: 40000, payment_method: null,
    financing_partner_id: null, notes: null, status: 'held', hold_until: null,
    created_by: 'SEL1', created_by_name: 'Juma Seller', created_at: yesterday });
  book.pending_sale_items.push({ id: 'PSI1', pending_id: 'PS1', product_id: 'P3', product_name: 'Phone Cover',
    unit_id: null, qty: 20, list_price: 5000, discount: 0, total: 100000 });
  book.products.find(p => p.id === 'P3').stock = 20;
  const db = fakeDb(book);
  await PENDING.completePendingSale(db, SEL(), { id: 'PS1', payment_method: 'Lipa Number' }, NOW);
  const rep = await REPORTS.reportData(db, ADM(), { type: 'cashdue' }, NOW);
  console.log('JUMA ROW (lipa):', JSON.stringify(rep.rows.find(x => /Juma/.test(x.seller))));
});
