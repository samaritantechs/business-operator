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

/* THE UNIQUE INDEX, STOOD IN FOR. The fake database has no indexes, so this plays db/RUN-ME-008's
   `unique (vendor_id, sort)`: an insert of a row whose (vendor, place) is already taken is
   refused WHOLE, with the code and message PostgREST gives. `between` runs at the moment of the
   first insert -- another request's work landing between our delete and our insert -- and
   `landThenFail` makes our own first insert land and its answer be lost (runQuery then asks again). */
function withUniqueIndex(db, { between, landThenFail } = {}) {
  let inserts = 0, seq = 0;
  return {
    ...db,
    from(name) {
      const q = db.from(name);
      if (name !== 'pay_numbers') return q;
      q.insert = rowsIn => {
        const list = Array.isArray(rowsIn) ? rowsIn : [rowsIn], n = ++inserts;
        return { select: () => (async () => {
          if (n === 1 && between) between(db);
          const store = db._dump('pay_numbers');
          if (list.some(r => store.some(h => h.vendor_id === r.vendor_id && h.sort === r.sort))) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "pay_numbers_vendor_sort_uq"' } };
          }
          const made = list.map(r => ({ id: 'pn-' + (++seq), ...r }));
          store.push(...made);                      // the check and the write are ONE step: that is what an index is
          if (n === 1 && landThenFail) return { data: null, error: { message: 'fetch failed' } };    // it landed; the answer was lost
          return { data: made.map(r => ({ ...r })), error: null };
        })() };
      };
      return q;
    },
  };
}
const rowsOf = db => db._dump('pay_numbers').map(r => r.vendor_id + ':' + r.sort + ':' + r.number).join(' ');

test('two saves at the same moment leave ONE list in the table, and the loser is told so', async () => {
  const db = withUniqueIndex(bookDb());
  const typo = { network: 'M-Pesa', number: '555124', name: 'FROMVILLE PHONES' }, fixed = { network: 'M-Pesa', number: '555123', name: 'FROMVILLE PHONES' };
  // The admin saves a typo, sees it, corrects it and taps Save again before the first has come back.
  const [a, b] = await Promise.allSettled([FN.setPayNumbers(db, who(ADMIN1), { numbers: [typo] }, NOW), FN.setPayNumbers(db, who(ADMIN1), { numbers: [fixed] }, NOW)]);
  const done = [a, b].filter(r => r.status === 'fulfilled'), lost = [a, b].filter(r => r.status === 'rejected');
  assert.equal(done.length, 1, 'exactly one of the two saves is the one that stands');
  assert.equal(lost.length, 1);
  assert.equal(lost[0].reason.status, 409);
  assert.match(lost[0].reason.message, /Somebody else saved the pay numbers at the same moment/);
  assert.match(lost[0].reason.message, /Mtu mwingine amehifadhi/, 'in both languages, like every other refusal');
  assert.equal(db._dump('pay_numbers').length, 1, 'never both lists, never a retired number beside the real one');
  const seen = await FN.payNumbers(db, who(SELLER1), {}, NOW);
  assert.deepEqual(seen.rows, done[0].value.rows, 'what a seller reads is the list that was reported saved');
});

test('another list landing between my delete and my insert is reported, not overwritten and not claimed', async () => {
  const theirs = { vendor_id: 'V1', network: 'Airtel Money', number: '0784000111', name: 'SOMEBODY ELSE', sort: 0, id: 'x1' };
  const db = withUniqueIndex(bookDb(), { between: d => d._dump('pay_numbers').push({ ...theirs }) });
  await rejects(FN.setPayNumbers(db, who(ADMIN1), { numbers: [MPESA] }, NOW), 409, /at the same moment/);
  assert.equal(rowsOf(db), 'V1:0:0784000111', 'their list stands untouched');
});

test('an insert that landed but whose answer was lost, and was asked again, is a save that worked', async () => {
  const db = withUniqueIndex(bookDb(), { landThenFail: true });
  const r = await FN.setPayNumbers(db, who(ADMIN1), { numbers: [MPESA, AIRTEL] }, NOW);       // runQuery waits 250 ms and asks again
  assert.equal(r.rows.length, 2);
  assert.match(r.message, /these numbers/, 'said as the success it is, not as somebody else\'s save');
  assert.equal(rowsOf(db), 'V1:0:555123 V1:1:0784000111', 'once, not twice');
});

test('the unique index is in schema.sql and in the migration, under one name, and the old plain index is gone', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['../db/schema.sql', '../db/RUN-ME-008-pay-numbers-and-tips.sql']) {
    const sql = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.match(sql, /create unique index if not exists pay_numbers_vendor_sort_uq on pay_numbers \(vendor_id, sort\);/, f);
    assert.doesNotMatch(sql, /pay_numbers_vendor_idx/, f + ' still creates the plain index');
  }
});

