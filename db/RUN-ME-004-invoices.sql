-- =====================================================================================
-- RUN-ME 004 -- commission invoices, and the automatic block that follows an unpaid one.
-- =====================================================================================
-- ONE PART. Nothing here adds a type, so there is nothing that must be committed before the
-- next statement can use it. Paste the whole file, run it once. Safe to run twice.
--
-- Everything works WITHOUT this table: invoices simply cannot be issued and the auto-block
-- stays off, and both screens say so. Nothing that already works stops working. (CLAUDE.md:
-- "Every code path that depends on a migration must work without it.")
--
-- WHY A TABLE AT ALL, when the figure can be recomputed from sales?
--   1. vendors.registered_on is RESET when a vendor is deactivated and reactivated, and every
--      billing period is anchored on it. Recomputing after that moves every historical period
--      and no past invoice could ever be reproduced. An invoice is a document a business keeps;
--      it has to be frozen at the moment it is issued.
--   2. The auto-block needs to know what is unpaid without re-scanning every sale of every
--      vendor. With the amount stored, deciding who to block is one indexed read.
--   3. Issuing twice for one period is a second demand for money already owed once. The unique
--      index below makes that impossible rather than merely unlikely.
-- =====================================================================================

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null,
  vendor_id uuid not null references vendors(id),

  -- FROZEN AT ISSUE, never recomputed. period_end is EXCLUSIVE: a sale at exactly period_end
  -- belongs to the next invoice, so no sale is billed twice and none falls between two.
  period_start timestamptz not null,
  period_end timestamptz not null,

  sales_total numeric(14,2) not null default 0,
  rate numeric(8,4) not null default 0,          -- percent, e.g. 0.6000
  due numeric(14,2) not null default 0,
  currency text,

  status text not null default 'unpaid',         -- unpaid | part_paid | paid | waived
  amount_paid numeric(14,2) not null default 0,
  paid_at timestamptz,
  paid_method text,                              -- Cash | Lipa Number | Bank
  paid_reference text,                           -- the mobile-money id: the only audit trail there is
  paid_by text,
  waived_reason text,

  issued_at timestamptz not null default now(),
  blocked_at timestamptz,                        -- when the auto-block acted on THIS invoice
  unblocked_at timestamptz,

  constraint invoices_status_ck check (status in ('unpaid','part_paid','paid','waived')),
  constraint invoices_period_ck check (period_end > period_start),
  constraint invoices_amounts_ck check (due >= 0 and amount_paid >= 0 and sales_total >= 0)
);

-- ONE INVOICE PER VENDOR PER PERIOD. This is the idempotency, and it lives in the database
-- rather than in a check the issuing code performs -- two runs at once would both pass a check
-- and only one can win a unique index.
create unique index if not exists invoices_vendor_period_idx on invoices (vendor_id, period_start);
create unique index if not exists invoices_number_idx on invoices (number);

-- The auto-block's only question: "which unpaid invoices are past their due date?"
create index if not exists idx_invoices_unpaid on invoices (status, period_end) where status in ('unpaid','part_paid');
create index if not exists idx_invoices_vendor on invoices (vendor_id, period_start desc);

-- =====================================================================================
-- AFTERWARDS, in the app: Management -> Commission Rate. Set it to 0.6 for 0.6% of sales.
-- The automatic block stays OFF until you switch it on in Management, on purpose: a blocked
-- vendor cannot ring up a single sale, so it is not a setting to inherit by accident.
-- =====================================================================================
