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
  assert.match(fnSource('showLanding'), /if \(!unrecorded\) rememberWhere_\(\);/, 'opening the shopfront');
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
  assert.match(enter, /startHintTimer\(S\.hints \|\| \[\], null, !fresh\)/, 'the workspace tips come back with the workspace -- and only a first arrival gets one at once');
  assert.match(shell, /\nfunction applyLogin\(boot\) \{ adoptSession_\(boot\); enterApp_\(\); \}/, 'typing a password is asking for the workspace');
  assert.match(shell, /\nfunction backToApp\(\) \{ enterApp_\(\); \}/, 'Business Manager is the same door');
  // The boot: decided once, before the session is checked, and the shopfront unless told otherwise.
  assert.match(shell, /var was = whereAtBoot_\(\);\s*auth\('me', \{ token: S\.token \}\)\.then\(function \(b\) \{\s*adoptSession_\(b\);\s*if \(was\.app\) enterApp_\(was\.tab\); else showLanding\(\);/);
});

test('a reload that cannot reach the server does not forget the tab; a dead session does end at the shopfront', () => {
  /* Found in review: the page fell back to the shopfront when the server could not be reached,
     wrote "marketplace" down as where the person was, and the next reload -- with the line
     back -- no longer returned them to the tab they had been working on. */
  assert.match(shell, /var dead = \/sign in\|expired\|session\|account\|Please\/i\.test\(e\.message\) \|\| e\.status === 401;\s*if \(dead\) \{ S\.token = ''; store\('boToken', null\); \}\s*showLanding\(!dead\); done\(\);/);
  const d = door({ session: { boWhere: 'app:stock' } });
  // What showLanding(true) leaves alone, a later reload still reads.
  assert.deepEqual(d.whereAtBoot_(), { app: true, tab: 'stock' });
});

test('the workspace\'s tips stop at the door of the shopfront, and the shopfront\'s own come back', () => {
  /* Found in review: entering the workspace now always starts its tips, and nothing stopped
     them on the way out -- so a tip about the till popped up over the marketplace, whose own
     tips could not start while another list was running. */
  const land = fnSource('showLanding');
  assert.match(land, /stopHints\(\);\s*if \(!_market\.products\.length\) loadMarketplace\(\); else startMarketplaceHints\(\);/);
  assert.match(shell, /function startMarketplaceHints\(\) \{ if \(!hintTimer && _market\.hints\) \{ startHintTimer\(_market\.hints, _market\.timings, _mkTipped\); _mkTipped = true; \} \}/,
    'and coming back to it does not fire a tip straight away every time');
});

test('idle sign-out follows the person, not the screen: signed in on the shopfront is still signed in', () => {
  /* It used to act only while the workspace was showing. With a fresh open now landing on the
     marketplace, that would have left a phone signed in for ever just by never opening the
     workspace -- so it goes by whether anybody is signed in at all. */
  assert.match(fnSource('resetIdle'), /setTimeout\(function \(\) \{ if \(S\.user\) \{ showToast\('Signed out due to inactivity\.', '🔒'\); logout\(\); \} \}, _idleMs\)/);
  assert.match(shell, /document\.addEventListener\(ev, function \(\) \{ if \(S\.user && _idleMs\) resetIdle\(\); \}, \{ passive: true \}\)/);
});

