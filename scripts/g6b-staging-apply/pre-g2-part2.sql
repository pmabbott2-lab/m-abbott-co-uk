-- >>> 20260630120000_callbacks_and_contact_tracking.sql
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


-- >>> 20260701120000_journey_and_attention.sql
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


-- >>> 20260704120000_admin_levels_and_finance.sql
-- Admin levels (owner / supervisor / general), permission matrix, finance ledger.
-- Safe / re-runnable.

-- ---------------------------------------------------------------------------
-- Admin profiles (level on top of user_roles.admin)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.admin_level AS ENUM ('owner', 'supervisor', 'general');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.admin_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  level public.admin_level NOT NULL DEFAULT 'general',
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_profiles TO authenticated;
GRANT ALL ON public.admin_profiles TO service_role;
ALTER TABLE public.admin_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view admin profiles" ON public.admin_profiles;
CREATE POLICY "Admins view admin profiles" ON public.admin_profiles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Permission matrix for general admins (owner/supervisor ignore this and have all).
CREATE TABLE IF NOT EXISTS public.admin_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  access TEXT NOT NULL CHECK (access IN ('none', 'view', 'amend')),
  UNIQUE (user_id, permission_key)
);
GRANT SELECT ON public.admin_permissions TO authenticated;
GRANT ALL ON public.admin_permissions TO service_role;
ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view permissions" ON public.admin_permissions;
CREATE POLICY "Admins view permissions" ON public.admin_permissions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Contact log: history amendments + finance events
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_contact_log
  DROP CONSTRAINT IF EXISTS customer_contact_log_entry_type_check;
ALTER TABLE public.customer_contact_log
  ADD CONSTRAINT customer_contact_log_entry_type_check
  CHECK (entry_type IN (
    'contact', 'note', 'next_contact_set', 'appointment', 'callback',
    'journey_milestone', 'history_amend', 'finance'
  ));

ALTER TABLE public.customer_contact_log
  ADD COLUMN IF NOT EXISTS amended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS amended_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_body TEXT,
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Finance
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.finance_fee_type AS ENUM ('fee', 'mortgage_fee', 'insurance_fee', 'other_fee');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.finance_line_status AS ENUM ('draft', 'posted', 'amended', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.finance_ledger_kind AS ENUM ('post', 'amend', 'delete', 'commission');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.finance_fee_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  fee_type public.finance_fee_type NOT NULL,
  amount_pence INTEGER NOT NULL CHECK (amount_pence >= 0),
  note TEXT,
  status public.finance_line_status NOT NULL DEFAULT 'draft',
  batch_id UUID,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  posted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.finance_fee_lines TO service_role;
ALTER TABLE public.finance_fee_lines ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.finance_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.interview_sessions(id) ON DELETE SET NULL,
  fee_line_id UUID REFERENCES public.finance_fee_lines(id) ON DELETE SET NULL,
  kind public.finance_ledger_kind NOT NULL,
  fee_type TEXT,
  amount_pence INTEGER NOT NULL,
  is_reversal BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  beneficiary_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  beneficiary_role TEXT,
  commission_pct NUMERIC(6,3),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.finance_ledger TO service_role;
ALTER TABLE public.finance_ledger ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.commission_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('advisor', 'introducer')),
  percentage NUMERIC(6,3) NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT ALL ON public.commission_rates TO service_role;
