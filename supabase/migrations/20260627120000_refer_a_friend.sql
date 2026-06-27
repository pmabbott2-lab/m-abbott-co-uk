-- ============================================================================
-- Refer a friend (RAF): admin-created referral links + referral ledger
-- Safe / re-runnable: guarded with IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================================
--
-- Model: RAF is ADMIN-DRIVEN. An admin mints a referral CODE for a specific
-- REFERRER (an existing customer/user, or an off-system person identified by
-- name + phone). The referrer shares /raf/<code> with their friends. When a
-- friend lands via that link a 'raf_ref' cookie is set (kept SEPARATE from the
-- introducer 'introducer_ref' cookie so the two never collide); on the friend's
-- first authenticated /home load the referral is recorded crediting the
-- referrer. The bonus is TRACKED ONLY (no payouts): the admin advances
-- bonus_status from the dashboard.

-- The code minted by an admin and tied to one referrer. referrer_user_id is
-- nullable so an admin can create a link for someone not yet in the system
-- (captured via referrer_name + referrer_phone instead).
CREATE TABLE IF NOT EXISTS public.referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  referrer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  referrer_name TEXT,
  referrer_phone TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT referral_codes_code_format CHECK (code ~ '^[A-Za-z0-9]{4,16}$')
);
GRANT SELECT, INSERT, UPDATE ON public.referral_codes TO authenticated;
GRANT ALL ON public.referral_codes TO service_role;
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;

-- Only staff (admin/advisor) read referral codes in-app. The public /raf/<code>
-- resolution + the friend's claim run through the service-role client, so no
-- anon policy is needed. Writes happen via service_role in server functions.
DROP POLICY IF EXISTS "Staff manage referral codes" ON public.referral_codes;
CREATE POLICY "Staff manage referral codes" ON public.referral_codes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'advisor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'advisor'));

CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON public.referral_codes (code);
CREATE INDEX IF NOT EXISTS idx_referral_codes_referrer ON public.referral_codes (referrer_user_id);

-- The referral ledger. One row per friend credited to a referrer.
--   status:       pending → signed_up → qualified → rewarded
--   bonus_status: none → eligible → paid  (tracked only; no payout integration)
CREATE TABLE IF NOT EXISTS public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code_id UUID REFERENCES public.referral_codes(id) ON DELETE SET NULL,
  code TEXT,
  referrer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  referred_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  referred_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','signed_up','qualified','rewarded')),
  bonus_status TEXT NOT NULL DEFAULT 'none'
    CHECK (bonus_status IN ('none','eligible','paid')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A friend can only be credited once per code.
  UNIQUE (code, referred_user_id)
);
GRANT SELECT, INSERT, UPDATE ON public.referrals TO authenticated;
GRANT ALL ON public.referrals TO service_role;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- Only staff (admin/advisor) monitor the ledger in-app. Inserts (friend claim)
-- and bonus updates happen via service_role in server functions.
DROP POLICY IF EXISTS "Staff view referrals" ON public.referrals;
CREATE POLICY "Staff view referrals" ON public.referrals
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'advisor'));

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals (referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON public.referrals (referred_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON public.referrals (code);
CREATE INDEX IF NOT EXISTS idx_referrals_created ON public.referrals (created_at DESC);
