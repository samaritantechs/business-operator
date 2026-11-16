/* USERS -- the team (admins, sellers), the business profile and logo. Managers see every business. */
window.BOUsers = (function () {
  var rows = [], vendors = [], pendingPhoto = null, pendingLogo = null, timer = null;

  function load() {
    var el = document.getElementById('usersContent'); if (!el) return;
    if (!isAdmin() && !isManager()) { el.innerHTML = '<div class="empty">Only admins manage users.</div>'; return; }
    var h = '';
    var roleOpts = '<option value="seller">Seller</option><option value="admin">Admin</option><option value="assistant-admin">Asst. Admin</option>' + (isManager() ? '<option value="manager">Manager</option><option value="assistant-manager">Asst. Manager</option>' : '');
    h += '<div class="section-card" style="margin-bottom:18px;"><div class="section-hdr"><span>➕</span><div class="section-hdr-title">Add New User</div></div><div class="section-body"><div class="form-grid">'
      + (isManager() ? '<div class="form-group"><label class="form-label">Business</label><select class="form-select" id="newUserVendor"><option value="">— (manager roles only) —</option></select></div>' : '')
      + '<div class="form-group" style="grid-column:span 2;"><label class="form-label">Email</label><input class="form-control" id="newUserEmail" placeholder="email@example.com"></div><div class="form-group" style="grid-column:span 2;"><label class="form-label">Full Name</label><input class="form-control" id="newUserName"></div><div class="form-group"><label class="form-label">Role</label><select class="form-select" id="newUserRole">' + roleOpts + '</select></div><div class="form-group"><label class="form-label">User ID</label><input class="form-control" id="newUserId" autocomplete="off"></div><div class="form-group"><label class="form-label">Password</label><input class="form-control" id="newUserPwd" type="password" autocomplete="new-password"></div>' + shopSelect('newUserBranch') + '<button class="btn-primary" onclick="BOUsers.add()">+ Add</button></div></div></div>';
    if (isAdmin()) {
      var v = S.vendor || {};
      h += '<div class="section-card" style="margin-bottom:18px;"><div class="section-hdr"><span>🏷️</span><div class="section-hdr-title">Business Profile &amp; Marketplace Listing</div></div><div class="section-body"><div class="fg3" style="align-items:end;"><div class="form-group"><label class="form-label">Business Type</label><input type="text" class="form-control" id="myBusinessType" placeholder="e.g. Groceries" value="' + esc(v.business_type || '') + '"></div><div class="form-group"><label class="form-label">Contact Phone (WhatsApp)</label><input type="text" class="form-control" id="myBusinessPhone" placeholder="e.g. 0712 345 678" value="' + esc(v.phone || '') + '"></div><div class="form-group"><label class="form-label">Currency</label><input type="text" class="form-control mono" id="myCurrencyInput" value="' + esc(v.currency || 'TZS') + '" style="text-transform:uppercase;"></div></div><div class="form-group" style="margin-top:12px;"><label class="form-label">Business Address / Location</label><input type="text" class="form-control" id="myBusinessAddress" placeholder="e.g. Kariakoo, Dar es Salaam" value="' + esc(v.address || '') + '"></div>'
        /* THE PIN. One box that takes whatever is to hand -- the phone's own position, a link
           copied out of Google Maps, or two numbers -- because the person filling this in is a
           shopkeeper standing at a counter, not somebody who knows what a coordinate is. The
           server (api/_lib/bo/place.js) works out which it was. */
        + '<div class="form-group" style="margin-top:12px;"><label class="form-label">Shop location on the map <span class="muted" style="font-weight:400;">— gives customers a 📍 Location button to you</span></label><div style="display:flex;gap:8px;flex-wrap:wrap;"><input type="text" class="form-control" id="myBusinessPin" style="flex:1 1 220px;" placeholder="Loading…" autocomplete="off" disabled><button type="button" class="btn-secondary" id="myPinHere" onclick="BOUsers.pinHere()">📍 Use my current location</button><a class="btn-secondary hidden" id="myPinTest" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;">🗺️ Check it on the map</a></div><div class="small muted" id="myPinNote" style="margin-top:6px;">Stand in your shop and tap “Use my current location”, or paste a Google Maps link (in Google Maps: Share → Copy link). Leave it empty to show no Location button.</div></div><div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;"><button class="btn-primary" onclick="BOUsers.saveProfile()">Save Profile</button><button class="btn-secondary" onclick="BOUsers.openLogo()">🖼️ Upload Logo</button>' + (v.logo_url ? '<img src="' + esc(v.logo_url) + '" style="max-height:32px;max-width:90px;object-fit:contain;border-radius:6px;" onerror="this.style.display=\'none\'">' : '') + '<span id="bizProfileMsg" class="small muted"></span></div><div class="small muted" style="margin-top:8px;">This appears on your marketplace storefront so customers can reach you.</div></div></div>';
      /* LIPA NAMBA. The numbers this shop is paid on, written down once so the till can say them
         (api/_lib/bo/paynumbers.js says why the NAME is the important box). Three lines, because
         that is what a counter uses; a line left empty is simply not a number. */
      h += '<div class="section-card" style="margin-bottom:18px;"><div class="section-hdr"><span>📱</span><div class="section-hdr-title">Lipa Namba — how customers pay you</div></div><div class="section-body">'
        + '<div class="muted small" style="margin-bottom:10px;">Shown to your sellers at the till when they choose <strong>Lipa Number</strong>, and on the receipt. Never shown on the public marketplace. The <strong>name</strong> is the one the customer\'s phone shows before they enter their PIN — checking it is what stops a payment going to the wrong person.</div>'
        + '<datalist id="payNets"><option value="M-Pesa"><option value="Airtel Money"><option value="Mixx by Yas (Tigo Pesa)"><option value="HaloPesa"><option value="T-Pesa"><option value="Selcom"><option value="CRDB"><option value="NMB"></datalist>'
        + '<div id="payNumRows"><div class="muted small">Loading…</div></div>'
        + '<div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;"><button class="btn-primary" id="payNumSave" onclick="BOUsers.savePay()" disabled>Save Lipa Namba</button><span id="payNumMsg" class="small" style="color:var(--accent2);"></span></div></div></div>';
    }
    h += '<div class="search-wrap"><span class="search-ico">🔍</span><input type="text" class="form-control" id="userSearch" placeholder="Search name, role, user ID, vendor…" onkeyup="BOUsers.search()"></div><div id="usersTable" class="empty">Loading…</div>';
    el.innerHTML = h;
    if (isAdmin()) { loadPin(); loadPay(); }
    if (isManager()) srv('vendorList', {}).then(function (r) { vendors = r.rows || []; var s = document.getElementById('newUserVendor'); if (s) s.innerHTML += vendors.map(function (v) { return '<option value="' + esc(v.id) + '">' + esc(v.name) + '</option>'; }).join(''); }).catch(function () {});
    list();
  }
  function shopSelect(id, sel) {
    if (isManager() || !S.branches.length) return '';
    return '<div class="form-group"><label class="form-label">Shop</label><select class="form-select" id="' + id + '"><option value="">— No shop —</option>' + S.branches.map(function (b) { return '<option value="' + esc(b.id) + '"' + (sel === b.id ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join('') + '</select></div>';
  }
  function g(id) { var e = document.getElementById(id); return e ? e.value : ''; }
  function search() { clearTimeout(timer); timer = setTimeout(list, 250); }
  function list() {
    var q = g('userSearch');
    srv('users', q ? { q: q } : {}).then(function (r) {
      rows = r.rows || [];
      var el = document.getElementById('usersTable'); if (!el) return;
      if (!rows.length) { el.innerHTML = '<div class="alert-info">No users found.</div>'; return; }
      var h = '<div class="section-card"><div style="padding:0;"><div class="table-wrap"><table class="bo-table"><thead><tr><th></th><th>Name</th><th>Role</th><th>User ID</th><th>Vendor</th><th>Shop</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
      rows.forEach(function (u, i) {
        var av = u.profile_photo_url ? '<img src="' + esc(u.profile_photo_url) + '" style="width:30px;height:30px;border-radius:50%;object-fit:cover;" onerror="this.style.display=\'none\'">' : '<div class="avatar-placeholder" style="width:30px;height:30px;font-size:.65rem;">' + esc((u.name || 'U')[0]).toUpperCase() + '</div>';
        h += '<tr><td style="width:40px;">' + av + '</td><td style="font-weight:500;">' + esc(u.name) + '<div class="small muted">' + esc(u.email || '') + '</div></td><td><span class="badge badge-' + esc(String(u.role).replace(/[^a-z-]/g, '')) + '">' + esc(u.role) + '</span></td><td class="mono small" style="color:var(--accent);">' + esc(u.handle) + '</td><td class="muted">' + esc(u.vendor_name || '–') + '</td><td class="small">' + esc(u.branch_name || '') + '</td><td><span class="badge badge-' + (u.active ? 'active' : 'inactive') + '">' + (u.active ? 'Active' : 'Inactive') + '</span></td><td style="white-space:nowrap;"><button class="btn-sm-primary" onclick="BOUsers.edit(' + i + ')">Edit</button> ' + (isManager() ? '<button class="btn-sm-danger" onclick="BOUsers.del(\'' + BO.jsq(u.id) + '\')">Del</button> ' : '') + '<button class="btn-sm-' + (u.active ? 'warning' : 'success') + '" onclick="BOUsers.toggle(\'' + BO.jsq(u.id) + '\',' + (u.active ? 'false' : 'true') + ')">' + (u.active ? 'Deactivate' : 'Activate') + '</button></td></tr>';
      });
      el.innerHTML = h + '</tbody></table></div></div></div>';
    }).catch(function (e) { var el = document.getElementById('usersTable'); if (el) el.innerHTML = BO.errorBox(e); });
  }
  function add() {
    var args = { email: g('newUserEmail').trim(), name: g('newUserName').trim(), role: g('newUserRole'), handle: g('newUserId').trim(), password: g('newUserPwd') };
    if (g('newUserBranch')) args.branch_id = g('newUserBranch');
    if (isManager() && g('newUserVendor')) args.vendor_id = g('newUserVendor');
    if (!args.email || !args.name || !args.handle || !args.password) { alert('Email, name, user ID and password are required.'); return; }
    srv('addUser', args).then(function () { showToast('User added successfully.'); ['newUserEmail', 'newUserName', 'newUserId', 'newUserPwd'].forEach(function (id) { document.getElementById(id).value = ''; }); list(); }).catch(BO.fail);
  }
  function toggle(id, active) { srv('toggleUser', { id: id, active: active }).then(function () { list(); }).catch(BO.fail); }
  function del(id) { BO.confirm('Delete this user?', function () { srv('deleteUser', { id: id }).then(function () { showToast('User deleted.'); list(); }).catch(BO.fail); }); }

  var MODAL = '<div class="modal fade" id="editUserModal" tabindex="-1"><div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">Edit User</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><input type="hidden" id="editUserIdHidden">'
    + '<div class="form-group" style="margin-bottom:12px;"><label class="form-label">Email</label><input class="form-control" id="editUserEmail"></div>'
    + '<div class="fg2" style="margin-bottom:12px;"><div class="form-group"><label class="form-label">Name</label><input class="form-control" id="editUserName"></div><div class="form-group"><label class="form-label">Role</label><select class="form-select" id="editUserRole"></select></div></div>'
    + '<div class="fg2" style="margin-bottom:12px;"><div class="form-group"><label class="form-label">User ID</label><input class="form-control" id="editUserId"></div><div class="form-group" id="editUserPwdGroup"><label class="form-label">Password</label><input class="form-control" id="editUserPwd" type="password" placeholder="Leave blank to keep" autocomplete="new-password"></div></div>'
    + '<div class="fg2" style="margin-bottom:14px;"><div class="form-group"><label class="form-label">Active</label><select class="form-select" id="editUserActive"><option value="true">Yes</option><option value="false">No</option></select></div><div class="form-group" id="editUserBranchWrap"></div></div>'
    + '<div class="form-group"><label class="form-label">Profile Photo</label><div class="photo-upload-area" onclick="document.getElementById(\'photoFileInput\').click()"><img id="photoPreview" class="photo-preview" src="" alt="" style="display:none;margin:0 auto 8px;"><div id="photoPlaceholder" class="muted small">📷 Click to upload photo</div></div><input type="file" id="photoFileInput" accept="image/*" style="display:none;" onchange="BOUsers.previewPhoto(this)"></div>'
    + '</div><div class="modal-footer"><button class="btn-secondary" data-bs-dismiss="modal">Cancel</button><button class="btn-primary" onclick="BOUsers.save()">Save Changes</button></div></div></div></div>';
  function edit(i) {
    var u = rows[i]; if (!u) return;
    BO.ensureModal('editUserModal', MODAL);
    document.getElementById('editUserIdHidden').value = u.id; document.getElementById('editUserEmail').value = u.email || ''; document.getElementById('editUserName').value = u.name || ''; document.getElementById('editUserId').value = u.handle || ''; document.getElementById('editUserActive').value = u.active ? 'true' : 'false';
    var roles = ['seller', 'admin', 'assistant-admin'].concat(isManager() ? ['manager', 'assistant-manager'] : []);
    document.getElementById('editUserRole').innerHTML = roles.map(function (r) { return '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + r + '</option>'; }).join('');
    document.getElementById('editUserPwdGroup').style.display = isManager() ? '' : 'none'; document.getElementById('editUserPwd').value = '';
    var bw = document.getElementById('editUserBranchWrap'); bw.innerHTML = shopSelect('editUserBranch', u.branch_id || '').replace('<div class="form-group">', '').replace(/<\/div>$/, '');
    pendingPhoto = null; var prev = document.getElementById('photoPreview'), ph = document.getElementById('photoPlaceholder');
    if (u.profile_photo_url) { prev.src = u.profile_photo_url; prev.style.display = 'block'; ph.style.display = 'none'; } else { prev.style.display = 'none'; ph.style.display = ''; }
    openModal('editUserModal');
  }
  function previewPhoto(input) { BO.fileToDataUrl(input, function (d, err) { if (!d) { showToast(err || 'Could not read the photo.', '⚠️'); return; } pendingPhoto = d; var p = document.getElementById('photoPreview'); p.src = d; p.style.display = 'block'; document.getElementById('photoPlaceholder').style.display = 'none'; }, 600); }
  function save() {
    var id = g('editUserIdHidden');
    var args = { id: id, email: g('editUserEmail').trim(), name: g('editUserName').trim(), role: g('editUserRole'), handle: g('editUserId').trim(), active: g('editUserActive') === 'true' };
    if (isManager() && g('editUserPwd')) args.password = g('editUserPwd');
    var b = document.getElementById('editUserBranch'); if (b) args.branch_id = b.value;
    srv('updateUser', args).then(function () {
      if (!pendingPhoto) return null;
      return srv('uploadProfilePhoto', { profile_id: id, data_url: pendingPhoto }).then(function (r) { if (S.user && S.user.id === id) { S.user.profile_photo_url = r.url; document.getElementById('topbarAvatar').innerHTML = '<img src="' + esc(r.url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">'; } });
    }).then(function () { closeModal('editUserModal'); showToast('User updated.'); list(); }).catch(BO.fail);
  }
  /* The pin is not part of the session's vendor row (the sign-in path must not depend on a
     column a database may not have yet), so it is fetched here, once, when the screen opens.
     Until it has arrived the box is disabled and is NOT sent with a save: an empty box means
     "take my pin away", and a box that is empty only because it has not loaded must not. */
  var pinLoaded = false;
  function paintPin(place) {
    var box = document.getElementById('myBusinessPin'), test = document.getElementById('myPinTest'), note = document.getElementById('myPinNote');
    if (!box) return;
    pinLoaded = true; box.disabled = false; box.value = (place && place.text) || '';
    box.placeholder = 'Paste a Google Maps link, or tap the button while at the shop';
    if (test) { test.classList.toggle('hidden', !(place && place.link)); if (place && place.link) test.href = place.link; }
    if (place && place.ready === false && note) note.innerHTML = '⚠️ The shop location cannot be saved yet: the system manager has to run <span class="mono">db/RUN-ME-006</span> in Supabase first. Everything else on this form saves as usual.';
  }
  function loadPin() {
    pinLoaded = false;
    srv('businessProfile', {}).then(function (r) { paintPin(r.place); }).catch(function () {
      var box = document.getElementById('myBusinessPin'); if (box) box.placeholder = 'Could not load the saved location — reopen this tab to edit it';
    });
  }
  /* The phone's own position, written into the box as two numbers the person can see before
     they save. Nothing is sent until "Save Profile". A phone that will not say where it is
     (permission refused, no GPS indoors, an older copy of the app) is told how to do it by
     hand instead of being left with a button that does nothing. */
  /* ---- Lipa Namba ---- */
  var PAY_LINES = 3;
  function loadPay() { BO.payNumbers(paintPay, true); }      // asked afresh: another admin may have changed them
  function paintPay(pn) {
    var box = document.getElementById('payNumRows'), btn = document.getElementById('payNumSave'); if (!box) return;
    if (pn.failed) { box.innerHTML = '<div class="muted small">Could not load the saved numbers. Tap ↻ and try again.</div>'; return; }
    if (!pn.ready) { box.innerHTML = '<div class="alert-info">Pay numbers cannot be saved yet: this database needs <strong>db/RUN-ME-008</strong> first. Ask the manager to run it in Supabase.</div>'; return; }
    var rows = pn.rows || [], h = '';
    for (var i = 0; i < PAY_LINES; i++) {
      var n = rows[i] || {};
      h += '<div class="pay-edit"><input type="text" class="form-control pay-net" list="payNets" placeholder="Network or bank" maxlength="30" value="' + esc(n.network || '') + '" aria-label="Network or bank, line ' + (i + 1) + '">'
        + '<input type="text" inputmode="numeric" class="form-control pay-no mono" placeholder="Number" maxlength="20" value="' + esc(n.number || '') + '" aria-label="Number, line ' + (i + 1) + '">'
        + '<input type="text" class="form-control pay-name" placeholder="Name the customer sees" maxlength="60" value="' + esc(n.name || '') + '" aria-label="Name the customer sees, line ' + (i + 1) + '"></div>';
    }
    box.innerHTML = h;
    if (btn) btn.disabled = false;
  }
  function savePay() {
    var msg = document.getElementById('payNumMsg'), btn = document.getElementById('payNumSave'), numbers = [], tok = S.token;
    if (btn && btn.disabled) return;                    // a second tap while the first save is still on its way
    document.querySelectorAll('#payNumRows .pay-edit').forEach(function (row) {
      numbers.push({ network: row.querySelector('.pay-net').value.trim(), number: row.querySelector('.pay-no').value.trim(), name: row.querySelector('.pay-name').value.trim() });
    });
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = 'Saving…';
    srv('setPayNumbers', { numbers: numbers }).then(function (r) {
      /* The save was made by whoever was signed in when Save was tapped. If somebody else is signed
         in now (a shared shop phone, a slow line), its answer is not theirs: it must not become
         the number their till shows, nor fill their editor. */
      if (S.token !== tok) return;
      S.payGen = (S.payGen || 0) + 1;                   // any question asked before this is older than the save
      S.payNums = { rows: r.rows || [], ready: true, at: Date.now() };   // this till reads the new list at once
      paintPay(S.payNums);                              // ...and puts the Save button back
      if (msg) { msg.textContent = '✅ ' + (r.message || 'Saved'); setTimeout(function () { msg.textContent = ''; }, 6000); }
    }).catch(function (e) {
      if (S.token !== tok) return;                      // somebody else's screen now (see above)
      /* A save that failed may have failed half way: what the till holds is no longer known to
         be true, so it is dropped and asked for again. What is TYPED here stays, to correct or to
         send again -- except when somebody else's list won (409): that one is saved, the message
         says so, and the editor is brought to it (paintPay puts the Save button back; if that
         read fails too the button stays off, because there is then nothing to save from). */
      S.payGen = (S.payGen || 0) + 1; S.payNums = null;
      if (msg) msg.textContent = '';
      BO.fail(e);
      if (e && e.status === 409) loadPay();
      else if (btn) btn.disabled = false;
    });
  }
  function pinHere() {
    var box = document.getElementById('myBusinessPin'), btn = document.getElementById('myPinHere');
    var cannot = function (why) { BO.notify(why + '\n\nYou can still set it by hand: open Google Maps, press and hold on your shop, tap Share, copy the link, and paste it in the box.'); };
    if (!box || !pinLoaded) { showToast('One moment — still loading the saved location.', '⏳'); return; }
    if (!navigator.geolocation) { cannot('This phone or app cannot read its location.'); return; }
    var old = btn ? btn.textContent : ''; if (btn) { btn.disabled = true; btn.textContent = '📡 Finding you…'; }
    var done = function () { if (btn) { btn.disabled = false; btn.textContent = old; } };
    var found = function (pos) {
      done();
      box.value = pos.coords.latitude.toFixed(6) + ', ' + pos.coords.longitude.toFixed(6);
      var acc = Math.round(pos.coords.accuracy || 0);
      showToast('Location found' + (acc ? ' (within about ' + acc + ' m)' : '') + '. Tap Save Profile to keep it.', '📍');
    };
    var failed = function (err) {
      done();
      cannot(err && err.code === 1 ? 'Permission to use the location was not given. If you are in the Android app, update it to the newest version, then allow Location when it asks.'
        : 'The phone could not find its location just now. Check that Location is switched on in the phone\'s settings, then try again outside or near a window.');
    };
    /* TWO TRIES, BECAUSE A SHOP IS INDOORS. The satellites are asked first -- that is the pin a
       customer can walk to -- but under a roof they often do not answer in time. Rather than
       give up there, the phone is asked again for the position it already knows from the
       network, which is quick and good to a street. A refusal of permission is final: asking
       twice would only show the same "no" twice. */
    navigator.geolocation.getCurrentPosition(found, function (err) {
      if (err && err.code === 1) { failed(err); return; }
      navigator.geolocation.getCurrentPosition(found, failed, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
  }
  function saveProfile() {
    var msg = document.getElementById('bizProfileMsg'); msg.textContent = 'Saving…';
    var args = { business_type: g('myBusinessType').trim(), phone: g('myBusinessPhone').trim(), address: g('myBusinessAddress').trim(), currency: g('myCurrencyInput').trim().toUpperCase() };
    if (pinLoaded) args.location = g('myBusinessPin').trim();
    srv('setBusinessProfile', args).then(function (r) {
      if (r.vendor) S.vendor = r.vendor;
      if (r.place) paintPin(r.place);
      /* THE NUMBER COMES BACK WHOLE. A shopkeeper types 0712 345 678, the way the number is
         said aloud, and a WhatsApp link needs +255712345678 -- the server now completes it
         (phone.js). Showing the completed number in the box, and saying so, is what tells them
         the button on the marketplace will reach them; leaving their own spelling on screen
         would leave them wondering which of the two was kept. */
      var typed = args.phone, kept = (r.vendor && r.vendor.phone) || '', box = document.getElementById('myBusinessPhone');
      if (box) box.value = kept;
      var fixed = kept && typed.replace(/[^\d+]/g, '') !== kept;
      if (r.warning) { msg.textContent = ''; BO.notify(r.warning); return; }
      msg.textContent = fixed ? '✅ Saved — your number is kept as ' + kept + ', so the WhatsApp button reaches you'
        : (r.place && r.place.link) ? '✅ Saved — your 📍 Location button reaches the marketplace within a minute' : '✅ Saved';
      setTimeout(function () { msg.textContent = ''; }, fixed ? 8000 : 4500);
    }).catch(function (e) { msg.textContent = ''; BO.fail(e); });
  }
  function openLogo() {
    pendingLogo = null; document.getElementById('logoPreview').style.display = 'none'; document.getElementById('logoPlaceholder').style.display = ''; document.getElementById('logoUploadResult').innerHTML = '';
    document.getElementById('logoFileInput').onchange = function () { BO.fileToDataUrl(this, function (d, err) { if (!d) { showToast(err || 'Could not read the file.', '⚠️'); return; } pendingLogo = d; var p = document.getElementById('logoPreview'); p.src = d; p.style.display = 'block'; document.getElementById('logoPlaceholder').style.display = 'none'; }, 600); };
    document.getElementById('logoModal').querySelector('.modal-footer .btn-primary').onclick = uploadLogo;
    openModal('logoModal');
  }
  function uploadLogo() {
    if (!pendingLogo) { alert('Select an image first.'); return; }
    srv('uploadLogo', { data_url: pendingLogo }).then(function (r) { document.getElementById('logoUploadResult').innerHTML = '<div class="alert-success">Logo uploaded!</div>'; if (S.vendor) S.vendor.logo_url = r.url; document.getElementById('customLogoImg').src = r.url; document.getElementById('customLogoRow').classList.remove('hidden'); setTimeout(function () { closeModal('logoModal'); load(); }, 800); })
      .catch(function (e) { document.getElementById('logoUploadResult').innerHTML = '<div class="alert-danger">' + esc(e.message) + '</div>'; });
  }

  BO.tabs.users = { load: load, sync: list };
  return { load: load, search: search, add: add, toggle: toggle, del: del, edit: edit, save: save, previewPhoto: previewPhoto, saveProfile: saveProfile, pinHere: pinHere, savePay: savePay, openLogo: openLogo, uploadLogo: uploadLogo };
})();
