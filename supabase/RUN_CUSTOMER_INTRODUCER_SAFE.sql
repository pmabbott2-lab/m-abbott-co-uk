-- Customer → introducer links — SAFE version (run in Supabase SQL Editor)
-- Safe to re-run. Skips backfill steps if optional columns/tables are missing.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'introducers'
  ) THEN
    RAISE EXCEPTION 'Table introducers does not exist. Run your introducer portal migration first (supabase/APPLY_NEW_FEATURES.sql or diary migration).';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.customer_introducer_links (
  customer_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  introducer_id UUID NOT NULL REFERENCES public.introducers(id) ON DELETE CASCADE,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.customer_introducer_links TO service_role;

CREATE INDEX IF NOT EXISTS idx_customer_introducer_links_introducer
  ON public.customer_introducer_links (introducer_id);

-- Backfill from appointments (when session_id is set)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'appointments'
  ) THEN
    INSERT INTO public.customer_introducer_links (customer_id, introducer_id, source)
    SELECT DISTINCT s.customer_id, a.introducer_id, 'backfill_appointment'
    FROM public.appointments a
    JOIN public.interview_sessions s ON s.id = a.session_id
    WHERE a.introducer_id IS NOT NULL
      AND s.customer_id IS NOT NULL
      AND a.session_id IS NOT NULL
    ON CONFLICT (customer_id) DO NOTHING;
  END IF;
END $$;

-- Backfill from introducer leads (only if session_id column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'introducer_leads' AND column_name = 'session_id'
  ) THEN
    INSERT INTO public.customer_introducer_links (customer_id, introducer_id, source)
    SELECT DISTINCT s.customer_id, il.introducer_id, 'backfill_lead'
    FROM public.introducer_leads il
    JOIN public.interview_sessions s ON s.id = il.session_id
    WHERE il.introducer_id IS NOT NULL
      AND s.customer_id IS NOT NULL
      AND il.session_id IS NOT NULL
    ON CONFLICT (customer_id) DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

SELECT 'customer_introducer_links OK' AS result, count(*) AS link_count
FROM public.customer_introducer_links;