ALTER TABLE public.commission_rates ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_finance_fee_lines_session ON public.finance_fee_lines (session_id);
CREATE INDEX IF NOT EXISTS idx_finance_ledger_created ON public.finance_ledger (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commission_rates_user ON public.commission_rates (user_id);


-- >>> 20260704153000_session_soft_delete.sql
-- Soft-delete for customer fact-finds (recoverable bin for Owner / Admin Supervisor).
ALTER TABLE public.interview_sessions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_interview_sessions_binned
  ON public.interview_sessions (deleted_at)
  WHERE deleted_at IS NOT NULL;


-- >>> 20260704160000_commission_by_fee_type.sql
-- Per-fee-type commission percentages + RAF bonus amount (pence).
ALTER TABLE public.commission_rates
  ADD COLUMN IF NOT EXISTS pct_fee NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_mortgage_fee NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_insurance_fee NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_other_fee NUMERIC(6,3) NOT NULL DEFAULT 0;

-- Back-fill from legacy single percentage column if present.
UPDATE public.commission_rates
SET
  pct_fee = COALESCE(percentage, 0),
  pct_mortgage_fee = COALESCE(percentage, 0),
  pct_insurance_fee = COALESCE(percentage, 0),
  pct_other_fee = COALESCE(percentage, 0)
WHERE percentage IS NOT NULL
  AND (pct_fee = 0 AND pct_mortgage_fee = 0 AND pct_insurance_fee = 0 AND pct_other_fee = 0);

CREATE TABLE IF NOT EXISTS public.finance_settings (
  key TEXT PRIMARY KEY,
  num_value INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.finance_settings TO service_role;

INSERT INTO public.finance_settings (key, num_value)
VALUES ('raf_bonus_pence', 7500)
ON CONFLICT (key) DO NOTHING;


-- >>> 20260704170000_cases_and_commission_history.sql
-- Case references (multi-case per customer) + commission rate change history.

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

CREATE TABLE IF NOT EXISTS public.commission_rate_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('advisor', 'introducer')),
  fee_type TEXT NOT NULL CHECK (fee_type IN ('fee', 'mortgage_fee', 'insurance_fee', 'other_fee')),
  pct_from NUMERIC(6,3),
  pct_to NUMERIC(6,3) NOT NULL,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.commission_rate_history TO service_role;

CREATE INDEX IF NOT EXISTS idx_commission_rate_history_user
  ON public.commission_rate_history (user_id, created_at DESC);

-- Per-fee commission columns (if not already applied).
ALTER TABLE public.commission_rates
  ADD COLUMN IF NOT EXISTS pct_fee NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_mortgage_fee NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_insurance_fee NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_other_fee NUMERIC(6,3) NOT NULL DEFAULT 0;

UPDATE public.commission_rates
SET
  pct_fee = COALESCE(percentage, pct_fee, 0),
  pct_mortgage_fee = COALESCE(percentage, pct_mortgage_fee, 0),
  pct_insurance_fee = COALESCE(percentage, pct_insurance_fee, 0),
  pct_other_fee = COALESCE(percentage, pct_other_fee, 0)
WHERE percentage IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.finance_settings (
  key TEXT PRIMARY KEY,
  num_value INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.finance_settings TO service_role;

INSERT INTO public.finance_settings (key, num_value)
VALUES ('raf_bonus_pence', 7500)
ON CONFLICT (key) DO NOTHING;

-- Back-fill case refs only for sessions that already have an appointment (true cases).
DO $$
DECLARE
  r RECORD;
BEGIN
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


-- >>> 20260704200000_commission_payout_status.sql
-- Commission payout workflow: pending → paid / rejected on finance_ledger commission rows.

ALTER TABLE public.finance_ledger
  ADD COLUMN IF NOT EXISTS payout_status TEXT,
  ADD COLUMN IF NOT EXISTS payout_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payout_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payout_note TEXT,
  ADD COLUMN IF NOT EXISTS referral_id UUID REFERENCES public.referrals(id) ON DELETE SET NULL;

-- Default existing + new commission rows to pending.
UPDATE public.finance_ledger
SET payout_status = 'pending'
WHERE kind = 'commission' AND (payout_status IS NULL OR payout_status = '');

ALTER TABLE public.finance_ledger
  ALTER COLUMN payout_status SET DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_finance_ledger_commission_payout
  ON public.finance_ledger (beneficiary_role, payout_status, created_at DESC)
  WHERE kind = 'commission';

CREATE INDEX IF NOT EXISTS idx_finance_ledger_referral
  ON public.finance_ledger (referral_id)
  WHERE referral_id IS NOT NULL;

-- Allow rejected on RAF bonus tracking (synced with ledger payout_status).
ALTER TABLE public.referrals DROP CONSTRAINT IF EXISTS referrals_bonus_status_check;
ALTER TABLE public.referrals
  ADD CONSTRAINT referrals_bonus_status_check
  CHECK (bonus_status IN ('none', 'eligible', 'paid', 'rejected'));


-- >>> 20260704210000_customer_introducer_links.sql
-- Customer-level introducer attribution (case → customer → introducer for commission).

CREATE TABLE IF NOT EXISTS public.customer_introducer_links (
  customer_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  introducer_id UUID NOT NULL REFERENCES public.introducers(id) ON DELETE CASCADE,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.customer_introducer_links TO service_role;

CREATE INDEX IF NOT EXISTS idx_customer_introducer_links_introducer
  ON public.customer_introducer_links (introducer_id);


-- >>> 20260706140000_phone_calls.sql
-- Outbound CRM calls + inbound voicemail (Twilio landline).
CREATE TABLE IF NOT EXISTS public.phone_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  advisor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  twilio_call_sid TEXT,
  twilio_recording_sid TEXT,
  direction TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
  call_kind TEXT NOT NULL DEFAULT 'outbound'
    CHECK (call_kind IN ('outbound', 'inbound_voicemail')),
  to_number TEXT NOT NULL,
  from_number TEXT,
  status TEXT NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated', 'ringing', 'in_progress', 'completed', 'busy', 'no_answer', 'failed', 'canceled')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  recording_url TEXT,
  transcript TEXT,
  summary TEXT,
  ai_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (ai_status IN ('pending', 'processing', 'complete', 'failed', 'skipped')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_phone_calls_session ON public.phone_calls (session_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_phone_calls_twilio_sid ON public.phone_calls (twilio_call_sid);
CREATE INDEX IF NOT EXISTS idx_phone_calls_recording_sid ON public.phone_calls (twilio_recording_sid);
CREATE INDEX IF NOT EXISTS idx_phone_calls_inbound_session ON public.phone_calls (session_id, call_kind, started_at DESC);

GRANT SELECT ON public.phone_calls TO authenticated;
GRANT ALL ON public.phone_calls TO service_role;
ALTER TABLE public.phone_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Advisors view phone calls" ON public.phone_calls;
CREATE POLICY "Advisors view phone calls" ON public.phone_calls
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'advisor') OR public.has_role(auth.uid(), 'admin'));


-- >>> 20260713230000_teams_calendar_link.sql
-- Link each advisor to a Microsoft Teams / Outlook diary and sync appointment events.

ALTER TABLE public.advisor_profiles
  ADD COLUMN IF NOT EXISTS ms_user_id text,
  ADD COLUMN IF NOT EXISTS ms_calendar_id text DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS ms_account_email text,
  ADD COLUMN IF NOT EXISTS ms_access_token text,
  ADD COLUMN IF NOT EXISTS ms_refresh_token text,
  ADD COLUMN IF NOT EXISTS ms_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS teams_calendar_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS teams_calendar_linked_at timestamptz;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS ms_event_id text,
  ADD COLUMN IF NOT EXISTS ms_join_url text;

CREATE INDEX IF NOT EXISTS idx_appointments_ms_event_id
  ON public.appointments (ms_event_id)
  WHERE ms_event_id IS NOT NULL;


-- >>> 20260901120000_journey_finance_case_relationship.sql
-- Journey milestones (offer, completion), commission received/lost, case mortgage details, lender policies.

-- ── Journey milestones ───────────────────────────────────────────────────────
ALTER TABLE public.customer_journey_milestones
  DROP CONSTRAINT IF EXISTS customer_journey_milestones_milestone_key_check;
ALTER TABLE public.customer_journey_milestones
  ADD CONSTRAINT customer_journey_milestones_milestone_key_check
  CHECK (milestone_key IN (
    'appointment_seen',
    'id_confirmed',
    'aip_completed',
    'offer_received',
    'completion'
  ));

-- ── Commission payout pipeline ───────────────────────────────────────────────
ALTER TABLE public.finance_ledger
  ADD COLUMN IF NOT EXISTS lost_reason TEXT;

-- Migrate advisor auto-paid rows stay paid; introducer pending stays pending.

-- ── Case mortgage / relationship data (per case session) ─────────────────────
CREATE TABLE IF NOT EXISTS public.case_mortgage_details (
  session_id UUID PRIMARY KEY REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  current_lender TEXT,
  product_expiry_date DATE,
  amount_borrowed_pence BIGINT,
  house_valuation_pence BIGINT,
  current_rate_pct NUMERIC(6,3),
  monthly_payment_pence BIGINT,
  actionable_from_date DATE,
  actionable_note TEXT,
  actionable_refreshed_at TIMESTAMPTZ,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.case_mortgage_details TO authenticated;
GRANT ALL ON public.case_mortgage_details TO service_role;
ALTER TABLE public.case_mortgage_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff view case mortgage details" ON public.case_mortgage_details;
CREATE POLICY "Staff view case mortgage details" ON public.case_mortgage_details
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'advisor') OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_case_mortgage_expiry
  ON public.case_mortgage_details (product_expiry_date)
  WHERE product_expiry_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_case_mortgage_actionable
  ON public.case_mortgage_details (actionable_from_date)
  WHERE actionable_from_date IS NOT NULL;

-- ── Lender remortgage lead-time cache (AI + manual) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.lender_remortgage_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_key TEXT NOT NULL UNIQUE,
  lender_display_name TEXT NOT NULL,
  lead_time_days INT NOT NULL DEFAULT 90 CHECK (lead_time_days >= 0 AND lead_time_days <= 365),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai', 'ai_reviewed')),
  notes TEXT,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.lender_remortgage_policies TO authenticated;
GRANT ALL ON public.lender_remortgage_policies TO service_role;
ALTER TABLE public.lender_remortgage_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff view lender policies" ON public.lender_remortgage_policies;
CREATE POLICY "Staff view lender policies" ON public.lender_remortgage_policies
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'advisor') OR public.has_role(auth.uid(), 'admin'));


-- >>> 20260902164500_staff_contact_tasks.sql
-- Internal staff contact tasks (welcome call, next contact reminders).
-- Advisor/owner/supervisor/admin only — not shown to customers.

CREATE TABLE IF NOT EXISTS staff_contact_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL CHECK (task_type IN ('welcome_call', 'next_contact')),
  due_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS staff_contact_tasks_session_idx ON staff_contact_tasks(session_id);
CREATE INDEX IF NOT EXISTS staff_contact_tasks_due_idx ON staff_contact_tasks(due_at) WHERE completed_at IS NULL;

-- One open welcome call per session; one open next-contact task per session.
CREATE UNIQUE INDEX IF NOT EXISTS staff_contact_tasks_open_welcome_idx
  ON staff_contact_tasks(session_id)
  WHERE task_type = 'welcome_call' AND completed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS staff_contact_tasks_open_next_idx
  ON staff_contact_tasks(session_id)
  WHERE task_type = 'next_contact' AND completed_at IS NULL;

ALTER TABLE staff_contact_tasks ENABLE ROW LEVEL SECURITY;

-- Service role only (server functions use supabaseAdmin).
CREATE POLICY staff_contact_tasks_service ON staff_contact_tasks
  FOR ALL USING (false) WITH CHECK (false);


-- >>> 20260903120000_contact_types_abandoned.sql
-- Extend advisor_contact_views.contact_type for staff tasks + abandoned leads.

ALTER TABLE public.advisor_contact_views
  DROP CONSTRAINT IF EXISTS advisor_contact_views_contact_type_check;

ALTER TABLE public.advisor_contact_views
  ADD CONSTRAINT advisor_contact_views_contact_type_check
  CHECK (contact_type IN ('appointment', 'callback', 'phone_call', 'staff_task', 'abandoned'));


-- >>> 20260917101000_public_booking_test_diary.sql
-- Safe public fields for /book/:slug (no contact details).
CREATE OR REPLACE VIEW public.introducer_public_booking
WITH (security_invoker = false) AS
SELECT id, company_name, slug
FROM public.introducers
WHERE COALESCE(active, true) = true
  AND deleted_at IS NULL;

GRANT SELECT ON public.introducer_public_booking TO anon, authenticated;

-- Mon–Fri 09:00–17:00 Europe/London demo slots for live test advisors (4@ / 5@).
CREATE OR REPLACE FUNCTION public.hub_test_diary_slots(p_date date)
RETURNS TABLE (
  starts_at timestamptz,
  advisor_id uuid,
  advisor_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dow int := EXTRACT(ISODOW FROM p_date)::int; -- 1=Mon .. 7=Sun
  slot timestamptz;
  adv RECORD;
BEGIN
  IF dow < 1 OR dow > 5 THEN
    RETURN;
  END IF;

  FOR adv IN
    SELECT p.id AS id,
           COALESCE(NULLIF(TRIM(p.full_name), ''), p.email, 'Test advisor') AS name
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'advisor'
    LEFT JOIN public.advisor_profiles ap ON ap.user_id = p.id
    WHERE lower(p.email) IN ('4@test.co.uk', '5@test.co.uk')
      AND ap.deleted_at IS NULL
  LOOP
    slot := ((p_date::timestamp + time '09:00') AT TIME ZONE 'Europe/London');
    WHILE slot < ((p_date::timestamp + time '17:00') AT TIME ZONE 'Europe/London') LOOP
      IF slot > now()
         AND NOT EXISTS (
           SELECT 1
           FROM public.appointments a
           WHERE a.advisor_id = adv.id
             AND a.status = 'confirmed'
             AND a.starts_at = slot
         )
      THEN
        starts_at := slot;
        advisor_id := adv.id;
        advisor_name := adv.name;
        RETURN NEXT;
      END IF;
      slot := slot + interval '30 minutes';
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.hub_test_diary_slots(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_test_diary_slots(date) TO anon, authenticated, service_role;


-- >>> 20260917123000_comms_templates_90min_slots.sql
-- 90-minute default appointment slots + communication templates / regulatory footers.
-- Applied remotely 2026-09-17; kept in repo for environments that replay migrations.

CREATE OR REPLACE FUNCTION public.hub_test_diary_slots(p_date date)
RETURNS TABLE (
  starts_at timestamptz,
  advisor_id uuid,
  advisor_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dow int := EXTRACT(ISODOW FROM p_date)::int;
  slot timestamptz;
  adv RECORD;
BEGIN
  IF dow < 1 OR dow > 5 THEN
    RETURN;
  END IF;

  FOR adv IN
    SELECT p.id AS id,
           COALESCE(NULLIF(TRIM(p.full_name), ''), p.email, 'Test advisor') AS name
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'advisor'
    LEFT JOIN public.advisor_profiles ap ON ap.user_id = p.id
    WHERE lower(p.email) IN ('4@test.co.uk', '5@test.co.uk')
      AND ap.deleted_at IS NULL
  LOOP
    slot := ((p_date::timestamp + time '09:00') AT TIME ZONE 'Europe/London');
    WHILE slot < ((p_date::timestamp + time '17:00') AT TIME ZONE 'Europe/London') LOOP
      IF slot > now()
         AND NOT EXISTS (
           SELECT 1
           FROM public.appointments a
           WHERE a.advisor_id = adv.id
             AND a.status = 'confirmed'
             AND a.starts_at = slot
         )
      THEN
        starts_at := slot;
        advisor_id := adv.id;
        advisor_name := adv.name;
        RETURN NEXT;
      END IF;
      slot := slot + interval '90 minutes';
    END LOOP;
  END LOOP;
END;
$$;

UPDATE public.advisor_availability
SET slot_minutes = 90
WHERE slot_minutes = 30;

ALTER TABLE public.advisor_availability
  ALTER COLUMN slot_minutes SET DEFAULT 90;

CREATE TABLE IF NOT EXISTS public.communication_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  email_regulatory_footer text NOT NULL DEFAULT '',
  sms_regulatory_footer text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.communication_settings (id, email_regulatory_footer, sms_regulatory_footer)
VALUES (
  1,
  E'MortgageEasy is a trading name used by this firm. We are authorised and regulated by the Financial Conduct Authority. This email may contain confidential information. If you are not the intended recipient, please delete it and notify us.',
  E'*MortgageEasy is authorised and regulated by the FCA. Info & disclosures: mymortgagehub.uk'
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.communication_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  channel text NOT NULL CHECK (channel IN ('sms', 'email', 'voice')),
  subject text,
  body text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  required_tokens text[] NOT NULL DEFAULT '{}',
  sort_order int NOT NULL DEFAULT 100,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.communication_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.communication_templates(id) ON DELETE CASCADE,
  version int NOT NULL,
  subject text,
  body text NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  change_note text,
  UNIQUE (template_id, version)
);

CREATE INDEX IF NOT EXISTS communication_templates_channel_idx
  ON public.communication_templates (channel);

ALTER TABLE public.communication_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_template_versions ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.communication_settings TO service_role;
GRANT ALL ON public.communication_templates TO service_role;
GRANT ALL ON public.communication_template_versions TO service_role;


-- >>> 20260917163000_advisor_diary_settings.sql
-- Adviser diary availability parameters (pre multi-tenancy).
-- Extends advisor_availability for multiple windows/day and adds settings + date exceptions.

ALTER TABLE public.advisor_availability
  DROP CONSTRAINT IF EXISTS advisor_availability_advisor_id_day_of_week_key;

CREATE INDEX IF NOT EXISTS advisor_availability_advisor_day_idx
  ON public.advisor_availability (advisor_id, day_of_week);

CREATE TABLE IF NOT EXISTS public.advisor_diary_settings (
  advisor_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  slot_minutes int NOT NULL DEFAULT 90 CHECK (slot_minutes BETWEEN 15 AND 240),
  buffer_minutes int NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 180),
  min_notice_minutes int NOT NULL DEFAULT 60 CHECK (min_notice_minutes BETWEEN 0 AND 10080),
  max_horizon_days int NOT NULL DEFAULT 28 CHECK (max_horizon_days BETWEEN 1 AND 180),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT ON public.advisor_diary_settings TO authenticated, anon;
GRANT ALL ON public.advisor_diary_settings TO service_role;
ALTER TABLE public.advisor_diary_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read diary settings for booking"
  ON public.advisor_diary_settings
  FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY "Advisors manage own diary settings"
  ON public.advisor_diary_settings
  FOR ALL TO authenticated
  USING (advisor_id = auth.uid())
  WITH CHECK (advisor_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.advisor_diary_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advisor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exception_date date NOT NULL,
  unavailable boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (advisor_id, exception_date)
);

GRANT SELECT ON public.advisor_diary_exceptions TO authenticated, anon;
GRANT ALL ON public.advisor_diary_exceptions TO service_role;
ALTER TABLE public.advisor_diary_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read diary exceptions for booking"
  ON public.advisor_diary_exceptions
  FOR SELECT TO authenticated, anon
  USING (true);

CREATE POLICY "Advisors manage own diary exceptions"
  ON public.advisor_diary_exceptions
  FOR ALL TO authenticated
  USING (advisor_id = auth.uid())
  WITH CHECK (advisor_id = auth.uid());

CREATE INDEX IF NOT EXISTS advisor_diary_exceptions_advisor_date_idx
  ON public.advisor_diary_exceptions (advisor_id, exception_date);

