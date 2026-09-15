-- ============================================================================
-- Telephony control panel — firm landline, cloneable agent mobiles, routing rules.
-- Safe to re-run. Prefer applying via migration; this file is the source of truth.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.telephony_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  e164 TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('landline', 'mobile')),
  twilio_sid TEXT,
  is_firm_inbound BOOLEAN NOT NULL DEFAULT false,
  allocated_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS telephony_numbers_one_firm_landline
  ON public.telephony_numbers ((kind))
  WHERE kind = 'landline' AND active = true AND is_firm_inbound = true;

CREATE UNIQUE INDEX IF NOT EXISTS telephony_numbers_allocated_user_unique
  ON public.telephony_numbers (allocated_user_id)
  WHERE allocated_user_id IS NOT NULL AND kind = 'mobile' AND active = true;

CREATE TABLE IF NOT EXISTS public.advisor_telephony (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  allocated_mobile_number_id UUID REFERENCES public.telephony_numbers(id) ON DELETE SET NULL,
  personal_reroute_e164 TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  ring_softphone BOOLEAN NOT NULL DEFAULT true,
  ring_allocated_mobile BOOLEAN NOT NULL DEFAULT false,
  ring_personal_mobile BOOLEAN NOT NULL DEFAULT true,
  use_personal_reroute_as_fallback BOOLEAN NOT NULL DEFAULT true,
  respect_outlook_busy BOOLEAN NOT NULL DEFAULT true,
  respect_hub_appointments BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.telephony_routing_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  timezone TEXT NOT NULL DEFAULT 'Europe/London',
  business_hours JSONB NOT NULL DEFAULT '{
    "mon":[{"start":"09:00","end":"17:30"}],
    "tue":[{"start":"09:00","end":"17:30"}],
    "wed":[{"start":"09:00","end":"17:30"}],
    "thu":[{"start":"09:00","end":"17:30"}],
    "fri":[{"start":"09:00","end":"17:30"}],
    "sat":[],
    "sun":[]
  }'::jsonb,
  out_of_hours_action TEXT NOT NULL DEFAULT 'voicemail'
    CHECK (out_of_hours_action IN ('voicemail', 'reroute_personal', 'ring_anyway')),
  in_appointment_action TEXT NOT NULL DEFAULT 'voicemail'
    CHECK (in_appointment_action IN ('voicemail', 'reroute_personal', 'ring_anyway')),
  no_answer_action TEXT NOT NULL DEFAULT 'voicemail'
    CHECK (no_answer_action IN ('voicemail', 'reroute_personal')),
  unowned_caller_action TEXT NOT NULL DEFAULT 'voicemail'
    CHECK (unowned_caller_action IN ('voicemail', 'ring_fallback_user')),
  fallback_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ring_timeout_seconds INTEGER NOT NULL DEFAULT 25 CHECK (ring_timeout_seconds BETWEEN 10 AND 60),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.telephony_routing_settings
  ADD COLUMN IF NOT EXISTS voice_brand TEXT NOT NULL DEFAULT 'mortgage_easy';

ALTER TABLE public.advisor_telephony
  ADD COLUMN IF NOT EXISTS ring_personal_mobile BOOLEAN NOT NULL DEFAULT true;

INSERT INTO public.telephony_routing_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.telephony_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advisor_telephony ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telephony_routing_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read telephony numbers" ON public.telephony_numbers;
CREATE POLICY "Staff read telephony numbers" ON public.telephony_numbers
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'advisor') OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Staff read advisor telephony" ON public.advisor_telephony;
CREATE POLICY "Staff read advisor telephony" ON public.advisor_telephony
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

DROP POLICY IF EXISTS "Staff read telephony settings" ON public.telephony_routing_settings;
CREATE POLICY "Staff read telephony settings" ON public.telephony_routing_settings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'advisor') OR public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.telephony_numbers TO authenticated;
GRANT SELECT ON public.advisor_telephony TO authenticated;
GRANT SELECT ON public.telephony_routing_settings TO authenticated;
GRANT ALL ON public.telephony_numbers TO service_role;
GRANT ALL ON public.advisor_telephony TO service_role;
GRANT ALL ON public.telephony_routing_settings TO service_role;
