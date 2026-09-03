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
export const DEFAULT_HINTS = {
  seller: [
    '💡 Your User ID is your login – use it every time you sell.',
    '🛒 Always select product and quantity before submitting.',
    "💰 Cash='Cash', mobile='Lipa Number'.",
    '📦 Check Stock for low products.',
    '🔒 Keep your password safe – never share it.',
    '📥 Download your sales reports from the Reports tab.',
    '🔄 Use Refresh to see the latest numbers.',
    '📋 Use Lendings tab to record and track borrowed items.',
  ],
  admin: [
    '👥 Add or edit users in the Users tab.',
    '📦 Add products, photos or increase stock in the Products tab.',
    '🛍️ Add 1–2 photos per product so it shines in the marketplace.',
    '💰 Record cash payments from sellers in Cash tab.',
    '📊 Seller balances show who owes what today.',
    '📥 Download sales, stock, or cash due reports anytime.',
    '🏷️ Set your Business Type & contact in the Users tab profile.',
    '📋 Use Lendings to record and track borrowed items.',
    '🗑️ Delete sale or lending records directly from the dashboard.',
  ],
  'assistant-admin': [
    '👥 You can manage sellers under your admin.',
    '📦 Check stock levels regularly.',
    '💰 Record cash from sellers in Cash tab.',
    '📊 Dashboard shows business overview.',
  ],
  'assistant-manager': [
    '🏢 View all vendor performance.',
    '📊 Download comprehensive reports in the Reports tab.',
    '💼 Set commission rates in Management tab.',
  ],
  marketplace: [
    '🛍️ Tap any product to view details and contact the seller.',
    '🔍 Search by product name, category or business.',
    '🔥 A flame badge marks the most-viewed products.',
    '📲 Contact a seller directly on WhatsApp.',
    '🆕 New businesses join the marketplace often — check back!',
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
  return (DEFAULT_HINTS[r] || DEFAULT_HINTS.seller).map(m => ({ en: m, sw: '' }));
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

export const WRITES = ['addHints', 'updateHint', 'deleteHint'];
