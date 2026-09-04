/* CASH -- what a seller handed the owner today, so the dashboard's "due" column means something. */
window.BOCash = (function () {
  function load() {
    var el = document.getElementById('cashContent'); if (!el) return;
    if (!isAdmin()) { el.innerHTML = '<div class="empty">Only the business admin records cash received.</div>'; return; }
    var today = BO.todayKey();
    el.innerHTML = '<div class="section-card"><div class="section-hdr"><span>💰</span><div class="section-hdr-title">Record Cash Received</div></div><div class="section-body"><div class="form-grid"><div class="form-group"><label class="form-label">Seller</label><select id="sellerSelectCash" class="form-select"><option value="">Loading…</option></select></div><div class="form-group"><label class="form-label">Cash Amount</label><input class="form-control" type="number" id="cashAmount" placeholder="0" min="0"></div><div class="form-group"><label class="form-label">Lipa Amount</label><input class="form-control" type="number" id="lipaAmount" placeholder="0" min="0"></div><div class="form-group"><label class="form-label">Note (optional)</label><input class="form-control" id="cashNote" placeholder="e.g. evening handover"></div><button class="btn-primary" onclick="BOCash.record()">Record</button></div><div id="cashMsg" style="margin-top:12px;"></div></div></div>'
      + '<div class="section-card"><div class="section-hdr"><span>🧾</span><div class="section-hdr-title">Receipts</div></div><div class="section-body"><div class="form-grid" style="max-width:520px;margin-bottom:12px;"><div class="form-group"><label class="form-label">Start</label><input type="date" id="cashStart" class="form-control" value="' + today + '"></div><div class="form-group"><label class="form-label">End</label><input type="date" id="cashEnd" class="form-control" value="' + today + '"></div><button class="btn-secondary" onclick="BOCash.list()">Apply</button></div><div id="cashList" class="empty">Loading…</div></div></div>';
    sellers(); list();
  }
  function sellers() {
    srv('users', {}).then(function (r) {
      var s = document.getElementById('sellerSelectCash'); if (!s) return;
      var rows = (r.rows || []).filter(function (u) { return u.role === 'seller' && u.active; });
      s.innerHTML = rows.length ? rows.map(function (u) { return '<option value="' + esc(u.id) + '">' + esc(u.name) + '</option>'; }).join('') : '<option value="">No active sellers</option>';
    }).catch(BO.fail);
  }
  function record() {
    var sel = document.getElementById('sellerSelectCash'), seller = sel.value, cash = document.getElementById('cashAmount').value || 0, lipa = document.getElementById('lipaAmount').value || 0, note = document.getElementById('cashNote').value.trim();
    if (!seller) { alert('Choose a seller.'); return; }
    var sname = sel.options[sel.selectedIndex].text;
    if (!BO.confirm('Record from ' + sname + '?\nCash: ' + fmtFull(cash) + ', Lipa: ' + fmtFull(lipa))) return;
    srv('recordCash', { seller_id: seller, cash_amount: Number(cash), lipa_amount: Number(lipa), note: note }).then(function (r) {
      document.getElementById('cashMsg').innerHTML = '<div class="alert-success">' + esc(r.message) + '</div>';
      document.getElementById('cashAmount').value = ''; document.getElementById('lipaAmount').value = ''; document.getElementById('cashNote').value = '';
      list(); BO.reload('dashboard');
    }).catch(function (e) { document.getElementById('cashMsg').innerHTML = '<div class="alert-danger">' + esc(e.message) + '</div>'; });
  }
  function list() {
    var el = document.getElementById('cashList'); if (!el) return;
    var args = {}; var s = document.getElementById('cashStart'), e = document.getElementById('cashEnd');
    if (s && s.value && e && e.value) { args.start = s.value; args.end = e.value; }
    srv('cashReceipts', args).then(function (r) {
      var rows = r.rows || [];
      if (!rows.length) { el.innerHTML = 'No receipts in this period.'; return; }
      var h = '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Time</th><th>Seller</th><th>Cash</th><th>Lipa</th><th>Note</th></tr></thead><tbody>', tc = 0, tl = 0;
      rows.forEach(function (c) { tc += Number(c.cash_amount) || 0; tl += Number(c.lipa_amount) || 0; h += '<tr><td class="small" style="white-space:nowrap;">' + BO.fmtDT(c.received_at) + '</td><td>' + esc(c.seller_name || '') + '</td><td class="mono">' + fmtFull(c.cash_amount) + '</td><td class="mono">' + fmtFull(c.lipa_amount) + '</td><td class="small muted">' + esc(c.note || '') + '</td></tr>'; });
      h += '<tr><td colspan="2"><strong>Total</strong></td><td class="mono"><strong>' + fmtFull(tc) + '</strong></td><td class="mono"><strong>' + fmtFull(tl) + '</strong></td><td></td></tr>';
      el.innerHTML = h + '</tbody></table></div>';
    }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }
  BO.tabs.cash = { load: load, sync: list };
  return { load: load, record: record, list: list };
})();
