-- Case references (multi-case per customer) + commission rate change history.

ALTER TABLE public.interview_sessions
  ADD COLUMN IF NOT EXISTS case_ref TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_sessions_case_ref
  ON public.interview_sessions (case_ref)
  WHERE case_ref IS NOT NULL;

CREATE SEQUENCE IF NOT EXISTS public.case_ref_seq START 1;

CREATE OR REPLACE FUNCTION public.allocate_case_ref()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 'MG-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.case_ref_seq')::text, 4, '0');
END;
$$;
GRANT EXECUTE ON FUNCTION public.allocate_case_ref() TO service_role;

CREATE TABLE IF NOT EXISTS public.commission_rate_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('advisor', 'introducer')),
  fee_type TEXT NOT NULL CHECK (fee_type IN ('fee', 'mortgage_fee', 'insurance_fee', 'other_fee')),
  pct_from NUMERIC(6,3),
  pct_to NUMERIC(6,3) NOT NULL,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.commission_rate_history TO service_role;

CREATE INDEX IF NOT EXISTS idx_commission_rate_history_user
  ON public.commission_rate_history (user_id, created_at DESC);

-- Per-fee commission columns (if not already applied).
ALTER TABLE public.commission_rates
  ADD COLUMN IF NOT EXISTS pct_fee NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_mortgage_fee NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_insurance_fee NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_other_fee NUMERIC(6,3) NOT NULL DEFAULT 0;

UPDATE public.commission_rates
SET
  pct_fee = COALESCE(percentage, pct_fee, 0),
  pct_mortgage_fee = COALESCE(percentage, pct_mortgage_fee, 0),
  pct_insurance_fee = COALESCE(percentage, pct_insurance_fee, 0),
  pct_other_fee = COALESCE(percentage, pct_other_fee, 0)
WHERE percentage IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.finance_settings (
  key TEXT PRIMARY KEY,
  num_value INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.finance_settings TO service_role;

INSERT INTO public.finance_settings (key, num_value)
VALUES ('raf_bonus_pence', 7500)
ON CONFLICT (key) DO NOTHING;

-- Back-fill case refs only for sessions that already have an appointment (true cases).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT s.id FROM public.interview_sessions s
    WHERE s.case_ref IS NULL
      AND EXISTS (SELECT 1 FROM public.appointments a WHERE a.session_id = s.id)
    ORDER BY s.started_at ASC
  LOOP
    UPDATE public.interview_sessions
    SET case_ref = public.allocate_case_ref()
    WHERE id = r.id;
  END LOOP;
END $$;
