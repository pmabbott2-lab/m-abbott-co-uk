-- Safe public fields for /book/:slug (no contact details).
CREATE OR REPLACE VIEW public.introducer_public_booking
WITH (security_invoker = false) AS
SELECT id, company_name, slug
FROM public.introducers
WHERE COALESCE(active, true) = true
  AND deleted_at IS NULL;

GRANT SELECT ON public.introducer_public_booking TO anon, authenticated;

-- Mon–Fri 09:00–17:00 Europe/London demo slots for live test advisors (4@ / 5@).
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
  dow int := EXTRACT(ISODOW FROM p_date)::int; -- 1=Mon .. 7=Sun
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
      slot := slot + interval '30 minutes';
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.hub_test_diary_slots(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_test_diary_slots(date) TO anon, authenticated, service_role;
