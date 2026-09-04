import { rowsAll, getSettings, permissionsOf, currencyOf, vendorsList, vendorSalesSummary, stockValueByVendor,
  commissionDue, restrictionInfo, trialDays, trialDaysRemaining, fmtMoney, todayKey, addDaysKey, eatStart, eatEnd,
  num, PROFILE_COLS } from './_shared.js';
import { requireManager } from '../auth.js';
import { sendEmail, signature } from '../email.js';
import { reportFile } from './reports.js';
import { sendRemindersFor } from './lendings.js';
import { APP_NAME } from '../brand.js';

/* =====================================================================================
   THE EMAIL CENTER -- every outbound message the manager can fire, on demand.
   =====================================================================================
   The Apps Script version ran these off time-driven triggers and a Gmail quota; the manager
   asked for a button instead ("You control all emails"), so each is a function the panel calls
   and each answers with a count. Nothing here schedules itself.

   TWO KINDS OF FAILURE, treated differently on purpose. Email not being configured at all
   (no RESEND_API_KEY) is thrown on the first send, in sendEmail's own words, because "Sent 0"
   would hide a deployment mistake. A provider refusing ONE address is counted as skipped and
   the run carries on, exactly as the old MailApp try/catch did. */

export const deps = { fetch: null };                  // tests capture the Resend calls here
const mailer = () => ({ fetch: deps.fetch || undefined });
const managerEmail = () => process.env.MANAGER_EMAIL || 'samaritantechs@gmail.com';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const notConfigured = e => e && e.status === 400 && /RESEND_API_KEY/.test(String(e.message));

