-- Soft-delete for customer fact-finds (recoverable bin for Owner / Admin Supervisor).
ALTER TABLE public.interview_sessions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_interview_sessions_binned
  ON public.interview_sessions (deleted_at)
  WHERE deleted_at IS NOT NULL;