test('the update notice reaches a signed-in phone wherever it is resting', () => {
  assert.match(shell, /BO\.recheckUpdate = function \(force\) \{[\s\S]{0,520}if \(!androidApp_\(\) \|\| !S\.user\) return;/,
    'the re-check goes by who is signed in, not by which screen is showing');
});

test('on a phone the menu says who is signed in, since the bar no longer can', () => {
  assert.match(html, /<nav class="sidebar" id="sidebar">\s*<div class="sb-who" id="sbWho"><div class="sb-who-name" id="sbWhoName"><\/div><div class="sb-who-sub" id="sbWhoSub"><\/div><\/div>/);
  assert.match(html, /\.sb-who\{display:none;\}\s*@media\(max-width:768px\)\{\.sb-who\{display:block;/, 'shown on a phone only');
  assert.match(fnSource('adoptSession_'), /wn\.textContent = S\.user\.name[\s\S]{0,120}ws\.textContent = S\.user\.role \+ \(S\.vendor \? ' · ' \+ S\.vendor\.name/);
});

test('a tip meant for one screen cannot go off over another', () => {
  assert.match(fnSource('startHintTimer'), /if \(!quiet\) hintFirst = setTimeout\(function \(\) \{ hintFirst = null; show\(\); \}, 2500\);/);
  assert.match(fnSource('stopHints'), /if \(hintFirst\) \{ clearTimeout\(hintFirst\); hintFirst = null; \}/, 'stopping the tips stops the first one too');
});

test('the sign-in page never takes the cursor out of a box somebody is already typing in', () => {
  /* Found by signing in forty times in a row: twice, the password ended up in the User ID box,
     readable, because the page moved the cursor there 60ms after it appeared. */
  assert.match(fnSource('showLogin'), /if \(c && openReg !== true && !\(at && \/\^\(INPUT\|TEXTAREA\|SELECT\)\$\/\.test\(at\.tagName\)\)\) c\.focus\(\);/);
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

/* ---- the ways out of the page ---------------------------------------------------------
   "Make sure whatever build works like jpg excel pdf location buttons etc." The Android app is
   a WebView, and a WebView refuses, in silence, several things a browser simply does. So every
   way out of the page goes through one block of the shell (BO.openOutside, BO.fileDoor), and
   these tests hold every screen to that -- a new button cannot bring the old fault back. */
import { readdirSync } from 'node:fs';
const PUBLIC_BO = new URL('../public/bo/', import.meta.url).pathname;
/** Every script the page runs, with its comments taken out: what the browser actually executes. */
const code = Object.fromEntries(readdirSync(PUBLIC_BO).filter(f => f.endsWith('.js')).map(f => [f,
  readFileSync(PUBLIC_BO + f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n')]));
const inlineJs = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || []).join('\n') + '\n' + (html.match(/on[a-z]+="[^"]*"/g) || []).join('\n');

test('no button opens a window by itself: a WebView refuses one once the tap is five seconds old', () => {
  for (const [file, src] of Object.entries(code)) {
    const hits = (src.match(/window\.open\(/g) || []).length;
    if (file === 'shell.js') continue;
    assert.equal(hits, 0, file + ' calls window.open; use BO.openOutside (another app or site) or BO.fileDoor (a file)');
  }
  assert.doesNotMatch(inlineJs, /window\.open\(/, 'an onclick in index.html calls window.open');
  // In the shell it appears twice, and only inside the two doors.
  const a = code['shell.js'].indexOf('BO.openOutside = function'), b = code['shell.js'].indexOf('\n};', code['shell.js'].indexOf('BO.fileDoor = function'));
  assert.ok(a > 0 && b > a, 'the shell lost its doors');
  const outside = code['shell.js'].slice(0, a) + code['shell.js'].slice(b);
  assert.doesNotMatch(outside, /window\.open\(/, 'window.open is called in the shell outside BO.openOutside / BO.fileDoor');
  assert.equal((code['shell.js'].slice(a, b).match(/window\.open\(/g) || []).length, 2);
});

test('a file is always a real https address: nothing made inside the page is handed to the phone to save', () => {
  for (const [file, src] of Object.entries(code)) {
    assert.doesNotMatch(src, /createObjectURL|\.download\s*=(?!=)|setAttribute\('download'|msSaveBlob/, file + ' saves a file that exists only in the page; the app cannot fetch it');
    assert.doesNotMatch(src, /intent:\/\//, file + ' uses an intent: link');
  }
  // The one canvas-to-picture in the page is the photo being shrunk before it is UPLOADED.
  const pics = Object.entries(code).filter(([, src]) => /toDataURL\(/.test(src)).map(([f]) => f);
  assert.deepEqual(pics, ['shell.js']);
  assert.match(code['shell.js'], /cb\(c\.toDataURL\('image\/jpeg', 0\.86\)\)/);
});

test('a report goes through the door that was opened at the tap, under the name the server gave it', () => {
  assert.match(code['reports.js'], /var door = BO\.fileDoor\(format === 'pdf'\);\s*srv\('reportTicket', a\)\.then\(function \(r\) \{ if \(st\) st\.textContent = ''; door\.go\(r\.url, r\.filename\); \}\)\.catch\(function \(e\) \{ if \(st\) st\.textContent = ''; door\.close\(\); BO\.fail\(e\); \}\);/);
  const door = code['shell.js'].slice(code['shell.js'].indexOf('BO.fileDoor = function'));
  // In the app: the app's own downloader when it has one, the hidden frame when it does not -- never a new window.
  assert.match(door, /if \(typeof app\.download === 'function'\) \{ app\.download\(absUrl_\(url\), String\(name \|\| ''\)\); handed = true; \}/);
  assert.match(door, /if \(!handed\) saveFrame_\(url\);/);
  // In a browser the tab for a PDF is opened while the tap is fresh, and cut loose from this page.
  assert.match(door, /if \(!app && inTab\) \{\s*try \{\s*win = window\.open\('', '_blank'\);\s*if \(win\) \{\s*win\.opener = null;/);
  assert.match(door, /win\.document\.close\(\);/, 'the waiting page is finished, not left spinning');
  /* Found in review: a person who closed the "Preparing..." tab was sent the report in the APP'S
     own tab instead, over whatever they were doing. In-place is only for no tab at all. */
  assert.match(door, /if \(win\) \{[\s\S]*?if \(win\.closed\) \{ showToast\([^)]*tap PDF again[^)]*\); return; \}\s*try \{ win\.location\.href = url; return; \} catch \(e\) \{\}\s*\}\s*window\.location\.href = url;/);
  // A frame that loads instead of downloading is the server refusing: it is read out, not lost.
  const frame = fnSource('saveFrame_');
  assert.match(frame, /f\.onload = function \(\) \{[\s\S]*JSON\.parse\(said\)[\s\S]*BO\.fail\(new Error\(/);
  assert.match(frame, /f\.style\.display = 'none'/);
  /* One frame per file. A shared one dropped the first download when a second was asked for
     before the phone had been handed the first (tap PDF, then Excel). */
  assert.match(frame, /var f = document\.createElement\('iframe'\);/);
  assert.doesNotMatch(frame, /getElementById\(/, 'the save frame must not be looked up and reused');
  assert.match(frame, /setTimeout\(gone, 180000\);/, 'and each is cleared away later, so they do not pile up');
});

test('WhatsApp, a map or a mail app: in the app the address is simply gone to, and the app hands it on', () => {
  const out = code['shell.js'].slice(code['shell.js'].indexOf('BO.openOutside = function'), code['shell.js'].indexOf('function absUrl_'));
  assert.match(out, /if \(androidApp_\(\)\) \{ window\.location\.href = url; return; \}/);
  assert.match(out, /if \(!w\) window\.location\.href = url;/, 'a browser that blocks new tabs still gets there');
  assert.match(code['receipt.js'], /BO\.openOutside\('https:\/\/wa\.me\/\?text=' \+ encodeURIComponent\(t\)\)/);
  assert.match(code['shell.js'], /BO\.openOutside\('https:\/\/wa\.me\/' \+ WA_NUMBER \+ '\?text=' \+ encodeURIComponent\(text\)\)/);
  // The app sends every address that is not this system's to the phone -- which is what makes that work.
  assert.match(java, /for \(String allowed : IN_APP_HOSTS\) \{\s*if \(host\.equals\(allowed\) \|\| host\.endsWith\("\." \+ allowed\)\) return false;\s*\}/);
  assert.match(java, /try \{ startActivity\(new Intent\(Intent\.ACTION_VIEW, u\)\); \}/);
  for (const host of ['wa.me', 'google.com', 'maps.app.goo.gl', 'goo.gl']) assert.doesNotMatch(/IN_APP_HOSTS = \{([\s\S]*?)\};/.exec(java)[1], new RegExp('"' + host.replace(/\./g, '\\.') + '"'), host + ' must leave the app, not open inside it');
});

test('Print works in the app that has the door, and an older app is told to update, not left silent', () => {
  const print = code['receipt.js'].slice(code['receipt.js'].indexOf('function print()'), code['receipt.js'].indexOf('function androidApp()'));
  assert.match(print, /if \(typeof app\.print !== 'function'\) \{ showToast\('Update the app to print from it\. For now use Copy or Share\.'/);
  assert.match(print, /document\.body\.classList\.add\('printing-receipt'\);[\s\S]*app\.print\('Receipt ' \+/);
  assert.match(print, /document\.addEventListener\('visibilitychange', back\);/, 'the receipt-only styling stays on while the phone\'s print screen is open');
  /* Found in review: one print's three-minute backstop was left armed and went off in the middle
     of the next print, so the whole app page was printed instead of the receipt. */
  assert.match(print, /var off = function \(\) \{ clearTimeout\(guard\);/, 'the backstop is put out when its own print ends');
  assert.match(print, /guard = setTimeout\(function \(\) \{ if \(!document\.hidden\) off\(\); \}, 180000\);/, 'and never fires while the print screen is still open');
  const inApp = print.slice(0, print.indexOf('window.print()'));
  assert.match(inApp, /if \(app\) \{[\s\S]*return;\s*\}/, 'window.print() is never reached inside the app, where it does nothing');
  for (const [file, src] of Object.entries(code)) if (file !== 'receipt.js') assert.doesNotMatch(src, /window\.print\(/, file + ' prints without asking whether it is in the app');
  const door = /@JavascriptInterface public void print\(final String title\) \{[\s\S]*?\n        \}/.exec(java);
  assert.ok(door, 'the app lost its print door');
  assert.match(door[0], /getSystemService\(Context\.PRINT_SERVICE\)/);
  assert.match(door[0], /web\.createPrintDocumentAdapter\(job\)/);
  assert.match(door[0], /runOnUiThread/);
});

test('the app saves a file where the phone shows it, fetches it once -- and leaves its own update exactly alone', () => {
  const save = /private void saveFile\(String url, String name\) \{[\s\S]*?\n    \}/.exec(java);
  assert.ok(save, 'the app lost saveFile');
  assert.match(java, /web\.setDownloadListener\(\(url, agent, disposition, mime, size\) -> saveFile\(url, nameFrom\(url, disposition, mime\)\)\);/, 'one way of saving, whoever asked');
  assert.match(save[0], /boolean keep = !file\.isEmpty\(\) && !file\.toLowerCase\(Locale\.US\)\.endsWith\("\.apk"\);/,
    'the APK is not moved: updating the app is the one download that must never break');
  assert.match(save[0], /if \(!keep\) throw noSharedFolder;\s*dm\.enqueue\(downloadOf\(url, file, false\)\);/, 'a phone that will not give the shared folder still gets the file, the old way');
  assert.match(java, /if \(toDownloads\) \{\s*req\.setTitle\(file\);\s*req\.setDestinationInExternalPublicDir\(Environment\.DIRECTORY_DOWNLOADS, file\);/);
  // The page's own request to download: this deployment's https addresses only.
  const door = /@JavascriptInterface public void download\(final String url, final String name\) \{[\s\S]*?\n        \}/.exec(java);
  assert.ok(door, 'the app lost its download door');
  assert.match(door[0], /if \(!isOurOrigin\(url\)\) \{/);
  assert.match(door[0], /saveFile\(url, name\);/);
  /* Found in review: the download manager reads the destination back as an address, so "%2F"
     in a name is a slash again and "#" cuts the name short. Neither survives. */
  assert.match(/private static String cleanName\(String name\) \{[\s\S]*?\n    \}/.exec(java)[0], /<>\|%#/, 'cleanName must strip % and # as well as the path characters');
  // A PDF is served "inline; filename=...", which Android's own helper does not read.
  assert.match(java, /Pattern\.compile\("\(\?i\)filename\\\\s\*=\\\\s\*\\"\?\(\[\^\\";\]\+\)\\"\?"\)/);
  for (const imp of ['android.os.Environment', 'android.print.PrintAttributes', 'android.print.PrintManager', 'android.webkit.URLUtil', 'android.content.Context', 'java.util.regex.Matcher', 'java.util.regex.Pattern'])
    assert.ok(java.includes('import ' + imp + ';'), 'missing import ' + imp);
});

test('"Use my current location" tries the satellites, then what the phone already knows -- a shop is indoors', () => {
  const pin = code['users.js'].slice(code['users.js'].indexOf('function pinHere()'), code['users.js'].indexOf('function saveProfile()'));
  assert.match(pin, /navigator\.geolocation\.getCurrentPosition\(found, function \(err\) \{\s*if \(err && err\.code === 1\) \{ failed\(err\); return; \}\s*navigator\.geolocation\.getCurrentPosition\(found, failed, \{ enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 \}\);\s*\}, \{ enableHighAccuracy: true, timeout: 12000, maximumAge: 0 \}\);/);
  // And the app answers the phone's permission question exactly once, for this system's pages only.
  assert.match(java, /if \(!isOurOrigin\(origin\)\) \{ cb\.invoke\(origin, false, false\); return; \}/);
  assert.match(java, /s\.setGeolocationEnabled\(true\);/);
});

/* ---- the shopfront: what the customer says first, and what a card costs to draw ------- */
test('the first message carries the price, in Kiswahili unless the customer chose English', () => {
  const ask = (p, picked) => new Function('load', 'fmtFull', fnSource('mkSpeaksSwahili_') + '\n' + fnSource('mkAskText_') + '\nreturn mkAskText_;')(
    k => (k === 'boLangPick' ? (picked || '') : 'en'),            // boLang itself is always set; only a PRESSED button counts
    n => Number(n).toLocaleString('en-US'))(p);
  const watch = { vendor: 'Baraka Shop', name: 'Quartz Wrist Watch', price: 45000, currency: 'TZS' };
  assert.equal(ask(watch), 'Habari Baraka Shop, nimeona "Quartz Wrist Watch" kwa 45,000 TZS kwenye soko la Samaritan Industrial. Je, bado ipo?');
  assert.equal(ask(watch, 'en'), 'Hello Baraka Shop, I saw "Quartz Wrist Watch" at 45,000 TZS on the Samaritan Industrial marketplace. Is it still available?');
  assert.match(ask({ ...watch, currency: 'KES' }), /^Hello /, 'a shop that does not price in shillings is written to in English');
  assert.match(ask({ ...watch, currency: 'KES' }, 'sw'), /^Habari /, 'unless the customer chose Kiswahili');
  assert.match(ask({ vendor: 'Lodge', name: 'Room', price: 50000, currency: 'TZS', listingType: 'Rent', priceUnit: 'per night' }, 'en'), /at 50,000 TZS per night on/);
  // A language button that was PRESSED is remembered apart from the default the page paints at every open.
  assert.match(fnSource('setLang'), /if \(picked\) store\('boLangPick', l\);/);
  assert.match(fnSource('toggleLang'), /setLang\(S\.lang === 'sw' \? 'en' : 'sw', true\);/);
  assert.match(html, /onclick="setLang\('en',true\)"[\s\S]*onclick="setLang\('sw',true\)"/);
  assert.match(shell, /\n  setLang\(S\.lang\); applyTheme\(S\.theme\); applyView\(S\.view\);/, 'the open itself is not a choice');
});

test('a customer with airtime and no bundle can still reach the shop: Call and SMS beside WhatsApp', () => {
  const detail = fnSource('openProductDetail');
  assert.match(detail, /reach\('btn-secondary', 'pdCall', 'tel:\+' \+ phone, [^)]*, '📞', 'Call'\)/);
  assert.match(detail, /reach\('btn-secondary', 'pdSms', 'sms:\+' \+ phone \+ '\?&body=' \+ encodeURIComponent\(ask\), [^)]*, '✉️', 'SMS'\)/, 'the one spelling Android and iPhone both read, saying the same thing as WhatsApp');
  assert.match(detail, /reach\('btn-primary', 'pdWhatsApp', 'https:\/\/wa\.me\/' \+ phone \+ '\?text=' \+ encodeURIComponent\(ask\), [^)]*, '📲', 'WhatsApp', true\)/);
  assert.match(detail, /contact \+= '<div class="pd-go' \+ \(wa \? '' : ' pd-go-solo'\) \+ '">' \+ wa \+ go \+ ring \+ '<\/div>';/);
  /* EVERY BUTTON SAYS WHAT IT IS, AND ALL FOUR FIT ONE LINE OF A PHONE. Call and SMS were first a
     picture each, a thumb wide -- which squeezed the words out of WhatsApp and Location at 360px;
     then two to a line -- which covered the price. So each button is its picture ABOVE its word. */
  assert.match(detail, /<span class="pd-ico">' \+ ico \+ '<\/span><span class="pd-lbl">' \+ word \+ '<\/span><\/a>'/);
  assert.match(html, /\.pd-go > a\{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;/);
  assert.match(html, /\.pd-go \.pd-lbl\{font-size:\.68rem;font-size:clamp\(\.62rem,3\.1vw,\.74rem\);font-weight:700;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;\}/,
    'the word shrinks on the narrowest phone instead of being cut, with a plain size first for an old browser');
  assert.match(html, /\.pd-go\{display:flex;gap:6px;[^}]*position:sticky;/, 'one line, and it stays in view');
  assert.doesNotMatch(html + detail, /pd-ic\b/, 'no picture-only contact button');
  assert.match(detail, /'<div id="pdPrice" /, 'the price has a name, so the browser check can ask whether the buttons cover it');
  // tel: and sms: are not this system's addresses, so the app hands them to the phone like any other.
  assert.doesNotMatch(/IN_APP_HOSTS = \{([\s\S]*?)\};/.exec(java)[1], /tel|sms/);
});

test('a card\'s photo is fetched when it is looked at, and small where the shop\'s photo has a small copy', () => {
  const page = fnSource('renderMarketPage');
  assert.match(page, /<img class="mk-pic" loading="lazy" decoding="async" alt="" src="' \+ esc\(mkThumb_\(img\)\) \+ '" data-full="' \+ esc\(img\) \+ '" onerror="mkPicFailed_\(this\)">/);
  assert.doesNotMatch(page, /background-image:url/, 'a background is fetched for every card at once, at full size');
  assert.match(page, /<span class="mk-ph">🛍️<\/span>/, 'the bag is underneath, for a photo that never arrives');
  const failed = fnSource('mkPicFailed_');
  assert.match(failed, /img\.setAttribute\('data-tried', '1'\); img\.src = full; return;/, 'the small copy failing falls back to the photograph, once');
  assert.match(failed, /img\.parentNode\.removeChild\(img\)/, 'and then to the bag -- never a broken-image icon');
  assert.match(html, /\.mk-pic\{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;/);
  assert.match(read('public/bo/products.js'), /BO\.smallPicture\(bag\[n\], 400, resolve\)[\s\S]{0,200}if \(small\) a\.thumb_url = small;/, 'the phone sends the small copy with the photo');
});

test('the search box understands, and owns up when it is only showing the closest', () => {
  const filter = fnSource('filterMarket');
  assert.match(filter, /if \(window\.BOFind\) \{ var found = BOFind\.search\(list, typed\); list = found\.list; if \(found\.near\) _mkNear = typed; \}/);
  assert.match(filter, /else list = list\.filter\(/, 'a page whose search script did not load still searches the plain way');
  assert.match(fnSource('paintMkNear_'), /var on = !!_mkNear && \(_mkFiltered \|\| \[\]\)\.length > 0;/);
  assert.match(html, /<div id="mkNearBar" class="mk-simbar hidden">/);
  assert.match(html, /<script src="\/bo\/shell\.js"><\/script>\s*<script src="\/bo\/find\.js"><\/script>/);
});

