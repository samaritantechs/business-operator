/* CREDIT & VOIDS -- money a financing partner still owes the shop, and sales somebody cancelled.
   Both existed before this screen and neither was findable: an unsettled credit sale was a badge
   you had to spot in the recent-sales table, and a void was a report you had to download. They
   are the two questions an owner asks on a Friday, so they get a screen. */
window.BOCredit = (function () {
  var data = null, days = 30;

  function load() {
    var el = document.getElementById('creditContent'); if (!el) return;
    if (!isAdmin()) { el.innerHTML = '<div class="empty">Only the business admin sees credit and cancelled sales.</div>'; return; }
    el.innerHTML = '<div class="empty">Loading…</div>';
    srv('creditAndVoids', { days: days }).then(function (r) { data = r; render(el); })
      .catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }

  function render(el) {
    var cur = data.currency;
    var h = '';

    /* ------------------------------------------------------------ what is owed */
    h += '<div class="section-card" style="margin-bottom:18px;"><div class="section-hdr"><span>🏦</span><div class="section-hdr-title">Owed by financing partners</div>'
      + '<div style="margin-left:auto;font-weight:800;' + (data.credit.length ? 'color:var(--amber);' : '') + '">' + fmtFull(data.credit_total) + ' ' + esc(cur) + '</div></div><div class="section-body">';
    if (!data.credit.length) {
      h += '<div class="empty">Nothing outstanding. Every credit sale has been settled.</div>';
    } else {
      h += '<div class="cv-partners">' + data.by_partner.map(function (p) {
        return '<div class="cv-partner"><div class="cv-pname">' + esc(p.partner_name) + '</div>'
          + '<div class="cv-ptotal">' + fmtFull(p.total) + ' ' + esc(cur) + '</div>'
          + '<div class="small muted">' + p.checkouts + ' sale' + (p.checkouts === 1 ? '' : 's') + '</div></div>';
      }).join('') + '</div>';
      h += '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Sold</th><th>Waiting</th><th>Partner</th><th>Items</th><th>Amount</th><th>Seller</th><th>Shop</th><th></th></tr></thead><tbody>';
      data.credit.forEach(function (g) { h += creditRow(g, cur); });
      h += '</tbody></table></div>';
    }
    h += '</div></div>';

    /* ------------------------------------------------------------ what was voided */
    h += '<div class="section-card"><div class="section-hdr"><span>🗑️</span><div class="section-hdr-title">Cancelled sales</div>'
      + '<select class="form-select" style="width:auto;margin-left:auto;" onchange="BOCredit.setDays(this.value)">'
      + [7, 30, 90, 365].map(function (d) { return '<option value="' + d + '"' + (days === d ? ' selected' : '') + '>Last ' + (d === 365 ? 'year' : d + ' days') + '</option>'; }).join('')
      + '</select></div><div class="section-body">';
    if (!data.voids.length) {
      h += '<div class="empty">Nothing cancelled in this period.</div>';
    } else {
      h += '<div class="small muted" style="margin-bottom:10px;">' + data.voids.length + ' cancelled checkout' + (data.voids.length === 1 ? '' : 's')
        + ' worth <strong>' + fmtFull(data.voids_total) + ' ' + esc(cur) + '</strong>. The stock went back on the shelf when each was cancelled.</div>';
      h += '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Cancelled</th><th>Sold</th><th>Items</th><th>Amount</th><th>Sold by</th><th>Cancelled by</th><th>Reason</th><th></th></tr></thead><tbody>';
      data.voids.forEach(function (g) { h += voidRow(g, cur); });
      h += '</tbody></table></div>';
    }
    h += '</div></div>';
    el.innerHTML = h;
  }

  function itemsCell(g) {
    return g.items.map(function (i) {
      return '<div>' + esc(i.product_name) + (i.qty > 1 ? ' ×' + i.qty : '')
        + (i.imei ? '<span class="small muted mono"> ' + esc(i.imei) + '</span>' : '') + '</div>';
    }).join('');
  }
  function rcptBtn(g) { return '<button class="btn-sm-primary" title="Receipt" onclick="BORcpt.open({group_id:\'' + BO.jsq(g.group_id) + '\'})">🧾</button>'; }

  function creditRow(g, cur) {
    /* Age is what turns a list of debts into a list of priorities. Past a month it is said in
       red, because at that point somebody has to pick up the phone. */
    var age = g.age_days == null ? '' : (g.age_days + ' day' + (g.age_days === 1 ? '' : 's'));
    var old = g.age_days != null && g.age_days >= 30;
    return '<tr><td class="small" style="white-space:nowrap;">' + BO.fmtDate(g.sold_at) + '</td>'
      + '<td class="small"' + (old ? ' style="color:var(--rose);font-weight:700;"' : '') + '>' + esc(age) + '</td>'
      + '<td>' + esc(g.partner_name || '—') + (g.customer_name ? '<div class="small muted">' + esc(g.customer_name) + '</div>' : '') + '</td>'
      + '<td class="small">' + itemsCell(g) + '</td>'
      + '<td class="mono" style="font-weight:600;">' + fmtFull(g.total) + '</td>'
      + '<td class="small muted">' + esc(g.seller_name) + '</td>'
      + '<td class="small">' + esc(g.branch_name || '') + '</td>'
      + '<td style="white-space:nowrap;">' + rcptBtn(g)
      + ' <button class="btn-sm-success" title="The partner has paid this" onclick="BOCredit.settle(\'' + BO.jsq(g.group_id) + '\',\'' + BO.jsq(g.partner_name || 'the partner') + '\',' + g.total + ')">✅ Paid</button></td></tr>';
  }
  function voidRow(g, cur) {
    return '<tr><td class="small" style="white-space:nowrap;">' + (g.cancelled_at ? BO.fmtDT(g.cancelled_at) : '—') + '</td>'
      + '<td class="small muted" style="white-space:nowrap;">' + BO.fmtDate(g.sold_at) + '</td>'
      + '<td class="small">' + itemsCell(g) + '</td>'
      + '<td class="mono">' + fmtFull(g.total) + '</td>'
      + '<td class="small muted">' + esc(g.seller_name) + '</td>'
      + '<td class="small">' + esc(g.cancelled_by_name || '—') + '</td>'
      + '<td class="small">' + (g.cancel_reason ? esc(g.cancel_reason) : '<span class="muted">—</span>') + '</td>'
      + '<td>' + rcptBtn(g) + '</td></tr>';
  }

  function setDays(v) { days = parseInt(v, 10) || 30; load(); }

  /* Settling is per CHECKOUT, which is what markPartnerPaid already understands: three handsets
     on one MOGO docket are one payment, not three. */
  function settle(groupId, partner, amount) {
    if (!BO.confirm('Mark this sale as paid by ' + partner + '?\n\nAmount: ' + fmtFull(amount) + ' ' + data.currency
      + '\n\nIt leaves this list. Use the same button again on the sale to undo it.')) return;
    srv('markPartnerPaid', { group_id: groupId, paid: true }).then(function (r) {
      showToast(r.message, '✅'); load(); BO.reload('dashboard');
    }).catch(BO.fail);
  }

  BO.tabs.credit = { load: load, sync: load };
  return { load: load, setDays: setDays, settle: settle };
})();
