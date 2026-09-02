-- One-shot runner for Supabase SQL editor (same as migration 20260901120000_journey_finance_case_relationship.sql)

-- ── Journey milestones ───────────────────────────────────────────────────────
ALTER TABLE public.customer_journey_milestones
  DROP CONSTRAINT IF EXISTS customer_journey_milestones_milestone_key_check;
ALTER TABLE public.customer_journey_milestones
  ADD CONSTRAINT customer_journey_milestones_milestone_key_check
  CHECK (milestone_key IN (
    'appointment_seen',
    'id_confirmed',
    'aip_completed',
    'offer_received',
    'completion'
  ));

-- ── Commission payout pipeline ───────────────────────────────────────────────
ALTER TABLE public.finance_ledger
  ADD COLUMN IF NOT EXISTS lost_reason TEXT;

-- ── Case mortgage / relationship data (per case session) ─────────────────────
CREATE TABLE IF NOT EXISTS public.case_mortgage_details (
  session_id UUID PRIMARY KEY REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  current_lender TEXT,
  product_expiry_date DATE,
  amount_borrowed_pence BIGINT,
  house_valuation_pence BIGINT,
  current_rate_pct NUMERIC(6,3),
  monthly_payment_pence BIGINT,
  actionable_from_date DATE,
  actionable_note TEXT,
  actionable_refreshed_at TIMESTAMPTZ,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.case_mortgage_details TO authenticated;
GRANT ALL ON public.case_mortgage_details TO service_role;
ALTER TABLE public.case_mortgage_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff view case mortgage details" ON public.case_mortgage_details;
CREATE POLICY "Staff view case mortgage details" ON public.case_mortgage_details
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'advisor') OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_case_mortgage_expiry
  ON public.case_mortgage_details (product_expiry_date)
  WHERE product_expiry_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_case_mortgage_actionable
  ON public.case_mortgage_details (actionable_from_date)
  WHERE actionable_from_date IS NOT NULL;

-- ── Lender remortgage lead-time cache (AI + manual) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.lender_remortgage_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_key TEXT NOT NULL UNIQUE,
  lender_display_name TEXT NOT NULL,
  lead_time_days INT NOT NULL DEFAULT 90 CHECK (lead_time_days >= 0 AND lead_time_days <= 365),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai', 'ai_reviewed')),
  notes TEXT,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.lender_remortgage_policies TO authenticated;
GRANT ALL ON public.lender_remortgage_policies TO service_role;
ALTER TABLE public.lender_remortgage_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff view lender policies" ON public.lender_remortgage_policies;
CREATE POLICY "Staff view lender policies" ON public.lender_remortgage_policies
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'advisor') OR public.has_role(auth.uid(), 'admin'));
