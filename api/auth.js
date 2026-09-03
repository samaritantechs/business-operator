import { supabase } from './_lib/supabase.js';
import { withApi } from './_lib/auth.js';
import { accountApi } from './_lib/bo/account.js';

// POST /api/auth   { fn: 'login' | 'register' | 'requestReset' | 'resetPassword' | 'logout' | 'me', args }
// The doors that exist before there is a session. `me` takes a token and answers "who am I,
// what do I see" -- the app's boot payload -- so a returning device restores in one trip.
export default withApi(async (req) => {
  if (req.method !== 'POST') { const e = new Error('Method not allowed'); e.status = 405; throw e; }
  const { fn, args } = req.body || {};
  return accountApi(supabase, fn, args, Date.now(), { userAgent: req.headers['user-agent'] });
});
