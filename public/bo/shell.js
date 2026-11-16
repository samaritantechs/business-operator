/* =====================================================================================
   BUSINESS OPERATOR -- THE SHELL. Everything the tabs share: state, the wire, the screens.
   =====================================================================================
   Deliberately ES5-plain (var, function, string concatenation): the Android WebView on the
   oldest handset a vendor owns loads this page, and the old APK's WebView is what the street
   QR codes open. No framework, no build step -- what is written here is what is served.

   Tabs live in /bo/<tab>.js and register themselves: BO.tabs.<name> = { load, sync }.
   `load` draws the tab (called the first time it is opened and on every refresh);
   `sync` is the silent auto-refresh (optional). Everything else they need is on `BO` or the
   handful of globals below (srv, esc, fmt, showToast, switchTab...). */

var WA_NUMBER = '255756749261';
var S = { token: '', user: null, vendor: null, perms: {}, timings: {}, branches: [], partners: [], features: {},
  announcement: null, lang: 'en', theme: 'light', view: 'mobile', screen: 'landing', tab: 'dashboard', loaded: {} };
var BO = { tabs: {}, S: S };

/* ------------------------------------------------------------------ storage */
function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
function load(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
S.lang = load('boLang') || 'en';
/* Whatever the pre-paint script in index.html settled on -- a stored choice, else the device's
   own preference. Reading it back from the attribute keeps ONE decision in ONE place; reading
   localStorage again here is how the device preference used to get overwritten with 'dark'
   before the first screen had even drawn. */
S.theme = document.documentElement.getAttribute('data-theme') || load('boTheme') || 'light';
S.view = load('boView') || 'mobile';
S.token = load('boToken') || '';

/* ------------------------------------------------------------------ helpers */
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function fmt(n) { n = Number(n) || 0; if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return n.toLocaleString('en-US'); }
function fmtFull(n) { return (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
function cur() { return (S.vendor && S.vendor.currency) || 'TZS'; }
function money(n) { return fmtFull(n) + ' ' + cur(); }
function digitsOnly(s) { return String(s || '').replace(/[^0-9]/g, ''); }
function isAdmin() { return !!(S.user && (S.user.role === 'admin' || S.user.role === 'assistant-admin')); }
function isManager() { return !!(S.user && (S.user.role === 'manager' || S.user.role === 'assistant-manager')); }
function isSeller() { return !!(S.user && S.user.role === 'seller'); }
function clientIsAdmin() { return isAdmin(); }
function clientIsManager() { return isManager(); }
/* Dates on the East Africa clock, whatever the phone thinks. The server sends UTC instants. */
function eat(iso) { var t = Date.parse(iso); if (!isFinite(t)) return null; return new Date(t + 3 * 3600000); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function fmtDate(iso) { var d = eat(iso); return d ? pad2(d.getUTCDate()) + '/' + pad2(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() : '–'; }
function fmtTime(iso) { var d = eat(iso); return d ? pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) : '–'; }
function fmtDT(iso) { var d = eat(iso); return d ? fmtDate(iso) + ' ' + fmtTime(iso) : '–'; }
function todayKey() { var d = new Date(Date.now() + 3 * 3600000); return d.toISOString().slice(0, 10); }
function daysAgoKey(n) { var d = new Date(Date.now() + 3 * 3600000 - n * 86400000); return d.toISOString().slice(0, 10); }
/* A value going INSIDE an inline handler -- onclick="BOMgr.restrict('NAME')" -- is not made
   safe by esc() alone. The browser HTML-decodes the attribute before JavaScript ever sees it,
   so esc()'s &#39; turns back into an apostrophe and closes the string early: every shop
   called "Mama's Shop" had dead Deactivate and Restrict buttons, and every branch or partner
   with an apostrophe had a dead Edit button. The apostrophe has to survive HTML decoding AS
   an escape, so it becomes the six characters \u0027, which HTML leaves alone and JavaScript
   reads back as one quote. Backslashes first, or they would eat the escape we just added. */
function jsq(s) { return esc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, '\\u0027')); }
BO.jsq = jsq;
BO.esc = esc; BO.fmt = fmt; BO.fmtFull = fmtFull; BO.money = money; BO.cur = cur; BO.fmtDate = fmtDate; BO.fmtTime = fmtTime; BO.fmtDT = fmtDT;
BO.todayKey = todayKey; BO.daysAgoKey = daysAgoKey; BO.digitsOnly = digitsOnly;

/* THE POPUP IN THE CORNER -- a confirmation ("Saved.") or a tip -- AND HOW TO BE RID OF IT.
   It used to be shown by two pieces of code with a timer each, neither of which knew about the
   other: a tip's timer could take down the confirmation that had replaced it, and nothing but
   waiting made either go away. Now there is one popup, one timer, and a finger: drag it any
   way at all and let go, and it leaves in that direction. A tip can stay up for as long as the
   manager set (Settings: hint lifetime), which is a long time to have something sitting on top
   of the button you were about to press.

   A TAP STILL GOES STRAIGHT THROUGH IT, as it always has. The popup comes up over the bottom
   corner of the till the moment a sale is recorded, and a seller serving a queue taps the next
   thing without waiting for it to leave -- so it must never swallow that tap. That is why the
   popup itself takes no touches at all (pointer-events:none, as before) and the dragging is
   watched for on the page instead: a touch that STARTS on the popup and then MOVES is a drag,
   and belongs to the popup; one that does not move is a tap, and belongs to whatever is under
   it. A drag shorter than SWIPE_GONE_PX springs back, so a nudge does not lose the message. */
var _toastTimer = null, SWIPE_GONE_PX = 46, SWIPE_START_PX = 8;
function toastEl_() { return document.getElementById('hintToast'); }
function toastHide_() {
  var t = toastEl_(); if (!t) return;
  clearTimeout(_toastTimer); _toastTimer = null;
  t.classList.remove('show'); t.classList.remove('drag'); t.style.transform = ''; t.style.opacity = '';
}
function toastShow_(msg, icon, ms) {
  var t = toastEl_(); if (!t) return;
  wireToastSwipe_();
  t.querySelector('.hint-icon').textContent = icon;
  document.getElementById('hintText').textContent = msg;
  t.classList.remove('drag'); t.style.transform = ''; t.style.opacity = '';
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(toastHide_, ms);
}
function wireToastSwipe_() {
  if (wireToastSwipe_.done) return; wireToastSwipe_.done = true;
  var on = false, dragging = false, sx = 0, sy = 0, dx = 0, dy = 0;
  var begin = function (x, y) {
    var t = toastEl_(); on = false; dragging = false;
    if (!t || !t.classList.contains('show')) return;
    var r = t.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
    on = true; sx = x; sy = y; dx = 0; dy = 0;
  };
  /** true once this touch has become a drag of the popup (and so is no longer the page's). */
  var move = function (x, y) {
    if (!on) return false;
    var t = toastEl_(); dx = x - sx; dy = y - sy;
    var far = Math.sqrt(dx * dx + dy * dy);
    if (!dragging && far < SWIPE_START_PX) return false;             // still a tap, as far as anyone can tell
    dragging = true; t.classList.add('drag');
    t.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    t.style.opacity = String(Math.max(0.3, 1 - far / 240));
    return true;
  };
  /** Lets go. `thrown` is false when the touch was taken away (a call came in): it springs back. */
  var finish = function (thrown) {
    if (!on) return false;
    var t = toastEl_(), was = dragging, far = Math.sqrt(dx * dx + dy * dy);
    on = false; dragging = false;
    if (!was) return false;
    t.classList.remove('drag');                                      // the transition is back: it animates from here
    if (thrown && far >= SWIPE_GONE_PX) {
      clearTimeout(_toastTimer);
      t.style.transform = 'translate(' + dx * 4 + 'px,' + dy * 4 + 'px)'; t.style.opacity = '0';
      _toastTimer = setTimeout(toastHide_, 260);
    } else { t.style.transform = ''; t.style.opacity = ''; }
    return true;
  };
  var first = function (e) { return e.touches && e.touches.length === 1 ? e.touches[0] : null; };
  document.addEventListener('touchstart', function (e) { var p = first(e); if (p) begin(p.clientX, p.clientY); else on = false; }, true);
  // Not passive: once it is a drag of the popup the page underneath must not scroll with it.
  document.addEventListener('touchmove', function (e) { var p = first(e); if (p && move(p.clientX, p.clientY) && e.cancelable) e.preventDefault(); }, { capture: true, passive: false });
  // Ending a DRAG must not also press whatever the finger came up over; ending a tap must.
  document.addEventListener('touchend', function (e) { if (finish(true) && e.cancelable) e.preventDefault(); }, true);
  document.addEventListener('touchcancel', function () { finish(false); }, true);
  document.addEventListener('mousedown', function (e) { if (e.button === 0) begin(e.clientX, e.clientY); }, true);
  /* With a mouse, a press that starts over a link or a picture UNDER the popup would otherwise
     become the browser's own drag-and-drop of that link, which takes the mouse away from the
     page: no more moves, no release, and the popup left hanging half-dragged. */
  document.addEventListener('dragstart', function (e) { if (on) e.preventDefault(); }, true);
  document.addEventListener('selectstart', function (e) { if (on) e.preventDefault(); }, true);
  document.addEventListener('mousemove', function (e) { if (on) move(e.clientX, e.clientY); }, true);
  document.addEventListener('mouseup', function () {
    if (!finish(true)) return;
    var eat = function (ev) { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener('click', eat, true);                   // the click a mouse drag ends with
    setTimeout(function () { document.removeEventListener('click', eat, true); }, 0);
  }, true);
}
function showToast(msg, icon) { toastShow_(msg, icon || '✅', 2800); }
BO.toast = showToast;

/* Bootstrap modals, by id, without every tab re-learning the API. */
/* MODALS WITHOUT BOOTSTRAP.
   Bootstrap comes from a CDN. When that CDN is unreachable -- a shop on a bad connection, a
   network that blocks jsdelivr, a captive portal -- `bootstrap` is simply not defined, and the
   old one-liner here threw ReferenceError on every modal: Edit Product, Sell, Add User and the
   confirmations all did NOTHING, with no message, for as long as the CDN stayed away. A dead
   button that looks like a hang is the worst failure this app has, so the modal now falls back
   to showing itself with the app's own CSS (.modal.bo-fb in index.html). */
function hasBootstrap() { try { return typeof bootstrap !== 'undefined' && !!(bootstrap && bootstrap.Modal); } catch (e) { return false; } }
function openModal(id) {
  var el = document.getElementById(id); if (!el) return;
  if (hasBootstrap()) { bootstrap.Modal.getOrCreateInstance(el).show(); return; }
  el.classList.add('bo-fb');
  document.body.classList.add('bo-fb-open');
}
function closeModal(id) {
  var el = document.getElementById(id); if (!el) return;
  if (hasBootstrap()) { var m = bootstrap.Modal.getInstance(el); if (m) m.hide(); return; }
  el.classList.remove('bo-fb');
  if (!document.querySelector('.modal.bo-fb')) document.body.classList.remove('bo-fb-open');
}
/* The dismiss buttons are Bootstrap's own attributes, so without it they need wiring too:
   the X and Cancel buttons, a click on the backdrop, and Escape. Registered once, and inert
   whenever Bootstrap did load. */
document.addEventListener('click', function (ev) {
  if (hasBootstrap()) return;
  var t = ev.target;
  var dismiss = t && t.closest && t.closest('[data-bs-dismiss="modal"]');
  var open = document.querySelector('.modal.bo-fb');
  if (!open) return;
  if (dismiss) { closeModal(open.id); return; }
  if (t === open) closeModal(open.id);            // the backdrop is the .modal element itself
});
document.addEventListener('keydown', function (ev) {
  if (ev.key !== 'Escape' || hasBootstrap()) return;
  var open = document.querySelector('.modal.bo-fb');
  if (open) closeModal(open.id);
});
BO.openModal = openModal; BO.closeModal = closeModal;
/** A tab's own modal markup, appended to the body exactly once. */
BO.ensureModal = function (id, html) {
  if (document.getElementById(id)) return;
  var d = document.createElement('div'); d.innerHTML = html; while (d.firstChild) document.body.appendChild(d.firstChild);
};
/** The shared generic modal: BO.dialog({ title, body, footer, size: 'lg' }). Returns nothing; close with BO.closeDialog(). */
BO.dialog = function (o) {
  document.getElementById('boModalTitle').innerHTML = o.title || '';
  document.getElementById('boModalBody').innerHTML = o.body || '';
  var f = document.getElementById('boModalFooter'); f.innerHTML = o.footer || ''; f.style.display = o.footer ? '' : 'none';
  var dlg = document.getElementById('boModalDialog'); dlg.className = 'modal-dialog modal-dialog-centered modal-dialog-scrollable' + (o.size === 'lg' ? ' modal-lg' : '');
  openModal('boModal');
};
BO.closeDialog = function () { closeModal('boModal'); };

/* ------------------------------------------------------------------ asking the person something
   WINDOW.CONFIRM, WINDOW.ALERT AND WINDOW.PROMPT DO NOT WORK INSIDE THE ANDROID APP. An Android
   WebView with no WebChromeClient set does not merely skip the dialog: confirm() returns FALSE and
   prompt() returns NULL, immediately, with nothing on screen at all. So every button guarded by
   `if (!BO.confirm(...)) return;` did NOTHING when tapped in the app -- Add Product, Deactivate,
   Restock, Cancel Sale, Restrict, Waive, twenty-seven of them -- and alert() was a silent no-op, so
   the explanation of why never appeared either. A dead button that looks like a hang is the worst
   failure this app has; it is the same lesson as hasBootstrap() above, one layer down.

   So the app asks in its OWN PAGE. That works in a browser, in the app, and in a WebView with no
   chrome client at all, because it is nothing but a div -- and it reaches every phone the moment
   this deploys, rather than waiting for everybody to install a new APK. It also stacks above an
   open modal, which the shared #boModal cannot do.

   CONFIRM AND PROMPT TAKE A CALLBACK, because an in-page dialog cannot block the way the native
   one did. The old `if (!BO.confirm(m)) return;` shape is gone from every call site, and
   test/navs.test.mjs fails the build if it ever comes back: a missed one is another button that
   silently does nothing, which is precisely the bug being fixed. */
function askOverlay(o) {
  var host = document.createElement('div');
  host.className = 'bo-ask';
  host.innerHTML = '<div class="bo-ask-card" role="alertdialog" aria-modal="true">'
    + '<div class="bo-ask-msg"></div>'
    + (o.prompt ? '<input class="form-control bo-ask-input" type="text">' : '')
    + '<div class="bo-ask-btns">'
    + (o.noCancel ? '' : '<button type="button" class="btn-secondary bo-ask-no">' + esc(o.cancelText || 'Cancel') + '</button>')
    + '<button type="button" class="btn-primary bo-ask-yes">' + esc(o.okText || 'OK') + '</button>'
    + '</div></div>';
  /* textContent, never innerHTML: these messages carry product names, people's names and
     cancellation reasons that a user typed. The line breaks survive via white-space:pre-wrap. */
  host.querySelector('.bo-ask-msg').textContent = o.message == null ? '' : String(o.message);
  var input = host.querySelector('.bo-ask-input');
  if (input && o.value) input.value = o.value;
  document.body.appendChild(host);

  var done = false;
  function finish(answer) {
    if (done) return;                       // Enter plus a tap must not answer twice
    done = true;
    document.removeEventListener('keydown', onKey, true);
    if (host.parentNode) host.parentNode.removeChild(host);
    if (o.then) o.then(answer);
  }
  function yes() { finish(input ? input.value : true); }
  function no() { finish(input ? null : false); }
  host.querySelector('.bo-ask-yes').addEventListener('click', yes);
  var noBtn = host.querySelector('.bo-ask-no');
  if (noBtn) noBtn.addEventListener('click', no);
  // A tap on the dark ground behind the card is a cancel, as it is everywhere else in the app.
  host.addEventListener('click', function (ev) { if (ev.target === host) no(); });
  function onKey(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); no(); }
    else if (ev.key === 'Enter' && (input || !o.prompt)) { ev.preventDefault(); yes(); }
  }
  document.addEventListener('keydown', onKey, true);
  // Focus the field if there is one, else the safe button, so a keyboard can answer without a mouse.
  setTimeout(function () { (input || host.querySelector('.bo-ask-yes')).focus(); }, 0);
  return host;
}

/** BO.confirm(message, onYes) -- onYes runs only if they agree. Nothing runs if they do not. */
BO.confirm = function (msg, onYes) {
  askOverlay({ message: msg, okText: 'Yes', cancelText: 'Cancel', then: function (ok) { if (ok && onYes) onYes(); } });
};
/** BO.prompt(message, onText) -- onText gets the typed string, or is not called if they cancel.
    Cancelling calls back with null ONLY when the caller asked for it (some screens tell them
    apart); the common case just does nothing, which is what the native prompt's callers did. */
BO.prompt = function (msg, onText, opts) {
  opts = opts || {};
  askOverlay({ message: msg, prompt: true, value: opts.value, okText: opts.okText || 'OK', then: function (v) {
    if (v === null && !opts.onCancel) return;
    if (v === null) { opts.onCancel(); return; }
    if (onText) onText(v);
  } });
};
/** BO.notify(message) -- what alert() used to do, minus the blocking. */
BO.notify = function (msg) { askOverlay({ message: msg, noCancel: true, okText: 'OK' }); };
/* AND THE FORTY-THREE alert() CALLS KEEP WORKING, unedited. Every one of them is followed by a
   `return` that does not depend on the call blocking, so swapping the function under them changes
   nothing except that the message now actually appears on a phone. Overriding a global is a big
   hammer; it is the right size here because the native one is BROKEN in this app's main runtime,
   and leaving forty-three silent no-ops in place to be found one at a time is worse. */
window.alert = function (msg) { BO.notify(msg); };
/** An <input type=file> -> a data: URL, downscaled so a 12-megapixel phone photo does not become a
    9 MB upload. Callback gets (dataUrl|null, error). */
BO.fileToDataUrl = function (input, cb, maxPx) {
  if (!input || !input.files || !input.files[0]) { cb(null, 'No file chosen.'); return; }
  var f = input.files[0];
  if (!/^image\//.test(f.type)) { cb(null, 'Please choose an image (JPG or PNG).'); return; }
  var r = new FileReader();
  r.onload = function (e) {
    var src = e.target.result;
    var img = new Image();
    img.onload = function () {
      var max = maxPx || 1200, w = img.width, h = img.height;
      if (w <= max && h <= max && f.size < 900000) { cb(src); return; }
      var s = Math.min(1, max / Math.max(w, h));
      var c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
      try { c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); cb(c.toDataURL('image/jpeg', 0.86)); }
      catch (err) { cb(src); }
    };
    img.onerror = function () { cb(src); };
    img.src = src;
  };
  r.onerror = function () { cb(null, 'Could not read that file.'); };
  r.readAsDataURL(f);
};
function badgeFor(pay) { return pay === 'Credit' ? 'badge-credit' : pay === 'Lipa Number' ? 'badge-lipa' : 'badge-cash'; }
BO.badgeFor = badgeFor;
function stockBadge(status) { return status === 'OUT' ? '<span class="badge-status badge-out">🔴 OUT</span>' : status === 'LOW' ? '<span class="badge-status badge-low">⚠️ LOW</span>' : '<span class="badge-status badge-ok">✅ OK</span>'; }
BO.stockBadge = stockBadge;

/* ------------------------------------------------------------------ the wire */
/* The host answers a function that ran out of time with its own HTML page; reading that as
   JSON throws "Unexpected token 'A'" -- which looks like a bug in this page. Say what it was. */
function readJson_(r) {
  return r.text().then(function (t) {
    try { return { status: r.status, body: JSON.parse(t) }; }
    catch (e) {
      var slow = r.status === 504 || r.status === 408 || /timed? ?out/i.test(t);
      throw new Error((slow ? 'Seva imechukua muda mrefu mno / the server took too long' : 'Seva imeshindwa kujibu / the server could not answer') + ' — HTTP ' + r.status);
    }
  });
}
function post_(url, payload, timeoutMs) {
  var ctl = window.AbortController ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, timeoutMs || 45000);
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctl ? ctl.signal : undefined })
    .then(function (r) { clearTimeout(timer); return readJson_(r); }, function (e) {
      clearTimeout(timer);
      if (/abort/i.test(String((e && e.message) || e)) || (e && e.name === 'AbortError')) throw new Error('Seva haijibu / the server is not answering. Jaribu tena / try again.');
      throw new Error('Hakuna mtandao / No connection. (' + String((e && e.message) || e) + ')');
    });
}
/** Before a session: login, register, reset, me. */
function auth(fn, args) {
  return post_('/api/auth', { fn: fn, args: args || {} }).then(function (x) {
    if (x.status >= 200 && x.status < 300 && x.body.ok !== false) return x.body;
    throw new Error((x.body && x.body.error) || ('HTTP ' + x.status));
  });
}
/** Every signed-in call. A 401 means the session is gone -> back to the landing page. A
    `restricted` refusal locks the screen the way the banner already says it is. */
