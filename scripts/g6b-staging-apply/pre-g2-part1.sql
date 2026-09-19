-- >>> 20260623111307_50629eaf-7628-4438-b901-b2b543b96be4.sql

-- Roles
CREATE TYPE public.app_role AS ENUM ('customer', 'advisor');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Profile policies
CREATE POLICY "Users view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'advisor'));
CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE POLICY "Users view own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'advisor'));

-- Auto-create profile + default customer role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.email);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'customer');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Interview sessions
CREATE TYPE public.session_status AS ENUM ('in_progress', 'submitted');

CREATE TABLE public.interview_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.session_status NOT NULL DEFAULT 'in_progress',
  current_section TEXT NOT NULL DEFAULT 'personal',
  current_question_index INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_sessions TO authenticated;
GRANT ALL ON public.interview_sessions TO service_role;
ALTER TABLE public.interview_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customer manages own sessions" ON public.interview_sessions
  FOR ALL TO authenticated
  USING (customer_id = auth.uid() OR public.has_role(auth.uid(), 'advisor'))
  WITH CHECK (customer_id = auth.uid());

-- Messages (transcript)
CREATE TABLE public.interview_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('avatar','customer')),
  text TEXT NOT NULL,
  section TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_messages TO authenticated;
GRANT ALL ON public.interview_messages TO service_role;
ALTER TABLE public.interview_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Access messages for own sessions" ON public.interview_messages
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.interview_sessions s
    WHERE s.id = session_id
      AND (s.customer_id = auth.uid() OR public.has_role(auth.uid(), 'advisor'))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.interview_sessions s
    WHERE s.id = session_id AND s.customer_id = auth.uid()
  ));

-- Structured answers
CREATE TABLE public.interview_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  field_key TEXT NOT NULL,
  field_label TEXT NOT NULL,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, section, field_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_answers TO authenticated;
GRANT ALL ON public.interview_answers TO service_role;
ALTER TABLE public.interview_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Access answers for own sessions" ON public.interview_answers
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.interview_sessions s
    WHERE s.id = session_id
      AND (s.customer_id = auth.uid() OR public.has_role(auth.uid(), 'advisor'))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.interview_sessions s
    WHERE s.id = session_id AND s.customer_id = auth.uid()
  ));

-- Advisor notes
CREATE TABLE public.advisor_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  advisor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.advisor_notes TO authenticated;
GRANT ALL ON public.advisor_notes TO service_role;
ALTER TABLE public.advisor_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Advisors manage notes; customers read their own session notes" ON public.advisor_notes
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'advisor')
    OR EXISTS (SELECT 1 FROM public.interview_sessions s WHERE s.id = session_id AND s.customer_id = auth.uid())
  );
CREATE POLICY "Advisors insert notes" ON public.advisor_notes
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'advisor') AND advisor_id = auth.uid());
CREATE POLICY "Advisors update own notes" ON public.advisor_notes
  FOR UPDATE TO authenticated
  USING (advisor_id = auth.uid() AND public.has_role(auth.uid(), 'advisor'));
CREATE POLICY "Advisors delete own notes" ON public.advisor_notes
  FOR DELETE TO authenticated
  USING (advisor_id = auth.uid() AND public.has_role(auth.uid(), 'advisor'));

CREATE INDEX ON public.interview_sessions (customer_id, started_at DESC);
CREATE INDEX ON public.interview_messages (session_id, created_at);
CREATE INDEX ON public.interview_answers (session_id, section);


-- >>> 20260623111337_2323de94-b58a-46dd-bb73-a5e11b9bd295.sql

REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;


-- >>> 20260623151101_46f0c80e-c667-4435-9d7c-64c1d7e11080.sql
ALTER TABLE public.interview_sessions
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS followup_count integer NOT NULL DEFAULT 0;

-- >>> 20260623152617_63fae123-13a5-4c4c-a468-8bfb2abeb207.sql
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- >>> 20260623152936_810c1fb6-2940-4241-b11a-23646c92d8bc.sql
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon;

-- >>> 20260623163632_3573c0d1-4b3e-4f19-83c0-9cf56ed0b18f.sql

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

CREATE POLICY "Only advisors can insert user roles"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'advisor'));

CREATE POLICY "Only advisors can update user roles"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'advisor'))
  WITH CHECK (public.has_role(auth.uid(), 'advisor'));

CREATE POLICY "Only advisors can delete user roles"
  ON public.user_roles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'advisor'));

CREATE POLICY "Avatars are readable by their owner"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload their own avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);


-- >>> 20260624100000_add_structured_value.sql
-- Typed facts extracted from free-text answers (income, deposit, postcode, etc.)
ALTER TABLE public.interview_answers
  ADD COLUMN IF NOT EXISTS structured_value jsonb DEFAULT '{}'::jsonb;


-- >>> 20260626130000_add_profile_phone.sql
-- Add a mobile/phone number to profiles and capture it from signup metadata.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;

-- Update the new-user trigger so the phone supplied at signup is stored.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.email,
    NEW.raw_user_meta_data->>'phone'
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    phone = COALESCE(EXCLUDED.phone, public.profiles.phone);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Backfill phone for any existing auth users who provided it at signup.
UPDATE public.profiles p
SET phone = u.raw_user_meta_data->>'phone'
FROM auth.users u
WHERE u.id = p.id
  AND p.phone IS NULL
  AND (u.raw_user_meta_data->>'phone') IS NOT NULL;


-- >>> 20260626220000_introducer_portal.sql
-- Introducer role and portal foundation

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'introducer';

CREATE TYPE public.lead_source AS ENUM (
  'web',
  'telephone',
  'mobile',
  'introducer_portal',
  'referral_link'
);

