/* RECEIPT -- one checkout, on screen, on paper, or pasted into WhatsApp.
   The server holds no receipt; it builds one from the sale when asked (api/_lib/bo/sales.js ->
   saleReceipt), so a receipt can never drift from the sale it came from.

   Three ways out, because a shop counter has three: PRINT for anybody with a printer, COPY for
   the WhatsApp message that is how most of these receipts actually travel, and the screen
   itself, which a customer can photograph. Print is deliberately not the only one -- the
   Android app is a WebView and window.print() does nothing there. */
window.BORcpt = (function () {
  var last = null;

  function open(args) {
    BO.dialog({ title: '🧾 Receipt', body: '<div class="empty">Loading…</div>', size: 'lg' });
    srv('saleReceipt', args).then(function (r) {
      last = r;
      BO.dialog({
        title: '🧾 Receipt',
        body: '<div id="rcptSheet" class="rcpt">' + sheet(r) + '</div>',
        footer: '<button class="btn-secondary" onclick="BORcpt.copy()">📋 Copy</button>'
          + '<button class="btn-secondary" onclick="BORcpt.share()">📤 Share</button>'
          + '<button class="btn-primary" onclick="BORcpt.print()">🖨️ Print</button>',
        size: 'lg',
      });
    }).catch(function (e) {
      BO.dialog({ title: '🧾 Receipt', body: BO.errorBox(e), footer: '<button class="btn-secondary" onclick="BO.closeDialog()">Close</button>' });
    });
  }

  function money(v, cur) { return fmtFull(v) + ' ' + cur; }
  function sheet(r) {
    var h = '';
    if (r.status !== 'completed') {
      h += '<div class="alert-danger" style="margin-bottom:12px;"><strong>' + (r.status === 'cancelled' ? 'CANCELLED' : 'PARTLY CANCELLED') + '</strong>'
        + (r.cancelled_note ? '<div class="small">' + esc(r.cancelled_note) + '</div>' : '') + '</div>';
    }
    h += '<div class="rcpt-hd">'
      + (r.vendor.logo_url ? '<img src="' + esc(r.vendor.logo_url) + '" alt="" class="rcpt-logo">' : '')
      + '<div class="rcpt-biz">' + esc(r.vendor.name) + '</div>'
      + (r.vendor.address ? '<div class="rcpt-sub">' + esc(r.vendor.address) + '</div>' : '')
      + (r.vendor.phone ? '<div class="rcpt-sub">' + esc(r.vendor.phone) + '</div>' : '')
      + (r.branch_name ? '<div class="rcpt-sub">' + esc(r.branch_name) + '</div>' : '')
      + '</div>';

    h += '<div class="rcpt-meta">'
      + row('Receipt', esc(r.receipt_no))
      + row('Date', BO.fmtDT(r.sold_at))
      + row('Served by', esc(r.seller_name))
      + (r.customer_name || r.customer_phone ? row('Customer', esc([r.customer_name, r.customer_phone].filter(Boolean).join(' · '))) : '')
      + '</div>';

    h += '<table class="rcpt-tbl"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>';
    r.items.forEach(function (i) {
      var sub = [i.brand, i.model].filter(Boolean).join(' ');
      /* A cancelled line is struck through and named, not silently dropped: the person holding
         the old slip has to be able to see which of two identical handsets went back. */
      h += '<tr' + (i.cancelled ? ' class="rcpt-void"' : '') + '><td>' + esc(i.product_name)
        + (sub ? '<div class="rcpt-dim">' + esc(sub) + '</div>' : '')
        + (i.imei ? '<div class="rcpt-dim mono">IMEI ' + esc(i.imei) + '</div>' : '')
        + (i.discount ? '<div class="rcpt-dim">less ' + fmtFull(i.discount) + ' each</div>' : '')
        + (i.cancelled ? '<div class="rcpt-dim">CANCELLED' + (i.cancelled_note ? ' \u2014 ' + esc(i.cancelled_note) : '') + '</div>' : '')
        + '</td><td class="num">' + i.qty + '</td><td class="num mono">' + fmtFull(i.price) + '</td><td class="num mono">' + fmtFull(i.total) + '</td></tr>';
    });
    h += '</tbody></table>';

    h += '<div class="rcpt-sum">';
    if (r.discount) {
      h += row('Subtotal', money(r.subtotal, r.currency));
      h += row('Discount', '− ' + money(r.discount, r.currency));
    }
    h += '<div class="rcpt-total"><span>TOTAL</span><span>' + money(r.total, r.currency) + '</span></div>';
    h += row('Payment', esc(r.payment_method) + (r.partner_name ? ' — ' + esc(r.partner_name) : ''));
    h += '</div>';
    h += '<div class="rcpt-foot">Thank you for your business.<br>' + 'Samaritan Industrial by Samaritan Techs' + '</div>';
    return h;
  }
  function row(k, v) { return '<div class="rcpt-row"><span>' + esc(k) + '</span><span>' + v + '</span></div>'; }

  /* Plain text, because that is what goes into a WhatsApp message, and a WhatsApp message is how
     most of these receipts reach the person who bought the thing. */
  function asText() {
    var r = last; if (!r) return '';
    var L = [];
    if (r.status !== 'completed') L.push('*** ' + (r.status === 'cancelled' ? 'CANCELLED' : 'PARTLY CANCELLED') + ' ***', r.cancelled_note, '');
    L.push(r.vendor.name);
    if (r.vendor.address) L.push(r.vendor.address);
    if (r.vendor.phone) L.push(r.vendor.phone);
    if (r.branch_name) L.push(r.branch_name);
    L.push('', 'Receipt: ' + r.receipt_no, 'Date: ' + BO.fmtDT(r.sold_at), 'Served by: ' + r.seller_name);
    if (r.customer_name || r.customer_phone) L.push('Customer: ' + [r.customer_name, r.customer_phone].filter(Boolean).join(' · '));
    L.push('');
    r.items.forEach(function (i) {
      L.push(i.product_name + (i.imei ? ' (IMEI ' + i.imei + ')' : '') + '  ' + i.qty + ' x ' + fmtFull(i.price) + ' = ' + fmtFull(i.total)
        + (i.cancelled ? '   *** CANCELLED' + (i.cancelled_note ? ' - ' + i.cancelled_note : '') + ' ***' : ''));
    });
    L.push('');
    if (r.discount) { L.push('Subtotal: ' + money(r.subtotal, r.currency)); L.push('Discount: -' + money(r.discount, r.currency)); }
    L.push('TOTAL: ' + money(r.total, r.currency));
    L.push('Payment: ' + r.payment_method + (r.partner_name ? ' - ' + r.partner_name : ''));
    L.push('', 'Thank you for your business.');
    return L.join('\n');
  }

  function copy() {
    var t = asText();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () { showToast('Receipt copied.'); }).catch(function () { fallbackCopy(t); });
    } else fallbackCopy(t);
  }
  function fallbackCopy(t) {
    /* An old WebView with no clipboard API still has to hand the text over, so it is put on
       screen selected -- a person can then long-press and copy it themselves. */
    var ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
    showToast(ok ? 'Receipt copied.' : 'Long-press the receipt to copy it.', ok ? '📋' : '⚠️');
  }
  function share() {
    var t = asText();
    if (navigator.share) { navigator.share({ title: 'Receipt ' + (last ? last.receipt_no : ''), text: t }).catch(function () {}); return; }
    /* No share sheet: WhatsApp is where it was going anyway. */
    window.open('https://wa.me/?text=' + encodeURIComponent(t), '_blank');
  }
  function print() {
    /* window.print() is a no-op inside the Android WebView, and a button that silently does
       nothing is worse than no button -- so we say so and leave Copy and Share to do the job. */
    if (androidApp()) { showToast('The app cannot print. Use Copy or Share.', '📤'); return; }
    document.body.classList.add('printing-receipt');
    var done = function () { document.body.classList.remove('printing-receipt'); };
    window.addEventListener('afterprint', done, { once: true });
    setTimeout(done, 8000);            // some browsers never fire afterprint
    window.print();
  }
  function androidApp() { try { return !!(window.SamaritanApp && window.SamaritanApp.versionCode); } catch (e) { return false; } }

  return { open: open, copy: copy, share: share, print: print, asText: asText };
})();
