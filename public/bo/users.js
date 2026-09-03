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
      h += '<div class="section-card" style="margin-bottom:18px;"><div class="section-hdr"><span>🏷️</span><div class="section-hdr-title">Business Profile &amp; Marketplace Listing</div></div><div class="section-body"><div class="fg3" style="align-items:end;"><div class="form-group"><label class="form-label">Business Type</label><input type="text" class="form-control" id="myBusinessType" placeholder="e.g. Groceries" value="' + esc(v.business_type || '') + '"></div><div class="form-group"><label class="form-label">Contact Phone (WhatsApp)</label><input type="text" class="form-control" id="myBusinessPhone" placeholder="Start with code, e.g. +255" value="' + esc(v.phone || '') + '"></div><div class="form-group"><label class="form-label">Currency</label><input type="text" class="form-control mono" id="myCurrencyInput" value="' + esc(v.currency || 'TZS') + '" style="text-transform:uppercase;"></div></div><div class="form-group" style="margin-top:12px;"><label class="form-label">Business Address / Location</label><input type="text" class="form-control" id="myBusinessAddress" placeholder="e.g. Kariakoo, Dar es Salaam" value="' + esc(v.address || '') + '"></div><div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;"><button class="btn-primary" onclick="BOUsers.saveProfile()">Save Profile</button><button class="btn-secondary" onclick="BOUsers.openLogo()">🖼️ Upload Logo</button>' + (v.logo_url ? '<img src="' + esc(v.logo_url) + '" style="max-height:32px;max-width:90px;object-fit:contain;border-radius:6px;" onerror="this.style.display=\'none\'">' : '') + '<span id="bizProfileMsg" class="small muted"></span></div><div class="small muted" style="margin-top:8px;">This appears on your marketplace storefront so customers can reach you.</div></div></div>';
    }
    h += '<div class="search-wrap"><span class="search-ico">🔍</span><input type="text" class="form-control" id="userSearch" placeholder="Search name, role, user ID, vendor…" onkeyup="BOUsers.search()"></div><div id="usersTable" class="empty">Loading…</div>';
    el.innerHTML = h;
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
        h += '<tr><td style="width:40px;">' + av + '</td><td style="font-weight:500;">' + esc(u.name) + '<div class="small muted">' + esc(u.email || '') + '</div></td><td><span class="badge badge-' + esc(String(u.role).replace(/[^a-z-]/g, '')) + '">' + esc(u.role) + '</span></td><td class="mono small" style="color:var(--accent);">' + esc(u.handle) + '</td><td class="muted">' + esc(u.vendor_name || '–') + '</td><td class="small">' + esc(u.branch_name || '') + '</td><td><span class="badge badge-' + (u.active ? 'active' : 'inactive') + '">' + (u.active ? 'Active' : 'Inactive') + '</span></td><td style="white-space:nowrap;"><button class="btn-sm-primary" onclick="BOUsers.edit(' + i + ')">Edit</button> ' + (isManager() ? '<button class="btn-sm-danger" onclick="BOUsers.del(\'' + esc(u.id) + '\')">Del</button> ' : '') + '<button class="btn-sm-' + (u.active ? 'warning' : 'success') + '" onclick="BOUsers.toggle(\'' + esc(u.id) + '\',' + (u.active ? 'false' : 'true') + ')">' + (u.active ? 'Deactivate' : 'Activate') + '</button></td></tr>';
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
  function del(id) { if (!BO.confirm('Delete this user?')) return; srv('deleteUser', { id: id }).then(function () { showToast('User deleted.'); list(); }).catch(BO.fail); }

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
  function saveProfile() {
    var msg = document.getElementById('bizProfileMsg'); msg.textContent = 'Saving…';
    srv('setBusinessProfile', { business_type: g('myBusinessType').trim(), phone: g('myBusinessPhone').trim(), address: g('myBusinessAddress').trim(), currency: g('myCurrencyInput').trim().toUpperCase() }).then(function (r) {
      if (r.vendor) S.vendor = r.vendor;
      msg.textContent = '✅ Saved'; setTimeout(function () { msg.textContent = ''; }, 2500);
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
  return { load: load, search: search, add: add, toggle: toggle, del: del, edit: edit, save: save, previewPhoto: previewPhoto, saveProfile: saveProfile, openLogo: openLogo, uploadLogo: uploadLogo };
})();
