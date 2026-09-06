import { rows, insertMany, update, remove, count, text, mustText, badRequest, notFound } from './_shared.js';
import { requireManager } from '../auth.js';

/* =====================================================================================
   HINTS -- the bilingual rotating tips.
   =====================================================================================
   One table, six roles plus 'all' and 'marketplace'. Every screen asks for ITS role's rows
   (plus 'all') through hintsForRole(); when the table has nothing for a role the legacy
   built-in list answers instead, exactly as the Apps Script getHintSettingsForUser did, so a
   fresh database is never silent. The manager edits the table from the Settings tab. */

export const HINT_ROLES = ['seller', 'admin', 'assistant-admin', 'manager', 'assistant-manager', 'all', 'marketplace'];

/* Copied verbatim from legacy/Code.gs getHintSettingsForUser. `manager` had no list of its own
   there either -- an unknown role reads the seller's, which is what the old app showed. */
/* Every hint is a PAIR now. The tips were English-only and the Swahili side was the empty
   string, so the EN/SW toggle in the top bar changed the flag on the button and nothing else --
   in a country where Kiswahili is the working language of most shop counters. A hint a seller
   cannot read is not a hint.

   And six screens arrived without any: Holds, Purchase Orders, Credit & Voids, the receipt
   button, the Profit report and the cost price it needs. A feature nobody is told about is a
   feature nobody uses, which is the same as not having shipped it.

   A manager can still replace the whole list from Settings; these are what a database with no
   hints of its own shows. */
