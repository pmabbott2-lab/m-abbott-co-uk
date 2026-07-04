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
