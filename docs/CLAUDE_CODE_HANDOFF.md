# BUSINESS OPERATOR → GitHub + Supabase + Vercel
## Claude Code Migration Handoff (self-sufficient, A–Z)

**Owner:** Markii Samaritan · **Samaritan Techs** · Dar es Salaam, Tanzania
**Purpose of this migration:** eliminate the **speed problem** of the Google Apps Script
version (multi-second loads, full-sheet scans on every request) by rebuilding on a
proper stack — while preserving **every feature 1:1** and adding the new phone-retail
requirements in §12.

---

## 0. READ THIS FIRST — directive to Claude Code

**Your mission:** guide Markii through environment setup from zero, then implement the
entire system **100 %** — full port of the existing app **plus** the §12 additions —
before handing over for testing. Markii will not test partial builds; he starts testing
only when everything is implemented.

**Kick-off line Markii will type to you:**
> *"Read CLAUDE_CODE_HANDOFF.md fully, then read legacy/Code.gs and legacy/App.html fully,
> then ask me your one batch of setup questions and begin."*

**Files Markii drops into the repo (source of truth — read them completely):**
- `legacy/Code.gs` — the entire existing backend (~81 KB). Every business rule lives here.
- `legacy/App.html` — the entire existing single-page frontend (~174 KB): all CSS,
  markup, and client JS. Every screen, modal, and behavior lives here.
- `legacy/data/*.csv` — one CSV export per Google Sheet tab (see §7 for the list).
  If a CSV is missing, ask Markii to export it (Sheets → File → Download → CSV).
- This document.

**Related prior work you must align with (Markii's other projects — merged chats /
existing repos give you the context):**
- **HOPE PMO** has *already* been migrated from Apps Script to this exact stack
  (GitHub + Supabase + Vercel). **Mirror its conventions** — same framework, folder
  layout, auth approach, Supabase project structure, deployment flow, email provider —
  so Markii's projects stay consistent. If HOPE PMO's choices conflict with a default
  suggested below, HOPE PMO wins.
- Inside that HOPE PMO project there is a module called **hooploan** that sells
  **watusimu**-brand phones on credit — the same "financed device sale" model as
  **MOGO / Onfone** style phone-financing companies in Tanzania. §12 requirement #7
  (credit sales via financing partners) should **reuse hooploan's financing pattern**
  rather than inventing a new one.

**Supabase context:** Markii's Supabase org already has **two** projects:
- `hoop-pmo` — AWS | eu-west-1 | micro
- `hope-pmo` — AWS | eu-west-1 | small
**Business Operator becomes the third project**, created in the **same region
(eu-west-1)**. Start on `micro` (upgradeable); confirm with Markii.

**How to operate:**
1. Ask **one batch** of setup questions at the very start (framework/version to match
   HOPE PMO, email provider, custom domain yes/no, Supabase tier, anything blocking).
   Then proceed **without stopping for permission** on routine decisions — make the
   sensible call, note it in a `DECISIONS.md`, keep moving.
2. Sequence: **(A)** full 1:1 port of the existing app to a working baseline →
   **(B)** the §12 additions → **(C)** data migration → **(D)** continuity bridge
   (§9) → **(E)** handover checklist (§13). Don't hand over before (E).
3. Markii communicates directly, warmly ("bro"), bilingually (English/Swahili;
   non-native English). Keep explanations short and actionable. He pastes/reads on
   mobile a lot — prefer concrete commands over prose.

---

## 1. What Business Operator is

Two products in one:
1. **Multi-vendor retail management** — any registered business (a "vendor") records
   sales, manages staff (sellers), stock, cash reconciliation between sellers and the
   owner, and downloads branded reports. Replaces a paper *counterbook*.
2. **Public marketplace** — every vendor's active listings automatically appear on a
   public storefront (no login). Visitors browse, filter, search, and contact the
   seller directly on **WhatsApp**. Zero fees for browsing.

Listings are not only retail goods — also **real property and rentals**: cars, land,
houses, bridal gowns, equipment, each **For Sale** or **For Rent** (with price unit and
location).

**Monetization:** vendors get a free trial; afterwards Samaritan Techs charges
commission / a listing fee. Non-paying vendors are **restricted** (read-only lock +
hidden from the public marketplace) until they pay.

**Brand identity (preserve exactly):**
- Gradient blue → violet (`#2563EB` → `#7C3AED`), navy anchor `#1E3A8A`, gold accent
  `#F5B301` / `#FCD34D`; logo mark = rounded-square house silhouette with a gold coin.
