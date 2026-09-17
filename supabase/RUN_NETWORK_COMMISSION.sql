-- Network commission statements (monthly intake from the network).
-- Paste into Supabase SQL Editor if not applied via migration.

create table if not exists public.network_commission_statements (
  id uuid primary key default gen_random_uuid(),
  period_month date not null,
  status text not null default 'draft'
    check (status in ('draft', 'annotated', 'validated', 'locked')),
  notes text,
  raw_source text,
  validated_by uuid references auth.users (id) on delete set null,
  validated_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_month)
);

create table if not exists public.network_commission_lines (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.network_commission_statements (id) on delete cascade,
  line_no int not null default 0,
  customer_name text,
  customer_email text,
  case_ref text,
  fee_type text not null default 'fee'
    check (fee_type in ('fee', 'mortgage_fee', 'insurance_fee', 'other_fee')),
  amount_received_pence int not null default 0,
  network_product text,
  raw_json jsonb,
  allocation_status text not null default 'unmatched'
    check (allocation_status in ('unmatched', 'matched', 'allocated', 'skipped')),
  matched_customer_id uuid references auth.users (id) on delete set null,
  matched_session_id uuid,
  fee_line_id uuid,
  annotation text,
  allocated_by uuid references auth.users (id) on delete set null,
  allocated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists network_commission_lines_statement_idx
  on public.network_commission_lines (statement_id);

create index if not exists network_commission_lines_status_idx
  on public.network_commission_lines (allocation_status);

alter table public.network_commission_statements enable row level security;
alter table public.network_commission_lines enable row level security;
