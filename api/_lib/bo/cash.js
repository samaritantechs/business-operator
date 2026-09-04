import { rows, one, insertOne, money, text, iso, badRequest, forbidden, isAdminLevel, vendorScope,
  requireVendorUser, periodBounds, rangeBounds } from './_shared.js';
import { requireAdmin } from '../auth.js';

/* =====================================================================================
   CASH -- what a seller physically handed the owner.
   =====================================================================================
   A seller's day ends with cash in hand and Lipa Number payments on the owner's phone; the
   owner writes down what was received. The dashboard's seller balance is then plain
   arithmetic: today's cash sales minus today's cash received = cash still due (and the same
   for Lipa). This module is only the writing-down and the reading-back; the balance lives in
   dashboard.js. The old CashTracking sheet had no vendor check on the seller -- an admin could
   record a receipt against anybody's seller id. Now the seller must be one of the admin's own. */

const COLS = 'id, vendor_id, seller_id, cash_amount, lipa_amount, note, recorded_by, received_at';

export const FN = {
  /** Admin of a business only. Cost: 1 profiles read + 1 insert. */
  recordCash: async (db, user, args, nowMs) => {
    if (!isAdminLevel(user.role)) throw forbidden('Hujaruhusiwa. / Only a business admin records cash received.');
    const vendorId = requireVendorUser(user);
    const seller = await one(db, 'profiles', q => q.select('id, name, role, vendor_id, active').eq('id', String(args.seller_id || '')).eq('vendor_id', vendorId));
    if (!seller || seller.role !== 'seller' || !seller.active) throw badRequest('Pick an active seller of your business.');
    const cash = money(args.cash_amount), lipa = money(args.lipa_amount);
    if (cash < 0 || lipa < 0) throw badRequest('Amounts cannot be negative.');
    if (cash === 0 && lipa === 0) throw badRequest('Enter a cash or Lipa Number amount.');
    await insertOne(db, 'cash_receipts', {
      vendor_id: vendorId, seller_id: seller.id, cash_amount: cash, lipa_amount: lipa,
      note: text(args.note), recorded_by: user.id, received_at: iso(nowMs),
    });
    return { message: 'Payment recorded successfully.' };
  },

  /** Admin: own vendor. Manager: vendor_id or every vendor. Today (EAT) unless a range is
      given; newest first, at most 1000. Cost: 1 receipts read + 1 profiles read for names. */
  cashReceipts: async (db, user, args, nowMs) => {
    requireAdmin(user);
    const vendorId = vendorScope(user, args);
    const sellerId = text(args.seller_id);
    let from, to;
    if (text(args.start) || text(args.end)) {
      const r = rangeBounds(args.start || args.end, args.end || args.start);
      from = r.from; to = r.to;
    } else {
      const b = periodBounds(nowMs);
      from = b.today; to = b.tomorrow;
    }
    const list = await rows(db, 'cash_receipts', q => {
      let s = q.select(COLS).gte('received_at', from).lt('received_at', to);
      if (vendorId) s = s.eq('vendor_id', vendorId);
      if (sellerId) s = s.eq('seller_id', sellerId);
      return s.order('received_at', { ascending: false }).limit(1000);
    });
    const ids = [...new Set(list.map(r => r.seller_id).filter(Boolean))];
    const people = ids.length ? await rows(db, 'profiles', q => q.select('id, name, handle').in('id', ids)) : [];
    return {
      rows: list.map(r => {
        const p = people.find(x => String(x.id) === String(r.seller_id));
        return { ...r, cash_amount: money(r.cash_amount), lipa_amount: money(r.lipa_amount), seller_name: p ? p.name : '', seller_handle: p ? p.handle : '' };
      }),
    };
  },
};

export const WRITES = ['recordCash'];
