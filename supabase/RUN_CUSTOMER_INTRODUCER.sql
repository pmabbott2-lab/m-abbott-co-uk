-- Customer → introducer links for commission (safe to re-run)

CREATE TABLE IF NOT EXISTS public.customer_introducer_links (
  customer_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  introducer_id UUID NOT NULL REFERENCES public.introducers(id) ON DELETE CASCADE,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.customer_introducer_links TO service_role;

CREATE INDEX IF NOT EXISTS idx_customer_introducer_links_introducer
  ON public.customer_introducer_links (introducer_id);

-- Backfill from appointments and introducer leads (first customer wins).
INSERT INTO public.customer_introducer_links (customer_id, introducer_id, source)
SELECT DISTINCT s.customer_id, a.introducer_id, 'backfill_appointment'
FROM public.appointments a
JOIN public.interview_sessions s ON s.id = a.session_id
WHERE a.introducer_id IS NOT NULL
  AND s.customer_id IS NOT NULL
ON CONFLICT (customer_id) DO NOTHING;

INSERT INTO public.customer_introducer_links (customer_id, introducer_id, source)
SELECT DISTINCT s.customer_id, il.introducer_id, 'backfill_lead'
FROM public.introducer_leads il
JOIN public.interview_sessions s ON s.id = il.session_id
WHERE il.introducer_id IS NOT NULL
  AND s.customer_id IS NOT NULL
ON CONFLICT (customer_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
