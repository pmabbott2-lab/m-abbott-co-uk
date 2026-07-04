-- Commission payouts — run in Supabase SQL Editor (safe to re-run)
-- Adds pending / paid / rejected workflow on commission ledger rows.

ALTER TABLE public.finance_ledger
  ADD COLUMN IF NOT EXISTS payout_status TEXT,
  ADD COLUMN IF NOT EXISTS payout_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payout_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payout_note TEXT,
  ADD COLUMN IF NOT EXISTS referral_id UUID REFERENCES public.referrals(id) ON DELETE SET NULL;

UPDATE public.finance_ledger
SET payout_status = 'pending'
WHERE kind = 'commission' AND (payout_status IS NULL OR payout_status = '');

ALTER TABLE public.finance_ledger
  ALTER COLUMN payout_status SET DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_finance_ledger_commission_payout
  ON public.finance_ledger (beneficiary_role, payout_status, created_at DESC)
  WHERE kind = 'commission';

CREATE INDEX IF NOT EXISTS idx_finance_ledger_referral
  ON public.finance_ledger (referral_id)
  WHERE referral_id IS NOT NULL;

ALTER TABLE public.referrals DROP CONSTRAINT IF EXISTS referrals_bonus_status_check;
ALTER TABLE public.referrals
  ADD CONSTRAINT referrals_bonus_status_check
  CHECK (bonus_status IN ('none', 'eligible', 'paid', 'rejected'));

NOTIFY pgrst, 'reload schema';

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'finance_ledger'
  AND column_name IN ('payout_status', 'referral_id');
