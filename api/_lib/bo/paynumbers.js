import { rows, insertMany, remove, badRequest, missingTable, notMigrated, text, isManagerLevel, requireVendorUser, AppError } from './_shared.js';
import { requireAdmin } from '../auth.js';

/* =====================================================================================
   LIPA NAMBA -- the numbers a shop is paid on.
   =====================================================================================
   "Lipa Number" has always been a payment method at the till, and the till has never known
   WHICH number: the seller read it off a sticker, or from memory, and the customer typed what
   they heard. A digit wrong and the money goes to a stranger -- and mobile money does not come
   back. So the shop writes its numbers down once, and the system says them:

     at the till    when "Lipa Number" is chosen, the number, the network and THE NAME THE
                    CUSTOMER'S PHONE WILL SHOW are on the seller's screen, with the one habit
                    that prevents a wrong payment: check the name before the PIN;
     on a receipt   of a sale paid that way.

   Up to three (a shop on two networks and a bank till is common; more than that is a list
   nobody reads at a counter). An admin sets them; everybody in the business may read them,
   because the seller is the one who needs them. They are NEVER part of the public marketplace
   (api/_lib/bo/market.js does not read this table): a payment number published to strangers
   is an invitation to send a fake "I have paid" message about it.

   A TABLE OF ITS OWN, not a column on `vendors`, on purpose. The optional columns of a table
   are learnt absent together (_shared.js), so one more of them on `vendors` in a later file
   would have switched the shop's map pin off, ten minutes at a time, on every database that
   had not yet run that file. A table that is not there yet is simply an empty list here, and a
   save that says which file to run.

   COST. One read when a till chooses Lipa Number, and not again for a minute (the page keeps
   the answer that long and no longer: a corrected number has to reach a till that has been
   open all day); one when the profile screen opens. A save is one delete and one insert -- in
   that order, so a save that fails half way leaves NO number rather than an old one beside a
   new one: a till that shows none is safe, a till that shows a retired number is not.

   ONE LIST AT A TIME. The two statements are not one transaction, so two saves at the same
   moment could each delete and then both insert, leaving both lists in the table. The unique
   index of db/RUN-ME-008 (one line per place in a business's list) makes the second insert
   fail whole instead. The same refusal is what answers an insert that ran twice because its
   first answer was lost (runQuery asks again): the table is then asked what it holds, and a
   list that is exactly ours is a save that worked. */
export const MAX_PAY_NUMBERS = 3;
const MIGRATION = 'db/RUN-ME-008';
const UNIQUE_VIOLATION = '23505';              // Postgres: a unique index refused the row (PostgREST passes the code on)
const pick = r => ({ network: r.network, number: r.number, name: r.name });

/** What was typed -> rows to store. A line left wholly empty is no line; a line half filled is
    refused with the box that is missing, because a number with no name is the wrong payment
    this whole screen exists to prevent. */
function clean(list) {
  if (!Array.isArray(list)) throw badRequest('Send the list of pay numbers.');
  const out = [];
  for (const item of list) {
    const network = text(item && item.network) || '', name = text(item && item.name) || '';
    const number = String((item && item.number) == null ? '' : item.number).replace(/[\s-]+/g, '');
    if (!network && !number && !name) continue;
    const line = 'Line ' + (out.length + 1) + ': ';
    if (!network) throw badRequest(line + 'andika mtandao au benki. / say which network or bank it is (M-Pesa, Airtel Money, Mixx by Yas, HaloPesa, a bank…).');
    if (network.length > 30) throw badRequest(line + 'the network name is too long (30 letters at most).');
    if (!/^\d{4,15}$/.test(number)) throw badRequest(line + 'namba si sahihi. / the number must be digits only, 4 to 15 of them, with no letters.');
    if (!name) throw badRequest(line + 'andika jina linaloonekana kwa mteja. / write the name the customer\'s phone shows before they enter their PIN.');
    if (name.length > 60) throw badRequest(line + 'the name is too long (60 letters at most).');
    out.push({ network, number, name });
  }
  if (out.length > MAX_PAY_NUMBERS) throw badRequest('Namba ' + MAX_PAY_NUMBERS + ' tu. / At most ' + MAX_PAY_NUMBERS + ' pay numbers: the ones your sellers actually use.');
  return out;
}

export const FN = {
  /** {} -> { rows: [{ network, number, name }], ready }. Anybody in a business. `ready` is false
      on a database that has not run the migration, so the page can say so instead of showing
      an empty list as if none had been saved. 1 read. */
  payNumbers: async (db, user) => {
    if (isManagerLevel(user.role)) throw badRequest('A manager account has no pay numbers.');
    const vendorId = requireVendorUser(user);
    try {
      const list = await rows(db, 'pay_numbers', q => q.select('id, network, number, name, sort').eq('vendor_id', vendorId).order('sort'));
      return { rows: list.slice(0, MAX_PAY_NUMBERS).map(pick), ready: true };
    } catch (e) {
      if (missingTable(e)) return { rows: [], ready: false };
      throw e;
    }
  },

  /** { numbers: [{ network, number, name }] } -> { rows, message }. Admin, own business. The
      list REPLACES what was there (an empty list clears it): 1 delete + at most 1 insert. */
  setPayNumbers: async (db, user, args) => {
    requireAdmin(user);
    if (isManagerLevel(user.role)) throw badRequest('A manager account has no pay numbers.');
    const vendorId = requireVendorUser(user);
    const list = clean((args || {}).numbers);
    try {
      await remove(db, 'pay_numbers', q => q.eq('vendor_id', vendorId));
      await insertMany(db, 'pay_numbers', list.map((r, i) => ({ vendor_id: vendorId, network: r.network, number: r.number, name: r.name, sort: i })));
    } catch (e) {
      if (missingTable(e)) throw badRequest(notMigrated('the pay numbers', MIGRATION));
      if (String(e && e.code || '') !== UNIQUE_VIOLATION) throw e;
      /* The index refused the insert: another list is in the table, or ours is (see above). Say
         which -- never "saved" over somebody else's list, never "somebody else" over our own. */
      const held = (await FN.payNumbers(db, user)).rows;
      const ours = held.length === list.length && held.every((r, i) => r.network === list[i].network && r.number === list[i].number && r.name === list[i].name);
      if (!ours) throw new AppError(
        'Mtu mwingine amehifadhi Lipa Namba wakati huohuo. Orodha kwenye skrini imesasishwa – iangalie, kisha hifadhi tena kama bado inahitaji kubadilishwa. / '
        + 'Somebody else saved the pay numbers at the same moment. The list on your screen has been refreshed to what is saved – check it, and save again if it still needs changing.', 409);
    }
    return {
      rows: list,
      message: list.length
        ? 'Imehifadhiwa. / Saved – your sellers see ' + (list.length === 1 ? 'this number' : 'these numbers') + ' at the till when they choose Lipa Number.'
        : 'Imeondolewa. / Cleared – no pay number is shown at the till.',
    };
  },
};
export const WRITES = ['setPayNumbers'];
