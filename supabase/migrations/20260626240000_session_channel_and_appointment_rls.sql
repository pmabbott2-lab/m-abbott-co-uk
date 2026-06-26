-- Session channel + customer appointment visibility

ALTER TABLE public.interview_sessions
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'voice'
  CHECK (channel IN ('voice', 'text'));

CREATE POLICY "Customers view appointments for own sessions" ON public.appointments
  FOR SELECT TO authenticated
  USING (
    session_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.interview_sessions s
      WHERE s.id = appointments.session_id AND s.customer_id = auth.uid()
    )
  );
