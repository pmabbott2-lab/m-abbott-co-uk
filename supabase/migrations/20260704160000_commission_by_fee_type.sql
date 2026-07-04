-- Per-fee-type commission percentages + RAF bonus amount (pence).
ALTER TABLE public.commission_rates
  ADD COLUMN IF NOT EXISTS pct_fee NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_mortgage_fee NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_insurance_fee NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_other_fee NUMERIC(6,3) NOT NULL DEFAULT 0;

-- Back-fill from legacy single percentage column if present.
UPDATE public.commission_rates
SET
  pct_fee = COALESCE(percentage, 0),
  pct_mortgage_fee = COALESCE(percentage, 0),
  pct_insurance_fee = COALESCE(percentage, 0),
  pct_other_fee = COALESCE(percentage, 0)
WHERE percentage IS NOT NULL
  AND (pct_fee = 0 AND pct_mortgage_fee = 0 AND pct_insurance_fee = 0 AND pct_other_fee = 0);

CREATE TABLE IF NOT EXISTS public.finance_settings (
  key TEXT PRIMARY KEY,
  num_value INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.finance_settings TO service_role;

INSERT INTO public.finance_settings (key, num_value)
VALUES ('raf_bonus_pence', 7500)
ON CONFLICT (key) DO NOTHING;
