-- =====================================================================================
-- BUSINESS OPERATOR v2 -- PostgreSQL schema (Supabase project: business-operator, eu-west-1)
-- =====================================================================================
-- The nine Google Sheets tabs of the Apps Script version become real tables. Three things the
-- sheet never had are made explicit here:
--
--   * a VENDOR is a row, not "whatever string sits in Users.Vendor on an admin's row";
--   * a SESSION is a row, so the browser never re-sends a password and a stolen page cannot
--     sign anybody in after the token expires;
--   * every stock change writes a STOCK MOVEMENT (Frank Amos's requirement #10), so "received,
--     sold, transferred, remaining" is a read rather than a reconstruction.
--
-- Run once against a fresh project: Supabase -> SQL Editor -> paste this whole file -> Run.
-- Idempotent (IF NOT EXISTS everywhere; enums wrapped so a second run does not die on them).
-- The same trust model as HOPE PMO: the API layer holds the service role key and enforces
-- roles itself (api/_lib/auth.js), so RLS stays off. Nothing in the browser holds a key.
-- =====================================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";     -- case-insensitive emails and login handles

-- ------------------------------------------------------------------ enums (idempotent)
do $$ begin
  create type user_role as enum ('seller','admin','assistant-admin','manager','assistant-manager');
exception when duplicate_object then null; end $$;
do $$ begin
  create type listing_type as enum ('Sale','Rent');
exception when duplicate_object then null; end $$;
do $$ begin
  -- 'Credit' is the phone-retail addition: the sale is revenue, a financing partner pays the shop.
  create type payment_method as enum ('Cash','Lipa Number','Credit');
exception when duplicate_object then null; end $$;
do $$ begin
  create type lending_status as enum ('Active','Returned');
exception when duplicate_object then null; end $$;
do $$ begin
  -- A sale is never deleted any more. It is cancelled, by somebody, for a reason.
  create type sale_status as enum ('completed','cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type movement_type as enum
    ('received','sold','transfer_out','transfer_in','returned','adjustment','cancelled_restock','lent',
     'adjustment_in','adjustment_out');
exception when duplicate_object then null; end $$;
do $$ begin
  create type unit_status as enum ('in_stock','sold','lent','lost');
exception when duplicate_object then null; end $$;

-- =====================================================================================
-- VENDORS -- the business. Trial, billing cycle, restriction and permissions all hang here.
-- =====================================================================================
create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  legacy_name text unique,                      -- the old Users.Vendor string: the migration's join key
  name text not null,
  business_type text,
  phone text,                                   -- WhatsApp number shown on the marketplace
  address text,
  currency text not null default 'TZS',
  logo_url text,
  registered_on timestamptz not null default now(),   -- TRIAL AND BILLING ANCHOR (reset on reactivation)
  active boolean not null default true,
  restricted boolean not null default false,    -- the read-only lock + hidden from the marketplace
  permissions jsonb not null default '{}'::jsonb,     -- adminReceivesDaily, sellerCanDownloadReport, ...
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_vendors_active on vendors(active, restricted);

-- BRANCHES -- optional. A vendor with none works exactly as before (one implicit location).
create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id) on delete cascade,
  name text not null,
  location text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (vendor_id, name)
);
create index if not exists idx_branches_vendor on branches(vendor_id);

-- =====================================================================================
-- PROFILES -- people. Passwords are scrypt hashes with a per-account salt (api/_lib/auth.js);
-- the migration hashes the legacy plaintext once, so nobody is asked to reset.
-- =====================================================================================
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  email citext unique not null,
  name text not null,
  handle citext unique not null,                -- the legacy UserID: the login handle
  password_hash text,
  password_salt text,
  role user_role not null default 'seller',
  vendor_id uuid references vendors(id),        -- null for manager roles
  branch_id uuid references branches(id),       -- optional: where this person sells
  active boolean not null default true,
  profile_photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_profiles_vendor on profiles(vendor_id, role, active);

-- SESSIONS -- one row per signed-in device. The token is what the browser keeps.
create table if not exists sessions (
  token text primary key,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  user_agent text
);
create index if not exists idx_sessions_profile on sessions(profile_id);