export const DEFAULT_HINTS = {
  seller: [
    ['\ud83d\udca1 Your User ID is your login \u2013 use it every time you sell.',
     '\ud83d\udca1 Namba yako ya mtumiaji ndiyo unayoingia nayo \u2013 itumie kila unapouza.'],
    ['\ud83d\uded2 Always select product and quantity before submitting.',
     '\ud83d\uded2 Chagua bidhaa na idadi kabla ya kutuma.'],
    ["\ud83d\udcb0 Cash='Cash', mobile='Lipa Number'.",
     "\ud83d\udcb0 Fedha taslimu='Cash', simu='Lipa Number'."],
    ['\ud83d\udce6 Check Stock for low products.',
     '\ud83d\udce6 Angalia Stoo kuona bidhaa zinazokaribia kuisha.'],
    ['\ud83d\udd12 Keep your password safe \u2013 never share it.',
     '\ud83d\udd12 Tunza neno lako la siri \u2013 usimpe mtu yeyote.'],
    ['\ud83d\udce5 Download your sales reports from the Reports tab.',
     '\ud83d\udce5 Pakua ripoti za mauzo yako kwenye kichupo cha Ripoti.'],
    ['\ud83d\udd04 Use Refresh to see the latest numbers.',
     '\ud83d\udd04 Bonyeza Onyesha upya kuona namba za sasa.'],
    ['\ud83d\udccb Use Lendings tab to record and track borrowed items.',
     '\ud83d\udccb Tumia kichupo cha Mikopo ya bidhaa kurekodi na kufuatilia vilivyoazimwa.'],
    ['\ud83e\uddfe After a sale, tap the receipt button to print it or send it on WhatsApp.',
     '\ud83e\uddfe Baada ya mauzo, bonyeza risiti kuichapisha au kuituma kwa WhatsApp.'],
    ['\ud83d\udd16 Customer coming back on Friday? Put it on Holds so nobody sells it.',
     '\ud83d\udd16 Mteja atarudi Ijumaa? Weka kwenye Zilizowekwa ili asiuziwe mtu mwingine.'],
    ['\ud83e\udd1d Goods leaving unsold? Choose Lending at the till instead of a sale.',
     '\ud83e\udd1d Bidhaa zinatoka bila kuuzwa? Chagua Mkopo wa bidhaa badala ya mauzo.'],
    ['\ud83d\udc64 Add the customer\u2019s name and phone \u2013 it puts them on the receipt.',
     '\ud83d\udc64 Andika jina na simu ya mteja \u2013 huonekana kwenye risiti.'],
  ],
  admin: [
    ['\ud83d\udc65 Add or edit users in the Users tab.',
     '\ud83d\udc65 Ongeza au hariri watumiaji kwenye kichupo cha Watumiaji.'],
    ['\ud83d\udce6 Add products, photos or increase stock in the Products tab.',
     '\ud83d\udce6 Ongeza bidhaa, picha au stoo kwenye kichupo cha Bidhaa.'],
    ['\ud83d\udecd\ufe0f Add 1\u20132 photos per product so it shines in the marketplace.',
     '\ud83d\udecd\ufe0f Weka picha 1\u20132 kwa kila bidhaa ionekane vizuri sokoni.'],
    ['\ud83d\udcb0 Record cash payments from sellers in Cash tab.',
     '\ud83d\udcb0 Rekodi fedha unazopokea kwa wauzaji kwenye kichupo cha Fedha.'],
    ['\ud83d\udcca Seller balances show who owes what today.',
     '\ud83d\udcca Salio la muuzaji linaonyesha nani anadaiwa nini leo.'],
    ['\ud83c\udff7\ufe0f Set a Cost Price on each product \u2013 without it the Profit report is only a guess.',
     '\ud83c\udff7\ufe0f Weka Bei ya kununulia kwa kila bidhaa \u2013 bila hiyo ripoti ya Faida ni kubahatisha.'],
    ['\ud83d\udcc8 The Profit report shows what you EARNED, not just what you took.',
     '\ud83d\udcc8 Ripoti ya Faida inaonyesha ulichopata, si tu ulichokusanya.'],
    ['\ud83d\ude9a Order stock on Purchase Orders \u2013 receiving it updates the cost price for you.',
     '\ud83d\ude9a Agiza bidhaa kwenye Oda za manunuzi \u2013 zikipokelewa bei ya kununulia inajisasisha.'],
    ['\ud83d\udcb3 Credit & Voids shows what financing partners still owe you.',
     '\ud83d\udcb3 Mikopo na Zilizofutwa inaonyesha wanaokukopesha wanachokudai.'],
    ['\ud83d\uddd1\ufe0f Cancel a sale from the dashboard \u2013 the stock goes back on the shelf.',
     '\ud83d\uddd1\ufe0f Futa mauzo kwenye dashibodi \u2013 bidhaa zinarudi stoo.'],
    ['\ud83d\udccb Use Lendings to record and track borrowed items.',
     '\ud83d\udccb Tumia Mikopo ya bidhaa kurekodi na kufuatilia vilivyoazimwa.'],
    ['\ud83d\udce5 Download sales, stock, profit or cash due reports anytime.',
     '\ud83d\udce5 Pakua ripoti za mauzo, stoo, faida au madeni wakati wowote.'],
    ['\ud83d\udcf1 Selling phones? Register each handset by IMEI under Phone Vending, then sell that exact one.',
     '\ud83d\udcf1 Unauza simu? Sajili kila simu kwa IMEI kwenye Phone Vending, kisha uuze ile ile hasa.'],
    ['\ud83c\udfe6 Financing partners (MOGO, Watu) live under Phone Vending \u2013 pick one when you sell on credit.',
     '\ud83c\udfe6 Wafadhili wa mikopo (MOGO, Watu) wako kwenye Phone Vending \u2013 chagua mmoja unapouza kwa mkopo.'],
  ],
  'assistant-admin': [
    ['\ud83d\udc65 You can manage sellers under your admin.',
     '\ud83d\udc65 Unaweza kusimamia wauzaji walio chini ya msimamizi wako.'],
    ['\ud83d\udce6 Check stock levels regularly.',
     '\ud83d\udce6 Kagua kiwango cha stoo mara kwa mara.'],
    ['\ud83d\udcb0 Record cash from sellers in Cash tab.',
     '\ud83d\udcb0 Rekodi fedha kutoka kwa wauzaji kwenye kichupo cha Fedha.'],
    ['\ud83d\udcca Dashboard shows business overview.',
     '\ud83d\udcca Dashibodi inaonyesha muhtasari wa biashara.'],
    ['\ud83d\ude9a Receive a delivery on Purchase Orders \u2013 enter what actually arrived, not what was ordered.',
     '\ud83d\ude9a Pokea bidhaa kwenye Oda za manunuzi \u2013 andika zilizofika kweli, si zilizoagizwa.'],
    ['\ud83d\udd16 Holds keep stock off the shelf for a customer who is coming back.',
     '\ud83d\udd16 Zilizowekwa huhifadhi bidhaa kwa mteja atakayerudi.'],
    ['\ud83d\udcf1 Handsets tracked one by one live under Phone Vending, not Stock & Shops.',
     '\ud83d\udcf1 Simu zinazofuatiliwa moja moja ziko kwenye Phone Vending, si Stock & Shops.'],
  ],
  'assistant-manager': [
    ['\ud83c\udfe2 View all vendor performance.',
     '\ud83c\udfe2 Angalia utendaji wa biashara zote.'],
    ['\ud83d\udcca Download comprehensive reports in the Reports tab.',
     '\ud83d\udcca Pakua ripoti kamili kwenye kichupo cha Ripoti.'],
    ['\ud83d\udcbc Set commission rates in Management tab.',
     '\ud83d\udcbc Weka viwango vya kamisheni kwenye kichupo cha Usimamizi.'],
  ],
  marketplace: [
    ['\ud83d\udecd\ufe0f Tap any product to view details and contact the seller.',
     '\ud83d\udecd\ufe0f Bonyeza bidhaa yoyote kuona maelezo na kuwasiliana na muuzaji.'],
    ['\ud83d\udd0d Search by product name, category or business.',
     '\ud83d\udd0d Tafuta kwa jina la bidhaa, aina au biashara.'],
    ['\ud83d\udd25 A flame badge marks the most-viewed products.',
     '\ud83d\udd25 Alama ya moto inaonyesha bidhaa zinazotazamwa zaidi.'],
    ['\ud83d\udcf2 Contact a seller directly on WhatsApp.',
     '\ud83d\udcf2 Wasiliana na muuzaji moja kwa moja kwa WhatsApp.'],
    ['\ud83c\udd95 New businesses join the marketplace often \u2014 check back!',
     '\ud83c\udd95 Biashara mpya zinajiunga mara kwa mara \u2014 rudi tena!'],
  ],
};

