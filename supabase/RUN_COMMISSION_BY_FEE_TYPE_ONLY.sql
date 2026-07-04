-- =============================================================================
-- Commission by fee type — paste this ENTIRE file into Supabase SQL Editor and Run
-- Safe to re-run. Fixes: "Run the commission-by-fee-type SQL migration first."
-- =============================================================================

-- Create commission_rates if finance migration was never run
CREATE TABLE IF NOT EXISTS public.commission_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('advisor', 'introducer')),
  percentage NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (percentage >= 0 AND percentage <= 100),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT ALL ON public.commission_rates TO service_role;
ALTER TABLE public.commission_rates ENABLE ROW LEVEL SECURITY;

-- Per-fee-type columns
ALTER TABLE public.commission_rates
  ADD COLUMN IF NOT EXISTS pct_fee NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_mortgage_fee NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_insurance_fee NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_other_fee NUMERIC(6,3) NOT NULL DEFAULT 0;

-- Copy legacy single % into all four columns (if percentage column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'commission_rates'
      AND column_name = 'percentage'
  ) THEN
    UPDATE public.commission_rates
    SET
      pct_fee = COALESCE(percentage, pct_fee, 0),
      pct_mortgage_fee = COALESCE(percentage, pct_mortgage_fee, 0),
      pct_insurance_fee = COALESCE(percentage, pct_insurance_fee, 0),
      pct_other_fee = COALESCE(percentage, pct_other_fee, 0)
    WHERE percentage IS NOT NULL;
  END IF;
END $$;

-- RAF bonus setting (£75)
CREATE TABLE IF NOT EXISTS public.finance_settings (
  key TEXT PRIMARY KEY,
  num_value INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.finance_settings TO service_role;

INSERT INTO public.finance_settings (key, num_value)
VALUES ('raf_bonus_pence', 7500)
ON CONFLICT (key) DO NOTHING;

-- Rate change history (used when you save commission rates in the app)
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

-- Reload PostgREST schema cache (fixes "schema cache" errors right after migration)
NOTIFY pgrst, 'reload schema';

-- Verify
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'commission_rates'
  AND column_name LIKE 'pct_%'
ORDER BY column_name;
