# lendings.js + cash.js — notes for the integrator

Files: `api/_lib/bo/lendings.js`, `api/_lib/bo/cash.js`, `test/lendings.test.mjs`, `test/cash.test.mjs`.
No shared file was changed. Everything below is either a heads-up or a small ask for another module.

## For emails.js (Email Center)
- `sendRemindersFor(db, vendorId, nowMs, deps)` is implemented: `vendorId` null = every vendor, returns
  `{ sent, no_email }`. Pass `{ fetch }` in `deps` for tests; it falls back to `lendings.deps.fetch`, then
  global fetch.
- It considers up to 1000 Active lendings per call (a bounded `.in` on their ids follows; paging past that
  would make the URL unwieldy). Nobody has 1000 open lendings; if that ever changes, page by vendor.
- A provider refusal (502 from Resend) skips that borrower, as the old `MailApp` try/catch did. Email NOT
  being configured (no `RESEND_API_KEY`, status 400) is thrown once, honestly, instead of "Sent 0".
- A `borrower_email` without an `@` counts as "no email" (`no_email++`), not as a failed send.

## Shape notes (contract is met; these are additions the page may ignore)
- `lendings` rows also carry `branch_id`; each item also carries `unit_id`. Everything in the contract is
  there, snake_case, `grand_total = Σ item.total`.
- `imei` on an item is read from `product_units` (the item row stores `unit_id` only), so the listing does
  ONE extra bounded units read only when a serialized item is in the result. Falls back to `serial_no`.
- Reminder / confirmation item lines are the legacy `qty× name (price each)`; a unit line adds `[IMEI]`
  between the name and the price.

## Stock rules worth knowing
- `recordLending` checks stock at PRODUCT level (`products.stock >= qty`, summed across lines naming the
  same product). It does not check `branch_stock` of the chosen branch, so a lending can push a branch's
  count negative while the vendor total stays right — the same rule the brief gave for sales. If stockops
  wants branch-level refusal for lendings too, it is one `branch_stock` read in the validation loop.
- Validation happens entirely before the first write (products in one `.in` read, units via `claimUnits`,
  a named branch via one `branches` read). A failing line writes nothing.
- On return/delete the header flips to Returned FIRST (filtered on `status = 'Active'`), then stock is
  restored. A retry after a half-done restore therefore cannot restore twice; the trade-off is noted in
  the code.
- Deleting an Active lending writes `returned` movements with note `'Lending deleted'`.
- `claimUnits`'s "choose which unit(s) you are selling" wording also shows for lendings. If stock.js
  ever grows a verb parameter, lendings would pass 'lending'.

## cash.js
- `recordCash` is admin/assistant-admin only (a manager has no vendor to record for). The seller must be
  an active `role = 'seller'` profile of the caller's vendor — the old sheet never checked this.
- `cashReceipts` rows carry `seller_name` and `seller_handle`; amounts come back as numbers. Default
  window is today on the EAT clock (`periodBounds`); `start`/`end` use `rangeBounds` (end inclusive);
  giving only one of them uses it for both.
- The dashboard's seller balance (`cash_received` / `lipa_received` per seller today) is the sum of these
  rows for `received_at` within `periodBounds(nowMs).today .. tomorrow`, grouped by `seller_id` — that
  is all "cash receipts" mean; the legacy `lipaRec === 0 ? stats.lipa` fallback belongs to dashboard.js.

## WRITES
- lendings: `recordLending`, `markLendingReturned`, `deleteLending`, `sendLendingReminder`,
  `sendLendingReminders` (the two reminder sends are actions a restricted vendor should not be able to
  fire, so they are listed as writes and audited).
- cash: `recordCash`.