function srv(fn, args) {
  return post_('/api/bo', { token: S.token, fn: fn, args: args || {} }).then(function (x) {
    if (x.status >= 200 && x.status < 300 && x.body.ok !== false) return x.body;
    if (x.status === 401 && S.screen === 'app') { showToast('Kikao kimeisha. / Session ended — please sign in again.', '🔒'); logout(true); }
    if (x.body && x.body.restricted) { document.body.classList.add('bo-restricted'); }
    var err = new Error((x.body && x.body.error) || ('HTTP ' + x.status)); err.status = x.status; err.restricted = !!(x.body && x.body.restricted);
    throw err;
  });
}
/** The public marketplace. */
function mk(fn, args) {
  var p = fn === 'market' ? fetch('/api/market').then(readJson_) : post_('/api/market', { fn: fn, args: args || {} });
  return p.then(function (x) { if (x.status >= 200 && x.status < 300 && x.body.ok !== false) return x.body; throw new Error((x.body && x.body.error) || ('HTTP ' + x.status)); });
}
BO.srv = srv; BO.auth = auth; BO.mk = mk;
/** Standard "something went wrong" rendering for a tab. */
BO.errorBox = function (e) { return '<div class="err-box">⚠️ ' + esc((e && e.message) || e) + '</div>'; };
BO.fail = function (e) { showToast(String((e && e.message) || e), '⚠️'); };

/* ------------------------------------------------------------------ language, theme, view */
var T = { en: { signin: 'Sign in to your account', signin_sub: 'Enter your User ID or Email to access the system', userid: 'User ID or Email', password: 'Password', login_btn: 'Sign In' },
  sw: { signin: 'Ingia kwenye akaunti yako', signin_sub: 'Weka kitambulisho au barua pepe kufikia mfumo', userid: 'Kitambulisho au Barua Pepe', password: 'Nywila', login_btn: 'Ingia' } };