CREATE TYPE public.referral_channel AS ENUM (
  'voice',
  'text',
  'direct_booking',
  'manual'
);

CREATE TABLE public.introducers (
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

CREATE POLICY "Introducers view and update own profile" ON public.introducers
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'advisor'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'advisor'));

CREATE TABLE public.introducer_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  introducer_id UUID NOT NULL REFERENCES public.introducers(id) ON DELETE CASCADE,
  lead_source public.lead_source NOT NULL DEFAULT 'introducer_portal',
  channel public.referral_channel NOT NULL DEFAULT 'manual',
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'booked', 'converted')),
  session_id UUID REFERENCES public.interview_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.introducer_leads TO authenticated;
GRANT ALL ON public.introducer_leads TO service_role;
ALTER TABLE public.introducer_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Introducers manage own leads" ON public.introducer_leads
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.introducers i
      WHERE i.id = introducer_id AND i.user_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'advisor')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.introducers i
      WHERE i.id = introducer_id AND i.user_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'advisor')
  );

CREATE INDEX ON public.introducers (slug) WHERE active = true;
CREATE INDEX ON public.introducer_leads (introducer_id, created_at DESC);


-- >>> 20260626230000_diary_sms_booking.sql
-- Diary, appointments, and SMS message logging

CREATE TYPE public.appointment_status AS ENUM ('pending', 'confirmed', 'cancelled', 'completed');

CREATE TABLE public.advisor_availability (
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

CREATE POLICY "Anyone can read availability for booking" ON public.advisor_availability
  FOR SELECT TO authenticated, anon
  USING (active = true);

CREATE POLICY "Advisors manage own availability" ON public.advisor_availability
  FOR ALL TO authenticated
  USING (advisor_id = auth.uid() OR public.has_role(auth.uid(), 'advisor'))
  WITH CHECK (advisor_id = auth.uid() AND public.has_role(auth.uid(), 'advisor'));

CREATE TABLE public.appointments (
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

CREATE POLICY "Advisors view all appointments" ON public.appointments
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'advisor') OR advisor_id = auth.uid());

CREATE POLICY "Introducers view own appointments" ON public.appointments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.introducers i
      WHERE i.id = introducer_id AND i.user_id = auth.uid()
    )
  );

CREATE POLICY "Advisors update appointments" ON public.appointments
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'advisor') OR advisor_id = auth.uid())
  WITH CHECK (public.has_role(auth.uid(), 'advisor') OR advisor_id = auth.uid());

CREATE TABLE public.sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
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

CREATE POLICY "Advisors view SMS log" ON public.sms_messages
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'advisor'));

CREATE INDEX ON public.appointments (advisor_id, starts_at);
CREATE INDEX ON public.appointments (introducer_id, starts_at DESC);
CREATE INDEX ON public.appointments (starts_at) WHERE status = 'confirmed';
CREATE INDEX ON public.sms_messages (created_at DESC);

ALTER TABLE public.introducer_leads
  ADD COLUMN appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL;


-- >>> 20260626240000_session_channel_and_appointment_rls.sql
-- Session channel + customer appointment visibility

ALTER TABLE public.interview_sessions
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'voice'
  CHECK (channel IN ('voice', 'text'));

CREATE POLICY "Customers view appointments for own sessions" ON public.appointments
  FOR SELECT TO authenticated
  USING (
    session_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.interview_sessions s
      WHERE s.id = appointments.session_id AND s.customer_id = auth.uid()
    )
  );


-- >>> 20260627090000_session_allocation.sql
-- ============================================================================
-- Session allocation: per-fact-find advisor assignment + main-admin role
-- Safe / re-runnable: guarded with IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================================

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


-- >>> 20260627100000_company_and_advisor_codes.sql
-- ============================================================================
-- Introducer company codes + advisor codes
-- Safe / re-runnable: guarded with IF NOT EXISTS / DROP CONSTRAINT IF EXISTS.
-- ============================================================================

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


-- >>> 20260627110000_staff_invites_and_bin.sql
-- ============================================================================
-- Staff soft-delete (recoverable bin) + invite-link registration
-- Safe / re-runnable: guarded with IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Soft-delete (recoverable bin) for advisors & introducers
-- ---------------------------------------------------------------------------
-- An advisor is "binned" by removing their `advisor` role and stamping
-- advisor_profiles.deleted_at. The row + code are KEPT so a restore re-grants
-- the role and preserves the same advisor code.
ALTER TABLE public.advisor_profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- An introducer is "binned" by removing their `introducer` role, setting
-- introducers.active = false AND stamping introducers.deleted_at. deleted_at
-- distinguishes a binned introducer from one that is merely inactive. A restore
-- clears deleted_at, sets active = true and re-grants the role.
ALTER TABLE public.introducers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 2) Staff invitations (invite-link registration for advisors & introducers)
-- ---------------------------------------------------------------------------
-- An admin creates an invite encoding the intended role (advisor|introducer)
-- and, for introducers, optional company linkage (create a new company vs join
-- an existing 4-digit company_code). The public /register route resolves the
-- invite by its secret token via a service-role server function (NOT client
-- RLS) and consumes it on successful signup.
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

-- Only advisors/admins can see or manage invitations from the client. The
-- public registration route never reads this table directly — it goes through a
-- service-role server function that resolves the token.
DROP POLICY IF EXISTS "Staff manage invitations" ON public.staff_invitations;
CREATE POLICY "Staff manage invitations" ON public.staff_invitations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'advisor') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'advisor') OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_staff_invitations_token ON public.staff_invitations (token);
CREATE INDEX IF NOT EXISTS idx_staff_invitations_open ON public.staff_invitations (created_at DESC) WHERE used_at IS NULL;


-- >>> 20260627120000_refer_a_friend.sql
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