- Font: **Plus Jakarta Sans**.
- Footer: `© <current year> Samaritan Techs · Business Operator — Smart business
  management & marketplace`.
- Contact/feedback WhatsApp: `+255 756 749 261` (`255756749261` in `wa.me` links).
- System emails from `samaritantechs@gmail.com`; manager email the same.

**Current live URL (Apps Script — keep alive as a redirector, see §9):**
`https://script.google.com/macros/s/AKfycbzUORcqPEddioSlwJ0J40O5CqIbudJidqxpcVZuBk4EjRPgceUc_t6BBPd4C0o5GoA/exec`

---

## 2. How it works today (legacy architecture) — keep vs. drop

**Legacy:** container-bound Apps Script. `Code.gs` = backend, Google Sheets tabs =
tables. `App.html` = one-file SPA served by `HtmlService.createTemplateFromFile('App')`;
client calls the server via `google.script.run`. `doGet(e)` reads two query params:
`reset` (password-reset token) and `view` (`desktop` or default mobile) and sets the
viewport meta accordingly.

**Keep (product behavior):** every feature in §3, roles in §4, brand in §1, all UX
patterns (dark mode, bilingual tips, sidebar shell, marketplace ranking, restriction
lock, display toggle…).

**Drop (GAS-specific mechanics — replace with the modern equivalent):**
| Legacy mechanic | Replace with |
|---|---|
| ES5-only JS style (was a house rule for GAS) | Modern TypeScript/React — the ES5 rule does **not** carry over |
| Sheets scans on every request | Postgres queries with indexes |
| `CacheService` click aggregation | SQL (view/materialized view or indexed aggregate) |
| `google.script.run` | API routes / server actions + Supabase client |
| Drive-hosted images via `drive.google.com/thumbnail?id=…` | Supabase Storage (existing Drive URLs keep working — see §7) |
| `MailApp`/`GmailApp` | Transactional email provider (match HOPE PMO; default Resend) |
| GAS PDF/Excel generation | Server-side PDF (e.g. `@react-pdf/renderer` or `pdfkit`) + Excel (`exceljs`/SheetJS) |
| Viewport switch via `?view=` in `doGet` (iframe workaround) | Plain responsive CSS + a persisted layout-preference class (no reload needed) |
| "Deploy → New version" rule | Git push → Vercel auto-deploy |
| Plaintext passwords in a sheet | Supabase Auth (hashed) — migrated without forcing resets (§7) |
| Sequential IDs (`P001` per vendor, `SALE-0001`, `LEND-XXXXXXXX`) | UUID primary keys + keep the old value in `legacy_id` for continuity/display |
| 2-second boot loading screen | Remove or shrink — the whole point is speed |

---

## 3. Complete feature inventory (preserve 1:1)

**Auth & accounts**
- Login by **UserID or Email** + password; forgot-password via emailed time-limited
  token link; vendor **self-registration** (business name, type, WhatsApp phone,
  address, admin email/name/UserID/password, T&C checkbox), gated by a global
  `FreeRegistration` setting (if off, manager activates manually).
- Session persists on device; idle **auto-logout** after an admin-configurable number
  of minutes; **auto-sync** silently refreshes data on an admin-configurable interval.
- Login page has an **English / Kiswahili** toggle for its labels.

**Sales (Sell tab)**
- Multi-line checkout (product, qty, unit price auto-filled, live line totals),
  payment method **Cash** or **Lipa Number**, confirm dialog, auto stock decrement,
  all lines of one checkout share a `GroupID`.
- Admin sees Recent Sales with **delete** (restores stock, notifies seller).

**Lendings / Rentals**
- Record item(s) lent or rented to a borrower (name required; email/phone optional),
  per-line price owed, stock decrements; **Mark Returned** restores stock and stamps
  return date; **email reminders** (single or bulk to all active borrowers) using an
  editable template; manager sees all vendors' lendings.

**Products**
- Add / edit / activate-deactivate; one marketplace photo upload; reorder-point
  low-stock alerts; restock existing product; **ListingType** Sale/Rent with
  **PriceUnit** (per day/week/month/event) and **Location**; product table shows a
  Rent badge.