function setLang(l) {
  S.lang = l; store('boLang', l);
  var en = document.getElementById('langEn'), sw = document.getElementById('langSw');
  if (en) en.classList.toggle('active', l === 'en'); if (sw) sw.classList.toggle('active', l === 'sw');
  var t = T[l] || T.en;
  ['signin', 'signin_sub', 'userid', 'password', 'login_btn'].forEach(function (k) { var el = document.getElementById('lbl_' + k); if (el) { if (k === 'login_btn') el.lastChild.nodeValue = t[k]; else el.textContent = t[k]; } });
  updateLangUI();
}
function updateLangUI() { var lbl = (S.lang === 'sw') ? 'SW' : 'EN'; var b1 = document.getElementById('langToggleBtn'), b2 = document.getElementById('mkLangBtn'); if (b1) b1.textContent = lbl; if (b2) b2.textContent = lbl; }
function toggleLang() {
  setLang(S.lang === 'sw' ? 'en' : 'sw');
  // One tip straight away in the new language: instant proof the toggle worked.
  var arr = _hintList || [];
  if (arr.length) { var h = arr[Math.floor(Math.random() * arr.length)]; var msg = (S.lang === 'sw' && h.sw) ? h.sw : h.en; toastShow_(msg, S.lang === 'sw' ? '🇹🇿' : '🇬🇧', (hintLifetime || 3) * 1000); }
  else showToast(S.lang === 'sw' ? 'Lugha ya vidokezo: Kiswahili' : 'Tips language: English', '🌐');
}
function applyTheme(t, remember) {
  S.theme = t; document.documentElement.setAttribute('data-theme', t);
  /* Light is the default and dark is a choice, so only a deliberate tap writes anything down.
     applyTheme is also called on every boot to paint the buttons and the status bar, and a boot
     that wrote to storage would turn the default into a decision nobody made. */
  if (remember) store('boTheme', t);
  var b1 = document.getElementById('themeToggleBtn'), b2 = document.getElementById('mkThemeBtn');
  if (b1) b1.textContent = t === 'dark' ? '☀️' : '🌙'; if (b2) b2.textContent = t === 'dark' ? '☀️' : '🌙';
  /* The status bar is part of the app on a phone. Left alone it stays the colour of whichever
     theme loaded first, and a light app then wears a black bar for the rest of the session. */
  var m = document.getElementById('themeColorMeta');
  if (m) m.setAttribute('content', t === 'dark' ? '#0B1120' : '#0B2A6B');
}
/* The dashboard draws its chart with colours read out of the theme, so a theme change has to
   redraw it or the chart keeps the old palette until the next navigation. */
function redrawForTheme() { if (S.screen === 'app' && S.tab === 'dashboard' && BO.tabs.dashboard) BO.tabs.dashboard.load(); }
function toggleTheme() { applyTheme(S.theme === 'dark' ? 'light' : 'dark', true); redrawForTheme(); }
/* Desktop view = the page laid out at 1024px and pinch-zoomable, exactly what the old `?view=`
   reload did -- now a viewport swap and a class, no reload. */
function applyView(v) {
  S.view = v; store('boView', v);
  var m = document.getElementById('viewportMeta');
  if (m) m.setAttribute('content', v === 'desktop' ? 'width=1024, user-scalable=yes, maximum-scale=5' : 'width=device-width, initial-scale=1, maximum-scale=5');
  document.documentElement.classList.toggle('bo-desktop', v === 'desktop');
  var b = document.getElementById('viewToggleBtn');
  if (b) { b.textContent = v === 'desktop' ? '📱' : '🖥️'; b.title = v === 'desktop' ? 'Mtazamo wa simu / Mobile view' : 'Mtazamo wa kompyuta / Desktop view'; }
}
function toggleView() { applyView(S.view === 'desktop' ? 'mobile' : 'desktop'); showToast(S.view === 'desktop' ? 'Desktop view' : 'Mobile view', '🔄'); }

/* ------------------------------------------------------------------ screens */
function show_(id, on) { var el = document.getElementById(id); if (!el) return; el.classList.toggle('hidden', !on); if (id === 'mainApp') el.style.display = on ? 'flex' : 'none'; }
function showLanding() {
  S.screen = 'landing'; show_('loginPage', false); show_('mainApp', false); show_('landingPage', true); window.scrollTo(0, 0);
  /* The same screen serves somebody signed in and somebody who is not, so who it greets is
     decided here, every time it is shown, rather than in whichever function happened to open it. */
  paintMkAccount_();
  rememberWhere_();
  if (!_market.products.length) loadMarketplace(); else startMarketplaceHints();
}
/* WHO IS LOOKING AT THE SHOPFRONT. Signed in: the name, and the way out. Signed out: the two
   doors in. Never both, and never the doors for somebody who is already inside -- which is what
   it used to show, and it read as having been signed out. The "Business Manager" tab on the bar
   needs no painting: it is the workspace for the one and the sign-in page for the other. */
function paintMkAccount_() {
  var inn = document.getElementById('mkAuthIn'), out = document.getElementById('mkAuthOut'), u = S.user;
  if (out) out.classList.toggle('hidden', !!u);
  if (inn) inn.classList.toggle('hidden', !u);
  if (!u) return;
  var nm = document.getElementById('mkAcctName'), av = document.getElementById('mkAcctAv');
  if (nm) nm.textContent = String(u.name || u.handle || 'My account').split(' ')[0];
  if (av) {
    if (u.profile_photo_url) av.innerHTML = '<img src="' + esc(u.profile_photo_url) + '" alt="" onerror="this.remove()">';
    else av.textContent = String(u.name || 'U').split(' ').map(function (w) { return w[0] || ''; }).join('').slice(0, 2).toUpperCase();
  }
}
/* THE MARKETPLACE FROM INSIDE THE APP. It is the same storefront a customer sees, on the same
   page -- no reload and no second sign-in, so a shopkeeper can check how their own listing
   looks and come straight back to the till. The session is untouched throughout. */
function openMarketplace() {
  closeMobileSidebar();
  _mkView = 'market'; _mkSimilar = null;
  showLanding(); paintMkMode_(); if (_market.products.length) filterMarket();
}
/** Straight to what was saved on this phone -- the same shopfront, the other shelf. */
function openFavorites() {
  closeMobileSidebar();
  showLanding(); mkGo('favs');
}
/* Into the workspace from the shopfront. For somebody a fresh open put on the marketplace this
   is the first time the workspace is shown at all, so it is enterApp_ -- which opens their
   first tab then, and changes nothing about the tab they left on every later visit. */
