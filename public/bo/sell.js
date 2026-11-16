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
    var h = '<select class="form-select prodSelect" onchange="BOSell.pick(this)"><option value="">Select product…</option>';
    opts.products.forEach(function (p) {
      var stock = p.is_serialized ? (p.units || []).length : p.stock;
      h += '<option value="' + esc(p.id) + '"' + (stock <= 0 ? ' disabled' : '') + (selected === p.id ? ' selected' : '') + '>' + esc(p.name) + (p.legacy_id ? ' (' + esc(p.legacy_id) + ')' : '') + ' — stock ' + stock + (p.is_serialized ? ' · IMEI' : '') + '</option>';
    });
    return h + '</select>';
  }
  /* HIDDEN, NOT REMOVED. A discount per line came in with the phone-retail work; a grocery does
     not want the column. But three places read tr.querySelector('.disc').value, and deleting the
     cell would make every one of them dereference null and take the whole checkout down -- which
     is precisely how the product Edit dialog died for admins. The input stays, at zero, and the
     column is hidden. Nothing to guard, nothing to forget. */
  function showsDiscount() { return !!S.features.phone_vending; }
  function row() {
    rowSeq++;
    /* EVERY CELL CARRIES ITS OWN NAME (data-label). On a desk the header row names the columns;
       on a phone there is no room for six columns, the row is laid out as a card instead (the
       stylesheet does it, under .sale-tbl) and the header row is gone -- so the name has to
       travel with the box, or a seller is left typing into two unnamed boxes 29px wide, which
       is exactly what this screen was on a phone. The widths live in the stylesheet for the
       same reason: an inline width cannot be undone by a narrow screen. */
    return '<tr class="sale-row" data-row="' + rowSeq + '"><td class="sr-prod">' + productSelect('') + '<div class="units"></div></td>'
      + '<td class="sr-qty" data-label="Qty"><input type="number" inputmode="numeric" class="form-control qty" value="1" min="1" oninput="BOSell.calc(this)"></td>'
      + '<td class="sr-price" data-label="Price"><input type="number" inputmode="decimal" class="form-control price" value="0" min="0" oninput="BOSell.calc(this)"></td>'
      + '<td class="sr-disc' + (showsDiscount() ? '' : ' sr-off') + '" data-label="Discount"><input type="number" inputmode="decimal" class="form-control disc" value="0" min="0" oninput="BOSell.calc(this)"></td>'
      + '<td class="sr-total" data-label="Total"><span class="row-total">0</span></td>'
      + '<td class="sr-x"><button class="btn-sm-danger" title="Remove this line" onclick="this.closest(\'tr\').remove();BOSell.grand()">✕</button></td></tr>';
  }
  function render(el) {
    var h = '<div class="section-card"><div class="section-hdr"><span>🛒</span><div class="section-hdr-title">New Sale</div></div><div class="section-body">';
    h += '<div class="form-grid" style="margin-bottom:16px;max-width:760px;">';
    h += '<div class="form-group"><label class="form-label">Payment Method</label><select id="payMethod" class="form-select" onchange="BOSell.payChanged()"><option value="Cash">💵 Cash</option><option value="Lipa Number">📱 Lipa Number</option><option value="Credit">🏦 Credit (financing)</option><option value="Lending">🤝 Lending (goods leave, not sold)</option></select></div>';
    /* LENDING FROM THE TILL. Goods that leave without being sold used to mean abandoning the
       basket, walking to the Lendings screen and typing every line again -- so people either
       did not bother, or recorded it as a sale and squared it up later, which is how stock and
       takings both end up wrong. The cart is the same cart; only where it is sent changes. */
    /* THE NUMBER THE CUSTOMER PAYS TO, on the seller's screen the moment "Lipa Number" is chosen
       (payChanged fills it). It used to be read off a sticker or from memory. */
    h += '<div class="form-group" id="payNumWrap" style="display:none;grid-column:span 2;"></div>';
    h += '<div class="form-group" id="borrowerWrap" style="display:none;grid-column:span 2;"><label class="form-label">Borrower <span class="muted small">(the goods stay yours until they come back)</span></label><div class="fg2"><input class="form-control" id="lendName" placeholder="Name *" autocomplete="off"><input class="form-control" id="lendPhone" placeholder="Phone" inputmode="tel" autocomplete="off"></div><input class="form-control" id="lendEmail" placeholder="Email (optional — lets you send a reminder)" inputmode="email" autocomplete="off" style="margin-top:8px;"></div>';
    h += '<div class="form-group" id="partnerWrap" style="display:none;"><label class="form-label">Financing Partner</label><select id="salePartner" class="form-select"><option value="">Select partner…</option>' + opts.partners.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('') + '</select></div>';
    /* WHO BOUGHT IT. Optional, and it stays optional: most sales over a shop counter are a
       stranger with cash, and a form that demands a name for those is a form people learn to
       type "x" into. Filled in, it turns the sale into something you can follow up -- a warranty
       claim, a second handset, the Sales by Customer report. */
    h += '<div class="form-group" style="grid-column:span 2;"><label class="form-label">Customer <span class="muted small">(optional — leave blank for a walk-in)</span></label><div class="fg2"><input class="form-control" id="custName" placeholder="Name" autocomplete="off"><input class="form-control" id="custPhone" placeholder="Phone" inputmode="tel" autocomplete="off"></div></div>';
    if (S.features.has_branches && opts.branches.length) {
      h += '<div class="form-group"><label class="form-label">Shop / Branch</label><select id="saleBranch" class="form-select" onchange="BOSell.branchChanged(this.value)"><option value="">— No shop —</option>' + opts.branches.map(function (b) { return '<option value="' + esc(b.id) + '"' + (branchId === b.id ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join('') + '</select></div>';
    }
    h += '</div>';
    h += '<div class="table-wrap"><table class="sale-tbl' + (showsDiscount() ? ' has-disc' : '') + '"><thead><tr><th>Product</th><th>Qty</th><th>List Price</th><th' + (showsDiscount() ? '' : ' class="sr-off"') + '>Discount</th><th>Total</th><th></th></tr></thead><tbody id="saleItemsBody">' + row() + '</tbody></table></div>';
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
  /* WHERE THE MONEY GOES. Mobile money sent to a wrong number does not come back, so when the
     customer is about to pay by Lipa Number the till says the number, the network and -- the
     part that actually prevents the mistake -- the name their own phone will show before they
     enter the PIN. Asked for at most once a minute (BO.payNumbers), so a corrected number reaches a
     till that has been open all day; a shop that has saved none is told where to save one, and
     a seller is told to ask. */
  function showPayNumbers(on) {
    var box = document.getElementById('payNumWrap'); if (!box) return;
    if (!on) { box.style.display = 'none'; return; }
    box.style.display = ''; box.innerHTML = '<div class="pay-num muted small">Loading the Lipa Namba…</div>';
    BO.payNumbers(function (pn) {
      if (document.getElementById('payMethod').value !== 'Lipa Number') return;      // they moved on while it loaded
      var rows = pn.rows || [];
      /* It could not be asked: say that, not "none is saved" -- a shop that HAS a number must
         not be told it has none because the line dropped. */
      if (pn.failed) { box.innerHTML = '<div class="pay-num pay-none">📱 Lipa Namba haikupatikana – angalia mtandao kisha chagua Lipa Number tena. / Could not load the Lipa Namba – check the connection, then choose Lipa Number again.</div>'; return; }
      if (!rows.length) {
        box.innerHTML = '<div class="pay-num pay-none">' + (isAdmin()
          ? (pn.ready ? '📱 No Lipa Namba is saved yet. Add yours under <strong>Users → Business Profile</strong> and it will be shown here for your sellers to read out.'
            : '📱 Lipa Namba cannot be shown yet: this database needs <strong>db/RUN-ME-008</strong> first.')
          : '📱 No Lipa Namba is saved for this shop — ask your admin which number the customer should pay to.') + '</div>';
        return;
      }
      box.innerHTML = '<div class="pay-num"><div class="pay-hd">📱 Lipa Namba — the customer pays to:</div>'
        + rows.map(function (n) { return '<div class="pay-row"><span class="pay-net">' + esc(n.network) + '</span><span class="pay-no mono">' + esc(n.number) + '</span><span class="pay-name">' + esc(n.name) + '</span></div>'; }).join('')
        + '<div class="pay-warn">⚠️ Mteja ahakikishe JINA kabla ya kuweka PIN. / The customer must see this NAME on their phone before entering the PIN.</div></div>';
    });
  }
  function payChanged() {
    var m = document.getElementById('payMethod').value, lend = m === 'Lending';
    showPayNumbers(m === 'Lipa Number');
    document.getElementById('partnerWrap').style.display = m === 'Credit' ? '' : 'none';
    document.getElementById('borrowerWrap').style.display = lend ? '' : 'none';
    /* A lending is not a sale and the button should not claim to be recording one -- the
       difference is the whole point, and the person tapping it is in a hurry. */
    var btn = document.getElementById('saleSubmitBtn');
    if (btn) btn.innerHTML = lend ? '🤝 Record Lending' : '✅ Record Sale';
    var cust = document.getElementById('custName');
    if (cust) cust.closest('.form-group').style.display = lend ? 'none' : '';   // the borrower IS the customer
  }
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
    if (pay === 'Lending') { submitLending(items, grandTotal, summary); return; }
    var custName = (document.getElementById('custName') || {}).value || '', custPhone = (document.getElementById('custPhone') || {}).value || '';
    var who = [custName.trim(), custPhone.trim()].filter(Boolean).join(' · ');
    BO.confirm('Confirm sale?\n\n' + summary + '\nGrand Total: ' + fmtFull(grandTotal) + ' ' + cur() + '\nPayment: ' + pay + (partnerName ? ' (' + partnerName + ')' : '') + (who ? '\nCustomer: ' + who : '') + (branchId ? '\nShop: ' + branchName() : ''), function () {
    var btn = document.getElementById('saleSubmitBtn'); btn.disabled = true;
    var args = { items: items, payment_method: pay };
    if (custName.trim()) args.customer_name = custName.trim();
    if (custPhone.trim()) args.customer_phone = custPhone.trim();
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
      load('<div class="alert-success" style="font-size:.9rem;">✅ ' + esc(r.message) + ' — <strong>' + fmtFull(r.grand_total) + ' ' + cur() + '</strong>'
        + ' <button class="btn-sm-primary" style="margin-left:8px;" onclick="BORcpt.open({group_id:\'' + BO.jsq(r.group_id) + '\'})">🧾 Receipt</button></div>');
    }).catch(function (e) { btn.disabled = false; document.getElementById('saleMsg').innerHTML = '<div class="alert-danger">' + esc(e.message) + '</div>'; });
    });
  }
  /* The same basket, sent to recordLending instead. The item shape is already what that call
     wants -- product, qty, price, unit_ids -- so nothing on the server changes, and a lending
     costs exactly what it always cost. `price` here is the effective price the cart shows
     (list less any discount): what the borrower owes if the goods do not come back. */
  function submitLending(items, grandTotal, summary) {
    var name = (g('lendName') || '').trim(), phone = (g('lendPhone') || '').trim(), email = (g('lendEmail') || '').trim();
    if (!name) { alert("Enter the borrower's name — a lending with nobody's name on it is missing stock."); document.getElementById('lendName').focus(); return; }
    BO.confirm('Record this as a LENDING?\n\n' + summary + '\nValue: ' + fmtFull(grandTotal) + ' ' + cur()
      + '\nBorrower: ' + name + (phone ? ' · ' + phone : '')
      + (branchId ? '\nShop: ' + branchName() : '')
      + '\n\nThe stock leaves now. It comes back when you mark the lending returned.', function () {
    var btn = document.getElementById('saleSubmitBtn'); btn.disabled = true;
    var args = { items: items.map(function (i) { return { product_id: i.product_id, qty: i.qty, price: Math.max(0, i.price - (i.discount || 0)), unit_ids: i.unit_ids }; }),
      borrower_name: name, borrower_phone: phone, borrower_email: email };
    if (branchId) args.branch_id = branchId;
    srv('recordLending', args).then(function (r) {
      showToast(r.message || 'Lending recorded.', '🤝');
      btn.disabled = false;
      BO.reload('dashboard'); BO.reload('lendings');
      load('<div class="alert-success" style="font-size:.9rem;">🤝 ' + esc(r.message || 'Lending recorded.') + ' — <strong>' + fmtFull(grandTotal) + ' ' + cur() + '</strong> with ' + esc(name) + '</div>');
    }).catch(function (e) { btn.disabled = false; document.getElementById('saleMsg').innerHTML = '<div class="alert-danger">' + esc(e.message) + '</div>'; });
    });
  }
  function g(id) { var e = document.getElementById(id); return e ? e.value : ''; }

  function branchName() { for (var i = 0; i < opts.branches.length; i++) if (opts.branches[i].id === branchId) return opts.branches[i].name; return ''; }

  BO.tabs.sale = { load: load };
  return { load: load, pick: pick, unitToggle: unitToggle, calc: calc, grand: grand, addRow: addRow, payChanged: payChanged, branchChanged: branchChanged, submit: submit };
})();
