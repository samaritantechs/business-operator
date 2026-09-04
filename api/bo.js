import { supabase } from './_lib/supabase.js';
import { withApi, resolveSession } from './_lib/auth.js';
import { boApi } from './_lib/bo-core.js';

// POST /api/bo   { token, fn, args }
// Every signed-in read and write of the app (public/index.html) -- one route, one session
// check, every role and vendor rule enforced inside _lib/bo/*.js, which is where the logic
// lives so the whole surface runs under npm test against a fake PostgREST client.
export default withApi(async (req) => {
  if (req.method !== 'POST') { const e = new Error('Method not allowed'); e.status = 405; throw e; }
  const { token, fn, args } = req.body || {};
  const user = await resolveSession(supabase, token);
  return boApi(supabase, user, fn, args);
});
