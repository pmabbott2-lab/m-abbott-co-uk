-- Introducer amendments, finance audit log, admin staff invites.
-- Run in Supabase SQL Editor after existing finance/admin migrations.

-- Allow admin role on staff invitations
ALTER TABLE public.staff_invitations DROP CONSTRAINT IF EXISTS staff_invitations_role_chk;
ALTER TABLE public.staff_invitations
  ADD CONSTRAINT staff_invitations_role_chk
  CHECK (role IN ('advisor', 'introducer', 'admin'));

-- Customer introducer link effective dating
ALTER TABLE public.customer_introducer_links
  ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Amendment history (audit + commission effective dating)
CREATE TABLE IF NOT EXISTS public.introducer_amendment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.interview_sessions(id) ON DELETE SET NULL,
  previous_introducer_id UUID REFERENCES public.introducers(id) ON DELETE SET NULL,
  new_introducer_id UUID REFERENCES public.introducers(id) ON DELETE SET NULL,
  company_code TEXT,
  company_name TEXT,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  commission_refreshed BOOLEAN NOT NULL DEFAULT false,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_introducer_amendment_customer
  ON public.introducer_amendment_history (customer_id, effective_from DESC);

GRANT ALL ON public.introducer_amendment_history TO service_role;

-- Combined finance audit (rates + introducer changes)
CREATE TABLE IF NOT EXISTS public.finance_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_type TEXT NOT NULL,
  subject_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id UUID REFERENCES public.interview_sessions(id) ON DELETE SET NULL,
  role TEXT,
  fee_type TEXT,
  summary TEXT NOT NULL,
  detail JSONB,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finance_audit_log_created
  ON public.finance_audit_log (created_at DESC);

GRANT ALL ON public.finance_audit_log TO service_role;