**Marketplace (public, no login)**
- Grid of all active listings of active, non-restricted vendors, **ranked**: in-stock
  above out-of-stock → recency-weighted popularity (clicks in last 30 days × 3 + older
  clicks) → zero-click items in a randomized "discovery" rotation (so new listings
  aren't buried forever). **For Sale / For Rent** filter chips; category chips sorted by
  popularity with a "More ▾" overflow; text search across name / category / vendor /
  location; "Load more" pagination (48 per page); product detail modal (photos, price
  + unit, availability/stock, location, seller card with logo/type/address) and a
  **WhatsApp "Contact seller"** deep link with a prefilled message; 🔥 Hot badge for
  above-average views; stats strip (products / businesses / categories); About section;
  Register CTA.
- Every product tap logs a click (for ranking + analytics).

**Cash tracking (admin)**
- Record cash / Lipa amounts received from a seller; dashboard shows per-seller
  cash sales vs received vs due.

**Dashboard**
- Vendor: today / week / month totals, low-stock count, stock value, 7-day sales bar
  chart (theme-aware), seller balances table, recent sales, stock overview with
  status badges; stat cards open drill-down modals.
- Manager: vendor count, totals, stock value, vendor-performance table.

**Reports**
- Vendor: sales report (date range) as **Excel or PDF**, stock PDF, cash-due PDF.
- Manager: sales / lending / stock / commission reports across all or one vendor.
- All branded with the vendor's name; downloads open in a new tab.

**Users (admin) & business profile**
- Add users (seller / admin / assistant-admin), edit (name, role, UserID, active,
  photo; manager may edit passwords), search, activate/deactivate, manager may
  delete. Admin edits **business profile** (type, WhatsApp phone, address, currency)
  and uploads a **logo** (shown on login and marketplace).

**Management panel (manager only)**
- Free-registration switch; commission rate; **free-trial length**; registered
  businesses table (logo, type, admin, today sales, stock value, active/trial/
  restricted status, Edit / Deactivate / **Restrict–Reactivate** / Logo buttons);
  **Messages & Reminders** (editable payment-restriction message and lending-reminder
  template with placeholders); **Email Center** (send daily/weekly/monthly reports,
  commission demands, lending reminders, payment reminders to restricted vendors,
  manager summary — on demand); **marketplace analytics** (most viewed products,
  best sellers by qty, most viewed businesses, total views).

**Settings (manager)**
- Loading-screen duration, auto-sync interval, session timeout, **vendor permission
  profiles** applied to all vendors (admin daily/weekly/monthly emails, seller can
  download reports, seller receives emails/daily summary, dashboard visible to
  sellers), **hint popup timing**, **manage hints** (bulk add English; edit
  English + Swahili; delete).

**Bilingual tips popup system**
- Bottom-right toast rotates a random tip every *interval* seconds for *lifetime*
  seconds, filtered by role (`seller` / `admin` / `all` / `marketplace` for public
  visitors); each tip has English + Swahili; **EN/SW toggle** in the top bar and on the
  marketplace nav, persisted per device, and shows one tip instantly in the new
  language on toggle. Same toast element used for one-off action feedback.

**Theme & display**
- **Dark / light** toggle (persisted). **Desktop / Mobile display toggle** (persisted):
  default = responsive mobile layout (hamburger sidebar); desktop = full sidebar +
  wide tables. Android font-boosting disabled (`text-size-adjust:100%`).

**Payment restriction (monetization enforcement)**
- Per-vendor `restricted` flag: restricted vendor's users see a fixed amber banner
  with the editable payment notice and a read-only overlay (dimmed, no pointer
  events) over the workspace; top bar (logout/feedback) stays usable; vendor is hidden
  from the marketplace. Checked at login and every auto-sync. Trial length and each
  vendor's own rolling monthly billing cycle are anchored to `RegisteredOn`; reactivating
  a deactivated vendor resets the anchor. Commission is computed only for non-trial
  vendors.

**Feedback**
- In-app form (topic + message) opens a prefilled WhatsApp message to Samaritan
  Techs; suggestions are also logged.

**Android app**
- Signed WebView-shell APK loads the live URL (see §9 for what changes).

---

## 4. Roles & permissions

| Role | Scope |
|---|---|
| `seller` | Own vendor; records sales & lendings; own dashboard/balance; reports if permitted |
| `admin` | Owns a vendor: products, users, cash, reports, profile/logo |
| `assistant-admin` | Same vendor scope as admin, delegated staff |
| `manager` | Samaritan Techs: **all vendors**, Management panel, Settings |
| `assistant-manager` | Same as manager |

Client helpers today: `clientIsAdmin()` = admin/assistant-admin; `clientIsManager()` =
manager/assistant-manager. Per-vendor permission flags (JSON): `adminReceivesDaily`,
`adminReceivesWeekly`, `adminReceivesMonthly`, `sellerCanDownloadReport`,
`sellerReceivesEmail`, `sellerReceivesDaily`, `dashboardVisible`.

**In the new stack:** Supabase Auth + a `profiles` table carrying role and vendor_id;
**Row Level Security** scopes every table by the caller's vendor; manager roles get
cross-vendor policies; the public marketplace reads through a view that already
excludes inactive/restricted vendors and inactive products.

---

## 5. Legacy data dictionary (all 9 Google Sheets) → Postgres types

Row 1 is the header. Three sheets (**ProductsDB, Sales, CashTracking**) pre-existed
manually; the other six were created/self-healed by code. Types below are the target
Postgres types.

### Users
| Col | Header | Legacy | Target | Notes |
|---|---|---|---|---|
| A | Email | text | `citext` unique | login + reset lookup |
| B | Name | text | `text` | |
| C | Role | text | `enum user_role` | seller / admin / assistant-admin / manager / assistant-manager |
| D | UserID | text | `text` unique | login handle |
| E | Password | text **plaintext** | — (Supabase Auth) | migrate via admin API, then never store |
| F | Active | `Yes`/`No` | `boolean` | |
| G | Vendor | text | `uuid → vendors.id` | blank for manager roles |
| H | ProfilePhoto | url | `text` | Drive thumbnail URL or Storage URL |
| I | BusinessType | text | → `vendors.business_type` | only meaningful on admin rows |
| J | Phone | text | → `vendors.phone` | WhatsApp number |
| K | Address | text | → `vendors.address` | |
| L | RegisteredOn | date | → `vendors.registered_on timestamptz` | **trial/billing anchor** |

> The legacy app has **no vendors table** — a "vendor" is derived from Users rows with
> role admin. **Create a real `vendors` table** in the new schema (see §6) and hoist
> columns I–L plus the per-vendor Settings keys into it.

### ProductsDB
| Col | Header | Legacy | Target | Notes |
|---|---|---|---|---|
| A | ProductID | `P001`… per vendor | `legacy_id text` (+ uuid pk) | |
| B | Name | text | `text` | |
| C | Category | text | `text` | |
| D | Price | number | `numeric(14,2)` | |
| E | Stock | number | `integer` | for serialized products this becomes a computed count (§12) |
| F | Supplier | text | `text` | |
| G | ReorderPoint | number | `integer` | |
| H | Vendor | text | `uuid → vendors.id` | |
| I | Active | `Yes`/`No` | `boolean` | |
| J | Image1 | url | `text` | |
| K | Image2 | url | `text` | exists, no upload UI today |
| L | ListingType | `Sale`/`Rent` | `enum listing_type` | |
| M | PriceUnit | text | `text` | per day / week / month / event / '' |
| N | Location | text | `text` | searchable |

### Sales
| Col | Header | Legacy | Target |
|---|---|---|---|
| A | SaleID | `SALE-0001` | `legacy_id text` (+ uuid pk) |
| B | Timestamp | date | `timestamptz` |
| C | SellerID | Users.UserID | `uuid → profiles.id` |
| D | ProductID | text | `uuid → products.id` |
| E | ProductName | text (denormalized) | `text` (keep snapshot) |
| F | Qty | number | `integer` |
| G | Price | number | `numeric(14,2)` |
| H | Total | number | `numeric(14,2)` |
| I | PaymentMethod | `Cash` / `Lipa Number` | `enum payment_method` (extended in §12) |
| J | GroupID | uuid | `uuid` (checkout group) |
| K | Vendor | text | `uuid → vendors.id` |

### Lendings (15 columns, one row per line item)
LendingID (`LEND-XXXXXXXX`, shared per transaction) · Timestamp · BorrowerName ·
BorrowerEmail · BorrowerPhone · ProductID · ProductName · Qty · Price · Total ·
AdminID · AdminName · Vendor · Status (`Active`/`Returned`) · ReturnDate.
Target: `lendings` (header: borrower, vendor, recorded_by, status, return_date) +
`lending_items` (product, qty, price, total).

### CashTracking
Timestamp · SellerID · CashAmount · LipaAmount · *(col E always blank, unused)* ·
Vendor → `cash_receipts(id, vendor_id, seller_id, cash_amount numeric, lipa_amount
numeric, note text, received_at)`.

### Settings (Key/Value)
Global keys: `FreeRegistration`, `commissionRate`, `trialDays`, `hintLifetime`,
`hintInterval`, `loadingTime`, `autoSyncSeconds`, `sessionTimeoutMinutes`,
`paymentReminderText`, `lendingReminderText`, `announcement_enabled/_title/_text/
_audience/_version` (backend-only, no UI in legacy).
Per-vendor keys (hoist into `vendors`): `restricted_<vendor>`, `logo_<vendor>`,
`currency_<vendor>`, `permissions_<vendor>` (JSON).
Target: `settings(key text pk, value text)` for globals only.

### Hints
Role (`seller`/`admin`/`all`/`marketplace`) · Message (EN) · SW-MESSAGE →
`hints(id, role, message_en, message_sw, active, sort)`.

### ProductClicks (append-only)
Timestamp · ProductID · ProductName · Vendor → `product_clicks(id, product_id,
vendor_id, clicked_at)` + index on `(product_id, clicked_at)`.

### Suggestions (append-only)
Timestamp · UserId · UserName · Vendor · Category · Message → `suggestions`.

---

## 6. Target Supabase schema (DDL sketch — refine as you implement)

```sql
create type user_role as enum ('seller','admin','assistant-admin','manager','assistant-manager');
create type listing_type as enum ('Sale','Rent');
create type payment_method as enum ('Cash','Lipa Number','Credit');       -- Credit added for §12
create type lending_status as enum ('Active','Returned');
create type sale_status as enum ('completed','cancelled');                -- §12 soft-cancel
create type movement_type as enum ('received','sold','transfer_out','transfer_in','returned','adjustment','cancelled_restock');
create type unit_status as enum ('in_stock','sold','transferred','returned','lost');

create table vendors (
  id uuid primary key default gen_random_uuid(),
  legacy_name text unique not null,             -- the old Vendor string (join key for migration)
  name text not null, business_type text, phone text, address text,
  currency text not null default 'TZS',
  logo_url text,
  registered_on timestamptz not null default now(),   -- trial/billing anchor
  active boolean not null default true,
  restricted boolean not null default false,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create table branches (                            -- §12 multi-shop under one vendor
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id) on delete cascade,
  name text not null, location text, active boolean default true,
  unique (vendor_id, name)
);

create table profiles (                            -- 1:1 with auth.users
  id uuid primary key references auth.users(id) on delete cascade,
  email citext unique not null, name text not null,
  user_id_handle text unique not null,             -- legacy UserID login handle
  role user_role not null default 'seller',
  vendor_id uuid references vendors(id),
  branch_id uuid references branches(id),          -- §12 (nullable)
  active boolean not null default true,
  profile_photo_url text,
  created_at timestamptz default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id),
  legacy_id text,                                  -- P001…
  name text not null, category text, brand text, model text,    -- brand/model = §12
  price numeric(14,2) not null default 0,
  stock integer not null default 0,                -- authoritative for non-serialized
  is_serialized boolean not null default false,    -- §12: true → stock = count(units in_stock)
  supplier text, reorder_point integer default 20,
  active boolean not null default true,
  image1_url text, image2_url text,
  listing_type listing_type not null default 'Sale',
  price_unit text, location text,
  created_at timestamptz default now()
);
create index on products (vendor_id, active);

create table product_units (                       -- §12 serialized inventory (IMEI)
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  vendor_id uuid not null references vendors(id),
  branch_id uuid references branches(id),
  imei text, serial_no text,
  status unit_status not null default 'in_stock',
  received_at timestamptz default now(),
  sold_sale_id uuid, sold_at timestamptz,
  unique (vendor_id, imei)
);
create index on product_units (product_id, status);

create table financing_partners (                  -- §12 (MOGO, Onfone, watusimu/hooploan…)
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid references vendors(id),           -- null = global list
  name text not null, contact text, active boolean default true
);

create table sales (
  id uuid primary key default gen_random_uuid(),
  legacy_id text, group_id uuid not null,
  vendor_id uuid not null references vendors(id),
  branch_id uuid references branches(id),          -- §12
  seller_id uuid not null references profiles(id),
  product_id uuid not null references products(id),
  product_name text not null,                      -- snapshot
  unit_id uuid references product_units(id),       -- §12 (serialized sales)
  qty integer not null, list_price numeric(14,2) not null,
  discount numeric(14,2) not null default 0,       -- §12
  price numeric(14,2) not null,                    -- effective unit price after discount
  total numeric(14,2) not null,
  payment_method payment_method not null,
  financing_partner_id uuid references financing_partners(id),  -- §12 (when Credit)
  status sale_status not null default 'completed', -- §12 soft-cancel
  cancelled_by uuid references profiles(id), cancelled_at timestamptz, cancel_reason text,
  sold_at timestamptz not null default now()
);
create index on sales (vendor_id, sold_at desc);
create index on sales (seller_id, sold_at desc);

create table lendings (
  id uuid primary key default gen_random_uuid(), legacy_id text,
  vendor_id uuid not null references vendors(id),
  borrower_name text not null, borrower_email text, borrower_phone text,
  recorded_by uuid references profiles(id),
  status lending_status not null default 'Active',
  return_date timestamptz, created_at timestamptz default now()
);
create table lending_items (
  id uuid primary key default gen_random_uuid(),
  lending_id uuid not null references lendings(id) on delete cascade,
  product_id uuid not null references products(id), product_name text,
  qty integer not null, price numeric(14,2) default 0, total numeric(14,2) default 0
);

create table cash_receipts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id),
  seller_id uuid not null references profiles(id),
  cash_amount numeric(14,2) default 0, lipa_amount numeric(14,2) default 0,
  note text, received_at timestamptz default now()
);

create table stock_movements (                     -- §12 full stock audit trail
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id),
  product_id uuid not null references products(id),
  unit_id uuid references product_units(id),
  type movement_type not null,
  qty integer not null default 1,
  from_branch_id uuid references branches(id), to_branch_id uuid references branches(id),
  reference_sale_id uuid, reference_lending_id uuid,
  by_user uuid references profiles(id), note text,
  created_at timestamptz default now()
);

create table settings (key text primary key, value text);
create table hints (id uuid primary key default gen_random_uuid(), role text not null,
  message_en text not null, message_sw text, active boolean default true, sort int default 0);
create table product_clicks (id bigserial primary key, product_id uuid references products(id),
  vendor_id uuid references vendors(id), clicked_at timestamptz default now());
create index on product_clicks (product_id, clicked_at desc);
create table suggestions (id uuid primary key default gen_random_uuid(), user_id uuid,
  user_name text, vendor_id uuid, category text, message text, created_at timestamptz default now());

-- Public marketplace view (already excludes inactive/restricted; ranking done in a query/RPC)
create view marketplace_products as
  select p.*, v.name as vendor_name, v.phone as vendor_phone, v.logo_url as vendor_logo,
         v.business_type as vendor_type, v.address as vendor_address, v.currency
  from products p join vendors v on v.id = p.vendor_id
  where p.active and v.active and not v.restricted;
```

**RLS:** enable on all tables; policy = `vendor_id = (select vendor_id from profiles
where id = auth.uid())` for vendor-scoped tables, plus a manager bypass policy; anon
`select` only on `marketplace_products` (and insert on `product_clicks`). Use a
`security definer` RPC for the ranked marketplace query.

---

## 7. Migration plan (run once, scripted, repeatable)

1. **Export sheets → CSV** into `legacy/data/`: `Users.csv`, `ProductsDB.csv`,
   `Sales.csv`, `Lendings.csv`, `CashTracking.csv`, `Settings.csv`, `Hints.csv`,
   `ProductClicks.csv`, `Suggestions.csv`.
2. **Vendors first:** derive one `vendors` row per distinct Users.Vendor of role admin
   (name/type/phone/address/registered_on from that admin row; currency/logo/
   restricted/permissions from the matching `Settings` prefixed keys; `legacy_name` =
   the old string).
3. **Auth users:** for every Users row create a Supabase Auth user via the **admin API
   with the existing plaintext password** (Supabase hashes it) — nobody is forced to
   reset. Create the `profiles` row (handle = UserID, role, vendor by `legacy_name`).
   After a successful run, the plaintext CSV must be deleted from the repo (add
   `legacy/data/` to `.gitignore` before the first commit).
4. **Products → sales → lendings → cash → clicks → suggestions → hints → settings**,
   mapping vendor strings → `vendor_id`, UserID → `profiles.id`, ProductID (per vendor)
   → `products.id`; keep originals in `legacy_id`. Lendings CSV rows sharing a
   LendingID collapse into one `lendings` + many `lending_items`.
5. **Images:** keep existing `drive.google.com/thumbnail?…` URLs as-is (they're public
   and work). New uploads go to Supabase Storage buckets `product-images`, `logos`,
   `profile-photos` (public read). Optional later job: fetch each Drive image into
   Storage and rewrite the URL.
6. **Verify counts** per table vs. CSV row counts; spot-check 3 vendors' dashboards
   against the legacy app before cut-over.

---

## 8. Speed — what this migration must actually fix

Legacy slow spots to eliminate: every dashboard load re-reads whole sheets; the
marketplace re-scans an ever-growing click log; ~1,000 product cards rendered
client-side; a 2 s boot loader; 300–800 ms per `google.script.run` round-trip
serialized one after another. Target: **sub-second** first paint on Vercel (SSR/ISR
for the public marketplace), paginated server queries, indexed aggregates for
popularity, optimistic UI for sales entry, Supabase Realtime (optional) instead of
polling auto-sync.

---

## 9. Continuity — nothing already printed or installed may break

- **Street flyer QR codes** point to (a) the Google Drive APK link and (b) the old
  `/exec` URL. **Android APK v1.2** (package `com.samaritantechs.businessoperator`,
  versionCode 3) loads the old `/exec` URL and only allows `script.google.com` /
  `googleusercontent.com` domains inside its WebView.
- **Bridge (day one):** after the Vercel deployment is live, replace the Apps Script
  `doGet` with a tiny redirector (meta-refresh + JS `location.replace` to the new URL,
  preserving query params) and deploy it via *Manage deployments → Edit → New
  version* (never "New deployment" — same URL must survive). Old QR/links now land on
  the new app.
- **Proper fix:** rebuild the APK as **v1.3** (versionCode 4) with `APP_URL` = the new
  production URL and the new domain added to the WebView allowlist; sign with the
  **same permanent keystore** (`samaritan.keystore`, alias `businessoperator` —
  Markii holds the password; **never commit it**); replace the file **in place** on
  Google Drive via *Manage versions* so the printed QR stays valid. The build recipe
  is in Markii's `APK_GENERATOR_HANDOFF.md`.

---

## 10. Environment setup A–Z (walk Markii through this, in order)

1. **GitHub:** create private repo `business-operator`; clone; add `.gitignore`
   (`node_modules`, `.env*`, `legacy/data/`).
2. **Scaffold** the app matching HOPE PMO's framework/version and folder layout
   (default if none: Next.js App Router + TypeScript + Tailwind, Supabase JS client).
3. **Supabase:** create project **business-operator** in Markii's existing org,
   region **eu-west-1** (same as `hoop-pmo` / `hope-pmo`), tier micro. Record Project
   URL, anon key, service-role key.
4. **Schema:** commit SQL migrations under `supabase/migrations/`; apply (Supabase
   CLI or SQL editor). Enable RLS + policies. Create Storage buckets.
5. **Env vars:** `.env.local` + Vercel project settings: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, email provider key,
   `WHATSAPP_NUMBER=255756749261`, `MANAGER_EMAIL=samaritantechs@gmail.com`.
6. **Email provider:** match HOPE PMO (default Resend); verify sender.
7. **Vercel:** import the GitHub repo, set env vars, deploy; confirm production URL;
   optional custom domain.
8. **Port everything (§3)**, then **build §12**, committing feature by feature.
9. **Run the migration (§7)** against the new project; verify.
10. **Bridge + APK (§9).**
11. **Handover (§13).**

---

## 11. Conventions to preserve / drop

**Preserve:** brand palette, font, footer signature, bilingual hints with the EN/SW
toggle UX, dark/light toggle, sidebar + top-bar shell, stat cards / badges / table
look, marketplace ranking logic and cold-start rotation, restriction banner +
overlay behavior, WhatsApp-first contact, editable message templates, Swahili-first
tone for public-facing copy, Markii's `DECISIONS.md` habit.

**Drop:** ES5-only style, "whole file back" delivery (you edit files directly),
GAS deploy rule (except for the §9 bridge), Drive image hosting for new uploads,
plaintext passwords, the `?view=` reload trick.

---

## 12. THE NEW CLIENT DEMAND — phone-retail chain (Frank Amos)

**Context:** Markii's WhatsApp AI agent booked a demo with **Frank Amos**, who runs a
**multi-shop mobile-phone retail business** (Samsung, Infinix, Tecno, Redmi…).
Meeting: **Ngoreme Park, Sinza, Dar es Salaam, 7:30 PM EAT** (Sept 2/3, 2026).
Frank wants the system **ready within one week** of confirming requirements. Markii
will demo the existing Business Operator as proof of the engine; the additions below
are what turns it into Frank's system. Build them **into this new version** (they also
make the product stronger for every electronics/phone vendor on the marketplace).

