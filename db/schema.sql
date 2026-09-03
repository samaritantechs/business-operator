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
    ('received','sold','transfer_out','transfer_in','returned','adjustment','cancelled_restock','lent');
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
  stock integer not null default 0,             -- authoritative for non-serialized; a maintained count for serialized
  is_serialized boolean not null default false, -- true -> every unit carries an IMEI/serial in product_units
  supplier text,
  reorder_point integer not null default 20,
  active boolean not null default true,
  image1_url text,
  image2_url text,
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
         p.image1_url, p.image2_url, p.listing_type, p.price_unit, p.location,
         v.name as vendor_name, v.phone as vendor_phone, v.logo_url as vendor_logo,
         v.business_type as vendor_type, v.address as vendor_address, v.currency
  from products p
  join vendors v on v.id = p.vendor_id
  where p.active and v.active and not v.restricted;

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

-- =====================================================================================
-- STORAGE BUCKETS -- public read. New images go here; legacy drive.google.com URLs keep working.
-- =====================================================================================
insert into storage.buckets (id, name, public) values
  ('product-images', 'product-images', true),
  ('logos', 'logos', true),
  ('profile-photos', 'profile-photos', true)
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
