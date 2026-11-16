/* LIPA NAMBA -- api/_lib/bo/paynumbers.js.
 *
 * Mobile money sent to a wrong number does not come back. The whole point of this small table
 * is that the till says the number, the network and the NAME the customer's phone will show,
 * so what is held here is as much what it refuses as what it stores: a number with no name, a
 * "number" with letters in it, a seller changing where the money goes, another business's
 * numbers, and any of it reaching the public marketplace. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { richBook, bookDb, userOf, NOW, MANAGER, ADMIN1, SELLER1, ADMIN2 } from './_book.mjs';

const { FN, WRITES, MAX_PAY_NUMBERS } = await import('../api/_lib/bo/paynumbers.js');
const { boApi, WRITE_FNS } = await import('../api/_lib/bo-core.js');
const { marketApi } = await import('../api/_lib/bo/market.js');

const who = id => userOf(richBook(), id);
async function rejects(p, status, re) {
  try { await p; } catch (e) { assert.equal(e.status, status, e.message); if (re) assert.match(e.message, re); return; }
  assert.fail('expected a ' + status);
}
const MPESA = { network: 'M-Pesa', number: '555 123', name: 'FROMVILLE PHONES' };
const AIRTEL = { network: 'Airtel Money', number: '0784-000-111', name: 'Frank Amos' };

test('an admin saves the shop\'s numbers; everybody in that shop reads them, in order; nobody else does', async () => {
  const db = bookDb();
  const r = await FN.setPayNumbers(db, who(ADMIN1), { numbers: [MPESA, AIRTEL] }, NOW);
  assert.deepEqual(r.rows, [{ network: 'M-Pesa', number: '555123', name: 'FROMVILLE PHONES' }, { network: 'Airtel Money', number: '0784000111', name: 'Frank Amos' }],
    'spaces and dashes in a number are how it is read aloud, not part of it');
  assert.match(r.message, /these numbers/);
  for (const id of [ADMIN1, SELLER1]) {
    const got = await FN.payNumbers(db, who(id), {}, NOW);
    assert.deepEqual(got, { rows: r.rows, ready: true }, id + ' reads the list the till needs');
  }
  assert.deepEqual(await FN.payNumbers(db, who(ADMIN2), {}, NOW), { rows: [], ready: true }, 'another business has none of them');
  assert.deepEqual(db._dump('pay_numbers').map(x => [x.vendor_id, x.sort]), [['V1', 0], ['V1', 1]]);
});

test('saving REPLACES the list, and an empty list clears it', async () => {
  const db = bookDb();
  await FN.setPayNumbers(db, who(ADMIN1), { numbers: [MPESA, AIRTEL] }, NOW);
  const one = await FN.setPayNumbers(db, who(ADMIN1), { numbers: [AIRTEL, { network: '', number: '', name: '' }] }, NOW);
  assert.equal(one.rows.length, 1, 'a line left wholly empty is no line');
  assert.match(one.message, /this number/);
  assert.equal(db._dump('pay_numbers').length, 1, 'the old two are gone, not added to');
  const none = await FN.setPayNumbers(db, who(ADMIN1), { numbers: [] }, NOW);
  assert.deepEqual(none.rows, []);
  assert.match(none.message, /Cleared/);
  assert.equal(db._dump('pay_numbers').length, 0);
  // Another business's numbers are not touched by any of it.
  await FN.setPayNumbers(db, who(ADMIN2), { numbers: [MPESA] }, NOW);
  await FN.setPayNumbers(db, who(ADMIN1), { numbers: [] }, NOW);
  assert.equal(db._dump('pay_numbers').length, 1);
  assert.equal(db._dump('pay_numbers')[0].vendor_id, 'V2');
});

test('a number with no name is refused -- and so is anything that is not a number', async () => {
  const db = bookDb(), adm = who(ADMIN1);
  await rejects(FN.setPayNumbers(db, adm, { numbers: [{ network: 'M-Pesa', number: '555123', name: '' }] }, NOW), 400, /name the customer's phone shows/);
  await rejects(FN.setPayNumbers(db, adm, { numbers: [{ network: '', number: '555123', name: 'X' }] }, NOW), 400, /which network or bank/);
  await rejects(FN.setPayNumbers(db, adm, { numbers: [{ network: 'M-Pesa', number: '', name: 'X' }] }, NOW), 400, /digits only/);
  await rejects(FN.setPayNumbers(db, adm, { numbers: [{ network: 'M-Pesa', number: '55A123', name: 'X' }] }, NOW), 400, /digits only/);
  await rejects(FN.setPayNumbers(db, adm, { numbers: [{ network: 'M-Pesa', number: '123', name: 'X' }] }, NOW), 400, /4 to 15/);
  await rejects(FN.setPayNumbers(db, adm, { numbers: [{ network: 'M-Pesa', number: '1234567890123456', name: 'X' }] }, NOW), 400, /4 to 15/);
  await rejects(FN.setPayNumbers(db, adm, { numbers: [{ network: 'N'.repeat(31), number: '555123', name: 'X' }] }, NOW), 400, /too long/);
  await rejects(FN.setPayNumbers(db, adm, { numbers: [{ network: 'M-Pesa', number: '555123', name: 'N'.repeat(61) }] }, NOW), 400, /too long/);
  // The second line's fault is named as the second line's.
  await rejects(FN.setPayNumbers(db, adm, { numbers: [MPESA, { network: 'Airtel Money', number: '0784000111', name: '' }] }, NOW), 400, /^Line 2: /);
  await rejects(FN.setPayNumbers(db, adm, { numbers: [MPESA, AIRTEL, MPESA, AIRTEL] }, NOW), 400, /At most 3/);
  await rejects(FN.setPayNumbers(db, adm, {}, NOW), 400, /list of pay numbers/);
  await rejects(FN.setPayNumbers(db, adm, { numbers: 'M-Pesa 555123' }, NOW), 400, /list of pay numbers/);
  assert.equal(db._dump('pay_numbers').length, 0, 'a refused save stores nothing at all');
  assert.equal(MAX_PAY_NUMBERS, 3);
});

test('only an admin of the business decides where its money goes', async () => {
  const db = bookDb();
  await rejects(FN.setPayNumbers(db, who(SELLER1), { numbers: [MPESA] }, NOW), 403);
  await rejects(FN.setPayNumbers(db, who(MANAGER), { numbers: [MPESA] }, NOW), 400, /manager account/);
  await rejects(FN.payNumbers(db, who(MANAGER), {}, NOW), 400, /manager account/);
  assert.deepEqual(WRITES, ['setPayNumbers']);
  assert.ok(WRITE_FNS.has('setPayNumbers') && !WRITE_FNS.has('payNumbers'), 'a save is a write (audited, refused to a restricted business); a read is not');
});

test('a database that has not run RUN-ME-008: the till shows none and does not fail; a save says which file to run', async () => {
  const db = bookDb(richBook(), { missingTables: ['pay_numbers'] });
  assert.deepEqual(await FN.payNumbers(db, who(SELLER1), {}, NOW), { rows: [], ready: false });
  await rejects(FN.setPayNumbers(db, who(ADMIN1), { numbers: [MPESA] }, NOW), 400, /db\/RUN-ME-008/);
  // And through the one door, exactly as the page calls it.
  assert.deepEqual(await boApi(db, who(SELLER1), 'payNumbers', {}, NOW), { rows: [], ready: false });
});

test('a pay number never reaches the public marketplace', async () => {
  const db = bookDb();
  await FN.setPayNumbers(db, who(ADMIN1), { numbers: [{ network: 'M-Pesa', number: '777888999', name: 'SECRET TILL NAME' }] }, NOW);
  const shopfront = JSON.stringify(await marketApi(db, 'market', {}, NOW));
  assert.ok(!shopfront.includes('777888999') && !shopfront.includes('SECRET TILL NAME'), 'the storefront payload carries a pay number');
  const { readFileSync } = await import('node:fs');
  assert.doesNotMatch(readFileSync(new URL('../api/_lib/bo/market.js', import.meta.url), 'utf8'), /pay_numbers/, 'market.js must not read the pay_numbers table');
});

test('the page keeps the answer for a minute and no longer, and says the name before the PIN', async () => {
  const { readFileSync } = await import('node:fs');
  const read = f => readFileSync(new URL('../public/bo/' + f, import.meta.url), 'utf8');
  const shell = read('shell.js'), sell = read('sell.js'), rcpt = read('receipt.js'), users = read('users.js');
  /* Not one read per sale -- and not one per session either: a till stays open all day, and a
     number the admin has just corrected has to reach it. A minute, and then it asks again. */
  assert.match(shell, /var PAY_FRESH_MS = 60000;/);
  assert.match(shell, /BO\.payNumbers = function \(cb, fresh\) \{\s*var held = S\.payNums;\s*if \(held && !fresh && Date\.now\(\) - held\.at < PAY_FRESH_MS\) \{ cb\(held\); return; \}/);
  assert.match(shell, /S\.payNums = \{ rows: r\.rows \|\| \[\], ready: r\.ready !== false, at: Date\.now\(\) \}; cb\(S\.payNums\); \}\)/);
  assert.match(shell, /\.catch\(function \(\) \{ cb\(held && !fresh \? held : \{ rows: \[\], ready: true, failed: true \}\); \}\);/,
    'a line that drops gives the last answer again; with none held, it says it could not ask');
  assert.match(sell, /if \(pn\.failed\) \{ box\.innerHTML = '<div class="pay-num pay-none">[^']*Could not load the Lipa Namba/, 'a shop that HAS a number is not told it has none because the line dropped');
  assert.ok(sell.indexOf('if (pn.failed)') < sell.indexOf("? (pn.ready ? '📱 No Lipa Namba is saved yet."), 'asked before "none is saved" is said');
  assert.match(shell, /S\.loaded = \{\}; S\.entered = false; S\.payNums = null;/, 'a new sign-in forgets the last person\'s numbers');
  assert.match(shell, /S\.hints = \[\]; S\.payNums = null; store\('boToken', null\);/, 'and so does signing out');
  assert.match(sell, /showPayNumbers\(m === 'Lipa Number'\);/, 'shown only when that is how the customer is paying');
  assert.match(sell, /must see this NAME on their phone before entering the PIN/);
  assert.match(sell, /if \(document\.getElementById\('payMethod'\)\.value !== 'Lipa Number'\) return;/, 'a slow answer does not appear over another payment method');
  assert.match(rcpt, /if \(r\.payment_method === 'Lipa Number'\) BO\.payNumbers\(/, 'only a receipt paid that way asks');
  /* Found by the browser check: the numbers are usually already in hand, so the answer comes at
     once -- and it used to come before the receipt had been drawn, with nothing to add it to. */
  assert.ok(rcpt.indexOf("body: '<div id=\"rcptSheet\"") < rcpt.indexOf("if (r.payment_method === 'Lipa Number') BO.payNumbers("), 'the sheet is drawn before the pay number is added to it');
  assert.match(rcpt, /\(r\.pay_numbers \|\| \[\]\)\.forEach\(function \(n\) \{ L\.push\('Lipa Namba: ' \+ BO\.payLine\(n\)\); \}\);/, 'and Copy / Share carry it too');
  assert.match(users, /S\.payNums = \{ rows: r\.rows \|\| \[\], ready: true, at: Date\.now\(\) \};/, 'this till reads a newly saved list at once');
  assert.match(users, /\}\)\.catch\(function \(e\) \{[\s\S]{0,260}S\.payNums = null;\s*if \(msg\) msg\.textContent = ''; BO\.fail\(e\);/, 'a save that failed may have failed half way: what the page holds is dropped');
});
