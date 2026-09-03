/* DASHBOARD -- the business overview (vendor users) and the manager's overview of every business. */
window.BODash = (function () {
  var chart = null, branchId = '', lastData = null;

  function statCard(cls, icon, label, value, unit, onclick) {
    return '<div class="stat-card ' + cls + '"' + (onclick ? ' onclick="' + onclick + '"' : ' style="cursor:default;"') + '><div class="sc-icon">' + icon + '</div><div class="sc-label">' + label + '</div><div class="sc-value">' + value + (unit ? '<span class="sc-unit"> ' + esc(unit) + '</span>' : '') + '</div><div class="sc-accent"></div></div>';
  }
  function section(icon, title, body, extra) {
    return '<div class="section-card"><div class="section-hdr"><span>' + icon + '</span><div class="section-hdr-title">' + title + '</div>' + (extra || '') + '</div>' + body + '</div>';
  }
  function due(v) { return '<td class="mono" style="color:' + (v > 0 ? '#ef4444' : '#06d6a0') + ';">' + fmtFull(v) + '</td>'; }

  function load(silent) {
    var el = document.getElementById('dashboardContent');
    if (!el) return;
    if (!silent) el.innerHTML = '<div class="empty">Loading…</div>';
    if (isSeller() && S.perms.showDashboard === false) { el.innerHTML = '<div class="empty">The dashboard is not enabled for sellers of this business. Use the Sell tab.</div>'; return; }
    if (isManager()) { loadManager(el); return; }
    srv('dashboard', branchId ? { branch_id: branchId } : {}).then(function (d) { lastData = d; render(el, d); }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }

  function chips() {
    if (!S.features.has_branches || !S.branches.length) return '';
    var h = '<div class="tabs-row"><button class="tab-chip' + (!branchId ? ' active' : '') + '" onclick="BODash.branch(\'\')">All shops</button>';
    S.branches.forEach(function (b) { h += '<button class="tab-chip' + (branchId === b.id ? ' active' : '') + '" onclick="BODash.branch(\'' + esc(b.id) + '\')">' + esc(b.name) + '</button>'; });
    return h + '</div>';
  }

  function render(el, d) {
    var c = d.currency || cur();
    var html = chips();
    html += '<div class="stats-row">'
      + statCard('sc-blue', '🌅', 'Today', fmtFull(d.today_total), c, "BODash.detail('today')")
      + statCard('sc-green', '📅', 'This Week', fmtFull(d.week_total), c, "BODash.detail('week')")
      + statCard('sc-amber', '📆', 'This Month', fmt(d.month_total), c, "BODash.detail('month')")
      + statCard('sc-purple', '🗓️', 'This Year', fmt(d.year_total), c, "BODash.detail('year')")
      + statCard('sc-rose', '⚠️', 'Low Stock', d.low_count || 0, 'items', "BODash.detail('stock')")
      + statCard('sc-blue', '📦', 'Stock Value', fmt(d.stock_value), c)
      + '</div>';
    if (d.chart && d.chart.length) html += section('📈', 'Sales Trend – Last 7 Days', '<div class="section-body"><div class="chart-wrap"><canvas id="salesChartCanvas"></canvas></div></div>');
    if (d.branch_rows && d.branch_rows.length) {
      var br = '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Shop</th><th>Today</th><th>Week</th><th>Month</th><th>Year</th><th>Units today</th></tr></thead><tbody>';
      d.branch_rows.forEach(function (b) { br += '<tr><td><strong>' + esc(b.name) + '</strong></td><td class="mono">' + fmtFull(b.today) + '</td><td class="mono">' + fmtFull(b.week) + '</td><td class="mono">' + fmtFull(b.month) + '</td><td class="mono">' + fmtFull(b.year) + '</td><td>' + (b.units || 0) + '</td></tr>'; });
      html += section('🏬', 'Sales per shop', br + '</tbody></table></div>');
    }
    if (isAdmin()) {
      var sr = '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Seller</th><th>Cash Sales</th><th>Lipa Sales</th><th>Credit Sales</th><th>Cash Rec</th><th>Cash Due</th><th>Lipa Rec</th><th>Lipa Due</th></tr></thead><tbody>';
      if (d.seller_rows && d.seller_rows.length) {
        d.seller_rows.forEach(function (r) { sr += '<tr><td>' + esc(r.name) + ' <span class="muted small">(' + esc(r.handle) + ')</span></td><td class="mono">' + fmtFull(r.cash_sales) + '</td><td class="mono">' + fmtFull(r.lipa_sales) + '</td><td class="mono">' + fmtFull(r.credit_sales) + '</td><td class="mono">' + fmtFull(r.cash_received) + '</td>' + due(r.cash_due) + '<td class="mono">' + fmtFull(r.lipa_received) + '</td>' + due(r.lipa_due) + '</tr>'; });
      } else sr += '<tr><td colspan="8" class="empty">No sellers yet.</td></tr>';
      html += section('💹', 'Seller Balances Today', sr + '</tbody></table></div>');
      html += section('🧾', 'Recent Sales', '<div id="salesHistoryBody" class="empty">Loading…</div>');
    } else if (isSeller() && d.self) {
      var s = d.self;
      html += section('🧑', 'My Current Balance', '<div class="section-body"><div class="stats-row" style="margin-bottom:0;">'
        + statCard('sc-green', '💵', 'Cash Sales', fmtFull(s.cash), c) + statCard('sc-blue', '📱', 'Lipa Sales', fmtFull(s.lipa), c)
        + statCard('sc-purple', '🏦', 'Credit Sales', fmtFull(s.credit), c) + statCard('sc-amber', '🛍️', 'Items sold today', s.items || 0, '') + '</div></div>');
    }
    var pt = '<div class="table-wrap" style="max-height:360px;overflow-y:auto;"><table class="bo-table"><thead><tr><th>ID</th><th>Product</th><th>Brand / Model</th><th>Stock</th><th>Price</th><th>Value</th><th>Status</th></tr></thead><tbody>';
    (d.products || []).forEach(function (p) { pt += '<tr><td class="muted small mono">' + esc(p.legacy_id || '') + '</td><td>' + esc(p.name) + (p.is_serialized ? ' <span class="badge badge-seller">IMEI</span>' : '') + '</td><td class="muted">' + esc([p.brand, p.model].filter(Boolean).join(' ')) + '</td><td>' + p.stock + '</td><td class="mono">' + fmtFull(p.price) + '</td><td class="mono">' + fmtFull(p.value) + '</td><td>' + BO.stockBadge(p.status) + '</td></tr>'; });
    if (!(d.products || []).length) pt += '<tr><td colspan="7" class="empty">No products yet.</td></tr>';
    html += section('📦', 'Stock Overview', pt + '</tbody></table></div>');
    el.innerHTML = html;
    if (d.chart && d.chart.length) drawChart(d.chart, c);
    if (isAdmin()) recent();
  }

  function drawChart(data, c) {
    var canvas = document.getElementById('salesChartCanvas');
    if (!canvas || typeof Chart === 'undefined') return;
    if (chart) { try { chart.destroy(); } catch (e) {} chart = null; }
    var isDark = S.theme === 'dark', gc = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', tc = '#94A3B8';
    chart = new Chart(canvas, { type: 'bar', data: { labels: data.map(function (d) { return d.label; }), datasets: [{ label: 'Sales (' + c + ')', data: data.map(function (d) { return d.value; }), backgroundColor: isDark ? 'rgba(37,99,235,0.5)' : 'rgba(37,99,235,0.6)', borderColor: '#2563EB', borderWidth: 2, borderRadius: 6, hoverBackgroundColor: '#2563EB' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (x) { return ' ' + x.parsed.y.toLocaleString('en-US') + ' ' + c; } } } }, scales: { x: { grid: { color: gc }, ticks: { color: tc, font: { size: 11 } } }, y: { grid: { color: gc }, ticks: { color: tc, font: { size: 11 }, callback: function (v) { return fmt(v); } } } } } });
  }

  function loadManager(el) {
    srv('managerDashboard', {}).then(function (d) {
      var html = '<div class="stats-row">' + statCard('sc-blue', '🏢', 'Vendors', d.vendor_count || 0, '') + statCard('sc-green', '💰', 'Today Sales', fmtFull(d.today), 'TZS') + statCard('sc-amber', '📅', 'Weekly Sales', fmtFull(d.week), 'TZS') + statCard('sc-rose', '📆', 'Monthly Sales', fmt(d.month), 'TZS') + statCard('sc-purple', '🗓️', 'This Year', fmt(d.year), 'TZS') + statCard('sc-blue', '📦', 'Stock Value', fmt(d.stock_value), 'TZS') + '</div>';
      var t = '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Vendor</th><th>Admin</th><th>Today</th><th>Weekly</th><th>Monthly</th><th>Year</th><th>Products</th><th>Sellers</th><th>Stock Value</th></tr></thead><tbody>';
      (d.rows || []).forEach(function (r) { t += '<tr><td><strong>' + esc(r.name) + '</strong></td><td>' + esc(r.admin_name || '–') + ' <span class="muted small">(' + esc(r.admin_handle || '') + ')</span></td><td class="mono">' + fmtFull(r.today) + ' ' + esc(r.currency) + '</td><td class="mono">' + fmtFull(r.week) + '</td><td class="mono">' + fmtFull(r.month) + '</td><td class="mono">' + fmtFull(r.year) + '</td><td>' + r.products + '</td><td>' + r.sellers + '</td><td class="mono">' + fmtFull(r.stock_value) + ' ' + esc(r.currency) + '</td></tr>'; });
      if (!(d.rows || []).length) t += '<tr><td colspan="9" class="empty">No vendors</td></tr>';
      el.innerHTML = html + section('📊', 'Vendor Performance', t + '</tbody></table></div>');
    }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }

  function recent() {
    var el = document.getElementById('salesHistoryBody'); if (!el) return;
    srv('recentSales', { limit: 30, include_cancelled: true, branch_id: branchId || undefined }).then(function (r) {
      var rows = r.rows || [];
      if (!rows.length) { el.innerHTML = 'No sales records found.'; return; }
      var h = '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Sale ID</th><th>Date/Time</th><th>Seller</th><th>Product</th><th>Qty</th><th>Unit</th><th>Total</th><th>Payment</th><th>Shop</th><th>Status</th><th></th></tr></thead><tbody>';
      rows.forEach(function (s) {
        var cancelled = s.status === 'cancelled';
        var unit = s.discount > 0 ? '<span class="mono">' + fmtFull(s.price) + '</span> <s class="muted small">' + fmtFull(s.list_price) + '</s>' : '<span class="mono">' + fmtFull(s.price) + '</span>';
        var pay = '<span class="badge ' + BO.badgeFor(s.payment_method) + '">' + esc(s.payment_method) + '</span>' + (s.partner_name ? '<div class="small muted">' + esc(s.partner_name) + ' · <a href="#" class="link-btn" onclick="BODash.partnerPaid(\'' + esc(s.id) + '\',' + (s.partner_paid ? 'false' : 'true') + ');return false;">' + (s.partner_paid ? '✔ Paid' : 'Unpaid') + '</a></div>' : '');
        h += '<tr style="' + (cancelled ? 'opacity:.55;' : '') + '"><td class="mono small muted">' + esc(s.legacy_id || '') + '</td><td class="small" style="white-space:nowrap;">' + BO.fmtDT(s.sold_at) + '</td><td>' + esc(s.seller_name) + '</td><td>' + esc(s.product_name) + (s.imei ? '<div class="mono small muted">' + esc(s.imei) + '</div>' : '') + ((s.brand || s.model) ? '<div class="small muted">' + esc([s.brand, s.model].filter(Boolean).join(' ')) + '</div>' : '') + '</td><td>' + s.qty + '</td><td>' + unit + '</td><td class="mono">' + fmtFull(s.total) + '</td><td>' + pay + '</td><td class="small">' + esc(s.branch_name || '') + '</td><td>' + (cancelled ? '<span class="badge badge-cancel">Cancelled</span><div class="small muted">' + esc(s.cancelled_by_name || '') + (s.cancel_reason ? ': ' + esc(s.cancel_reason) : '') + '</div>' : '<span class="badge badge-ok">Completed</span>') + '</td><td>' + (cancelled ? '' : '<button class="btn-sm-danger" title="Cancel this sale &amp; restore stock" onclick="BODash.cancel(\'' + esc(s.id) + '\',\'' + esc(s.legacy_id || '') + '\')">🗑️</button>') + '</td></tr>';
      });
      el.innerHTML = h + '</tbody></table></div>';
    }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }

  function cancel(id, label) {
    var reason = prompt('Why is sale ' + label + ' being cancelled?'); if (reason == null) return;
    if (!reason.trim()) { showToast('A reason is required.', '⚠️'); return; }
    if (!BO.confirm('Cancel sale ' + label + '?\n\n• Stock will be restored\n• Seller will be notified\n\nThis cannot be undone.')) return;
    srv('cancelSale', { sale_id: id, reason: reason.trim() }).then(function (r) { showToast(r.message); load(true); }).catch(BO.fail);
  }
  function partnerPaid(id, paid) {
    srv('markPartnerPaid', { sale_id: id, paid: paid }).then(function (r) { showToast(r.message); recent(); }).catch(BO.fail);
  }

  function detail(period) {
    var args = { period: period }; if (branchId) args.branch_id = branchId;
    srv('salesDetail', args).then(function (d) {
      var body = '';
      if (d.kind === 'stock') {
        body = '<div class="table-wrap"><table class="bo-table"><thead><tr><th>ID</th><th>Product</th><th>Stock</th><th>Price</th><th>Value</th><th>Status</th></tr></thead><tbody>';
        (d.rows || []).forEach(function (p) { body += '<tr><td class="mono small muted">' + esc(p.legacy_id || '') + '</td><td>' + esc(p.name) + '</td><td>' + p.stock + '</td><td class="mono">' + fmtFull(p.price) + '</td><td class="mono">' + fmtFull(p.value) + '</td><td>' + BO.stockBadge(p.status) + '</td></tr>'; });
        body += '</tbody></table></div>';
      } else if (!(d.groups || []).length) {
        body = '<p class="muted">No sales in this period.</p>';
      } else {
        d.groups.forEach(function (g) {
          body += '<h6 style="margin:16px 0 8px;color:var(--text);">🧑 ' + esc(g.seller_name) + ' – <span style="color:var(--accent2);">' + fmtFull(g.total) + ' ' + esc(d.currency) + '</span></h6>';
          body += '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Time</th><th>Product</th><th>IMEI</th><th>Qty</th><th>Price</th><th>Disc</th><th>Total</th><th>Payment</th><th>Shop</th></tr></thead><tbody>';
          g.rows.forEach(function (r) { body += '<tr><td class="small">' + BO.fmtDT(r.sold_at) + '</td><td>' + esc(r.product_name) + '</td><td class="mono small">' + esc(r.imei || '') + '</td><td>' + r.qty + '</td><td class="mono">' + fmtFull(r.price) + '</td><td class="mono">' + (r.discount ? fmtFull(r.discount) : '–') + '</td><td class="mono">' + fmtFull(r.total) + '</td><td><span class="badge ' + BO.badgeFor(r.payment_method) + '">' + esc(r.payment_method) + '</span>' + (r.partner_name ? ' <span class="small muted">' + esc(r.partner_name) + '</span>' : '') + '</td><td class="small">' + esc(r.branch_name || '') + '</td></tr>'; });
          body += '</tbody></table></div>';
        });
        body += '<div style="text-align:right;margin-top:16px;font-weight:700;font-size:1.05rem;">Grand Total: ' + fmtFull(d.grand_total) + ' ' + esc(d.currency) + '</div>';
      }
      var titles = { today: 'Today Sales', week: 'Week Sales', month: 'Month Sales', year: 'Year Sales', stock: 'Stock Overview' };
      BO.dialog({ title: (titles[period] || 'Sales') + ' Details', body: body, size: 'lg' });
    }).catch(BO.fail);
  }

  function branch(id) { branchId = id || ''; load(); }

  BO.tabs.dashboard = { load: function () { load(false); }, sync: function () { load(true); } };
  return { load: load, detail: detail, recent: recent, cancel: cancel, partnerPaid: partnerPaid, branch: branch };
})();
