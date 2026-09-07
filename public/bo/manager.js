/* MANAGEMENT -- the Samaritan Techs panel: registration switch, commission, trial length, every
   business and its admin, restriction, logos, message templates, the email center, the
   announcement, and marketplace analytics. */
window.BOMgr = (function () {
  var summary = [], settings = {}, pendingLogo = null, logoVendor = '';
  function g(id) { var e = document.getElementById(id); return e ? e.value : ''; }
  function card(icon, title, body, extra) { return '<div class="section-card" style="margin-bottom:20px;"><div class="section-hdr"><span>' + icon + '</span><div class="section-hdr-title">' + title + '</div>' + (extra || '') + '</div>' + body + '</div>'; }
  function emailBtn(fn, icon, title, sub) { return '<button class="email-btn" onclick="BOMgr.email(\'' + fn + '\',\'' + title.replace(/'/g, "\\'") + '\')"><span class="eb-ico">' + icon + '</span><span><span class="eb-t">' + title + '</span><span class="eb-s">' + sub + '</span></span></button>'; }

  function load() {
    var el = document.getElementById('managerContent'); if (!el) return;
    if (!isManager()) { el.innerHTML = '<div class="empty">Managers only.</div>'; return; }
    el.innerHTML = '<div class="empty">Loading…</div>';
    srv('settingsGet', {}).then(function (r) { settings = r.settings || {}; render(el); loadSummary(); loadAnalytics(); loadInvoices(); }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }
  function render(el) {
    var s = settings;
    var h = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-bottom:20px;">'
      + '<div class="section-card" style="margin:0;"><div class="section-hdr"><span>🔓</span><div class="section-hdr-title">Free Registration</div></div><div class="section-body"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="freeRegSwitch"' + (s.FreeRegistration === 'Yes' ? ' checked' : '') + ' onchange="BOMgr.setting(\'FreeRegistration\', this.checked ? \'Yes\' : \'No\')" style="margin-right:10px;"><label class="form-check-label" for="freeRegSwitch">Allow new vendors to self-register</label></div></div></div>'
      + '<div class="section-card" style="margin:0;"><div class="section-hdr"><span>💼</span><div class="section-hdr-title">Commission Rate</div></div><div class="section-body"><div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end;"><div class="form-group"><label class="form-label">% of each vendor\'s sales</label><input type="number" class="form-control" id="commRate" step="0.1" min="0" value="' + esc(s.commissionRate || 0) + '"></div><button class="btn-primary" onclick="BOMgr.setting(\'commissionRate\', BOMgr.g(\'commRate\'))">Save</button></div></div></div>'
      + '<div class="section-card" style="margin:0;"><div class="section-hdr"><span>🎁</span><div class="section-hdr-title">Free Trial Length</div></div><div class="section-body"><div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end;"><div class="form-group"><label class="form-label">Trial days for new / reactivated vendors</label><input type="number" class="form-control" id="trialDaysSetting" min="0" value="' + esc(s.trialDays || 60) + '"></div><button class="btn-primary" onclick="BOMgr.setting(\'trialDays\', BOMgr.g(\'trialDaysSetting\'))">Save</button></div></div></div></div>';
    h += card('🏢', 'Registered Businesses &amp; Admins', '<div id="adminsVendorWrap" class="empty">Loading…</div>', '<div class="small muted" style="margin-left:auto;">Edit name, role, status · restrict · logo</div>');
    h += card('✉️', 'Messages &amp; Reminders', '<div class="section-body"><div class="form-group" style="margin-bottom:14px;"><label class="form-label">Payment / restriction message</label><textarea class="form-control" id="paymentReminderBox" rows="3" style="resize:vertical;">' + esc(s.paymentReminderText || '') + '</textarea><div class="small muted" style="margin-top:5px;">Placeholders: {vendor} {admin} {amount} {currency}. Blank = the built-in message.</div><div style="margin-top:8px;"><button class="btn-primary" onclick="BOMgr.setting(\'paymentReminderText\', BOMgr.g(\'paymentReminderBox\'))">Save Payment Message</button></div></div><div class="form-group"><label class="form-label">Lending reminder message</label><textarea class="form-control" id="lendingReminderBox" rows="3" style="resize:vertical;">' + esc(s.lendingReminderText || '') + '</textarea><div class="small muted" style="margin-top:5px;">Placeholders: {borrowerName} {vendor} {items} {total} {currency} {days}. Blank = the built-in message.</div><div style="margin-top:8px;"><button class="btn-primary" onclick="BOMgr.setting(\'lendingReminderText\', BOMgr.g(\'lendingReminderBox\'))">Save Lending Message</button></div></div></div>', '<div class="small muted" style="margin-left:auto;">Used in the payment banner &amp; reminder emails</div>');
    h += card('📧', 'Email Center — send on demand', '<div class="section-body"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;">'
      + emailBtn('emailDaily', '📊', 'Send Daily Reports', 'To eligible admins & sellers') + emailBtn('emailWeekly', '📅', 'Send Weekly Reports', 'To eligible admins') + emailBtn('emailMonthly', '📆', 'Send Monthly Reports', 'To eligible admins')
      + emailBtn('emailCommission', '💼', 'Send Commission Demands', 'Invoices for the current cycle') + emailBtn('emailPaymentReminders', '🔒', 'Send Payment Reminders', 'To restricted accounts only') + emailBtn('emailLendingReminders', '⏰', 'Send Lending Reminders', 'All active borrowers, all vendors') + emailBtn('emailManagerSummary', '🧾', 'Email Me Vendor Summary', 'Daily summary to manager inbox')
      + '</div><div id="emailCenterMsg" style="margin-top:12px;font-size:.84rem;"></div></div>', '<div class="small muted" style="margin-left:auto;">You control all emails</div>');
    h += card('📣', "Announcement / What's New", '<div class="section-body"><div class="fg2" style="margin-bottom:10px;"><div class="form-group"><label class="form-label">Title</label><input class="form-control" id="annTitle" value="' + esc(s.announcement_title || "What's New") + '"></div><div class="form-group"><label class="form-label">Audience</label><select class="form-select" id="annAudience"><option value="both"' + (s.announcement_audience === 'both' ? ' selected' : '') + '>Everyone</option><option value="vendors"' + (s.announcement_audience === 'vendors' ? ' selected' : '') + '>Businesses only</option><option value="marketplace"' + (s.announcement_audience === 'marketplace' ? ' selected' : '') + '>Marketplace visitors</option></select></div></div><div class="form-group"><label class="form-label">Text</label><textarea class="form-control" id="annText" rows="3">' + esc(s.announcement_text || '') + '</textarea></div><div style="margin-top:10px;display:flex;gap:12px;align-items:center;"><div class="form-check form-switch"><input class="form-check-input" type="checkbox" id="annEnabled"' + (s.announcement_enabled === 'Yes' ? ' checked' : '') + ' style="margin-right:8px;"><label class="form-check-label" for="annEnabled">Show it</label></div><button class="btn-primary" onclick="BOMgr.saveAnnouncement()">Save Announcement</button></div></div>');
    /* THE BILLING CARD SITS NEXT TO THE RATE THAT DRIVES IT, deliberately: the switch that can
       stop other people trading should not be a click away from the number it collects. */
    h += card('🧾', 'Invoices &amp; automatic blocking',
      '<div class="section-body">'
      + '<div class="alert-warning" style="margin-bottom:12px;font-size:.82rem;">'
      + '<strong>A blocked business cannot sell at all.</strong> Not a banner \u2014 every till, every shop, until the invoice is settled. '
      + 'Issue invoices first, look at who would be blocked, and only then switch blocking on.</div>'
      + '<div class="fg2" style="margin-bottom:10px;">'
      + '<div class="form-group"><label class="form-label">Automatic blocking</label><select class="form-select" id="autoBlock">'
      + '<option value="No"' + (settings.autoBlockEnabled !== 'Yes' ? ' selected' : '') + '>Off \u2014 invoice only</option>'
      + '<option value="Yes"' + (settings.autoBlockEnabled === 'Yes' ? ' selected' : '') + '>On \u2014 block unpaid accounts</option>'
      + '</select></div>'
      + '<div class="form-group"><label class="form-label">Grace days after the period ends</label>'
      + '<input type="number" class="form-control" id="graceDays" min="0" max="60" value="' + esc(settings.invoiceGraceDays || 7) + '"></div>'
      + '<div class="form-group"><label class="form-label">Never block below (amount)</label>'
      + '<input type="number" class="form-control" id="minInvoice" min="0" value="' + esc(settings.minInvoiceAmount || 1000) + '"></div>'
      + '<button class="btn-primary" onclick="BOMgr.saveBilling()">Save</button></div>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">'
      + '<button class="btn-secondary" onclick="BOMgr.issueInvoices()">Issue invoices for closed periods</button>'
      + '<button class="btn-secondary" onclick="BOMgr.previewBlock()">Who would be blocked?</button>'
      + '<button class="btn-warning" onclick="BOMgr.runBlock()">Run blocking now</button></div>'
      + '<div id="billingMsg" class="small" style="margin-bottom:10px;"></div>'
      + '<div id="invoicesWrap"><div class="muted">Loading\u2026</div></div></div>');

    h += card('📈', 'Marketplace Analytics', '<div class="section-body" id="analyticsWrap"><div class="muted">Loading…</div></div>', '<div style="margin-left:auto;"><button class="btn-sm-primary" onclick="BOMgr.loadAnalytics()">↻ Refresh</button></div>');
    el.innerHTML = h;
  }
  /* ---------------------------------------------------------------- billing */
  function billMsg(html) { var e = document.getElementById('billingMsg'); if (e) e.innerHTML = html; }
  function saveBilling() {
    var on = g('autoBlock');
    if (on === 'Yes' && !BO.confirm('Switch ON automatic blocking?\n\nAn unpaid business will be unable to sell anything until it pays. Make sure you have looked at "Who would be blocked?" first.')) return;
    srv('settingSet', { key: 'invoiceGraceDays', value: g('graceDays') })
      .then(function () { return srv('settingSet', { key: 'minInvoiceAmount', value: g('minInvoice') }); })
      .then(function () { return srv('settingSet', { key: 'autoBlockEnabled', value: on }); })
      .then(function () { settings.autoBlockEnabled = on; settings.invoiceGraceDays = g('graceDays'); settings.minInvoiceAmount = g('minInvoice'); showToast('Billing settings saved.'); loadInvoices(); })
      .catch(BO.fail);
  }
  function issueInvoices() {
    if (!BO.confirm('Issue invoices for every period that has closed?\n\nNothing is sent and nobody is blocked by this — it only writes the invoices.')) return;
    srv('issueInvoices', {}).then(function (r) { billMsg('<div class="alert-success">' + esc(r.message) + '</div>'); loadInvoices(); }).catch(BO.fail);
  }
  /* PREVIEW IS NOT A WRITE. runAutoBlock blocks nobody while the setting is Off, so the honest
     preview is simply running it with the switch off -- one code path, not a second one that
     could disagree with what actually happens. */
  function previewBlock() {
    srv('runAutoBlock', {}).then(function (r) { billMsg(blockReport(r)); loadInvoices(); }).catch(BO.fail);
  }
  function runBlock() {
    if (settings.autoBlockEnabled !== 'Yes') { billMsg('<div class="alert-info">Automatic blocking is off, so this only reports. Switch it on above to actually block.</div>'); }
    else if (!BO.confirm('Block every business whose invoice is past its grace period?\n\nThey will not be able to sell until they pay.')) return;
    srv('runAutoBlock', {}).then(function (r) { billMsg(blockReport(r)); loadInvoices(); loadSummary(); }).catch(BO.fail);
  }
  function blockReport(r) {
    var h = '<div class="alert-' + (r.refused_too_many ? 'danger' : r.blocked ? 'warning' : 'info') + '">' + esc(r.message) + '</div>';
    if (r.would_block && r.would_block.length) {
      h += '<div class="table-wrap" style="margin-top:8px;"><table class="bo-table"><thead><tr><th>Business</th><th>Invoice</th><th>Outstanding</th><th>Overdue since</th></tr></thead><tbody>'
        + r.would_block.map(function (w) { return '<tr><td>' + esc(w.vendor) + '</td><td class="mono small">' + esc(w.invoice) + '</td><td class="mono">' + BO.fmtFull(w.outstanding) + '</td><td class="small muted">' + BO.fmtDate(w.since) + '</td></tr>'; }).join('')
        + '</tbody></table></div>';
    }
    return h;
  }
  function loadInvoices() {
    var el = document.getElementById('invoicesWrap'); if (!el) return;
    srv('invoices', {}).then(function (r) {
      if (r.missing_table) { el.innerHTML = '<div class="alert-warning">' + esc(r.notice) + '</div>'; return; }
      if (!r.rows.length) { el.innerHTML = '<div class="muted">No invoices yet. Use “Issue invoices for closed periods”.</div>'; return; }
      el.innerHTML = '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Invoice</th><th>Period</th><th>Sales</th><th>Due</th><th>Paid</th><th>Status</th><th></th></tr></thead><tbody>'
        + r.rows.map(function (i) {
          var badge = i.status === 'paid' ? 'badge-active' : i.status === 'waived' ? 'badge-seller' : i.status === 'part_paid' ? 'badge-low' : 'badge-out';
          return '<tr><td class="mono small">' + esc(i.number) + '</td>'
            + '<td class="small muted">' + BO.fmtDate(i.period_start) + ' – ' + BO.fmtDate(i.period_end) + '</td>'
            + '<td class="mono">' + BO.fmtFull(i.sales_total) + '</td>'
            + '<td class="mono">' + BO.fmtFull(i.due) + '</td>'
            + '<td class="mono">' + BO.fmtFull(i.amount_paid) + '</td>'
            + '<td><span class="badge ' + badge + '">' + esc(i.status) + '</span>' + (i.blocked_at && !i.unblocked_at ? ' <span class="badge badge-out">blocked</span>' : '') + '</td>'
            + '<td style="white-space:nowrap;">' + (i.status === 'paid' || i.status === 'waived' ? '' :
              '<button class="btn-sm-primary" onclick="BOMgr.payInvoice(\'' + BO.jsq(i.id) + '\',' + Number(i.outstanding) + ')">Record payment</button> '
              + '<button class="btn-sm-warning" onclick="BOMgr.waive(\'' + BO.jsq(i.id) + '\')">Waive</button>') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }
  function payInvoice(id, outstanding) {
    BO.dialog({ title: 'Record a payment', body:
      '<div class="form-group" style="margin-bottom:10px;"><label class="form-label">Amount received</label><input type="number" class="form-control" id="payAmt" value="' + Number(outstanding) + '"></div>'
      + '<div class="form-group" style="margin-bottom:10px;"><label class="form-label">How</label><select class="form-select" id="payMethod"><option>Lipa Number</option><option>Cash</option><option>Bank</option></select></div>'
      + '<div class="form-group"><label class="form-label">Reference</label><input class="form-control" id="payRef" placeholder="M-Pesa / Tigo Pesa transaction id">'
      + '<div class="small muted" style="margin-top:4px;">Required. With no payment system inside the app, this is the only record that the money arrived.</div></div>',
      footer: '<button class="btn-secondary" onclick="BO.closeDialog()">Cancel</button><button class="btn-primary" onclick="BOMgr.savePayment(\'' + BO.jsq(id) + '\')">Save</button>' });
  }
  function savePayment(id) {
    srv('recordInvoicePayment', { id: id, amount: Number(g('payAmt')), method: g('payMethod'), reference: g('payRef').trim() })
      .then(function (r) { BO.closeDialog(); showToast(r.message); loadInvoices(); loadSummary(); }).catch(BO.fail);
  }
  function waive(id) {
    var reason = prompt('Why is this invoice being waived?'); if (reason == null || !reason.trim()) return;
    srv('waiveInvoice', { id: id, reason: reason.trim() }).then(function (r) { showToast(r.message); loadInvoices(); loadSummary(); }).catch(BO.fail);
  }

  function setting(key, value) { srv('settingSet', { key: key, value: value }).then(function () { settings[key] = value; showToast('Saved: ' + key); }).catch(BO.fail); }
  function saveAnnouncement() { srv('setAnnouncement', { title: g('annTitle').trim(), text: g('annText').trim(), enabled: document.getElementById('annEnabled').checked, audience: g('annAudience') }).then(function (r) { showToast(r.message); }).catch(BO.fail); }

  function loadSummary() {
    var el = document.getElementById('adminsVendorWrap'); if (!el) return;
    srv('managerSummary', {}).then(function (r) {
      summary = r.rows || [];
      if (!summary.length) { el.innerHTML = '<div class="alert-info">No businesses yet.</div>'; return; }
      var h = '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Logo</th><th>Business</th><th>Type</th><th>Admin</th><th>Email</th><th>Today Sales</th><th>Stock Value</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
      summary.forEach(function (v, i) {
        var logo = v.logo_url ? '<img src="' + esc(v.logo_url) + '" style="max-height:24px;max-width:60px;object-fit:contain;border-radius:4px;" onerror="this.style.display=\'none\'">' : '<span class="muted small">–</span>';
        var trial = v.trial_days_left == null ? '' : (v.trial_days_left > 0 ? ' <span class="badge badge-low">Trial: ' + v.trial_days_left + 'd</span>' : ' <span class="badge badge-admin">Trial ended</span>');
        h += '<tr><td>' + logo + '</td><td><strong>' + esc(v.name) + '</strong></td><td class="small muted">' + esc(v.business_type || '–') + '</td><td>' + esc(v.admin_name || '–') + '<br><span class="mono small" style="color:var(--accent);">' + esc(v.admin_handle || '') + '</span></td><td class="small muted">' + esc(v.admin_email || '') + '</td><td class="mono small">' + fmtFull(v.today_sales) + ' ' + esc(v.currency) + '</td><td class="mono small">' + fmtFull(v.stock_value) + ' ' + esc(v.currency) + '</td><td><span class="badge badge-' + (v.active ? 'active' : 'inactive') + '">' + (v.active ? 'Active' : 'Inactive') + '</span>' + (v.restricted ? ' <span class="badge badge-out">🔒 Restricted</span>' : trial) + '</td><td style="white-space:nowrap;">'
          + (v.admin_id ? '<button class="btn-sm-primary" onclick="BOMgr.editAdmin(' + i + ')">Edit</button> ' : '')
          + '<button class="btn-sm-' + (v.active ? 'warning' : 'success') + '" onclick="BOMgr.vendorActive(\'' + BO.jsq(v.id) + '\',\'' + BO.jsq(v.name) + '\',' + (v.active ? 'false' : 'true') + ')">' + (v.active ? 'Deactivate' : 'Activate') + '</button> '
          + '<button class="btn-sm-' + (v.restricted ? 'success' : 'danger') + '" onclick="BOMgr.restrict(\'' + BO.jsq(v.id) + '\',\'' + BO.jsq(v.name) + '\',' + (v.restricted ? 'false' : 'true') + ')">' + (v.restricted ? 'Reactivate' : 'Restrict') + '</button> '
          + '<button class="btn-sm-' + (v.phone_vending ? 'success' : 'secondary') + '" onclick="BOMgr.phoneVending(\'' + BO.jsq(v.id) + '\',\'' + BO.jsq(v.name) + '\',' + (v.phone_vending ? 'false' : 'true') + ')" title="IMEI units, financing partners, cost price and per-line discounts">📱 ' + (v.phone_vending ? 'Phone: ON' : 'Phone: off') + '</button> '
          + '<button class="btn-sm-primary" onclick="BOMgr.openLogo(\'' + BO.jsq(v.id) + '\')">Logo</button></td></tr>';
      });
      el.innerHTML = h + '</tbody></table></div>';
    }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }
  function editAdmin(i) {
    var v = summary[i]; if (!v) return;
    BO.dialog({ title: '✏️ Edit Admin — ' + esc(v.name), body: '<div class="kv" style="margin-bottom:14px;background:var(--surface2);border-radius:8px;padding:10px 12px;"><b>Email</b><span>' + esc(v.admin_email || '') + '</span><b>User ID</b><span class="mono">' + esc(v.admin_handle || '') + '</span><b>Type</b><span>' + esc(v.business_type || '–') + '</span><b>Phone</b><span>' + esc(v.phone || '–') + '</span></div><div class="form-group" style="margin-bottom:12px;"><label class="form-label">Full Name</label><input class="form-control" id="adminEditName" value="' + esc(v.admin_name || '') + '"></div><div class="fg2"><div class="form-group"><label class="form-label">Role</label><select class="form-select" id="adminEditRole"><option value="admin"' + (v.admin_role === 'admin' ? ' selected' : '') + '>Admin</option><option value="assistant-admin"' + (v.admin_role === 'assistant-admin' ? ' selected' : '') + '>Assistant Admin</option></select></div><div class="form-group"><label class="form-label">Status</label><select class="form-select" id="adminEditActive"><option value="true"' + (v.admin_active ? ' selected' : '') + '>Active</option><option value="false"' + (!v.admin_active ? ' selected' : '') + '>Inactive</option></select></div></div>',
      footer: '<button class="btn-secondary" onclick="BO.closeDialog()">Cancel</button><button class="btn-primary" onclick="BOMgr.saveAdmin(\'' + BO.jsq(v.admin_id) + '\')">Save Changes</button>' });
  }
  function saveAdmin(id) {
    var name = g('adminEditName').trim(); if (!name) { alert('Name cannot be empty.'); return; }
    srv('updateAdmin', { profile_id: id, name: name, role: g('adminEditRole'), active: g('adminEditActive') === 'true' }).then(function (r) { BO.closeDialog(); showToast(r.message); loadSummary(); }).catch(BO.fail);
  }
  function vendorActive(id, name, active) {
    if (!BO.confirm(active ? ('Reactivate "' + name + '"?\n\nThe business can sign in again. The trial / billing anchor restarts today.') : ('Deactivate "' + name + '"?\n\nNobody from this business can sign in until it is reactivated.'))) return;
    srv('setVendorActive', { vendor_id: id, active: active }).then(function (r) { showToast(r.message); loadSummary(); }).catch(BO.fail);
  }
  function restrict(id, name, on) {
    if (!BO.confirm(on ? ('Restrict "' + name + '"?\n\nThe owner and their sellers will see a payment notice and the app becomes read-only for them until you reactivate.') : ('Reactivate "' + name + '"?\n\nFull access will be restored.'))) return;
    srv('setVendorRestricted', { vendor_id: id, restricted: on }).then(function (r) { showToast(r.message); loadSummary(); }).catch(BO.fail);
  }
  /* THE ONE PER-BUSINESS FEATURE SWITCH. Everything else on this row is about whether a
     business may sign in or trade at all; this is about what its screens contain. It lives here
     rather than in Settings' permission grid because that grid's only button applies a profile
     to EVERY vendor, which is exactly the wrong shape for one shop's trade. */
  function phoneVending(id, name, on) {
    if (!BO.confirm(on
      ? ('Switch Phone Vending ON for "' + name + '"?\n\nThey get the Phone Vending tab (units by IMEI, financing partners), a Cost Price on each product and a Discount on each sale line.')
      : ('Switch Phone Vending OFF for "' + name + '"?\n\nThe tab and the cost / discount fields disappear from their screens. Nothing is deleted — their handsets and cost prices stay, ready for if you switch it back on.'))) return;
    srv('setVendorPhoneVending', { vendor_id: id, on: on }).then(function (r) { showToast(r.message); loadSummary(); }).catch(BO.fail);
  }
  function openLogo(vendorId) {
    logoVendor = vendorId; pendingLogo = null;
    document.getElementById('logoPreview').style.display = 'none'; document.getElementById('logoPlaceholder').style.display = ''; document.getElementById('logoUploadResult').innerHTML = '';
    document.getElementById('logoFileInput').onchange = function () { BO.fileToDataUrl(this, function (d, err) { if (!d) { showToast(err || 'Could not read the file.', '⚠️'); return; } pendingLogo = d; var p = document.getElementById('logoPreview'); p.src = d; p.style.display = 'block'; document.getElementById('logoPlaceholder').style.display = 'none'; }, 600); };
    document.getElementById('logoModal').querySelector('.modal-footer .btn-primary').onclick = uploadLogo;
    openModal('logoModal');
  }
  function uploadLogo() {
    if (!pendingLogo) { alert('Select an image first.'); return; }
    srv('uploadLogo', { vendor_id: logoVendor, data_url: pendingLogo }).then(function () { document.getElementById('logoUploadResult').innerHTML = '<div class="alert-success">Logo uploaded!</div>'; setTimeout(function () { closeModal('logoModal'); loadSummary(); }, 800); })
      .catch(function (e) { document.getElementById('logoUploadResult').innerHTML = '<div class="alert-danger">' + esc(e.message) + '</div>'; });
  }
  function email(fn, title) {
    if (!BO.confirm('Send now: ' + title + '?')) return;
    var msg = document.getElementById('emailCenterMsg'); msg.innerHTML = '<span class="muted">⏳ Sending: ' + esc(title) + '…</span>';
    srv(fn, {}).then(function (r) { msg.innerHTML = '<div class="alert-success">' + esc(r.message || 'Done.') + '</div>'; }).catch(function (e) { msg.innerHTML = '<div class="alert-danger">' + esc(e.message) + '</div>'; });
  }
  function loadAnalytics() {
    var el = document.getElementById('analyticsWrap'); if (!el) return; el.innerHTML = '<div class="muted">Loading…</div>';
    srv('analytics', {}).then(function (a) {
      var h = '<div style="margin-bottom:14px;"><span class="badge badge-seller" style="font-size:.8rem;">👁️ ' + (a.total_views || 0) + ' total product views tracked</span></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;">';
      h += '<div><div class="small" style="font-weight:700;margin-bottom:8px;">🔥 Most Viewed Products</div>' + ((a.top_viewed || []).length ? '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Product</th><th>Vendor</th><th>Views</th></tr></thead><tbody>' + a.top_viewed.map(function (p) { return '<tr><td>' + esc(p.name) + (p.hot ? ' 🔥' : '') + '</td><td class="small" style="color:var(--accent);">' + esc(p.vendor_name) + '</td><td class="mono">' + p.count + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="muted small">No views yet.</div>') + '</div>';
      h += '<div><div class="small" style="font-weight:700;margin-bottom:8px;">🏆 Best Selling (by qty, this year)</div>' + ((a.top_selling || []).length ? '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Product</th><th>Vendor</th><th>Qty</th><th>Revenue</th></tr></thead><tbody>' + a.top_selling.map(function (p) { return '<tr><td>' + esc(p.name) + '</td><td class="small" style="color:var(--accent);">' + esc(p.vendor_name) + '</td><td class="mono">' + p.qty + '</td><td class="mono">' + fmtFull(p.revenue) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="muted small">No sales yet.</div>') + '</div>';
      h += '<div><div class="small" style="font-weight:700;margin-bottom:8px;">🏢 Most Viewed Businesses</div>' + ((a.top_vendor_views || []).length ? '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Business</th><th>Views</th></tr></thead><tbody>' + a.top_vendor_views.map(function (v) { return '<tr><td>' + esc(v.vendor_name) + '</td><td class="mono">' + v.count + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="muted small">No data yet.</div>') + '</div></div>';
      el.innerHTML = h;
    }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }

  BO.tabs.manager = { load: load, sync: loadSummary };
  return { load: load, saveBilling: saveBilling, issueInvoices: issueInvoices, previewBlock: previewBlock, runBlock: runBlock, payInvoice: payInvoice, savePayment: savePayment, waive: waive, g: g, setting: setting, saveAnnouncement: saveAnnouncement, editAdmin: editAdmin, saveAdmin: saveAdmin, vendorActive: vendorActive, restrict: restrict, phoneVending: phoneVending, openLogo: openLogo, uploadLogo: uploadLogo, email: email, loadAnalytics: loadAnalytics };
})();
