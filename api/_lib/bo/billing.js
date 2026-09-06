import {
  rows, rowsAll, one, insertOne, update, count, badRequest, notFound, text, mustText, num, money, int, iso,
  getSettings, missingTable, commissionInvoice, cyclePeriod, currencyOf, trialDays, trialDaysRemaining, todayKey, addDaysKey, eatStart,
} from './_shared.js';
import { requireManager } from '../auth.js';

/* =====================================================================================
   COMMISSION INVOICES, AND THE BLOCK THAT FOLLOWS AN UNPAID ONE.
   =====================================================================================
   THE ASYMMETRY THAT DECIDES EVERY CHOICE IN THIS FILE.

   A restricted vendor is refused every write in bo-core -- recordSale included. A wrongly
   blocked shop cannot sell. Mid-morning. With a customer at the counter.

     block a day LATE  -> the owner waits a day for 0.6% of one shop's one day.
                          On a 2,000,000 TZS day that is 12,000 TZS.
     block a day EARLY -> the shop loses 100% of a day's trade, the owner loses the customer
                          permanently, and every shop that hears about it.

   That is roughly 150:1 against blocking. So blocking is the last, slowest, most-guarded thing
   this system does, it is never a side effect of issuing an invoice, and every guard below
   fails CLOSED -- when something cannot be determined, nobody is blocked.

   WHY INVOICES ARE STORED. vendors.registered_on is reset when a vendor is reactivated, and
   every period is anchored on it -- so a recomputed invoice moves the moment somebody toggles a
   vendor. A document a business keeps cannot do that. Storing it also means the block needs one
   indexed read rather than a sales scan per vendor. */

const COLS = 'id, number, vendor_id, period_start, period_end, sales_total, rate, due, currency, status, amount_paid, paid_at, paid_method, paid_reference, paid_by, waived_reason, issued_at, blocked_at, unblocked_at';
const OPEN = ['unpaid', 'part_paid'];
const MAX_INVOICES = 1000;

const NEEDS_TABLE = 'Jedwali la invoices halipo. Endesha db/RUN-ME-004-invoices.sql kwenye Supabase. / '
  + 'The invoices table is not in this database yet — run db/RUN-ME-004-invoices.sql in the Supabase SQL editor.';

/** Every guard number in one place, so the block and the screen that explains it cannot drift. */
export async function billingSettings(db) {
  const s = await getSettings(db, ['commissionRate', 'trialDays', 'autoBlockEnabled', 'invoiceGraceDays', 'minInvoiceAmount']);
  return {
    ...s,
    autoBlock: text(s.autoBlockEnabled) === 'Yes',
    graceDays: Math.max(0, int(s.invoiceGraceDays)),
    minAmount: Math.max(0, num(s.minInvoiceAmount)),
    rate: num(s.commissionRate) > 0 ? num(s.commissionRate) : 0,
  };
}

/** Outstanding on one invoice. Never negative: an overpayment is not a credit note. */
export function outstandingOf(inv) { return Math.max(0, money(num(inv.due) - num(inv.amount_paid))); }

/** The instant an invoice becomes blockable: the END of the period it bills, plus the grace.
    Counted from the period, NOT from when it was issued -- a run that happens late must not
    shorten anybody's week. */
export function dueAt(inv, graceDays) {
  return new Date(eatStart(addDaysKey(todayKey(new Date(inv.period_end).getTime()), Math.max(0, graceDays)))).getTime();
}

async function listInvoices(db, build) {
  try { return await rows(db, 'invoices', build); }
  catch (e) { if (missingTable(e)) return null; throw e; }
}