function backToApp() { enterApp_(); }
function showLogin(openReg) {
  S.screen = 'login'; stopHints();
  show_('landingPage', false); show_('mainApp', false); show_('loginPage', true);
  var rf = document.getElementById('regForm'), rl = document.getElementById('regLink');
  if (rf && rl) { rf.style.display = openReg === true ? 'block' : 'none'; rl.textContent = openReg === true ? '– Hide' : '+ Register New Business'; }
  document.getElementById('loginFieldsWrap').style.display = ''; document.getElementById('resetForm').style.display = 'none';
  document.getElementById('lbl_signin').style.display = ''; document.getElementById('lbl_signin_sub').style.display = '';
  window.scrollTo(0, 0);
  /* The cursor is put in the User ID box a moment after the page appears -- unless the person
     is already in a box. Taking it back then moves what they are typing into the wrong field:
     a password typed in that instant used to land after the user id, in plain sight. */
  setTimeout(function () {
    var c = document.getElementById('loginId'), at = document.activeElement;
    if (c && openReg !== true && !(at && /^(INPUT|TEXTAREA|SELECT)$/.test(at.tagName))) c.focus();
  }, 60);
}
function mkScrollTo(id) { var el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth' }); }

/* ------------------------------------------------------------------ the app */
/* =====================================================================================
   SIGNED IN IS ONE THING; STANDING IN THE WORKSPACE IS ANOTHER.
   =====================================================================================
   They used to be the same function, so anybody with a saved session was dropped on their
   dashboard the moment the page loaded. The order was: a fresh open lands on the MARKETPLACE,
   and only an app that was never closed -- or the same browser session -- goes back to where
   the person was. So the two are separate now:

     adoptSession_(boot)   who this is: the state, the name on the bar, which doors their role
                           gets, the lock if the business is restricted, the timers. It shows
                           nothing and loads no tab.
     enterApp_(tab)        walk into the workspace: the first time, open a tab (the one they
                           were on, if a reload brought them back, else the first their role
                           has) and say what a sign-in says -- the loader, the announcement,
                           the update check.

   applyLogin is both, and it is what a person who has just typed a password gets: they asked
   for the workspace. A fresh open with a saved session is adoptSession_ and the shopfront.

   WHAT IT COSTS, AND SAVES. A fresh open no longer loads the dashboard at all until the person
   asks for the workspace (one tap on "Business Manager"), so it spends the marketplace's one
   cached read instead of the dashboard's several. */
function adoptSession_(boot) {
  S.user = boot.user; S.vendor = boot.vendor; S.perms = boot.perms || {}; S.timings = boot.timings || {};
  S.branches = boot.branches || []; S.partners = boot.partners || []; S.features = boot.features || {}; S.announcement = boot.announcement || null;
  S.hints = boot.hints || [];
  if (boot.whatsapp) WA_NUMBER = boot.whatsapp;
  S.loaded = {}; S.entered = false;
  store('boBoot', JSON.stringify({ user: boot.user, vendor: boot.vendor, perms: boot.perms }));
  document.getElementById('displayVendor').textContent = S.vendor ? S.vendor.name : 'System Manager';
  document.getElementById('displayName').textContent = S.user.name; document.getElementById('displayRole').textContent = S.user.role;
  var initials = (S.user.name || 'U').split(' ').map(function (w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
  var av = document.getElementById('topbarAvatar');
  if (S.user.profile_photo_url) av.innerHTML = '<img src="' + esc(S.user.profile_photo_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentNode.textContent=\'' + BO.jsq(initials) + '\'">'; else av.textContent = initials;
  document.getElementById('tbUserInfo').style.display = '';
  /* On a phone the bar has no room for the name, the role or the business, so the menu carries
     them: the first thing in it says who is signed in and where. */
  var wn = document.getElementById('sbWhoName'), ws = document.getElementById('sbWhoSub');
  if (wn) wn.textContent = S.user.name || S.user.handle || '';
  if (ws) ws.textContent = S.user.role + (S.vendor ? ' · ' + S.vendor.name : ' · System Manager');
  if (S.vendor && S.vendor.logo_url) { document.getElementById('customLogoImg').src = S.vendor.logo_url; document.getElementById('customLogoRow').classList.remove('hidden'); }
  /* Which doors this person gets: the role list on each nav item, then the two seller flags. */
  var role = S.user.role;
  document.querySelectorAll('[data-roles]').forEach(function (el) { el.style.display = (el.getAttribute('data-roles').split(' ').indexOf(role) !== -1) ? '' : 'none'; });
  /* PHONE VENDING IS A PER-BUSINESS FEATURE, not a role. A grocery has no handsets to track by
     IMEI and no financing partner to sell a bag of sugar on credit, so the whole tab is hidden
     rather than left there to be wondered about. Switched on per vendor in Management. */
  if (!S.features.phone_vending) { var np = document.getElementById('nav-phone'); if (np) np.style.display = 'none'; }
  if (isSeller() && S.perms.showDashboard === false) document.getElementById('nav-dashboard').style.display = 'none';
  if (isSeller() && !S.perms.canDownloadReport) { document.getElementById('nav-reports').style.display = 'none'; document.querySelector('[data-roles="admin assistant-admin seller"]').style.display = 'none'; }
  applyRestrictionUI(boot.restriction);
  document.getElementById('footerYear').textContent = new Date().getFullYear();
  startAutoSync(S.timings.autoSyncSeconds); startIdleTimer(S.timings.sessionTimeoutMinutes);
}
/** The nav button of a tab this person may open, or null: it must be on show for their role and
    have a panel behind it (Marketplace, Favorites and Log out are doors, not tabs). */
function navOpen_(name) {
  var b = name ? document.getElementById('nav-' + name) : null;
  return (b && b.style.display !== 'none' && document.getElementById('tab-' + name)) ? b : null;
}
function firstNav_() {
  var first = null;
  document.querySelectorAll('.sidebar .nav-item').forEach(function (b) { if (!first && navOpen_(b.id.replace('nav-', ''))) first = b; });
  return first;
}
function enterApp_(tab) {
  if (!S.user) { showLogin(false); return; }
  S.screen = 'app'; stopHints();
  show_('landingPage', false); show_('loginPage', false); show_('mainApp', true);
  window.scrollTo(0, 0);
  var fresh = !S.entered; S.entered = true;
  if (fresh) {
    /* The tab they were on, when a reload or a restored app brought them back and their role
       still has it; otherwise the first one their role has. */
    var btn = navOpen_(tab) || firstNav_();
    switchTab(btn ? btn.id.replace('nav-', '') : 'dashboard', btn);
    var lt = Number(S.timings.loadingTime) || 0; if (lt > 0) showLoader(lt * 1000);
    /* Somebody who signs straight in never loads the shopfront, so the update check has to
       happen here too -- but ONLY inside the app (a browser has no version to be behind, so a
       browser never makes this request and never sees a nag), and only when the shopfront has
       not already asked: its payload carries the same release and checkAppUpdate ran on it. */
    if (androidApp_() && !_mkLoaded) srv('appRelease', {}).then(function (r) { checkAppUpdate(r.release); }).catch(function () {});
    showAnnouncement();
  }
  /* The workspace's own tips. They were started once at sign-in and silenced for good by the
     first visit to the shopfront; now they come back with the workspace -- on their ordinary
     interval. Only the first arrival gets one straight away: a tip two seconds after every
     trip to the marketplace and back is a tip in the way. */
  startHintTimer(S.hints || [], null, !fresh);
  rememberWhere_();
}
function applyLogin(boot) { adoptSession_(boot); enterApp_(); }

/* ------------------------------------------------------------------ where a person was
   "Landing default page should be marketplace unless app was not yet closed from recent apps
   or by browser sessions."

   Two records, because the two cases lose different things:

     sessionStorage.boWhere   lives exactly as long as a browser tab does and survives a reload
                              of it. THIS is "the same browser session": present -> go back to
                              where they were; absent -> a fresh open -> the marketplace.
     localStorage.boWhereLast the same value, kept for the one case the first cannot survive:
                              Android clearing the app out of memory while it is still in the
                              recent-apps list. Coming back builds a new WebView (no session
                              storage), and the app says so by loading the page with ?resume=1
                              (MainActivity: a saved instance state exists). It is read ONLY
                              then, so it can never turn a fresh open into a resume.

   The value is 'market' or 'app:<tab>'. An address that asks for the sign-in page (?login=1)
   from somebody already signed in is an explicit ask for the workspace and wins. */
function rememberWhere_() {
  var w = S.screen === 'app' ? 'app:' + (S.tab || '') : 'market';
  try { sessionStorage.setItem('boWhere', w); } catch (e) {}
  if (S.user) store('boWhereLast', w);
}
function whereAtBoot_() {
  var q = window.location.search, was = '';
  try { was = sessionStorage.getItem('boWhere') || ''; } catch (e) {}
  if (!was && /[?&]resume=1(&|$)/.test(q)) was = load('boWhereLast') || 'app:';
  if (/[?&]login=1(&|$)/.test(q)) was = 'app:';
  return { app: was.indexOf('app') === 0, tab: was.indexOf('app:') === 0 ? was.slice(4) : '' };
}
function switchTab(name, btn) {
  closeMobileSidebar();
  document.querySelectorAll('[id^="tab-"]').forEach(function (el) { el.classList.add('hidden'); });
  var t = document.getElementById('tab-' + name); if (t) t.classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(function (el) { el.classList.remove('active'); });
  if (!btn) btn = document.getElementById('nav-' + name);
  if (btn) btn.classList.add('active');
  S.tab = name;
  var ms = document.getElementById('mainScroll'); if (ms) ms.scrollTop = 0;
  var tab = BO.tabs[name];
  if (tab && !S.loaded[name]) { S.loaded[name] = true; try { tab.load(); } catch (e) { console.error(e); } }
  if (S.screen === 'app') rememberWhere_();
}
BO.reload = function (name) { S.loaded[name] = false; if (S.tab === name) switchTab(name); };
/** Rebuilds the open tab and forgets the others, so their next visit is fresh. */
function refreshData() { S.loaded = {}; switchTab(S.tab); }
function globalRefresh() {
  showToast('Inapakia upya… / Reloading…', '🔄');
  if (S.screen === 'app') { auth('me', { token: S.token }).then(function (b) { S.perms = b.perms || S.perms; S.vendor = b.vendor || S.vendor; S.branches = b.branches || []; S.partners = b.partners || []; S.features = b.features || {}; applyRestrictionUI(b.restriction); refreshData(); }).catch(function () { refreshData(); }); }
  else { _market = { products: [], vendors: [] }; loadMarketplace(); }
}
function logout(silent) {
  var tok = S.token;
  stopHints(); if (_autoSyncTimer) { clearInterval(_autoSyncTimer); _autoSyncTimer = null; } stopIdleTimer();
  try { document.querySelectorAll('.modal.show').forEach(function (m) { var inst = bootstrap.Modal.getInstance(m); if (inst) inst.hide(); }); } catch (e) {}
  try { document.querySelectorAll('.modal-backdrop').forEach(function (b) { b.remove(); }); document.body.classList.remove('modal-open'); document.body.style.removeProperty('overflow'); document.body.style.removeProperty('padding-right'); } catch (e) {}
  S.token = ''; S.user = null; S.vendor = null; S.perms = {}; S.loaded = {}; S.entered = false; S.hints = []; store('boToken', null); store('boBoot', null); store('boWhereLast', null);
  document.body.classList.remove('bo-restricted');
  ['dashboardContent', 'saleContent', 'lendingsContent', 'productsContent', 'stockContent', 'usersContent', 'cashContent', 'reportsContent', 'managerContent', 'mgrReportsContent', 'settingsContent', 'accountContent'].forEach(function (id) { var el = document.getElementById(id); if (el) el.innerHTML = ''; });
  var li = document.getElementById('loginId'); if (li) li.value = ''; var lp = document.getElementById('loginPwd'); if (lp) lp.value = ''; var lm = document.getElementById('loginMsg'); if (lm) lm.innerHTML = '';
  document.getElementById('customLogoRow').classList.add('hidden');
  if (tok && !silent) auth('logout', { token: tok }).catch(function () {});
  showLanding();
  if (!silent) showToast('Signed out.', '👋');
}


/* ------------------------------------------------------------------ first run
   A system nobody has set up yet cannot be signed into, and telling somebody to open a
   terminal is not an answer for a shopkeeper. So when the server reports that no manager
   exists, the sign-in box becomes a setup box instead. The server still demands the
   deployment's own setup key, so finding this screen is not the same as owning the system. */
function showSetup(state) {
  showLogin(false);
  var hide = ['loginFieldsWrap', 'lbl_signin', 'lbl_signin_sub', 'regLink', 'forgotLink'];
  hide.forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
  var f = document.getElementById('setupForm'); if (f) f.style.display = 'block';
  var k = document.getElementById('setupKeyless');
  if (k) k.style.display = (state && state.keyless) ? 'block' : 'none';
  var b = document.getElementById('setupBtn'); if (b) b.disabled = !!(state && state.keyless);
}
function submitSetup() {
  var msg = document.getElementById('setupMsg');
  var v = function (id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; };
  var args = { setup_key: v('setupKey'), name: v('setupName'), handle: v('setupHandle'), email: v('setupEmail'), password: v('setupPwd') };
  if (!args.setup_key || !args.name || !args.handle || !args.email || !args.password) {
    msg.innerHTML = '<div class="alert-danger">Fill in every field.</div>'; return;
  }
  var btn = document.getElementById('setupBtn');
  btn.disabled = true; msg.innerHTML = '<div class="muted">Creating your account…</div>';
  auth('setupManager', args).then(function (b2) {
    S.token = b2.token; store('boToken', S.token);
    var f = document.getElementById('setupForm'); if (f) f.style.display = 'none';
    applyLogin(b2);
    showToast('Welcome. This system is yours to run.', '🎉');
  }).catch(function (e) {
    btn.disabled = false;
    msg.innerHTML = '<div class="alert-danger">' + esc(e.message) + '</div>';
  });
}


/* ------------------------------------------------------------------ the Android app
   The app is a WebView onto this site, so a feature or a fix is on every phone the moment it
   deploys -- nobody is ever sent an APK for an ordinary change. A NEW APK is needed only when
   the web address or the app's allowed-domain list changes.

   The printed QR code therefore points at /download and never at a version: /download looks up
   whichever build is current and redirects. Print the sticker once; it keeps working.

   The app announces itself through window.SamaritanApp, the way HOPE Calls does. A browser has
   no such object, so a browser is never nagged to install anything. */
function androidApp_() {
  try {
    var a = window.SamaritanApp;
    if (!a) return null;
    /* The app publishes versionCode from its onResume, and on a cold start that can run before
       this page exists -- the number then lands on a blank page and is gone, and the page
       believes it is in a browser until the app is next brought forward. The app's own methods
       are on every page it loads, so the page asks for itself rather than wait to be told. */
    if (!a.versionCode && typeof a.getVersionCode === 'function') { a.versionCode = a.getVersionCode(); a.versionName = a.getVersionName(); }
    return a.versionCode ? a : null;
  } catch (e) { return null; }
}
function qrInto(id, text) {
  var box = document.getElementById(id); if (!box) return;
  box.innerHTML = '';
  try {
    var c = document.createElement('canvas');
    box.appendChild(c);
    new QRious({ element: c, value: text, size: 200, level: 'M', background: '#fff', foreground: '#111' });
  } catch (e) {
    // The CDN is away. A person can still read and type the address, which beats an empty box.
    box.innerHTML = '<div class="small" style="color:#111;word-break:break-all;padding:8px;">' + esc(text) + '</div>';
  }
}
/* "SAVE THIS CODE AS A PICTURE" IS A LINK NOW, to a PNG the server draws (/api/download?qr=...).
   It used to build the picture inside the page and click an invisible link to it. A browser
   saves that; the Android app does not -- its downloads go to the phone's download manager,
   which fetches addresses and had nothing to fetch -- so inside the app the button did
   nothing at all. An ordinary https file works in both, including the app already installed
   on every phone. All that is left to do here is say where the file went: the app shows no
   download bar of its own. */
function savingQr() {
  if (androidApp_()) showToast('Inahifadhiwa… / Saving — look in your phone\'s Downloads.', '⬇️');
}
/* "OPEN IN THIS BROWSER", FROM INSIDE THE APP, MEANS THE PHONE'S BROWSER. In a browser the link
   simply opens the shopfront and nothing here interferes. Inside the app that same link only
   reloaded the app, because this system's own address is exactly what the app is built to keep
   to itself -- so the request has to be handed to the phone explicitly:

     the app that has the door     SamaritanApp.openExternal(address)   (MainActivity.Bridge)
     an app installed before that  Chrome's own address form, which the app passes to the phone
                                   like any other foreign link; the address is also copied, in
                                   case the phone has no Chrome to answer.

   NEVER an intent:// link to our own host: the app would try to open it itself and show an
   error page. */
function openInBrowser(ev) {
  var app = androidApp_();
  if (!app) return true;
  if (ev && ev.preventDefault) ev.preventDefault();
  var url = window.location.origin + '/';
  try { if (typeof window.SamaritanApp.openExternal === 'function') { window.SamaritanApp.openExternal(url); return false; } } catch (e) {}
  try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).catch(function () {}); } catch (e) {}
  showToast('Inafungua kivinjari… / Opening your browser. If nothing opens, type ' + url.replace(/^https?:\/\//, '').replace(/\/$/, '') + ' in it.', '🌐');
  /* The address goes in AS IT IS, not percent-encoded: Chrome takes everything after "url=" as
     the address itself, and an encoded one arrives as nonsense. */
  window.location.href = 'googlechrome://navigate?url=' + url;
  return false;
}

/* =====================================================================================
   THE WAYS OUT OF THE PAGE -- in one place, because the Android app can take only some.
   =====================================================================================
   The app is a WebView. Three things a browser does without being asked, it does not do:

     - it opens a new window only while a tap is still fresh (about five seconds). A report is
       asked for, the server takes a moment on a slow line, and by the time the address comes
       back the tap has gone stale -- so window.open() was refused, in silence, and the PDF or
       Excel button did nothing at all;
     - it cannot show a PDF, and it saves nothing itself: every file goes to the phone's
       download manager, which fetches the address a SECOND time -- so each report was built
       twice;
     - an answer that is not a file (the server saying no) replaced the whole app with a line
       of raw text.

   So nothing outside this block calls window.open, and a file is never opened by navigating
   the app itself. test/screens.test.mjs holds every screen to that.

   BO.openOutside(address)   another app or site: WhatsApp, a map, a mail app.
   BO.fileDoor(inTab)        a file that is asked for now and ready in a moment. Call it AT THE
                             TAP, before the request; call .go(address, fileName) when the
                             address arrives, or .close() if it never does. */
BO.openOutside = function (url) {
  /* In the app the address is simply gone to: the app hands every address that is not this
     system's to the phone (WhatsApp, Maps, the dialler) and this page stays where it is. No
     new window is involved, so no tap has to be fresh. */
  if (androidApp_()) { window.location.href = url; return; }
  var w = null; try { w = window.open(url, '_blank'); } catch (e) {}
  if (!w) window.location.href = url;              // a browser that blocks new tabs still gets there
};
function absUrl_(url) { var a = document.createElement('a'); a.href = url; return a.href; }
/* A file through a hidden frame: a download starts and the page does not move. A frame that
   LOADS instead is the server answering with something that is not a file -- its refusal --
   and that is read out and shown, instead of being left invisible or replacing the app.

   EVERY FILE GETS A FRAME OF ITS OWN. One shared frame looked tidier and lost downloads: tap
   PDF and then Excel, and pointing the frame at the second file dropped the first request
   before the phone had been handed anything. A frame is cleared away three minutes later, by
   which time a file that was coming has long since been passed to the download manager. */
function saveFrame_(url) {
  var f = document.createElement('iframe');
  f.className = 'bo-save-frame'; f.setAttribute('aria-hidden', 'true'); f.style.display = 'none';
  var gone = function () { if (f.parentNode) f.parentNode.removeChild(f); };
  f.onload = function () {
    var said = '';
    try { said = (f.contentDocument && f.contentDocument.body && f.contentDocument.body.textContent) || ''; } catch (e) {}
    said = String(said).replace(/^\s+|\s+$/g, '');
    if (!said) return;                             // nothing drawn: the file went to be saved
    var msg = said; try { var j = JSON.parse(said); if (j && j.error) msg = j.error; } catch (e) {}
    gone();
    BO.fail(new Error(String(msg).slice(0, 300)));
  };
  f.src = url;
  document.body.appendChild(f);
  setTimeout(gone, 180000);
}
BO.fileDoor = function (inTab) {
  var app = androidApp_(), win = null;
  /* A browser shows a PDF in a tab of its own, and will only open that tab while the tap is
     fresh -- so it is opened now, empty, and sent to the file when the address arrives. */
  if (!app && inTab) {
    try {
      win = window.open('', '_blank');
      if (win) { win.opener = null; win.document.write('<title>Report</title><p style="font:16px system-ui,sans-serif;padding:28px;color:#333">Inaandaa ripoti… / Preparing the report…</p>'); }
    } catch (e) { win = null; }
  }
  return {
    go: function (url, name) {
      if (app) {
        /* The app with the door downloads the address itself: one request, and a refusal is a
           failed download in the phone's own list rather than a page of text. An app from
           before the door gets the hidden frame, which its download manager picks up. */
        var handed = false;
        try { if (typeof app.download === 'function') { app.download(absUrl_(url), String(name || '')); handed = true; } } catch (e) {}
        if (!handed) saveFrame_(url);
        showToast('Inahifadhiwa… / Saving — look in your phone\'s Downloads.', '⬇️');
        return;
      }
      if (inTab) {
        var shown = false;
        try { if (win && !win.closed) { win.location.href = url; shown = true; } } catch (e) {}
        if (!shown) window.location.href = url;    // new tabs are blocked here: the file opens in this one, Back returns
        return;
      }
      saveFrame_(url);
    },
    close: function () { try { if (win && !win.closed) win.close(); } catch (e) {} }
  };
};
/** Draws the two codes and the download button from whatever the market payload reported. */
function showAppSection(release) {
  var origin = window.location.origin;
  var site = origin + '/', apk = origin + '/download';
  var sec = document.getElementById('mkAppSection'), link = document.getElementById('mkAppLink');
  if (sec) sec.classList.remove('hidden');
  if (link) link.classList.remove('hidden');
  var su = document.getElementById('qrSiteUrl'); if (su) su.textContent = site;
  /* Inside the app there is no "this browser": the button hands the address to the phone's. */
  var sb = document.getElementById('mkSiteBtn'); if (sb && androidApp_()) sb.textContent = 'Open in the phone\'s browser';
  var au = document.getElementById('qrApkUrl'); if (au) au.textContent = apk;
  qrInto('qrSite', site);
  qrInto('qrApk', apk);
  var meta = document.getElementById('mkApkMeta'), btn = document.getElementById('mkApkBtn');
  var published = !!(release && release.version_name);
  var label = published
    ? 'Version ' + release.version_name + (release.size_bytes ? ' · ' + (release.size_bytes / 1048576).toFixed(1) + ' MB' : '')
    : 'Not published yet — use the browser for now.';
  if (meta) meta.textContent = label;
  if (!published && btn) { btn.classList.add('disabled'); btn.setAttribute('aria-disabled', 'true'); }

  /* The same offer, repeated under "Register your business" -- the moment somebody has just
     decided to sign up is the moment to hand them the app, and the section that normally carries
     this button is further down the page than most people scroll.

     It is ALWAYS shown. Hiding it until an APK existed meant a system with no release published
     had nothing at all under its sign-up button, which reads as a broken feature rather than a
     deliberate absence -- and it is why this button "was not there". So the unpublished state is
     a real offer too: every phone can open the site and scan a code, no APK required. It becomes
     the download when there is something to download, and it is never a dead link. */
  var ctaBtn = document.getElementById('mkCtaApkBtn'), ctaMeta = document.getElementById('mkCtaApkMeta');
  if (ctaBtn) {
    ctaBtn.textContent = published ? '⬇️ Download the Android app' : '📲 Use it on your phone';
    ctaBtn.setAttribute('href', published ? '/download' : '#mkAppSection');
    ctaBtn.onclick = published ? null : function () { mkScrollTo('mkAppSection'); return false; };
  }
  if (ctaMeta) {
    ctaMeta.textContent = published
      ? label + ' · installs on any Android phone'
      : 'Scan a code to open it, or install the Android app.';
  }
}
/** The one-line version for the bar along the bottom. */
function appUpdateLine_(release) {
  return 'A newer app is available: ' + release.version_name + (release.notes ? ' — ' + release.notes : '');
}
/* ------------------------------------------------------------- is this phone on an old build?
   THE DOWNLOAD LINK LOOKS AFTER ITSELF. /download redirects to whichever build is current, and
   the workflow publishes a new one the moment android/** changes on main, so the printed QR code
   and the marketplace button stay right forever without anybody touching them. What neither can
   do is reach a phone that ALREADY has an older APK installed. That phone finds out here, or it
   does not find out at all.

   WHY "LATER" LASTS A DAY AND NOT FOREVER. It used to write the version code into boSkipUpdate
   and never ask that handset again: one tap, on the day the notice first appeared, and the shop
   stayed on that build for good. The build people most need is the one that fixes what they are
   about to walk into -- the photo slot was a dead tap for an entire release -- and under the old
   rule the ones who tapped Later were exactly the ones who never heard about it. So Later is a
   snooze now. A phone that is already current is still asked nothing at all, ever.

   AND IT ASKS, rather than only lighting the bar along the bottom. A bar is easy to walk past
   for a week; a question on open is not. Both appear together and both go away together. */
var UPDATE_SNOOZE_MS = 24 * 60 * 60 * 1000;   // how long "Later" buys
var UPDATE_RECHECK_MS = 6 * 60 * 60 * 1000;   // how stale an answer may get before asking again
var _lastUpdateCheck = 0;

/* Stored as "<code>:<expires>". A BARE code is the old forever-skip, and it deliberately reads
   as expired: every phone that dismissed one under the previous build is told exactly once more. */
function updateSnoozed_(code) {
  var parts = String(load('boSkipUpdate') || '').split(':');
  return parts[0] === String(code) && Number(parts[1]) > Date.now();
}

/** Nags only a phone that is actually running an older APK than the published one. */
function checkAppUpdate(release) {
  var app = androidApp_();
  var bar = document.getElementById('appUpdateBar');
  if (!app || !release || !release.version_code) return;
  var running = Number(app.versionCode) || 0;
  // Already current -- and hide the bar, since this may be a re-check after they updated.
  if (!(release.version_code > running)) { if (bar) bar.classList.add('hidden'); return; }
  window._pendingUpdateCode = release.version_code;
  if (updateSnoozed_(release.version_code)) return;
  if (document.querySelector('.bo-ask')) return;   // never stack a second copy of this question
  var txt = document.getElementById('appUpdateText');
  if (txt) txt.textContent = appUpdateLine_(release);
  if (bar) bar.classList.remove('hidden');
  askOverlay({
    message: 'A newer version of the app is ready'
      + (release.version_name ? ' (' + release.version_name + ')' : '') + '.'
      + (release.notes ? '\n\n' + release.notes : '')
      + '\n\nUpdating takes a moment. Nothing you have entered is lost.',
    okText: 'Update now', cancelText: 'Later',
    /* The ground behind the card, and Escape, answer no -- which is Later, a snooze, and not a
       silent refusal that comes straight back on the next screen. */
    then: function (ok) { if (ok) window.location.href = '/download'; else dismissUpdate(); }
  });
}

/** Ask the server again -- but not on every switch back to the app: one bounded read at most
    every six hours, so a phone left open for a week still notices a new build and a phone picked
    up forty times a day is not forty reads. MainActivity.onResume calls this, and so does the
    page's own visibility event, which is what reaches phones still carrying an older APK. */
BO.recheckUpdate = function (force) {
  /* Whoever is signed in, wherever they are looking: a fresh open now rests on the marketplace,
     and a phone that only ever rested there would otherwise never be told about a new build
     after the first look. (A visitor with no session cannot ask -- the shopfront's own load
     checks for them.) */
  if (!androidApp_() || !S.user) return;
  var now = Date.now();
  if (!force && now - _lastUpdateCheck < UPDATE_RECHECK_MS) return;
  _lastUpdateCheck = now;
  srv('appRelease', {}).then(function (r) { checkAppUpdate(r.release); }).catch(function () {});
};

function dismissUpdate() {
  store('boSkipUpdate', String(window._pendingUpdateCode || '') + ':' + (Date.now() + UPDATE_SNOOZE_MS));
  var bar = document.getElementById('appUpdateBar'); if (bar) bar.classList.add('hidden');
}

/* ------------------------------------------------------------------ login / register / reset */
function doLogin() {
  var uid = document.getElementById('loginId').value.trim(), pwd = document.getElementById('loginPwd').value;
  var msg = document.getElementById('loginMsg');
  if (!uid || !pwd) { msg.innerHTML = 'Please enter your credentials.'; return; }
  msg.innerHTML = '<span style="color:var(--muted);">Signing in…</span>';
  auth('login', { id: uid, password: pwd }).then(function (b) {
    S.token = b.token; store('boToken', b.token); msg.innerHTML = '';
    applyLogin(b);
  }).catch(function (e) { msg.innerHTML = esc(e.message); });
}
function forgotPassword() {
  BO.prompt('Enter the email address associated with your account:', function (email) {
    if (!email.trim()) return;
    auth('requestReset', { email: email.trim() }).then(function (r) { alert(r.message); }).catch(function (e) { alert(e.message); });
  });
}
function submitResetPassword() {
  var pwd = document.getElementById('resetNewPwd').value, cpwd = document.getElementById('resetConfirmPwd').value, out = document.getElementById('resetMsg');
  if (!pwd || pwd.length < 4) { out.innerHTML = '<div class="alert-danger">Password must be at least 4 characters.</div>'; return; }
  if (pwd !== cpwd) { out.innerHTML = '<div class="alert-danger">Passwords do not match.</div>'; return; }
  auth('resetPassword', { token: window._resetToken, password: pwd }).then(function (r) {
    out.innerHTML = '<div class="alert-success">' + esc(r.message) + '</div>';
    setTimeout(function () { window.location.replace('/'); }, 2500);
  }).catch(function (e) { out.innerHTML = '<div class="alert-danger">' + esc(e.message) + '</div>'; });
}
function toggleRegForm() { var f = document.getElementById('regForm'), l = document.getElementById('regLink'); var open = f.style.display === 'none'; f.style.display = open ? 'block' : 'none'; l.textContent = open ? '– Hide' : '+ Register New Business'; }
function showRegMsg(msg, color) { var el = document.getElementById('regMsg'); if (!el) return; el.style.color = color || 'var(--text2)'; el.textContent = msg; }
function submitVendorRegistration() {
  if (!document.getElementById('agreeTerms').checked) { showRegMsg('You must agree to the Terms & Conditions.', 'var(--rose)'); return; }
  var g = function (id) { return document.getElementById(id).value.trim(); };
  var a = { business_name: g('regVendorName'), business_type: g('regBusinessType'), phone: g('regBusinessPhone'), address: g('regBusinessAddress'), admin_email: g('regAdminEmail'), admin_name: g('regAdminName'), admin_handle: g('regAdminUserId'), password: document.getElementById('regAdminPwd').value };
  if (!a.business_name || !a.admin_email || !a.admin_name || !a.admin_handle || !a.password) { showRegMsg('Business name, email, name, user ID and password are required.', 'var(--rose)'); return; }
  showRegMsg('Submitting…', 'var(--muted)');
  auth('register', a).then(function (r) { showRegMsg(r.message, 'var(--accent2)'); if (r.active) { document.getElementById('loginId').value = a.admin_handle; } })
    .catch(function (e) { showRegMsg(e.message, 'var(--rose)'); });
}
function showTerms() { document.getElementById('currentYear').textContent = new Date().getFullYear(); openModal('termsModal'); }

/* ------------------------------------------------------------------ marketplace (public) */
var _market = { products: [], vendors: [] }, _mkFilterCat = 'ALL', _mkFilterType = 'ALL', _mkPageSize = 48, _mkShown = 48, _mkFiltered = [];
/* WHICH SHELF IS OPEN: the whole market, or only what this person saved. And, separately, the
   product a "more like this" search is about -- null when there is none. */
var _mkView = 'market', _mkSimilar = null, _mkVendorByName = {}, _mkLoaded = false;
var MK_SAVE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
var MK_LENS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8V6a3 3 0 0 1 3-3h2M16 3h2a3 3 0 0 1 3 3v2M21 16v2a3 3 0 0 1-3 3h-2M8 21H6a3 3 0 0 1-3-3v-2"/><circle cx="12" cy="12" r="3.4"/></svg>';

function paintMkType_() { ['ALL', 'Sale', 'Rent'].forEach(function (k) { var el = document.getElementById('mkType_' + k); if (el) el.classList.toggle('active', k === _mkFilterType); }); }
function setMkType(t) { _mkFilterType = t; paintMkType_(); filterMarket(); }
function loadMarketplace() {
  var grid = document.getElementById('mkProductGrid'); if (grid && !_market.products.length) grid.innerHTML = '<div class="mk-empty">Loading products…</div>';
  mk('market').then(function (d) {
    _market = d || { products: [], vendors: [] }; _mkLoaded = true;
    _mkVendorByName = {}; (_market.vendors || []).forEach(function (v) { _mkVendorByName[v.name] = v; });
    // A reload hands back new objects: the product a "similar" search was about is found again
    // by its id, or the search is dropped if it is no longer on sale.
    if (_mkSimilar) { var sid = String(_mkSimilar.id); _mkSimilar = null; (_market.products || []).forEach(function (p) { if (String(p.id) === sid) _mkSimilar = p; }); }
    renderMarket();
    showAppSection(_market.release);          // the download button and the two printable codes
    checkAppUpdate(_market.release);          // and a nag, only for a phone running an older APK
    if (S.screen === 'landing') startHintTimer(d.hints || [], d.timings);
  })
    .catch(function () { var g = document.getElementById('mkProductGrid'); if (g) g.innerHTML = '<div class="mk-empty">Could not load marketplace. Tap ↻ to retry.</div>'; });
}
function renderMarket() {
  var prods = _market.products || [], vends = _market.vendors || [], cats = {};
  prods.forEach(function (p) { if (p.cat) cats[p.cat] = 1; });
  document.getElementById('mkStatProducts').textContent = prods.length;
  document.getElementById('mkStatVendors').textContent = vends.length;
  document.getElementById('mkStatCats').textContent = Object.keys(cats).length;
  paintMkMode_(); renderMarketCats(); filterMarket();
}
function renderMarketCats() {
  var prods = _market.products || [], catClicks = {}, catCount = {};
  prods.forEach(function (p) { if (p.cat) { catClicks[p.cat] = (catClicks[p.cat] || 0) + (Number(p.clicks) || 0); catCount[p.cat] = (catCount[p.cat] || 0) + 1; } });
  var keys = Object.keys(catCount);
  keys.sort(function (a, b) { var d = (catClicks[b] || 0) - (catClicks[a] || 0); if (d) return d; var c = (catCount[b] || 0) - (catCount[a] || 0); if (c) return c; return a.localeCompare(b); });
  var TOP = 5, top = keys.slice(0, TOP), rest = keys.slice(TOP);
  if (_mkFilterCat !== 'ALL' && rest.indexOf(_mkFilterCat) !== -1) { rest.splice(rest.indexOf(_mkFilterCat), 1); top.push(_mkFilterCat); }
  var chips = '<button class="mk-chip ' + (_mkFilterCat === 'ALL' ? 'active' : '') + '" onclick="setMkCat(\'ALL\')">All</button>';
  top.forEach(function (c) { chips += '<button class="mk-chip ' + (_mkFilterCat === c ? 'active' : '') + '" onclick="setMkCat(this.getAttribute(\'data-cat\'))" data-cat="' + esc(c) + '">' + esc(c) + '</button>'; });
  if (rest.length) {
    var menu = rest.map(function (c) { return '<button type="button" class="mk-more-item' + (_mkFilterCat === c ? ' active' : '') + '" onclick="setMkCat(this.getAttribute(\'data-cat\'))" data-cat="' + esc(c) + '">' + esc(c) + '</button>'; }).join('');
    chips += '<div class="mk-more"><button type="button" class="mk-chip mk-more-btn" onclick="toggleMkMore(event)">More ▾</button><div class="mk-more-menu" id="mkMoreMenu">' + menu + '</div></div>';
  }
  document.getElementById('mkCats').innerHTML = chips;
}
function toggleMkMore(ev) { if (ev) ev.stopPropagation(); var m = document.getElementById('mkMoreMenu'); if (m) m.classList.toggle('open'); }
function setMkCat(c) { _mkFilterCat = c; var mm = document.getElementById('mkMoreMenu'); if (mm) mm.classList.remove('open'); renderMarketCats(); filterMarket(); }
document.addEventListener('click', function (e) { var m = document.getElementById('mkMoreMenu'); if (!m) return; if (!e.target.closest('.mk-more')) m.classList.remove('open'); });

/* ---- favourites: kept on this phone, because a customer has no account to keep them in -----
   A list of product ids in localStorage. It costs the server nothing, it is there the moment
   the page opens, and it survives closing the app. It does NOT follow somebody to another
   phone -- that would take a customer account, which this marketplace deliberately has not got.
   A saved product that has since been taken off sale simply is not shown; its id is kept, so
   it comes back by itself if the shop lists it again. */
var MK_FAV_MAX = 500;
function favMap_() {
  if (!favMap_.m) {
    favMap_.m = {};
    try { var a = JSON.parse(load('boFavs') || '[]'); if (a && a.forEach) a.forEach(function (id) { favMap_.m[String(id)] = 1; }); } catch (e) {}
  }
  return favMap_.m;
}
function isFav_(id) { return !!favMap_()[String(id)]; }
function favShown_() { var m = favMap_(), n = 0; (_market.products || []).forEach(function (p) { if (m[String(p.id)]) n++; }); return n; }
function paintFavCount_() {
  var el = document.getElementById('mkFavCount'); if (!el) return;
  var n = (_market.products || []).length ? favShown_() : Object.keys(favMap_()).length;
  el.textContent = n; el.classList.toggle('hidden', !n);
}
/** Every bookmark on the page for one product: the card's, and the open detail's. */
function paintFav_(id, on) {
  var all = document.querySelectorAll('[data-fav]');
  for (var i = 0; i < all.length; i++) {
    if (all[i].getAttribute('data-fav') !== String(id)) continue;
    all[i].classList.toggle('on', on); all[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    all[i].setAttribute('title', on ? 'Saved — tap to remove' : 'Save to Favorites');
    var lbl = all[i].querySelector('.pd-act-lbl'); if (lbl) lbl.textContent = on ? 'Saved' : 'Save';
  }
}
/* QUIET ON PURPOSE. Saving is something done in passing, twenty times in a row, while looking
   at something else: so the bookmark fills, the count on the Favorites tab moves, and that is
   all. No popup, no page change, and the product is not opened. */
function toggleFav(ev, gi) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  var p = _market.products[gi]; if (!p) return;
  var m = favMap_(), id = String(p.id), on = !m[id];
  if (on) m[id] = 1; else delete m[id];
  store('boFavs', JSON.stringify(Object.keys(m).slice(-MK_FAV_MAX)));
  paintFav_(id, on); paintFavCount_();
  if (!on && _mkView === 'favs') filterMarket(true);        // it leaves the shelf it was taken off
}

/* ---- "more like this": the lens on the photo -------------------------------------------------
   Every product is already on the page, so this asks the server nothing: it scores each one
   against the product that was tapped and shows the ones that score, best first, with the
   tapped product leading so it is plain what they are being compared to.

   It compares what the listing SAYS -- the words of the name, the category, the brand, the
   model -- not what the photo shows. Words a seller typed are a far better guide to "the same
   kind of thing" in a market of a few thousand listings than a picture match would be, and a
   picture match would mean sending every photo somewhere to be looked at. */
var MK_STOP = { and: 1, the: 1, for: 1, with: 1, 'new': 1, of: 1, 'in': 1, pcs: 1, pc: 1, na: 1, ya: 1, wa: 1, za: 1, la: 1, kwa: 1 };
function mkWords_(s) { return String(s || '').toLowerCase().split(/[^a-z0-9À-ɏ]+/).filter(function (w) { return w.length > 1 && !MK_STOP[w]; }); }
function mkSame_(a, b) { return !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase(); }
function mkLikeness_(a, b) {
  var wa = a._w || (a._w = mkWords_(a.name)), wb = b._w || (b._w = mkWords_(b.name)), shared = 0;
  for (var i = 0; i < wa.length; i++) if (wb.indexOf(wa[i]) !== -1) shared++;
  return shared * 3 + (mkSame_(a.cat, b.cat) ? 4 : 0) + (mkSame_(a.brand, b.brand) ? 3 : 0) + (mkSame_(a.model, b.model) ? 2 : 0);
}
function findSimilar(ev, gi) {
  if (ev) { ev.stopPropagation(); ev.preventDefault(); }
  var p = _market.products[gi]; if (!p) return;
  _mkSimilar = p; _mkView = 'market'; _mkFilterCat = 'ALL'; _mkFilterType = 'ALL';
  var s = document.getElementById('mkSearch'); if (s) s.value = '';
  closeModal('productDetailModal');
  paintMkType_(); paintMkMode_(); renderMarketCats(); filterMarket();
  mkScrollTo('mkMarketSection');
}
function clearSimilar() { _mkSimilar = null; paintMkMode_(); filterMarket(); }
/** Typing a search of your own ends the "more like this" one: they are two different questions. */
function mkSearchInput() { if (_mkSimilar) { _mkSimilar = null; paintMkMode_(); } filterMarket(); }

/* ---- the switch on the bar: market / favourites / business manager --------------------------- */
function paintMkMode_() {
  var seg = { market: _mkView !== 'favs', favs: _mkView === 'favs' };
  Object.keys(seg).forEach(function (k) { var el = document.getElementById('mkSeg_' + k); if (el) el.classList.toggle('active', seg[k]); });
  var title = document.getElementById('mkSecTitle'), sub = document.getElementById('mkSecSub');
  if (title) title.textContent = _mkView === 'favs' ? '🔖 Favorites' : '🛍️ Marketplace';
  if (sub) sub.textContent = _mkView === 'favs'
    ? 'What you saved on this phone. Tap the bookmark on any photo to save it or take it off.'
    : 'Tap any product to see details and contact the seller. Viewing is always free.';
  var bar = document.getElementById('mkSimBar'), txt = document.getElementById('mkSimText');
  if (bar) bar.classList.toggle('hidden', !_mkSimilar);
  if (txt && _mkSimilar) txt.textContent = 'Similar to: ' + _mkSimilar.name;
  paintFavCount_();
}
function mkGo(where) {
  if (where === 'app') { if (S.user) backToApp(); else showLogin(false); return; }
  _mkView = where === 'favs' ? 'favs' : 'market'; _mkSimilar = null;
  paintMkMode_(); filterMarket();
  mkScrollTo('mkMarketSection');
}

function filterMarket(keepShown) {
  var q = (document.getElementById('mkSearch').value || '').trim().toLowerCase(), favs = _mkView === 'favs' ? favMap_() : null, like = _mkSimilar;
  var list = (_market.products || []).filter(function (p) {
    if (favs && !favs[String(p.id)]) return false;
    if (_mkFilterType !== 'ALL' && (p.listingType || 'Sale') !== _mkFilterType) return false;
    if (_mkFilterCat !== 'ALL' && p.cat !== _mkFilterCat) return false;
    if (!q) return true;
    return [p.name, p.cat, p.vendor, p.location, p.brand, p.model].some(function (v) { return String(v || '').toLowerCase().indexOf(q) !== -1; });
  });
  if (like) {
    // Best match first; the market's own order (what is in stock and looked at) settles a tie.
    var scored = [];
    list.forEach(function (p, i) { var sc = p === like ? Infinity : mkLikeness_(like, p); if (sc >= 3) scored.push({ p: p, sc: sc, i: i }); });
    scored.sort(function (a, b) { return (b.sc - a.sc) || (a.i - b.i); });
    list = scored.map(function (x) { return x.p; });
  }
  _mkFiltered = list;
  if (!keepShown) _mkShown = _mkPageSize;
  renderMarketPage();
}
function findVendor(name) { return _mkVendorByName[name] || null; }

/* ---- "3 months · 30 sales": what the business has to show for itself -------------------------
   Both numbers come from the server already worked out (api/_lib/bo/market.js): whole days the
   business has been here, and its completed sales -- null when the database could not say, in
   which case nothing is claimed. A business with no sales yet shows only its age: "0 sales" is
   true, but printing it under a shop that opened this morning helps nobody. */
function mkPlural_(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
function mkAge_(days) {
  if (days == null || !isFinite(days) || days < 0) return '';
  if (days < 7) return 'New this week';
  if (days < 30) return mkPlural_(Math.floor(days / 7), 'week');
  if (days < 365) return mkPlural_(Math.max(1, Math.floor(days / 30.44)), 'month');
  var years = Math.floor(days / 365.25), months = Math.floor((days - years * 365.25) / 30.44);
  return (years < 3 && months > 0) ? years + ' yr ' + months + ' mo' : mkPlural_(years, 'year');
}
function mkSales_(n) {
  n = Number(n); if (!isFinite(n) || n <= 0) return '';
  var shown = n < 1000 ? String(n) : n < 10000 ? (Math.floor(n / 100) / 10) + 'k' : Math.floor(n / 1000) + 'k';
  return shown + (n === 1 ? ' sale' : ' sales');
}
function mkTrust_(v) { return v ? [mkAge_(v.ageDays), v.sales == null ? '' : mkSales_(v.sales)].filter(Boolean).join(' · ') : ''; }

function renderMarketPage() {
  var grid = document.getElementById('mkProductGrid'), wrap = document.getElementById('mkLoadMoreWrap'), list = _mkFiltered || [];
  if (!_mkLoaded) return;                       // still "Loading products…": nothing to say about it yet
  if (!list.length) {
    var none = 'No products match your search.';
    if (_mkView === 'favs') {
      none = favShown_()
        ? 'None of your saved products match. Clear the search or pick “All” above.'
        : '🔖 Nothing saved yet.<br>Tap the bookmark on any product photo and it will wait for you here.<br><button class="btn-secondary" style="margin-top:14px;" onclick="mkGo(\'market\')">Browse the marketplace</button>';
    }
    grid.innerHTML = '<div class="mk-empty">' + none + '</div>'; if (wrap) wrap.innerHTML = ''; return;
  }
  var shown = Math.min(_mkShown, list.length), all = _market.products, html = '';
  for (var i = 0; i < shown; i++) {
    var p = list[i], gi = all.indexOf(p), img = p.image1 || p.image2 || p.image3, isRent = (p.listingType || 'Sale') === 'Rent', fav = isFav_(p.id);
    var imgHtml = img ? '<div class="mk-img" style="background-image:url(\'' + BO.jsq(img) + '\');">' : '<div class="mk-img">🛍️';
    imgHtml += (p.stock > 0 ? '<span class="mk-stock">' + (isRent ? 'Available' : 'In stock') + '</span>' : '<span class="mk-stock out">' + (isRent ? 'Booked' : 'Out') + '</span>') + (p.hot ? '<span class="mk-fire">🔥 Hot</span>' : '')
      + '<button type="button" class="mk-ibtn mk-save' + (fav ? ' on' : '') + '" data-fav="' + esc(p.id) + '" aria-pressed="' + (fav ? 'true' : 'false') + '" aria-label="Save to Favorites" title="' + (fav ? 'Saved — tap to remove' : 'Save to Favorites') + '" onclick="toggleFav(event,' + gi + ')">' + MK_SAVE_SVG + '</button>'
      + '<button type="button" class="mk-ibtn mk-lens" aria-label="Find similar products" title="Find similar products" onclick="findSimilar(event,' + gi + ')">' + MK_LENS_SVG + '</button>'
      + '</div>';
    var v = findVendor(p.vendor), trust = mkTrust_(v), vlogo = (v && v.logo) ? '<img src="' + esc(v.logo) + '" onerror="this.style.display=\'none\'">' : '<div class="mk-vinit">' + esc((p.vendor || 'B')[0]).toUpperCase() + '</div>';
    html += '<div class="mk-card" onclick="openProductDetail(' + gi + ')">' + imgHtml + '<div class="mk-cardbody"><div class="mk-cat">' + (isRent ? 'FOR RENT · ' : '') + esc(p.cat || 'General') + '</div><div class="mk-name">' + esc(p.name) + '</div><div class="mk-price">' + fmtFull(p.price) + ' <span style="font-size:.7rem;color:var(--muted);font-weight:600;">' + esc(p.currency || 'TZS') + (isRent && p.priceUnit ? ' ' + esc(p.priceUnit) : '') + '</span></div><div class="mk-cvendor">' + vlogo + '<div class="mk-vtxt"><span>' + esc(p.vendor) + '</span>' + (trust ? '<div class="mk-vmeta">' + esc(trust) + '</div>' : '') + '</div></div></div></div>';
  }
  grid.innerHTML = html;
  var remaining = list.length - shown;
  if (wrap) wrap.innerHTML = remaining > 0 ? '<button class="btn-secondary" onclick="loadMoreMarket()" style="margin-top:14px;">Load more (' + remaining + ' more)</button>' : '';
}
function loadMoreMarket() { _mkShown += _mkPageSize; renderMarketPage(); }
function openProductDetail(idx) {
  var p = _market.products[idx]; if (!p) return;
  try { mk('click', { product_id: p.id }).catch(function () {}); } catch (e) {}
  var v = findVendor(p.vendor) || {}, isRent = (p.listingType || 'Sale') === 'Rent', fav = isFav_(p.id), trust = mkTrust_(v);
  document.getElementById('pdTitle').textContent = p.name;
  var shots = [p.image1, p.image2, p.image3].filter(function (u) { return !!u; });
  var imgs = '<div class="pd-imgs">' + (shots.length
    ? shots.map(function (u, k) { return '<img class="pd-img" src="' + esc(u) + '"' + (k === 0 ? ' onerror="this.outerHTML=\'<div class=\\\'pd-img-ph\\\'>🛍️</div>\'"' : ' onerror="this.remove()"') + '>'; }).join('')
    : '<div class="pd-img-ph">🛍️</div>') + '</div>';
  // The same two things the photo on the card offers, for somebody who opened the product first.
  var acts = '<div class="pd-acts">'
    + '<button type="button" class="pd-act' + (fav ? ' on' : '') + '" data-fav="' + esc(p.id) + '" aria-pressed="' + (fav ? 'true' : 'false') + '" title="' + (fav ? 'Saved — tap to remove' : 'Save to Favorites') + '" onclick="toggleFav(event,' + idx + ')">' + MK_SAVE_SVG + '<span class="pd-act-lbl">' + (fav ? 'Saved' : 'Save') + '</span></button>'
    + '<button type="button" class="pd-act" title="Find similar products" onclick="findSimilar(event,' + idx + ')">' + MK_LENS_SVG + '<span>Similar products</span></button></div>';
  var phone = digitsOnly(p.vendorPhone || v.phone || '');
  var wa = phone ? '<a class="btn-primary" href="https://wa.me/' + phone + '?text=' + encodeURIComponent('Hello ' + p.vendor + ', I am interested in "' + p.name + '" I saw on the Samaritan Industrial marketplace.') + '" target="_blank" rel="noopener">📲 __WA__</a>' : '';
  /* WHERE THE SHOP IS. v.map is the pin the business gave (api/_lib/bo/place.js -- it can only be
     a Google Maps address, the server refuses anything else). A business that gave an address
     but no pin still gets a button, and it is honest about what it does: it searches the map
     for those words, which finds the area and not necessarily the door. */
  var pin = v.map || '', area = (!pin && v.address) ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.vendor + ', ' + v.address) : '';
  var go = pin ? '<a class="btn-secondary" id="pdLocation" href="' + esc(pin) + '" target="_blank" rel="noopener" title="Open the shop in Google Maps">📍 Location</a>'
    : area ? '<a class="btn-secondary" id="pdLocation" href="' + esc(area) + '" target="_blank" rel="noopener" title="Search the shop\'s address in Google Maps">📍 Location</a>' : '';
  // Alone, the WhatsApp button says the whole thing. Beside Location, on one line of a phone, the short word.
  wa = wa.replace('__WA__', go ? 'WhatsApp' : 'Contact seller on WhatsApp');
  // The notes come first and the buttons last, because the buttons stay in view (.pd-go).
  var contact = '';
  if (!wa) contact += '<div class="alert-info" style="margin-top:6px;">This seller has not listed a contact number.</div>';
  if (area) contact += '<div class="small muted" style="margin-top:6px;">📍 Location searches the map for the shop\'s address — ask the seller to confirm the exact place.</div>';
  if (wa || go) contact += '<div class="pd-go">' + wa + go + '</div>';
  document.getElementById('pdBody').innerHTML = imgs + acts
    + '<div style="font-size:.7rem;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.05em;">' + (isRent ? 'FOR RENT · ' : '') + esc(p.cat || 'General') + ((p.brand || p.model) ? ' · ' + esc([p.brand, p.model].filter(Boolean).join(' ')) : '') + '</div>'
    + '<div style="font-size:1.3rem;font-weight:800;color:var(--text);margin:2px 0 4px;">' + esc(p.name) + (p.hot ? ' <span style="font-size:.8rem;color:#EF4444;">🔥 Hot</span>' : '') + '</div>'
    + '<div style="font-size:1.4rem;font-weight:800;font-family:var(--mono);color:var(--accent2);margin-bottom:6px;">' + fmtFull(p.price) + ' ' + esc(p.currency || 'TZS') + (isRent && p.priceUnit ? ' <span style="font-size:.85rem;color:var(--muted);">' + esc(p.priceUnit) + '</span>' : '') + '</div>'
    + '<div style="font-size:.84rem;color:var(--text2);margin-bottom:12px;">' + (isRent ? (p.stock > 0 ? '✅ Available now' : '🔴 Currently booked out') : (p.stock > 0 ? ('✅ ' + p.stock + ' in stock') : '🔴 Currently out of stock')) + '</div>'
    + (p.location ? '<div style="font-size:.82rem;color:var(--text2);margin-bottom:12px;">📍 ' + esc(p.location) + '</div>' : '')
    + '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:6px;"><div style="font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Sold by</div><div style="font-weight:700;color:var(--text);">' + esc(p.vendor) + (v.businessType ? ' <span style="font-weight:500;color:var(--accent);font-size:.8rem;">· ' + esc(v.businessType) + '</span>' : '') + '</div>'
      + (trust ? '<div id="pdTrust" style="font-size:.78rem;color:var(--text2);margin-top:6px;">🏪 ' + esc(/^New/.test(trust) ? trust : 'Here for ' + trust) + '</div>' : '')
      + (v.address ? '<div style="font-size:.78rem;color:var(--text2);margin-top:6px;">📍 ' + esc(v.address) + '</div>' : '') + '</div>'
    + contact;
  openModal('productDetailModal');
}

/* ------------------------------------------------------------------ hints (bilingual tips) */
var hintTimer = null, hintFirst = null, hintLifetime = 5, hintInterval = 300, _hintList = [];
function startHintTimer(hints, timings, quiet) {
  stopHints();
  var t = timings || S.timings || {};
  hintLifetime = Number(t.hintLifetime) || 5; hintInterval = Math.max(10, Number(t.hintInterval) || 300);
  if (!hints || !hints.length) return;
  _hintList = hints;
  var show = function () {
    var h = _hintList[Math.floor(Math.random() * _hintList.length)];
    var msg = (h && typeof h === 'object') ? ((S.lang === 'sw' && h.sw) ? h.sw : h.en) : h;
    toastShow_(msg, '💡', hintLifetime * 1000);
  };
  hintTimer = setInterval(show, hintInterval * 1000);
  /* The first tip is on a short fuse so the list is seen at all -- and the fuse is put out with
     the list, or a tip meant for the workspace goes off over the shopfront two seconds after
     somebody has walked out of it. */
  if (!quiet) hintFirst = setTimeout(function () { hintFirst = null; show(); }, 2500);
}
function stopHints() { if (hintTimer) { clearInterval(hintTimer); hintTimer = null; } if (hintFirst) { clearTimeout(hintFirst); hintFirst = null; } }
function startMarketplaceHints() { if (!hintTimer && _market.hints) startHintTimer(_market.hints, _market.timings); }

/* ------------------------------------------------------------------ auto-sync, idle, restriction */
var _autoSyncTimer = null, _idleTimer = null, _idleMs = 0;
function startAutoSync(sec) { if (_autoSyncTimer) { clearInterval(_autoSyncTimer); _autoSyncTimer = null; } sec = parseInt(sec, 10) || 0; if (sec < 5) return; _autoSyncTimer = setInterval(function () { if (S.screen === 'app') silentSync(); }, sec * 1000); }
function silentSync() {
  if (S.screen !== 'app') return;
  if (!isManager()) srv('restrictionInfo', {}).then(applyRestrictionUI).catch(function () {});
  var tab = BO.tabs[S.tab]; if (tab && tab.sync) { try { tab.sync(); } catch (e) {} }
}
/* IDLE SIGN-OUT FOLLOWS THE PERSON, NOT THE SCREEN. It used to act only while the workspace was
   showing. A fresh open now lands on the marketplace with the session still live, so a phone
   left there would never have been signed out at all -- the timer goes by whether anybody is
   signed in, wherever they are looking. */
function startIdleTimer(mins) { _idleMs = (parseInt(mins, 10) || 0) * 60000; resetIdle(); }
function resetIdle() { if (!_idleMs) { if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; } return; } clearTimeout(_idleTimer); _idleTimer = setTimeout(function () { if (S.user) { showToast('Signed out due to inactivity.', '🔒'); logout(); } }, _idleMs); }
function stopIdleTimer() { if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; } _idleMs = 0; }
['click', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach(function (ev) { document.addEventListener(ev, function () { if (S.user && _idleMs) resetIdle(); }, { passive: true }); });
function applyRestrictionUI(info) {
  var on = !!(info && info.restricted);
  document.body.classList.toggle('bo-restricted', on);
  var bt = document.getElementById('restrictionBannerText'); if (bt && on && info.notice) bt.innerHTML = info.notice;
}
function showAnnouncement() {
  var a = S.announcement; if (!a || !a.enabled || !a.text) return;
  var seen = load('boAnnSeen'); if (seen === String(a.version)) return;
  BO.dialog({ title: '📣 ' + esc(a.title || "What's New"), body: '<div style="white-space:pre-wrap;line-height:1.6;">' + esc(a.text) + '</div>', footer: '<button class="btn-primary" onclick="BO.closeDialog()">OK</button>' });
  store('boAnnSeen', String(a.version));
}

/* ------------------------------------------------------------------ mobile sidebar, feedback, loader */
function toggleMobileSidebar() { if (document.body.classList.contains('bo-restricted')) return; document.getElementById('sidebar').classList.toggle('open'); document.getElementById('sidebarOverlay').classList.toggle('show'); }
function closeMobileSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sidebarOverlay').classList.remove('show'); }
function showSuggestionBox() { document.getElementById('suggestionMsg').value = ''; openModal('suggestionModal'); }
function sendSuggestionWhatsApp() {
  var msg = document.getElementById('suggestionMsg').value.trim(), cat = document.getElementById('suggestionCat').value;
  if (!msg) { alert('Type a message first.'); return; }
  var who = S.user ? (S.user.name + (S.vendor ? ' (' + S.vendor.name + ')' : '')) : 'A visitor';
  var text = '*Samaritan Industrial Feedback*\nFrom: ' + who + '\nTopic: ' + cat + '\n\n' + msg;
  if (S.token) srv('suggestion', { category: cat, message: msg }).catch(function () {});
  closeModal('suggestionModal'); showToast('Opening WhatsApp…', '📲');
  BO.openOutside('https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(text));
}
function showLoader(ms) {
  var el = document.getElementById('loadingScreen'), fill = document.getElementById('loaderFill'); if (!el) return;
  el.classList.remove('hidden'); el.classList.remove('fade-out'); var i = 0, steps = 50, t = setInterval(function () { i++; if (fill) fill.style.width = (i * 2) + '%'; if (i >= steps) { clearInterval(t); el.classList.add('fade-out'); setTimeout(function () { el.classList.add('hidden'); if (fill) fill.style.width = '0%'; }, 500); } }, ms / steps);
}

/* ------------------------------------------------------------------ boot */
/* ------------------------------------------------------------------ the eye on a password box
   A password typed on a phone keyboard is wrong one time in five, and the only way to find out
   was to submit it and read "wrong password" -- with no way of knowing WHICH character. The eye
   shows the text; tapping it again hides it.

   ONE MECHANISM FOR EVERY PASSWORD BOX, wired nowhere. The sign-in form is in index.html, but
   registration, first-run setup, password reset, Change Password on My Account and the two
   boxes on the Users tab are drawn later, by innerHTML, some inside a dialog. Asking each screen
   to remember to add the eye is asking for the one that forgets. So a MutationObserver watches
   the page and gives the eye to every input[type=password] as it appears -- the one below is
   the same function, run once over what is already there. The input itself is never replaced,
   only moved into a wrapper, so getElementById, the Enter-key handler and autocomplete all keep
   working; data-eye marks it done so a re-render cannot wrap it twice. */
var EYE_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
var EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
function eyeify(root) {
  if (!root || !root.querySelectorAll) return;
  var sel = 'input[type="password"]:not([data-eye])';
  var list = root.matches && root.matches(sel) ? [root] : root.querySelectorAll(sel);
  Array.prototype.forEach.call(list, function (input) {
    input.setAttribute('data-eye', '1');
    var wrap = document.createElement('span');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-eye';
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('aria-pressed', 'false');
    btn.title = 'Show password';
    btn.innerHTML = EYE_ON;
    // mousedown, not click, would move the caret out of the box; keep it where the person is typing.
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    btn.addEventListener('click', function () {
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF : EYE_ON;
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      btn.title = show ? 'Hide password' : 'Show password';
      btn.setAttribute('aria-label', btn.title);
      input.focus();
    });
    wrap.appendChild(btn);
  });
}
BO.eyeify = eyeify;
function watchPasswords() {
  eyeify(document.body);
  if (!window.MutationObserver) return;
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) if (added[j].nodeType === 1) eyeify(added[j]);
    }
  }).observe(document.body, { childList: true, subtree: true });
}