create table if not exists password_resets (
  token text primary key,
  profile_id uuid not null references profiles(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- =====================================================================================
-- PRODUCTS
-- =====================================================================================
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id),
  legacy_id text,                               -- P001... (per vendor) kept for continuity
  name text not null,
  category text,
  brand text,                                   -- phone retail: Samsung / Tecno / Infinix ...
  model text,                                   -- A05 / Spark 20 ...
  price numeric(14,2) not null default 0,
  cost_price numeric(14,2) not null default 0,   -- what the shop PAID. Never public, never shown to a seller.
  stock integer not null default 0,             -- authoritative for non-serialized; a maintained count for serialized
  is_serialized boolean not null default false, -- true -> every unit carries an IMEI/serial in product_units
  supplier text,
  reorder_point integer not null default 20,
  active boolean not null default true,
  image1_url text,
  image2_url text,
  image3_url text,                              -- three photos per listing (added after the port)
  listing_type listing_type not null default 'Sale',
  price_unit text,                              -- per day / week / month / event (rent only)
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_products_vendor_active on products(vendor_id, active);
create index if not exists idx_products_legacy on products(vendor_id, legacy_id);

-- Per-branch quantities for NON-serialized products of a vendor that uses branches.
-- products.stock stays the vendor total; this answers "remaining per shop".
create table if not exists branch_stock (
  product_id uuid not null references products(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  qty integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (product_id, branch_id)
);

-- Serialized inventory: one row per physical phone (IMEI) or item (serial).
create table if not exists product_units (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  vendor_id uuid not null references vendors(id),
  branch_id uuid references branches(id),
  imei text,
  serial_no text,
  status unit_status not null default 'in_stock',
  received_at timestamptz not null default now(),
  sold_sale_id uuid,
  sold_at timestamptz,
  note text,
  updated_at timestamptz not null default now(),
  unique (vendor_id, imei)
);
create index if not exists idx_units_product_status on product_units(product_id, status);
create index if not exists idx_units_branch on product_units(vendor_id, branch_id, status);

-- Financing partners (MOGO, Onfone, Watu simu ...). vendor_id null = offered to every vendor.
create table if not exists financing_partners (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid references vendors(id),
  name text not null,
  contact text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_partners_vendor on financing_partners(vendor_id, active);

-- =====================================================================================
-- SALES -- one row per line; a checkout shares a group_id. Never deleted: cancelled.
-- =====================================================================================
create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  legacy_id text,                               -- SALE-0001
  group_id uuid not null,
  vendor_id uuid not null references vendors(id),
  branch_id uuid references branches(id),
  seller_id uuid references profiles(id),
  seller_name text,                             -- snapshot, so a renamed or deleted seller still reads
  product_id uuid references products(id),
  product_name text not null,                   -- snapshot
  brand text, model text,                       -- snapshot for brand/model reports
  unit_id uuid references product_units(id),    -- set when a serialized unit was sold
  imei text,                                    -- snapshot of the unit's IMEI at sale time
  qty integer not null,
  list_price numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,    -- per unit; never changes list_price
  price numeric(14,2) not null,                 -- effective unit price = list_price - discount
  total numeric(14,2) not null,                 -- qty x price
  unit_cost numeric(14,2) not null default 0,   -- SNAPSHOT of products.cost_price at the moment of sale.
                                                -- Restocking at a new cost must not move last month's profit,
                                                -- for the same reason product_name is a snapshot and not a join.
  customer_name text,                           -- blank = a walk-in, which is most of them
  customer_phone text,
  payment_method payment_method not null,
  financing_partner_id uuid references financing_partners(id),
  partner_paid boolean not null default false,  -- the partner has settled this credit sale with the shop
  partner_paid_at timestamptz,
  status sale_status not null default 'completed',
  cancelled_by uuid references profiles(id),
  cancelled_by_name text,
  cancelled_at timestamptz,
  cancel_reason text,
  sold_at timestamptz not null default now()
);
create index if not exists idx_sales_vendor_time on sales(vendor_id, sold_at desc);
create index if not exists idx_sales_seller_time on sales(seller_id, sold_at desc);
create index if not exists idx_sales_group on sales(group_id);
create index if not exists idx_sales_branch_time on sales(branch_id, sold_at desc);

-- =====================================================================================
-- LENDINGS / RENTALS -- a header per transaction, a line per item.
-- =====================================================================================
create table if not exists lendings (
  id uuid primary key default gen_random_uuid(),
  legacy_id text,                               -- LEND-XXXXXXXX
  vendor_id uuid not null references vendors(id),
  branch_id uuid references branches(id),
  borrower_name text not null,
  borrower_email text,
  borrower_phone text,
  recorded_by uuid references profiles(id),
  recorded_by_name text,
  status lending_status not null default 'Active',
  return_date timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_lendings_vendor_status on lendings(vendor_id, status, created_at desc);

create table if not exists lending_items (
  id uuid primary key default gen_random_uuid(),
  lending_id uuid not null references lendings(id) on delete cascade,
  product_id uuid references products(id),
  product_name text,
  unit_id uuid references product_units(id),
  qty integer not null,
  price numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0
);
create index if not exists idx_lending_items_lending on lending_items(lending_id);

-- =====================================================================================
-- CASH -- what a seller handed the owner.
-- =====================================================================================
create table if not exists cash_receipts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id),
  seller_id uuid references profiles(id),
  cash_amount numeric(14,2) not null default 0,
  lipa_amount numeric(14,2) not null default 0,
  note text,
  recorded_by uuid references profiles(id),
  received_at timestamptz not null default now()
);
create index if not exists idx_cash_vendor_time on cash_receipts(vendor_id, received_at desc);

-- =====================================================================================
-- STOCK MOVEMENTS -- requirement #10. Every stock change writes exactly one row here.
-- =====================================================================================
create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id),
  product_id uuid not null references products(id),
  product_name text,
  unit_id uuid references product_units(id),
  imei text,
  type movement_type not null,
  qty integer not null default 1,               -- always positive; `type` carries the direction
  from_branch_id uuid references branches(id),
  to_branch_id uuid references branches(id),
  reference_sale_id uuid,
  reference_lending_id uuid,
  by_user uuid references profiles(id),
  by_name text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_movements_vendor_time on stock_movements(vendor_id, created_at desc);
