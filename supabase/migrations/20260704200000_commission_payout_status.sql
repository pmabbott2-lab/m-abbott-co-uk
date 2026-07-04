-- Commission payout workflow: pending → paid / rejected on finance_ledger commission rows.

ALTER TABLE public.finance_ledger
  ADD COLUMN IF NOT EXISTS payout_status TEXT,
  ADD COLUMN IF NOT EXISTS payout_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payout_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payout_note TEXT,
  ADD COLUMN IF NOT EXISTS referral_id UUID REFERENCES public.referrals(id) ON DELETE SET NULL;

-- Default existing + new commission rows to pending.
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

-- Allow rejected on RAF bonus tracking (synced with ledger payout_status).
ALTER TABLE public.referrals DROP CONSTRAINT IF EXISTS referrals_bonus_status_check;
ALTER TABLE public.referrals
  ADD CONSTRAINT referrals_bonus_status_check
  CHECK (bonus_status IN ('none', 'eligible', 'paid', 'rejected'));
