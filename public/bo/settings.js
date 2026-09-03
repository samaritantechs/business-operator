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
    srv('settingsGet', {}).then(function (r) { settings = r.settings || {}; render(el); loadPerms(); loadHints(); }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }
  function render(el) {
    var h = numCard('⏱️', 'Loading Screen Duration', 'loadingTime', 'Seconds (0 = none)', 'The old app waited 2 seconds on every sign-in. The new one does not need to.')
      + numCard('🔁', 'Auto-Sync Interval', 'autoSyncSeconds', 'Seconds (0 = off, min 5)', 'All signed-in users silently re-sync this often. The ↻ button reloads at once.', 'sync')
      + numCard('🔒', 'Session Timeout (auto-logout)', 'sessionTimeoutMinutes', 'Minutes idle (0 = never)', 'Signs a user out after this long with no activity.', 'idle')
      + card('🔒', 'Vendor Permission Profiles', '<div id="permissionsSection"><div class="muted">Loading…</div></div>', '<div class="small muted" style="margin-left:auto;">One click applies to all vendors</div>')
      + card('💡', 'Hint Popup Timing', '<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;max-width:460px;"><div class="form-group"><label class="form-label">Lifetime (s)</label><input type="number" class="form-control" id="set_hintLifetime" min="1" value="' + esc(settings.hintLifetime || 5) + '"></div><div class="form-group"><label class="form-label">Interval (s)</label><input type="number" class="form-control" id="set_hintInterval" min="10" value="' + esc(settings.hintInterval || 300) + '"></div><button class="btn-primary" onclick="BOSet.saveHintTimings()">Save</button></div>')
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
      hints.forEach(function (x, i) { h += '<tr><td><span class="badge badge-seller">' + esc(x.role) + '</span></td><td style="color:var(--text2);">' + esc(x.message_en) + '</td><td style="color:var(--text2);">' + (x.message_sw ? esc(x.message_sw) : '<span class="muted">—</span>') + '</td><td style="white-space:nowrap;"><button class="btn-sm-primary" onclick="BOSet.editHint(' + i + ')">Edit</button> <button class="btn-sm-danger" onclick="BOSet.deleteHint(\'' + esc(x.id) + '\')">Del</button></td></tr>'; });
      el.innerHTML = h + '</tbody></table></div>';
    }).catch(function (e) { var el = document.getElementById('hintsTable'); if (el) el.innerHTML = BO.errorBox(e); });
  }
  function editHint(i) {
    var x = hints[i]; if (!x) return;
    BO.dialog({ title: 'Edit hint', body: '<div class="form-group" style="margin-bottom:10px;"><label class="form-label">Role</label>' + roleSelect(x.role).replace('class="form-select hint-role" style="width:130px;"', 'class="form-select" id="ehRole"') + '</div><div class="form-group" style="margin-bottom:10px;"><label class="form-label">Message (English)</label><input class="form-control" id="ehEn" value="' + esc(x.message_en) + '"></div><div class="form-group"><label class="form-label">Ujumbe kwa Kiswahili</label><input class="form-control" id="ehSw" value="' + esc(x.message_sw || '') + '"></div>',
      footer: '<button class="btn-secondary" onclick="BO.closeDialog()">Cancel</button><button class="btn-primary" onclick="BOSet.saveHint(\'' + esc(x.id) + '\')">Save</button>' });
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
  BO.tabs.settings = { load: load };
  return { load: load, save: save, saveHintTimings: saveHintTimings, addBulkRow: addBulkRow, saveBulk: saveBulk, editHint: editHint, saveHint: saveHint, deleteHint: deleteHint, applyPerms: applyPerms };
})();