create index if not exists idx_movements_product_time on stock_movements(product_id, created_at desc);

-- =====================================================================================
-- SETTINGS, HINTS, CLICKS, SUGGESTIONS, AUDIT
-- =====================================================================================
create table if not exists settings (
  key text primary key,
  value text
);

-- Bilingual rotating tips. role: seller / admin / assistant-admin / assistant-manager / all / marketplace
create table if not exists hints (
  id uuid primary key default gen_random_uuid(),
  role text not null,
  message_en text not null,
  message_sw text,
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_hints_role on hints(role);

-- Append-only. Ranking reads a GROUP BY over this (bo_click_counts), never the rows.
create table if not exists product_clicks (
  id bigserial primary key,
  product_id uuid references products(id),
  vendor_id uuid references vendors(id),
  clicked_at timestamptz not null default now()
);
create index if not exists idx_clicks_product_time on product_clicks(product_id, clicked_at desc);
create index if not exists idx_clicks_time on product_clicks(clicked_at desc);

create table if not exists suggestions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid,
  user_name text,
  vendor_id uuid,
  category text,
  message text,
  created_at timestamptz not null default now()
);

-- Who did what. Writes only, never the payload (see HOPE PMO's api/_lib/audit.js for why).
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor_id uuid,
  actor_name text,
  actor_role text,
  vendor_id uuid,
  action text not null,
  ok boolean not null default true,
  ms integer,
  detail jsonb
);
create index if not exists idx_audit_vendor_time on audit_log(vendor_id, at desc);

-- =====================================================================================
-- THE PUBLIC MARKETPLACE -- one view that already excludes what must never be public:
-- inactive products, inactive vendors, and RESTRICTED vendors (no free exposure for non-payers).
-- =====================================================================================
create or replace view marketplace_products as
  select p.id, p.vendor_id, p.legacy_id, p.name, p.category, p.brand, p.model, p.price, p.stock,
         p.image1_url, p.image2_url, p.image3_url, p.listing_type, p.price_unit, p.location,
         v.name as vendor_name, v.phone as vendor_phone, v.logo_url as vendor_logo,
         v.business_type as vendor_type, v.address as vendor_address, v.currency
  from products p
  join vendors v on v.id = p.vendor_id
  where p.active and v.active and not v.restricted;

-- Added after the first deployments: a third product photo. The CREATE TABLE above already
-- has it for a new database; this is what gives it to one that was made before.
alter table if exists products add column if not exists image3_url text;

-- A stock take can go either way, and 'adjustment' said only that one happened: qty is always
-- positive and the TYPE is what carries direction, so a correction of -3 and one of +3 were
-- written identically. These two say which. The bare 'adjustment' value stays in the enum for
-- rows written before this, and the movements report keeps counting those as neither.
do $$ begin
  alter type movement_type add value if not exists 'adjustment_in';
  alter type movement_type add value if not exists 'adjustment_out';
