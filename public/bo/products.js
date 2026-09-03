/* PRODUCTS -- the catalogue: add, edit, photos, activate, restock. Serialized products (phones
   with an IMEI) are added here and get their units under Stock & Shops. */
window.BOProd = (function () {
  var list = [], pendingPhoto = null;

  function load() {
    var el = document.getElementById('productsContent'); if (!el) return;
    if (!isAdmin()) { el.innerHTML = '<div class="empty">Only the business admin manages products.</div>'; return; }
    el.innerHTML = '<div class="empty">Loading…</div>';
    srv('products', { include_inactive: true }).then(function (r) { list = r.rows || []; render(el); }).catch(function (e) { el.innerHTML = BO.errorBox(e); });
  }
  function shopSelect(id, label) {
    if (!S.features.has_branches || !S.branches.length) return '';
    return '<div class="form-group"><label class="form-label">' + label + '</label><select class="form-select" id="' + id + '"><option value="">— No shop —</option>' + S.branches.map(function (b) { return '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>'; }).join('') + '</select></div>';
  }
  function render(el) {
    var h = '<div class="section-card" style="margin-bottom:18px;"><div class="section-hdr"><span>➕</span><div class="section-hdr-title">Add New Product</div></div><div class="section-body"><div class="form-grid">'
      + '<div class="form-group" style="grid-column:span 2;"><label class="form-label">Name</label><input class="form-control" id="newProdName"></div>'
      + '<div class="form-group"><label class="form-label">Category</label><input class="form-control" id="newProdCat" placeholder="e.g. Phones"></div>'
      + '<div class="form-group"><label class="form-label">Brand</label><input class="form-control" id="newProdBrand" placeholder="e.g. Samsung"></div>'
      + '<div class="form-group"><label class="form-label">Model</label><input class="form-control" id="newProdModel" placeholder="e.g. A05"></div>'
      + '<div class="form-group"><label class="form-label">Price</label><input class="form-control" type="number" id="newProdPrice" min="0"></div>'
      + '<div class="form-group"><label class="form-label">Stock</label><input class="form-control" type="number" id="newProdStock" min="0" value="0"></div>'
      + '<div class="form-group"><label class="form-label">Reorder Pt</label><input class="form-control" type="number" id="newProdReorder" value="20" min="0"></div>'
      + '<div class="form-group"><label class="form-label">Type</label><select class="form-select" id="newProdType"><option value="Sale">For Sale</option><option value="Rent">For Rent</option></select></div>'
      + '<div class="form-group"><label class="form-label">Price Unit (rent)</label><select class="form-select" id="newProdUnit"><option value="">—</option><option value="per day">per day</option><option value="per week">per week</option><option value="per month">per month</option><option value="per event">per event</option></select></div>'
      + '<div class="form-group"><label class="form-label">Location (optional)</label><input class="form-control" id="newProdLoc" placeholder="e.g. Kariakoo, Dar"></div>'
      + shopSelect('newProdBranch', 'Opening stock at shop')
      + '<div class="form-group"><label class="form-label">&nbsp;</label><label class="form-check-label" style="display:flex;align-items:center;gap:8px;"><input type="checkbox" id="newProdSerial" onchange="BOProd.serialToggle()"> Track each unit by IMEI / serial</label></div>'
      + '<button class="btn-primary" onclick="BOProd.add()">+ Add</button></div>'
      + '<div class="small muted" style="margin-top:8px;">💡 After adding, tap <strong>Edit</strong> on the product to upload a marketplace photo. For IMEI-tracked products, add the units under <strong>Stock &amp; Shops</strong>.</div></div></div>';
    h += '<div class="section-card" style="margin-bottom:18px;"><div class="section-hdr"><span>📦</span><div class="section-hdr-title">All Products</div><div class="small muted" style="margin-left:auto;">Inactive shown — reactivate anytime</div></div><div style="padding:0;"><div class="table-wrap"><table class="bo-table"><thead><tr><th>Photo</th><th>ID</th><th>Name</th><th>Brand / Model</th><th>Category</th><th>Price</th><th>Stock</th><th>Reorder</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    if (!list.length) h += '<tr><td colspan="10" class="empty">No products yet — add your first one above.</td></tr>';
    list.forEach(function (p, i) {
      var thumb = p.image1_url ? '<img src="' + esc(p.image1_url) + '" style="width:34px;height:34px;border-radius:7px;object-fit:cover;" onerror="this.style.display=\'none\'">' : '<div style="width:34px;height:34px;border-radius:7px;background:var(--surface2);display:flex;align-items:center;justify-content:center;color:var(--muted);">🛍️</div>';
      var stock = p.is_serialized ? (p.units_in_stock != null ? p.units_in_stock : p.stock) : p.stock;
      h += '<tr style="opacity:' + (p.active ? '1' : '0.6') + '"><td>' + thumb + '</td><td class="mono small muted">' + esc(p.legacy_id || '') + '</td><td style="font-weight:600;">' + esc(p.name) + (p.listing_type === 'Rent' ? ' <span class="badge badge-low">Rent</span>' : '') + (p.is_serialized ? ' <span class="badge badge-seller">IMEI</span>' : '') + '</td><td class="muted">' + esc([p.brand, p.model].filter(Boolean).join(' ')) + '</td><td class="muted">' + esc(p.category || '') + '</td><td class="mono">' + fmtFull(p.price) + '</td><td>' + stock + '</td><td>' + p.reorder_point + '</td><td>' + (p.active ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-inactive">Inactive</span>') + '</td><td style="white-space:nowrap;">' + (p.active ? '<button class="btn-sm-primary" onclick="BOProd.edit(' + i + ')">Edit</button> ' : '') + '<button class="btn-sm-' + (p.active ? 'warning' : 'success') + '" onclick="BOProd.toggle(\'' + esc(p.id) + '\',' + (p.active ? 'false' : 'true') + ')">' + (p.active ? 'Deactivate' : 'Activate') + '</button></td></tr>';
    });
    h += '</tbody></table></div></div></div>';
    var restockable = list.filter(function (p) { return p.active && !p.is_serialized; });
    h += '<div class="section-card"><div class="section-hdr"><span>🔄</span><div class="section-hdr-title">Add Stock to Existing Product</div></div><div class="section-body"><div class="form-grid"><div class="form-group" style="grid-column:span 2;"><label class="form-label">Product</label><select id="restockProd" class="form-select"><option value="">Select…</option>' + restockable.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + ' (stock ' + p.stock + ')</option>'; }).join('') + '</select></div><div class="form-group"><label class="form-label">Qty to Add</label><input class="form-control" type="number" id="restockQty" min="1"></div>' + shopSelect('restockBranch', 'Shop') + '<div class="form-group"><label class="form-label">Note (optional)</label><input class="form-control" id="restockNote" placeholder="e.g. supplier delivery"></div><button class="btn-primary" onclick="BOProd.restock()">Add Stock</button></div><div class="small muted" style="margin-top:8px;">IMEI-tracked products are restocked by adding units under Stock &amp; Shops.</div></div></div>';
    el.innerHTML = h;
  }
  function serialToggle() { var on = document.getElementById('newProdSerial').checked, st = document.getElementById('newProdStock'); st.disabled = on; if (on) st.value = 0; }
  function g(id) { var e = document.getElementById(id); return e ? e.value : ''; }
  function add() {
    var n = g('newProdName').trim(), c = g('newProdCat').trim(), p = g('newProdPrice'), s = g('newProdStock');
    if (!n || !c || p === '') { alert('Fill in at least the name, category and price.'); return; }
    var serial = document.getElementById('newProdSerial').checked;
    if (!BO.confirm('Add "' + n + '"' + (serial ? ' (IMEI-tracked)' : ' with ' + (s || 0) + ' units') + '?')) return;
    var args = { name: n, category: c, brand: g('newProdBrand').trim(), model: g('newProdModel').trim(), price: Number(p), stock: serial ? 0 : Number(s || 0), reorder_point: Number(g('newProdReorder') || 20), listing_type: g('newProdType'), price_unit: g('newProdUnit'), location: g('newProdLoc').trim(), is_serialized: serial };
    var br = g('newProdBranch'); if (br) args.branch_id = br;
    srv('addProduct', args).then(function (r) { showToast('Product ' + (r.product.legacy_id || '') + ' added! Tap Edit to add a photo.'); load(); }).catch(BO.fail);
  }
  function toggle(id, active) { srv('toggleProduct', { id: id, active: active }).then(function (r) { showToast(r.message); load(); }).catch(BO.fail); }
  function restock() {
    var pid = g('restockProd'), qty = g('restockQty');
    if (!pid || !qty) { alert('Select product and enter quantity.'); return; }
    var sel = document.getElementById('restockProd'), pname = sel.options[sel.selectedIndex].text;
    if (!BO.confirm('Add ' + qty + ' units to ' + pname + '?')) return;
    var args = { product_id: pid, qty: Number(qty), note: g('restockNote').trim() }; var br = g('restockBranch'); if (br) args.branch_id = br;
    srv('addStock', args).then(function (r) { showToast(r.message); load(); }).catch(BO.fail);
  }

  var MODAL = '<div class="modal fade" id="editProductModal" tabindex="-1"><div class="modal-dialog modal-dialog-centered modal-dialog-scrollable"><div class="modal-content">'
    + '<div class="modal-header"><h5 class="modal-title">Edit Product</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>'
    + '<div class="modal-body"><input type="hidden" id="editProdId">'
    + '<div class="form-group" style="margin-bottom:12px;"><label class="form-label">Product Name</label><input class="form-control" id="editProdName"></div>'
    + '<div class="fg2" style="margin-bottom:12px;"><div class="form-group"><label class="form-label">Category</label><input class="form-control" id="editProdCat"></div><div class="form-group"><label class="form-label">Brand</label><input class="form-control" id="editProdBrand"></div></div>'
    + '<div class="fg2" style="margin-bottom:12px;"><div class="form-group"><label class="form-label">Model</label><input class="form-control" id="editProdModel"></div><div class="form-group"><label class="form-label">Price</label><input type="number" class="form-control" id="editProdPrice"></div></div>'
    + '<div class="fg2" style="margin-bottom:12px;"><div class="form-group" id="editProdStockWrap"><label class="form-label">Stock QTY</label><input type="number" class="form-control" id="editProdStock"></div><div class="form-group"><label class="form-label">Reorder Point</label><input type="number" class="form-control" id="editProdReorder"></div></div>'
    + '<div class="fg2" style="margin-bottom:12px;"><div class="form-group"><label class="form-label">Type</label><select class="form-select" id="editProdType"><option value="Sale">For Sale</option><option value="Rent">For Rent</option></select></div><div class="form-group"><label class="form-label">Price Unit (rent)</label><select class="form-select" id="editProdUnit"><option value="">—</option><option value="per day">per day</option><option value="per week">per week</option><option value="per month">per month</option><option value="per event">per event</option></select></div></div>'
    + '<div class="form-group" style="margin-bottom:14px;"><label class="form-label">Location (optional)</label><input class="form-control" id="editProdLoc" placeholder="e.g. Kariakoo, Dar"></div>'
    + '<label class="form-label">Marketplace Photo</label><div class="prod-img-slot" onclick="document.getElementById(\'prodImg1Input\').click()"><img id="prodImg1Preview" src="" style="display:none;"><div id="prodImg1Ph" class="muted small">📷 Add photo</div></div><input type="file" id="prodImg1Input" accept="image/*" style="display:none;" onchange="BOProd.previewImage(this)"><div id="prodImgMsg" class="small muted" style="margin-top:8px;"></div></div>'
    + '<div class="modal-footer"><button class="btn-secondary" data-bs-dismiss="modal">Cancel</button><button class="btn-primary" onclick="BOProd.save()">Save Changes</button></div></div></div></div>';

  function edit(i) {
    var p = list[i]; if (!p) return;
    BO.ensureModal('editProductModal', MODAL);
    var set = function (id, v) { document.getElementById(id).value = v == null ? '' : v; };
    set('editProdId', p.id); set('editProdName', p.name); set('editProdCat', p.category); set('editProdBrand', p.brand); set('editProdModel', p.model); set('editProdPrice', p.price); set('editProdStock', p.stock); set('editProdReorder', p.reorder_point); set('editProdType', p.listing_type === 'Rent' ? 'Rent' : 'Sale'); set('editProdUnit', p.price_unit || ''); set('editProdLoc', p.location || '');
    document.getElementById('editProdStockWrap').style.display = p.is_serialized ? 'none' : '';
    pendingPhoto = null; document.getElementById('prodImgMsg').textContent = '';
    var img = document.getElementById('prodImg1Preview'), ph = document.getElementById('prodImg1Ph');
    if (p.image1_url) { img.src = p.image1_url; img.style.display = 'block'; ph.style.display = 'none'; } else { img.style.display = 'none'; ph.style.display = ''; }
    openModal('editProductModal');
  }
  function previewImage(input) {
    BO.fileToDataUrl(input, function (dataUrl, err) {
      if (!dataUrl) { showToast(err || 'Could not read the photo.', '⚠️'); return; }
      pendingPhoto = dataUrl; var img = document.getElementById('prodImg1Preview'); img.src = dataUrl; img.style.display = 'block'; document.getElementById('prodImg1Ph').style.display = 'none';
    });
  }
  function save() {
    var id = g('editProdId');
    var args = { id: id, name: g('editProdName').trim(), category: g('editProdCat').trim(), brand: g('editProdBrand').trim(), model: g('editProdModel').trim(), price: Number(g('editProdPrice')), reorder_point: Number(g('editProdReorder') || 0), listing_type: g('editProdType'), price_unit: g('editProdUnit'), location: g('editProdLoc').trim() };
    if (document.getElementById('editProdStockWrap').style.display !== 'none') args.stock = Number(g('editProdStock'));
    srv('updateProduct', args).then(function () {
      if (!pendingPhoto) { closeModal('editProductModal'); load(); return; }
      document.getElementById('prodImgMsg').textContent = 'Uploading photo…';
      return srv('uploadProductImage', { product_id: id, slot: 1, data_url: pendingPhoto }).then(function () { closeModal('editProductModal'); load(); });
    }).catch(function (e) { document.getElementById('prodImgMsg').textContent = ''; BO.fail(e); });
  }

  BO.tabs.products = { load: load, sync: load };
  return { load: load, add: add, toggle: toggle, restock: restock, edit: edit, save: save, previewImage: previewImage, serialToggle: serialToggle };
})();
