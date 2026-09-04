-- Extend advisor_contact_views.contact_type for staff tasks + abandoned leads.
-- Safe to re-run.

ALTER TABLE public.advisor_contact_views
  DROP CONSTRAINT IF EXISTS advisor_contact_views_contact_type_check;

ALTER TABLE public.advisor_contact_views
  ADD CONSTRAINT advisor_contact_views_contact_type_check
  CHECK (contact_type IN ('appointment', 'callback', 'phone_call', 'staff_task', 'abandoned'));