exception when others then null; end $$;

-- =====================================================================================
-- PROFIT, AND WHO BOUGHT IT -- added after the first deployments.
-- =====================================================================================
-- A shop that cannot see its margin is guessing. The old app could tell you a phone sold for
-- 250,000 and that 20,000 was knocked off the sticker; it could not tell you whether that left
-- anything. cost_price is what the shop PAID, and every sale line carries a SNAPSHOT of it, so
-- restocking at a new cost tomorrow does not silently rewrite what last month earned.
--
-- Cost is commercially sensitive: sellers never see it. That is enforced in the API
-- (api/_lib/bo/_shared.js -> stripCost, and reports.js which lets a seller open one report only).
--
-- customer_name / customer_phone sit on the sale because most sales are walk-ins and a
-- customers table would then be a table of blanks. When somebody IS named, the name is on
-- every line of the checkout, the same denormalisation seller_name already uses, so
-- "everything this person ever bought" is one indexed read and not a join.
alter table if exists products add column if not exists cost_price numeric(14,2) not null default 0;
alter table if exists sales    add column if not exists unit_cost  numeric(14,2) not null default 0;
alter table if exists sales    add column if not exists customer_name text;
alter table if exists sales    add column if not exists customer_phone text;

-- "What has this customer bought?" and "who has not been back since April?" are the two
-- questions a phone shop asks about a name, and both are this index. Partial, because the
-- overwhelming majority of sales have no customer and there is no sense indexing blanks.
create index if not exists idx_sales_customer on sales (vendor_id, customer_phone, sold_at desc)
  where customer_phone is not null;

-- =====================================================================================
-- PURCHASE ORDERS -- stock you have ordered and not yet got.
-- =====================================================================================
-- Until now the first the system heard of a delivery was somebody typing an opening stock or a
-- restock after the boxes were already open. Everything between "I have ordered forty covers"
-- and "forty covers are on the shelf" lived in a WhatsApp thread, so nobody could answer what
-- is on its way, what did the supplier actually send, or what did it cost this time.
--
-- Receiving is the ONLY way an order turns into stock, and it goes through the same
-- stock.changeStock() every other quantity change goes through, so a delivery is a 'received'
-- movement like any other and the movements report can still answer "where did these come from".
--
-- Partial deliveries are the normal case, not the exception: a supplier who owes forty sends
-- twenty-eight. So each line carries what was ORDERED and what has been RECEIVED so far, and an
-- order stays open until they match. Receiving twice tops the line up rather than doubling it.
do $$ begin
  create type po_status as enum ('ordered','received','cancelled');
exception when duplicate_object then null; end $$;

create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  legacy_id text,                               -- PO-0001, the number said down the phone
  vendor_id uuid not null references vendors(id),
  branch_id uuid references branches(id),       -- the shop the delivery lands at
  supplier text,
  reference text,                               -- the supplier's own invoice or order number
  notes text,
  status po_status not null default 'ordered',
  expected_at date,
  created_by uuid references profiles(id),
  created_by_name text,                         -- snapshot, so a departed buyer still reads
  created_at timestamptz not null default now(),
  closed_at timestamptz,                        -- fully received, or cancelled
  closed_by_name text,
  cancel_reason text
);
create index if not exists idx_po_vendor_status on purchase_orders(vendor_id, status, created_at desc);

create table if not exists purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  product_id uuid not null references products(id),
  product_name text not null,                   -- snapshot, as everywhere else
  qty integer not null,                         -- ordered
  received_qty integer not null default 0,      -- delivered so far; the order closes when these meet
  unit_cost numeric(14,2) not null default 0,   -- what this delivery is costing, per piece
  total numeric(14,2) not null default 0
);
create index if not exists idx_po_items_po on purchase_order_items(po_id);