BO.boot = function () {
  setLang(S.lang); applyTheme(S.theme); applyView(S.view);
  watchPasswords();
  /* Coming back to the app after a day in a pocket is an 'open' as far as anybody using it
     is concerned, and the WebView is not reloaded when that happens -- so nothing else here
     would run again. The APK calls BO.recheckUpdate from onResume; this covers every phone
     that has not installed that build yet, which on the day it ships is all of them. */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) BO.recheckUpdate();
  });
  var y = new Date().getFullYear();
  ['loginYear', 'footerYear', 'mkFootYear'].forEach(function (id) { var el = document.getElementById(id); if (el) el.textContent = y; });
  var m = /[?&]reset=([^&]+)/.exec(window.location.search);
  var done = function () { var b = document.getElementById('bootScreen'); if (b) b.parentNode.removeChild(b); };
  if (m) {
    window._resetToken = decodeURIComponent(m[1]);
    showLogin(false);
    document.getElementById('loginFieldsWrap').style.display = 'none'; document.getElementById('lbl_signin').style.display = 'none'; document.getElementById('lbl_signin_sub').style.display = 'none';
    document.getElementById('resetForm').style.display = 'block';
    done(); return;
  }
  if (S.token) {
    /* A saved session is still signed in -- but a FRESH OPEN lands on the marketplace, with
       their name on its bar and "Business Manager" one tap away. Only a reload of the same
       browser tab, or an app Android is restoring rather than starting, goes back to the
       screen and tab the person was on (whereAtBoot_). A dead session falls through to the
       marketplace signed out, as it always did. */
    var was = whereAtBoot_();
    auth('me', { token: S.token }).then(function (b) {
      adoptSession_(b);
      if (was.app) enterApp_(was.tab); else showLanding();
      done();
    })
      .catch(function (e) { if (/sign in|expired|session|account|Please/i.test(e.message) || e.status === 401) { S.token = ''; store('boToken', null); } showLanding(); done(); });
  } else {
    /* No session. Before showing anything, ask whether this system has a manager at all -- a
       brand-new deployment goes straight to the setup screen. One cheap read, signed-out only.

       The ?login=1 / ?register=1 deep links are decided INSIDE this answer, not after it: they
       used to be handled on the line below, which ran while the request was still in flight, so
       the marketplace landed on top of the sign-in form a moment later and the links appeared
       to do nothing. Whatever this branch chooses is the last word. */
    var landing = function () {
      if (/[?&](login|register)=1/.test(window.location.search)) showLogin(/register=1/.test(window.location.search));
      else showLanding();
      done();
    };
    auth('setupState', {}).then(function (st) {
      if (st && st.needed) { showSetup(st); done(); } else { landing(); }
    }).catch(landing);
  }
};
