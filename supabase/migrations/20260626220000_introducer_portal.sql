-- Introducer role and portal foundation

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'introducer';

CREATE TYPE public.lead_source AS ENUM (
  'web',
  'telephone',
  'mobile',
  'introducer_portal',
  'referral_link'
);

CREATE TYPE public.referral_channel AS ENUM (
  'voice',
  'text',
  'direct_booking',
  'manual'
);

CREATE TABLE public.introducers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  contact_email TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT introducers_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
GRANT SELECT, INSERT, UPDATE ON public.introducers TO authenticated;
GRANT ALL ON public.introducers TO service_role;
ALTER TABLE public.introducers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Introducers view and update own profile" ON public.introducers
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'advisor'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'advisor'));

CREATE TABLE public.introducer_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  introducer_id UUID NOT NULL REFERENCES public.introducers(id) ON DELETE CASCADE,
  lead_source public.lead_source NOT NULL DEFAULT 'introducer_portal',
  channel public.referral_channel NOT NULL DEFAULT 'manual',
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'booked', 'converted')),
  session_id UUID REFERENCES public.interview_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.introducer_leads TO authenticated;
GRANT ALL ON public.introducer_leads TO service_role;
ALTER TABLE public.introducer_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Introducers manage own leads" ON public.introducer_leads
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.introducers i
      WHERE i.id = introducer_id AND i.user_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'advisor')
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.introducers i
      WHERE i.id = introducer_id AND i.user_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'advisor')
  );

ALTER TABLE public.interview_sessions
  ADD COLUMN introducer_id UUID REFERENCES public.introducers(id) ON DELETE SET NULL,
  ADD COLUMN lead_source public.lead_source,
  ADD COLUMN referral_channel public.referral_channel;

CREATE INDEX ON public.introducers (slug) WHERE active = true;
CREATE INDEX ON public.introducer_leads (introducer_id, created_at DESC);
CREATE INDEX ON public.interview_sessions (introducer_id, started_at DESC);

CREATE POLICY "Introducers view attributed sessions" ON public.interview_sessions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.introducers i
      WHERE i.id = introducer_id AND i.user_id = auth.uid()
    )
  );