-- =====================================================================================
-- PENDING SALES -- somebody has asked for it and is coming back for it.
-- =====================================================================================
-- "Hold the A05 for me, I'll come Friday" is the most ordinary sentence in a phone shop, and
-- the system had no way to hear it. So the phone stayed on the shelf, somebody else bought it,
-- and on Friday there was an argument.
--
-- A pending sale RESERVES the goods, and it does so the honest way: through the same
-- stock.changeStock() everything else uses, as a 'reserved' movement out. products.stock is
-- therefore what is actually AVAILABLE, the till cannot sell a reserved handset because the
-- number is already gone, and none of this costs the sell screen a single extra read. A
-- serialized unit goes to status 'reserved' and simply stops appearing in the IMEI picker.
--
-- Completing one puts the stock back ('unreserved') and then sells it through the ordinary
-- recordSale, so every rule about stock, IMEIs, discounts, partners and receipts is the one
-- that was already there. Three movements for one handset -- reserved, unreserved, sold -- is
-- not noise: it is what actually happened to it.
do $$ begin
  create type pending_status as enum ('held','completed','cancelled','expired');
exception when duplicate_object then null; end $$;

-- The two movement types the reservation needs, and the unit status that goes with them.
do $$ begin
  alter type movement_type add value if not exists 'reserved';
  alter type movement_type add value if not exists 'unreserved';
exception when others then null; end $$;
do $$ begin
  alter type unit_status add value if not exists 'reserved';
exception when others then null; end $$;

