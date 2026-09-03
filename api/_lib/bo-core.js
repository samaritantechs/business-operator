import { badRequest, forbidden, isManagerLevel } from './auth.js';
import { audited } from './audit.js';
import * as products from './bo/products.js';
import * as sales from './bo/sales.js';
import * as lendings from './bo/lendings.js';
import * as cash from './bo/cash.js';
import * as dashboard from './bo/dashboard.js';
import * as users from './bo/users.js';
import * as vendors from './bo/vendors.js';
import * as reports from './bo/reports.js';
import * as emails from './bo/emails.js';
import * as hints from './bo/hints.js';
import * as settings from './bo/settings.js';
import * as stockops from './bo/stockops.js';
import * as boot from './bo/boot.js';

/* =====================================================================================
   ONE DOOR. Every signed-in call the app makes is { token, fn, args } to /api/bo, and every
   fn lives in one of the modules above as FN[name] = (db, user, args, nowMs) => result.
   Each module also names its WRITES -- the functions that change something -- because three
   rules hang on that list:

     1. a RESTRICTED vendor (unpaid) is refused every write here, at the server, whatever
        the page shows -- the banner is a courtesy, this is the lock;
     2. writes are audited (api/_lib/audit.js); reads are not;
     3. the browser busts its remembered answers after a write.

   A name registered twice is a startup error, not a silent override. */

const MODULES = { products, sales, lendings, cash, dashboard, users, vendors, reports, emails, hints, settings, stockops, boot };
export const FN = {};
export const WRITE_FNS = new Set();
export const FN_MODULE = {};
for (const [modName, m] of Object.entries(MODULES)) {
  for (const [name, handler] of Object.entries(m.FN || {})) {
    if (FN[name]) throw new Error('bo-core: function "' + name + '" is registered by both ' + FN_MODULE[name] + ' and ' + modName);
    FN[name] = handler; FN_MODULE[name] = modName;
  }
  for (const w of (m.WRITES || [])) {
    if (!(m.FN || {})[w]) throw new Error('bo-core: ' + modName + ' lists "' + w + '" as a write but does not define it');
    WRITE_FNS.add(w);
  }
}
export const BO_FUNCTIONS = Object.keys(FN);

/* A restricted vendor may still reach the people who can lift the restriction. */
const RESTRICTED_MAY_STILL = new Set(['suggestion']);

export async function boApi(db, user, fn, args, nowMs = Date.now()) {
  const h = FN[fn];
  if (!h) throw badRequest('Unknown function: ' + fn);
  const a = args || {};
  if (WRITE_FNS.has(fn)) {
    if (user && user.vendor && user.vendor.restricted && !isManagerLevel(user.role) && !RESTRICTED_MAY_STILL.has(fn)) {
      const e = forbidden('Akaunti hii imezuiliwa kwa sasa. / This account is restricted: settle your balance with Samaritan Techs to restore full access. (' + fn + ' was refused.)');
      e.restricted = true;
      throw e;
    }
    return audited(db, user, fn, a, () => h(db, user, a, nowMs), nowMs);
  }
  return h(db, user, a, nowMs);
}
