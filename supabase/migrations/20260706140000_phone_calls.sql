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
