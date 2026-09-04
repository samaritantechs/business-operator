import { runQuery } from './supabase.js';

/* Who did what, written from the one door every write passes through (boApi). Reads are not
   logged; the payload is never stored whole -- only a few identifying fields. It can never fail
   a save: the insert is fire-and-forget and every error, including the table not existing, is
   swallowed. (The reasoning, at length, is in HOPE PMO's api/_lib/audit.js.) */

const ID_KEYS = ['id', 'sale_id', 'group_id', 'product_id', 'lending_id', 'profile_id', 'vendor_id',
  'branch_id', 'unit_id', 'key', 'reason', 'qty', 'status'];

export function reduceArgs(args) {
  const out = {};
  for (const k of ID_KEYS) if (args && args[k] !== undefined && args[k] !== null) out[k] = typeof args[k] === 'string' ? args[k].slice(0, 80) : args[k];
  if (args && Array.isArray(args.items)) out.items = args.items.length;
  return out;
}

export async function audited(db, user, fn, args, run, nowMs = Date.now()) {
  const t0 = Date.now();
  try {
    const out = await run();
    write(db, user, fn, args, true, Date.now() - t0, nowMs);
    return out;
  } catch (e) {
    write(db, user, fn, args, false, Date.now() - t0, nowMs);
    throw e;
  }
}

function write(db, user, fn, args, ok, ms, nowMs) {
  try {
    const row = {
      at: new Date(nowMs).toISOString(),
      actor_id: user && user.id || null, actor_name: user && user.name || null, actor_role: user && user.role || null,
      vendor_id: (user && user.vendor_id) || (args && args.vendor_id && args.vendor_id !== 'ALL' ? args.vendor_id : null),
      action: fn, ok, ms, detail: reduceArgs(args),
    };
    Promise.resolve(runQuery(() => db.from('audit_log').insert(row), 1)).catch(() => {});
  } catch { /* never */ }
}
