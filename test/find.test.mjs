/* THE SEARCH BOX -- public/bo/find.js, run here exactly as the page runs it.
 *
 * It is a plain browser script (no build step, no modules), so it is loaded the way a page
 * loads it: handed a `window` and left to hang BOFind on it. Everything the box promises a
 * customer is held below -- every word, either language, a slip of the thumb -- and so is what
 * it must NOT do: guess at a number, or show a near miss beside a real match. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../public/bo/find.js', import.meta.url), 'utf8');
const window = {};
new Function('window', src)(window);
const F = window.BOFind;

const SHELF = [
  { id: 1, name: 'Samsung Galaxy A05', cat: 'Phones', vendor: 'Fromville Phones', brand: 'Samsung', model: 'A05', location: 'Kariakoo' },
  { id: 2, name: 'Samsung Galaxy A06', cat: 'Phones', vendor: 'Fromville Phones', brand: 'Samsung', model: 'A06' },
  { id: 3, name: 'Quartz Wrist Watch', cat: 'Accessories', vendor: 'Baraka Shop' },
  { id: 4, name: 'Saa ya ukutani', cat: 'Home', vendor: 'Mama Ntilie Grocery' },
  { id: 5, name: 'Beaded Bracelet', cat: 'Accessories', vendor: 'Baraka Shop' },
  { id: 6, name: 'Inkjet Printer', cat: 'Electronics', vendor: 'Baraka Shop' },
  { id: 7, name: 'Sukari 1kg', cat: 'Groceries', vendor: 'Mama Ntilie Grocery' },
  { id: 8, name: 'Masaa Lodge room', cat: 'Rooms', vendor: 'Masaa Lodge' },
  { id: 9, name: 'Phone cover', cat: 'Accessories', vendor: 'Fromville Phones' },
];
const ids = q => { const r = F.search(SHELF, q); return (r.near ? '~' : '') + r.list.map(p => p.id).join(','); };

test('nothing typed is the whole shelf, in the order it came', () => {
  assert.equal(ids(''), '1,2,3,4,5,6,7,8,9');
  assert.equal(ids('   '), '1,2,3,4,5,6,7,8,9');
  assert.equal(ids('!!'), '1,2,3,4,5,6,7,8,9', 'punctuation alone is nothing typed');
  assert.deepEqual(F.search(null, 'x'), { list: [], near: false, words: ['x'] });
});

test('what worked before still works: part of a word, any case, any of the six things a product says', () => {
  assert.equal(ids('samsung'), '1,2');
  assert.equal(ids('SUNG'), '1,2', 'the typed text is found anywhere inside a word');
  assert.equal(ids('kariakoo'), '1', 'the place');
  assert.equal(ids('baraka'), '3,5,6', 'the shop');
  assert.equal(ids('groceries'), '7', 'the category');
  assert.equal(ids('a05'), '1', 'the model');
});

test('every word must be found, in any order', () => {
  assert.equal(ids('galaxy samsung'), '1,2');
  assert.equal(ids('baraka watch'), '3');
  assert.equal(ids('watch simu'), '', 'a watch that is also a phone: nothing, not everything');
});

test('the two languages of the same street find each other', () => {
  assert.equal(ids('simu'), '1,2,9', 'simu finds what a shop filed under Phones');
  assert.equal(ids('phone'), '1,2,9');
  assert.equal(ids('watch'), '3,4', 'watch finds the shop that wrote Saa');
  assert.equal(ids('bangili'), '5');
  assert.equal(ids('printa'), '6');
  assert.equal(ids('sugar'), '7');
  // Another word for it has to START a word: "saa" for "watch" is not inside "Masaa Lodge".
  assert.ok(!F.search(SHELF, 'watch').list.some(p => p.id === 8));
  // Every group is words only -- nothing the folding would split, nothing said twice in one group.
  for (const g of F.GROUPS) {
    assert.ok(g.length >= 2, 'a group of one says nothing: ' + g);
    assert.equal(new Set(g).size, g.length, 'a word twice in ' + g);
    for (const w of g) assert.equal(F.fold(w), w, '"' + w + '" would never match: it is not how a typed word looks after folding');
  }
});

test('a slip of the thumb still finds it -- and the answer says it is only the closest', () => {
  assert.equal(ids('samsng'), '~1,2');
  assert.equal(ids('braclet'), '~5');
  assert.equal(ids('wacth'), '~3', 'two letters swapped is one slip');
  assert.equal(ids('printr'), '~6');
  assert.equal(ids('sukri'), '~7');
  assert.equal(ids('galxy a05'), '~1', 'the slip is forgiven, the number beside it is not');
});

test('a near miss is never shown beside a real match, and never guessed for a number or a short word', () => {
  assert.equal(F.search(SHELF, 'samsung').near, false);
  assert.equal(ids('a07'), '', 'A07 is not A05 or A06');
  assert.equal(ids('sasa'), '', '"sasa" is not "saa"');
  assert.equal(ids('xyzzy'), '');
  assert.equal(F.slack('a05'), 0); assert.equal(F.slack('saa'), 0);
  assert.equal(F.slack('galxy'), 1); assert.equal(F.slack('bracelets'), 2);
  assert.equal(F.distance('samsng', 'samsung', 2), 1);
  assert.equal(F.distance('wacth', 'watch', 1), 1);
  assert.equal(F.distance('abc', 'xyz', 1), 2, 'it stops counting once it is too far');
});

test('accents and punctuation are not letters', () => {
  assert.equal(F.fold('  Café-Bar (Mpya!) '), 'cafe bar mpya');
  assert.deepEqual(F.sayings('simu').slice(0, 2), ['simu', 'phone']);
  assert.deepEqual(F.sayings('zzz'), ['zzz']);
});

test('a big shelf is searched fast enough to do on every keystroke', () => {
  const big = [];
  for (let i = 0; i < 3000; i++) big.push({ id: i, name: 'Product ' + i + ' ' + ['Samsung', 'Tecno', 'Infinix', 'Itel'][i % 4] + ' model ' + (i % 97), cat: ['Phones', 'Home', 'Groceries'][i % 3], vendor: 'Shop ' + (i % 40) });
  const t = process.hrtime.bigint();
  F.search(big, 'samsng model');          // the slow path: nothing exact, so every product is compared letter by letter
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.ok(ms < 400, 'a 3,000-product near-miss search took ' + ms.toFixed(0) + 'ms');
});
