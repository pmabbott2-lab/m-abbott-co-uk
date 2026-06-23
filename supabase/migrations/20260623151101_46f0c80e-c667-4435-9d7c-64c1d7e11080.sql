ALTER TABLE public.interview_sessions
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS followup_count integer NOT NULL DEFAULT 0;