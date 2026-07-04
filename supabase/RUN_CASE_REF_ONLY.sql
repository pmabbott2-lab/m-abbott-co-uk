-- =============================================================================
-- Case references — paste this ENTIRE file into Supabase SQL Editor and Run
-- Fixes: column interview_sessions.case_ref does not exist
-- Safe to re-run
-- =============================================================================

ALTER TABLE public.interview_sessions
  ADD COLUMN IF NOT EXISTS case_ref TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_interview_sessions_case_ref
  ON public.interview_sessions (case_ref)
  WHERE case_ref IS NOT NULL;

CREATE SEQUENCE IF NOT EXISTS public.case_ref_seq START 1;

CREATE OR REPLACE FUNCTION public.allocate_case_ref()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN 'MG-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.case_ref_seq')::text, 4, '0');
END;
$$;
GRANT EXECUTE ON FUNCTION public.allocate_case_ref() TO service_role;

-- Back-fill case refs only where an appointment already exists (legacy data).
DO $$
DECLARE
  r RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'appointments'
  ) THEN
    RAISE NOTICE 'appointments table not found — skipping back-fill';
    RETURN;
  END IF;

  FOR r IN
    SELECT s.id FROM public.interview_sessions s
    WHERE s.case_ref IS NULL
      AND EXISTS (SELECT 1 FROM public.appointments a WHERE a.session_id = s.id)
    ORDER BY s.started_at ASC
  LOOP
    UPDATE public.interview_sessions
    SET case_ref = public.allocate_case_ref()
    WHERE id = r.id;
  END LOOP;
END $$;

-- Reload API schema cache (fixes errors right after adding the column)
NOTIFY pgrst, 'reload schema';

-- Verify
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'interview_sessions'
  AND column_name = 'case_ref';