/* BO.payNumbers, RUN. It is the one function every till and receipt reads the number through, and
   what it must never do is show somebody the wrong number: an answer for the last person to sign
   in, a list older than the save that replaced it, or an all-day-old list as if it were current. */
async function payNumbersHarness() {
  const { readFileSync } = await import('node:fs');
  const shell = readFileSync(new URL('../public/bo/shell.js', import.meta.url), 'utf8');
  const code = shell.slice(shell.indexOf('var PAY_FRESH_MS'), shell.indexOf('/** One pay number as a line of words'));
  const S = { token: 'T1', payNums: null, payGen: 0 }, BO = {}, clock = { t: 1e9 }, asked = [];
  const srv = (fn, args) => new Promise((res, rej) => asked.push({ fn, args, res, rej }));
  new Function('S', 'BO', 'srv', 'Date', code)(S, BO, srv, { now: () => clock.t });
  const answer = (rowsIn, i = asked.length - 1) => asked[i].res({ rows: rowsIn, ready: true });
  const tick = () => new Promise(r => setImmediate(r));
  return { S, BO, clock, asked, answer, tick };
}
const NUM = n => ({ network: 'M-Pesa', number: n, name: 'FROMVILLE PHONES' });

test('BO.payNumbers: fresh for a minute and then asked again; a fresh ask always asks', async () => {
  const h = await payNumbersHarness(), got = [];
  h.BO.payNumbers(x => got.push(x)); h.answer([NUM('555123')]); await h.tick();
  assert.equal(h.asked.length, 1); assert.equal(got[0].rows[0].number, '555123');
  h.clock.t += 59000; h.BO.payNumbers(x => got.push(x)); await h.tick();
  assert.equal(h.asked.length, 1, 'inside the minute it does not ask again'); assert.equal(got.length, 2);
  h.clock.t += 2000; h.BO.payNumbers(x => got.push(x)); h.answer([NUM('777999')]); await h.tick();
  assert.equal(h.asked.length, 2, 'a minute and a second later it does'); assert.equal(got[2].rows[0].number, '777999', 'and shows the corrected number');
  h.BO.payNumbers(x => got.push(x), true); await h.tick();
  assert.equal(h.asked.length, 3, '`fresh` asks whatever is held');
});

test('BO.payNumbers: an answer for somebody who has signed out never reaches the next person to sign in', async () => {
  const h = await payNumbersHarness(), got = [];
  h.BO.payNumbers(x => got.push(x));                                   // seller A's till asks...
  h.S.token = 'T2'; h.S.payNums = null;                                // ...A signs out, B (another business) signs in
  h.answer([NUM('111111')]); await h.tick();                           // ...and A's answer arrives late
  assert.equal(got.length, 0, 'it was not handed to anyone');
  assert.equal(h.S.payNums, null, 'and it was not kept for B\'s till to read');
});

test('BO.payNumbers: an answer to a question asked before a save is not allowed to undo the save', async () => {
  const h = await payNumbersHarness(), got = [];
  h.BO.payNumbers(x => got.push(x));                                   // the till asks (and the answer will be the OLD list)
  h.S.payGen += 1; h.S.payNums = { rows: [NUM('777999')], ready: true, at: h.clock.t };      // the admin's save completes in between
  h.answer([NUM('555123')], 0); await h.tick();
  assert.equal(got.length, 0, 'the old list is not handed out');
  assert.equal(h.S.payNums.rows[0].number, '777999', 'and it did not overwrite the saved one');
  assert.equal(h.asked.length, 2, 'the till asked again, after the save');
  h.answer([NUM('777999')], 1); await h.tick();
  assert.equal(got.length, 1); assert.equal(got[0].rows[0].number, '777999');
});

test('BO.payNumbers: when the line drops, a few-minutes-old answer is given again, an old one never is', async () => {
  const h = await payNumbersHarness();
  const ask = fresh => { const got = []; h.BO.payNumbers(x => got.push(x), fresh); return got; };
  const g1 = ask(); h.answer([NUM('555123')]); await h.tick();
  h.clock.t += 120000;                                                  // two minutes: older than fresh, younger than the grace
  const g2 = ask(); h.asked[h.asked.length - 1].rej(new Error('fetch failed')); await h.tick();
  assert.equal(g2[0].rows[0].number, '555123', 'a till that cannot check shows what it knew a moment ago');
  assert.ok(!g2[0].failed);
  h.clock.t += 600000;                                                  // ten minutes: an admin may have changed it since
  const g3 = ask(); h.asked[h.asked.length - 1].rej(new Error('fetch failed')); await h.tick();
  assert.equal(g3[0].failed, true, 'an old list is never shown as if it were current');
  assert.deepEqual(g3[0].rows, []);
  const g4 = ask(true); h.asked[h.asked.length - 1].rej(new Error('fetch failed')); await h.tick();
  assert.equal(g4[0].failed, true, 'the editor (a fresh ask) never falls back to a held list');
  h.S.payNums = null;
  const g5 = ask(); h.asked[h.asked.length - 1].rej(new Error('fetch failed')); await h.tick();
  assert.equal(g5[0].failed, true, 'nothing held: it says it could not ask -- not that none is saved');
  assert.equal(g1.length, 1);
});

