/* MY ACCOUNT -- password and profile photo, for whoever is signed in. */
window.BOAcct = (function () {
  var pending = null;
  function load() {
    var el = document.getElementById('accountContent'); if (!el) return;
    var u = S.user || {}, v = S.vendor;
    el.innerHTML = '<div class="section-card"><div class="section-hdr"><span>🧑</span><div class="section-hdr-title">Signed in as</div></div><div class="section-body"><div class="kv"><b>Name</b><span>' + esc(u.name) + '</span><b>User ID</b><span class="mono">' + esc(u.handle) + '</span><b>Email</b><span>' + esc(u.email) + '</span><b>Role</b><span>' + esc(u.role) + '</span><b>Business</b><span>' + esc(v ? v.name : 'Samaritan Techs (system)') + '</span><b>Currency</b><span>' + esc(cur()) + '</span></div></div></div>'
      + '<div class="section-card"><div class="section-hdr"><span>🔑</span><div class="section-hdr-title">Change Password</div></div><div class="section-body"><div class="fg3"><div class="form-group"><label class="form-label">Current password</label><input type="password" class="form-control" id="pwCurrent" autocomplete="current-password"></div><div class="form-group"><label class="form-label">New password</label><input type="password" class="form-control" id="pwNew" autocomplete="new-password"></div><div class="form-group"><label class="form-label">Confirm new password</label><input type="password" class="form-control" id="pwConfirm" autocomplete="new-password"></div></div><div style="margin-top:12px;"><button class="btn-primary" onclick="BOAcct.changePassword()">Update Password</button></div><div id="pwMsg" style="margin-top:10px;"></div></div></div>'
      + '<div class="section-card"><div class="section-hdr"><span>📷</span><div class="section-hdr-title">Profile Photo</div></div><div class="section-body"><div class="photo-upload-area" onclick="document.getElementById(\'acctPhotoInput\').click()"><img id="acctPhotoPreview" class="photo-preview" src="' + esc(u.profile_photo_url || '') + '" alt="" style="' + (u.profile_photo_url ? '' : 'display:none;') + 'margin:0 auto 8px;"><div id="acctPhotoPh" class="muted small" style="' + (u.profile_photo_url ? 'display:none;' : '') + '">📷 Click to choose a photo</div></div><input type="file" id="acctPhotoInput" accept="image/*" style="display:none;" onchange="BOAcct.preview(this)"><div style="margin-top:12px;"><button class="btn-primary" onclick="BOAcct.upload()">Upload Photo</button> <span id="acctPhotoMsg" class="small muted"></span></div></div></div>';
  }
  function changePassword() {
    var c = document.getElementById('pwCurrent').value, n = document.getElementById('pwNew').value, k = document.getElementById('pwConfirm').value, out = document.getElementById('pwMsg');
    if (!c) { out.innerHTML = '<div class="alert-danger">Enter your current password.</div>'; return; }
    if (!n || n.length < 4) { out.innerHTML = '<div class="alert-danger">The new password must be at least 4 characters.</div>'; return; }
    if (n !== k) { out.innerHTML = '<div class="alert-danger">Passwords do not match.</div>'; return; }
    srv('changePassword', { current: c, password: n }).then(function (r) { out.innerHTML = '<div class="alert-success">' + esc(r.message) + '</div>';
      // The server signed every device out, including this one: say so, then go to sign-in.
      if (r.signed_out) { setTimeout(function () { logout(true); showLogin(false); showToast('Password changed. Sign in with the new one.', '🔑'); }, 1600); } document.getElementById('pwCurrent').value = ''; document.getElementById('pwNew').value = ''; document.getElementById('pwConfirm').value = ''; })
      .catch(function (e) { out.innerHTML = '<div class="alert-danger">' + esc(e.message) + '</div>'; });
  }
  function preview(input) {
    BO.fileToDataUrl(input, function (dataUrl, err) {
      if (!dataUrl) { showToast(err || 'Could not read the photo.', '⚠️'); return; }
      pending = dataUrl;
      var img = document.getElementById('acctPhotoPreview'); img.src = dataUrl; img.style.display = 'block'; document.getElementById('acctPhotoPh').style.display = 'none';
    }, 600);
  }
  function upload() {
    if (!pending) { alert('Choose a photo first.'); return; }
    var msg = document.getElementById('acctPhotoMsg'); msg.textContent = 'Uploading…';
    srv('uploadProfilePhoto', { profile_id: S.user.id, data_url: pending }).then(function (r) {
      msg.textContent = '✅ Saved'; pending = null;
      S.user.profile_photo_url = r.url;
      document.getElementById('topbarAvatar').innerHTML = '<img src="' + esc(r.url) + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">';
    }).catch(function (e) { msg.textContent = ''; BO.fail(e); });
  }
  BO.tabs.account = { load: load };
  return { load: load, changePassword: changePassword, preview: preview, upload: upload };
})();
