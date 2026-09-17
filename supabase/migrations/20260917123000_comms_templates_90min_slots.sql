-- 90-minute default appointment slots + communication templates / regulatory footers.
-- Applied remotely 2026-09-17; kept in repo for environments that replay migrations.

CREATE OR REPLACE FUNCTION public.hub_test_diary_slots(p_date date)
RETURNS TABLE (
  starts_at timestamptz,
  advisor_id uuid,
  advisor_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dow int := EXTRACT(ISODOW FROM p_date)::int;
  slot timestamptz;
  adv RECORD;
BEGIN
  IF dow < 1 OR dow > 5 THEN
    RETURN;
  END IF;

  FOR adv IN
    SELECT p.id AS id,
           COALESCE(NULLIF(TRIM(p.full_name), ''), p.email, 'Test advisor') AS name
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'advisor'
    LEFT JOIN public.advisor_profiles ap ON ap.user_id = p.id
    WHERE lower(p.email) IN ('4@test.co.uk', '5@test.co.uk')
      AND ap.deleted_at IS NULL
  LOOP
    slot := ((p_date::timestamp + time '09:00') AT TIME ZONE 'Europe/London');
    WHILE slot < ((p_date::timestamp + time '17:00') AT TIME ZONE 'Europe/London') LOOP
      IF slot > now()
         AND NOT EXISTS (
           SELECT 1
           FROM public.appointments a
           WHERE a.advisor_id = adv.id
             AND a.status = 'confirmed'
             AND a.starts_at = slot
         )
      THEN
        starts_at := slot;
        advisor_id := adv.id;
        advisor_name := adv.name;
        RETURN NEXT;
      END IF;
      slot := slot + interval '90 minutes';
    END LOOP;
  END LOOP;
END;
$$;

UPDATE public.advisor_availability
SET slot_minutes = 90
WHERE slot_minutes = 30;

ALTER TABLE public.advisor_availability
  ALTER COLUMN slot_minutes SET DEFAULT 90;

CREATE TABLE IF NOT EXISTS public.communication_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  email_regulatory_footer text NOT NULL DEFAULT '',
  sms_regulatory_footer text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.communication_settings (id, email_regulatory_footer, sms_regulatory_footer)
VALUES (
  1,
  E'MortgageEasy is a trading name used by this firm. We are authorised and regulated by the Financial Conduct Authority. This email may contain confidential information. If you are not the intended recipient, please delete it and notify us.',
  E'*MortgageEasy is authorised and regulated by the FCA. Info & disclosures: mymortgagehub.uk'
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.communication_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  channel text NOT NULL CHECK (channel IN ('sms', 'email', 'voice')),
  subject text,
  body text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  required_tokens text[] NOT NULL DEFAULT '{}',
  sort_order int NOT NULL DEFAULT 100,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.communication_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.communication_templates(id) ON DELETE CASCADE,
  version int NOT NULL,
  subject text,
  body text NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  change_note text,
  UNIQUE (template_id, version)
);

CREATE INDEX IF NOT EXISTS communication_templates_channel_idx
  ON public.communication_templates (channel);

ALTER TABLE public.communication_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_template_versions ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.communication_settings TO service_role;
GRANT ALL ON public.communication_templates TO service_role;
GRANT ALL ON public.communication_template_versions TO service_role;
