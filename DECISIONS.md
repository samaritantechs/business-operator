# DECISIONS — Business Operator v2

Routine calls made while building, so nobody has to re-derive them. Newest at the bottom.

1. **Where it lives.** A self-contained `business-operator/` folder inside `hope-pmo-v2`, mirroring
   HOPE PMO's layout file-for-file (`public/` no-build pages, `api/` Vercel functions, `api/_lib/`
   logic, `db/`, `test/` with the same fake PostgREST, `migrate/`). Deploy it as its **own Vercel
   project** with *Root Directory = `business-operator`*. When a separate GitHub repo is wanted,
   `git subtree split -P business-operator` lifts it out unchanged.
2. **Its own database.** A **third Supabase project, `business-operator`**, in the same org as
   `hope-pmo` and `hoop-pmo`, same region (eu-west-1), start on micro. Nothing here reads or writes
   the HOPE or HOOP databases; the only credentials it knows are its own `SUPABASE_URL` and
   service-role key, set on its own Vercel project.
3. **HOPE PMO's conventions win over the handoff's defaults** (the handoff says so): plain HTML +
   inline JS with no build step instead of Next.js; the service-role key on the server enforcing
   roles itself instead of Supabase Auth + RLS; Resend for email over plain `fetch`; `npm test` as
   the gate; the Postgres budget rule; the hints-table rule.
4. **Passwords and sessions.** Legacy plaintext passwords are hashed (scrypt) by the migration, so
   nobody resets. Login mints a session token (30 days) the browser keeps instead of the password.
   Reset links are `APP_URL/?reset=TOKEN`, 10 minutes, one use.
5. **Restriction is enforced at the server**, not only drawn: a restricted vendor's users get 403
   on every write (feedback excepted). The old app only dimmed the screen.
6. **`assistant-admin` = `admin`** everywhere. The old UI hid Products/Cash/Reports from assistant
   admins while its backend allowed them; the handoff describes the role as "same vendor scope as
   admin, delegated staff", so the UI now matches that.
7. **Seller permission flags are honoured.** `dashboardVisible=false` hides the seller's dashboard
   (they land on Sell); `sellerCanDownloadReport=true` gives sellers a Reports tab with their own
   sales report. The old code stored these flags and never read them.
8. **Deleting a sale is now cancelling it** (requirement #9): status `cancelled`, who/when/why,
   stock restored through a `cancelled_restock` movement, seller still notified by email.
9. **Every stock change writes a `stock_movements` row** through one function
   (`api/_lib/bo/stock.js: changeStock`). That table *is* requirement #10.
10. **Branches are optional; per-branch quantities live in `branch_stock`** for non-serialized
    products (serialized units carry their own `branch_id`). A vendor with no branches behaves
    exactly as before.
11. **Serialized products** (`is_serialized`) hold their stock as a maintained count of
    `product_units` in stock; checkout names the unit(s). Non-serialized products are untouched.
12. **Credit sales follow the hoop/hooploan model**: the sale is revenue; the financing partner
    owes the shop. `sales.partner_paid` lets the shop tick when the partner has settled, and the
    "sales by financing partner" report shows settled vs outstanding. Partners are a small
    admin-editable list (like HOPE Loan's `carriers`), vendor-scoped or global.
13. **Discounts** are per unit and never change `list_price`: `price = list_price − discount`,
    `total = qty × price`.
14. **Reports are real files** (PDF via pdf-lib, .xlsx via a 150-line dependency-free writer),
    served by a plain GET with a 5-minute signed ticket so the phone's download manager and the
    old APK's new-tab handler both work, and no session token ever sits in a URL.
15. **Desktop/mobile toggle is pure CSS** (`html.bo-desktop`), no reload — the `?view=` iframe
    trick and the 2-second boot loader are gone (loading time defaults to 0 and stays editable).
16. **Time is East Africa Time** everywhere, via HOPE's `time.js`.
17. **Images**: new uploads go to Supabase Storage (`product-images`, `logos`, `profile-photos`,
    public). Old `drive.google.com/thumbnail` URLs are kept as they are.
18. **No Supabase Auth**: `profiles` is our own table, so the migration can keep every legacy
    handle/email pair and the `manager` accounts need no vendor.