create table if not exists pending_sales (
  id uuid primary key default gen_random_uuid(),
  legacy_id text,                               -- HOLD-0001
  vendor_id uuid not null references vendors(id),
  branch_id uuid references branches(id),
  customer_name text not null,                  -- required here, unlike a sale: a hold with
  customer_phone text,                          -- nobody's name on it is just missing stock
  deposit numeric(14,2) not null default 0,     -- what they left to hold it
  payment_method payment_method,                -- what they said they would pay with, if they said
  financing_partner_id uuid references financing_partners(id),
  notes text,
  status pending_status not null default 'held',
  hold_until date,                              -- what was agreed; nothing expires on its own
  created_by uuid references profiles(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by_name text,
  cancel_reason text,
  sale_group_id uuid                            -- the checkout it became, once it did
);
create index if not exists idx_pending_vendor_status on pending_sales(vendor_id, status, created_at desc);

create table if not exists pending_sale_items (
  id uuid primary key default gen_random_uuid(),
  pending_id uuid not null references pending_sales(id) on delete cascade,
  product_id uuid not null references products(id),
  product_name text not null,
  unit_id uuid references product_units(id),    -- the exact handset being held
  qty integer not null,
  list_price numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0
);
create index if not exists idx_pending_items on pending_sale_items(pending_id);

-- =====================================================================================
-- THE ANDROID APP'S RELEASES.
-- =====================================================================================
-- The app on a phone is a window onto this website, so ordinary updates need no new APK at
-- all -- a shopkeeper gets them the moment they are deployed. An APK is only ever rebuilt
-- when the address or the WebView allowlist changes, which is rare and deliberate.
--
-- When that does happen the new file goes in the `app-releases` bucket and gets a row here,
-- and /download always sends people to whichever row is current. That is why the printed QR
-- code can be printed once: it points at /download, never at a version.
create table if not exists app_releases (
  id uuid primary key default gen_random_uuid(),
  version_name text not null,                   -- what a person reads: '1.3'
  version_code integer not null,                -- what the phone compares: 4
  file_name text not null,                      -- object name inside the app-releases bucket
  url text not null,                            -- its public URL, stored so /download is one read
  size_bytes bigint,
  notes text,                                   -- what changed, shown on the update notice
  is_current boolean not null default false,    -- exactly one row is true; /download follows it
  published_at timestamptz not null default now(),
  published_by uuid references profiles(id)
);
create unique index if not exists app_releases_version_code_idx on app_releases (version_code);
-- Only one release can be the current one. A partial unique index says so in the database
-- rather than trusting every future code path to remember.
create unique index if not exists app_releases_one_current_idx on app_releases (is_current) where is_current;

-- =====================================================================================
-- DATABASE-SIDE AGGREGATES -- "ask the database, don't drag rows" (the Postgres budget).
-- Each has a JavaScript fallback in the code for a deployment that has not run this file yet.
-- =====================================================================================

-- Clicks per product: all-time and since `p_since` (the 30-day recency window), in one read.
create or replace function bo_click_counts(p_since timestamptz)
returns table (product_id uuid, total bigint, recent bigint)
language sql stable as $$
  select product_id, count(*) as total,
         count(*) filter (where clicked_at >= p_since) as recent
  from product_clicks
  where product_id is not null
  group by product_id
$$;

-- Per-vendor sales totals for the manager dashboard: today / week / month / year, one read
-- instead of a year of sales rows.
create or replace function bo_vendor_sales_summary(p_today timestamptz, p_week timestamptz,
                                                   p_month timestamptz, p_year timestamptz)
returns table (vendor_id uuid, today numeric, week numeric, month numeric, year numeric)
language sql stable as $$
  select vendor_id,
         coalesce(sum(total) filter (where sold_at >= p_today), 0) as today,
         coalesce(sum(total) filter (where sold_at >= p_week), 0)  as week,
         coalesce(sum(total) filter (where sold_at >= p_month), 0) as month,
         coalesce(sum(total) filter (where sold_at >= p_year), 0)  as year
  from sales
  where status = 'completed' and sold_at >= p_year
  group by vendor_id
$$;

-- Stock value and active-product count per vendor. Without this the manager's two screens page
-- the WHOLE catalogue of every business to add up two numbers -- 4,500 rows on a thirty-vendor
-- book, and it grows with every product anybody adds. `p_vendor` null = every business.
create or replace function bo_stock_value_by_vendor(p_vendor uuid)
returns table (vendor_id uuid, value numeric, product_count bigint)
language sql stable as $$
  select vendor_id, coalesce(sum(price * stock), 0) as value, count(*) as product_count
  from products
  where active and (p_vendor is null or vendor_id = p_vendor)
  group by vendor_id
$$;

-- The manager's best sellers: units and revenue per product name per business since `p_since`,
-- already ordered and cut to `p_limit`. The fallback reads the YEAR of sales to show ten rows.
create or replace function bo_top_selling(p_since timestamptz, p_limit integer)
returns table (vendor_id uuid, product_name text, qty numeric, revenue numeric)
language sql stable as $$
  select vendor_id, product_name,
         coalesce(sum(qty), 0) as qty, coalesce(sum(total), 0) as revenue
  from sales
  where status = 'completed' and sold_at >= p_since
  group by vendor_id, product_name
  order by qty desc, revenue desc, product_name
  limit p_limit
$$;

-- =====================================================================================
-- STORAGE BUCKETS -- public read. New images go here; legacy drive.google.com URLs keep working.
-- =====================================================================================
insert into storage.buckets (id, name, public) values
  ('product-images', 'product-images', true),
  ('logos', 'logos', true),
  ('profile-photos', 'profile-photos', true),
  -- The Android APK. Public because /download hands the file to anyone with the link, which
  -- is the point of a printed QR code on a shop counter.
  ('app-releases', 'app-releases', true)
on conflict (id) do nothing;

-- =====================================================================================
-- DEFAULT SETTINGS -- the same keys the Apps Script version used, same defaults.
-- =====================================================================================
insert into settings (key, value) values
  ('FreeRegistration', 'Yes'),
  ('commissionRate', '0'),
  ('trialDays', '60'),
  ('hintLifetime', '5'),
  ('hintInterval', '300'),
  ('loadingTime', '0'),
  ('autoSyncSeconds', '120'),
  ('sessionTimeoutMinutes', '0'),
  ('paymentReminderText', ''),
  ('lendingReminderText', ''),
  ('announcement_enabled', 'No'),
  ('announcement_title', 'What''s New'),
  ('announcement_text', ''),
  ('announcement_audience', 'both')
on conflict (key) do nothing;

-- =====================================================================================
-- ATOMIC STOCK ARITHMETIC -- one statement, so two sellers at two tills cannot both read 5,
-- both write 4, and lose a unit. The code falls back to read-then-write when these are absent.
-- =====================================================================================
create or replace function bo_adjust_stock(p_product uuid, p_delta integer)
returns integer language sql volatile as $$
  update products set stock = stock + p_delta, updated_at = now()
  where id = p_product
  returning stock
$$;

create or replace function bo_adjust_branch_stock(p_product uuid, p_branch uuid, p_delta integer)
returns integer language sql volatile as $$
  insert into branch_stock (product_id, branch_id, qty, updated_at)
  values (p_product, p_branch, p_delta, now())
  on conflict (product_id, branch_id) do update
    set qty = branch_stock.qty + excluded.qty, updated_at = now()
  returning qty
$$;

-- Serialized products carry their stock as a maintained count of units in stock.
create or replace function bo_recount_units(p_product uuid)
returns integer language sql volatile as $$
  update products p
  set stock = (select count(*) from product_units u where u.product_id = p_product and u.status = 'in_stock'),
      updated_at = now()
  where p.id = p_product
  returning stock
$$;
