/* REPORTS -- downloads (PDF / Excel) for a business, and the manager's cross-vendor reports.
   A download is a plain link the server signs for five minutes, opened in a new tab like the
   old app did, so the phone's download manager and the APK both handle it. */
window.BORep = (function () {
  var vendors = [], mgrType = '';
  var TYPES = [
    ['sales', '📊', 'Sales Report', 'Every line sold in the period'],
    ['stock', '📦', 'Stock Report', 'Current inventory, value & status'],
    ['cashdue', '💰', 'Cash Due Report', "Today's seller balances"],
    ['lending', '📋', 'Lending Report', 'Active, returned or all'],
    ['brandmodel', '📱', 'Sales by Brand & Model', 'Units and revenue per model'],
    ['partner', '🏦', 'Financed / Credit Sales', 'Per financing partner, settled or not'],
    ['cancelled', '🗑️', 'Cancelled Sales', 'What was cancelled, by whom, why'],
    ['employee', '🧑', 'Sales per Employee', 'Units and value per seller'],
    ['branch', '🏬', 'Sales per Shop', 'Units and value per branch'],
    ['payment', '💳', 'Sales by Payment Method', 'Cash, Lipa, Credit'],
    ['movements', '📒', 'Stock Movements', 'Received, sold, transferred, adjusted'],
    ['units', '🔢', 'IMEI / Units List', 'Every serialized unit and its status'],
    ['imei', '🔎', 'Sales by IMEI', 'Which phone, when, which shop'],
  ];
  var MGR_TYPES = [['commission', '💼', 'Commission Report', 'Commission due by vendor & period']].concat(TYPES);
  var DATED = { stock: false, cashdue: false, units: false };

  function g(id) { var e = document.getElementById(id); return e ? e.value : ''; }
  function shopSelect(id) { if (!S.features.has_branches || !S.branches.length) return ''; return '<div class="form-group"><label class="form-label">Shop</label><select id="' + id + '" class="form-select"><option value="">All shops</option>' + S.branches.map(function (b) { return '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>'; }).join('') + '</select></div>'; }

  /* ---------------------------------------------------------------- vendor tab */
  function load() {
    var el = document.getElementById('reportsContent'); if (!el) return;
    var seller = isSeller();
    if (seller && !S.perms.canDownloadReport) { el.innerHTML = '<div class="empty">Report downloads are not enabled for sellers of this business.</div>'; return; }
    var today = BO.todayKey();
    var h = '<div class="section-card" style="margin-bottom:18px;"><div class="section-hdr"><span>📅</span><div class="section-hdr-title">Date Range</div></div><div class="section-body"><div class="form-grid" style="max-width:720px;"><div class="form-group"><label class="form-label">Start Date</label><input type="date" id="repStart" class="form-control" value="' + today + '"></div><div class="form-group"><label class="form-label">End Date</label><input type="date" id="repEnd" class="form-control" value="' + today + '"></div>' + shopSelect('repBranch') + '<div class="form-group"><label class="form-label">Lending status</label><select id="repLendStatus" class="form-select"><option value="ALL">All</option><option value="Active">Active only</option><option value="Returned">Returned only</option></select></div></div><div id="repStatus" class="small muted" style="margin-top:8px;"></div></div></div>';
    var list = seller ? TYPES.filter(function (t) { return t[0] === 'sales'; }) : TYPES;
    h += '<div class="report-grid">' + list.map(function (t) { return '<div class="report-card" style="cursor:default;flex-wrap:wrap;"><span class="rc-icon">' + t[1] + '</span><div style="flex:1;"><div class="rc-title">' + esc(t[2]) + '</div><div class="rc-sub">' + esc(t[3]) + '</div></div><div style="display:flex;gap:6px;width:100%;margin-top:6px;"><button class="btn-sm-primary" onclick="BORep.dl(\'' + t[0] + '\',\'pdf\')">📄 PDF</button><button class="btn-sm-success" onclick="BORep.dl(\'' + t[0] + '\',\'xlsx\')">📊 Excel</button><button class="btn-sm-warning" onclick="BORep.preview(\'' + t[0] + '\')">👁 Preview</button></div></div>'; }).join('') + '</div>';
    el.innerHTML = h;
  }
  function args(type) {
    var a = { type: type };
    if (DATED[type] !== false) { a.start = g('repStart'); a.end = g('repEnd'); if (!a.start || !a.end) { alert('Pick both dates.'); return null; } }
    if (g('repBranch')) a.branch_id = g('repBranch');
    if (type === 'lending') a.status = g('repLendStatus') || 'ALL';
    return a;
  }
  function open(a, format, statusEl) {
    a.format = format; var st = document.getElementById(statusEl); if (st) st.textContent = 'Generating… please wait.';
    srv('reportTicket', a).then(function (r) { if (st) st.textContent = ''; window.open(r.url, '_blank'); }).catch(function (e) { if (st) st.textContent = ''; BO.fail(e); });
  }
  function dl(type, format) { var a = args(type); if (a) open(a, format, 'repStatus'); }
  function preview(type) { var a = args(type); if (a) showPreview(a); }
  function showPreview(a) {
    srv('reportData', a).then(function (d) {
      var cols = d.columns || [];
      var h = '<div class="small muted" style="margin-bottom:8px;">' + esc(d.subtitle || '') + '</div><div class="table-wrap"><table class="bo-table"><thead><tr>' + cols.map(function (c) { return '<th' + (c.align === 'right' ? ' class="right"' : '') + '>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>';
      (d.rows || []).slice(0, 300).forEach(function (r) { h += '<tr>' + cols.map(function (c) { var v = r[c.key]; return '<td' + (c.align === 'right' ? ' class="right mono"' : '') + '>' + esc(typeof v === 'number' ? fmtFull(v) : (v == null ? '' : v)) + '</td>'; }).join('') + '</tr>'; });
      if (!(d.rows || []).length) h += '<tr><td colspan="' + cols.length + '" class="empty">No records for this selection.</td></tr>';
      h += '</tbody></table></div>' + ((d.rows || []).length > 300 ? '<div class="small muted">Showing the first 300 of ' + d.rows.length + ' rows — download for the rest.</div>' : '');
      if (d.totals && d.totals.length) h += '<div style="text-align:right;margin-top:12px;font-weight:700;">' + d.totals.map(function (t) { return esc(t[0]) + ': ' + esc(t[1]); }).join('<br>') + '</div>';
      BO.dialog({ title: esc(d.title || 'Report'), body: h, size: 'lg' });
    }).catch(BO.fail);
  }

  /* ---------------------------------------------------------------- manager tab */
  function loadMgr() {
    var el = document.getElementById('mgrReportsContent'); if (!el) return;
    el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-bottom:24px;" id="mgrCards">' + MGR_TYPES.map(function (t) { return '<div class="mgr-report-card" id="mrc_' + t[0] + '" onclick="BORep.select(\'' + t[0] + '\')"><div class="mrc-icon">' + t[1] + '</div><div class="mrc-title">' + esc(t[2]) + '</div><div class="mrc-sub">' + esc(t[3]) + '</div></div>'; }).join('') + '</div><div id="mgrRepOptionsWrap"></div>';
    srv('vendorList', {}).then(function (r) { vendors = r.rows || []; if (mgrType) select(mgrType); }).catch(BO.fail);
  }
  function select(type) {
    mgrType = type;
    document.querySelectorAll('.mgr-report-card').forEach(function (c) { c.classList.remove('selected'); });
    var card = document.getElementById('mrc_' + type); if (card) card.classList.add('selected');
    var t = MGR_TYPES.filter(function (x) { return x[0] === type; })[0] || ['', '📊', 'Report', ''];
    var today = BO.todayKey();
    var h = '<div class="section-card"><div class="section-hdr"><span>' + t[1] + '</span><div class="section-hdr-title">' + esc(t[2]) + ' — options</div></div><div class="section-body"><div class="form-grid">';
    h += '<div class="form-group"><label class="form-label">Vendor</label><select id="mgrRepVendor" class="form-select"><option value="ALL">All Vendors</option>' + vendors.map(function (v) { return '<option value="' + esc(v.id) + '">' + esc(v.name) + '</option>'; }).join('') + '</select></div>';
    if (DATED[type] !== false) h += '<div class="form-group"><label class="form-label">Start Date</label><input type="date" id="mgrRepStart" class="form-control" value="' + today + '"></div><div class="form-group"><label class="form-label">End Date</label><input type="date" id="mgrRepEnd" class="form-control" value="' + today + '"></div>';
    if (type === 'lending') h += '<div class="form-group"><label class="form-label">Status</label><select id="mgrRepLendStatus" class="form-select"><option value="ALL">All</option><option value="Active">Active Only</option><option value="Returned">Returned Only</option></select></div>';
    h += '<div class="form-group"><label class="form-label">Format</label><select id="mgrRepFormat" class="form-select"><option value="pdf">PDF</option><option value="xlsx">Excel (.xlsx)</option></select></div></div>';
    h += '<div style="margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;"><button class="btn-primary" onclick="BORep.dlMgr()">📥 Download Report</button><button class="btn-secondary" onclick="BORep.previewMgr()">👁 Preview</button><span id="mgrRepStatus" class="small muted"></span></div></div></div>';
    document.getElementById('mgrRepOptionsWrap').innerHTML = h;
  }
  function mgrArgs() {
    if (!mgrType) { alert('Select a report type first.'); return null; }
    var a = { type: mgrType, vendor_id: g('mgrRepVendor') || 'ALL' };
    if (DATED[mgrType] !== false) { a.start = g('mgrRepStart'); a.end = g('mgrRepEnd'); if (!a.start || !a.end) { alert('Pick both dates.'); return null; } }
    if (mgrType === 'lending') a.status = g('mgrRepLendStatus') || 'ALL';
    return a;
  }
  function dlMgr() { var a = mgrArgs(); if (a) open(a, g('mgrRepFormat') || 'pdf', 'mgrRepStatus'); }
  function previewMgr() { var a = mgrArgs(); if (a) showPreview(a); }

  BO.tabs.reports = { load: load };
  BO.tabs.mgrreports = { load: loadMgr };
  return { load: load, dl: dl, preview: preview, loadMgr: loadMgr, select: select, dlMgr: dlMgr, previewMgr: previewMgr };
})();
