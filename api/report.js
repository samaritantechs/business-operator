import { supabase } from './_lib/supabase.js';
import { withApi, readTicket, loadUser } from './_lib/auth.js';
import { reportFile } from './_lib/bo/reports.js';

// GET /api/report?t=TICKET
// A report as a real file (PDF or .xlsx). The ticket was minted by reportTicket() for exactly
// one report and dies after five minutes -- a plain GET the phone's download manager can fetch,
// with no session token in the URL. Opens in a new tab, like the old app.
export default withApi(async (req, res) => {
  if (req.method !== 'GET') { const e = new Error('Method not allowed'); e.status = 405; throw e; }
  const payload = readTicket(req.query && req.query.t);
  const user = await loadUser(supabase, payload.uid);
  if (!user || !user.active) { const e = new Error('Please sign in again.'); e.status = 401; throw e; }
  const file = await reportFile(supabase, user, payload.report || {});
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', (file.inline ? 'inline' : 'attachment') + '; filename="' + file.filename.replace(/["\r\n]/g, '') + '"');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(Buffer.from(file.bytes));
});
