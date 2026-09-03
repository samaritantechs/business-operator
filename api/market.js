import { supabase } from './_lib/supabase.js';
import { withApi } from './_lib/auth.js';
import { marketApi } from './_lib/bo/market.js';

// GET  /api/market                       -> the whole public marketplace, ranked (cached a minute)
// POST /api/market { fn: 'click', args } -> log a product view; { fn: 'hints' } -> visitor tips
// No sign-in: this is the storefront the street QR codes land on.
export default withApi(async (req) => {
  if (req.method === 'GET') return marketApi(supabase, 'market', req.query || {});
  const { fn, args } = req.body || {};
  return marketApi(supabase, fn, args);
});
