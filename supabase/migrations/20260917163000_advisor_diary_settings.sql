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
