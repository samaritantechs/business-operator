/* =====================================================================================
   NAV-BY-NAV AUDIT, AS A PERMANENT GUARD -- the same guard HOPE PMO carries.

   Both halves of every door are checked here, so a broken one fails the suite instead of
   the shop floor:

     the WIRING   every server-function name the page calls -- srv() for signed-in work,
                  auth() for the account, mk() for the marketplace -- must exist on the
                  matching registry, and every registered function must be reachable from
                  the page (or be one of the named exceptions below);
     the VIEWS    every nav button has a tab panel and a BO.tabs registration, every
                  BOxxx.method() the markup calls is exported by that tab, every BO.helper
                  the tabs use is defined by the shell, and every bare onclick handler in
                  the page is a shell function;
     the ANSWERS  every registered function answers a MANAGER, an ADMIN and a SELLER on an
                  EMPTY book and on the rich one -- a result, or a clean refusal (an
                  AppError with a 4xx status) -- never a crash. A tab whose first request
                  throws TypeError is a spinner. A RESTRICTED vendor gets a 403 with
                  `restricted: true` on every write, whatever the page shows.
   ===================================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { emptyBook, richBook, bookDb, userOf, NOW, MANAGER, ADMIN1, SELLER1, ADMIN3 } from './_book.mjs';

delete process.env.RESEND_API_KEY;                 // email jobs must refuse cleanly, not send
const { boApi, BO_FUNCTIONS, WRITE_FNS } = await import('../api/_lib/bo-core.js');
const { accountApi, ACCOUNT_FUNCTIONS } = await import('../api/_lib/bo/account.js');
const { marketApi, MARKET_FUNCTIONS } = await import('../api/_lib/bo/market.js');

const PUBLIC = new URL('../public/', import.meta.url).pathname;
const html = readFileSync(join(PUBLIC, 'index.html'), 'utf8');
const tabFiles = readdirSync(join(PUBLIC, 'bo')).filter(f => f.endsWith('.js')).sort();
const tabs = Object.fromEntries(tabFiles.map(f => [f, readFileSync(join(PUBLIC, 'bo', f), 'utf8')]));
const shell = tabs['shell.js'];
const everything = html + '\n' + Object.values(tabs).join('\n');
const names = (src, rx) => [...new Set([...src.matchAll(rx)].map(m => m[1]))];

/* ------------------------------------------------------------------ the wiring */
test('every srv() name the page calls is a registered signed-in function', () => {
  const called = names(everything, /\bsrv\('([A-Za-z]+)'/g);
  assert.ok(called.length > 50, 'the extractor stopped seeing srv() calls -- fix the regex, not the page');
  const missing = called.filter(n => !BO_FUNCTIONS.includes(n));
  assert.deepEqual(missing, [], 'the page calls server functions no registry knows -- these tabs would spin for ever: ' + missing.join(', '));
});

test('every auth() name is an account function and every mk() name a marketplace function', () => {
  const a = names(everything, /\bauth\('([A-Za-z]+)'/g);
  assert.ok(a.length >= 5, 'the extractor stopped seeing auth() calls');
  assert.deepEqual(a.filter(n => !ACCOUNT_FUNCTIONS.includes(n)), []);
  const m = names(everything, /\bmk\('([A-Za-z]+)'/g);
  assert.ok(m.length >= 2, 'the extractor stopped seeing mk() calls');
  assert.deepEqual(m.filter(n => !MARKET_FUNCTIONS.includes(n)), []);
});

/* Two functions are answered by the page through other doors and are kept for the API's own
   sake: `boot` is what auth('login') and auth('me') already return, and `businessProfile` is
   the vendor row the boot payload carries (the Account tab edits it through
   setBusinessProfile and reads the fresh row back from that answer). Anything else that is
   registered and never called is a feature that was ported on the server and forgotten on
   the page -- exactly what this test is for. */
const SERVER_ONLY = ['boot', 'businessProfile'];
test('every registered function is reachable from the page (or is a named server-side door)', () => {
  const literal = new Set([...names(everything, /\bsrv\('([A-Za-z]+)'/g), ...names(everything, /'(email[A-Z][A-Za-z]+)'/g)]);
  const orphans = BO_FUNCTIONS.filter(n => !literal.has(n) && !SERVER_ONLY.includes(n));
  assert.deepEqual(orphans, [], 'registered on the server, unreachable from the page: ' + orphans.join(', '));
  assert.deepEqual(SERVER_ONLY.filter(n => !BO_FUNCTIONS.includes(n)), [], 'SERVER_ONLY names a function that no longer exists');
});

/* ------------------------------------------------------------------ the views */
test('every nav button has a panel and a tab registration, and every registration has a nav', () => {
  const navs = names(html, /id="nav-([a-z]+)"/g);
  assert.ok(navs.length >= 12, 'the extractor stopped seeing nav buttons');
  const panels = new Set(names(html, /id="tab-([a-z]+)"/g));
  const registered = new Set(names(Object.values(tabs).join('\n'), /\bBO\.tabs\.([a-z]+)\s*=/g));
  assert.deepEqual(navs.filter(n => !panels.has(n)), [], 'nav buttons with no tab-<name> panel');
  assert.deepEqual(navs.filter(n => !registered.has(n)), [], 'nav buttons whose tab never registers BO.tabs.<name> -- the panel would stay empty');
  assert.deepEqual([...registered].filter(n => !navs.includes(n)), [], 'BO.tabs registrations with no nav button');
  const switched = names(everything, /switchTab\('([a-z]+)'/g);
  assert.deepEqual(switched.filter(n => !navs.includes(n)), [], 'switchTab() targets with no nav');
  // Every panel names the content element its tab renders into.
  for (const n of navs) assert.ok(new RegExp('id="' + (n === 'sale' ? 'sale' : n === 'mgrreports' ? 'mgrReports' : n) + 'Content"').test(html), n + ' has its content element');
});

/** The keys of a tab's `return { ... }` -- what the markup may call on BOxxx. */
function exportsOf(src) {
  const at = src.lastIndexOf('\n  return {');
  if (at < 0) return null;
  const block = src.slice(at, src.indexOf('};', at));
  return new Set([...block.matchAll(/(\w+)\s*:/g)].map(m => m[1]));
}
test('every BOxxx.method() the markup calls is exported by that tab, and every BO.helper by the shell', () => {
  const spaces = {};
  for (const [f, src] of Object.entries(tabs)) {
    const m = src.match(/window\.(BO[A-Z][A-Za-z]*) = \(function/);
    if (!m) continue;
    const ex = exportsOf(src);
    assert.ok(ex && ex.size, f + ' has a return block the extractor can read');
    spaces[m[1]] = ex;
  }
  assert.ok(Object.keys(spaces).length >= 11, 'eleven namespaces');
  const bad = [];
  for (const m of everything.matchAll(/\b(BO[A-Z][A-Za-z]*)\.([A-Za-z_]\w*)\s*\(/g)) {
    if (!spaces[m[1]]) { bad.push(m[1] + ' (no such namespace)'); continue; }
    if (!spaces[m[1]].has(m[2])) bad.push(m[1] + '.' + m[2]);
  }
  assert.deepEqual([...new Set(bad)], [], 'methods called on a tab that does not export them: ' + [...new Set(bad)].join(', '));
  const shellHas = new Set([...names(shell, /\bBO\.([A-Za-z_]\w*)\s*=/g), 'tabs', 'S']);
  const used = names(everything.replace(/BO\.tabs\.[a-z]+/g, ''), /\bBO\.([A-Za-z_]\w*)/g);
  assert.deepEqual(used.filter(n => !shellHas.has(n)), [], 'BO.<helper> used but never defined by the shell');
});

/* THE CDN CAN BE AWAY. Bootstrap is loaded from jsdelivr, and when that does not answer --
   a bad connection, a network that blocks it -- `bootstrap` is undefined. The modal helpers
   used to call it straight, so Edit Product, Sell, Add User and every confirmation threw
   ReferenceError and did NOTHING, silently, which reads as a frozen app rather than a missing
   stylesheet. openModal/closeModal must go through hasBootstrap() and fall back. */
test('a missing Bootstrap CDN cannot kill the modals', () => {
  assert.match(shell, /function hasBootstrap\(\)/, 'the guard is gone');
  for (const fn of ['openModal', 'closeModal']) {
    const at = shell.indexOf('function ' + fn + '(');
    assert.ok(at > 0, fn + ' moved -- update this guard');
    const body = shell.slice(at, shell.indexOf('\n}', at));
    assert.match(body, /hasBootstrap\(\)/, fn + ' calls Bootstrap without checking it is there');
  }
  // And the fallback needs its own styling, or the modal "opens" invisibly.
  assert.match(html, /\.modal\.bo-fb\s*\{/, 'index.html lost the .bo-fb fallback CSS');
  assert.match(shell, /data-bs-dismiss="modal"/, 'without Bootstrap the dismiss buttons need wiring too');
});

test('every bare onclick / onchange / onkeypress handler in the markup is a shell function', () => {
  const defined = new Set([...names(shell, /^function ([A-Za-z_]\w*)\(/gm), ...names(shell, /\bwindow\.([A-Za-z_]\w*)\s*=/g)]);
  const builtins = new Set(['alert', 'confirm', 'prompt', 'parseInt', 'parseFloat', 'Number', 'String', 'Boolean', 'setTimeout', 'clearTimeout', 'encodeURIComponent', 'decodeURIComponent', 'open']);
  const bad = new Set();
  for (const src of [html, ...Object.values(tabs)]) {
    for (const h of src.matchAll(/\son(?:click|change|input|keypress|keyup|keydown|submit|error|load)=(?:\\?")([^"]*)\\?"/g)) {
      for (const c of h[1].matchAll(/(^|[^.\w$])([A-Za-z_]\w*)\s*\(/g)) {
        const fn = c[2];
        if (/^(BO|this|event|document|window|if|function|return)$/.test(fn) || builtins.has(fn) || defined.has(fn)) continue;
        bad.add(fn);
      }
    }
  }
  assert.deepEqual([...bad], [], 'handlers pointing at functions the shell does not define: ' + [...bad].join(', '));
});

/* ------------------------------------------------------------------ the answers */
const BOOK = richBook();
const who = { MANAGER: userOf(BOOK, MANAGER), ADMIN: userOf(BOOK, ADMIN1), SELLER: userOf(BOOK, SELLER1), LOCKED: userOf(BOOK, ADMIN3) };

function clean(fn, label) {
  return e => {
    const ok = e && typeof e.status === 'number' && e.status >= 400 && e.status < 500;
    assert.ok(ok, fn + ' crashed for ' + label + ' instead of answering or refusing cleanly: ' + (e && (e.stack || e.message)));
    return true;
  };
}

for (const [bookName, book] of [['an EMPTY book', emptyBook], ['the rich book', richBook]]) {
  for (const [label, user] of Object.entries(who)) {
    test('every registered function answers ' + label + ' on ' + bookName + ' -- or refuses cleanly', async () => {
      for (const fn of BO_FUNCTIONS) {
        try { await boApi(bookDb(book()), user, fn, {}, NOW); }
        catch (e) { clean(fn, label)(e); }
      }
    });
  }
}

test('a RESTRICTED vendor is refused every write at the server, flagged so the page shows the notice', async () => {
  const db = bookDb();
  for (const fn of WRITE_FNS) {
    if (fn === 'suggestion') continue;                                   // the one door left open, on purpose
    let got = null;
    try { await boApi(db, who.LOCKED, fn, {}, NOW); } catch (e) { got = e; }
    assert.ok(got && got.status === 403 && got.restricted === true, fn + ' was not refused with restricted:true for a locked vendor');
  }
  // ...and a manager is never locked out by a vendor flag.
  let reads = 0;
  for (const fn of BO_FUNCTIONS) if (!WRITE_FNS.has(fn)) { try { await boApi(db, who.LOCKED, fn, {}, NOW); reads++; } catch (e) { clean(fn, 'LOCKED')(e); } }
  assert.ok(reads > 10, 'a restricted vendor can still read their screens');
});

test('every account and marketplace function answers an anonymous caller cleanly', async () => {
  for (const book of [emptyBook, richBook]) {
    for (const fn of ACCOUNT_FUNCTIONS) {
      try { await accountApi(bookDb(book()), fn, {}, NOW); } catch (e) { clean(fn, 'anonymous')(e); }
    }
    for (const fn of MARKET_FUNCTIONS) {
      try { await marketApi(bookDb(book()), fn, {}, NOW); } catch (e) { clean(fn, 'anonymous')(e); }
    }
  }
  const home = await marketApi(bookDb(), 'market', {}, NOW);
  assert.ok(Array.isArray(home.products) && home.products.length > 0, 'the marketplace lists the rich book');
});
