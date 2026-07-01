-- ============================================================================
-- Customer journey milestones + session attention clearing.
-- Safe / re-runnable: guarded with IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================================

-- Track when an advisor last cleared the "needs attention" highlight for a session.
ALTER TABLE public.session_contact_tracking
  ADD COLUMN IF NOT EXISTS session_attention_cleared_at TIMESTAMPTZ;

-- Allow journey milestone entries in the contact log timeline.
ALTER TABLE public.customer_contact_log
  DROP CONSTRAINT IF EXISTS customer_contact_log_entry_type_check;
ALTER TABLE public.customer_contact_log
  ADD CONSTRAINT customer_contact_log_entry_type_check
  CHECK (entry_type IN (
    'contact', 'note', 'next_contact_set', 'appointment', 'callback', 'journey_milestone'
  ));

-- Per-session journey milestones (advisor-confirmed).
CREATE TABLE IF NOT EXISTS public.customer_journey_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  milestone_key TEXT NOT NULL CHECK (milestone_key IN ('appointment_seen', 'id_confirmed', 'aip_completed')),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, milestone_key)
);
GRANT SELECT ON public.customer_journey_milestones TO authenticated;
GRANT ALL ON public.customer_journey_milestones TO service_role;
ALTER TABLE public.customer_journey_milestones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Advisors view journey milestones" ON public.customer_journey_milestones;
CREATE POLICY "Advisors view journey milestones" ON public.customer_journey_milestones
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'advisor') OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Customers view own journey milestones" ON public.customer_journey_milestones;
CREATE POLICY "Customers view own journey milestones" ON public.customer_journey_milestones
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.interview_sessions s
      WHERE s.id = session_id AND s.customer_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_customer_journey_milestones_session
  ON public.customer_journey_milestones (session_id, milestone_key);
