/* THE PRODUCT NAME, IN ONE PLACE.
   It appears on the sign-in screen, in every email, on every PDF footer and in the WhatsApp
   message a marketplace visitor sends a shop. It was scattered as a literal across a dozen
   files, which is why renaming it was a search-and-replace instead of an edit. It is not any
   more. APP_NAME can also be overridden per deployment without touching the code. */
export const APP_NAME = String(process.env.APP_NAME || '').trim() || 'Samaritan Industrial';
export const COMPANY = 'Samaritan Techs';
export const APP_TAGLINE = 'Smart business management & marketplace';
/** "Samaritan Industrial - Samaritan Techs", the way the emails and PDFs sign off. */
export const APP_BY = APP_NAME + ' \u2013 ' + COMPANY;
