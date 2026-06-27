-- Diary, appointments, and SMS message logging

CREATE TYPE public.appointment_status AS ENUM ('pending', 'confirmed', 'cancelled', 'completed');

CREATE TABLE public.advisor_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advisor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_minutes INT NOT NULL DEFAULT 30,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (advisor_id, day_of_week)
);
GRANT SELECT ON public.advisor_availability TO authenticated, anon;
GRANT ALL ON public.advisor_availability TO service_role;
ALTER TABLE public.advisor_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read availability for booking" ON public.advisor_availability
  FOR SELECT TO authenticated, anon
  USING (active = true);

CREATE POLICY "Advisors manage own availability" ON public.advisor_availability
  FOR ALL TO authenticated
  USING (advisor_id = auth.uid() OR public.has_role(auth.uid(), 'advisor'))
  WITH CHECK (advisor_id = auth.uid() AND public.has_role(auth.uid(), 'advisor'));

CREATE TABLE public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advisor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  introducer_id UUID REFERENCES public.introducers(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.introducer_leads(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status public.appointment_status NOT NULL DEFAULT 'confirmed',
  lead_source public.lead_source,
  referral_channel public.referral_channel,
  session_id UUID REFERENCES public.interview_sessions(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Advisors view all appointments" ON public.appointments
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'advisor') OR advisor_id = auth.uid());

CREATE POLICY "Introducers view own appointments" ON public.appointments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.introducers i
      WHERE i.id = introducer_id AND i.user_id = auth.uid()
    )
  );

CREATE POLICY "Advisors update appointments" ON public.appointments
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'advisor') OR advisor_id = auth.uid())
  WITH CHECK (public.has_role(auth.uid(), 'advisor') OR advisor_id = auth.uid());

CREATE TABLE public.sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  body TEXT NOT NULL,
  twilio_sid TEXT,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.introducer_leads(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sms_messages TO authenticated;
GRANT ALL ON public.sms_messages TO service_role;
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Advisors view SMS log" ON public.sms_messages
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'advisor'));

CREATE INDEX ON public.appointments (advisor_id, starts_at);
CREATE INDEX ON public.appointments (introducer_id, starts_at DESC);
CREATE INDEX ON public.appointments (starts_at) WHERE status = 'confirmed';
CREATE INDEX ON public.sms_messages (created_at DESC);

ALTER TABLE public.introducer_leads
  ADD COLUMN appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL;
