-- G7F-4 — case tenant ownership.
--
-- interview_sessions.tenant_id is the tenant that owns a case. It is established once, when the
-- server creates the case from a verified tenant context (route slug + membership, sole
-- membership, or the server-resolved booking tenant; any client-supplied tenant_id is discarded
-- by withForcedTenantId). No application path changes it afterwards. The database did not
-- enforce that: anon and authenticated held every table privilege and the single FOR ALL policy
-- only required customer_id = auth.uid() on the new row, so a signed-in customer could move
-- their case to another tenant or to NULL, create a case in any tenant, clear deleted_at or
-- delete the case, and staff of two tenants could move a case between them.
--
-- From this migration on:
--
-- * A case is created with a tenant (INSERT without tenant_id is refused) and its tenant never
--   changes (UPDATE of tenant_id is refused), for every role including service_role. A
--   service-role connection is not authority to transfer a case or to assign a tenant to a
--   legacy tenantless case; both need a separate, approved and audited process.
-- * Client roles cannot create, delete or truncate cases. authenticated may UPDATE only the
--   interview progress columns written through the user's own client (status, submitted_at,
--   summary, current_section, current_question_index, followup_count, updated_at), under the
--   same row rules as before. anon holds no privilege.
-- * The FOR ALL policy is replaced by a SELECT policy and an UPDATE policy with the same row
--   rules; there is no client INSERT or DELETE policy. Platform Enter Company keeps read access
--   and write-session update access to progress columns only.
--
-- Existing rows are not touched: no backfill, no relabelling. Tenantless legacy cases stay
-- tenantless.
--
-- Single transaction, forward-only. Every precondition fails closed before any change.

-- A. Locks.
LOCK TABLE public.interview_sessions IN SHARE ROW EXCLUSIVE MODE;

-- B. Preconditions.
DO $$
DECLARE
  v_col record;
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'g7f4cto_precondition:server_version';
  END IF;
  IF to_regprocedure('public.interview_sessions_tenant_guard()') IS NOT NULL THEN
    RAISE EXCEPTION 'g7f4cto_precondition:objects_present';
  END IF;
  FOR v_col IN
    SELECT * FROM (VALUES
      ('id', 'uuid'), ('customer_id', 'uuid'), ('tenant_id', 'uuid'),
      ('status', NULL), ('submitted_at', 'timestamp with time zone'), ('summary', 'text'),
      ('current_section', 'text'), ('current_question_index', 'integer'),
      ('followup_count', 'integer'), ('updated_at', 'timestamp with time zone'),
      ('deleted_at', 'timestamp with time zone')
    ) AS c(col, typ)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'interview_sessions'
        AND column_name = v_col.col AND (v_col.typ IS NULL OR data_type = v_col.typ)
    ) THEN
      RAISE EXCEPTION 'g7f4cto_precondition:column interview_sessions.%', v_col.col;
    END IF;
  END LOOP;
  IF to_regprocedure('auth.uid()') IS NULL
     OR to_regprocedure('public.auth_is_tenant_staff(uuid)') IS NULL
     OR to_regprocedure('public.auth_has_platform_tenant_read_access(uuid)') IS NULL
     OR to_regprocedure('public.auth_has_platform_tenant_write_access(uuid)') IS NULL THEN
    RAISE EXCEPTION 'g7f4cto_precondition:functions';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.interview_sessions'::regclass) THEN
    RAISE EXCEPTION 'g7f4cto_precondition:rls';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.interview_sessions'::regclass AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'g7f4cto_precondition:unexpected_trigger';
  END IF;
  IF (SELECT array_agg(p.polname::text || '/' || p.polcmd::text ORDER BY p.polname)
      FROM pg_policy p WHERE p.polrelid = 'public.interview_sessions'::regclass)
     IS DISTINCT FROM ARRAY['Customer manages own sessions/*'] THEN
    RAISE EXCEPTION 'g7f4cto_precondition:policies';
  END IF;
  -- Column-level grants would survive the table-level REVOKE below.
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = 'public.interview_sessions'::regclass AND a.attnum > 0
      AND NOT a.attisdropped AND a.attacl IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'g7f4cto_precondition:column_acl';
  END IF;
