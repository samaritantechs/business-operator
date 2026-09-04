/* PURCHASE ORDERS -- what you have ordered and not yet got.
   Raising one moves nothing: an order is a promise. Receiving is what turns it into stock, and
   it goes through the same 'received' movement a manual restock does, so nothing here is a
   second way for a quantity to change. */
window.BOPO = (function () {
  var list = [], products = [], currency = 'TZS', filter = 'ordered', rowSeq = 0;

  function load() {
    var el = document.getElementById('poContent'); if (!el) return;
    if (!isAdmin()) { el.innerHTML = '<div class="empty">Only the business admin raises purchase orders.</div>'; return; }
    el.innerHTML = '<div class="empty">Loading…</div>';
    Promise.all([srv('purchaseOrders', filter === 'all' ? {} : { status: filter }), srv('products', {})])
      .then(function (r) {
        list = r[0].rows || []; currency = r[0].currency || 'TZS';
        products = (r[1].rows || []).filter(function (p) { return p.active && !p.is_serialized; });
        render(el);
      }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }

  function render(el) {
    var h = '';

    /* ------------------------------------------------------------ raise one */
    h += '<div class="section-card" style="margin-bottom:18px;"><div class="section-hdr"><span>🚚</span><div class="section-hdr-title">New Purchase Order</div></div><div class="section-body">';
    if (!products.length) {
      h += '<div class="empty">Add a counted product first. Phones tracked by IMEI are received as IMEIs under <strong>Stock &amp; Shops</strong>, not as a quantity.</div>';
    } else {
      h += '<div class="form-grid" style="margin-bottom:14px;max-width:820px;">'
        + '<div class="form-group"><label class="form-label">Supplier</label><input class="form-control" id="poSupplier" placeholder="e.g. Kariakoo Wholesale"></div>'
        + '<div class="form-group"><label class="form-label">Their reference</label><input class="form-control" id="poRef" placeholder="Invoice / order no."></div>'
        + '<div class="form-group"><label class="form-label">Expected</label><input type="date" class="form-control" id="poExpected"></div>'
        + shopSelect('poBranch')
        + '<div class="form-group" style="grid-column:span 2;"><label class="form-label">Notes</label><input class="form-control" id="poNotes" placeholder="Anything the person receiving it should know"></div>'
        + '</div>';
      h += '<div class="table-wrap"><table class="sale-tbl"><thead><tr><th>Product</th><th>Qty</th><th>Unit cost</th><th>Line total</th><th></th></tr></thead><tbody id="poItemsBody">' + row() + '</tbody></table></div>';
      h += '<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;align-items:center;"><button class="btn-secondary" onclick="BOPO.addRow()">+ Add Line</button><button class="btn-primary" id="poSubmitBtn" onclick="BOPO.create()">🚚 Raise Order</button><span class="muted small" id="poGrand"></span></div>';
      h += '<div class="small muted" style="margin-top:8px;">Nothing moves yet. Stock arrives when you mark the delivery received.</div>';
      h += '<div id="poMsg" style="margin-top:12px;"></div>';
    }
    h += '</div></div>';

    /* ------------------------------------------------------------ the orders */
    h += '<div class="section-card"><div class="section-hdr"><span>📋</span><div class="section-hdr-title">Orders</div>'
      + '<select class="form-select" style="width:auto;margin-left:auto;" onchange="BOPO.setFilter(this.value)">'
      + [['ordered', 'Open'], ['received', 'Completed'], ['cancelled', 'Cancelled'], ['all', 'All']].map(function (o) {
        return '<option value="' + o[0] + '"' + (filter === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></div><div class="section-body">';
    if (!list.length) {
      h += '<div class="empty">' + (filter === 'ordered' ? 'Nothing on order. Everything you are waiting for will show here.' : 'No orders in this state.') + '</div>';
    } else {
      list.forEach(function (po) { h += card(po); });
    }
    h += '</div></div>';
    el.innerHTML = h;
    grand();
  }

  function shopSelect(id) {
    if (!S.features.has_branches || !S.branches.length) return '';
    return '<div class="form-group"><label class="form-label">Delivering to</label><select class="form-select" id="' + id + '"><option value="">— No shop —</option>'
      + S.branches.map(function (b) { return '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>'; }).join('') + '</select></div>';
  }
  function productSelect() {
    return '<select class="form-select poProd" style="min-width:170px;" onchange="BOPO.pick(this)"><option value="">Select product…</option>'
      + products.map(function (p) {
        return '<option value="' + esc(p.id) + '" data-cost="' + esc(String(p.cost_price == null ? 0 : p.cost_price)) + '">' + esc(p.name)
          + (p.legacy_id ? ' (' + esc(p.legacy_id) + ')' : '') + ' — have ' + p.stock + '</option>';
      }).join('') + '</select>';
  }
  function row() {
    rowSeq++;
    return '<tr class="po-row"><td>' + productSelect() + '</td>'
      + '<td style="width:90px;"><input type="number" class="form-control poQty" value="1" min="1" oninput="BOPO.calc()"></td>'
      + '<td style="width:140px;"><input type="number" class="form-control poCost" value="0" min="0" oninput="BOPO.calc()"></td>'
      + '<td style="width:120px;"><span class="po-line mono">0</span></td>'
      + '<td><button class="btn-sm-danger" onclick="this.closest(\'tr\').remove();BOPO.calc()">✕</button></td></tr>';
  }
  function addRow() {
    var tb = document.getElementById('poItemsBody'), tr = document.createElement('tr');
    tr.className = 'po-row';
    tr.innerHTML = row().replace(/^<tr[^>]*>/, '').replace(/<\/tr>$/, '');
    tb.appendChild(tr);
  }
  /* The catalogue already knows what this cost last time; typing it again is how it drifts. */
  function pick(sel) {
    var o = sel.options[sel.selectedIndex], tr = sel.closest('tr');
    if (o && o.dataset && o.dataset.cost && Number(tr.querySelector('.poCost').value) === 0) tr.querySelector('.poCost').value = o.dataset.cost;
    calc();
  }
  function calc() {
    var t = 0;
    document.querySelectorAll('#poItemsBody .po-row').forEach(function (tr) {
      var q = parseFloat(tr.querySelector('.poQty').value) || 0, c = parseFloat(tr.querySelector('.poCost').value) || 0;
      tr.querySelector('.po-line').textContent = fmtFull(q * c);
      t += q * c;
    });
    grandTo(t);
  }
  function grand() { calc(); }
  function grandTo(t) { var g = document.getElementById('poGrand'); if (g) g.textContent = t ? 'Order total: ' + fmtFull(t) + ' ' + currency : ''; }

  function create() {
    var items = [], ok = true;
    document.querySelectorAll('#poItemsBody .po-row').forEach(function (tr) {
      var pid = tr.querySelector('.poProd').value, q = parseInt(tr.querySelector('.poQty').value, 10), c = parseFloat(tr.querySelector('.poCost').value);
      if (!pid) { ok = false; return; }
      if (!q || q < 1) { ok = false; return; }
      items.push({ product_id: pid, qty: q, unit_cost: isNaN(c) ? 0 : c });
    });
    if (!ok || !items.length) { alert('Pick a product and a quantity on every line.'); return; }
    var btn = document.getElementById('poSubmitBtn'); btn.disabled = true;
    var args = { items: items, supplier: g('poSupplier').trim(), reference: g('poRef').trim(), notes: g('poNotes').trim(), expected_at: g('poExpected') };
    if (g('poBranch')) args.branch_id = g('poBranch');
    srv('createPurchaseOrder', args).then(function (r) {
      btn.disabled = false; showToast(r.message, '🚚'); filter = 'ordered'; load();
    }).catch(function (e) { btn.disabled = false; document.getElementById('poMsg').innerHTML = '<div class="alert-danger">' + esc(e.message) + '</div>'; });
  }

  function card(po) {
    var open = po.status === 'ordered';
    var badge = open ? (po.outstanding < po.items.reduce(function (a, i) { return a + i.qty; }, 0)
        ? '<span class="badge badge-low">Part delivered</span>' : '<span class="badge badge-lipa">On order</span>')
      : po.status === 'received' ? '<span class="badge badge-active">Complete</span>' : '<span class="badge badge-cancel">Cancelled</span>';
    var h = '<div class="po-card">';
    h += '<div class="po-hd"><div><strong>' + esc(po.legacy_id || '') + '</strong> ' + badge
      + '<div class="small muted">' + (po.supplier ? esc(po.supplier) + ' · ' : '') + BO.fmtDate(po.created_at)
      + (po.expected_at ? ' · expected ' + BO.fmtDate(po.expected_at) : '')
      + (po.reference ? ' · ref ' + esc(po.reference) : '') + '</div></div>'
      + '<div style="margin-left:auto;text-align:right;"><div class="mono" style="font-weight:700;">' + fmtFull(po.total) + ' ' + esc(currency) + '</div>'
      + (open && po.outstanding ? '<div class="small" style="color:var(--amber);font-weight:600;">' + po.outstanding + ' still owed</div>' : '') + '</div></div>';

    h += '<div class="table-wrap"><table class="bo-table"><thead><tr><th>Product</th><th>Ordered</th><th>Received</th><th>Unit cost</th><th>Total</th>' + (open ? '<th>Arriving now</th>' : '') + '</tr></thead><tbody>';
    po.items.forEach(function (i) {
      var owed = Math.max(0, i.qty - i.received_qty);
      h += '<tr><td>' + esc(i.product_name) + '</td><td>' + i.qty + '</td>'
        + '<td' + (i.received_qty >= i.qty ? ' style="color:var(--accent2);font-weight:600;"' : '') + '>' + i.received_qty + '</td>'
        + '<td class="mono">' + fmtFull(i.unit_cost) + '</td><td class="mono">' + fmtFull(i.total) + '</td>'
        + (open ? '<td style="width:110px;">' + (owed
            ? '<input type="number" class="form-control poRcv" data-item="' + esc(i.id) + '" value="' + owed + '" min="0" max="' + owed + '">'
            : '<span class="small muted">done</span>') + '</td>' : '')
        + '</tr>';
    });
    h += '</tbody></table></div>';
    if (po.notes) h += '<div class="small muted" style="margin-top:6px;">📝 ' + esc(po.notes) + '</div>';
    if (po.status === 'cancelled' && po.cancel_reason) h += '<div class="small muted" style="margin-top:6px;">Cancelled: ' + esc(po.cancel_reason) + '</div>';
    if (open) {
      h += '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">'
        + '<button class="btn-sm-success" onclick="BOPO.receive(\'' + BO.jsq(po.id) + '\',this)">📥 Receive what arrived</button>'
        + '<button class="btn-sm-warning" onclick="BOPO.cancel(\'' + BO.jsq(po.id) + '\',\'' + BO.jsq(po.legacy_id || '') + '\')">Cancel order</button>'
        + (po.received_value ? '' : '<button class="btn-sm-danger" onclick="BOPO.del(\'' + BO.jsq(po.id) + '\',\'' + BO.jsq(po.legacy_id || '') + '\')">Delete</button>')
        + '</div>';
    }
    return h + '</div>';
  }

  /* The boxes on the counter, not the boxes on the invoice: whatever is in the "arriving now"
     column is what goes into stock, and a short delivery leaves the order open. */
  function receive(id, btn) {
    var card = btn.closest('.po-card'), receipts = [];
    card.querySelectorAll('.poRcv').forEach(function (inp) {
      var q = parseInt(inp.value, 10) || 0;
      if (q > 0) receipts.push({ item_id: inp.dataset.item, qty: q });
    });
    if (!receipts.length) { alert('Enter how many of each actually arrived.'); return; }
    var n = receipts.reduce(function (a, r) { return a + r.qty; }, 0);
    if (!BO.confirm('Receive ' + n + ' item' + (n === 1 ? '' : 's') + ' into stock?\n\nThis is the moment the stock goes up, and the cost price on each product is updated to what this delivery cost.')) return;
    btn.disabled = true;
    srv('receivePurchaseOrder', { id: id, receipts: receipts }).then(function (r) {
      showToast(r.message, '📥'); load(); BO.reload('products'); BO.reload('stock'); BO.reload('dashboard');
    }).catch(function (e) { btn.disabled = false; BO.fail(e); });
  }
  function cancel(id, label) {
    var reason = prompt('Why is ' + label + ' being cancelled?'); if (reason == null) return;
    srv('cancelPurchaseOrder', { id: id, reason: reason.trim() }).then(function (r) { showToast(r.message); load(); }).catch(BO.fail);
  }
  function del(id, label) {
    if (!BO.confirm('Delete ' + label + ' entirely?\n\nNothing has been received on it, so there is nothing to account for.')) return;
    srv('deletePurchaseOrder', { id: id }).then(function (r) { showToast(r.message); load(); }).catch(BO.fail);
  }
  function setFilter(v) { filter = v; load(); }
  function g(id) { var e = document.getElementById(id); return e ? e.value : ''; }

  BO.tabs.po = { load: load, sync: load };
  return { load: load, addRow: addRow, pick: pick, calc: calc, create: create, receive: receive, cancel: cancel, del: del, setFilter: setFilter };
})();
