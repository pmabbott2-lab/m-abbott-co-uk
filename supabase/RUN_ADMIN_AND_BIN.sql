-- One-paste setup for admin levels, permission matrix, finance tables,
-- and customer soft-delete bin. Safe to re-run.
--
-- Supabase dashboard → SQL Editor → New query → paste all of this → Run.

-- ========== Admin levels + permissions + finance ==========
-- (from migrations/20260704120000_admin_levels_and_finance.sql)

DO $$ BEGIN
  CREATE TYPE public.admin_level AS ENUM ('owner', 'supervisor', 'general');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.admin_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  level public.admin_level NOT NULL DEFAULT 'general',
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_profiles TO authenticated;
GRANT ALL ON public.admin_profiles TO service_role;
ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view admin profiles" ON public.admin_profiles;
CREATE POLICY "Admins view admin profiles" ON public.admin_profiles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.admin_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  access TEXT NOT NULL CHECK (access IN ('none', 'view', 'amend')),
  UNIQUE (user_id, permission_key)
);
GRANT SELECT ON public.admin_permissions TO authenticated;
GRANT ALL ON public.admin_permissions TO service_role;
ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view permissions" ON public.admin_permissions;
CREATE POLICY "Admins view permissions" ON public.admin_permissions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR user_id = auth.uid());

ALTER TABLE public.customer_contact_log
  DROP CONSTRAINT IF EXISTS customer_contact_log_entry_type_check;
ALTER TABLE public.customer_contact_log
  ADD CONSTRAINT customer_contact_log_entry_type_check
  CHECK (entry_type IN (
    'contact', 'note', 'next_contact_set', 'appointment', 'callback',
    'journey_milestone', 'history_amend', 'finance'
  ));

ALTER TABLE public.customer_contact_log
  ADD COLUMN IF NOT EXISTS amended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS amended_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_body TEXT,
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  CREATE TYPE public.finance_fee_type AS ENUM ('fee', 'mortgage_fee', 'insurance_fee', 'other_fee');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.finance_line_status AS ENUM ('draft', 'posted', 'amended', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.finance_ledger_kind AS ENUM ('post', 'amend', 'delete', 'commission');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.finance_fee_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  fee_type public.finance_fee_type NOT NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence >= 0),
  note TEXT,
  status public.finance_line_status NOT NULL DEFAULT 'draft',
  batch_id UUID,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.finance_fee_lines TO service_role;
ALTER TABLE public.finance_fee_lines ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.finance_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.interview_sessions(id) ON DELETE SET NULL,
  fee_line_id UUID REFERENCES public.finance_fee_lines(id) ON DELETE SET NULL,
  kind public.finance_ledger_kind NOT NULL,
  fee_type TEXT,
  amount_pence INTEGER NOT NULL,
  is_reversal BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  beneficiary_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  beneficiary_role TEXT,
  commission_pct NUMERIC(6,3),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.finance_ledger TO service_role;
ALTER TABLE public.finance_ledger ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.commission_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('advisor', 'introducer')),
  percentage NUMERIC(6,3) NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT ALL ON public.commission_rates TO service_role;
ALTER TABLE public.commission_rates ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_finance_fee_lines_session ON public.finance_fee_lines (session_id);
CREATE INDEX IF NOT EXISTS idx_finance_ledger_created ON public.finance_ledger (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commission_rates_user ON public.commission_rates (user_id);

-- Seed owner profile for pmabbott2@aol.com (ADMIN_EMAILS bootstrap).
INSERT INTO public.admin_profiles (user_id, level, updated_at)
SELECT u.id, 'owner'::public.admin_level, now()
FROM auth.users u
WHERE lower(u.email) = lower('pmabbott2@aol.com')
ON CONFLICT (user_id) DO UPDATE SET level = 'owner', updated_at = now();

-- ========== Customer soft-delete bin ==========
-- (from migrations/20260704153000_session_soft_delete.sql)

ALTER TABLE public.interview_sessions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_interview_sessions_binned
  ON public.interview_sessions (deleted_at)
  WHERE deleted_at IS NOT NULL;
