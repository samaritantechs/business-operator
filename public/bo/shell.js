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
  announcement: null, lang: 'en', theme: 'dark', view: 'mobile', screen: 'landing', tab: 'dashboard', loaded: {} };
var BO = { tabs: {}, S: S };

/* ------------------------------------------------------------------ storage */
function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
function load(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
S.lang = load('boLang') || 'en';
S.theme = load('boTheme') || 'dark';
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

function showToast(msg, icon) {
  var t = document.getElementById('hintToast'); if (!t) return;
  document.querySelector('#hintToast .hint-icon').textContent = icon || '✅';
  document.getElementById('hintText').textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(function () { t.classList.remove('show'); }, 2800);
}
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
BO.confirm = function (msg) { return window.confirm(msg); };
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
  if (arr.length) { var h = arr[Math.floor(Math.random() * arr.length)]; var msg = (S.lang === 'sw' && h.sw) ? h.sw : h.en; document.querySelector('#hintToast .hint-icon').textContent = (S.lang === 'sw' ? '🇹🇿' : '🇬🇧'); document.getElementById('hintText').textContent = msg; var t = document.getElementById('hintToast'); t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, (hintLifetime || 3) * 1000); }
  else showToast(S.lang === 'sw' ? 'Lugha ya vidokezo: Kiswahili' : 'Tips language: English', '🌐');
}
function applyTheme(t) {
  S.theme = t; document.documentElement.setAttribute('data-theme', t); store('boTheme', t);
  var b1 = document.getElementById('themeToggleBtn'), b2 = document.getElementById('mkThemeBtn');
  if (b1) b1.textContent = t === 'dark' ? '☀️' : '🌙'; if (b2) b2.textContent = t === 'dark' ? '☀️' : '🌙';
}
function toggleTheme() { applyTheme(S.theme === 'dark' ? 'light' : 'dark'); if (S.screen === 'app' && S.tab === 'dashboard' && BO.tabs.dashboard) BO.tabs.dashboard.load(); }
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
  if (!_market.products.length) loadMarketplace(); else startMarketplaceHints();
}
function showLogin(openReg) {
  S.screen = 'login'; stopHints();
  show_('landingPage', false); show_('mainApp', false); show_('loginPage', true);
  var rf = document.getElementById('regForm'), rl = document.getElementById('regLink');
  if (rf && rl) { rf.style.display = openReg === true ? 'block' : 'none'; rl.textContent = openReg === true ? '– Hide' : '+ Register New Business'; }
  document.getElementById('loginFieldsWrap').style.display = ''; document.getElementById('resetForm').style.display = 'none';
  document.getElementById('lbl_signin').style.display = ''; document.getElementById('lbl_signin_sub').style.display = '';
  window.scrollTo(0, 0);
  setTimeout(function () { var c = document.getElementById('loginId'); if (c && openReg !== true) c.focus(); }, 60);
}
function mkScrollTo(id) { var el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: 'smooth' }); }