/** Everybody who could receive a business email, in one paged read: active admins and sellers. */
async function people(db) {
  return rowsAll(db, 'profiles', q => q.select(PROFILE_COLS).eq('active', true).in('role', ['admin', 'assistant-admin', 'seller']));
}
/** The vendor's admin: an active 'admin' first, an assistant if that is all there is. */
function adminOf(vendor, list) {
  const mine = list.filter(p => String(p.vendor_id) === String(vendor.id));
  return mine.find(p => p.role === 'admin') || mine.find(p => p.role === 'assistant-admin') || null;
}
/** A user object shaped like resolveSession's, so reportFile draws the report as that admin. */
function userFor(p, vendor) {
  return { ...p, vendor, is_admin: true, is_manager: false };
}
/** The same day one month earlier -- what sendMonthlyReportsToAdmins used. */
function monthAgoKey(key) {
  const d = new Date(key + 'T12:00:00Z');
  const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/* ------------------------------------------------------------------ the period reports
   daily: yesterday -> today; weekly: 7 days; monthly: a month. Each eligible admin gets the
   vendor's PDF sales report attached; on the daily run the vendor's sellers get their own
   one-line summary when the vendor's permission profile says so. Trips: vendors 1, people 1,
   then per eligible vendor the report's own reads (3-4) and, daily, one sales read. */
async function periodReports(db, user, nowMs, kind) {
  requireManager(user);
  const today = todayKey(nowMs);
  const start = kind === 'daily' ? addDaysKey(today, -1) : kind === 'weekly' ? addDaysKey(today, -7) : monthAgoKey(today);
  const vendors = await vendorsList(db);
  const list = await people(db);
  let admins = 0, sellers = 0, skipped = 0;
  for (const v of vendors) {
    const perms = permissionsOf(v);
    const admin = adminOf(v, list);
    const wants = kind === 'daily' ? perms.adminReceivesDaily : kind === 'weekly' ? perms.adminReceivesWeekly : perms.adminReceivesMonthly;
    if (admin && admin.email && wants) {
      try {
        const file = await reportFile(db, userFor(admin, v), { type: 'sales', start, end: today, format: 'pdf' });
        await sendEmail({
          to: admin.email,
          subject: '📊 ' + cap(kind) + ' Sales Report – ' + v.name + ' (' + today + ')',
          html: '<p>Dear ' + esc(admin.name) + ',</p><p>Please find attached your ' + kind + ' sales report for <strong>' + esc(v.name) + '</strong> (' + start + ' – ' + today + ').</p>' + signature(),
          attachments: [{ filename: file.filename, content: file.bytes }],
        }, mailer());
        admins++;
      } catch (e) { if (notConfigured(e)) throw e; skipped++; }
    }
    if (kind === 'daily' && perms.sellerReceivesEmail && perms.sellerReceivesDaily) {
      const mine = list.filter(p => String(p.vendor_id) === String(v.id) && p.role === 'seller' && p.email);
      if (mine.length) {
        const sales = await rowsAll(db, 'sales', q => q.select('seller_id, total').eq('vendor_id', v.id).eq('status', 'completed').gte('sold_at', eatStart(start)).lt('sold_at', eatEnd(today)));
        for (const s of mine) {
          const total = sales.filter(x => String(x.seller_id) === String(s.id)).reduce((a, x) => a + num(x.total), 0);
          try {
            await sendEmail({
              to: s.email, subject: '📋 Your daily Sales Summary – ' + today,
              html: '<p>Dear ' + esc(s.name) + ',</p><p>Your <strong>daily</strong> sales: <strong>' + fmtMoney(total) + ' ' + currencyOf(v) + '</strong></p><p>' + esc(v.name) + ' via ' + APP_NAME + '</p>' + signature(),
            }, mailer());
            sellers++;
          } catch (e) { if (notConfigured(e)) throw e; skipped++; }
        }
      }
    }
  }
  return { message: cap(kind) + ' reports dispatched: ' + admins + ' admin(s)' + (kind === 'daily' ? ', ' + sellers + ' seller(s)' : '') + (skipped ? '; ' + skipped + ' could not be delivered.' : '.'), admins, sellers, skipped };
}

const emailDaily = (db, user, args, nowMs) => periodReports(db, user, nowMs, 'daily');
const emailWeekly = (db, user, args, nowMs) => periodReports(db, user, nowMs, 'weekly');
const emailMonthly = (db, user, args, nowMs) => periodReports(db, user, nowMs, 'monthly');

/* emailCommission -- the invoice for the current billing cycle, to every active vendor whose
   trial is over and who owes something. Trips: settings 1, vendors 1, people 1, per past-trial
   vendor 1 sales read. */
async function emailCommission(db, user, args, nowMs) {
  requireManager(user);
  const settings = await getSettings(db, ['commissionRate', 'trialDays']);
  const rate = num(settings.commissionRate);
  if (rate <= 0) return { message: '0 commission invoice(s) dispatched. (Commission rate is 0.)', sent: 0 };
  const days = trialDays(settings);
  const vendors = await vendorsList(db);
  const list = await people(db);
  let sent = 0, skipped = 0;
  for (const v of vendors) {
    const admin = adminOf(v, list);
    if (!admin || !admin.email) continue;
    const left = trialDaysRemaining(v.registered_on, days, nowMs);
    if (left != null && left > 0) continue;            // still on trial: nothing is owed yet
    const c = await commissionDue(db, v, settings, nowMs);
    if (c.due <= 0) continue;
    const month = new Date(nowMs + 3 * 3600000).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    try {
      await sendEmail({
        to: admin.email, bcc: managerEmail(),
        subject: '💼 Commission Invoice – ' + v.name + ' – ' + month,
        html: '<h2>Commission Notice</h2><p>Dear ' + esc(admin.name) + ',</p>'
          + '<table border="1" cellpadding="6" style="border-collapse:collapse;">'
          + '<tr><th>Total Sales</th><td>' + fmtMoney(c.total) + ' ' + currencyOf(v) + '</td></tr>'
          + '<tr><th>Rate</th><td>' + rate + '%</td></tr>'
          + '<tr><th>Due</th><td><strong>' + fmtMoney(c.due) + ' ' + currencyOf(v) + '</strong></td></tr></table>'
          + '<p>Remit to <strong>Samaritan Techs</strong>.</p>' + signature(),
      }, mailer());
      sent++;
    } catch (e) { if (notConfigured(e)) throw e; skipped++; }
  }
  return { message: sent + ' commission invoice(s) dispatched.' + (skipped ? ' ' + skipped + ' could not be delivered.' : ''), sent, skipped };
}

/* emailPaymentReminders -- the restriction notice, by mail, to every restricted vendor's admin.
   Trips: settings 1, vendors 1, people 1, per restricted vendor the notice's 1 sales read. */
async function emailPaymentReminders(db, user, args, nowMs) {
  requireManager(user);
  const settings = await getSettings(db, ['commissionRate', 'paymentReminderText']);
  const vendors = await vendorsList(db, true);
  const list = await people(db);
  let sent = 0, noEmail = 0, skipped = 0;
  for (const v of vendors) {
    if (!v.restricted) continue;
    const admin = adminOf(v, list);
    if (!admin || !admin.email) { noEmail++; continue; }
    const info = await restrictionInfo(db, v, settings, nowMs, admin.name);
    try {
      await sendEmail({ to: admin.email, bcc: managerEmail(), subject: '🔒 Payment Required – ' + v.name, html: '<p>' + info.notice + '</p>' + signature() }, mailer());
      sent++;
    } catch (e) { if (notConfigured(e)) throw e; skipped++; }
  }
  return {
    message: 'Sent ' + sent + ' payment reminder' + (sent !== 1 ? 's' : '') + ' to restricted account' + (sent !== 1 ? 's' : '') + '.'
      + (noEmail ? ' ' + noEmail + ' restricted vendor' + (noEmail !== 1 ? 's' : '') + ' had no email.' : '')
      + (skipped ? ' ' + skipped + ' could not be delivered.' : ''),
    sent, no_email: noEmail, skipped,
  };
}

/* emailLendingReminders -- every active borrower of every vendor; the lendings module owns
   the template and the sending. */
async function emailLendingReminders(db, user, args, nowMs) {
  requireManager(user);
  const r = await sendRemindersFor(db, null, nowMs, mailer());
  return { message: 'Sent ' + r.sent + ' reminder' + (r.sent !== 1 ? 's' : '') + '.' + (r.no_email ? ' ' + r.no_email + ' borrower' + (r.no_email !== 1 ? 's' : '') + ' had no email.' : ''), ...r };
}

/* emailManagerSummary -- the manager dashboard as a table, to the manager's inbox.
   Trips: vendors 1, sales summary 1, stock 1, people 1. */
async function emailManagerSummary(db, user, args, nowMs) {
  requireManager(user);
  const vendors = await vendorsList(db);
  const summary = await vendorSalesSummary(db, nowMs);
  const stock = await stockValueByVendor(db);
  const list = await people(db);
  const today = todayKey(nowMs);
  let rowsHtml = '';
  for (const v of vendors) {
    const s = summary.get(String(v.id)) || { today: 0, week: 0, month: 0, year: 0 };
    const st = stock.get(String(v.id)) || { value: 0, count: 0 };
    const admin = adminOf(v, list);
    const sellers = list.filter(p => String(p.vendor_id) === String(v.id) && p.role === 'seller').length;
    const c = currencyOf(v);
    rowsHtml += '<tr><td><strong>' + esc(v.name) + '</strong></td><td>' + esc(admin ? admin.name + ' (' + admin.handle + ')' : '–') + '</td>'
      + '<td>' + fmtMoney(s.today) + ' ' + c + '</td><td>' + fmtMoney(s.week) + ' ' + c + '</td><td>' + fmtMoney(s.month) + ' ' + c + '</td><td>' + fmtMoney(s.year) + ' ' + c + '</td>'
      + '<td>' + st.count + '</td><td>' + sellers + '</td><td>' + fmtMoney(st.value) + ' ' + c + '</td></tr>';
  }
  await sendEmail({
    to: managerEmail(), subject: '📊 Daily Vendor Summary – ' + today,
    html: '<h2>' + APP_NAME + ' – Daily Summary</h2><p>' + today + '</p>'
      + '<table border="1" cellpadding="4" style="border-collapse:collapse;"><thead><tr><th>Vendor</th><th>Admin</th><th>Today</th><th>Weekly</th><th>Monthly</th><th>Year</th><th>Products</th><th>Sellers</th><th>Stock Value</th></tr></thead><tbody>'
      + (rowsHtml || '<tr><td colspan="9">No vendors</td></tr>') + '</tbody></table>' + signature(),
  }, mailer());
  return { message: 'Manager summary email sent.', sent: 1 };
}

export const FN = { emailDaily, emailWeekly, emailMonthly, emailCommission, emailPaymentReminders, emailLendingReminders, emailManagerSummary };
export const WRITES = Object.keys(FN);
