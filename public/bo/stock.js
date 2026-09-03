/* STOCK & SHOPS -- Frank Amos's phone-retail asks: IMEI units, shops (branches), stock per shop,
   transfers between shops, the movement ledger, and the financing partners. */
window.BOStock = (function () {
  var view = 'units', products = [], serialized = [];
  var VIEWS = [['units', '📱 Units (IMEI)'], ['branches', '🏬 Shops'], ['branchstock', '📊 Stock per shop'], ['transfer', '🔁 Transfer'], ['movements', '📒 Movements'], ['partners', '🏦 Financing partners']];
  var TYPES = ['received', 'sold', 'transfer_out', 'transfer_in', 'returned', 'adjustment', 'cancelled_restock', 'lent'];

  function load() {
    var el = document.getElementById('stockContent'); if (!el) return;
    if (!isAdmin()) { el.innerHTML = '<div class="empty">Only the business admin manages stock and shops.</div>'; return; }
    el.innerHTML = '<div class="empty">Loading…</div>';
    srv('products', {}).then(function (r) {
      products = r.rows || []; serialized = products.filter(function (p) { return p.is_serialized; });
      el.innerHTML = '<div class="tabs-row" id="stockTabs"></div><div id="stockView"></div>';
      show(view);
    }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }
  function tabs() { document.getElementById('stockTabs').innerHTML = VIEWS.map(function (v) { return '<button class="tab-chip' + (view === v[0] ? ' active' : '') + '" onclick="BOStock.show(\'' + v[0] + '\')">' + v[1] + '</button>'; }).join(''); }
  function show(v) { view = v; tabs(); var el = document.getElementById('stockView'); el.innerHTML = '<div class="empty">Loading…</div>'; ({ units: units, branches: branches, branchstock: branchStock, transfer: transfer, movements: movements, partners: partners })[v](el); }
  function shopOpts(sel, allLabel) { return (allLabel ? '<option value="">' + allLabel + '</option>' : '') + S.branches.map(function (b) { return '<option value="' + esc(b.id) + '"' + (sel === b.id ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join(''); }
  function prodOpts(list, sel) { return '<option value="">Select…</option>' + list.map(function (p) { return '<option value="' + esc(p.id) + '"' + (sel === p.id ? ' selected' : '') + '>' + esc(p.name) + (p.legacy_id ? ' (' + esc(p.legacy_id) + ')' : '') + '</option>'; }).join(''); }
  function g(id) { var e = document.getElementById(id); return e ? e.value : ''; }
  function card(icon, title, body) { return '<div class="section-card"><div class="section-hdr"><span>' + icon + '</span><div class="section-hdr-title">' + title + '</div></div><div class="section-body">' + body + '</div></div>'; }
  function shopName(id) { for (var i = 0; i < S.branches.length; i++) if (S.branches[i].id === id) return S.branches[i].name; return id ? '?' : ''; }
  function refreshBranches() { return srv('branches', {}).then(function (r) { S.branches = (r.rows || []).filter(function (b) { return b.active; }); S.features.has_branches = S.branches.length > 0; return r.rows || []; }); }

  /* ---------------------------------------------------------------- units */
  function units(el) {
    var h = card('➕', 'Add units (IMEI / serial)', '<div class="form-grid"><div class="form-group" style="grid-column:span 2;"><label class="form-label">Product (IMEI-tracked)</label><select id="unitAddProd" class="form-select">' + prodOpts(serialized) + '</select></div>' + (S.branches.length ? '<div class="form-group"><label class="form-label">Shop</label><select id="unitAddBranch" class="form-select">' + shopOpts('', '— No shop —') + '</select></div>' : '') + '</div><div class="form-group" style="margin-top:10px;"><label class="form-label">One unit per line — IMEI, or IMEI,serial, or just a serial</label><textarea class="form-control" id="unitAddList" rows="4" placeholder="350000000000001&#10;350000000000002,SN-1002"></textarea></div><div style="margin-top:10px;"><button class="btn-primary" onclick="BOStock.addUnits()">Add units</button></div>' + (!serialized.length ? '<div class="small muted" style="margin-top:8px;">No IMEI-tracked products yet — tick "Track each unit by IMEI" when adding a product.</div>' : ''));
    h += card('🔍', 'Units', '<div class="filter-row"><div class="form-group"><label class="form-label">Product</label><select id="unitFProd" class="form-select" onchange="BOStock.listUnits()"><option value="">All IMEI products</option>' + prodOpts(serialized).replace('<option value="">Select…</option>', '') + '</select></div><div class="form-group"><label class="form-label">Status</label><select id="unitFStatus" class="form-select" onchange="BOStock.listUnits()"><option value="in_stock">In stock</option><option value="sold">Sold</option><option value="lent">Lent</option><option value="lost">Lost</option><option value="">All</option></select></div>' + (S.branches.length ? '<div class="form-group"><label class="form-label">Shop</label><select id="unitFBranch" class="form-select" onchange="BOStock.listUnits()">' + shopOpts('', 'All shops') + '</select></div>' : '') + '<div class="form-group"><label class="form-label">Search IMEI / serial</label><input class="form-control" id="unitFQ" onkeyup="if(event.keyCode===13)BOStock.listUnits()" placeholder="digits…"></div><button class="btn-secondary" onclick="BOStock.listUnits()">Search</button></div><div id="unitList" class="empty">Loading…</div>');
    el.innerHTML = h; listUnits();
  }
  function listUnits() {
    var el = document.getElementById('unitList'); if (!el) return;
    var args = {}; if (g('unitFProd')) args.product_id = g('unitFProd'); if (g('unitFStatus')) args.status = g('unitFStatus'); if (g('unitFBranch')) args.branch_id = g('unitFBranch'); if (g('unitFQ').trim()) args.q = g('unitFQ').trim();
    srv('units', args).then(function (r) {
      var rows = r.rows || [];
      if (!rows.length) { el.innerHTML = 'No units match.'; return; }
      var h = '<div class="table-wrap"><table class="bo-table"><thead><tr><th>IMEI</th><th>Serial</th><th>Product</th><th>Shop</th><th>Status</th><th>Received</th><th>Actions</th></tr></thead><tbody>';
      rows.forEach(function (u) { var st = u.status === 'in_stock' ? 'badge-ok' : u.status === 'sold' ? 'badge-seller' : u.status === 'lost' ? 'badge-out' : 'badge-low'; h += '<tr><td class="mono">' + esc(u.imei || '–') + '</td><td class="mono small">' + esc(u.serial_no || '–') + '</td><td>' + esc(u.product_name || '') + '</td><td class="small">' + esc(shopName(u.branch_id)) + '</td><td><span class="badge ' + st + '">' + esc(u.status) + '</span></td><td class="small">' + BO.fmtDate(u.received_at) + '</td><td style="white-space:nowrap;"><button class="btn-sm-primary" onclick="BOStock.history(\'' + esc(u.id) + '\')">History</button> ' + (u.status !== 'sold' ? '<button class="btn-sm-warning" onclick="BOStock.editUnit(\'' + esc(u.id) + '\',\'' + esc(u.imei || '') + '\',\'' + esc(u.serial_no || '') + '\',\'' + esc(u.branch_id || '') + '\',\'' + esc(u.status) + '\')">Edit</button>' : '') + '</td></tr>'; });
      el.innerHTML = h + '</tbody></table></div>';
    }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }
  function addUnits() {
    var pid = g('unitAddProd'), lines = g('unitAddList').split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!pid) { alert('Choose the product.'); return; }
    if (!lines.length) { alert('Enter at least one IMEI or serial.'); return; }
    var units = lines.map(function (l) { var parts = l.split(/[,;\t]/).map(function (x) { return x.trim(); }); var a = parts[0] || '', b = parts[1] || ''; return /^[0-9 -]{14,20}$/.test(a) ? { imei: a.replace(/[\s-]/g, ''), serial_no: b || undefined } : { serial_no: a, imei: b ? b.replace(/[\s-]/g, '') : undefined }; });
    if (!BO.confirm('Add ' + units.length + ' unit(s)?')) return;
    var args = { product_id: pid, units: units }; if (g('unitAddBranch')) args.branch_id = g('unitAddBranch');
    srv('addUnits', args).then(function (r) { showToast(r.message); document.getElementById('unitAddList').value = ''; listUnits(); BO.reload('products'); }).catch(BO.fail);
  }
  function editUnit(id, imei, serial, branch, status) {
    BO.dialog({ title: 'Edit unit', body: '<div class="form-group" style="margin-bottom:10px;"><label class="form-label">IMEI</label><input class="form-control mono" id="euImei" value="' + esc(imei) + '"></div><div class="form-group" style="margin-bottom:10px;"><label class="form-label">Serial</label><input class="form-control" id="euSerial" value="' + esc(serial) + '"></div>' + (S.branches.length ? '<div class="form-group" style="margin-bottom:10px;"><label class="form-label">Shop</label><select class="form-select" id="euBranch">' + shopOpts(branch, '— No shop —') + '</select></div>' : '') + '<div class="form-group" style="margin-bottom:10px;"><label class="form-label">Status</label><select class="form-select" id="euStatus"><option value="in_stock"' + (status === 'in_stock' ? ' selected' : '') + '>In stock</option><option value="lost"' + (status === 'lost' ? ' selected' : '') + '>Lost</option>' + (status === 'lent' ? '<option value="lent" selected>Lent (returned via Lendings)</option>' : '') + '</select></div><div class="form-group"><label class="form-label">Note</label><input class="form-control" id="euNote" placeholder="why it changed"></div>',
      footer: '<button class="btn-secondary" onclick="BO.closeDialog()">Cancel</button><button class="btn-primary" onclick="BOStock.saveUnit(\'' + esc(id) + '\')">Save</button>' });
  }
  function saveUnit(id) {
    var args = { unit_id: id, imei: g('euImei').trim(), serial_no: g('euSerial').trim(), status: g('euStatus'), note: g('euNote').trim() }; var b = document.getElementById('euBranch'); if (b) args.branch_id = b.value;
    srv('updateUnit', args).then(function () { BO.closeDialog(); showToast('Unit saved.'); listUnits(); BO.reload('products'); }).catch(BO.fail);
  }
  function history(id) {
    srv('unitHistory', { unit_id: id }).then(function (h) {
      var u = h.unit || {}, p = h.product || {};
      var body = '<div class="kv" style="margin-bottom:12px;"><b>IMEI</b><span class="mono">' + esc(u.imei || '–') + '</span><b>Serial</b><span>' + esc(u.serial_no || '–') + '</span><b>Product</b><span>' + esc(p.name || '') + ' ' + esc([p.brand, p.model].filter(Boolean).join(' ')) + '</span><b>Shop</b><span>' + esc(shopName(u.branch_id)) + '</span><b>Status</b><span>' + esc(u.status) + '</span><b>Received</b><span>' + BO.fmtDT(u.received_at) + '</span></div>';
      body += '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Date</th><th>Type</th><th>Qty</th><th>From</th><th>To</th><th>By</th><th>Note</th></tr></thead><tbody>' + (h.movements || []).map(function (m) { return '<tr><td class="small">' + BO.fmtDT(m.created_at) + '</td><td><span class="badge badge-seller">' + esc(m.type) + '</span></td><td>' + m.qty + '</td><td class="small">' + esc(m.from_branch_name || '') + '</td><td class="small">' + esc(m.to_branch_name || '') + '</td><td class="small">' + esc(m.by_name || '') + '</td><td class="small muted">' + esc(m.note || '') + '</td></tr>'; }).join('') + (!(h.movements || []).length ? '<tr><td colspan="7" class="empty">No movements yet.</td></tr>' : '') + '</tbody></table></div>';
      if (h.sale) body += '<div class="alert-info" style="margin-top:12px;">Sold ' + BO.fmtDT(h.sale.sold_at) + ' by ' + esc(h.sale.seller_name || '') + ' — ' + esc(h.sale.payment_method) + (h.sale.partner_name ? ' (' + esc(h.sale.partner_name) + ')' : '') + ' — ' + fmtFull(h.sale.total) + ' ' + cur() + (h.sale.status === 'cancelled' ? ' — <strong>cancelled</strong>' : '') + '</div>';
      BO.dialog({ title: 'Unit history', body: body, size: 'lg' });
    }).catch(BO.fail);
  }

  /* ---------------------------------------------------------------- branches */
  function branches(el) {
    srv('branches', {}).then(function (r) {
      var rows = r.rows || [];
      var t = '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Name</th><th>Location</th><th>Active</th><th></th></tr></thead><tbody>' + rows.map(function (b) { return '<tr><td><strong>' + esc(b.name) + '</strong></td><td>' + esc(b.location || '') + '</td><td>' + (b.active ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-inactive">Inactive</span>') + '</td><td><button class="btn-sm-primary" onclick="BOStock.editBranch(\'' + esc(b.id) + '\',\'' + esc(b.name) + '\',\'' + esc(b.location || '') + '\',' + (b.active ? 'true' : 'false') + ')">Edit</button></td></tr>'; }).join('') + (!rows.length ? '<tr><td colspan="4" class="empty">No shops yet. A business with no shops works as one shop.</td></tr>' : '') + '</tbody></table></div>';
      el.innerHTML = card('🏬', 'Shops / Branches', t + '<div class="small muted" style="margin-top:8px;">A business with no shops works as one shop. Add shops when stock, sellers and sales should be counted per location.</div>')
        + card('➕', 'Add / edit shop', '<input type="hidden" id="brId"><div class="form-grid"><div class="form-group"><label class="form-label">Name</label><input class="form-control" id="brName"></div><div class="form-group"><label class="form-label">Location</label><input class="form-control" id="brLoc"></div><div class="form-group"><label class="form-label">Active</label><select class="form-select" id="brActive"><option value="true">Yes</option><option value="false">No</option></select></div><button class="btn-primary" onclick="BOStock.saveBranch()">Save shop</button></div>');
    }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }
  function editBranch(id, name, loc, active) { document.getElementById('brId').value = id; document.getElementById('brName').value = name; document.getElementById('brLoc').value = loc; document.getElementById('brActive').value = active ? 'true' : 'false'; document.getElementById('brName').focus(); }
  function saveBranch() {
    var args = { name: g('brName').trim(), location: g('brLoc').trim(), active: g('brActive') === 'true' }; if (g('brId')) args.id = g('brId');
    if (!args.name) { alert('Give the shop a name.'); return; }
    srv('saveBranch', args).then(function () { showToast('Shop saved.'); refreshBranches().then(function () { show('branches'); }); }).catch(BO.fail);
  }

  /* ---------------------------------------------------------------- stock per shop */
  function branchStock(el) {
    if (!S.branches.length) { el.innerHTML = card('📊', 'Stock per shop', '<div class="empty">Add shops first — then every product shows its quantity per shop here.</div>'); return; }
    srv('branchStock', {}).then(function (r) {
      var rows = r.rows || [];
      var h = '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Product</th><th>Brand / Model</th><th>Total</th>' + S.branches.map(function (b) { return '<th>' + esc(b.name) + '</th>'; }).join('') + '</tr></thead><tbody>';
      rows.forEach(function (p) { h += '<tr><td>' + esc(p.name) + (p.is_serialized ? ' <span class="badge badge-seller">IMEI</span>' : '') + '</td><td class="muted">' + esc([p.brand, p.model].filter(Boolean).join(' ')) + '</td><td><strong>' + p.total + '</strong></td>' + S.branches.map(function (b) { var x = (p.branches || []).filter(function (y) { return y.branch_id === b.id; })[0]; return '<td>' + (x ? x.qty : 0) + '</td>'; }).join('') + '</tr>'; });
      if (!rows.length) h += '<tr><td colspan="' + (3 + S.branches.length) + '" class="empty">No products.</td></tr>';
      el.innerHTML = card('📊', 'Stock per shop', h + '</tbody></table></div>');
    }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }

  /* ---------------------------------------------------------------- transfer + adjust */
  function transfer(el) {
    var tr = S.branches.length < 2 ? '<div class="empty">Transfers need at least two shops.</div>' : '<div class="form-grid"><div class="form-group" style="grid-column:span 2;"><label class="form-label">Product</label><select class="form-select" id="trProd" onchange="BOStock.transferProduct()">' + prodOpts(products) + '</select></div><div class="form-group"><label class="form-label">From shop</label><select class="form-select" id="trFrom" onchange="BOStock.transferProduct()">' + shopOpts('', 'Select…') + '</select></div><div class="form-group"><label class="form-label">To shop</label><select class="form-select" id="trTo">' + shopOpts('', 'Select…') + '</select></div><div class="form-group" id="trQtyWrap"><label class="form-label">Qty</label><input type="number" class="form-control" id="trQty" min="1" value="1"></div><div class="form-group"><label class="form-label">Note</label><input class="form-control" id="trNote"></div><button class="btn-primary" onclick="BOStock.doTransfer()">Transfer</button></div><div id="trUnits" class="unit-pick"></div>';
    el.innerHTML = card('🔁', 'Transfer stock between shops', tr)
      + card('🛠️', 'Adjust stock (stock take)', '<div class="form-grid"><div class="form-group" style="grid-column:span 2;"><label class="form-label">Product (counted, not IMEI)</label><select class="form-select" id="adjProd">' + prodOpts(products.filter(function (p) { return !p.is_serialized; })) + '</select></div>' + (S.branches.length ? '<div class="form-group"><label class="form-label">Shop (optional)</label><select class="form-select" id="adjBranch">' + shopOpts('', '— Vendor total —') + '</select></div>' : '') + '<div class="form-group"><label class="form-label">Change (+ / −)</label><input type="number" class="form-control" id="adjDelta" placeholder="-2"></div><div class="form-group"><label class="form-label">Reason *</label><input class="form-control" id="adjNote" placeholder="e.g. damaged, stock take"></div><button class="btn-primary" onclick="BOStock.adjust()">Adjust</button></div><div class="small muted" style="margin-top:8px;">Every adjustment is written to the movement ledger with your name.</div>');
  }
  function transferProduct() {
    var p = products.filter(function (x) { return x.id === g('trProd'); })[0], wrap = document.getElementById('trUnits');
    document.getElementById('trQtyWrap').style.display = (p && p.is_serialized) ? 'none' : '';
    wrap.innerHTML = '';
    if (p && p.is_serialized && g('trFrom')) {
      srv('units', { product_id: p.id, status: 'in_stock', branch_id: g('trFrom') }).then(function (r) { wrap.innerHTML = (r.rows || []).map(function (u) { return '<label><input type="checkbox" value="' + esc(u.id) + '" onchange="this.parentNode.classList.toggle(\'on\',this.checked)" style="margin:0;">' + esc(u.imei || u.serial_no || u.id) + '</label>'; }).join('') || '<span class="small muted">No units of this product at that shop.</span>'; }).catch(BO.fail);
    }
  }
  function doTransfer() {
    var pid = g('trProd'), from = g('trFrom'), to = g('trTo'), p = products.filter(function (x) { return x.id === pid; })[0];
    if (!pid || !from || !to) { alert('Choose the product and both shops.'); return; }
    if (from === to) { alert('Choose two different shops.'); return; }
    var args = { product_id: pid, from_branch_id: from, to_branch_id: to, note: g('trNote').trim() };
    if (p && p.is_serialized) { var ids = []; document.querySelectorAll('#trUnits input:checked').forEach(function (cb) { ids.push(cb.value); }); if (!ids.length) { alert('Tick the units to move.'); return; } args.unit_ids = ids; }
    else { args.qty = Number(g('trQty')); if (!(args.qty > 0)) { alert('Enter a quantity.'); return; } }
    if (!BO.confirm('Move ' + (args.qty || args.unit_ids.length) + ' × ' + (p ? p.name : '') + ' from ' + shopName(from) + ' to ' + shopName(to) + '?')) return;
    srv('transferStock', args).then(function (r) { showToast(r.message); load(); }).catch(BO.fail);
  }
  function adjust() {
    var pid = g('adjProd'), delta = Number(g('adjDelta')), note = g('adjNote').trim();
    if (!pid || !delta) { alert('Choose the product and a non-zero change.'); return; }
    if (!note) { alert('A reason is required.'); return; }
    var args = { product_id: pid, delta: delta, note: note }; if (g('adjBranch')) args.branch_id = g('adjBranch');
    if (!BO.confirm('Adjust stock by ' + delta + '?')) return;
    srv('adjustStock', args).then(function (r) { showToast(r.message); load(); BO.reload('products'); }).catch(BO.fail);
  }

  /* ---------------------------------------------------------------- movements */
  function movements(el) {
    el.innerHTML = card('📒', 'Stock movements', '<div class="filter-row"><div class="form-group"><label class="form-label">Start</label><input type="date" class="form-control" id="mvStart" value="' + BO.daysAgoKey(6) + '"></div><div class="form-group"><label class="form-label">End</label><input type="date" class="form-control" id="mvEnd" value="' + BO.todayKey() + '"></div><div class="form-group"><label class="form-label">Product</label><select class="form-select" id="mvProd"><option value="">All</option>' + prodOpts(products).replace('<option value="">Select…</option>', '') + '</select></div><div class="form-group"><label class="form-label">Type</label><select class="form-select" id="mvType"><option value="">All</option>' + TYPES.map(function (t) { return '<option value="' + t + '">' + t + '</option>'; }).join('') + '</select></div>' + (S.branches.length ? '<div class="form-group"><label class="form-label">Shop</label><select class="form-select" id="mvBranch">' + shopOpts('', 'All shops') + '</select></div>' : '') + '<button class="btn-secondary" onclick="BOStock.listMovements()">Show</button></div><div id="mvList" class="empty">Loading…</div>');
    listMovements();
  }
  function listMovements() {
    var el = document.getElementById('mvList'); if (!el) return;
    var args = { start: g('mvStart'), end: g('mvEnd') }; if (g('mvProd')) args.product_id = g('mvProd'); if (g('mvType')) args.type = g('mvType'); if (g('mvBranch')) args.branch_id = g('mvBranch');
    srv('movements', args).then(function (r) {
      var rows = r.rows || [];
      if (!rows.length) { el.innerHTML = 'No movements in this period.'; return; }
      var h = '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Date/Time</th><th>Product</th><th>IMEI</th><th>Type</th><th>Qty</th><th>From</th><th>To</th><th>By</th><th>Note</th></tr></thead><tbody>';
      rows.forEach(function (m) { h += '<tr><td class="small" style="white-space:nowrap;">' + BO.fmtDT(m.created_at) + '</td><td>' + esc(m.product_name || '') + '</td><td class="mono small">' + esc(m.imei || '') + '</td><td><span class="badge ' + (m.type === 'sold' ? 'badge-seller' : /transfer/.test(m.type) ? 'badge-low' : m.type === 'received' ? 'badge-ok' : 'badge-admin') + '">' + esc(m.type) + '</span></td><td>' + m.qty + '</td><td class="small">' + esc(m.from_branch_name || '') + '</td><td class="small">' + esc(m.to_branch_name || '') + '</td><td class="small">' + esc(m.by_name || '') + '</td><td class="small muted">' + esc(m.note || '') + '</td></tr>'; });
      el.innerHTML = h + '</tbody></table></div>';
    }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }

  /* ---------------------------------------------------------------- partners */
  function partners(el) {
    srv('partners', {}).then(function (r) {
      var rows = r.rows || [];
      el.innerHTML = card('🏦', 'Financing partners', '<div class="small muted" style="margin-bottom:10px;">Partners like MOGO or Watu pay the shop for phones sold on credit. Choose one when recording a Credit sale.</div><div class="table-wrap"><table class="bo-table"><thead><tr><th>Name</th><th>Contact</th><th>Scope</th><th>Active</th><th></th></tr></thead><tbody>' + rows.map(function (p) { return '<tr><td><strong>' + esc(p.name) + '</strong></td><td>' + esc(p.contact || '') + '</td><td class="small muted">' + (p.vendor_id ? 'This business' : 'All businesses') + '</td><td>' + (p.active ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-inactive">Inactive</span>') + '</td><td>' + (p.vendor_id ? '<button class="btn-sm-primary" onclick="BOStock.editPartner(\'' + esc(p.id) + '\',\'' + esc(p.name) + '\',\'' + esc(p.contact || '') + '\',' + (p.active ? 'true' : 'false') + ')">Edit</button>' : '') + '</td></tr>'; }).join('') + (!rows.length ? '<tr><td colspan="5" class="empty">No partners yet.</td></tr>' : '') + '</tbody></table></div>')
        + card('➕', 'Add / edit partner', '<input type="hidden" id="fpId"><div class="form-grid"><div class="form-group"><label class="form-label">Name</label><input class="form-control" id="fpName" placeholder="e.g. MOGO"></div><div class="form-group"><label class="form-label">Contact</label><input class="form-control" id="fpContact" placeholder="phone / agent"></div><div class="form-group"><label class="form-label">Active</label><select class="form-select" id="fpActive"><option value="true">Yes</option><option value="false">No</option></select></div><button class="btn-primary" onclick="BOStock.savePartner()">Save partner</button></div>');
    }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }
  function editPartner(id, name, contact, active) { document.getElementById('fpId').value = id; document.getElementById('fpName').value = name; document.getElementById('fpContact').value = contact; document.getElementById('fpActive').value = active ? 'true' : 'false'; }
  function savePartner() {
    var args = { name: g('fpName').trim(), contact: g('fpContact').trim(), active: g('fpActive') === 'true' }; if (g('fpId')) args.id = g('fpId');
    if (!args.name) { alert('Give the partner a name.'); return; }
    srv('savePartner', args).then(function () { showToast('Partner saved.'); srv('partners', {}).then(function (r) { S.partners = (r.rows || []).filter(function (p) { return p.active; }); }).catch(function () {}); show('partners'); }).catch(BO.fail);
  }

  BO.tabs.stock = { load: load };
  return { load: load, show: show, listUnits: listUnits, addUnits: addUnits, editUnit: editUnit, saveUnit: saveUnit, history: history, editBranch: editBranch, saveBranch: saveBranch, transferProduct: transferProduct, doTransfer: doTransfer, adjust: adjust, listMovements: listMovements, editPartner: editPartner, savePartner: savePartner };
})();