test('BO.payNumbers: a callback that throws is not called a second time', async () => {
  /* Run in a process of its own: the throw is an unhandled rejection in the page (a console line,
     nothing more) and the test runner would count it as a failure of this file. */
  const { execFileSync } = await import('node:child_process');
  const { readFileSync } = await import('node:fs');
  const shell = readFileSync(new URL('../public/bo/shell.js', import.meta.url), 'utf8');
  const code = shell.slice(shell.indexOf('var PAY_FRESH_MS'), shell.indexOf('/** One pay number as a line of words'));
  const script = "process.on('unhandledRejection', () => {});"
    + "const S = { token: 'T1', payNums: null, payGen: 0 }, BO = {}, srv = () => Promise.resolve({ rows: [], ready: true });"
    + 'new Function("S", "BO", "srv", "Date", ' + JSON.stringify(code) + ')(S, BO, srv, Date);'
    + "let calls = 0; BO.payNumbers(() => { calls++; throw new Error('the till was left'); });"
    + 'setTimeout(() => console.log(calls), 60);';
  assert.equal(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }).trim(), '1');
});

test('the page says the name before the PIN, saves once at a time, and never saves from an editor that did not load', async () => {
  const { readFileSync } = await import('node:fs');
  const read = f => readFileSync(new URL('../public/bo/' + f, import.meta.url), 'utf8');
  const shell = read('shell.js'), sell = read('sell.js'), rcpt = read('receipt.js'), users = read('users.js');
  assert.match(shell, /S\.loaded = \{\}; S\.entered = false; S\.payNums = null;/, 'a new sign-in forgets the last person\'s numbers');
  assert.match(shell, /S\.hints = \[\]; S\.payNums = null; store\('boToken', null\);/, 'and so does signing out');
  assert.match(sell, /showPayNumbers\(m === 'Lipa Number'\);/, 'shown only when that is how the customer is paying');
  assert.match(sell, /must see this NAME on their phone before entering the PIN/);
  assert.match(sell, /if \(!chosen \|\| chosen\.value !== 'Lipa Number'\) return;/, 'a slow answer does not appear over another payment method, nor throw when the till has been left');
  assert.match(sell, /if \(pn\.failed\) \{ box\.innerHTML = '<div class="pay-num pay-none">[^']*Could not load the Lipa Namba/, 'a shop that HAS a number is not told it has none because the line dropped');
  assert.ok(sell.indexOf('if (pn.failed)') < sell.indexOf("? (pn.ready ? '📱 No Lipa Namba is saved yet."), 'asked before "none is saved" is said');
  assert.match(rcpt, /if \(r\.payment_method === 'Lipa Number'\) BO\.payNumbers\(/, 'only a receipt paid that way asks');
  /* Found by the browser check: the numbers are usually already in hand, so the answer comes at
     once -- and it used to come before the receipt had been drawn, with nothing to add it to. */
  assert.ok(rcpt.indexOf("body: '<div id=\"rcptSheet\"") < rcpt.indexOf("if (r.payment_method === 'Lipa Number') BO.payNumbers("), 'the sheet is drawn before the pay number is added to it');
  assert.match(rcpt, /\(r\.pay_numbers \|\| \[\]\)\.forEach\(function \(n\) \{ L\.push\('Lipa Namba: ' \+ BO\.payLine\(n\)\); \}\);/, 'and Copy / Share carry it too');
  // The editor: one save at a time; this till reads the new list at once; a failed save drops what is held.
  assert.match(users, /if \(btn && btn\.disabled\) return;\s*\/\/ a second tap while the first save is still on its way/);
  assert.match(users, /if \(btn\) btn\.disabled = true;\s*if \(msg\) msg\.textContent = 'Saving…';/);
  assert.match(users, /S\.payGen = \(S\.payGen \|\| 0\) \+ 1;\s*\/\/ any question asked before this is older than the save\s*S\.payNums = \{ rows: r\.rows \|\| \[\], ready: true, at: Date\.now\(\) \};/);
  assert.match(users, /S\.payGen = \(S\.payGen \|\| 0\) \+ 1; S\.payNums = null;\s*if \(msg\) msg\.textContent = '';\s*BO\.fail\(e\);\s*if \(e && e\.status === 409\) loadPay\(\);\s*else if \(btn\) btn\.disabled = false;/,
    'typed text stays unless somebody else\'s list won; Save never comes back over an editor that failed to load');
});