END $$;

-- C. Tenant guard: set at creation, never changed.
CREATE FUNCTION public.interview_sessions_tenant_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.tenant_id IS NULL THEN
      RAISE EXCEPTION 'case tenant is required' USING ERRCODE = '23502';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'case tenant is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.interview_sessions_tenant_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER interview_sessions_tenant_guard
  BEFORE INSERT OR UPDATE ON public.interview_sessions
  FOR EACH ROW EXECUTE FUNCTION public.interview_sessions_tenant_guard();

-- D. Client privileges: read, and progress updates only.
REVOKE ALL ON TABLE public.interview_sessions FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.interview_sessions
  FROM authenticated;
GRANT SELECT ON TABLE public.interview_sessions TO authenticated;
GRANT UPDATE (status, submitted_at, summary, current_section, current_question_index,
  followup_count, updated_at) ON TABLE public.interview_sessions TO authenticated;

-- E. Policies: the same row rules, without client INSERT or DELETE.
DROP POLICY "Customer manages own sessions" ON public.interview_sessions;
CREATE POLICY "Read own or tenant sessions" ON public.interview_sessions
  FOR SELECT TO authenticated
  USING (
    customer_id = auth.uid()
    OR public.auth_is_tenant_staff(tenant_id)
    OR public.auth_has_platform_tenant_read_access(tenant_id)
  );
CREATE POLICY "Update own or tenant session progress" ON public.interview_sessions
  FOR UPDATE TO authenticated
  USING (
    customer_id = auth.uid()
    OR public.auth_is_tenant_staff(tenant_id)
    OR public.auth_has_platform_tenant_write_access(tenant_id)
  )
  WITH CHECK (
    customer_id = auth.uid()
    OR public.auth_is_tenant_staff(tenant_id)
    OR public.auth_has_platform_tenant_write_access(tenant_id)
  );

COMMENT ON FUNCTION public.interview_sessions_tenant_guard() IS
  'G7F-4: a case is created with a tenant and its tenant never changes (all roles). Transfers and legacy reconciliation need a separate approved process.';

-- F. Postconditions.
DO $$
DECLARE
  v_col text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.interview_sessions'::regclass AND NOT t.tgisinternal
      AND t.tgname = 'interview_sessions_tenant_guard' AND t.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'g7f4cto_postcondition:trigger';
  END IF;
  IF (SELECT array_agg(p.polname::text || '/' || p.polcmd::text ORDER BY p.polname)
      FROM pg_policy p WHERE p.polrelid = 'public.interview_sessions'::regclass)
     IS DISTINCT FROM ARRAY['Read own or tenant sessions/r', 'Update own or tenant session progress/w'] THEN
    RAISE EXCEPTION 'g7f4cto_postcondition:policies';
  END IF;
  IF has_any_column_privilege('anon', 'public.interview_sessions', 'SELECT, INSERT, UPDATE, REFERENCES')
     OR has_table_privilege('anon', 'public.interview_sessions', 'DELETE, TRUNCATE, TRIGGER')
     OR has_table_privilege('authenticated', 'public.interview_sessions', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR NOT has_table_privilege('authenticated', 'public.interview_sessions', 'SELECT') THEN
    RAISE EXCEPTION 'g7f4cto_postcondition:table_privileges';
  END IF;
  FOR v_col IN
    SELECT a.attname::text FROM pg_attribute a
    WHERE a.attrelid = 'public.interview_sessions'::regclass AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    IF has_column_privilege('authenticated', 'public.interview_sessions', v_col, 'UPDATE')
       <> (v_col IN ('status', 'submitted_at', 'summary', 'current_section',
                     'current_question_index', 'followup_count', 'updated_at')) THEN
      RAISE EXCEPTION 'g7f4cto_postcondition:column_privilege %', v_col;
    END IF;
  END LOOP;
END $$;
