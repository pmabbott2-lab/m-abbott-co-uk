-- Commission payouts — SAFE version (run in Supabase SQL Editor)
-- If this fails, read the error — usually finance_ledger is missing (run RUN_ADMIN_AND_BIN.sql first).

-- Prerequisite check (will error with a clear message if finance_ledger missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'finance_ledger'
  ) THEN
    RAISE EXCEPTION 'Table finance_ledger does not exist. Run supabase/RUN_ADMIN_AND_BIN.sql first, then re-run this script.';
  END IF;
END $$;

ALTER TABLE public.finance_ledger
  ADD COLUMN IF NOT EXISTS payout_status TEXT,
  ADD COLUMN IF NOT EXISTS payout_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payout_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payout_note TEXT;

-- referral_id only if referrals table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'referrals'
  ) THEN
    ALTER TABLE public.finance_ledger
      ADD COLUMN IF NOT EXISTS referral_id UUID REFERENCES public.referrals(id) ON DELETE SET NULL;
  END IF;
END $$;

UPDATE public.finance_ledger
SET payout_status = 'pending'
WHERE kind = 'commission' AND (payout_status IS NULL OR payout_status = '');

ALTER TABLE public.finance_ledger
  ALTER COLUMN payout_status SET DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_finance_ledger_commission_payout
  ON public.finance_ledger (beneficiary_role, payout_status, created_at DESC)
  WHERE kind = 'commission';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'finance_ledger' AND column_name = 'referral_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_finance_ledger_referral
      ON public.finance_ledger (referral_id)
      WHERE referral_id IS NOT NULL;
  END IF;
END $$;

-- Referrals bonus status (skip if referrals table missing)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'referrals'
  ) THEN
    ALTER TABLE public.referrals DROP CONSTRAINT IF EXISTS referrals_bonus_status_check;
    ALTER TABLE public.referrals
      ADD CONSTRAINT referrals_bonus_status_check
      CHECK (bonus_status IN ('none', 'eligible', 'paid', 'rejected'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

SELECT 'commission_payouts OK' AS result,
       column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'finance_ledger'
  AND column_name IN ('payout_status', 'payout_at', 'referral_id');
