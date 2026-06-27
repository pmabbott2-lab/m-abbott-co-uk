-- ============================================================================
-- Apply: Introducer portal + Diary/Booking + SMS  (run once in Supabase SQL Editor)
-- Safe / re-runnable: guarded with IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Introducer portal
-- ---------------------------------------------------------------------------
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'introducer';

DO $$ BEGIN
  CREATE TYPE public.lead_source AS ENUM ('web','telephone','mobile','introducer_portal','referral_link');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.referral_channel AS ENUM ('voice','text','direct_booking','manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.introducers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  contact_email TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT introducers_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
GRANT SELECT, INSERT, UPDATE ON public.introducers TO authenticated;
GRANT ALL ON public.introducers TO service_role;
ALTER TABLE public.introducers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Introducers view and update own profile" ON public.introducers;
CREATE POLICY "Introducers view and update own profile" ON public.introducers
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'advisor'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'advisor'));

CREATE TABLE IF NOT EXISTS public.introducer_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  introducer_id UUID NOT NULL REFERENCES public.introducers(id) ON DELETE CASCADE,
  lead_source public.lead_source NOT NULL DEFAULT 'introducer_portal',
  channel public.referral_channel NOT NULL DEFAULT 'manual',
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','booked','converted')),
  session_id UUID REFERENCES public.interview_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.introducer_leads TO authenticated;
GRANT ALL ON public.introducer_leads TO service_role;
ALTER TABLE public.introducer_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Introducers manage own leads" ON public.introducer_leads;
CREATE POLICY "Introducers manage own leads" ON public.introducer_leads
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.introducers i WHERE i.id = introducer_id AND i.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'advisor')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.introducers i WHERE i.id = introducer_id AND i.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'advisor')
  );

CREATE INDEX IF NOT EXISTS idx_introducers_slug_active ON public.introducers (slug) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_introducer_leads_introducer_created ON public.introducer_leads (introducer_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2) Diary, appointments, SMS logging
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.appointment_status AS ENUM ('pending','confirmed','cancelled','completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.advisor_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advisor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_minutes INT NOT NULL DEFAULT 30,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (advisor_id, day_of_week)
);
GRANT SELECT ON public.advisor_availability TO authenticated, anon;
GRANT ALL ON public.advisor_availability TO service_role;
ALTER TABLE public.advisor_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read availability for booking" ON public.advisor_availability;
CREATE POLICY "Anyone can read availability for booking" ON public.advisor_availability
  FOR SELECT TO authenticated, anon USING (active = true);

DROP POLICY IF EXISTS "Advisors manage own availability" ON public.advisor_availability;
CREATE POLICY "Advisors manage own availability" ON public.advisor_availability
  FOR ALL TO authenticated
  USING (advisor_id = auth.uid() OR public.has_role(auth.uid(), 'advisor'))
  WITH CHECK (advisor_id = auth.uid() AND public.has_role(auth.uid(), 'advisor'));

CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advisor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  introducer_id UUID REFERENCES public.introducers(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.introducer_leads(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status public.appointment_status NOT NULL DEFAULT 'confirmed',
  lead_source public.lead_source,
  referral_channel public.referral_channel,
  session_id UUID REFERENCES public.interview_sessions(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Advisors view all appointments" ON public.appointments;
CREATE POLICY "Advisors view all appointments" ON public.appointments
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'advisor') OR advisor_id = auth.uid());

DROP POLICY IF EXISTS "Introducers view own appointments" ON public.appointments;
CREATE POLICY "Introducers view own appointments" ON public.appointments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.introducers i WHERE i.id = introducer_id AND i.user_id = auth.uid()));

DROP POLICY IF EXISTS "Advisors update appointments" ON public.appointments;
CREATE POLICY "Advisors update appointments" ON public.appointments
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'advisor') OR advisor_id = auth.uid())
  WITH CHECK (public.has_role(auth.uid(), 'advisor') OR advisor_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  body TEXT NOT NULL,
  twilio_sid TEXT,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.introducer_leads(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sms_messages TO authenticated;
GRANT ALL ON public.sms_messages TO service_role;
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Advisors view SMS log" ON public.sms_messages;
CREATE POLICY "Advisors view SMS log" ON public.sms_messages
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'advisor'));

CREATE INDEX IF NOT EXISTS idx_appointments_advisor_starts ON public.appointments (advisor_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_introducer_starts ON public.appointments (introducer_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_starts_confirmed ON public.appointments (starts_at) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_sms_messages_created ON public.sms_messages (created_at DESC);

ALTER TABLE public.introducer_leads
  ADD COLUMN IF NOT EXISTS appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 3) Session channel + customer appointment visibility
-- ---------------------------------------------------------------------------
ALTER TABLE public.interview_sessions
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'voice' CHECK (channel IN ('voice','text'));

DROP POLICY IF EXISTS "Customers view appointments for own sessions" ON public.appointments;
CREATE POLICY "Customers view appointments for own sessions" ON public.appointments
  FOR SELECT TO authenticated
  USING (
    session_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.interview_sessions s
      WHERE s.id = appointments.session_id AND s.customer_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 4) Session allocation: per-fact-find advisor assignment + main-admin role
--    (migration 20260627090000_session_allocation.sql)
-- ---------------------------------------------------------------------------

-- Main-admin DB role. Granted automatically to ADMIN_EMAILS on first sign-in.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'admin';

-- Many-to-many: an interview_session (fact-find) can be allocated to many advisors.
CREATE TABLE IF NOT EXISTS public.session_advisors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  advisor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, advisor_id)
);
GRANT SELECT ON public.session_advisors TO authenticated;
GRANT ALL ON public.session_advisors TO service_role;
ALTER TABLE public.session_advisors ENABLE ROW LEVEL SECURITY;