/* ------------------------------------------------------------------ the app */
function applyLogin(boot) {
  S.user = boot.user; S.vendor = boot.vendor; S.perms = boot.perms || {}; S.timings = boot.timings || {};
  S.branches = boot.branches || []; S.partners = boot.partners || []; S.features = boot.features || {}; S.announcement = boot.announcement || null;
  if (boot.whatsapp) WA_NUMBER = boot.whatsapp;
  S.screen = 'app'; S.loaded = {};
  store('boBoot', JSON.stringify({ user: boot.user, vendor: boot.vendor, perms: boot.perms }));
  show_('landingPage', false); show_('loginPage', false); show_('mainApp', true);
  document.getElementById('displayVendor').textContent = S.vendor ? S.vendor.name : 'System Manager';
  document.getElementById('displayName').textContent = S.user.name; document.getElementById('displayRole').textContent = S.user.role;
  var initials = (S.user.name || 'U').split(' ').map(function (w) { return w[0]; }).join('').substring(0, 2).toUpperCase();
  var av = document.getElementById('topbarAvatar');
  if (S.user.profile_photo_url) av.innerHTML = '<img src="' + esc(S.user.profile_photo_url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentNode.textContent=\'' + BO.jsq(initials) + '\'">'; else av.textContent = initials;
  document.getElementById('tbUserInfo').style.display = '';
  if (S.vendor && S.vendor.logo_url) { document.getElementById('customLogoImg').src = S.vendor.logo_url; document.getElementById('customLogoRow').classList.remove('hidden'); }
  /* Which doors this person gets: the role list on each nav item, then the two seller flags. */
  var role = S.user.role;
  document.querySelectorAll('[data-roles]').forEach(function (el) { el.style.display = (el.getAttribute('data-roles').split(' ').indexOf(role) !== -1) ? '' : 'none'; });
  if (isSeller() && S.perms.showDashboard === false) document.getElementById('nav-dashboard').style.display = 'none';
  if (isSeller() && !S.perms.canDownloadReport) { document.getElementById('nav-reports').style.display = 'none'; document.querySelector('[data-roles="admin assistant-admin seller"]').style.display = 'none'; }
  var first = null; document.querySelectorAll('.sidebar .nav-item').forEach(function (b) { if (!first && b.style.display !== 'none') first = b; });
  switchTab(first ? first.id.replace('nav-', '') : 'dashboard', first);
  applyRestrictionUI(boot.restriction);
  document.getElementById('footerYear').textContent = new Date().getFullYear();
  var lt = Number(S.timings.loadingTime) || 0; if (lt > 0) showLoader(lt * 1000);
  startHintTimer(boot.hints || []); startAutoSync(S.timings.autoSyncSeconds); startIdleTimer(S.timings.sessionTimeoutMinutes);
  showAnnouncement();
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
  S.token = ''; S.user = null; S.vendor = null; S.perms = {}; S.loaded = {}; store('boToken', null); store('boBoot', null);
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
  var email = prompt('Enter the email address associated with your account:'); if (!email) return;
  auth('requestReset', { email: email.trim() }).then(function (r) { alert(r.message); }).catch(function (e) { alert(e.message); });
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
function setMkType(t) { _mkFilterType = t; ['ALL', 'Sale', 'Rent'].forEach(function (k) { var el = document.getElementById('mkType_' + k); if (el) el.classList.toggle('active', k === t); }); filterMarket(); }
function loadMarketplace() {
  var grid = document.getElementById('mkProductGrid'); if (grid && !_market.products.length) grid.innerHTML = '<div class="mk-empty">Loading products…</div>';
  mk('market').then(function (d) { _market = d || { products: [], vendors: [] }; renderMarket(); if (S.screen === 'landing') startHintTimer(d.hints || [], d.timings); })
    .catch(function () { var g = document.getElementById('mkProductGrid'); if (g) g.innerHTML = '<div class="mk-empty">Could not load marketplace. Tap ↻ to retry.</div>'; });
}
function renderMarket() {
  var prods = _market.products || [], vends = _market.vendors || [], cats = {};
  prods.forEach(function (p) { if (p.cat) cats[p.cat] = 1; });
  document.getElementById('mkStatProducts').textContent = prods.length;
  document.getElementById('mkStatVendors').textContent = vends.length;
  document.getElementById('mkStatCats').textContent = Object.keys(cats).length;
  renderMarketCats(); filterMarket();
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
function filterMarket() {
  var q = (document.getElementById('mkSearch').value || '').trim().toLowerCase();
  _mkFiltered = (_market.products || []).filter(function (p) {
    if (_mkFilterType !== 'ALL' && (p.listingType || 'Sale') !== _mkFilterType) return false;
    if (_mkFilterCat !== 'ALL' && p.cat !== _mkFilterCat) return false;
    if (!q) return true;
    return [p.name, p.cat, p.vendor, p.location, p.brand, p.model].some(function (v) { return String(v || '').toLowerCase().indexOf(q) !== -1; });
  });
  _mkShown = _mkPageSize; renderMarketPage();
}
function findVendor(name) { var vs = _market.vendors || []; for (var i = 0; i < vs.length; i++) if (vs[i].name === name) return vs[i]; return null; }
function renderMarketPage() {
  var grid = document.getElementById('mkProductGrid'), wrap = document.getElementById('mkLoadMoreWrap'), list = _mkFiltered || [];
  if (!list.length) { grid.innerHTML = '<div class="mk-empty">No products match your search.</div>'; if (wrap) wrap.innerHTML = ''; return; }
  var shown = Math.min(_mkShown, list.length), all = _market.products, html = '';
  for (var i = 0; i < shown; i++) {
    var p = list[i], gi = all.indexOf(p), img = p.image1 || p.image2 || p.image3, isRent = (p.listingType || 'Sale') === 'Rent';
    var imgHtml = img ? '<div class="mk-img" style="background-image:url(\'' + BO.jsq(img) + '\');">' : '<div class="mk-img">🛍️';
    imgHtml += (p.stock > 0 ? '<span class="mk-stock">' + (isRent ? 'Available' : 'In stock') + '</span>' : '<span class="mk-stock out">' + (isRent ? 'Booked' : 'Out') + '</span>') + (p.hot ? '<span class="mk-fire">🔥 Hot</span>' : '') + '</div>';
    var v = findVendor(p.vendor), vlogo = (v && v.logo) ? '<img src="' + esc(v.logo) + '" onerror="this.style.display=\'none\'">' : '<div class="mk-vinit">' + esc((p.vendor || 'B')[0]).toUpperCase() + '</div>';
    html += '<div class="mk-card" onclick="openProductDetail(' + gi + ')">' + imgHtml + '<div class="mk-cardbody"><div class="mk-cat">' + (isRent ? 'FOR RENT · ' : '') + esc(p.cat || 'General') + '</div><div class="mk-name">' + esc(p.name) + '</div><div class="mk-price">' + fmtFull(p.price) + ' <span style="font-size:.7rem;color:var(--muted);font-weight:600;">' + esc(p.currency || 'TZS') + (isRent && p.priceUnit ? ' ' + esc(p.priceUnit) : '') + '</span></div><div class="mk-cvendor">' + vlogo + '<span>' + esc(p.vendor) + '</span></div></div></div>';
  }
  grid.innerHTML = html;
  var remaining = list.length - shown;
  if (wrap) wrap.innerHTML = remaining > 0 ? '<button class="btn-secondary" onclick="loadMoreMarket()" style="margin-top:14px;">Load more (' + remaining + ' more)</button>' : '';
}
function loadMoreMarket() { _mkShown += _mkPageSize; renderMarketPage(); }
function openProductDetail(idx) {
  var p = _market.products[idx]; if (!p) return;
  try { mk('click', { product_id: p.id }).catch(function () {}); } catch (e) {}
  var v = findVendor(p.vendor) || {}, isRent = (p.listingType || 'Sale') === 'Rent';
  document.getElementById('pdTitle').textContent = p.name;
  var shots = [p.image1, p.image2, p.image3].filter(function (u) { return !!u; });
  var imgs = '<div class="pd-imgs">' + (shots.length
    ? shots.map(function (u, k) { return '<img class="pd-img" src="' + esc(u) + '"' + (k === 0 ? ' onerror="this.outerHTML=\'<div class=\\\'pd-img-ph\\\'>🛍️</div>\'"' : ' onerror="this.remove()"') + '>'; }).join('')
    : '<div class="pd-img-ph">🛍️</div>') + '</div>';
  var phone = digitsOnly(p.vendorPhone || v.phone || '');
  var contact = phone ? '<a class="btn-primary w-100" style="justify-content:center;margin-top:6px;" href="https://wa.me/' + phone + '?text=' + encodeURIComponent('Hello ' + p.vendor + ', I am interested in "' + p.name + '" I saw on the Samaritan Industrial marketplace.') + '" target="_blank" rel="noopener">📲 Contact seller on WhatsApp</a>' : '<div class="alert-info" style="margin-top:6px;">This seller has not listed a contact number.</div>';
  document.getElementById('pdBody').innerHTML = imgs
    + '<div style="font-size:.7rem;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.05em;">' + (isRent ? 'FOR RENT · ' : '') + esc(p.cat || 'General') + ((p.brand || p.model) ? ' · ' + esc([p.brand, p.model].filter(Boolean).join(' ')) : '') + '</div>'
    + '<div style="font-size:1.3rem;font-weight:800;color:var(--text);margin:2px 0 4px;">' + esc(p.name) + (p.hot ? ' <span style="font-size:.8rem;color:#EF4444;">🔥 Hot</span>' : '') + '</div>'
    + '<div style="font-size:1.4rem;font-weight:800;font-family:var(--mono);color:var(--accent2);margin-bottom:6px;">' + fmtFull(p.price) + ' ' + esc(p.currency || 'TZS') + (isRent && p.priceUnit ? ' <span style="font-size:.85rem;color:var(--muted);">' + esc(p.priceUnit) + '</span>' : '') + '</div>'
    + '<div style="font-size:.84rem;color:var(--text2);margin-bottom:12px;">' + (isRent ? (p.stock > 0 ? '✅ Available now' : '🔴 Currently booked out') : (p.stock > 0 ? ('✅ ' + p.stock + ' in stock') : '🔴 Currently out of stock')) + '</div>'
    + (p.location ? '<div style="font-size:.82rem;color:var(--text2);margin-bottom:12px;">📍 ' + esc(p.location) + '</div>' : '')
    + '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:6px;"><div style="font-size:.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Sold by</div><div style="font-weight:700;color:var(--text);">' + esc(p.vendor) + (v.businessType ? ' <span style="font-weight:500;color:var(--accent);font-size:.8rem;">· ' + esc(v.businessType) + '</span>' : '') + '</div>' + (v.address ? '<div style="font-size:.78rem;color:var(--text2);margin-top:6px;">📍 ' + esc(v.address) + '</div>' : '') + '</div>'
    + contact;
  openModal('productDetailModal');
}

/* ------------------------------------------------------------------ hints (bilingual tips) */
var hintTimer = null, hintLifetime = 5, hintInterval = 300, _hintList = [];
function startHintTimer(hints, timings) {
  stopHints();
  var t = timings || S.timings || {};
  hintLifetime = Number(t.hintLifetime) || 5; hintInterval = Math.max(10, Number(t.hintInterval) || 300);
  if (!hints || !hints.length) return;
  _hintList = hints;
  var show = function () {
    var h = _hintList[Math.floor(Math.random() * _hintList.length)];
    var msg = (h && typeof h === 'object') ? ((S.lang === 'sw' && h.sw) ? h.sw : h.en) : h;
    document.getElementById('hintText').textContent = msg; document.querySelector('#hintToast .hint-icon').textContent = '💡';
    var el = document.getElementById('hintToast'); el.classList.add('show'); setTimeout(function () { el.classList.remove('show'); }, hintLifetime * 1000);
  };
  hintTimer = setInterval(show, hintInterval * 1000);
  setTimeout(show, 2500);
}
function stopHints() { if (hintTimer) { clearInterval(hintTimer); hintTimer = null; } }
function startMarketplaceHints() { if (!hintTimer && _market.hints) startHintTimer(_market.hints, _market.timings); }

/* ------------------------------------------------------------------ auto-sync, idle, restriction */
var _autoSyncTimer = null, _idleTimer = null, _idleMs = 0;
function startAutoSync(sec) { if (_autoSyncTimer) { clearInterval(_autoSyncTimer); _autoSyncTimer = null; } sec = parseInt(sec, 10) || 0; if (sec < 5) return; _autoSyncTimer = setInterval(function () { if (S.screen === 'app') silentSync(); }, sec * 1000); }
function silentSync() {
  if (S.screen !== 'app') return;
  if (!isManager()) srv('restrictionInfo', {}).then(applyRestrictionUI).catch(function () {});
  var tab = BO.tabs[S.tab]; if (tab && tab.sync) { try { tab.sync(); } catch (e) {} }
}
function startIdleTimer(mins) { _idleMs = (parseInt(mins, 10) || 0) * 60000; resetIdle(); }
function resetIdle() { if (!_idleMs) { if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; } return; } clearTimeout(_idleTimer); _idleTimer = setTimeout(function () { if (S.screen === 'app') { showToast('Signed out due to inactivity.', '🔒'); logout(); } }, _idleMs); }
function stopIdleTimer() { if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; } _idleMs = 0; }
['click', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach(function (ev) { document.addEventListener(ev, function () { if (S.screen === 'app' && _idleMs) resetIdle(); }, { passive: true }); });
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
  window.open('https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(text), '_blank');
  closeModal('suggestionModal'); showToast('Opening WhatsApp…', '📲');
}
function showLoader(ms) {
  var el = document.getElementById('loadingScreen'), fill = document.getElementById('loaderFill'); if (!el) return;
  el.classList.remove('hidden'); el.classList.remove('fade-out'); var i = 0, steps = 50, t = setInterval(function () { i++; if (fill) fill.style.width = (i * 2) + '%'; if (i >= steps) { clearInterval(t); el.classList.add('fade-out'); setTimeout(function () { el.classList.add('hidden'); if (fill) fill.style.width = '0%'; }, 500); } }, ms / steps);
}

/* ------------------------------------------------------------------ boot */
BO.boot = function () {
  setLang(S.lang); applyTheme(S.theme); applyView(S.view);
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
    // A saved session signs straight back in; a dead one falls through to the marketplace.
    auth('me', { token: S.token }).then(function (b) { applyLogin(b); done(); })
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
