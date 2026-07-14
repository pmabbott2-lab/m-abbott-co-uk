-- Link each advisor to a Microsoft Teams / Outlook diary and sync appointment events.

ALTER TABLE public.advisor_profiles
  ADD COLUMN IF NOT EXISTS ms_user_id text,
  ADD COLUMN IF NOT EXISTS ms_calendar_id text DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS ms_account_email text,
  ADD COLUMN IF NOT EXISTS ms_access_token text,
  ADD COLUMN IF NOT EXISTS ms_refresh_token text,
  ADD COLUMN IF NOT EXISTS ms_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS teams_calendar_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS teams_calendar_linked_at timestamptz;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS ms_event_id text,
  ADD COLUMN IF NOT EXISTS ms_join_url text;

CREATE INDEX IF NOT EXISTS idx_appointments_ms_event_id
  ON public.appointments (ms_event_id)
  WHERE ms_event_id IS NOT NULL;
