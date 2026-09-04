/* SETTINGS -- system configuration: timings, vendor permission profiles, hints. Managers only. */
window.BOSet = (function () {
  var settings = {}, hints = [];
  var PERMS = [['adminReceivesDaily', 'Admin Daily Email', 'Admin gets daily sales report'], ['adminReceivesWeekly', 'Admin Weekly Email', 'Admin gets weekly sales report'], ['adminReceivesMonthly', 'Admin Monthly Email', 'Admin gets monthly report'], ['sellerCanDownloadReport', 'Seller Download Reports', 'Sellers can download their own sales report'], ['sellerReceivesEmail', 'Seller Email Reports', 'Sellers receive email reports'], ['sellerReceivesDaily', 'Seller Daily Email', 'Sellers get a daily email summary'], ['dashboardVisible', 'Dashboard Visible', 'Dashboard visible to sellers']];
  var ROLES = ['seller', 'admin', 'assistant-admin', 'manager', 'assistant-manager', 'all', 'marketplace'];
  function g(id) { var e = document.getElementById(id); return e ? e.value : ''; }
  function card(icon, title, body, extra) { return '<div class="section-card" style="margin-bottom:18px;"><div class="section-hdr"><span>' + icon + '</span><div class="section-hdr-title">' + title + '</div>' + (extra || '') + '</div><div class="section-body">' + body + '</div></div>'; }
  function numCard(icon, title, key, label, note, extraFn) {
    return card(icon, title, '<div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end;max-width:360px;"><div class="form-group"><label class="form-label">' + label + '</label><input type="number" class="form-control" id="set_' + key + '" min="0" value="' + esc(settings[key] || 0) + '"></div><button class="btn-primary" onclick="BOSet.save(\'' + key + '\'' + (extraFn ? ',\'' + extraFn + '\'' : '') + ')">Save</button></div>' + (note ? '<div class="small muted" style="margin-top:8px;">' + note + '</div>' : ''));
  }
  function load() {
    var el = document.getElementById('settingsContent'); if (!el) return;
    if (!isManager()) { el.innerHTML = '<div class="empty">Managers only.</div>'; return; }
    el.innerHTML = '<div class="empty">Loading…</div>';
    srv('settingsGet', {}).then(function (r) { settings = r.settings || {}; render(el); loadPerms(); loadHints(); loadReleases(); }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }
  function render(el) {
    var h = numCard('⏱️', 'Loading Screen Duration', 'loadingTime', 'Seconds (0 = none)', 'The old app waited 2 seconds on every sign-in. The new one does not need to.')
      + numCard('🔁', 'Auto-Sync Interval', 'autoSyncSeconds', 'Seconds (0 = off, min 5)', 'All signed-in users silently re-sync this often. The ↻ button reloads at once.', 'sync')
      + numCard('🔒', 'Session Timeout (auto-logout)', 'sessionTimeoutMinutes', 'Minutes idle (0 = never)', 'Signs a user out after this long with no activity.', 'idle')
      + card('🔒', 'Vendor Permission Profiles', '<div id="permissionsSection"><div class="muted">Loading…</div></div>', '<div class="small muted" style="margin-left:auto;">One click applies to all vendors</div>')
      + card('💡', 'Hint Popup Timing', '<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;max-width:460px;"><div class="form-group"><label class="form-label">Lifetime (s)</label><input type="number" class="form-control" id="set_hintLifetime" min="1" value="' + esc(settings.hintLifetime || 5) + '"></div><div class="form-group"><label class="form-label">Interval (s)</label><input type="number" class="form-control" id="set_hintInterval" min="10" value="' + esc(settings.hintInterval || 300) + '"></div><button class="btn-primary" onclick="BOSet.saveHintTimings()">Save</button></div>')
      + card('📱', 'Android app', '<div id="releasesSection"><div class="muted">Loading…</div></div>',
        '<div class="small muted" style="margin-left:auto;">Only needed when the web address changes</div>')
      + card('📝', 'Manage Hints', '<h6 style="margin-bottom:10px;">Add Multiple Hints</h6><div class="table-wrap"><table class="bo-table" id="bulkHintTable"><thead><tr><th style="width:130px;">Role</th><th>Message (EN)</th><th>Kiswahili (SW)</th><th style="width:60px;"></th></tr></thead><tbody>' + bulkRow() + '</tbody></table></div><div style="margin-top:10px;display:flex;gap:8px;"><button class="btn-secondary" onclick="BOSet.addBulkRow()">+ Add Row</button><button class="btn-primary" onclick="BOSet.saveBulk()">Save All</button></div><hr style="margin:16px 0;border-color:var(--border);"><h6 style="margin-bottom:10px;">Existing Hints</h6><div id="hintsTable" class="muted">Loading…</div>');
    el.innerHTML = h;
  }
  function roleSelect(sel) { return '<select class="form-select hint-role" style="width:130px;">' + ROLES.map(function (r) { return '<option value="' + r + '"' + (sel === r ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select>'; }
  function bulkRow() { return '<tr class="bulk-hint-row"><td>' + roleSelect('seller') + '</td><td><input type="text" class="form-control hint-msg" placeholder="Hint message…"></td><td><input type="text" class="form-control hint-sw" placeholder="Ujumbe kwa Kiswahili (optional)"></td><td><button class="btn-sm-danger" onclick="this.closest(\'tr\').remove()">✕</button></td></tr>'; }
  function addBulkRow() { var tb = document.querySelector('#bulkHintTable tbody'), tr = document.createElement('tr'); tr.className = 'bulk-hint-row'; tr.innerHTML = bulkRow().replace(/^<tr[^>]*>/, '').replace(/<\/tr>$/, ''); tb.appendChild(tr); }
  function saveBulk() {
    var rows = []; document.querySelectorAll('.bulk-hint-row').forEach(function (tr) { var en = tr.querySelector('.hint-msg').value.trim(); if (en) rows.push({ role: tr.querySelector('.hint-role').value, en: en, sw: tr.querySelector('.hint-sw').value.trim() }); });
    if (!rows.length) { alert('Enter at least one hint message.'); return; }
    srv('addHints', { rows: rows }).then(function (r) { showToast(r.message); document.querySelector('#bulkHintTable tbody').innerHTML = bulkRow(); loadHints(); }).catch(BO.fail);
  }
  function loadHints() {
    srv('hints', {}).then(function (r) {
      hints = r.rows || [];
      var el = document.getElementById('hintsTable'); if (!el) return;
      if (!hints.length) { el.innerHTML = 'No hints yet — the built-in tips are showing.'; return; }
      var h = '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Role</th><th>Message (EN)</th><th>Kiswahili (SW)</th><th>Actions</th></tr></thead><tbody>';
      hints.forEach(function (x, i) { h += '<tr><td><span class="badge badge-seller">' + esc(x.role) + '</span></td><td style="color:var(--text2);">' + esc(x.message_en) + '</td><td style="color:var(--text2);">' + (x.message_sw ? esc(x.message_sw) : '<span class="muted">—</span>') + '</td><td style="white-space:nowrap;"><button class="btn-sm-primary" onclick="BOSet.editHint(' + i + ')">Edit</button> <button class="btn-sm-danger" onclick="BOSet.deleteHint(\'' + BO.jsq(x.id) + '\')">Del</button></td></tr>'; });
      el.innerHTML = h + '</tbody></table></div>';
    }).catch(function (e) { var el = document.getElementById('hintsTable'); if (el) el.innerHTML = BO.errorBox(e); });
  }
  function editHint(i) {
    var x = hints[i]; if (!x) return;
    BO.dialog({ title: 'Edit hint', body: '<div class="form-group" style="margin-bottom:10px;"><label class="form-label">Role</label>' + roleSelect(x.role).replace('class="form-select hint-role" style="width:130px;"', 'class="form-select" id="ehRole"') + '</div><div class="form-group" style="margin-bottom:10px;"><label class="form-label">Message (English)</label><input class="form-control" id="ehEn" value="' + esc(x.message_en) + '"></div><div class="form-group"><label class="form-label">Ujumbe kwa Kiswahili</label><input class="form-control" id="ehSw" value="' + esc(x.message_sw || '') + '"></div>',
      footer: '<button class="btn-secondary" onclick="BO.closeDialog()">Cancel</button><button class="btn-primary" onclick="BOSet.saveHint(\'' + BO.jsq(x.id) + '\')">Save</button>' });
  }
  function saveHint(id) { srv('updateHint', { id: id, role: g('ehRole'), en: g('ehEn').trim(), sw: g('ehSw').trim() }).then(function () { BO.closeDialog(); showToast('Updated.'); loadHints(); }).catch(BO.fail); }
  function deleteHint(id) { if (!BO.confirm('Delete this hint?')) return; srv('deleteHint', { id: id }).then(function () { loadHints(); }).catch(BO.fail); }
  function save(key, after) {
    var v = g('set_' + key);
    srv('settingSet', { key: key, value: v }).then(function () {
      settings[key] = v; showToast('Saved.');
      if (after === 'sync' && typeof startAutoSync === 'function') startAutoSync(v);
      if (after === 'idle' && typeof startIdleTimer === 'function') startIdleTimer(v);
    }).catch(BO.fail);
  }
  function saveHintTimings() {
    srv('settingSet', { key: 'hintLifetime', value: g('set_hintLifetime') }).then(function () { return srv('settingSet', { key: 'hintInterval', value: g('set_hintInterval') }); })
      .then(function () { showToast('Saved. Takes effect on next sign-in.'); }).catch(BO.fail);
  }
  function loadPerms() {
    var el = document.getElementById('permissionsSection'); if (!el) return;
    srv('allVendorPermissions', {}).then(function (r) {
      var all = r.rows || [], ref = all.length ? (all[0].permissions || {}) : {};
      var names = all.map(function (v) { return v.name; }).join(', ');
      var h = '<div class="small" style="color:var(--text2);margin-bottom:14px;padding:10px;background:var(--surface2);border-radius:var(--radius-sm);">Configure once and click <strong>Apply to All Vendors</strong>. Current vendors: <em>' + (esc(names) || 'none yet') + '</em>.</div><div class="perm-grid">';
      PERMS.forEach(function (p) { var on = p[0] === 'dashboardVisible' ? ref.dashboardVisible !== false : (p[0] === 'adminReceivesDaily' ? ref.adminReceivesDaily !== false : !!ref[p[0]]); h += '<div class="perm-item"><div><div class="perm-label">' + p[1] + '</div><div class="perm-sub">' + p[2] + '</div></div><div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="gperm_' + p[0] + '"' + (on ? ' checked' : '') + '></div></div>'; });
      h += '</div><div style="margin-top:16px;display:flex;gap:10px;align-items:center;"><button class="btn-primary" onclick="BOSet.applyPerms()">✅ Apply to All Vendors</button><span class="small muted">Overwrites permissions for all ' + all.length + ' vendor(s)</span></div>';
      el.innerHTML = h;
    }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }
  function applyPerms() {
    var profile = {}; PERMS.forEach(function (p) { var el = document.getElementById('gperm_' + p[0]); profile[p[0]] = el ? el.checked : false; });
    if (!BO.confirm('Apply these permission settings to ALL vendors? This will overwrite their individual settings.')) return;
    srv('setAllVendorPermissions', { profile: profile }).then(function (r) { showToast(r.message); }).catch(BO.fail);
  }

  /* ------------------------------------------------------------------ the Android app
     The app is a window onto this site, so a feature or a fix reaches every phone the moment
     it deploys. A NEW APK is only ever needed when the web address or the app's allowed-domain
     list changes. That is why this card says so at the top: the commonest mistake would be
     building a new APK for every change, which nobody needs to do. */
  var pendingApk = null;
  function fmtSize(n) { n = Number(n) || 0; return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'; }
  function loadReleases() {
    var el = document.getElementById('releasesSection'); if (!el) return;
    srv('releases', {}).then(function (r) {
      var list = r.rows || [];
      var cur = list.filter(function (x) { return x.is_current; })[0];
      var h = '<div class="small" style="color:var(--text2);margin-bottom:14px;padding:10px;background:var(--surface2);border-radius:var(--radius-sm);">'
        + 'The app shows this website, so <strong>everything we change is already on every phone</strong>. '
        + 'You only need a new APK if the web address changes, or the app has to be allowed a new domain. '
        + 'The printed QR code points at <code>/download</code> and always fetches whichever build is current, so it never needs reprinting.</div>';
      h += cur
        ? '<div class="kv" style="background:var(--surface2);border-radius:8px;padding:10px 12px;margin-bottom:14px;"><b>Current build</b><span>' + esc(cur.version_name) + ' (code ' + cur.version_code + ')</span><b>Size</b><span>' + fmtSize(cur.size_bytes) + '</span><b>Published</b><span>' + BO.fmtDT(cur.published_at) + '</span></div>'
        : '<div class="alert-info" style="margin-bottom:14px;">No APK published yet. People can still use the system in a browser, and <code>/download</code> says so politely.</div>';
      h += '<h6 style="margin-bottom:10px;">Publish a build</h6>'
        + '<div class="fg2" style="margin-bottom:10px;"><div class="form-group"><label class="form-label">Version name</label><input class="form-control" id="relName" placeholder="1.3"></div>'
        + '<div class="form-group"><label class="form-label">Version code</label><input type="number" class="form-control" id="relCode" placeholder="4"><div class="small muted" style="margin-top:4px;">Must be higher than last time, or Android refuses to install over the old app.</div></div></div>'
        + '<div class="form-group" style="margin-bottom:10px;"><label class="form-label">What changed (optional)</label><input class="form-control" id="relNotes" placeholder="New web address"></div>'
        + '<div class="form-group" style="margin-bottom:10px;"><label class="form-label">APK file</label><input type="file" id="relFile" accept=".apk,application/vnd.android.package-archive" class="form-control" onchange="BOSet.pickApk(this)"><div class="small muted" id="relFileMsg" style="margin-top:4px;">The file goes straight to storage from this browser, never through the API.</div></div>'
        + '<button class="btn-primary" id="relBtn" onclick="BOSet.publishRelease()">Upload &amp; publish</button>'
        + '<div id="relMsg" class="small" style="margin-top:10px;"></div>';
      if (list.length) {
        h += '<hr style="margin:16px 0;border-color:var(--border);"><h6 style="margin-bottom:10px;">History</h6><div class="table-wrap"><table class="bo-table"><thead><tr><th>Version</th><th>Code</th><th>Size</th><th>Published</th><th></th></tr></thead><tbody>';
        list.forEach(function (x) {
          h += '<tr><td><strong>' + esc(x.version_name) + '</strong>' + (x.is_current ? ' <span class="badge badge-active">current</span>' : '') + (x.notes ? '<br><span class="small muted">' + esc(x.notes) + '</span>' : '') + '</td><td class="mono">' + x.version_code + '</td><td class="mono small">' + fmtSize(x.size_bytes) + '</td><td class="small muted">' + BO.fmtDT(x.published_at) + '</td><td style="white-space:nowrap;"><a class="btn-sm-primary" href="' + esc(x.url) + '" target="_blank" rel="noopener">Download</a>'
            + (x.is_current ? '' : ' <button class="btn-sm-warning" onclick="BOSet.rollback(\'' + BO.jsq(x.id) + '\',\'' + BO.jsq(x.version_name) + '\')">Make current</button>') + '</td></tr>';
        });
        h += '</tbody></table></div>';
      }
      el.innerHTML = h;
    }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }
  function pickApk(input) {
    var f = input.files && input.files[0];
    pendingApk = f || null;
    var m = document.getElementById('relFileMsg');
    if (m) m.textContent = f ? (f.name + ' — ' + fmtSize(f.size)) : 'The file goes straight to storage from this browser, never through the API.';
  }
  /* Two steps on purpose: the APK is far too big for a serverless request body, so the server
     hands back a signed URL and the file goes from here to storage directly. Only once it has
     landed is the release recorded, so a row can never point at a file that is not there. */
  function publishRelease() {
    var name = g('relName').trim(), code = g('relCode').trim(), notes = g('relNotes').trim();
    var msg = document.getElementById('relMsg'), btn = document.getElementById('relBtn');
    if (!name || !code) { msg.innerHTML = '<div class="alert-danger">Give it a version name and a version code.</div>'; return; }
    if (!pendingApk) { msg.innerHTML = '<div class="alert-danger">Choose the .apk file first.</div>'; return; }
    btn.disabled = true; msg.innerHTML = '<div class="muted">Asking for an upload link…</div>';
    srv('releaseUploadUrl', { version_name: name, version_code: Number(code) }).then(function (u) {
      msg.innerHTML = '<div class="muted">Uploading ' + esc(pendingApk.name) + '… this can take a minute on a slow connection.</div>';
      return fetch(u.upload_url, { method: 'PUT', body: pendingApk, headers: { 'content-type': 'application/vnd.android.package-archive' } })
        .then(function (res) {
          if (!res.ok) throw new Error('The upload was refused (' + res.status + '). Try again.');
          msg.innerHTML = '<div class="muted">Uploaded. Publishing…</div>';
          return srv('publishRelease', { version_name: name, version_code: Number(code), file_name: u.file_name, size_bytes: pendingApk.size, notes: notes });
        });
    }).then(function (r) {
      btn.disabled = false; pendingApk = null;
      msg.innerHTML = '<div class="alert-success">Published ' + esc(r.release.version_name) + '. Everyone scanning the QR code gets this build now.</div>';
      loadReleases();
    }).catch(function (e) { btn.disabled = false; msg.innerHTML = '<div class="alert-danger">' + esc(e.message) + '</div>'; });
  }
  function rollback(id, name) {
    if (!BO.confirm('Make ' + name + ' the build everyone downloads again?')) return;
    srv('rollbackRelease', { id: id }).then(function () { showToast('Rolled back to ' + name + '.'); loadReleases(); }).catch(BO.fail);
  }

  BO.tabs.settings = { load: load };
  return { load: load, save: save, pickApk: pickApk, publishRelease: publishRelease, rollback: rollback, saveHintTimings: saveHintTimings, addBulkRow: addBulkRow, saveBulk: saveBulk, editHint: editHint, saveHint: saveHint, deleteHint: deleteHint, applyPerms: applyPerms };
})();
