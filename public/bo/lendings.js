/* LENDINGS -- record what left the shop on loan or rent, see who still has what, mark returns,
   send reminders. Managers see every business. */
window.BOLend = (function () {
  var opts = { products: [] }, rowSeq = 0;

  function load() {
    var el = document.getElementById('lendingsContent'); if (!el) return;
    var isMgr = isManager();
    var h = '';
    if (!isMgr) {
      h += '<div class="section-card" style="margin-bottom:18px;"><div class="section-hdr"><span>📋</span><div class="section-hdr-title">Record New Lending</div></div><div class="section-body">'
        + '<div class="fg3" style="margin-bottom:14px;"><div class="form-group"><label class="form-label">Borrower Name *</label><input class="form-control" id="lendBorrowerName" placeholder="Full name"></div>'
        + '<div class="form-group"><label class="form-label">Email <span class="muted" style="font-weight:400;">(optional)</span></label><input class="form-control" id="lendBorrowerEmail" type="email" placeholder="email@example.com"></div>'
        + '<div class="form-group"><label class="form-label">Phone <span class="muted" style="font-weight:400;">(optional)</span></label><input class="form-control" id="lendBorrowerPhone" placeholder="Start with code, e.g. +255"></div></div>'
        + '<div class="table-wrap" style="margin-bottom:12px;"><table class="sale-tbl"><thead><tr><th>Product</th><th style="width:80px;">Qty</th><th style="width:120px;">Price Owed</th><th style="width:100px;">Total</th><th style="width:40px;"></th></tr></thead><tbody id="lendItemsBody"><tr class="lend-row"><td colspan="5" class="muted small">Loading products…</td></tr></tbody></table></div>'
        + '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;"><button class="btn-secondary" onclick="BOLend.addRow()">+ Add Item</button><button class="btn-primary" id="lendSubmitBtn" onclick="BOLend.submit()">📋 Record Lending</button></div>'
        + '<div id="lendMsg" style="margin-top:12px;"></div></div></div>';
    }
    h += '<div class="section-card" style="margin-bottom:18px;"><div class="section-hdr"><span>⏳</span><div class="section-hdr-title">Active Lendings' + (isMgr ? ' — All Vendors' : '') + '</div>' + (isMgr ? '<div style="margin-left:auto;"><button class="btn-sm-primary" onclick="BOLend.remindAll()">📧 Remind All</button></div>' : '') + '</div><div id="activeLendingsBody" class="empty">Loading…</div></div>';
    h += '<div class="section-card"><div class="section-hdr"><span>✅</span><div class="section-hdr-title">Returned Lendings (History)</div></div><div id="returnedLendingsBody" class="empty">Loading…</div></div>';
    el.innerHTML = h;
    if (!isMgr) {
      srv('productOptions', S.user.branch_id ? { branch_id: S.user.branch_id } : {}).then(function (o) { opts = o || opts; if (!opts.products) opts.products = []; document.getElementById('lendItemsBody').innerHTML = row(); }).catch(function (e) { document.getElementById('lendItemsBody').innerHTML = '<tr><td colspan="5">' + BO.errorBox(e) + '</td></tr>'; });
    }
    sync();
  }
  function sync() { list('Active'); list('Returned'); }

  function productSelect() {
    var h = '<select class="form-select lendProdSelect" style="min-width:160px;" onchange="BOLend.pick(this)"><option value="">Select product…</option>';
    opts.products.forEach(function (p) { var st = p.is_serialized ? (p.units || []).length : p.stock; h += '<option value="' + esc(p.id) + '"' + (st <= 0 ? ' disabled' : '') + '>' + esc(p.name) + ' – stock: ' + st + (p.is_serialized ? ' · IMEI' : '') + '</option>'; });
    return h + '</select>';
  }
  function row() { rowSeq++; return '<tr class="lend-row"><td>' + productSelect() + '<div class="units"></div></td><td><input type="number" class="form-control lend-qty" value="1" min="1" oninput="BOLend.calc(this)"></td><td><input type="number" class="form-control lend-price" value="0" min="0" oninput="BOLend.calc(this)"></td><td><span class="row-total lend-total">0</span></td><td><button class="btn-sm-danger" onclick="this.closest(\'tr\').remove()">✕</button></td></tr>'; }
  function addRow() { var tb = document.getElementById('lendItemsBody'), tr = document.createElement('tr'); tr.className = 'lend-row'; tr.innerHTML = row().replace(/^<tr[^>]*>/, '').replace(/<\/tr>$/, ''); tb.appendChild(tr); }
  function productOf(id) { for (var i = 0; i < opts.products.length; i++) if (opts.products[i].id === id) return opts.products[i]; return null; }
  function pick(sel) {
    var tr = sel.closest('tr'), p = productOf(sel.value), units = tr.querySelector('.units'), qty = tr.querySelector('.lend-qty');
    if (p) tr.querySelector('.lend-price').value = p.price;
    if (p && p.is_serialized) { qty.value = 0; qty.readOnly = true; units.innerHTML = '<div class="unit-pick">' + (p.units || []).map(function (u) { return '<label><input type="checkbox" value="' + esc(u.id) + '" onchange="BOLend.unitToggle(this)" style="margin:0;">' + esc(u.imei || u.serial_no || u.id) + '</label>'; }).join('') + '</div>'; }
    else { qty.readOnly = false; if (Number(qty.value) < 1) qty.value = 1; units.innerHTML = ''; }
    calc(sel);
  }
  function unitToggle(cb) { var tr = cb.closest('tr'); cb.parentNode.classList.toggle('on', cb.checked); tr.querySelector('.lend-qty').value = tr.querySelectorAll('.unit-pick input:checked').length; calc(cb); }
  function calc(elm) { var tr = elm.closest('tr'); if (!tr) return; var q = parseFloat(tr.querySelector('.lend-qty').value) || 0, p = parseFloat(tr.querySelector('.lend-price').value) || 0; tr.querySelector('.lend-total').textContent = fmtFull(q * p); }

  function submit() {
    var name = document.getElementById('lendBorrowerName').value.trim(), email = document.getElementById('lendBorrowerEmail').value.trim(), phone = document.getElementById('lendBorrowerPhone').value.trim();
    if (!name) { alert("Enter the borrower's name."); return; }
    var rows = document.querySelectorAll('#lendItemsBody .lend-row'), items = [], grandTotal = 0;
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i], sel = tr.querySelector('.lendProdSelect'); if (!sel) continue;
      var pid = sel.value, qty = parseInt(tr.querySelector('.lend-qty').value, 10), price = parseFloat(tr.querySelector('.lend-price').value) || 0, p = productOf(pid), unitIds = [];
      if (!pid || !qty) { alert('Select a product and qty for every row.'); return; }
      if (p && p.is_serialized) { tr.querySelectorAll('.unit-pick input:checked').forEach(function (cb) { unitIds.push(cb.value); }); if (!unitIds.length) { alert('Tick the IMEI(s) for ' + p.name + '.'); return; } qty = unitIds.length; }
      items.push({ product_id: pid, qty: qty, price: price, unit_ids: unitIds.length ? unitIds : undefined });
      grandTotal += qty * price;
    }
    if (!items.length) { alert('Add at least one product.'); return; }
    var cm = 'Record lending to ' + name + '?\n' + items.length + ' item(s)' + (grandTotal > 0 ? '\nTotal owed: ' + fmtFull(grandTotal) + ' ' + cur() : ''); if (email) cm += '\nConfirmation → ' + email;
    if (!BO.confirm(cm)) return;
    var btn = document.getElementById('lendSubmitBtn'); btn.disabled = true;
    srv('recordLending', { items: items, borrower_name: name, borrower_email: email, borrower_phone: phone }).then(function (r) {
      btn.disabled = false;
      document.getElementById('lendMsg').innerHTML = '<div class="alert-success">' + esc(r.message) + '</div>';
      document.getElementById('lendBorrowerName').value = ''; document.getElementById('lendBorrowerEmail').value = ''; document.getElementById('lendBorrowerPhone').value = '';
      srv('productOptions', S.user.branch_id ? { branch_id: S.user.branch_id } : {}).then(function (o) { opts = o || opts; document.getElementById('lendItemsBody').innerHTML = row(); }).catch(function () {});
      sync(); BO.reload('dashboard');
    }).catch(function (e) { btn.disabled = false; document.getElementById('lendMsg').innerHTML = '<div class="alert-danger">' + esc(e.message) + '</div>'; });
  }

  function itemsText(l) { return (l.items || []).map(function (it) { return it.qty + '× ' + esc(it.product_name) + (it.imei ? ' <span class="mono small muted">[' + esc(it.imei) + ']</span>' : ''); }).join(', '); }
  function list(status) {
    var id = status === 'Active' ? 'activeLendingsBody' : 'returnedLendingsBody', isMgr = isManager(), canManage = isAdmin() || isMgr;
    srv('lendings', { status: status }).then(function (r) {
      var el = document.getElementById(id); if (!el) return;
      var rows = r.rows || [];
      if (!rows.length) { el.innerHTML = status === 'Active' ? 'No active lendings.' : 'No returned lendings yet.'; return; }
      var h;
      if (status === 'Active') {
        h = '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Date</th>' + (isMgr ? '<th>Vendor</th>' : '') + '<th>Borrower</th><th>Contact</th><th>Items</th><th style="color:var(--rose);">Total Owed</th><th>By</th><th>Actions</th></tr></thead><tbody>';
        rows.forEach(function (l) {
          var contact = []; if (l.borrower_email) contact.push('<a href="mailto:' + esc(l.borrower_email) + '" style="color:var(--accent);font-size:.77rem;">' + esc(l.borrower_email) + '</a>'); if (l.borrower_phone) contact.push('<span class="small">' + esc(l.borrower_phone) + '</span>');
          var actions = '';
          if (canManage) actions += '<button class="btn-sm-success" title="Mark returned" onclick="BOLend.returned(\'' + BO.jsq(l.id) + '\')">✅</button> <button class="btn-sm-danger" title="Delete lending" onclick="BOLend.del(\'' + BO.jsq(l.id) + '\')">🗑️</button>';
          if (canManage && l.borrower_email) actions += ' <button class="btn-sm-primary" title="Send reminder" onclick="BOLend.remind(\'' + BO.jsq(l.id) + '\')">📧</button>';
          h += '<tr><td class="small" style="white-space:nowrap;">' + BO.fmtDate(l.created_at) + '<br><span class="muted">' + BO.fmtTime(l.created_at) + '</span></td>' + (isMgr ? '<td class="small" style="color:var(--accent);">' + esc(l.vendor_name || '') + '</td>' : '') + '<td><strong>' + esc(l.borrower_name) + '</strong></td><td>' + (contact.join('<br>') || '<span class="muted">–</span>') + '</td><td class="small" style="max-width:220px;">' + itemsText(l) + '</td><td>' + (l.grand_total > 0 ? '<span class="mono" style="color:var(--rose);font-weight:600;">' + fmtFull(l.grand_total) + '</span>' : '<span class="muted">–</span>') + '</td><td class="small muted">' + esc(l.recorded_by_name || '') + '</td><td style="white-space:nowrap;">' + actions + '</td></tr>';
        });
      } else {
        h = '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Lent On</th>' + (isMgr ? '<th>Vendor</th>' : '') + '<th>Borrower</th><th>Items</th><th>Total</th><th>Returned On</th></tr></thead><tbody>';
        rows.slice(0, 40).forEach(function (l) { h += '<tr><td class="small">' + BO.fmtDate(l.created_at) + '</td>' + (isMgr ? '<td class="small" style="color:var(--accent);">' + esc(l.vendor_name || '') + '</td>' : '') + '<td>' + esc(l.borrower_name) + '</td><td class="small">' + itemsText(l) + '</td><td class="mono small">' + (l.grand_total > 0 ? fmtFull(l.grand_total) : '–') + '</td><td class="small" style="color:var(--accent2);">' + (l.return_date ? BO.fmtDate(l.return_date) : '–') + '</td></tr>'; });
      }
      el.innerHTML = h + '</tbody></table></div>';
    }).catch(function (e) { var el = document.getElementById(id); if (el) el.innerHTML = BO.errorBox(e); });
  }

  function returned(id) { if (!BO.confirm('Mark as returned? Stock will be restored.')) return; srv('markLendingReturned', { lending_id: id }).then(function (r) { showToast(r.message); sync(); BO.reload('dashboard'); }).catch(BO.fail); }
  function del(id) { if (!BO.confirm('Delete this lending record?\n\nIf still active, stock will be restored.\nThis cannot be undone.')) return; srv('deleteLending', { lending_id: id }).then(function (r) { showToast(r.message); sync(); BO.reload('dashboard'); }).catch(BO.fail); }
  function remind(id) { srv('sendLendingReminder', { lending_id: id }).then(function (r) { showToast(r.message, '📧'); }).catch(BO.fail); }
  function remindAll() { if (!BO.confirm('Send email reminders to ALL active borrowers with an email address on record?')) return; srv('sendLendingReminders', {}).then(function (r) { showToast(r.message, '📧'); }).catch(BO.fail); }

  BO.tabs.lendings = { load: load, sync: sync };
  return { load: load, addRow: addRow, pick: pick, unitToggle: unitToggle, calc: calc, submit: submit, returned: returned, del: del, remind: remind, remindAll: remindAll };
})();
