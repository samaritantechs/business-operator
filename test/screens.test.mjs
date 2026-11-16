/* =====================================================================================
   WHAT THE PAGE PROMISES ON A PHONE, AND AT THE DOOR.
   =====================================================================================
   Three things that were each right in the code and wrong in somebody's hand:

     - the app was drawn at three quarters of its size on every phone, because one bar across
       the top was wider than the screen, and the Sell row's boxes were too narrow to read;
     - a saved session went straight to the dashboard, when the order is that a fresh open
       lands on the marketplace and only an app that was never closed goes back to where the
       person was;
     - two buttons in "Get the app" did nothing inside the Android app.

   tools/smoke.mjs drives all of it in a real browser (npm run dev, then node tools/smoke.mjs).
   These are the parts that can be held without one -- the rule itself is RUN here, lifted out
   of the page, not matched as text. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = read('public/index.html');
const shell = read('public/bo/shell.js');
const sell = read('public/bo/sell.js');
const java = read('android/app/src/main/java/com/samaritantechs/industrial/MainActivity.java');

/** The body of one top-level function of the shell, as text. */
function fnSource(name) {
  const a = shell.indexOf('\nfunction ' + name + '(');
  assert.ok(a >= 0, 'the shell lost ' + name);
  const b = shell.indexOf('\n}\n', a);
  return shell.slice(a + 1, b + 2);
}

/* ---- where a fresh open lands -------------------------------------------------------- */
/** rememberWhere_ and whereAtBoot_, run against a pretend browser. */
function door({ session = {}, local = {}, search = '', sessionBroken = false } = {}) {
  const sessionStorage = {
    getItem: k => { if (sessionBroken) throw new Error('blocked'); return k in session ? session[k] : null; },
    setItem: (k, v) => { if (sessionBroken) throw new Error('blocked'); session[k] = String(v); },
  };
  const make = new Function('S', 'sessionStorage', 'window', 'load', 'store',
    fnSource('rememberWhere_') + '\n' + fnSource('whereAtBoot_') + '\nreturn { rememberWhere_: rememberWhere_, whereAtBoot_: whereAtBoot_ };');
  const S = { screen: 'landing', tab: 'dashboard', user: null };
  const fns = make(S, sessionStorage, { location: { search } }, k => local[k] || '', (k, v) => { if (v == null) delete local[k]; else local[k] = String(v); });
  return { S, session, local, ...fns };
}

test('a fresh open lands on the marketplace; the same browser session goes back to where it was', () => {
  // Nothing remembered in this tab: a fresh open -- even though the phone knows where they last were.
  assert.deepEqual(door({ local: { boWhereLast: 'app:products' } }).whereAtBoot_(), { app: false, tab: '' },
    'what the phone remembers from another day must never turn a fresh open into a resume');
  // The tab was reloaded while they were working.
  assert.deepEqual(door({ session: { boWhere: 'app:products' } }).whereAtBoot_(), { app: true, tab: 'products' });
  // The tab was reloaded while they were on the shopfront.
  assert.deepEqual(door({ session: { boWhere: 'market' }, local: { boWhereLast: 'app:stock' } }).whereAtBoot_(), { app: false, tab: '' });
  // A browser that will not let the page keep a session is a fresh open every time, never a crash.
  assert.deepEqual(door({ sessionBroken: true, local: { boWhereLast: 'app:stock' } }).whereAtBoot_(), { app: false, tab: '' });
});

