-- G7F-4 — contact record tenant attribution.
--
-- customer_contact_log, session_contact_tracking, staff_contact_tasks and advisor_contact_views
-- carry a nullable tenant_id (G1) that no write path filled, so new contact records were
-- tenantless and invisible to tenant-scoped RLS. From this migration on the database derives the
-- tenant of every new contact record from its parent:
--
-- * customer_contact_log, session_contact_tracking, staff_contact_tasks: the case
--   (interview_sessions.tenant_id of session_id).
-- * advisor_contact_views: the contact it marks — appointments, callback_requests and
--   phone_calls by their own tenant_id; staff_task by the case of the task; abandoned by the case.
--
-- A caller-supplied tenant_id is never trusted: it must equal the parent's tenant, otherwise the
-- write is refused, including a tenant supplied for a tenantless parent. A tenantless parent
-- yields a tenantless record (ownership is never fabricated). The parent row is share-locked
-- while the tenant is derived, so a concurrent change of the parent's tenant cannot interleave.
-- On UPDATE, tenant_id and the parent reference are immutable, which also keeps upserts from
-- re-parenting or re-attributing an existing record.
--
-- Existing rows are not touched: no backfill, no relabelling. Reconciliation of historical
-- tenantless rows is a separate evidence-based gate.
--
-- Single transaction, forward-only. Every precondition fails closed before any change.

-- A. Locks.
LOCK TABLE public.customer_contact_log, public.session_contact_tracking,
  public.staff_contact_tasks, public.advisor_contact_views IN SHARE ROW EXCLUSIVE MODE;

-- B. Preconditions.
DO $$
DECLARE
  v_col record;
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'g7f4ct_precondition:server_version';
  END IF;
  IF to_regprocedure('public.contact_session_tenant_guard()') IS NOT NULL
     OR to_regprocedure('public.advisor_contact_view_tenant_guard()') IS NOT NULL THEN
    RAISE EXCEPTION 'g7f4ct_precondition:objects_present';
  END IF;
  FOR v_col IN
    SELECT * FROM (VALUES
      ('interview_sessions', 'id', 'uuid'), ('interview_sessions', 'tenant_id', 'uuid'),
      ('customer_contact_log', 'session_id', 'uuid'), ('customer_contact_log', 'tenant_id', 'uuid'),
      ('session_contact_tracking', 'session_id', 'uuid'),
      ('session_contact_tracking', 'tenant_id', 'uuid'),
      ('staff_contact_tasks', 'id', 'uuid'), ('staff_contact_tasks', 'session_id', 'uuid'),
      ('staff_contact_tasks', 'tenant_id', 'uuid'),
      ('advisor_contact_views', 'advisor_id', 'uuid'),
      ('advisor_contact_views', 'contact_type', 'text'),
      ('advisor_contact_views', 'contact_id', 'uuid'),
      ('advisor_contact_views', 'tenant_id', 'uuid'),
      ('appointments', 'id', 'uuid'), ('appointments', 'tenant_id', 'uuid'),
      ('callback_requests', 'id', 'uuid'), ('callback_requests', 'tenant_id', 'uuid'),
      ('phone_calls', 'id', 'uuid'), ('phone_calls', 'tenant_id', 'uuid')
    ) AS c(tbl, col, typ)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = v_col.tbl AND column_name = v_col.col
        AND data_type = v_col.typ
    ) THEN
      RAISE EXCEPTION 'g7f4ct_precondition:column %.%', v_col.tbl, v_col.col;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE NOT t.tgisinternal
      AND t.tgrelid IN ('public.customer_contact_log'::regclass, 'public.session_contact_tracking'::regclass,
                        'public.staff_contact_tasks'::regclass, 'public.advisor_contact_views'::regclass)
  ) THEN
    RAISE EXCEPTION 'g7f4ct_precondition:unexpected_trigger';
  END IF;
END $$;

