-- Gate G7F-4S4C4-URGENT-V: public introducer view write boundary.
--
-- public.introducer_public_booking is an automatically updatable view (security_invoker=false,
-- owned by postgres) over public.introducers. Base-table privileges and RLS are checked as the
-- view owner, so the caller's privileges on the view are the only write boundary. The view was
-- created under the Supabase default privileges for schema public, which grant every table
-- privilege to anon and authenticated; the original GRANT SELECT did not remove them.
--
-- Public and signed-in clients keep SELECT only. service_role, the view definition, its
-- columns and all introducer data are unchanged.
--
-- Re-runnable. Do NOT apply to production without separate approval.

REVOKE ALL ON TABLE public.introducer_public_booking FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.introducer_public_booking TO anon, authenticated;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT has_table_privilege(r, 'public.introducer_public_booking', 'SELECT')
       OR has_table_privilege(r, 'public.introducer_public_booking',
                              'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'g7f4s4c4v_introducer_public_booking_not_read_only:%', r;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1
    FROM pg_class c, aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
    WHERE c.oid = 'public.introducer_public_booking'::regclass
      AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole))
      AND a.privilege_type <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4v_introducer_public_booking_acl_not_select_only';
  END IF;
END
$$;