test('an app Android is bringing back -- not starting -- returns to the screen and tab it was on', () => {
  assert.deepEqual(door({ search: '?resume=1', local: { boWhereLast: 'app:stock' } }).whereAtBoot_(), { app: true, tab: 'stock' });
  assert.deepEqual(door({ search: '?resume=1', local: { boWhereLast: 'market' } }).whereAtBoot_(), { app: false, tab: '' },
    'they were on the shopfront when it was put away, so that is where it comes back');
  assert.deepEqual(door({ search: '?resume=1' }).whereAtBoot_(), { app: true, tab: '' },
    'with nothing written down (the first run after this shipped) it is the workspace, as it always was');
  assert.deepEqual(door({ search: '?resume=1', session: { boWhere: 'market' }, local: { boWhereLast: 'app:stock' } }).whereAtBoot_(), { app: false, tab: '' },
    'a live session record is newer than anything the phone kept, and wins');
  assert.deepEqual(door({ search: '?x=1&resume=10' }).whereAtBoot_(), { app: false, tab: '' }, 'resume=10 is not resume=1');
  // The app says which it is: saved state exists only when Android put the app away itself.
  assert.match(java, /web\.loadUrl\(state != null \? APP_URL \+ "\?resume=1" : APP_URL\);/);
  assert.match(java, /protected void onCreate\(Bundle state\)/);
});

test('an address that asks for the sign-in page, from somebody already signed in, is the workspace', () => {
  assert.deepEqual(door({ search: '?login=1' }).whereAtBoot_(), { app: true, tab: '' });
  assert.deepEqual(door({ search: '?login=1', session: { boWhere: 'market' } }).whereAtBoot_(), { app: true, tab: '' });
});

test('where a person is, is written down as they move -- and the phone forgets it at sign-out', () => {
  const d = door();
  d.rememberWhere_();
  assert.equal(d.session.boWhere, 'market');
  assert.equal(d.local.boWhereLast, undefined, 'a visitor who is not signed in leaves nothing on the phone');
  d.S.user = { name: 'Asha' }; d.S.screen = 'app'; d.S.tab = 'sale';
  d.rememberWhere_();
  assert.equal(d.session.boWhere, 'app:sale');
  assert.equal(d.local.boWhereLast, 'app:sale');
  d.S.screen = 'landing';
  d.rememberWhere_();
  assert.equal(d.local.boWhereLast, 'market');
  // Every way of moving writes it down.
  assert.match(fnSource('showLanding'), /rememberWhere_\(\);/, 'opening the shopfront');
  assert.match(fnSource('switchTab'), /if \(S\.screen === 'app'\) rememberWhere_\(\);/, 'changing tab');
  assert.match(fnSource('enterApp_'), /rememberWhere_\(\);/, 'walking into the workspace');
  assert.match(fnSource('logout'), /store\('boWhereLast', null\)/, 'and signing out forgets it');
});