export const FN = {
  /** Manager: the invoice book, newest first, with what the guards would currently do. */
  async invoices(db, user, args, nowMs) {
    requireManager(user);
    const s = await billingSettings(db);
    const list = await listInvoices(db, q => {
      let x = q.select(COLS);
      if (text(args && args.vendor_id)) x = x.eq('vendor_id', text(args.vendor_id));
      if (text(args && args.status)) x = x.eq('status', text(args.status));
      return x.order('period_start', { ascending: false }).limit(MAX_INVOICES);
    });
    if (list === null) return { rows: [], missing_table: true, notice: NEEDS_TABLE, settings: s };
    return {
      rows: list.map(i => ({ ...i, outstanding: outstandingOf(i), due_at: iso(dueAt(i, s.graceDays)) })),
      settings: s,
    };
  },

  /** Manager: issue an invoice for every CLOSED period a vendor has not been invoiced for.
      Trips: settings 1, vendors 1, invoices 1, then one sales read per eligible vendor. */
  async issueInvoices(db, user, args, nowMs) {
    requireManager(user);
    const s = await billingSettings(db);
    if (s.rate <= 0) return { message: 'Commission rate is 0, so there is nothing to invoice. Set it in Management first.', issued: 0, rows: [] };

    const existing = await listInvoices(db, q => q.select('vendor_id, period_start, number').limit(MAX_INVOICES));
    if (existing === null) throw badRequest(NEEDS_TABLE);
    const seen = new Set(existing.map(i => i.vendor_id + '|' + new Date(i.period_start).getTime()));

    const vendors = await rowsAll(db, 'vendors', q => q.select('id, name, legacy_name, registered_on, active, restricted, currency').eq('active', true));
    const days = trialDays(s);
    const made = [], skipped = [];
    for (const v of vendors) {
      const left = trialDaysRemaining(v.registered_on, days, nowMs);
      if (left != null && left > 0) { skipped.push({ vendor: v.name, why: 'still on trial (' + left + ' days left)' }); continue; }
      /* THE PERIOD BEING INVOICED IS THE ONE THAT HAS CLOSED, never the one running now.
         Invoicing a period still in progress bills a shop for a month it has not finished
         trading, and the figure would move under them afterwards -- which is the whole thing an
         invoice must never do. One millisecond before the current period opened is inside the
         previous one, whatever length that month happened to be. */
      const cur = cyclePeriod(v.registered_on, nowMs);
      const closed = await commissionInvoice(db, v, s, cur.start.getTime() - 1);
      const key = v.id + '|' + new Date(eatStart(closed.period_start)).getTime();
      if (seen.has(key)) { skipped.push({ vendor: v.name, why: 'already invoiced for ' + closed.period_start }); continue; }
      if (closed.due <= 0) { skipped.push({ vendor: v.name, why: 'nothing owed for ' + closed.period_start }); continue; }
      const row = await insertOne(db, 'invoices', {
        number: closed.number, vendor_id: v.id,
        period_start: eatStart(closed.period_start),
        period_end: eatStart(addDaysKey(closed.period_end, 1)),
        sales_total: closed.sales_total, rate: closed.rate, due: closed.due, currency: closed.currency,
        status: 'unpaid', amount_paid: 0, issued_at: iso(nowMs),
      });
      made.push(row);
      seen.add(key);
    }
    return {
      message: made.length + ' invoice(s) issued.' + (skipped.length ? ' ' + skipped.length + ' skipped.' : ''),
      issued: made.length, rows: made, skipped,
    };
  },

  /** Manager: somebody paid. The reference is REQUIRED -- with no payment rail it is the only
      trace that the money arrived, and "they said they paid" is not a record. */
  async recordInvoicePayment(db, user, args, nowMs) {
    requireManager(user);
    const id = mustText(args.id, 'Which invoice');
    const amount = money(args.amount);
    if (!(amount > 0)) throw badRequest('Enter the amount that was actually paid.');
    const method = mustText(args.method, 'How it was paid');
    const reference = mustText(args.reference, 'The payment reference (M-Pesa / Tigo Pesa / bank id)');
    const inv = await oneInvoice(db, id);
    if (inv.status === 'waived') throw badRequest('That invoice was waived, so there is nothing to pay.');
    const paid = money(num(inv.amount_paid) + amount);
    const status = paid >= num(inv.due) ? 'paid' : 'part_paid';
    const [row] = await update(db, 'invoices', {
      amount_paid: paid, status, paid_at: iso(nowMs), paid_method: method,
      paid_reference: reference, paid_by: user.name || '',
    }, q => q.eq('id', inv.id));
    const un = await releaseIfClear(db, inv.vendor_id, nowMs);
    return { message: 'Recorded ' + amount + '. ' + (status === 'paid' ? 'Invoice settled.' : 'Part payment; a balance remains.')
      + (un ? ' The account has been unblocked.' : ''), invoice: row || { ...inv, amount_paid: paid, status }, unblocked: un };
  },

  /** Manager: write it off. The pressure valve for "they paid me last week and I forgot to tick
      it" -- which keeps the record truthful instead of inviting a fake payment entry. */
  async waiveInvoice(db, user, args, nowMs) {
    requireManager(user);
    const id = mustText(args.id, 'Which invoice');
    const reason = mustText(args.reason, 'Why it is being waived');
    const inv = await oneInvoice(db, id);
    const [row] = await update(db, 'invoices', { status: 'waived', waived_reason: reason, paid_by: user.name || '', paid_at: iso(nowMs) }, q => q.eq('id', inv.id));
    const un = await releaseIfClear(db, inv.vendor_id, nowMs);
    return { message: 'Invoice waived.' + (un ? ' The account has been unblocked.' : ''), invoice: row || inv, unblocked: un };
  },

  /** Manager: apply the guards. Blocks nobody unless every one of them passes, and unblocks
      anybody the invoice book says should no longer be blocked.
      Trips: settings 1, invoices 1, vendors 1, then one update per vendor actually changed --
      and NO sales read at all, because the amount is on the invoice row. */
  async runAutoBlock(db, user, args, nowMs) {
    requireManager(user);
    const s = await billingSettings(db);
    const open = await listInvoices(db, q => q.select(COLS).in('status', OPEN).order('period_start').limit(MAX_INVOICES));
    if (open === null) return { message: NEEDS_TABLE, missing_table: true, blocked: 0, unblocked: 0, would_block: [] };

    const vendors = await rowsAll(db, 'vendors', q => q.select('id, name, registered_on, active, restricted').limit(MAX_INVOICES));
    const byId = new Map(vendors.map(v => [String(v.id), v]));
    const days = trialDays(s);

    /* WHO QUALIFIES. Every condition is a separate line on purpose: when somebody asks why a
       shop was blocked, the answer has to be readable. */
    const due = [];
    for (const inv of open) {
      const v = byId.get(String(inv.vendor_id));
      if (!v) continue;                                            // vendor gone: never block a ghost
      if (!v.active) continue;                                     // already switched off; blocking adds nothing
      const left = trialDaysRemaining(v.registered_on, days, nowMs);
      if (left != null && left > 0) continue;                      // on trial: nothing is owed yet
      if (nowMs < dueAt(inv, s.graceDays)) continue;               // still inside the grace period
      const out = outstandingOf(inv);
      if (out < s.minAmount) continue;                             // never lock a till over small change
      due.push({ inv, vendor: v, outstanding: out });
    }

    const toBlock = due.filter(d => !d.vendor.restricted);
    /* A RUN THAT WANTS TO BLOCK EVERYBODY IS A BUG, NOT A COLLECTION. If a rate was fat-fingered
       or a period boundary moved, the first symptom is a long list. Blocking none of them and
       reporting the list is recoverable; blocking twenty shops is not. */
    const cap = Math.max(1, int((args && args.max) || 3));
    const tooMany = toBlock.length > cap;

    let blocked = 0;
    if (s.autoBlock && !tooMany) {
      for (const d of toBlock) {
        await update(db, 'vendors', { restricted: true }, q => q.eq('id', d.vendor.id));
        await update(db, 'invoices', { blocked_at: iso(nowMs) }, q => q.eq('id', d.inv.id));
        blocked++;
      }
    }

    /* UNBLOCKING IS NOT GATED ON autoBlockEnabled. Turning the feature off must release the
       people it blocked, not strand them -- and somebody who has paid gets their till back
       whatever the setting says. Only vendors this system blocked are released: a manual
       restriction is somebody's decision and is left alone. */
    let unblocked = 0;
    const stillOwing = new Set(due.map(d => String(d.vendor.id)));
    for (const v of vendors) {
      if (!v.restricted || stillOwing.has(String(v.id))) continue;
      const mine = open.concat([]).find(i => String(i.vendor_id) === String(v.id) && i.blocked_at && !i.unblocked_at);
      const everBlocked = mine || await wasBlockedByUs(db, v.id);
      if (!everBlocked) continue;                                  // restricted by hand: not ours to undo
      await update(db, 'vendors', { restricted: false }, q => q.eq('id', v.id));
      await update(db, 'invoices', { unblocked_at: iso(nowMs) }, q => q.eq('vendor_id', v.id).is('unblocked_at', null).not('blocked_at', 'is', null));
      unblocked++;
    }

    return {
      message: (s.autoBlock
        ? (tooMany
          ? 'REFUSED: ' + toBlock.length + ' vendors would have been blocked at once, which is more than the limit of ' + cap + '. Nobody was blocked. Check the commission rate and the invoice list before running again.'
          : blocked + ' blocked')
        : 'Automatic blocking is OFF, so nobody was blocked. ' + toBlock.length + ' vendor(s) would qualify.')
        + (unblocked ? ', ' + unblocked + ' unblocked' : '') + '.',
      enabled: s.autoBlock, blocked, unblocked, refused_too_many: tooMany, cap,
      would_block: toBlock.map(d => ({ vendor: d.vendor.name, invoice: d.inv.number, outstanding: d.outstanding, since: iso(dueAt(d.inv, s.graceDays)) })),
    };
  },
};

