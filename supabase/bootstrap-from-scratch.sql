-- =============================================================================
-- FactFind — Supabase bootstrap (run in SQL Editor on a fresh or reset project)
-- Dashboard: https://supabase.com/dashboard/project/_/sql/new
-- =============================================================================
-- This replaces all incremental migrations with one idempotent setup.
-- Section A optionally wipes existing app tables (safe to skip on first run).

-- -----------------------------------------------------------------------------
-- A) Optional reset — uncomment to drop existing FactFind schema
-- -----------------------------------------------------------------------------
/*
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TABLE IF EXISTS public.advisor_notes CASCADE;
DROP TABLE IF EXISTS public.interview_answers CASCADE;
DROP TABLE IF EXISTS public.interview_messages CASCADE;
DROP TABLE IF EXISTS public.interview_sessions CASCADE;
DROP TABLE IF EXISTS public.user_roles CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TYPE IF EXISTS public.session_status CASCADE;
DROP TYPE IF EXISTS public.app_role CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role) CASCADE;
*/

-- -----------------------------------------------------------------------------
-- B) Types
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('customer', 'advisor');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.session_status AS ENUM ('in_progress', 'submitted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- C) Core tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

CREATE TABLE IF NOT EXISTS public.interview_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.session_status NOT NULL DEFAULT 'in_progress',
  current_section TEXT NOT NULL DEFAULT 'personal',
  current_question_index INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary TEXT,
  followup_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.interview_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('avatar', 'customer')),
  text TEXT NOT NULL,
  section TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.interview_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  section TEXT NOT NULL,
  field_key TEXT NOT NULL,
  field_label TEXT NOT NULL,
  value TEXT,
  structured_value JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, section, field_key)
);

CREATE TABLE IF NOT EXISTS public.advisor_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  advisor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backfill columns if tables already existed from an older migration
ALTER TABLE public.interview_sessions
  ADD COLUMN IF NOT EXISTS summary TEXT,
  ADD COLUMN IF NOT EXISTS followup_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.interview_answers
  ADD COLUMN IF NOT EXISTS structured_value JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone TEXT;

-- -----------------------------------------------------------------------------
-- D) Functions
-- -----------------------------------------------------------------------------
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

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.email, NEW.raw_user_meta_data->>'phone')
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- E) RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advisor_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
CREATE POLICY "Users view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'advisor'));

DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users view own roles" ON public.user_roles;
CREATE POLICY "Users view own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'advisor'));

DROP POLICY IF EXISTS "Only advisors can insert user roles" ON public.user_roles;
CREATE POLICY "Only advisors can insert user roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'advisor'));

DROP POLICY IF EXISTS "Only advisors can update user roles" ON public.user_roles;
CREATE POLICY "Only advisors can update user roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'advisor'))
  WITH CHECK (public.has_role(auth.uid(), 'advisor'));

DROP POLICY IF EXISTS "Only advisors can delete user roles" ON public.user_roles;
CREATE POLICY "Only advisors can delete user roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'advisor'));

DROP POLICY IF EXISTS "Customer manages own sessions" ON public.interview_sessions;
CREATE POLICY "Customer manages own sessions" ON public.interview_sessions
  FOR ALL TO authenticated
  USING (customer_id = auth.uid() OR public.has_role(auth.uid(), 'advisor'))
  WITH CHECK (customer_id = auth.uid());

DROP POLICY IF EXISTS "Access messages for own sessions" ON public.interview_messages;
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

DROP POLICY IF EXISTS "Access answers for own sessions" ON public.interview_answers;
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

DROP POLICY IF EXISTS "Advisors manage notes; customers read their own session notes" ON public.advisor_notes;
CREATE POLICY "Advisors manage notes; customers read their own session notes" ON public.advisor_notes
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'advisor')
    OR EXISTS (SELECT 1 FROM public.interview_sessions s WHERE s.id = session_id AND s.customer_id = auth.uid())
  );

DROP POLICY IF EXISTS "Advisors insert notes" ON public.advisor_notes;
CREATE POLICY "Advisors insert notes" ON public.advisor_notes
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'advisor') AND advisor_id = auth.uid());

DROP POLICY IF EXISTS "Advisors update own notes" ON public.advisor_notes;
CREATE POLICY "Advisors update own notes" ON public.advisor_notes
  FOR UPDATE TO authenticated
  USING (advisor_id = auth.uid() AND public.has_role(auth.uid(), 'advisor'));

DROP POLICY IF EXISTS "Advisors delete own notes" ON public.advisor_notes;
CREATE POLICY "Advisors delete own notes" ON public.advisor_notes
  FOR DELETE TO authenticated
  USING (advisor_id = auth.uid() AND public.has_role(auth.uid(), 'advisor'));

-- -----------------------------------------------------------------------------
-- F) Grants & function execute permissions
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_sessions TO authenticated;
GRANT ALL ON public.interview_sessions TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_messages TO authenticated;
GRANT ALL ON public.interview_messages TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_answers TO authenticated;
GRANT ALL ON public.interview_answers TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.advisor_notes TO authenticated;
GRANT ALL ON public.advisor_notes TO service_role;

REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

-- -----------------------------------------------------------------------------
-- G) Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS interview_sessions_customer_started_idx
  ON public.interview_sessions (customer_id, started_at DESC);
CREATE INDEX IF NOT EXISTS interview_messages_session_created_idx
  ON public.interview_messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS interview_answers_session_section_idx
  ON public.interview_answers (session_id, section);

-- -----------------------------------------------------------------------------
-- H) Storage (avatars bucket — optional)
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Avatars are readable by their owner" ON storage.objects;
CREATE POLICY "Avatars are readable by their owner"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
CREATE POLICY "Users can upload their own avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
CREATE POLICY "Users can update their own avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
CREATE POLICY "Users can delete their own avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- -----------------------------------------------------------------------------
-- I) Backfill profiles for existing auth users (if re-running on a used project)
-- -----------------------------------------------------------------------------
INSERT INTO public.profiles (id, full_name, email, phone)
SELECT u.id, u.raw_user_meta_data->>'full_name', u.email, u.raw_user_meta_data->>'phone'
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'customer'::public.app_role
FROM auth.users u
LEFT JOIN public.user_roles r ON r.user_id = u.id AND r.role = 'customer'
WHERE r.id IS NULL;

-- Done.
SELECT 'FactFind Supabase bootstrap complete' AS status;