test('being signed in and standing in the workspace are two steps, and only a sign-in does both', () => {
  const adopt = fnSource('adoptSession_'), enter = fnSource('enterApp_');
  // Adopting a session shows nothing and loads nothing.
  assert.doesNotMatch(adopt, /show_\(|switchTab\(|showLanding\(|showAnnouncement\(|showLoader\(/, 'adoptSession_ must not change the screen or load a tab');
  assert.match(adopt, /applyRestrictionUI\(boot\.restriction\)/, 'a restricted business is still locked');
  assert.match(adopt, /startIdleTimer\(/, 'and the idle sign-out still runs');
  // Entering opens a tab the first time only, and prefers the one they were on.
  assert.match(enter, /var fresh = !S\.entered; S\.entered = true;/);
  assert.match(enter, /var btn = navOpen_\(tab\) \|\| firstNav_\(\);/, 'the remembered tab only if their role still has it');
  assert.match(enter, /startHintTimer\(S\.hints \|\| \[\]\)/, 'the workspace tips come back with the workspace');
  assert.match(shell, /\nfunction applyLogin\(boot\) \{ adoptSession_\(boot\); enterApp_\(\); \}/, 'typing a password is asking for the workspace');
  assert.match(shell, /\nfunction backToApp\(\) \{ enterApp_\(\); \}/, 'Business Manager is the same door');
  // The boot: decided once, before the session is checked, and the shopfront unless told otherwise.
  assert.match(shell, /var was = whereAtBoot_\(\);\s*auth\('me', \{ token: S\.token \}\)\.then\(function \(b\) \{\s*adoptSession_\(b\);\s*if \(was\.app\) enterApp_\(was\.tab\); else showLanding\(\);/);
});

test('idle sign-out follows the person, not the screen: signed in on the shopfront is still signed in', () => {
  /* It used to act only while the workspace was showing. With a fresh open now landing on the
     marketplace, that would have left a phone signed in for ever just by never opening the
     workspace -- so it goes by whether anybody is signed in at all. */
  assert.match(fnSource('resetIdle'), /setTimeout\(function \(\) \{ if \(S\.user\) \{ showToast\('Signed out due to inactivity\.', '🔒'\); logout\(\); \} \}, _idleMs\)/);
  assert.match(shell, /document\.addEventListener\(ev, function \(\) \{ if \(S\.user && _idleMs\) resetIdle\(\); \}, \{ passive: true \}\)/);
});

test('a tip meant for one screen cannot go off over another', () => {
  assert.match(fnSource('startHintTimer'), /hintFirst = setTimeout\(function \(\) \{ hintFirst = null; show\(\); \}, 2500\);/);
  assert.match(fnSource('stopHints'), /if \(hintFirst\) \{ clearTimeout\(hintFirst\); hintFirst = null; \}/, 'stopping the tips stops the first one too');
});

/* ---- the phone ------------------------------------------------------------------------ */
test('the app\'s top bar fits a phone: the words go, every button stays', () => {
  const m = /@media\(max-width:768px\)\{\s*\.topbar\{padding:0 8px;\}[\s\S]*?\n\}/.exec(html);
  assert.ok(m, 'the phone rules for the top bar are gone');
  assert.match(m[0], /\.tb-name,\.tb-user-info\{display:none !important;\}/, 'the wordmark and the name beside the avatar are what made it too wide');
  assert.match(m[0], /\.topbar \.icon-btn\{width:32px;height:32px;\}/);
  assert.match(html, /@media\(max-width:345px\)\{\.tb-brand\{display:none;\}\}/, 'on the narrowest phones the mark goes before a button does');
  /* The arithmetic, so a seventh button cannot be added without somebody seeing this fail:
     at 320px there is the menu button, the avatar and six buttons, with their gaps and padding. */
  const bar = /<div class="tb-right">([\s\S]*?)<\/div>\s*<\/div>\s*<div class="app-layout">/.exec(html);
  assert.ok(bar, 'the top bar moved');
  const buttons = (bar[1].match(/class="icon-btn"/g) || []).length;
  assert.equal(buttons, 6, 'the top bar has ' + buttons + ' buttons; the phone layout was measured for 6');
  const width = 8 + 36 + (30 + 4) + buttons * 32 + (buttons - 1) * 4 + 8;       // padding, menu, avatar, buttons, gaps, padding
  assert.ok(width <= 320, 'the bar needs ' + width + 'px and the narrowest phone has 320');
  assert.doesNotMatch(bar[1], /display:none[^"]*"[^>]*onclick="logout\(\)"/, 'the way out is never the thing that is hidden');
});

test('on a phone a sale line is a card: every box is named and wide enough to read', () => {
  for (const [cls, label] of [['sr-qty', 'Qty'], ['sr-price', 'Price'], ['sr-disc', 'Discount'], ['sr-total', 'Total']]) {
    assert.match(sell, new RegExp('class="' + cls + '[^"]*"[^>]* data-label="' + label + '"|class="' + cls + "' \\+ [^>]*data-label=\"" + label + '"'), cls + ' lost its name');
  }
  assert.doesNotMatch(sell, /<td style="width:\d+px;/, 'a width written on the cell cannot be taken back by a narrow screen');
  assert.match(sell, /class="form-control disc"/, 'the discount box stays in the page even when its column is hidden: three functions read it');
  const m = /@media \(max-width:640px\)\{\s*\.sale-tbl,\.sale-tbl tbody\{display:block;width:100%;\}[\s\S]*?\n\}/.exec(html);
  assert.ok(m, 'the phone layout of the sale row is gone');
  assert.match(m[0], /\.sale-tbl thead\{display:none;\}/);
  assert.match(m[0], /\.sale-tbl tr\.sale-row\{display:grid;grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(m[0], /\.sale-tbl td\.sr-prod\{grid-column:1\/-1;\}/, 'the product has a line to itself');
  assert.match(m[0], /\.sale-tbl td\[data-label\]::before\{content:attr\(data-label\)/, 'and with the header row gone, each box carries its own name');
  assert.match(html, /\.sale-tbl \.sr-off\{display:none !important;\}/, 'a hidden discount column stays hidden in the card too');
});

/* ---- the two buttons that did nothing inside the app --------------------------------- */
test('"Save this code as a picture" is a real file, so the phone can save it', () => {
  for (const [id, which] of [['mkApkQrBtn', 'app'], ['mkSiteQrBtn', 'site']]) {
    assert.match(html, new RegExp('<a [^>]*id="' + id + '" href="/api/download\\?qr=' + which + '" download="samaritan-industrial-' + which + '-qr\\.png"'),
      id + ' must be a link to the picture the server draws');
  }
  assert.doesNotMatch(html + shell, /toDataURL\('image\/png'\)[\s\S]{0,80}download/, 'a picture that exists only in the page cannot be saved from inside the app');
  assert.doesNotMatch(html, /onclick="downloadQr\(/);
  // The app can only fetch real addresses, and now says so instead of failing in silence.
  assert.match(java, /if \(url == null \|\| !\(url\.startsWith\("https:\/\/"\) \|\| url\.startsWith\("http:\/\/"\)\)\)/);
});

test('"Open in this browser", inside the app, is handed to the phone\'s browser', () => {
  assert.match(html, /id="mkSiteBtn" href="\/" onclick="return openInBrowser\(event\)"/);
  const open = fnSource('openInBrowser');
  assert.match(open, /if \(!app\) return true;/, 'in a browser the link is left to do its ordinary work');
  assert.match(open, /window\.SamaritanApp\.openExternal\(url\)/, 'the app that has the door is asked to use it');
  assert.match(open, /'googlechrome:\/\/navigate\?url=' \+ url;/, 'an older app is given Chrome\'s own address form, with the address as it is');
  assert.doesNotMatch(open, /encodeURIComponent/, 'Chrome reads everything after url= as the address; an encoded one is nonsense');
  assert.doesNotMatch(open.replace(/\/\*[\s\S]*?\*\//g, ''), /intent:\/\//, 'an intent: link to our own host opens inside the app and shows an error page');
  // The door itself: a web address only, never any app on the phone.
  const bridge = /@JavascriptInterface public void openExternal\(final String url\) \{[\s\S]*?\n        \}/.exec(java);
  assert.ok(bridge, 'the app lost openExternal');
  assert.match(bridge[0], /if \(!scheme\.equals\("https"\) && !scheme\.equals\("http"\)\) return;/);
  assert.match(bridge[0], /Intent\.ACTION_VIEW/);
  assert.match(bridge[0], /runOnUiThread/, 'a bridge call arrives off the main thread');
  assert.match(java, /import java\.util\.Locale;/);
});

test('the page asks the app who it is, instead of waiting to be told', () => {
  const who = fnSource('androidApp_');
  assert.match(who, /if \(!a\.versionCode && typeof a\.getVersionCode === 'function'\) \{ a\.versionCode = a\.getVersionCode\(\); a\.versionName = a\.getVersionName\(\); \}/);
  assert.match(read('public/bo/receipt.js'), /function androidApp\(\) \{ return !!androidApp_\(\); \}/, 'one way of knowing, not two');
});
