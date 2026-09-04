/** ONE home for every "what day is it" decision, replacing the per-file copies that used
    to live in dashboard.js and defaulters.js.

    Vercel's serverless runtime runs in UTC; HOPE runs in Africa/Dar_es_Salaam (UTC+3, no DST
    anywhere in East Africa, so a fixed offset is correct here and does not drift). Reading the
    date or the weekday straight off `new Date()` therefore returns the WRONG DAY for the first
    three hours of every Tanzanian day: at 01:00 EAT on a Monday the server is still on Sunday,
    so today's Received Payments came back empty and the defaulter weekday resolved to SUN.

    Every function takes an optional epoch-ms `nowMs` so tests can pin the clock to any instant
    (including the midnight-EAT edge) without monkey-patching Date. */

export const TZ_OFFSET_MS = 3 * 60 * 60 * 1000;   // Africa/Dar_es_Salaam

export function localNow(nowMs = Date.now()) { return new Date(nowMs + TZ_OFFSET_MS); }

/** yyyy-mm-dd of "today" on the EAT clock. */
export function todayKey(nowMs) { return localNow(nowMs).toISOString().slice(0, 10); }

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** 'MON'..'SUN' on the EAT clock -- getUTCDay on the shifted clock = the local weekday. */
export function currentWeekday(nowMs) { return DAYS[localNow(nowMs).getUTCDay()]; }

/** 'MON'..'SUN' for a yyyy-mm-dd KEY -- the weekday a chosen date actually falls on.

    The date and its weekday are ONE fact, and letting a person state them separately means
    letting them disagree: a Tuesday deck stamped MON files itself under Monday, breaks
    Monday's recovery pairing and hides itself from Tuesday. So the date decides, and this is
    where it decides. Read at noon UTC so no offset can tip the answer onto a neighbouring
    day. Returns null for anything that is not a real date key. */
export function weekdayOfKey(key) {
  const k = String(key == null ? '' : key).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return null;
  const t = Date.parse(k + 'T12:00:00Z');
  if (!Number.isFinite(t)) return null;
  return DAYS[new Date(t).getUTCDay()];
}

/** ISO weekday on the EAT clock: Mon=1 .. Sun=7. This is what the recovery-basis rule keys
    off, same convention as isoWeekdayToday in the live system's app.html. */
export function isoWeekday(nowMs) {
  const d = localNow(nowMs).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Pure date-key arithmetic: 'yyyy-mm-dd' plus n days, no timezone involved. */
export function addDaysKey(key, n) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the current EAT week -- the anchor for every 'week' aggregate (weekend
    dashboard, week-bounded sales, the Sat/Sun recovery denominator). */
export function weekMondayKey(nowMs) { return addDaysKey(todayKey(nowMs), 1 - isoWeekday(nowMs)); }