-- C. Session-keyed contact records: tenant from the case.
CREATE FUNCTION public.contact_session_tenant_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_found boolean;
  v_parent uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.session_id IS DISTINCT FROM OLD.session_id THEN
      RAISE EXCEPTION 'contact record case is immutable' USING ERRCODE = '42501';
    END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'contact record tenant is immutable' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  SELECT true, s.tenant_id INTO v_found, v_parent
  FROM public.interview_sessions s
  WHERE s.id = NEW.session_id
  FOR SHARE;
  IF v_found IS NULL THEN
    RAISE EXCEPTION 'contact record case not found' USING ERRCODE = '23503';
  END IF;
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := v_parent;
  ELSIF v_parent IS NULL OR NEW.tenant_id <> v_parent THEN
    RAISE EXCEPTION 'contact record tenant does not match its case' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- D. Adviser contact markers: tenant from the marked contact.
CREATE FUNCTION public.advisor_contact_view_tenant_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_found boolean;
  v_parent uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.advisor_id IS DISTINCT FROM OLD.advisor_id
       OR NEW.contact_type IS DISTINCT FROM OLD.contact_type
       OR NEW.contact_id IS DISTINCT FROM OLD.contact_id THEN
      RAISE EXCEPTION 'contact marker identity is immutable' USING ERRCODE = '42501';
    END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'contact marker tenant is immutable' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.contact_type = 'appointment' THEN
    SELECT true, a.tenant_id INTO v_found, v_parent
    FROM public.appointments a WHERE a.id = NEW.contact_id FOR SHARE;
  ELSIF NEW.contact_type = 'callback' THEN
    SELECT true, c.tenant_id INTO v_found, v_parent
    FROM public.callback_requests c WHERE c.id = NEW.contact_id FOR SHARE;
  ELSIF NEW.contact_type = 'phone_call' THEN
    SELECT true, p.tenant_id INTO v_found, v_parent
    FROM public.phone_calls p WHERE p.id = NEW.contact_id FOR SHARE;
  ELSIF NEW.contact_type = 'staff_task' THEN
    SELECT true, s.tenant_id INTO v_found, v_parent
    FROM public.staff_contact_tasks t
    JOIN public.interview_sessions s ON s.id = t.session_id
    WHERE t.id = NEW.contact_id
    FOR SHARE;
  ELSIF NEW.contact_type = 'abandoned' THEN
    SELECT true, s.tenant_id INTO v_found, v_parent
    FROM public.interview_sessions s WHERE s.id = NEW.contact_id FOR SHARE;
  END IF;

  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := v_parent;
  ELSIF v_found IS NULL OR v_parent IS NULL OR NEW.tenant_id <> v_parent THEN
    RAISE EXCEPTION 'contact marker tenant does not match its contact' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.contact_session_tenant_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.advisor_contact_view_tenant_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER customer_contact_log_tenant_guard
  BEFORE INSERT OR UPDATE ON public.customer_contact_log
  FOR EACH ROW EXECUTE FUNCTION public.contact_session_tenant_guard();
CREATE TRIGGER session_contact_tracking_tenant_guard
  BEFORE INSERT OR UPDATE ON public.session_contact_tracking
  FOR EACH ROW EXECUTE FUNCTION public.contact_session_tenant_guard();
CREATE TRIGGER staff_contact_tasks_tenant_guard
  BEFORE INSERT OR UPDATE ON public.staff_contact_tasks
  FOR EACH ROW EXECUTE FUNCTION public.contact_session_tenant_guard();
CREATE TRIGGER advisor_contact_views_tenant_guard
  BEFORE INSERT OR UPDATE ON public.advisor_contact_views
  FOR EACH ROW EXECUTE FUNCTION public.advisor_contact_view_tenant_guard();

-- E. Postconditions.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger t
      WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
        AND t.tgname IN ('customer_contact_log_tenant_guard', 'session_contact_tracking_tenant_guard',
                         'staff_contact_tasks_tenant_guard', 'advisor_contact_views_tenant_guard')) <> 4 THEN
    RAISE EXCEPTION 'g7f4ct_postcondition:triggers';
  END IF;
END $$;