-- Advisors can read their own allocations; the main admin can read all.
-- Writes happen via service_role in server functions, so no write policy needed.
DROP POLICY IF EXISTS "Advisors view own allocations" ON public.session_advisors;
CREATE POLICY "Advisors view own allocations" ON public.session_advisors
  FOR SELECT TO authenticated
  USING (advisor_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_session_advisors_advisor ON public.session_advisors (advisor_id);
CREATE INDEX IF NOT EXISTS idx_session_advisors_session ON public.session_advisors (session_id);

-- ---------------------------------------------------------------------------
-- 5) Introducer company codes + advisor codes
--    (migration 20260627100000_company_and_advisor_codes.sql)
-- ---------------------------------------------------------------------------

-- Introducer company code: a shared 4-digit code so multiple introducer user
-- accounts can belong to the SAME company. Customers they refer are credited to
-- the company (group/report by company_code) while keeping per-introducer
-- attribution (introducer_id) intact. Codes are shared, so NOT unique.
ALTER TABLE public.introducers ADD COLUMN IF NOT EXISTS company_code TEXT;
ALTER TABLE public.introducers DROP CONSTRAINT IF EXISTS introducers_company_code_format;
ALTER TABLE public.introducers
  ADD CONSTRAINT introducers_company_code_format
  CHECK (company_code IS NULL OR company_code ~ '^[0-9]{4}$');
CREATE INDEX IF NOT EXISTS idx_introducers_company_code ON public.introducers (company_code);

-- Advisor codes: each advisor gets a unique 5-char uppercase alphanumeric code,
-- used by admins for quick (bulk) allocation. Stored in a dedicated per-advisor
-- table keyed by user_id.
CREATE TABLE IF NOT EXISTS public.advisor_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT advisor_profiles_code_format CHECK (code ~ '^[A-Z0-9]{5}$')
);
GRANT SELECT ON public.advisor_profiles TO authenticated;
GRANT ALL ON public.advisor_profiles TO service_role;
ALTER TABLE public.advisor_profiles ENABLE ROW LEVEL SECURITY;

-- Advisors (and the admin) can read advisor codes so the admin can allocate by
-- code and each advisor can see their own. Writes happen via service_role.
DROP POLICY IF EXISTS "Advisors view advisor codes" ON public.advisor_profiles;
CREATE POLICY "Advisors view advisor codes" ON public.advisor_profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'advisor'));

CREATE INDEX IF NOT EXISTS idx_advisor_profiles_code ON public.advisor_profiles (code);

-- ---------------------------------------------------------------------------
-- 6) Staff soft-delete (recoverable bin) + invite-link registration
--    (migration 20260627110000_staff_invites_and_bin.sql)
-- ---------------------------------------------------------------------------

-- Soft-delete (recoverable bin) for advisors & introducers. An advisor is
-- binned by removing their `advisor` role and stamping advisor_profiles.deleted_at
-- (the row + code are KEPT so restore re-grants the role with the same code).
-- An introducer is binned by removing their `introducer` role, setting active =
-- false AND stamping introducers.deleted_at (distinguishes a binned introducer
-- from a merely-inactive one). Restore clears deleted_at + reactivates.
ALTER TABLE public.advisor_profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.introducers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Staff invitations: an admin creates an invite encoding the intended role
-- (advisor|introducer) and, for introducers, optional company linkage (create a
-- new company vs join an existing 4-digit company_code). The public /register
-- route resolves the invite by its secret token via a service-role server
-- function (NOT client RLS) and consumes it on successful signup.
CREATE TABLE IF NOT EXISTS public.staff_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  role public.app_role NOT NULL,
  email TEXT,
  company_code TEXT,
  company_name TEXT,
  create_company BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  used_at TIMESTAMPTZ,
  used_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT staff_invitations_role_chk CHECK (role IN ('advisor','introducer')),
  CONSTRAINT staff_invitations_company_code_format
    CHECK (company_code IS NULL OR company_code ~ '^[0-9]{4}$')
);
GRANT SELECT, INSERT, UPDATE ON public.staff_invitations TO authenticated;
GRANT ALL ON public.staff_invitations TO service_role;
ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff manage invitations" ON public.staff_invitations;
CREATE POLICY "Staff manage invitations" ON public.staff_invitations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'advisor') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'advisor') OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_staff_invitations_token ON public.staff_invitations (token);
CREATE INDEX IF NOT EXISTS idx_staff_invitations_open ON public.staff_invitations (created_at DESC) WHERE used_at IS NULL;

-- ---------------------------------------------------------------------------
-- 7) Refer a friend (RAF): admin-created referral links + referral ledger
--    (migration 20260627120000_refer_a_friend.sql)
-- ---------------------------------------------------------------------------
--
-- RAF is ADMIN-DRIVEN. An admin mints a referral CODE for a specific REFERRER
-- (an existing customer/user, or an off-system person captured via name +
-- phone). The referrer shares /raf/<code> with their friends. A friend landing
-- via that link gets a 'raf_ref' cookie (kept SEPARATE from the introducer
-- 'introducer_ref' cookie so the two never collide); on the friend's first
-- authenticated /home load the referral is recorded crediting the referrer. The
-- bonus is TRACKED ONLY (no payouts) — the admin advances bonus_status.

-- The code minted by an admin and tied to one referrer. referrer_user_id is
-- nullable so an admin can create a link for someone not yet in the system.
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
