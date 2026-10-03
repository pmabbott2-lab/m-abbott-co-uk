-- Gate G7F-4S4C4-A0: introducer self-write boundary.
-- Supabase default privileges grant anon and authenticated every privilege on public.introducers,
-- and the own-row UPDATE policy cannot restrict columns. Introducer self-service may change only
-- company_name and contact_email; active, deleted_at, tenant_id, company_code, slug and identity
-- columns are written by the service role alone. RLS policies are unchanged.

REVOKE ALL ON TABLE public.introducers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.introducers TO anon, authenticated;
GRANT UPDATE (company_name, contact_email) ON TABLE public.introducers TO authenticated;

DO $$
DECLARE
  r text;
  col record;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT has_table_privilege(r, 'public.introducers', 'SELECT')
       OR has_table_privilege(r, 'public.introducers',
                              'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') THEN
      RAISE EXCEPTION 'g7f4s4c4a0_introducers_table_privileges:%', r;
    END IF;
  END LOOP;

  FOR col IN
    SELECT a.attname::text AS name
    FROM pg_attribute a
    WHERE a.attrelid = 'public.introducers'::regclass AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    IF has_column_privilege('anon', 'public.introducers', col.name, 'INSERT,UPDATE,REFERENCES')
       OR has_column_privilege('authenticated', 'public.introducers', col.name, 'INSERT,REFERENCES')
       OR has_column_privilege('authenticated', 'public.introducers', col.name, 'UPDATE')
          IS DISTINCT FROM (col.name IN ('company_name', 'contact_email')) THEN
      RAISE EXCEPTION 'g7f4s4c4a0_introducers_column_privileges:%', col.name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_class c, aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
    WHERE c.oid = 'public.introducers'::regclass
      AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole))
      AND a.privilege_type <> 'SELECT'
  ) OR EXISTS (
    SELECT 1
    FROM pg_attribute att, aclexplode(att.attacl) a
    WHERE att.attrelid = 'public.introducers'::regclass
      AND att.attnum > 0
      AND NOT att.attisdropped
      AND (a.grantee = 0 OR a.grantee IN ('anon'::regrole, 'authenticated'::regrole))
      AND NOT (
        a.grantee = 'authenticated'::regrole
        AND a.privilege_type = 'UPDATE'
        AND att.attname IN ('company_name', 'contact_email')
      )
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4a0_introducers_acl_not_minimal';
  END IF;
END
$$;
