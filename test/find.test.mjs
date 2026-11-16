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

/* FOUND BY A REVIEW OF THE FIRST VERSION. Another word for what was typed was accepted at the START
   of any word, so the short Kiswahili words leaked into names: "ring" (pete) found the shop
   Peter, "water" (maji) Majid, "watch" (saa) Saad -- every product of such a shop, shown as an
   exact match. A word for it has to BE a word of the product. */
const NAMES = [
  { id: 1, name: 'Tecno Spark 10', cat: 'Phones', vendor: 'Peter Mobile Shop' },
  { id: 2, name: 'Bottled drinks', cat: 'Drinks', vendor: 'Majid Stores' },
  { id: 3, name: 'Brake pads', cat: 'Spares', vendor: 'Saad Motors' },
  { id: 4, name: 'Cooking oil', cat: 'Groceries', vendor: 'Solanki Traders' },
  { id: 5, name: 'Plastic stool', cat: 'Furniture', vendor: 'Kitiwa Store' },
  { id: 6, name: 'Fruit', cat: 'Food', vendor: 'Gariba Fruits' },
  { id: 7, name: 'Pete ya dhahabu', cat: 'Jewellery', vendor: 'Gold House' },
  { id: 8, name: 'Gold Rings', cat: 'Jewellery', vendor: 'Gold House' },
  { id: 9, name: 'Saa ya mkononi', cat: 'Accessories', vendor: 'Baraka' },
  { id: 10, name: 'Ladies Dresses', cat: 'Clothes', vendor: 'Mama Wear' },
  { id: 11, name: 'Mchele 5kg', cat: 'Groceries', vendor: 'Mama Ntilie' },
];
const names = q => { const r = F.search(NAMES, q); return (r.near ? '~' : '') + r.list.map(p => p.id).join(','); };

test('another word for it must BE a word of the product -- never the first letters of a shop\'s name', () => {
  assert.equal(names('ring'), '7,8', 'a ring: the product that says pete, the one that says rings -- not the shop Peter');
  assert.equal(names('watch'), '9', 'not Saad Motors');
  assert.equal(names('water'), '', 'not Majid Stores, not even as the closest');
  assert.equal(names('solar'), '~4', 'Solanki Traders is a slip away from "solar": the closest, and said to be -- never an exact match');
  assert.equal(names('chair'), '', 'not Kitiwa Store');
  assert.equal(names('car'), '', 'not Gariba Fruits');
  // ...while what the customer typed is still found inside any word, as it always was.
  assert.equal(names('pete'), '1,7,8', 'typed "pete" is a piece of "Peter" and of "Pete" -- and a ring is what pete means');
  // A plural is the same word: "phones" says phone, "dresses" says dress, "mchele" says rice.
  assert.equal(names('rice'), '11');
  assert.equal(names('dress'), '10');
  assert.equal(names('bangle'), '', 'nothing on this shelf is a bracelet');
  assert.equal(F.search([{ name: 'Gold Bracelets' }], 'bangili').list.length, 1, 'a plural of the other word is the other word');
  assert.equal(F.search([{ name: 'Smartphones' }], 'simu').list.length, 1);
});

test('a slip is forgiven in what was typed, not in a short word the customer never typed', () => {
  assert.equal(names('water'), '', 'maji -> majid is one letter, and not a match');
  assert.equal(names('ring').indexOf('~'), -1);
  // A long word for it still is: nobody types "sukari" and means "sukrai", but a shop might have.
  assert.equal(F.search([{ name: 'Sukrai ya kilo' }], 'sugar').near, true, 'a long other word is forgiven a slip');
});

/* "128gb" and "128 GB" are the same thing to a customer; the second used to be found and the first
   not, since a number is never forgiven a slip and so there was nothing to bridge the space. But
   the bridge is only over a space between a letter and a digit: "Hot 12 8GB" (a model, then its
   memory) is not a 128GB phone. */
test('a model or size the customer ran together is found when the shop spaced it', () => {
  const phones = [
    { id: 1, name: 'Samsung Galaxy A05 128GB', cat: 'Phones' },
    { id: 2, name: 'Tecno Spark 10 128 GB', cat: 'Phones' },
    { id: 3, name: 'Infinix Hot 12 8GB', cat: 'Phones' },
    { id: 4, name: 'Cotton T-shirt', cat: 'Clothes' },
    { id: 5, name: 'Mama\'s kitchen', cat: 'Food' },
    { id: 6, name: 'Redmi Note A 05 case', cat: 'Accessories' },
  ];
  const p = q => { const r = F.search(phones, q); return (r.near ? '~' : '') + r.list.map(x => x.id).join(','); };
  assert.equal(p('128gb'), '1,2', 'and not the Hot 12 8GB');
  assert.equal(p('128 gb'), '1,2');
  assert.equal(p('a05'), '1,6', 'A05 and A 05');
  assert.equal(p('spark10'), '2', 'a name and its number run together');
  assert.equal(p('128'), '1,2', '128 is in 128GB; Hot 12 8GB is not a 128');
  assert.equal(p('12'), '1,2,3', 'a bare number keeps the plain rule: it is inside 128GB, and it is the Hot 12');
  assert.equal(p('shir'), '4', 'a short word keeps the plain rule: it is inside "shirt"');
  // Two WORDS run together are not bridged: they are found by the near-miss pass, which says so.
  assert.equal(p('tshirt'), '~4');
  assert.equal(p('mamas'), '~5');
});

/* A word in a script this folding cannot read used to turn into "nothing typed" -- the whole shelf. */
test('text with no letter or digit of ours is matched as plain text, and never means everything', () => {
  const mixed = [
    { id: 1, name: '手机壳', cat: 'Accessories' },
    { id: 2, name: 'قهوة عربية', cat: 'Groceries', vendor: 'Zanzibar Spices' },
    { id: 3, name: 'Simu 100% new', cat: 'Phones' },
    { id: 4, name: 'Chai 😀', cat: 'Drinks' },
  ];
  const m = q => F.search(mixed, q).list.map(x => x.id).join(',');
  assert.equal(m('手机'), '1');
  assert.equal(m('قهوة'), '2', 'Arabic finds Arabic');
  assert.equal(m('😀'), '4');
  assert.equal(m('  手机  '), '1', 'spaces round it are not part of it');
  assert.equal(m('کتاب'), '', 'a word nobody wrote finds nothing, not everything');
  assert.equal(m('%'), '1,2,3,4', 'ASCII punctuation alone is still nothing typed');
  assert.equal(m('!!'), '1,2,3,4');
  assert.equal(m('100%'), '3', 'a number with its sign is the number');
  assert.equal(F.search(mixed, '手机').near, false);
});
