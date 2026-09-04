import { getSettings, setSetting, SETTING_KEYS, text, badRequest } from './_shared.js';
import { requireManager } from '../auth.js';

/* =====================================================================================
   SETTINGS -- the manager's global knobs, one key/value row each.
   =====================================================================================
   The Apps Script version had a setter per key (setLoadingTime, setAutoSyncSeconds, ...) and
   each silently coerced nonsense to a default. Here there is ONE setter with the whitelist
   and the rule for each key in one place, and a value that breaks the rule is refused with a
   sentence rather than quietly replaced. Per-vendor keys (restricted_X, currency_X, ...) are
   gone: those live on the vendor row now. */

/* Integer keys: [min, max, what to call it]. The floors are what the page's inputs promise
   (auto-sync under 5 s would hammer the database; a hint that lives 0 s never shows). */
const INT_RULES = {
  hintLifetime: [1, null, 'Hint lifetime (seconds)'],
  hintInterval: [10, null, 'Hint interval (seconds)'],
  sessionTimeoutMinutes: [0, null, 'Session timeout (minutes)'],
  loadingTime: [0, 10, 'Loading time (seconds)'],
  trialDays: [0, null, 'Trial days'],
};

function intArg(v, min, max, label) {
  const s = String(v == null ? '' : v).trim();
  const n = Number(s);
  if (!s || !Number.isInteger(n)) throw badRequest(label + ' must be a whole number.');
  if (n < min) throw badRequest(label + ' must be at least ' + min + '.');
  if (max != null && n > max) throw badRequest(label + ' must be at most ' + max + '.');
  return n;
}

/** The stored string for a key, or a badRequest. */
function validateSetting(key, value) {
  if (!SETTING_KEYS.includes(key)) throw badRequest('Unknown setting: ' + key);
  if (INT_RULES[key]) { const [min, max, label] = INT_RULES[key]; return String(intArg(value, min, max, label)); }
  if (key === 'autoSyncSeconds') {
    const n = intArg(value, 0, null, 'Auto-sync (seconds)');
    if (n > 0 && n < 5) throw badRequest('Auto-sync is 0 (off) or at least 5 seconds.');
    return String(n);
  }
  if (key === 'commissionRate') {
    const n = Number(String(value == null ? '' : value).trim());
    if (!Number.isFinite(n) || n < 0) throw badRequest('Commission rate must be a number of 0 or more (percent).');
    return String(n);
  }
  if (key === 'FreeRegistration') {
    const s = text(value);
    if (s !== 'Yes' && s !== 'No') throw badRequest("Free registration is 'Yes' or 'No'.");
    return s;
  }
  if (key === 'announcement_enabled') return yesNo(value);
  // Message templates and the announcement fields: any text, blank allowed (blank = default).
  return String(value == null ? '' : value).trim();
}

const yesNo = v => (v === true || /^(yes|true|1)$/i.test(String(v == null ? '' : v).trim())) ? 'Yes' : 'No';

export const FN = {
  async settingsGet(db, user) {
    requireManager(user);
    return { settings: await getSettings(db) };
  },

  async settingSet(db, user, args) {
    requireManager(user);
    const key = String(args.key == null ? '' : args.key).trim();
    await setSetting(db, key, validateSetting(key, args.value));
    return { message: 'Setting saved.' };
  },

  /** The "What's New" popup. `version` is the clock, so a device that has dismissed one
      announcement shows the next: the page remembers the version it closed. Five keys, five
      upserts -- a manager action rare enough that one trip per key is fine. */
  async setAnnouncement(db, user, args, nowMs) {
    requireManager(user);
    await setSetting(db, 'announcement_title', text(args.title) || "What's New");
    await setSetting(db, 'announcement_text', String(args.text == null ? '' : args.text).trim());
    await setSetting(db, 'announcement_enabled', yesNo(args.enabled));
    await setSetting(db, 'announcement_audience', text(args.audience) || 'both');
    await setSetting(db, 'announcement_version', String(nowMs));
    return { message: 'Announcement saved.' };
  },
};

export const WRITES = ['settingSet', 'setAnnouncement'];
