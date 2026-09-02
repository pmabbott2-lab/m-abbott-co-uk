-- Audit log for owner/supervisor actions while in Advisor view or Introducer view.
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.view_as_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  view_type TEXT NOT NULL CHECK (view_type IN ('advisor', 'introducer')),
  acting_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_view_as_audit_log_created
  ON public.view_as_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_view_as_audit_log_view_type
  ON public.view_as_audit_log (view_type, created_at DESC);

GRANT ALL ON public.view_as_audit_log TO service_role;
