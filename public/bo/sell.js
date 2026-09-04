/* SELL -- the checkout: products, quantities (or IMEIs), list price, discount, payment method,
   financing partner for credit, the shop. Everything the old New Sale tab did, plus Frank's
   phone-retail asks (#5 IMEI, #7 credit, #8 discount, #1 shop). */
window.BOSell = (function () {
  var opts = { products: [], partners: [], branches: [] }, branchId = '', rowSeq = 0;

  function load(afterMsg) {
    var el = document.getElementById('saleContent'); if (!el) return;
    if (isManager()) { el.innerHTML = '<div class="empty">Managers do not sell — sign in as a seller or admin of a business.</div>'; return; }
    if (!branchId && S.user && S.user.branch_id) branchId = S.user.branch_id;
    el.innerHTML = '<div class="empty">Loading…</div>';
    srv('productOptions', branchId ? { branch_id: branchId } : {}).then(function (o) {
      opts = o || opts; if (!opts.products) opts.products = []; if (!opts.partners) opts.partners = []; if (!opts.branches) opts.branches = [];
      render(el);
      if (afterMsg) { var sm = document.getElementById('saleMsg'); if (sm) sm.innerHTML = afterMsg; }
    }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }

  function productSelect(selected) {
    var h = '<select class="form-select prodSelect" style="min-width:170px;" onchange="BOSell.pick(this)"><option value="">Select product…</option>';
    opts.products.forEach(function (p) {
      var stock = p.is_serialized ? (p.units || []).length : p.stock;
      h += '<option value="' + esc(p.id) + '"' + (stock <= 0 ? ' disabled' : '') + (selected === p.id ? ' selected' : '') + '>' + esc(p.name) + (p.legacy_id ? ' (' + esc(p.legacy_id) + ')' : '') + ' — stock ' + stock + (p.is_serialized ? ' · IMEI' : '') + '</option>';
    });
    return h + '</select>';
  }
  function row() {
    rowSeq++;
    return '<tr class="sale-row" data-row="' + rowSeq + '"><td>' + productSelect('') + '<div class="units"></div></td><td style="width:80px;"><input type="number" class="form-control qty" value="1" min="1" oninput="BOSell.calc(this)"></td><td style="width:130px;"><input type="number" class="form-control price" value="0" min="0" oninput="BOSell.calc(this)"></td><td style="width:110px;"><input type="number" class="form-control disc" value="0" min="0" oninput="BOSell.calc(this)"></td><td style="width:110px;"><span class="row-total">0</span></td><td><button class="btn-sm-danger" onclick="this.closest(\'tr\').remove();BOSell.grand()">✕</button></td></tr>';
  }
  function render(el) {
    var h = '<div class="section-card"><div class="section-hdr"><span>🛒</span><div class="section-hdr-title">New Sale</div></div><div class="section-body">';
    h += '<div class="form-grid" style="margin-bottom:16px;max-width:760px;">';
    h += '<div class="form-group"><label class="form-label">Payment Method</label><select id="payMethod" class="form-select" onchange="BOSell.payChanged()"><option value="Cash">💵 Cash</option><option value="Lipa Number">📱 Lipa Number</option><option value="Credit">🏦 Credit (financing)</option></select></div>';
    h += '<div class="form-group" id="partnerWrap" style="display:none;"><label class="form-label">Financing Partner</label><select id="salePartner" class="form-select"><option value="">Select partner…</option>' + opts.partners.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('') + '</select></div>';
    if (S.features.has_branches && opts.branches.length) {
      h += '<div class="form-group"><label class="form-label">Shop / Branch</label><select id="saleBranch" class="form-select" onchange="BOSell.branchChanged(this.value)"><option value="">— No shop —</option>' + opts.branches.map(function (b) { return '<option value="' + esc(b.id) + '"' + (branchId === b.id ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join('') + '</select></div>';
    }
    h += '</div>';
    h += '<div class="table-wrap"><table class="sale-tbl"><thead><tr><th>Product</th><th>Qty</th><th>List Price</th><th>Discount</th><th>Total</th><th></th></tr></thead><tbody id="saleItemsBody">' + row() + '</tbody></table></div>';
    h += '<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap;align-items:center;"><button class="btn-secondary" onclick="BOSell.addRow()">+ Add Item</button><button class="btn-primary" id="saleSubmitBtn" onclick="BOSell.submit()">✅ Record Sale</button><span class="muted small" id="saleGrand"></span></div>';
    h += '<div id="saleMsg" style="margin-top:12px;"></div></div></div>';
    el.innerHTML = h;
  }

  function pick(sel) {
    var tr = sel.closest('tr'), p = productOf(sel.value), units = tr.querySelector('.units'), qty = tr.querySelector('.qty');
    if (p) tr.querySelector('.price').value = p.price;
    if (p && p.is_serialized) {
      qty.value = 0; qty.readOnly = true; qty.style.opacity = '.6';
      units.innerHTML = '<div class="unit-pick">' + (p.units || []).map(function (u) { return '<label><input type="checkbox" value="' + esc(u.id) + '" onchange="BOSell.unitToggle(this)" style="margin:0;">' + esc(u.imei || u.serial_no || u.id) + '</label>'; }).join('') + '</div>' + (!(p.units || []).length ? '<div class="small muted">No units in stock' + (branchId ? ' at this shop' : '') + '.</div>' : '<div class="small muted">Tick the IMEI(s) being sold.</div>');
    } else { qty.readOnly = false; qty.style.opacity = ''; if (Number(qty.value) < 1) qty.value = 1; units.innerHTML = ''; }
    calc(sel);
  }
  function unitToggle(cb) {
    var tr = cb.closest('tr'); cb.parentNode.classList.toggle('on', cb.checked);
    tr.querySelector('.qty').value = tr.querySelectorAll('.unit-pick input:checked').length;
    calc(cb);
  }
  function productOf(id) { for (var i = 0; i < opts.products.length; i++) if (opts.products[i].id === id) return opts.products[i]; return null; }
  function calc(elm) {
    var tr = elm.closest('tr'); if (!tr) return;
    var q = parseFloat(tr.querySelector('.qty').value) || 0, p = parseFloat(tr.querySelector('.price').value) || 0, d = parseFloat(tr.querySelector('.disc').value) || 0;
    tr.querySelector('.row-total').textContent = fmtFull(Math.max(0, q * (p - d)));
    grand();
  }
  function grand() {
    var t = 0; document.querySelectorAll('#saleItemsBody .sale-row').forEach(function (tr) { var q = parseFloat(tr.querySelector('.qty').value) || 0, p = parseFloat(tr.querySelector('.price').value) || 0, d = parseFloat(tr.querySelector('.disc').value) || 0; t += Math.max(0, q * (p - d)); });
    var g = document.getElementById('saleGrand'); if (g) g.textContent = t ? 'Grand total: ' + fmtFull(t) + ' ' + cur() : '';
  }
  function addRow() { var tb = document.getElementById('saleItemsBody'), tr = document.createElement('tr'); tr.className = 'sale-row'; tr.innerHTML = row().replace(/^<tr[^>]*>/, '').replace(/<\/tr>$/, ''); tb.appendChild(tr); }
  function payChanged() { var m = document.getElementById('payMethod').value; document.getElementById('partnerWrap').style.display = m === 'Credit' ? '' : 'none'; }
  function branchChanged(id) { branchId = id || ''; load(); }

  function submit() {
    var rows = document.querySelectorAll('#saleItemsBody .sale-row'), items = [], grandTotal = 0, summary = '';
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i], pid = tr.querySelector('.prodSelect').value, qty = parseInt(tr.querySelector('.qty').value, 10), price = parseFloat(tr.querySelector('.price').value), disc = parseFloat(tr.querySelector('.disc').value) || 0;
      if (!pid || !qty || isNaN(price)) { alert('Fill all rows.'); return; }
      var p = productOf(pid), unitIds = [];
      if (p && p.is_serialized) {
        tr.querySelectorAll('.unit-pick input:checked').forEach(function (cb) { unitIds.push(cb.value); });
        if (!unitIds.length) { alert('Tick at least one IMEI for ' + p.name + '.'); return; }
        qty = unitIds.length;
      }
      if (disc < 0 || disc > price) { alert('Discount must be between 0 and the list price.'); return; }
      items.push({ product_id: pid, qty: qty, price: price, discount: disc, unit_ids: unitIds.length ? unitIds : undefined });
      var line = qty * (price - disc); grandTotal += line;
      summary += (i + 1) + '. ' + (p ? p.name : pid) + ' – Qty: ' + qty + ' × ' + fmtFull(price) + (disc ? ' − ' + fmtFull(disc) : '') + ' = ' + fmtFull(line) + '\n';
    }
    if (!items.length) { alert('Add at least one item.'); return; }
    var pay = document.getElementById('payMethod').value, partner = null, partnerName = '';
    if (pay === 'Credit') { var ps = document.getElementById('salePartner'); partner = ps.value; if (!partner) { alert('Choose the financing partner for a credit sale.'); return; } partnerName = ps.options[ps.selectedIndex].text; }
    if (!BO.confirm('Confirm sale?\n\n' + summary + '\nGrand Total: ' + fmtFull(grandTotal) + ' ' + cur() + '\nPayment: ' + pay + (partnerName ? ' (' + partnerName + ')' : '') + (branchId ? '\nShop: ' + branchName() : ''))) return;
    var btn = document.getElementById('saleSubmitBtn'); btn.disabled = true;
    var args = { items: items, payment_method: pay };
    if (partner) args.financing_partner_id = partner;
    if (branchId) args.branch_id = branchId;
    srv('recordSale', args).then(function (r) {
      /* The confirmation has to survive the rebuild. load() replaces the whole tab, including
         #saleMsg, and it does that only when its own request comes back -- so the old code,
         which restored the message on a 50ms timer, was racing a network call it could not
         win on a slow connection. The seller was then left with a blank form and no word of
         whether the sale had gone through, which is how the same phone gets sold twice.
         So the message is HANDED to load(), which draws it after the rebuild. */
      showToast('Sale recorded.');
      btn.disabled = false;
      BO.reload('dashboard');
      load('<div class="alert-success" style="font-size:.9rem;">✅ ' + esc(r.message) + ' — <strong>' + fmtFull(r.grand_total) + ' ' + cur() + '</strong></div>');
    }).catch(function (e) { btn.disabled = false; document.getElementById('saleMsg').innerHTML = '<div class="alert-danger">' + esc(e.message) + '</div>'; });
  }
  function branchName() { for (var i = 0; i < opts.branches.length; i++) if (opts.branches[i].id === branchId) return opts.branches[i].name; return ''; }

  BO.tabs.sale = { load: load };
  return { load: load, pick: pick, unitToggle: unitToggle, calc: calc, grand: grand, addRow: addRow, payChanged: payChanged, branchChanged: branchChanged, submit: submit };
})();
