/* HOLDS -- "keep the A05 for me, I'll come Friday".
   The goods are already off the available count when a hold is made, so nothing on this screen
   has to remind anyone not to sell them: the till cannot see them. Collecting sells them through
   the ordinary sale; cancelling puts them back. */
window.BOHold = (function () {
  var list = [], opts = { products: [], partners: [], branches: [] }, currency = 'TZS', filter = 'held';

  function load() {
    var el = document.getElementById('holdsContent'); if (!el) return;
    if (isManager()) { el.innerHTML = '<div class="empty">Managers do not hold stock — sign in as a seller or admin of a business.</div>'; return; }
    el.innerHTML = '<div class="empty">Loading…</div>';
    Promise.all([srv('pendingSales', filter === 'all' ? {} : { status: filter }), srv('productOptions', {})])
      .then(function (r) {
        list = r[0].rows || []; currency = r[0].currency || 'TZS';
        opts = r[1] || opts;
        ['products', 'partners', 'branches'].forEach(function (k) { if (!opts[k]) opts[k] = []; });
        render(el);
      }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }

  function render(el) {
    var h = '';
    h += '<div class="section-card" style="margin-bottom:18px;"><div class="section-hdr"><span>🔖</span><div class="section-hdr-title">Hold something for a customer</div></div><div class="section-body">';
    h += '<div class="form-grid" style="margin-bottom:14px;max-width:820px;">'
      + '<div class="form-group"><label class="form-label">Customer name *</label><input class="form-control" id="hdName" autocomplete="off"></div>'
      + '<div class="form-group"><label class="form-label">Phone</label><input class="form-control" id="hdPhone" inputmode="tel" autocomplete="off"></div>'
      + '<div class="form-group"><label class="form-label">Deposit left</label><input type="number" class="form-control" id="hdDeposit" value="0" min="0"></div>'
      + '<div class="form-group"><label class="form-label">Holding until</label><input type="date" class="form-control" id="hdUntil"></div>'
      + '<div class="form-group"><label class="form-label">Paying by (if they said)</label><select class="form-select" id="hdPay"><option value="">Decide at collection</option><option value="Cash">💵 Cash</option><option value="Lipa Number">📱 Lipa Number</option><option value="Credit">🏦 Credit (financing)</option></select></div>'
      + shopSelect('hdBranch')
      + '<div class="form-group" style="grid-column:span 2;"><label class="form-label">Notes</label><input class="form-control" id="hdNotes" placeholder="Anything the person handing it over should know"></div>'
      + '</div>';
    h += '<div class="table-wrap"><table class="sale-tbl"><thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Discount</th><th>Total</th><th></th></tr></thead><tbody id="hdItemsBody">' + row() + '</tbody></table></div>';
    h += '<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;align-items:center;"><button class="btn-secondary" onclick="BOHold.addRow()">+ Add Item</button><button class="btn-primary" id="hdSubmitBtn" onclick="BOHold.create()">🔖 Hold It</button><span class="muted small" id="hdGrand"></span></div>';
    h += '<div class="small muted" style="margin-top:8px;">The stock comes off the shelf now, so nobody can sell it out from under them.</div>';
    h += '<div id="hdMsg" style="margin-top:12px;"></div></div></div>';

    h += '<div class="section-card"><div class="section-hdr"><span>📌</span><div class="section-hdr-title">Holds</div>'
      + '<select class="form-select" style="width:auto;margin-left:auto;" onchange="BOHold.setFilter(this.value)">'
      + [['held', 'Being held'], ['completed', 'Collected'], ['cancelled', 'Cancelled'], ['expired', 'Expired'], ['all', 'All']].map(function (o) {
        return '<option value="' + o[0] + '"' + (filter === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></div><div class="section-body">';
    if (!list.length) h += '<div class="empty">' + (filter === 'held' ? 'Nothing is being held.' : 'Nothing here.') + '</div>';
    else list.forEach(function (hd) { h += card(hd); });
    h += '</div></div>';
    el.innerHTML = h;
    calc();
  }

  function shopSelect(id) {
    if (!S.features.has_branches || !opts.branches.length) return '';
    return '<div class="form-group"><label class="form-label">Shop</label><select class="form-select" id="' + id + '"><option value="">— No shop —</option>'
      + opts.branches.map(function (b) { return '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>'; }).join('') + '</select></div>';
  }
  function productSelect() {
    return '<select class="form-select hdProd" style="min-width:170px;" onchange="BOHold.pick(this)"><option value="">Select product…</option>'
      + opts.products.map(function (p) {
        var stock = p.is_serialized ? (p.units || []).length : p.stock;
        return '<option value="' + esc(p.id) + '"' + (stock <= 0 ? ' disabled' : '') + '>' + esc(p.name) + ' — free ' + stock + (p.is_serialized ? ' · IMEI' : '') + '</option>';
      }).join('') + '</select>';
  }
  function row() {
    return '<tr class="hd-row"><td>' + productSelect() + '<div class="units"></div></td>'
      + '<td style="width:80px;"><input type="number" class="form-control hdQty" value="1" min="1" oninput="BOHold.calc()"></td>'
      + '<td style="width:130px;"><input type="number" class="form-control hdPrice" value="0" min="0" oninput="BOHold.calc()"></td>'
      + '<td style="width:110px;"><input type="number" class="form-control hdDisc" value="0" min="0" oninput="BOHold.calc()"></td>'
      + '<td style="width:110px;"><span class="hd-line mono">0</span></td>'
      + '<td><button class="btn-sm-danger" onclick="this.closest(\'tr\').remove();BOHold.calc()">✕</button></td></tr>';
  }
  function addRow() {
    var tb = document.getElementById('hdItemsBody'), tr = document.createElement('tr');
    tr.className = 'hd-row';
    tr.innerHTML = row().replace(/^<tr[^>]*>/, '').replace(/<\/tr>$/, '');
    tb.appendChild(tr);
  }
  function productOf(id) { for (var i = 0; i < opts.products.length; i++) if (opts.products[i].id === id) return opts.products[i]; return null; }
  function pick(sel) {
    var tr = sel.closest('tr'), p = productOf(sel.value), units = tr.querySelector('.units'), qty = tr.querySelector('.hdQty');
    if (p) tr.querySelector('.hdPrice').value = p.price;
    if (p && p.is_serialized) {
      qty.value = 0; qty.readOnly = true; qty.style.opacity = '.6';
      units.innerHTML = '<div class="unit-pick">' + (p.units || []).map(function (u) {
        return '<label><input type="checkbox" value="' + esc(u.id) + '" onchange="BOHold.unitToggle(this)" style="margin:0;">' + esc(u.imei || u.serial_no || u.id) + '</label>';
      }).join('') + '</div>' + ((p.units || []).length ? '<div class="small muted">Tick the exact handset being held.</div>' : '<div class="small muted">Nothing free to hold.</div>');
    } else { qty.readOnly = false; qty.style.opacity = ''; if (Number(qty.value) < 1) qty.value = 1; units.innerHTML = ''; }
    calc();
  }
  function unitToggle(cb) {
    var tr = cb.closest('tr'); cb.parentNode.classList.toggle('on', cb.checked);
    tr.querySelector('.hdQty').value = tr.querySelectorAll('.unit-pick input:checked').length;
    calc();
  }
  function calc() {
    var t = 0;
    document.querySelectorAll('#hdItemsBody .hd-row').forEach(function (tr) {
      var q = parseFloat(tr.querySelector('.hdQty').value) || 0, p = parseFloat(tr.querySelector('.hdPrice').value) || 0, d = parseFloat(tr.querySelector('.hdDisc').value) || 0;
      var line = Math.max(0, q * (p - d));
      tr.querySelector('.hd-line').textContent = fmtFull(line);
      t += line;
    });
    var g = document.getElementById('hdGrand'); if (g) g.textContent = t ? 'Value held: ' + fmtFull(t) + ' ' + currency : '';
  }

  function create() {
    var items = [], bad = '';
    document.querySelectorAll('#hdItemsBody .hd-row').forEach(function (tr) {
      var pid = tr.querySelector('.hdProd').value;
      if (!pid) { bad = bad || 'Pick a product on every line.'; return; }
      var p = productOf(pid), q = parseInt(tr.querySelector('.hdQty').value, 10) || 0;
      var price = parseFloat(tr.querySelector('.hdPrice').value), disc = parseFloat(tr.querySelector('.hdDisc').value) || 0;
      var unitIds = [];
      if (p && p.is_serialized) {
        tr.querySelectorAll('.unit-pick input:checked').forEach(function (cb) { unitIds.push(cb.value); });
        if (!unitIds.length) { bad = bad || 'Tick at least one IMEI for ' + p.name + '.'; return; }
        q = unitIds.length;
      }
      if (q < 1) { bad = bad || 'Quantity must be at least 1.'; return; }
      items.push({ product_id: pid, qty: q, list_price: isNaN(price) ? undefined : price, discount: disc, unit_ids: unitIds.length ? unitIds : undefined });
    });
    if (bad) { alert(bad); return; }
    if (!items.length) { alert('Add at least one item.'); return; }
    var name = g('hdName').trim();
    if (!name) { alert("Enter the customer's name — held stock with nobody's name on it is just missing stock."); document.getElementById('hdName').focus(); return; }

    var btn = document.getElementById('hdSubmitBtn'); btn.disabled = true;
    var args = { items: items, customer_name: name, customer_phone: g('hdPhone').trim(), deposit: Number(g('hdDeposit') || 0),
      hold_until: g('hdUntil'), payment_method: g('hdPay'), notes: g('hdNotes').trim() };
    if (g('hdBranch')) args.branch_id = g('hdBranch');
    srv('createPendingSale', args).then(function (r) {
      btn.disabled = false; showToast(r.message, '🔖'); filter = 'held'; load();
      BO.reload('sale'); BO.reload('products'); BO.reload('stock'); BO.reload('dashboard');
    }).catch(function (e) { btn.disabled = false; document.getElementById('hdMsg').innerHTML = '<div class="alert-danger">' + esc(e.message) + '</div>'; });
  }

  function card(hd) {
    var open = hd.status === 'held';
    var badge = open ? (hd.overdue ? '<span class="badge badge-cancel">Overdue</span>' : '<span class="badge badge-lipa">Held</span>')
      : hd.status === 'completed' ? '<span class="badge badge-active">Collected</span>'
      : hd.status === 'expired' ? '<span class="badge badge-low">Expired</span>' : '<span class="badge badge-cancel">Cancelled</span>';
    var h = '<div class="po-card">';
    h += '<div class="po-hd"><div><strong>' + esc(hd.customer_name) + '</strong> ' + badge
      + '<div class="small muted">' + esc(hd.legacy_id || '') + ' · ' + BO.fmtDate(hd.created_at)
      + (hd.customer_phone ? ' · ' + esc(hd.customer_phone) : '')
      + (hd.hold_until ? ' · until ' + BO.fmtDate(hd.hold_until) : '') + '</div></div>'
      + '<div style="margin-left:auto;text-align:right;"><div class="mono" style="font-weight:700;">' + fmtFull(hd.total) + ' ' + esc(currency) + '</div>'
      + (hd.deposit ? '<div class="small muted">' + fmtFull(hd.deposit) + ' deposit · <strong>' + fmtFull(hd.balance) + '</strong> to pay</div>' : '') + '</div></div>';
    h += '<div class="small">' + hd.items.map(function (i) {
      return esc(i.product_name) + (i.qty > 1 ? ' ×' + i.qty : '') + (i.discount ? ' <span class="muted">(less ' + fmtFull(i.discount) + ')</span>' : '');
    }).join(' · ') + '</div>';
    if (hd.notes) h += '<div class="small muted" style="margin-top:6px;">📝 ' + esc(hd.notes) + '</div>';
    if (hd.cancel_reason) h += '<div class="small muted" style="margin-top:6px;">' + esc(hd.cancel_reason) + '</div>';
    if (hd.status === 'completed' && hd.sale_group_id) {
      h += '<div style="margin-top:10px;"><button class="btn-sm-primary" onclick="BORcpt.open({group_id:\'' + BO.jsq(hd.sale_group_id) + '\'})">🧾 Receipt</button></div>';
    }
    if (open) {
      h += '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center;">'
        + '<select class="form-select" style="width:auto;" id="pay_' + esc(hd.id) + '"><option value="">' + (hd.payment_method ? esc(hd.payment_method) + ' (as agreed)' : 'Paying by…') + '</option><option value="Cash">💵 Cash</option><option value="Lipa Number">📱 Lipa Number</option><option value="Credit">🏦 Credit</option></select>'
        + '<button class="btn-sm-success" onclick="BOHold.collect(\'' + BO.jsq(hd.id) + '\',this)">✅ They collected it</button>'
        + '<button class="btn-sm-warning" onclick="BOHold.release(\'' + BO.jsq(hd.id) + '\',\'' + BO.jsq(hd.customer_name) + '\',' + (hd.overdue ? 'true' : 'false') + ',this)">↩︎ Put it back</button>'
        + '</div>';
    }
    return h + '</div>';
  }

  /* The server now refuses a second collection outright, but the button still has to stop trying:
     on a slow connection a seller taps it twice and the second tap is a request that can only end
     in an error message they did not earn. Disabled the moment it is pressed, like create() does. */
  function collect(id, btn) {
    if (btn) { if (btn.disabled) return; btn.disabled = true; }
    var done = function () { if (btn) btn.disabled = false; };
    var sel = document.getElementById('pay_' + id);
    var args = { id: id };
    if (sel && sel.value) args.payment_method = sel.value;
    srv('completePendingSale', args).then(function (r) {
      showToast(r.message, '✅');
      if (r.balance_due > 0 && r.deposit > 0) alert('Take ' + fmtFull(r.balance_due) + ' ' + currency + ' now (' + fmtFull(r.deposit) + ' was already left as a deposit).');
      load(); BO.reload('dashboard'); BO.reload('products'); BO.reload('stock');
      BORcpt.open({ group_id: r.group_id });
    }).catch(function (e) { done(); BO.fail(e); });
  }
  function release(id, who, overdue, btn) {
    if (btn) { if (btn.disabled) return; btn.disabled = true; }
    var reason = prompt('Putting the goods back on the shelf. Why is ' + who + "'s hold ending?");
    if (reason == null) { if (btn) btn.disabled = false; return; }
    srv('cancelPendingSale', { id: id, reason: reason.trim(), expired: !!overdue }).then(function (r) {
      showToast(r.message, '↩︎');
      load(); BO.reload('sale'); BO.reload('products'); BO.reload('stock'); BO.reload('dashboard');
    }).catch(function (e) { if (btn) btn.disabled = false; BO.fail(e); });
  }
  function setFilter(v) { filter = v; load(); }
  function g(id) { var e = document.getElementById(id); return e ? e.value : ''; }

  BO.tabs.holds = { load: load, sync: load };
  return { load: load, addRow: addRow, pick: pick, unitToggle: unitToggle, calc: calc, create: create, collect: collect, release: release, setFilter: setFilter };
})();
