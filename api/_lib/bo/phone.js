import { badRequest } from './_shared.js';

/* =====================================================================================
   THE NUMBER A CUSTOMER CAN ACTUALLY REACH.
   =====================================================================================
   A shopkeeper types their number the way they say it: 0712 345 678. WhatsApp cannot use that.
   It needs the country code and no leading zero -- 255712345678 -- and given anything else it
   opens a page that says the number is not valid. So a shop that registered the natural way had
   a "Contact seller on WhatsApp" button that led nowhere, on every one of its products, and
   nothing anywhere told it so.

   ONE RULE, HERE, used both when a number is SAVED (registration, the business profile) and
   when the marketplace is BUILT -- so the numbers already in the database the old way start
   working the moment this is deployed, without anybody having to open their profile again.

     +255 712 345 678     -> 255712345678      a plus means it is already whole
     00255712345678       -> 255712345678      00 is how a plus is dialled
     0712 345 678         -> 255712345678      a leading 0 is the country's own prefix: swap it
     712345678            -> 255712345678      the same number with the 0 left off
     255712345678         -> 255712345678      already whole, just without the plus

   WHICH COUNTRY. The shop's currency says: a business that prices in TZS is in Tanzania. A
   currency this list does not know (a shop that prices in dollars) is taken to be at home,
   which for this system is Tanzania -- and the number is shown back to the owner the moment it
   is saved, in full, so a wrong guess is seen and corrected by typing the plus.

   AND IT IS CHECKED. A number for a country on the list must be exactly as long as that
   country's numbers are; anything else must at least be a possible length. One digit short is
   the commonest typing mistake there is, and it used to be saved without a word. */
const DIAL = { TZS: '255', KES: '254', UGX: '256', RWF: '250', BIF: '257' };
const HOME = '255';
/** Country code -> how many digits a whole number has, code included. */
const WHOLE = { '255': 12, '254': 12, '256': 12, '250': 12, '257': 11 };

export function dialCodeOf(currency) { return DIAL[String(currency || '').trim().toUpperCase()] || HOME; }

/** The number as WhatsApp, a dialler and an SMS app all want it: digits only, country code
    first. '' when what was typed cannot be a phone number. */
export function intlDigits(phone, currency) {
  const s = String(phone == null ? '' : phone).trim();
  if (!s) return '';
  let d = s.replace(/\D/g, '');
  if (!d) return '';
  const cc = dialCodeOf(currency);
  if (s.startsWith('+')) { /* whole as typed */ }
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = cc + d.slice(1);
  else if (!d.startsWith(cc) && d.length <= 10) d = cc + d;
  const known = Object.keys(WHOLE).find(k => d.startsWith(k));
  if (known) return d.length === WHOLE[known] ? d : '';
  return d.length >= 10 && d.length <= 15 ? d : '';
}

/** What is stored and shown: '+255712345678'. '' for blank. Throws, in words a shopkeeper can
    act on, for something typed that is not a whole number. */
export function phoneArg(phone, currency) {
  const s = String(phone == null ? '' : phone).trim();
  if (!s) return '';
  const d = intlDigits(s, currency);
  if (!d) {
    throw badRequest('Namba ya simu haijakamilika. Iandike na namba ya nchi, mfano +255 712 345 678. / '
      + 'That phone number is not complete. Write it with the country code, for example +255 712 345 678.');
  }
  return '+' + d;
}
