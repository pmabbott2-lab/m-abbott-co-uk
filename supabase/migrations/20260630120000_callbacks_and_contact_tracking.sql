-- ============================================================================
-- Call-back requests + advisor contact tracking (last/next contact, contact
-- log, per-advisor opened/seen state for appointments & call-backs).
-- Safe / re-runnable: guarded with IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================================

-- ── Call-back requests ──────────────────────────────────────────────────────
-- A customer who finishes the fact-find can ask for a call back instead of
-- booking a slot. Tied to the customer + their assigned advisor, with a
-- preferred time-of-day window.
CREATE TABLE IF NOT EXISTS public.callback_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.interview_sessions(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  advisor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  preferred_window TEXT NOT NULL CHECK (preferred_window IN ('9-12', '12-4', '4-8')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'closed')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.callback_requests TO authenticated;
GRANT ALL ON public.callback_requests TO service_role;
ALTER TABLE public.callback_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Advisors view all callbacks" ON public.callback_requests;
CREATE POLICY "Advisors view all callbacks" ON public.callback_requests
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'advisor')
    OR public.has_role(auth.uid(), 'admin')
    OR advisor_id = auth.uid()
    OR customer_id = auth.uid()
  );

DROP POLICY IF EXISTS "Advisors update callbacks" ON public.callback_requests;
CREATE POLICY "Advisors update callbacks" ON public.callback_requests
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'advisor') OR public.has_role(auth.uid(), 'admin') OR advisor_id = auth.uid())
  WITH CHECK (public.has_role(auth.uid(), 'advisor') OR public.has_role(auth.uid(), 'admin') OR advisor_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_callback_requests_advisor ON public.callback_requests (advisor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_callback_requests_session ON public.callback_requests (session_id);

-- ── Per-session contact tracking (advisor-only) ─────────────────────────────
-- Holds the advisor's "last contacted" and planned "next contact" timestamps
-- for a customer file. Kept in a dedicated advisor-only table (not on
-- interview_sessions) so the values are never exposed to the customer.
CREATE TABLE IF NOT EXISTS public.session_contact_tracking (
  session_id UUID PRIMARY KEY REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  last_contacted_at TIMESTAMPTZ,
  next_contact_at TIMESTAMPTZ,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.session_contact_tracking TO authenticated;
GRANT ALL ON public.session_contact_tracking TO service_role;
ALTER TABLE public.session_contact_tracking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Advisors view contact tracking" ON public.session_contact_tracking;
CREATE POLICY "Advisors view contact tracking" ON public.session_contact_tracking
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'advisor') OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_session_contact_tracking_next ON public.session_contact_tracking (next_contact_at);

-- ── Customer contact log (advisor-only, append-only timeline) ───────────────
-- A timestamped log of contact events, notes and next-contact changes. The
-- customer profile "History" tab merges this with appointments & call-backs.
CREATE TABLE IF NOT EXISTS public.customer_contact_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('contact', 'note', 'next_contact_set', 'appointment', 'callback')),
  body TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.customer_contact_log TO authenticated;
GRANT ALL ON public.customer_contact_log TO service_role;
ALTER TABLE public.customer_contact_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Advisors view contact log" ON public.customer_contact_log;
CREATE POLICY "Advisors view contact log" ON public.customer_contact_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'advisor') OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_customer_contact_log_session ON public.customer_contact_log (session_id, occurred_at DESC);

-- ── Per-advisor opened/seen state for contacts ──────────────────────────────
-- Records when an advisor first opened a given appointment or call-back so the
-- portal can highlight NEW / unopened contacts.
CREATE TABLE IF NOT EXISTS public.advisor_contact_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advisor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_type TEXT NOT NULL CHECK (contact_type IN ('appointment', 'callback')),
  contact_id UUID NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (advisor_id, contact_type, contact_id)
);
GRANT SELECT ON public.advisor_contact_views TO authenticated;
GRANT ALL ON public.advisor_contact_views TO service_role;
ALTER TABLE public.advisor_contact_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Advisors view own contact views" ON public.advisor_contact_views;
CREATE POLICY "Advisors view own contact views" ON public.advisor_contact_views
  FOR SELECT TO authenticated
  USING (advisor_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_advisor_contact_views_advisor ON public.advisor_contact_views (advisor_id);
