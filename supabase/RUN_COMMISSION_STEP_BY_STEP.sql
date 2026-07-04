-- =============================================================================
-- Commission by fee type — run ONE STEP AT A TIME in Supabase SQL Editor
--
-- How to run:
--   1. Supabase Dashboard → your project → SQL Editor → New query
--   2. Copy ONLY the block for STEP 0, click Run
--   3. If STEP 0 looks OK, run STEP 1, then STEP 2, etc.
--   4. Do NOT paste markdown (no ``` lines) — SQL only
-- =============================================================================


-- ── STEP 0: Check what you already have (read the results) ───────────────────
-- Run this first. If "commission_rates" is missing, run STEP 0b before STEP 1.

SELECT
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'commission_rates') AS has_commission_rates,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'finance_settings') AS has_finance_settings,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'commission_rates' AND column_name = 'pct_fee') AS has_pct_fee_columns,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'appointments') AS has_appointments;


-- ── STEP 0b: Only if STEP 0 shows has_commission_rates = false ───────────────
-- Creates the finance tables from the admin migration (safe to re-run).

CREATE TABLE IF NOT EXISTS public.commission_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('advisor', 'introducer')),
  percentage NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (percentage >= 0 AND percentage <= 100),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT ALL ON public.commission_rates TO service_role;
ALTER TABLE public.commission_rates ENABLE ROW LEVEL SECURITY;


-- ── STEP 1: Add commission-by-fee-type columns ───────────────────────────────
-- Run after STEP 0 shows has_commission_rates = true (or after STEP 0b).

ALTER TABLE public.commission_rates
  ADD COLUMN IF NOT EXISTS pct_fee NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_mortgage_fee NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_insurance_fee NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_other_fee NUMERIC(6,3) NOT NULL DEFAULT 0;


-- ── STEP 2: Copy old single % into the four fee-type columns ─────────────────
-- Skips safely if the legacy "percentage" column does not exist.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'commission_rates'
      AND column_name = 'percentage'
  ) THEN
    UPDATE public.commission_rates
    SET
      pct_fee = COALESCE(percentage, pct_fee, 0),
      pct_mortgage_fee = COALESCE(percentage, pct_mortgage_fee, 0),
      pct_insurance_fee = COALESCE(percentage, pct_insurance_fee, 0),
      pct_other_fee = COALESCE(percentage, pct_other_fee, 0)
    WHERE percentage IS NOT NULL;
  END IF;
END $$;


-- ── STEP 3: RAF bonus setting (£75) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.finance_settings (
  key TEXT PRIMARY KEY,
  num_value INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.finance_settings TO service_role;

INSERT INTO public.finance_settings (key, num_value)
VALUES ('raf_bonus_pence', 7500)
ON CONFLICT (key) DO NOTHING;


-- ── STEP 4: Confirm it worked ────────────────────────────────────────────────

SELECT
  column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'commission_rates'
  AND column_name LIKE 'pct_%'
ORDER BY column_name;

SELECT * FROM public.finance_settings WHERE key = 'raf_bonus_pence';


-- =============================================================================
-- OPTIONAL — only if you also need case refs (MG-2026-0001) and rate history
-- Run these as separate steps AFTER steps 1–4 succeed.
-- =============================================================================


-- ── OPTIONAL A: Case reference column + generator ────────────────────────────

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


-- ── OPTIONAL B: Commission rate change history ───────────────────────────────

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


-- ── OPTIONAL C: Back-fill case refs (only if appointments table exists) ──────

DO $$
DECLARE
  r RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'appointments'
  ) THEN
    RAISE NOTICE 'appointments table not found — skipping case ref back-fill';
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


-- ── OPTIONAL D: Remove case refs from fact-finds (no appointment yet) ────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'appointments'
  ) THEN
    RAISE NOTICE 'appointments table not found — skipping case ref cleanup';
    RETURN;
  END IF;

  UPDATE public.interview_sessions s
  SET case_ref = NULL
  WHERE s.case_ref IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.session_id = s.id
    );
END $$;
