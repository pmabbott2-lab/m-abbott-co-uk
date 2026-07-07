-- Contact archive: "Contacted" greys out for 24h then drops from Contacts/CRM (stays in History).
-- Safe to re-run.

ALTER TABLE public.advisor_contact_views
  ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMPTZ;

ALTER TABLE public.advisor_contact_views
  DROP CONSTRAINT IF EXISTS advisor_contact_views_contact_type_check;

ALTER TABLE public.advisor_contact_views
  ADD CONSTRAINT advisor_contact_views_contact_type_check
  CHECK (contact_type IN ('appointment', 'callback', 'phone_call'));

CREATE INDEX IF NOT EXISTS idx_advisor_contact_views_contacted
  ON public.advisor_contact_views (advisor_id, contacted_at DESC)
  WHERE contacted_at IS NOT NULL;
