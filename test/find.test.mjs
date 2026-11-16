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

/* FOUND BY A SECOND REVIEW, OF THE FIXES. */
test('a plural of a short word, and a word with a number glued on, still say what they are', () => {
  const tvs = [
    { id: 1, name: 'Hisense TVs 43 inch', cat: 'Electronics' },
    { id: 2, name: 'Smart TV43', cat: 'Electronics' },
    { id: 3, name: 'Samsung TV 55', cat: 'Electronics' },
    { id: 4, name: 'Plain chair', cat: 'Furniture' },
    { id: 5, name: 'Nokia Phone5', cat: 'Phones' },
  ];
  const t = q => F.search(tvs, q).list.map(p => p.id).join(',');
  for (const q of ['runinga', 'television', 'televisheni']) assert.equal(t(q), '1,2,3', q + ': "TVs", "TV43" and "TV 55" are all televisions');
  assert.equal(t('simu'), '5', '"Phone5" is a phone');
  assert.equal(t('kiti'), '4');
});

test('a run-together model starts where a word of the product starts: "a20" is not the end of "Nokia" and a "20"', () => {
  const models = [
    { id: 1, name: 'Nokia 20' }, { id: 2, name: 'Tecno Pova 10' }, { id: 3, name: 'Tecno Pova 5' },
    { id: 4, name: 'Storage 128GB 5000mAh' }, { id: 5, name: 'Redmi Note 12 Pro' }, { id: 6, name: 'Tecno Spark 10' },
    { id: 7, name: 'Samsung A20' }, { id: 8, name: 'Galaxy A 05' }, { id: 9, name: 'Infinix Hot 12 8GB' },
    { id: 10, name: 'Tecno Spark 10 128 GB' }, { id: 11, name: 'USB 3.0 cable' }, { id: 12, name: 'Galaxy S23 FE' },
    { id: 13, name: 'Galaxy S 23 FE' }, { id: 14, name: 'iPhone 15 Pro' }, { id: 15, name: 'Redmi 5 Gold' },
  ];
  const m = q => { const r = F.search(models, q); return (r.near ? '~' : '') + r.list.map(p => p.id).join(','); };
  // The false matches the first version made, each a last letter of one word meeting the number after it.
  assert.equal(m('a20'), '7', 'not Nokia 20');
  assert.equal(m('a10'), '', 'not Tecno Pova 10');
  assert.equal(m('a5'), '', 'not Tecno Pova 5');
  assert.equal(m('e12'), '', 'not Redmi Note 12');
  assert.equal(m('k10'), '', 'not Tecno Spark 10');
  assert.equal(m('gb5'), '', 'not "128GB 5000mAh"');
  assert.equal(m('128gb'), '4,10', 'not Hot 12 8GB');
  // And what it is for:
  assert.equal(m('a05'), '8', 'A 05');
  assert.equal(m('spark10'), '6,10');
  assert.equal(m('hot12'), '9', 'a name and its number');
  assert.equal(m('usb3'), '11');
  assert.equal(m('s23fe'), '12,13', 'a run of three: S 23 FE');
  assert.equal(m('iphone15'), '14');
  assert.equal(m('15pro'), '14', 'a number and its word');
});

test('a word that is only a name on the page\'s own objects ("constructor") is just a word', () => {
  assert.doesNotThrow(() => F.search([{ name: 'Toy constructor set' }], 'constructor'));
  assert.equal(F.search([{ name: 'Toy constructor set' }, { name: 'Chair' }], 'constructor').list.length, 1);
  for (const w of ['tostring', 'valueof', 'hasownproperty', 'proto', 'prototype']) assert.doesNotThrow(() => F.search([{ name: w }, { name: 'x' }], w), w);
  assert.deepEqual(F.sayings('constructor'), ['constructor']);
});

/* A phone keyboard turns a typed quote, dash or "..." into one non-ASCII character. That is punctuation,
   as "!!" is: nothing typed. It is not a word in another script. */
test('smart punctuation is nothing typed, and a letter of another script is something', () => {
  const shelf = [{ id: 1, name: 'A' }, { id: 2, name: 'Kjøkken' }, { id: 3, name: 'Chai 😀' }, { id: 4, name: '手机' }];
  const whole = q => F.search(shelf, q).list.length === 4;
  for (const q of ['’', '‘', '“', '”', '–', '—', '…', '¿', '¡', '€', '×', '。', '«»', '!!']) assert.ok(whole(q), JSON.stringify(q) + ' is punctuation: the whole shelf');
  assert.deepEqual(F.search(shelf, 'ø').list.map(p => p.id), [2], 'a letter that does not fold: plain text');
  assert.deepEqual(F.search(shelf, '😀').list.map(p => p.id), [3], 'an emoji');
  assert.deepEqual(F.search(shelf, '手机').list.map(p => p.id), [4]);
});

/* WHAT WORKED BEFORE STILL WORKS, AS A PROPERTY. The box used to look for the typed text inside what a
   product says. So whatever a person types that IS a piece of a product's own text must still find
   that product -- however the text is spelt: capitals, accents, punctuation, numbers, another
   script, an emoji, the word "constructor". Random products and random pieces of them, from a
   fixed seed so a failure is the same failure next time. */
test('any piece of a product\'s own text still finds that product', () => {
  let seed = 20261116;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const WORDS = ['samsung', 'galaxy', 'tecno', 'spark', 'phone', 'phones', 'simu', 'saa', 'watch', 'tv', 'tvs', 'cover', 'a05', 'a', '05', '128', 'gb', '128gb', 'pro', 'note', '12', 'mama', 'mama\'s',
    'café', 'müller', 'niño', 'kjøkken', 'straße', '手机', 'قهوة', '😀', 'chai', 'maji', 'peter', 'pete', 'ring', 'solar', 'kiti', 'x10', 's23', 'fe',
    'usb', '3.0', '5g', '100%', 't-shirt', 'a&b', 'co.', '#1', 'constructor', 'tostring', 'sukari', 'dresses'];
  const SEPS = [' ', ' ', ' ', '-', '/', ', ', ' - ', '  '];
  const text = () => { const n = 1 + Math.floor(rnd() * 4); let s = ''; for (let i = 0; i < n; i++) s += (i ? pick(SEPS) : '') + pick(WORDS); return rnd() < 0.3 ? s.toUpperCase() : s; };
  const list = [];
  for (let i = 0; i < 300; i++) list.push({ id: i, name: text(), cat: text(), vendor: text(), location: rnd() < 0.5 ? text() : '', brand: rnd() < 0.5 ? text() : '', model: rnd() < 0.5 ? text() : '' });
  let trials = 0;
  for (let n = 0; n < 2500; n++) {
    const p = pick(list), field = p[pick(['name', 'name', 'cat', 'vendor'])];
    if (!field) continue;
    const a = Math.floor(rnd() * field.length), typed = field.slice(a, a + 1 + Math.floor(rnd() * (field.length - a)));
    if (!typed.trim()) continue;
    trials++;
    assert.ok(F.search(list, typed).list.indexOf(p) !== -1, JSON.stringify(typed) + ' is a piece of ' + JSON.stringify(field) + ' and did not find it');
  }
  assert.ok(trials > 2000, 'the property ran on ' + trials + ' pieces');
});
