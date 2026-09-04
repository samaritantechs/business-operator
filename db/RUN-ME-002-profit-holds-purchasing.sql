-- =====================================================================================
-- RUN-ME 002 -- profit, customers, purchase orders and holds.
-- =====================================================================================
-- Everything added since the first deployment, in the order it must be run. All of it is
-- additive: db/schema.sql already carries the same definitions for a fresh database, and every
-- code path works WITHOUT this file (cost simply reads as zero, and the two new screens say
-- there is nothing there). Nothing here drops or rewrites anything.
--
-- HOW TO RUN IT. Supabase -> SQL Editor. The editor sends whatever you paste as ONE statement,
-- so a timeout anywhere rolls back all of it. This file is therefore in THREE PARTS and they
-- must be pasted and run SEPARATELY, in order.
--
-- Part 1 is not optional-in-a-different-way from the others: Postgres will not let a new enum
-- value be USED in the same transaction that adds it, so parts 2 and 3 fail outright if part 1
-- has not already been committed on its own. Run part 1, wait for "Success", then part 2, then
-- part 3.
--
-- Safe to run twice. Every statement is IF NOT EXISTS or an idempotent DO block.
-- =====================================================================================


-- =====================================================================================
-- PART 1 of 3 -- the types. RUN THIS ON ITS OWN AND WAIT FOR IT TO FINISH.
-- =====================================================================================
-- Paste from here to the end of Part 1, run it, then come back for Part 2.

do $$ begin
  create type po_status as enum ('ordered','received','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type pending_status as enum ('held','completed','cancelled','expired');
exception when duplicate_object then null; end $$;

-- A hold takes goods off the shelf without selling them, and puts them back if the customer
-- never comes. products.stock therefore means AVAILABLE, which is what stops the till selling
-- a reserved handset twice.
alter type movement_type add value if not exists 'reserved';
alter type movement_type add value if not exists 'unreserved';
alter type unit_status  add value if not exists 'reserved';

-- END OF PART 1. Run it, see "Success", then continue below.


-- =====================================================================================
-- PART 2 of 3 -- the columns. Fast: these are metadata changes, not table rewrites.
-- =====================================================================================

-- WHAT THE SHOP PAID, and what a sale actually earned. unit_cost is a SNAPSHOT taken at the
-- till: buy the same handset cheaper next month and last month's profit must not move.
-- Sellers never see either -- that is enforced in the API (api/_lib/bo/_shared.js -> stripCost).
alter table if exists products add column if not exists cost_price numeric(14,2) not null default 0;
alter table if exists sales    add column if not exists unit_cost  numeric(14,2) not null default 0;

-- WHO BOUGHT IT. On the sale rather than in a customers table that would be nine parts empty,
-- and on every line of the checkout, the same denormalisation seller_name already uses.
alter table if exists sales add column if not exists customer_name text;
alter table if exists sales add column if not exists customer_phone text;

-- "What has this customer bought?" is this index. Partial, because most sales have no customer
-- and there is no sense indexing blanks.
create index if not exists idx_sales_customer on sales (vendor_id, customer_phone, sold_at desc)
  where customer_phone is not null;

-- A third product photo, if you are on a database made before it existed.
alter table if exists products add column if not exists image3_url text;

-- END OF PART 2.


-- =====================================================================================
-- PART 3 of 3 -- the new tables.
-- =====================================================================================

-- ------------------------------------------------------------------ purchase orders
-- Stock you have ordered and not yet got. Receiving is the only way an order becomes stock and
-- it goes through the ordinary 'received' movement, so a delivery is in the ledger like
-- everything else. A partial delivery is the normal case: a line carries what was ORDERED and
-- what has been RECEIVED so far, and the order stays open until they match.
create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  legacy_id text,
  vendor_id uuid not null references vendors(id),
  branch_id uuid references branches(id),
  supplier text,
  reference text,
  notes text,
  status po_status not null default 'ordered',
  expected_at date,
  created_by uuid references profiles(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by_name text,
  cancel_reason text
);
create index if not exists idx_po_vendor_status on purchase_orders(vendor_id, status, created_at desc);

create table if not exists purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  product_id uuid not null references products(id),
  product_name text not null,
  qty integer not null,
  received_qty integer not null default 0,
  unit_cost numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0
);
create index if not exists idx_po_items_po on purchase_order_items(po_id);

-- ------------------------------------------------------------------ holds
-- "Keep the A05 for me, I'll come Friday." The goods come off the available count as a
-- 'reserved' movement; collecting puts them back and sells them through the ordinary sale.
-- Nothing expires by itself: hold_until is what was agreed, and a person decides.
create table if not exists pending_sales (
  id uuid primary key default gen_random_uuid(),
  legacy_id text,
  vendor_id uuid not null references vendors(id),
  branch_id uuid references branches(id),
  customer_name text not null,
  customer_phone text,
  deposit numeric(14,2) not null default 0,
  payment_method payment_method,
  financing_partner_id uuid references financing_partners(id),
  notes text,
  status pending_status not null default 'held',
  hold_until date,
  created_by uuid references profiles(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by_name text,
  cancel_reason text,
  sale_group_id uuid
);
create index if not exists idx_pending_vendor_status on pending_sales(vendor_id, status, created_at desc);

create table if not exists pending_sale_items (
  id uuid primary key default gen_random_uuid(),
  pending_id uuid not null references pending_sales(id) on delete cascade,
  product_id uuid not null references products(id),
  product_name text not null,
  unit_id uuid references product_units(id),
  qty integer not null,
  list_price numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0
);
create index if not exists idx_pending_items on pending_sale_items(pending_id);

-- END OF PART 3. That is everything.
--
-- AFTERWARDS, in the app: put a Cost Price on the products you sell most. Until you do, the
-- Profit report counts those lines as costing nothing and SAYS SO at the top of itself -- it
-- will not quietly show you a margin that is not real. From then on, receiving a purchase order
-- keeps the cost up to date on its own.