const HINT_COLS = 'id, role, message_en, message_sw, active, sort, created_at';
// A hint list is a few dozen rows at most; the bound is there so a runaway import cannot make
// every boot carry it.
const MAX_HINTS = 500;

/** [{ en, sw }] for a role (+ 'all'), with the legacy built-in defaults when the table has none. */
export async function hintsForRole(db, role) {
  const r = text(role) || 'seller';
  const list = await rows(db, 'hints', q => q.select('message_en, message_sw').in('role', [r, 'all']).eq('active', true)
    .order('sort', { ascending: true }).order('id', { ascending: true }).limit(MAX_HINTS));
  if (list.length) return list.map(h => ({ en: String(h.message_en || '').trim(), sw: String(h.message_sw || '').trim() }));
  return (DEFAULT_HINTS[r] || DEFAULT_HINTS.seller).map(m => ({ en: m[0], sw: m[1] || '' }));
}

function roleArg(v) {
  const r = text(v);
  if (!r || !HINT_ROLES.includes(r)) throw badRequest('Pick a hint role: ' + HINT_ROLES.join(', ') + '.');
  return r;
}

export const FN = {
  /** Manager: every row, grouped by role. Everybody else: the live rows their screen rotates. */
  async hints(db, user) {
    if (user.is_manager) {
      return { rows: await rows(db, 'hints', q => q.select(HINT_COLS).order('role', { ascending: true }).order('sort', { ascending: true }).limit(MAX_HINTS)) };
    }
    return { rows: await rows(db, 'hints', q => q.select(HINT_COLS).in('role', [user.role, 'all']).eq('active', true)
      .order('sort', { ascending: true }).limit(MAX_HINTS)) };
  },

  /** Bulk add, as the Settings tab's textarea does: one row per line, blank lines skipped. */
  async addHints(db, user, args, nowMs) {
    requireManager(user);
    const list = Array.isArray(args.rows) ? args.rows : [];
    const made = [];
    for (const item of list) {
      const en = text(item && item.en);
      if (!en) continue;                                  // legacy skipped blank messages silently
      made.push({ role: roleArg(item.role), message_en: en, message_sw: text(item && item.sw) || '', active: true });
    }
    if (!made.length) throw badRequest('No hints to add.');
    // New rows sort after everything already there, keeping the manager's order of entry.
    const base = await count(db, 'hints', q => q);
    made.forEach((r, i) => { r.sort = base + i; r.created_at = new Date(nowMs).toISOString(); });
    await insertMany(db, 'hints', made);
    return { message: made.length + ' hint(s) added.' };
  },

  /** {} -> { message }. Writes the built-in list into the table, once, so a manager can SEE the
      tips their staff are reading and edit or delete them one at a time.

      WHY THIS EXISTS. The defaults live in code, so Manage Hints showed an empty list while
      thirty-eight tips rotated on the screens -- which reads as "there are no hints". And
      hintsForRole returns the table's rows INSTEAD of the defaults the moment a role has one,
      so saving a single seller hint silently removed the other twelve. After this, a role's
      tips are all in one place and adding a thirteenth adds rather than erases.

      NOTHING CHANGES ON SCREEN when it runs: the rows written are the defaults themselves, so
      every role serves exactly what it served before. That is what makes it safe to press. */
  async loadDefaultHints(db, user, args, nowMs) {
    requireManager(user);
    /* ONE PRESS ONLY. A second would double every tip, and a manager who could not tell whether
       the first worked is exactly the person who presses again. Refusing on ANY existing row --
       not just a duplicate of one of these -- also means this can never overwrite or interleave
       with a list somebody has already curated. */
    const existing = await count(db, 'hints', q => q);
    if (existing) {
      throw badRequest('There are already ' + existing + ' hint(s) in the list, so the built-in tips '
        + 'have not been loaded again. Delete the list first if you want to start over.');
    }
    const made = [];
    for (const role of HINT_ROLES) {
      for (const [en, sw] of (DEFAULT_HINTS[role] || [])) {
        made.push({
          role, message_en: en, message_sw: sw || '', active: true,
          sort: made.length, created_at: new Date(nowMs).toISOString(),
        });
      }
    }
    if (!made.length) throw badRequest('There are no built-in tips to load.');
    await insertMany(db, 'hints', made);
    return { message: made.length + ' built-in tips loaded. They are the same tips your staff were '
      + 'already seeing — you can now edit or delete them one by one.', count: made.length };
  },

  async updateHint(db, user, args) {
    requireManager(user);
    const id = mustText(args.id, 'Hint id');
    const patch = { role: roleArg(args.role), message_en: mustText(args.en, 'The English message') };
    if (args.sw !== undefined && args.sw !== null) patch.message_sw = text(args.sw) || '';
    const hit = await update(db, 'hints', patch, q => q.eq('id', id));
    if (!hit.length) throw notFound('Hint not found.');
    return { message: 'Updated.' };
  },

  async deleteHint(db, user, args) {
    requireManager(user);
    const id = mustText(args.id, 'Hint id');
    const gone = await remove(db, 'hints', q => q.eq('id', id));
    if (!gone.length) throw notFound('Hint not found.');
    return { message: 'Deleted.' };
  },
};

export const WRITES = ['addHints', 'loadDefaultHints', 'updateHint', 'deleteHint'];
