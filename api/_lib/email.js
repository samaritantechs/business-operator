/* =====================================================================================
   EMAIL -- Resend, the same provider HOPE PMO uses, over plain fetch. No SDK.
   =====================================================================================
   The Apps Script version sent from MailApp on a Gmail quota. Here every message goes through
   one function so the "email is not configured" case is one honest sentence rather than a
   silent no-op, and so tests can hand in a stub sender and see exactly what would have gone out. */

import { APP_NAME, APP_BY } from './brand.js';

export const FROM_DEFAULT = APP_NAME + ' <onboarding@resend.dev>';

export function emailConfigured() { return !!process.env.RESEND_API_KEY; }

/** Sends one email. Returns { id } on success; throws with a plain message otherwise.
    `deps.fetch` exists for tests. */
export async function sendEmail({ to, subject, html, bcc, replyTo, attachments }, deps = {}) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    const e = new Error('Barua pepe haijawekwa bado. / Email is not configured yet: set RESEND_API_KEY on the deployment (Vercel -> Settings -> Environment Variables).');
    e.status = 400; throw e;
  }
  const from = String(process.env.EMAIL_FROM || '').trim() || FROM_DEFAULT;
  const body = { from, to: Array.isArray(to) ? to : [to], subject, html };
  if (bcc) body.bcc = Array.isArray(bcc) ? bcc : [bcc];
  if (replyTo) body.reply_to = replyTo;
  if (attachments && attachments.length) {
    body.attachments = attachments.map(a => ({ filename: a.filename, content: Buffer.from(a.content).toString('base64') }));
  }
  const f = deps.fetch || fetch;
  const res = await f('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let out = null;
  try { out = await res.json(); } catch { out = null; }
  if (!res.ok) {
    const e = new Error('Email could not be sent: ' + ((out && (out.message || out.error)) || ('HTTP ' + res.status)));
    e.status = 502; throw e;
  }
  return { id: out && out.id };
}

/** The footer every system email carries. */
export function signature() {
  return '<p style="color:#64748B;font-size:12px;margin-top:18px;"><em>' + APP_BY + '</em></p>';
}

/** {name}-style placeholders, exactly as the Apps Script _fillTemplate did. */
export function fillTemplate(tpl, map) {
  let out = String(tpl || '');
  for (const k of Object.keys(map || {})) out = out.split('{' + k + '}').join(map[k] == null ? '' : String(map[k]));
  return out;
}