**Frank's ten requirements (translated from Swahili) and how to build each:**

| # | Requirement | Legacy status | Build in new version |
|---|---|---|---|
| 1 | Sales per **shop** (units + value per shop) | Only per vendor; no branches | `branches` table; users/sales/units carry `branch_id`; per-branch dashboard + report |
| 2 | Sales by day / week / month / **year** | Day/week/month exist | Add yearly preset; all period reports per branch and per vendor |
| 3 | Sales per employee (units + value) | ✅ exists | Port; add per-branch filter |
| 4 | Sales by **Brand & Model** | ❌ free-text category only | `products.brand`, `products.model`; brand/model report + top-sellers by model |
| 5 | Sales by **IMEI / Serial** (which phone, when, which shop) | ❌ aggregate stock only | `product_units` with IMEI/serial; `products.is_serialized`; checkout scans/selects a unit; unit history view |
| 6 | Sales by payment method (Cash + others) | ✅ Cash / Lipa | Port; keep extensible |
| 7 | **Credit sales via financing companies** (Onfone, MOGO…) | ❌ none | `payment_method='Credit'` + `financing_partners` + `sales.financing_partner_id`; **reuse the hooploan pattern from HOPE PMO** (watusimu-brand phones on credit = same MOGO case); report "sales by financing partner" |
| 8 | **Discount** shown per sale | ❌ none | `sales.list_price` + `sales.discount` (+ effective `price`); show on receipt, reports, dashboard |
| 9 | **Cancelled sales** + who cancelled | ⚠️ hard delete only | Replace delete with **soft-cancel**: `status='cancelled'`, `cancelled_by/at/reason`; stock/unit restored via a `stock_movements` row; cancelled-sales report |
| 10 | **Stock movement**: received, sold, **transferred shop→shop**, remaining | ⚠️ partial | `stock_movements` for every change; **Transfer** action (unit- or qty-based) between branches; movement report + per-branch remaining stock |

