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