async function oneInvoice(db, id) {
  let inv;
  try { inv = await one(db, 'invoices', q => q.select(COLS).eq('id', id)); }
  catch (e) { throw missingTable(e) ? badRequest(NEEDS_TABLE) : e; }
  if (!inv) throw notFound('That invoice does not exist.');
  return inv;
}

async function wasBlockedByUs(db, vendorId) {
  const hit = await listInvoices(db, q => q.select('id').eq('vendor_id', vendorId).not('blocked_at', 'is', null).limit(1));
  return !!(hit && hit.length);
}

/** Clear the restriction if this vendor has nothing left past its grace date. Called after a
    payment or a waiver so the till comes back in the same breath as the money. */
async function releaseIfClear(db, vendorId, nowMs) {
  const s = await billingSettings(db);
  const open = await listInvoices(db, q => q.select(COLS).eq('vendor_id', vendorId).in('status', OPEN).limit(MAX_INVOICES));
  if (open === null) return false;
  const stillDue = open.some(i => nowMs >= dueAt(i, s.graceDays) && outstandingOf(i) >= s.minAmount);
  if (stillDue) return false;
  if (!(await wasBlockedByUs(db, vendorId))) return false;
  const [v] = await update(db, 'vendors', { restricted: false }, q => q.eq('id', vendorId).eq('restricted', true));
  if (!v) return false;
  await update(db, 'invoices', { unblocked_at: iso(nowMs) }, q => q.eq('vendor_id', vendorId).is('unblocked_at', null).not('blocked_at', 'is', null));
  return true;
}

export const WRITES = ['issueInvoices', 'recordInvoicePayment', 'waiveInvoice', 'runAutoBlock'];