**Design principles for these additions:**
- Keep Business Operator **general**: `is_serialized=false` products behave exactly
  like today (numeric stock). Only serialized products require units — so grocery
  vendors are unaffected and phone shops get IMEI-level truth.
- Branches are **optional**: a vendor with no branches works exactly like today (a
  single implicit location). Frank's vendor gets N branches.
- Every stock change **must** write a `stock_movements` row (received / sold /
  transfer / returned / cancellation restock) — that table *is* requirement #10.
- Credit sales: total is recorded as revenue; the financing partner is who pays the
  shop — mirror hooploan's handling of that flow; add a "financed sales" report.
- Discounts never change `list_price`; `price` = effective unit price; `total` =
  `qty × price`.

**Deadline sequencing:** finish the 1:1 port first (stable baseline for Frank's demo
narrative), then #4 → #8 → #9 → #7 → #5 → #1 → #10 → #2 (cheapest to deepest), so
partial progress is always demonstrable within the one-week window.

---

## 13. Definition of done + handover checklist

Before telling Markii "ready to test," confirm all of the following, and give him a
one-page checklist he can tick on his phone:

- [ ] Login by UserID **and** by Email works for migrated users **without** a reset
- [ ] Every §3 feature works for seller / admin / manager (use 3 migrated accounts)
- [ ] Marketplace public page: ranking, Sale/Rent chips, category chips, search incl.
      location, Load more, detail modal, WhatsApp link, click logging
- [ ] Restriction lock behaves (banner + overlay + hidden from marketplace)
- [ ] Bilingual tips toggle shows Swahili instantly; theme + display toggles persist
- [ ] Reports download (PDF + Excel) for vendor and manager, branded
- [ ] Emails send (reset link, reminders, reports)
- [ ] §12: branches, brand/model, serialized units (IMEI), credit sales + financing
      partners, discounts, soft-cancel with audit, transfers, stock-movement report,
      yearly period, per-branch dashboard
- [ ] Data migration verified (row counts per table; 3 vendors spot-checked)
- [ ] Old `/exec` redirects to the new URL; APK v1.3 built, signed with the same
      keystore, Drive file replaced in place
- [ ] Load time on a mid-range Android phone in Dar: marketplace and dashboard
      **under 1 s** after first visit

— Samaritan Techs · Business Operator · migration handoff
