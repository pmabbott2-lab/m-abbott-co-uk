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
