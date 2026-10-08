-- G7F-4S4C4-B4b1 — network statement tenant architecture, network economic date, fee-line
-- economic-date foundation and adviser assignment history.
--
-- * Network statements are owned by exactly one tenant: tenant_id NOT NULL, one statement per
--   tenant and month (UNIQUE (tenant_id, period_month)), no provider dimension. A tenantless
--   statement is never assigned to a tenant: it is moved byte-identically into a service-role-only
--   archive, and the migration fails closed if any tenantless statement carries lines, fee links
--   or a validated state.
-- * Network lines are owned by their statement's tenant (composite keys to the statement and to
--   the matched session). Parsed facts are immutable; a re-parse supersedes, never deletes.
-- * Network economic date (D7): the line transaction date, else the staff-confirmed statement
--   received date. Never created_at, updated_at, posted_at, allocation time, validation time or
--   now(). Either is provisional until the statement is validated.
-- * Fee lines carry fee_event_date / fee_event_at (start of that day, Europe/London) /
--   fee_event_source / fee_event_evidence, copied once from the network source at allocation and
--   immutable afterwards. Existing undated drafts stay undated and unpostable. Posting is not
--   available here (B4b2).
-- * Allocation is atomic and idempotent (at most one active fee line per network line, enforced by
--   a unique index); deallocation voids a draft only; validation reconciles and freezes but never
--   posts; unlock is Owner-only, requires a reason and is refused once a source fee is posted.
-- * Adviser assignment history: append-only intervals per tenant, session and adviser, opened and
--   closed by session_advisors inserts and deletes. Tenant-stamped current assignments are
--   backfilled as open intervals from their created_at; tenantless ones are not backfilled.
-- * Client roles lose direct access to fee lines, ledger, statements, lines, the finance audit log
--   and the history. Service-role server functions are the only path.
--
-- Single transaction, forward-only. Every precondition fails closed before any change.

-- A. Locks.
LOCK TABLE public.network_commission_statements, public.network_commission_lines,
  public.finance_fee_lines, public.session_advisors IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.interview_sessions, public.tenant_memberships, public.tenants,
  public.finance_ledger, public.finance_audit_log, public.admin_permissions IN SHARE MODE;

-- B. Preconditions.
DO $$
DECLARE
  v_sig record;
  v_con record;
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:server_version';
  END IF;

  -- Column signatures (order, type, nullability) exactly as staging.
  FOR v_sig IN
    SELECT * FROM (VALUES
      ('network_commission_statements',
       'id:uuid:nn,period_month:date:nn,status:text:nn,notes:text,raw_source:text,validated_by:uuid,validated_at:timestamp with time zone,created_by:uuid,created_at:timestamp with time zone:nn,updated_at:timestamp with time zone:nn,tenant_id:uuid'),
      ('network_commission_lines',
       'id:uuid:nn,statement_id:uuid:nn,line_no:integer:nn,customer_name:text,customer_email:text,case_ref:text,fee_type:text:nn,amount_received_pence:integer:nn,network_product:text,raw_json:jsonb,allocation_status:text:nn,matched_customer_id:uuid,matched_session_id:uuid,fee_line_id:uuid,annotation:text,allocated_by:uuid,allocated_at:timestamp with time zone,created_at:timestamp with time zone:nn,updated_at:timestamp with time zone:nn,tenant_id:uuid'),
      ('finance_fee_lines',
       'id:uuid:nn,session_id:uuid:nn,fee_type:finance_fee_type:nn,amount_pence:integer:nn,note:text,status:finance_line_status:nn,batch_id:uuid,created_by:uuid,posted_at:timestamp with time zone,created_at:timestamp with time zone:nn,updated_at:timestamp with time zone:nn,tenant_id:uuid'),
      ('session_advisors',
       'id:uuid:nn,session_id:uuid:nn,advisor_id:uuid:nn,assigned_by:uuid,created_at:timestamp with time zone:nn,tenant_id:uuid'),
      ('finance_audit_log',
       'id:uuid:nn,audit_type:text:nn,subject_user_id:uuid,customer_id:uuid,session_id:uuid,role:text,fee_type:text,summary:text:nn,detail:jsonb,changed_by:uuid,created_at:timestamp with time zone:nn,tenant_id:uuid')
    ) AS e(rel, sig)
  LOOP
    IF (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod)
                          || CASE WHEN a.attnotnull THEN ':nn' ELSE '' END, ',' ORDER BY a.attnum)
        FROM pg_attribute a
        WHERE a.attrelid = ('public.' || v_sig.rel)::regclass AND a.attnum > 0
          AND NOT a.attisdropped) IS DISTINCT FROM v_sig.sig THEN
      RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:column_signature:%', v_sig.rel;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_attribute a
      WHERE a.attrelid = 'public.interview_sessions'::regclass AND NOT a.attisdropped
        AND ((a.attname = 'id' AND a.atttypid = 'uuid'::regtype AND a.attnotnull)
          OR (a.attname = 'tenant_id' AND a.atttypid = 'uuid'::regtype)
          OR (a.attname = 'customer_id' AND a.atttypid = 'uuid'::regtype)
          OR (a.attname = 'deleted_at' AND a.atttypid = 'timestamptz'::regtype))) <> 4
     OR (SELECT count(*) FROM pg_attribute a
         WHERE a.attrelid = 'public.admin_permissions'::regclass AND NOT a.attisdropped
           AND a.attname IN ('user_id', 'permission_key', 'access', 'tenant_id')) <> 4 THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:column_signature:sessions_or_permissions';
  END IF;
  IF (SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e
      WHERE e.enumtypid = 'public.finance_line_status'::regtype)
       IS DISTINCT FROM 'draft,posted,amended,deleted'
     OR (SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e
         WHERE e.enumtypid = 'public.finance_fee_type'::regtype)
       IS DISTINCT FROM 'fee,mortgage_fee,insurance_fee,other_fee' THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:finance_enums';
  END IF;

  -- The keys this migration replaces or relies on are exactly the staging keys.
  FOR v_con IN
    SELECT * FROM (VALUES
      ('network_commission_statements', 'network_commission_statements_period_month_key',
       'UNIQUE (period_month)'),
      ('network_commission_statements', 'network_commission_statements_status_check',
       'CHECK ((status = ANY (ARRAY[''draft''::text, ''annotated''::text, ''validated''::text, ''locked''::text])))'),
      ('network_commission_lines', 'network_commission_lines_statement_id_fkey',
       'FOREIGN KEY (statement_id) REFERENCES network_commission_statements(id) ON DELETE CASCADE'),
      ('network_commission_lines', 'network_commission_lines_allocation_status_check',
       'CHECK ((allocation_status = ANY (ARRAY[''unmatched''::text, ''matched''::text, ''allocated''::text, ''skipped''::text])))'),
      ('network_commission_lines', 'network_commission_lines_fee_type_check',
       'CHECK ((fee_type = ANY (ARRAY[''fee''::text, ''mortgage_fee''::text, ''insurance_fee''::text, ''other_fee''::text])))'),
      ('finance_fee_lines', 'finance_fee_lines_session_id_fkey',
       'FOREIGN KEY (session_id) REFERENCES interview_sessions(id) ON DELETE CASCADE'),
      ('session_advisors', 'session_advisors_session_id_advisor_id_key',
       'UNIQUE (session_id, advisor_id)'),
      ('tenant_memberships', 'tenant_memberships_user_tenant_role_unique',
       'UNIQUE (user_id, tenant_id, role)')
    ) AS e(rel, name, def)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = ('public.' || v_con.rel)::regclass AND c.conname = v_con.name
        AND replace(pg_get_constraintdef(c.oid), 'REFERENCES public.', 'REFERENCES ') = v_con.def
    ) THEN
      RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:key_shape:%', v_con.name;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE NOT t.tgisinternal
      AND t.tgrelid IN ('public.network_commission_statements'::regclass,
                        'public.network_commission_lines'::regclass,
                        'public.finance_fee_lines'::regclass, 'public.session_advisors'::regclass)
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:unexpected_trigger';
  END IF;
  IF to_regclass('public.session_adviser_assignments') IS NOT NULL
     OR to_regclass('public.session_adviser_history_capture') IS NOT NULL
     OR to_regclass('public.network_commission_statements_unowned_pre_b4b1') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint c
                WHERE c.conrelid = 'public.interview_sessions'::regclass
                  AND c.conname = 'interview_sessions_id_tenant_key')
     OR EXISTS (
       SELECT 1 FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname IN ('session_adviser_history_on_insert', 'session_adviser_history_on_delete',
                           'session_adviser_identity_guard', 'session_adviser_assignments_guard',
                           'resolve_session_advisers_as_of', 'finance_fee_lines_guard',
                           'network_commission_lines_guard', 'network_commission_statements_guard',
                           'network_finance_actor_role', 'network_finance_audit',
                           'network_statement_validation_blockers', 'allocate_network_line',
                           'deallocate_network_line', 'set_network_line_skip',
                           'set_network_line_transaction_date',
                           'confirm_network_statement_received_date',
                           'set_network_statement_declared_total',
                           'replace_network_statement_lines', 'validate_network_statement',
                           'unlock_network_statement')
     ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:new_name_in_use';
  END IF;

  -- Tenantless statements: at most the one known draft, with no lines, no fee links and no
  -- validated state. Ownership is never inferred.
  IF (SELECT count(*) FROM public.network_commission_statements s WHERE s.tenant_id IS NULL) > 1 THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:tenantless_statement_unexpected';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.network_commission_statements s
    JOIN public.network_commission_lines l ON l.statement_id = s.id
    WHERE s.tenant_id IS NULL
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:tenantless_statement_has_lines';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.network_commission_statements s
    WHERE s.tenant_id IS NULL
      AND (s.status NOT IN ('draft', 'annotated') OR s.validated_at IS NOT NULL
           OR s.validated_by IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:tenantless_statement_financial_state';
  END IF;

  -- Lines: tenant-stamped, same tenant as their statement and their matched session.
  IF EXISTS (SELECT 1 FROM public.network_commission_lines l WHERE l.tenant_id IS NULL) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:line_tenant_null';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.network_commission_lines l
    JOIN public.network_commission_statements s ON s.id = l.statement_id
    WHERE s.tenant_id IS DISTINCT FROM l.tenant_id
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:line_statement_tenant_mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.network_commission_lines l
    LEFT JOIN public.interview_sessions s ON s.id = l.matched_session_id
    WHERE l.matched_session_id IS NOT NULL AND s.tenant_id IS DISTINCT FROM l.tenant_id
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:line_session_tenant_mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.network_commission_lines l
    GROUP BY l.statement_id, l.line_no HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:line_number_duplicate';
  END IF;

  -- Existing network allocations: one line, one fee line, same tenant and session, consistent state.
  IF EXISTS (
    SELECT 1 FROM public.network_commission_lines l
    WHERE (l.allocation_status = 'allocated') IS DISTINCT FROM (l.fee_line_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:line_allocation_state_inconsistent';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.network_commission_lines l
    LEFT JOIN public.finance_fee_lines f ON f.id = l.fee_line_id
    WHERE l.fee_line_id IS NOT NULL
      AND (f.id IS NULL OR f.tenant_id IS DISTINCT FROM l.tenant_id
           OR f.session_id IS DISTINCT FROM l.matched_session_id OR f.status::text = 'deleted')
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:line_fee_link_inconsistent';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.network_commission_lines l
    WHERE l.fee_line_id IS NOT NULL GROUP BY l.fee_line_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:duplicate_network_allocation';
  END IF;

  -- Fee lines: tenant-stamped and in their session's tenant.
  IF EXISTS (SELECT 1 FROM public.finance_fee_lines f WHERE f.tenant_id IS NULL) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:fee_line_tenant_null';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.finance_fee_lines f
    JOIN public.interview_sessions s ON s.id = f.session_id
    WHERE s.tenant_id IS DISTINCT FROM f.tenant_id
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:fee_line_session_tenant_mismatch';
  END IF;

  -- Adviser assignments: a tenant-stamped assignment is in its session's tenant and its adviser
  -- holds a staff membership there. Tenantless assignments are excluded, never guessed.
  IF EXISTS (
    SELECT 1 FROM public.session_advisors sa
    JOIN public.interview_sessions s ON s.id = sa.session_id
    WHERE sa.tenant_id IS NOT NULL AND s.tenant_id IS DISTINCT FROM sa.tenant_id
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:session_adviser_tenant_mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.session_advisors sa
    WHERE sa.tenant_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.tenant_memberships m
        WHERE m.user_id = sa.advisor_id AND m.tenant_id = sa.tenant_id
          AND m.role::text IN ('owner', 'supervisor', 'general', 'adviser')
      )
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_precondition:session_adviser_membership_unprovable';
  END IF;
END
$$;

-- C. Baselines.
CREATE TEMP TABLE g7f4s4c4b4b1_tenantless_before AS
SELECT s.id, s::text AS row_text FROM public.network_commission_statements s
WHERE s.tenant_id IS NULL;

CREATE TEMP TABLE g7f4s4c4b4b1_rows_before AS
SELECT 'network_commission_statements'::text AS tbl, to_jsonb(t) AS j
FROM public.network_commission_statements t WHERE t.tenant_id IS NOT NULL
UNION ALL SELECT 'network_commission_lines', to_jsonb(t) FROM public.network_commission_lines t
UNION ALL SELECT 'finance_fee_lines', to_jsonb(t) FROM public.finance_fee_lines t
UNION ALL SELECT 'session_advisors', to_jsonb(t) FROM public.session_advisors t
UNION ALL SELECT 'interview_sessions', to_jsonb(t) FROM public.interview_sessions t
UNION ALL SELECT 'finance_ledger', to_jsonb(t) FROM public.finance_ledger t
UNION ALL SELECT 'finance_audit_log', to_jsonb(t) FROM public.finance_audit_log t
UNION ALL SELECT 'tenant_memberships', to_jsonb(t) FROM public.tenant_memberships t
UNION ALL SELECT 'admin_permissions', to_jsonb(t) FROM public.admin_permissions t;

CREATE TEMP TABLE g7f4s4c4b4b1_fee_links_before AS
SELECT l.fee_line_id, l.id AS line_id FROM public.network_commission_lines l
WHERE l.fee_line_id IS NOT NULL;

-- D. Tenantless statements move, byte-identical, into a service-role-only archive.
CREATE TABLE public.network_commission_statements_unowned_pre_b4b1
  (LIKE public.network_commission_statements);
ALTER TABLE public.network_commission_statements_unowned_pre_b4b1
  ADD CONSTRAINT network_commission_statements_unowned_pre_b4b1_pkey PRIMARY KEY (id);
INSERT INTO public.network_commission_statements_unowned_pre_b4b1
SELECT s.* FROM public.network_commission_statements s WHERE s.tenant_id IS NULL;
DELETE FROM public.network_commission_statements s WHERE s.tenant_id IS NULL;
COMMENT ON TABLE public.network_commission_statements_unowned_pre_b4b1 IS
  'G7F-4S4C4-B4b1 archive of network statements that had no owning tenant. Byte-identical evidence; never assigned to a tenant, never a statement source. service_role read only.';

-- E. Statements: one per tenant and month; received date and declared total with provenance.
ALTER TABLE public.network_commission_statements ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.network_commission_statements
  DROP CONSTRAINT network_commission_statements_period_month_key;
ALTER TABLE public.network_commission_statements
  ADD CONSTRAINT network_commission_statements_tenant_period_key UNIQUE (tenant_id, period_month),
  ADD CONSTRAINT network_commission_statements_id_tenant_key UNIQUE (id, tenant_id),
  ADD COLUMN received_date date,
  ADD COLUMN received_date_confirmed_by uuid,
  ADD COLUMN received_date_confirmed_at timestamptz,
  ADD COLUMN received_date_evidence text,
  ADD COLUMN declared_total_pence bigint,
  ADD COLUMN declared_total_set_by uuid,
  ADD COLUMN declared_total_set_at timestamptz,
  ADD COLUMN last_unlocked_by uuid,
  ADD COLUMN last_unlocked_at timestamptz,
  ADD COLUMN last_unlock_reason text;
ALTER TABLE public.network_commission_statements
  ADD CONSTRAINT network_commission_statements_received_date_check CHECK (
    (received_date IS NULL AND received_date_confirmed_by IS NULL
      AND received_date_confirmed_at IS NULL AND received_date_evidence IS NULL)
    OR (received_date IS NOT NULL AND received_date_confirmed_by IS NOT NULL
      AND received_date_confirmed_at IS NOT NULL
      AND (received_date_evidence IS NULL OR char_length(received_date_evidence) BETWEEN 1 AND 500))
  ),
  ADD CONSTRAINT network_commission_statements_declared_total_check CHECK (
    (declared_total_pence IS NULL AND declared_total_set_by IS NULL AND declared_total_set_at IS NULL)
    OR (declared_total_pence >= 0 AND declared_total_set_by IS NOT NULL
      AND declared_total_set_at IS NOT NULL)
  ),
  ADD CONSTRAINT network_commission_statements_unlock_check CHECK (
    (last_unlocked_by IS NULL AND last_unlocked_at IS NULL AND last_unlock_reason IS NULL)
    OR (last_unlocked_by IS NOT NULL AND last_unlocked_at IS NOT NULL
      AND char_length(btrim(COALESCE(last_unlock_reason, ''))) BETWEEN 1 AND 500)
  );

-- F. Lines: tenant-owned through their statement; transaction date with provenance; supersession.
ALTER TABLE public.network_commission_lines ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.network_commission_lines DROP CONSTRAINT network_commission_lines_statement_id_fkey;
ALTER TABLE public.interview_sessions
  ADD CONSTRAINT interview_sessions_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE public.network_commission_lines
  ADD CONSTRAINT network_commission_lines_id_tenant_key UNIQUE (id, tenant_id),
  ADD CONSTRAINT network_commission_lines_statement_tenant_fkey FOREIGN KEY (statement_id, tenant_id)
    REFERENCES public.network_commission_statements (id, tenant_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT network_commission_lines_session_tenant_fkey FOREIGN KEY (matched_session_id, tenant_id)
    REFERENCES public.interview_sessions (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD COLUMN transaction_date date,
  ADD COLUMN transaction_date_source text,
  ADD COLUMN transaction_date_set_by uuid,
  ADD COLUMN transaction_date_set_at timestamptz,
  ADD COLUMN parse_batch_id uuid,
  ADD COLUMN skip_reason text,
  ADD COLUMN skipped_by uuid,
  ADD COLUMN skipped_at timestamptz,
  ADD COLUMN superseded_at timestamptz,
  ADD COLUMN superseded_by uuid;
ALTER TABLE public.network_commission_lines
  ADD CONSTRAINT network_commission_lines_transaction_date_check CHECK (
    (transaction_date IS NULL AND transaction_date_source IS NULL
      AND transaction_date_set_by IS NULL AND transaction_date_set_at IS NULL)
    OR (transaction_date IS NOT NULL
      AND transaction_date_source IN ('statement_parser', 'staff_entry')
      AND transaction_date_set_by IS NOT NULL AND transaction_date_set_at IS NOT NULL)
  ),
  ADD CONSTRAINT network_commission_lines_skip_check CHECK (
    (skip_reason IS NULL AND skipped_by IS NULL AND skipped_at IS NULL)
    OR (allocation_status = 'skipped' AND char_length(btrim(skip_reason)) BETWEEN 1 AND 500
      AND skipped_by IS NOT NULL AND skipped_at IS NOT NULL)
  ),
  ADD CONSTRAINT network_commission_lines_superseded_check CHECK (
    (superseded_at IS NULL) = (superseded_by IS NULL)
  ),
  ADD CONSTRAINT network_commission_lines_allocated_fee_check CHECK (
    (allocation_status = 'allocated') = (fee_line_id IS NOT NULL)
  );
CREATE UNIQUE INDEX network_commission_lines_current_line_no_key
  ON public.network_commission_lines (statement_id, line_no) WHERE superseded_at IS NULL;
CREATE INDEX network_commission_lines_matched_session_idx
  ON public.network_commission_lines (matched_session_id, tenant_id);

-- G. Fee lines: tenant-safe session and network source; economic date; void provenance.
ALTER TABLE public.finance_fee_lines ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.finance_fee_lines DROP CONSTRAINT finance_fee_lines_session_id_fkey;
ALTER TABLE public.finance_fee_lines
  ADD CONSTRAINT finance_fee_lines_session_tenant_fkey FOREIGN KEY (session_id, tenant_id)
    REFERENCES public.interview_sessions (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD COLUMN source_network_line_id uuid,
  ADD COLUMN fee_event_date date,
  ADD COLUMN fee_event_at timestamptz,
  ADD COLUMN fee_event_source text,
  ADD COLUMN fee_event_evidence jsonb,
  ADD COLUMN voided_at timestamptz,
  ADD COLUMN voided_by uuid,
  ADD COLUMN void_reason text;
ALTER TABLE public.finance_fee_lines
  ADD CONSTRAINT finance_fee_lines_source_line_tenant_fkey
    FOREIGN KEY (source_network_line_id, tenant_id)
    REFERENCES public.network_commission_lines (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT finance_fee_lines_fee_event_check CHECK (
    (fee_event_date IS NULL AND fee_event_at IS NULL AND fee_event_source IS NULL
      AND fee_event_evidence IS NULL)
    OR (fee_event_date IS NOT NULL AND source_network_line_id IS NOT NULL
      AND fee_event_source IN ('network_line_transaction_date', 'network_statement_received_date')
      AND fee_event_at = (fee_event_date::timestamp AT TIME ZONE 'Europe/London')
      AND jsonb_typeof(fee_event_evidence) = 'object')
  ),
  ADD CONSTRAINT finance_fee_lines_void_check CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (status = 'deleted' AND voided_at IS NOT NULL AND voided_by IS NOT NULL
      AND char_length(btrim(COALESCE(void_reason, ''))) BETWEEN 1 AND 500)
  );
CREATE UNIQUE INDEX finance_fee_lines_active_network_source_key
  ON public.finance_fee_lines (source_network_line_id)
  WHERE source_network_line_id IS NOT NULL AND status <> 'deleted';

-- Existing network allocations keep their proven link; no economic date is claimed for them.
UPDATE public.finance_fee_lines f
SET source_network_line_id = b.line_id
FROM pg_temp.g7f4s4c4b4b1_fee_links_before b
WHERE b.fee_line_id = f.id;

-- H. Adviser assignment history.
CREATE TABLE public.session_adviser_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  session_id uuid NOT NULL,
  adviser_user_id uuid NOT NULL,
  adviser_capacity public.tenant_member_role NOT NULL,
  assigned_at timestamptz NOT NULL,
  unassigned_at timestamptz,
  assigned_by uuid,
  source text NOT NULL,
  source_session_advisor_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  unassigned_recorded_at timestamptz,
  CONSTRAINT session_adviser_assignments_pkey PRIMARY KEY (id),
  CONSTRAINT session_adviser_assignments_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT session_adviser_assignments_session_tenant_fkey FOREIGN KEY (session_id, tenant_id)
    REFERENCES public.interview_sessions (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT session_adviser_assignments_adviser_capacity_fkey
    FOREIGN KEY (adviser_user_id, tenant_id, adviser_capacity)
    REFERENCES public.tenant_memberships (user_id, tenant_id, role)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT session_adviser_assignments_capacity_check
    CHECK (adviser_capacity::text IN ('owner', 'supervisor', 'general', 'adviser')),
  CONSTRAINT session_adviser_assignments_source_check
    CHECK (source IN ('session_advisors_insert', 'session_advisors_backfill')),
  CONSTRAINT session_adviser_assignments_backfill_check
    CHECK (source <> 'session_advisors_backfill' OR assigned_by IS NULL),
  CONSTRAINT session_adviser_assignments_interval_check
    CHECK (unassigned_at IS NULL OR unassigned_at >= assigned_at),
  CONSTRAINT session_adviser_assignments_unassigned_check
    CHECK ((unassigned_at IS NULL) = (unassigned_recorded_at IS NULL))
);
CREATE UNIQUE INDEX session_adviser_assignments_open_key
  ON public.session_adviser_assignments (tenant_id, session_id, adviser_user_id)
  WHERE unassigned_at IS NULL;
CREATE INDEX session_adviser_assignments_session_idx
  ON public.session_adviser_assignments (tenant_id, session_id, assigned_at);
COMMENT ON TABLE public.session_adviser_assignments IS
  'G7F-4S4C4-B4b1: append-only adviser assignment intervals per tenant, session and adviser. Opened by session_advisors inserts, closed (once) by deletes. The only proof of who was assigned at a fee event. service_role read; writes only through the session_advisors triggers.';

CREATE TABLE public.session_adviser_history_capture (
  singleton boolean NOT NULL DEFAULT true,
  started_at timestamptz NOT NULL,
  CONSTRAINT session_adviser_history_capture_pkey PRIMARY KEY (singleton),
  CONSTRAINT session_adviser_history_capture_singleton_check CHECK (singleton)
);
INSERT INTO public.session_adviser_history_capture (singleton, started_at) VALUES (true, now());
COMMENT ON TABLE public.session_adviser_history_capture IS
  'G7F-4S4C4-B4b1: the instant live assignment capture began. Before it, history holds only the backfilled current assignments, so it cannot prove who else was assigned.';

-- Tenant-stamped current assignments become open intervals from their created_at.
INSERT INTO public.session_adviser_assignments (
  tenant_id, session_id, adviser_user_id, adviser_capacity, assigned_at, assigned_by, source,
  source_session_advisor_id
)
SELECT sa.tenant_id, sa.session_id, sa.advisor_id,
  (SELECT m.role FROM public.tenant_memberships m
   WHERE m.user_id = sa.advisor_id AND m.tenant_id = sa.tenant_id
     AND m.role::text IN ('owner', 'supervisor', 'general', 'adviser')
   ORDER BY m.active DESC, (m.role::text = 'adviser') DESC, m.role
   LIMIT 1),
  sa.created_at, NULL, 'session_advisors_backfill', sa.id
FROM public.session_advisors sa
JOIN public.interview_sessions s ON s.id = sa.session_id AND s.tenant_id = sa.tenant_id
WHERE sa.tenant_id IS NOT NULL;

CREATE FUNCTION public.session_adviser_assignments_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'session_adviser_history_immutable';
  END IF;
  -- Only the session_advisors triggers write history.
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'session_adviser_history_direct_write_forbidden';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(872014101, hashtext(
      NEW.tenant_id::text || ':' || NEW.session_id::text || ':' || NEW.adviser_user_id::text));
    IF EXISTS (
      SELECT 1 FROM public.session_adviser_assignments a
      WHERE a.tenant_id = NEW.tenant_id AND a.session_id = NEW.session_id
        AND a.adviser_user_id = NEW.adviser_user_id
        AND (a.unassigned_at IS NULL OR a.unassigned_at > NEW.assigned_at)
    ) THEN
      RAISE EXCEPTION 'session_adviser_history_overlap';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.unassigned_at IS NOT NULL OR NEW.unassigned_at IS NULL
     OR (to_jsonb(NEW) - ARRAY['unassigned_at', 'unassigned_recorded_at'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['unassigned_at', 'unassigned_recorded_at']) THEN
    RAISE EXCEPTION 'session_adviser_history_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER session_adviser_assignments_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.session_adviser_assignments
  FOR EACH ROW EXECUTE FUNCTION public.session_adviser_assignments_guard();
CREATE TRIGGER session_adviser_assignments_no_truncate
  BEFORE TRUNCATE ON public.session_adviser_assignments
  FOR EACH STATEMENT EXECUTE FUNCTION public.session_adviser_assignments_guard();

CREATE FUNCTION public.session_adviser_history_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_session_tenant uuid;
  v_capacity public.tenant_member_role;
BEGIN
  SELECT s.tenant_id INTO v_session_tenant
  FROM public.interview_sessions s WHERE s.id = NEW.session_id;
  IF NEW.tenant_id IS DISTINCT FROM v_session_tenant THEN
    RAISE EXCEPTION 'session_adviser_tenant_mismatch';
  END IF;
  -- A legacy tenantless session has no provable tenant: nothing is recorded for it.
  IF NEW.tenant_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT m.role INTO v_capacity
  FROM public.tenant_memberships m
  WHERE m.user_id = NEW.advisor_id AND m.tenant_id = NEW.tenant_id AND m.active
    AND m.role::text IN ('owner', 'supervisor', 'general', 'adviser')
  ORDER BY (m.role::text = 'adviser') DESC, m.role
  LIMIT 1;
  IF v_capacity IS NULL THEN
    RAISE EXCEPTION 'session_adviser_not_tenant_staff';
  END IF;
  INSERT INTO public.session_adviser_assignments (
    tenant_id, session_id, adviser_user_id, adviser_capacity, assigned_at, assigned_by, source,
    source_session_advisor_id
  )
  VALUES (
    NEW.tenant_id, NEW.session_id, NEW.advisor_id, v_capacity, now(), NEW.assigned_by,
    'session_advisors_insert', NEW.id
  );
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.session_adviser_history_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.tenant_id IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE public.session_adviser_assignments a
  SET unassigned_at = now(), unassigned_recorded_at = now()
  WHERE a.tenant_id = OLD.tenant_id AND a.session_id = OLD.session_id
    AND a.adviser_user_id = OLD.advisor_id AND a.unassigned_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_adviser_history_missing';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.session_adviser_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'session_advisors_truncate_forbidden';
  END IF;
  IF NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.advisor_id IS DISTINCT FROM OLD.advisor_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'session_adviser_identity_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER session_advisors_history_open
  AFTER INSERT ON public.session_advisors
  FOR EACH ROW EXECUTE FUNCTION public.session_adviser_history_on_insert();
CREATE TRIGGER session_advisors_history_close
  AFTER DELETE ON public.session_advisors
  FOR EACH ROW EXECUTE FUNCTION public.session_adviser_history_on_delete();
CREATE TRIGGER session_advisors_identity_immutable
  BEFORE UPDATE ON public.session_advisors
  FOR EACH ROW EXECUTE FUNCTION public.session_adviser_identity_guard();
CREATE TRIGGER session_advisors_no_truncate
  BEFORE TRUNCATE ON public.session_advisors
  FOR EACH STATEMENT EXECUTE FUNCTION public.session_adviser_identity_guard();

-- As-of resolver: who was assigned to this tenant's session at p_event_at. Never the current
-- assignment. Before live capture began, an uncovered instant is 'no_proof' and a covered one is
-- 'assigned_history_incomplete' (other, since-removed advisers cannot be ruled out).
CREATE FUNCTION public.resolve_session_advisers_as_of(
  p_tenant_id uuid,
  p_session_id uuid,
  p_event_at timestamptz
)
RETURNS TABLE (
  resolution text,
  adviser_user_id uuid,
  adviser_capacity public.tenant_member_role,
  assignment_id uuid,
  assigned_at timestamptz,
  unassigned_at timestamptz,
  history_complete boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_complete boolean;
  v_found boolean := false;
BEGIN
  IF p_tenant_id IS NULL OR p_session_id IS NULL OR p_event_at IS NULL
     OR p_event_at IN ('-infinity'::timestamptz, 'infinity'::timestamptz) THEN
    RAISE EXCEPTION 'session_adviser_resolve_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.interview_sessions s WHERE s.id = p_session_id AND s.tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'session_adviser_resolve_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT p_event_at >= c.started_at INTO v_complete
  FROM public.session_adviser_history_capture c WHERE c.singleton;
  IF v_complete IS NULL THEN
    RAISE EXCEPTION 'session_adviser_history_capture_missing';
  END IF;

  FOR resolution, adviser_user_id, adviser_capacity, assignment_id, assigned_at, unassigned_at,
      history_complete IN
    SELECT CASE WHEN v_complete THEN 'assigned' ELSE 'assigned_history_incomplete' END,
           a.adviser_user_id, a.adviser_capacity, a.id, a.assigned_at, a.unassigned_at, v_complete
    FROM public.session_adviser_assignments a
    WHERE a.tenant_id = p_tenant_id AND a.session_id = p_session_id
      AND a.assigned_at <= p_event_at
      AND (a.unassigned_at IS NULL OR p_event_at < a.unassigned_at)
    ORDER BY a.assigned_at, a.adviser_user_id
  LOOP
    v_found := true;
    RETURN NEXT;
  END LOOP;
  IF NOT v_found THEN
    resolution := CASE WHEN v_complete THEN 'none_assigned' ELSE 'no_proof' END;
    adviser_user_id := NULL;
    adviser_capacity := NULL;
    assignment_id := NULL;
    assigned_at := NULL;
    unassigned_at := NULL;
    history_complete := v_complete;
    RETURN NEXT;
  END IF;
END;
$$;

-- I. Validation blockers: every reason this tenant's statement cannot be validated (empty = valid).
CREATE FUNCTION public.network_statement_validation_blockers(p_tenant_id uuid, p_statement_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_stmt public.network_commission_statements%ROWTYPE;
  v_out text[] := ARRAY[]::text[];
  v_sum bigint;
  v_lines bigint;
BEGIN
  SELECT * INTO v_stmt FROM public.network_commission_statements s
  WHERE s.id = p_statement_id AND s.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN ARRAY['statement_not_found'];
  END IF;
  IF v_stmt.status NOT IN ('draft', 'annotated') THEN
    v_out := array_append(v_out, 'statement_not_open');
  END IF;

  SELECT count(*), COALESCE(sum(l.amount_received_pence), 0) INTO v_lines, v_sum
  FROM public.network_commission_lines l
  WHERE l.statement_id = v_stmt.id AND l.superseded_at IS NULL;
  IF v_lines = 0 THEN
    v_out := array_append(v_out, 'no_lines');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.network_commission_lines l
    WHERE l.statement_id = v_stmt.id AND l.superseded_at IS NULL
      AND l.tenant_id IS DISTINCT FROM v_stmt.tenant_id
  ) THEN
    v_out := array_append(v_out, 'line_tenant_mismatch');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.network_commission_lines l
    WHERE l.statement_id = v_stmt.id AND l.superseded_at IS NULL
      AND l.allocation_status NOT IN ('allocated', 'skipped')
  ) THEN
    v_out := array_append(v_out, 'line_unresolved');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.network_commission_lines l
    WHERE l.statement_id = v_stmt.id AND l.superseded_at IS NULL
      AND l.allocation_status = 'skipped' AND NULLIF(btrim(COALESCE(l.skip_reason, '')), '') IS NULL
  ) THEN
    v_out := array_append(v_out, 'skip_reason_missing');
  END IF;
  IF v_stmt.declared_total_pence IS NULL THEN
    v_out := array_append(v_out, 'declared_total_missing');
  ELSIF v_stmt.declared_total_pence <> v_sum THEN
    v_out := array_append(v_out, 'total_mismatch');
  END IF;

  -- Each allocated line has exactly its one active draft fee with the line's facts.
  IF EXISTS (
    SELECT 1 FROM public.network_commission_lines l
    WHERE l.statement_id = v_stmt.id AND l.superseded_at IS NULL
      AND l.allocation_status = 'allocated'
      AND NOT EXISTS (
        SELECT 1 FROM public.finance_fee_lines f
        WHERE f.id = l.fee_line_id AND f.source_network_line_id = l.id
          AND f.tenant_id = l.tenant_id AND f.status::text <> 'deleted'
          AND f.session_id = l.matched_session_id
          AND f.amount_pence = l.amount_received_pence AND f.fee_type::text = l.fee_type
      )
  ) THEN
    v_out := array_append(v_out, 'allocation_inconsistent');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.finance_fee_lines f
    JOIN public.network_commission_lines l ON l.id = f.source_network_line_id
    WHERE l.statement_id = v_stmt.id AND f.status::text <> 'deleted'
      AND (l.superseded_at IS NOT NULL OR l.fee_line_id IS DISTINCT FROM f.id)
  ) THEN
    v_out := array_append(v_out, 'duplicate_allocation');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.network_commission_lines l
    JOIN public.finance_fee_lines f ON f.id = l.fee_line_id
    WHERE l.statement_id = v_stmt.id AND l.superseded_at IS NULL
      AND l.allocation_status = 'allocated' AND f.fee_event_date IS NULL
  ) THEN
    v_out := array_append(v_out, 'economic_date_missing');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.network_commission_lines l
    JOIN public.finance_fee_lines f ON f.id = l.fee_line_id
    WHERE l.statement_id = v_stmt.id AND l.superseded_at IS NULL
      AND l.allocation_status = 'allocated'
      AND f.fee_event_source = 'network_statement_received_date'
      AND v_stmt.received_date_confirmed_at IS NULL
  ) THEN
    v_out := array_append(v_out, 'received_date_unconfirmed');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.network_commission_lines l
    JOIN public.finance_fee_lines f ON f.id = l.fee_line_id
    WHERE l.statement_id = v_stmt.id AND l.superseded_at IS NULL
      AND l.allocation_status = 'allocated' AND f.fee_event_date IS NOT NULL
      AND NOT (
        (f.fee_event_source = 'network_line_transaction_date'
          AND l.transaction_date IS NOT DISTINCT FROM f.fee_event_date)
        OR (f.fee_event_source = 'network_statement_received_date'
          AND l.transaction_date IS NULL
          AND v_stmt.received_date IS NOT DISTINCT FROM f.fee_event_date)
      )
  ) THEN
    v_out := array_append(v_out, 'economic_date_mismatch');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.network_commission_lines l
    LEFT JOIN public.interview_sessions s ON s.id = l.matched_session_id
    WHERE l.statement_id = v_stmt.id AND l.superseded_at IS NULL
      AND l.allocation_status = 'allocated'
      AND (s.id IS NULL OR s.tenant_id IS DISTINCT FROM l.tenant_id OR s.deleted_at IS NOT NULL)
  ) THEN
    v_out := array_append(v_out, 'session_unavailable');
  END IF;
  RETURN v_out;
END;
$$;

-- Guards. Fee lines: created only from a network line (facts and economic date copied from the
-- source), source facts immutable, void only as a draft deallocation, no posting here, no delete.
CREATE FUNCTION public.finance_fee_lines_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_line public.network_commission_lines%ROWTYPE;
  v_stmt public.network_commission_statements%ROWTYPE;
  v_changed text[];
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'finance_fee_line_delete_forbidden';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.source_network_line_id IS NULL THEN
      RAISE EXCEPTION 'finance_fee_line_source_required';
    END IF;
    IF NEW.status::text <> 'draft' OR NEW.posted_at IS NOT NULL OR NEW.batch_id IS NOT NULL
       OR NEW.voided_at IS NOT NULL OR NEW.voided_by IS NOT NULL OR NEW.void_reason IS NOT NULL THEN
      RAISE EXCEPTION 'finance_fee_line_insert_invalid';
    END IF;
    SELECT * INTO v_line FROM public.network_commission_lines l
    WHERE l.id = NEW.source_network_line_id AND l.tenant_id = NEW.tenant_id;
    IF NOT FOUND OR v_line.superseded_at IS NOT NULL THEN
      RAISE EXCEPTION 'finance_fee_line_source_invalid';
    END IF;
    SELECT * INTO v_stmt FROM public.network_commission_statements s
    WHERE s.id = v_line.statement_id AND s.tenant_id = v_line.tenant_id;
    IF v_stmt.status NOT IN ('draft', 'annotated') THEN
      RAISE EXCEPTION 'network_statement_frozen';
    END IF;
    IF v_line.matched_session_id IS NULL OR NEW.session_id IS DISTINCT FROM v_line.matched_session_id
       OR NEW.amount_pence IS DISTINCT FROM v_line.amount_received_pence
       OR NEW.fee_type::text IS DISTINCT FROM v_line.fee_type THEN
      RAISE EXCEPTION 'finance_fee_line_source_mismatch';
    END IF;
    IF v_line.transaction_date IS NOT NULL THEN
      NEW.fee_event_date := v_line.transaction_date;
      NEW.fee_event_source := 'network_line_transaction_date';
      NEW.fee_event_evidence := jsonb_build_object(
        'statement_id', v_stmt.id,
        'network_line_id', v_line.id,
        'date_source', v_line.transaction_date_source,
        'date_set_by', v_line.transaction_date_set_by,
        'date_set_at', v_line.transaction_date_set_at
      );
    ELSIF v_stmt.received_date IS NOT NULL AND v_stmt.received_date_confirmed_at IS NOT NULL THEN
      NEW.fee_event_date := v_stmt.received_date;
      NEW.fee_event_source := 'network_statement_received_date';
      NEW.fee_event_evidence := jsonb_build_object(
        'statement_id', v_stmt.id,
        'network_line_id', v_line.id,
        'received_date_confirmed_by', v_stmt.received_date_confirmed_by,
        'received_date_confirmed_at', v_stmt.received_date_confirmed_at,
        'received_date_evidence', v_stmt.received_date_evidence
      );
    ELSE
      RAISE EXCEPTION 'network_allocation_date_required';
    END IF;
    NEW.fee_event_at := NEW.fee_event_date::timestamp AT TIME ZONE 'Europe/London';
    RETURN NEW;
  END IF;

  SELECT COALESCE(array_agg(n.key), ARRAY[]::text[]) INTO v_changed
  FROM jsonb_each(to_jsonb(NEW)) n JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
  WHERE n.value IS DISTINCT FROM o.value;
  -- auth.users ON DELETE SET NULL on created_by.
  IF v_changed <@ ARRAY['created_by', 'updated_at'] AND NEW.created_by IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status = OLD.status THEN
    IF (OLD.status::text = 'draft' AND v_changed <@ ARRAY['note', 'updated_at'])
       OR v_changed <@ ARRAY['updated_at'] THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'finance_fee_line_source_immutable';
  END IF;

  IF OLD.status::text = 'draft' AND NEW.status::text = 'deleted'
     AND v_changed <@ ARRAY['status', 'voided_at', 'voided_by', 'void_reason', 'updated_at'] THEN
    IF OLD.source_network_line_id IS NULL THEN
      RAISE EXCEPTION 'finance_fee_line_void_unavailable';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.network_commission_lines l
      JOIN public.network_commission_statements s
        ON s.id = l.statement_id AND s.tenant_id = l.tenant_id
      WHERE l.id = OLD.source_network_line_id AND l.tenant_id = OLD.tenant_id
        AND s.status IN ('draft', 'annotated')
    ) THEN
      RAISE EXCEPTION 'network_statement_frozen';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'finance_fee_line_transition_forbidden';
END;
$$;

CREATE TRIGGER finance_fee_lines_source_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.finance_fee_lines
  FOR EACH ROW EXECUTE FUNCTION public.finance_fee_lines_guard();
CREATE TRIGGER finance_fee_lines_no_truncate
  BEFORE TRUNCATE ON public.finance_fee_lines
  FOR EACH STATEMENT EXECUTE FUNCTION public.finance_fee_lines_guard();

-- Lines: parsed facts immutable; frozen with a validated statement; allocated lines change only
-- by deallocation; superseded lines never change; never deleted.
CREATE FUNCTION public.network_commission_lines_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_changed text[];
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'network_line_delete_forbidden';
  END IF;
  SELECT s.status INTO v_status FROM public.network_commission_statements s
  WHERE s.id = NEW.statement_id AND s.tenant_id = NEW.tenant_id;

  IF TG_OP = 'INSERT' THEN
    IF v_status IS NULL OR v_status NOT IN ('draft', 'annotated') THEN
      RAISE EXCEPTION 'network_statement_frozen';
    END IF;
    IF NEW.allocation_status NOT IN ('unmatched', 'matched') OR NEW.fee_line_id IS NOT NULL
       OR NEW.allocated_by IS NOT NULL OR NEW.allocated_at IS NOT NULL
       OR NEW.superseded_at IS NOT NULL OR NEW.skip_reason IS NOT NULL THEN
      RAISE EXCEPTION 'network_line_insert_invalid';
    END IF;
    RETURN NEW;
  END IF;

  SELECT COALESCE(array_agg(n.key), ARRAY[]::text[]) INTO v_changed
  FROM jsonb_each(to_jsonb(NEW)) n JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
  WHERE n.value IS DISTINCT FROM o.value;
  -- auth.users ON DELETE SET NULL on allocated_by / matched_customer_id.
  IF v_changed <@ ARRAY['allocated_by', 'matched_customer_id', 'updated_at']
     AND (NOT ('allocated_by' = ANY (v_changed)) OR NEW.allocated_by IS NULL)
     AND (NOT ('matched_customer_id' = ANY (v_changed)) OR NEW.matched_customer_id IS NULL)
     AND v_changed && ARRAY['allocated_by', 'matched_customer_id'] THEN
    RETURN NEW;
  END IF;
  IF v_changed && ARRAY['id', 'statement_id', 'tenant_id', 'line_no', 'parse_batch_id', 'raw_json',
                        'created_at', 'customer_name', 'customer_email', 'case_ref',
                        'network_product', 'amount_received_pence', 'fee_type'] THEN
    RAISE EXCEPTION 'network_line_source_immutable';
  END IF;
  IF OLD.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'network_line_superseded';
  END IF;
  IF v_status IS NULL OR v_status NOT IN ('draft', 'annotated') THEN
    RAISE EXCEPTION 'network_statement_frozen';
  END IF;

  IF NEW.superseded_at IS NOT NULL THEN
    IF OLD.allocation_status = 'allocated'
       OR NOT (v_changed <@ ARRAY['superseded_at', 'superseded_by', 'updated_at']) THEN
      RAISE EXCEPTION 'network_line_supersede_invalid';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.allocation_status = 'allocated' THEN
    IF NEW.allocation_status = 'allocated' THEN
      IF v_changed <@ ARRAY['annotation', 'updated_at'] THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'network_line_allocated_immutable';
    END IF;
    IF NEW.allocation_status IN ('unmatched', 'matched') AND NEW.fee_line_id IS NULL
       AND NEW.allocated_by IS NULL AND NEW.allocated_at IS NULL
       AND v_changed <@ ARRAY['allocation_status', 'fee_line_id', 'allocated_by', 'allocated_at',
                              'updated_at']
       AND NOT EXISTS (
         SELECT 1 FROM public.finance_fee_lines f
         WHERE f.id = OLD.fee_line_id AND f.status::text <> 'deleted'
       ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'network_line_allocated_immutable';
  END IF;

  IF NEW.allocation_status = 'allocated' THEN
    IF OLD.allocation_status IN ('unmatched', 'matched')
       AND NEW.allocated_by IS NOT NULL AND NEW.allocated_at IS NOT NULL
       AND v_changed <@ ARRAY['allocation_status', 'fee_line_id', 'allocated_by', 'allocated_at',
                              'updated_at']
       AND EXISTS (
         SELECT 1 FROM public.finance_fee_lines f
         WHERE f.id = NEW.fee_line_id AND f.source_network_line_id = NEW.id
           AND f.tenant_id = NEW.tenant_id AND f.status::text = 'draft'
           AND f.session_id = NEW.matched_session_id
       ) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'network_line_allocation_invalid';
  END IF;

  IF NOT (v_changed <@ ARRAY['allocation_status', 'matched_customer_id', 'matched_session_id',
                             'annotation', 'transaction_date', 'transaction_date_source',
                             'transaction_date_set_by', 'transaction_date_set_at', 'skip_reason',
                             'skipped_by', 'skipped_at', 'updated_at']) THEN
    RAISE EXCEPTION 'network_line_change_forbidden';
  END IF;
  IF v_changed && ARRAY['transaction_date', 'transaction_date_source', 'transaction_date_set_by',
                        'transaction_date_set_at']
     AND NEW.transaction_date IS NOT NULL AND NEW.transaction_date_source <> 'staff_entry' THEN
    RAISE EXCEPTION 'network_line_date_invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER network_commission_lines_source_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.network_commission_lines
  FOR EACH ROW EXECUTE FUNCTION public.network_commission_lines_guard();
CREATE TRIGGER network_commission_lines_no_truncate
  BEFORE TRUNCATE ON public.network_commission_lines
  FOR EACH STATEMENT EXECUTE FUNCTION public.network_commission_lines_guard();

-- Statements: identity immutable; validation only when every blocker is clear; frozen while
-- validated; unlock only by an active Owner with a reason and no posted source fee; never deleted.
CREATE FUNCTION public.network_commission_statements_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_changed text[];
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'network_statement_delete_forbidden';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.validated_by IS NOT NULL OR NEW.validated_at IS NOT NULL
       OR NEW.received_date IS NOT NULL OR NEW.declared_total_pence IS NOT NULL
       OR NEW.last_unlocked_at IS NOT NULL THEN
      RAISE EXCEPTION 'network_statement_insert_invalid';
    END IF;
    RETURN NEW;
  END IF;

  SELECT COALESCE(array_agg(n.key), ARRAY[]::text[]) INTO v_changed
  FROM jsonb_each(to_jsonb(NEW)) n JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
  WHERE n.value IS DISTINCT FROM o.value;
  -- auth.users ON DELETE SET NULL on created_by / validated_by.
  IF v_changed <@ ARRAY['created_by', 'validated_by', 'updated_at']
     AND v_changed && ARRAY['created_by', 'validated_by']
     AND (NOT ('created_by' = ANY (v_changed)) OR NEW.created_by IS NULL)
     AND (NOT ('validated_by' = ANY (v_changed)) OR NEW.validated_by IS NULL) THEN
    RETURN NEW;
  END IF;
  IF v_changed && ARRAY['id', 'tenant_id', 'period_month', 'created_at', 'created_by'] THEN
    RAISE EXCEPTION 'network_statement_identity_immutable';
  END IF;

  IF OLD.status IN ('validated', 'locked') THEN
    IF NEW.status = 'draft'
       AND v_changed <@ ARRAY['status', 'validated_by', 'validated_at', 'last_unlocked_by',
                              'last_unlocked_at', 'last_unlock_reason', 'updated_at']
       AND NEW.validated_by IS NULL AND NEW.validated_at IS NULL
       AND NEW.last_unlocked_at = now()
       AND NULLIF(btrim(COALESCE(NEW.last_unlock_reason, '')), '') IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.tenant_memberships m
         WHERE m.user_id = NEW.last_unlocked_by AND m.tenant_id = NEW.tenant_id
           AND m.role::text = 'owner' AND m.active
       ) THEN
      IF EXISTS (
        SELECT 1 FROM public.finance_fee_lines f
        JOIN public.network_commission_lines l ON l.id = f.source_network_line_id
        WHERE l.statement_id = NEW.id AND l.tenant_id = NEW.tenant_id
          AND (f.status::text IN ('posted', 'amended') OR f.posted_at IS NOT NULL
               OR EXISTS (SELECT 1 FROM public.finance_ledger g WHERE g.fee_line_id = f.id))
      ) THEN
        RAISE EXCEPTION 'network_unlock_posted_fee';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'network_statement_frozen';
  END IF;

  IF NEW.status = 'validated' THEN
    IF NEW.validated_by IS NULL OR NEW.validated_at IS NULL
       OR NOT (v_changed <@ ARRAY['status', 'validated_by', 'validated_at', 'updated_at']) THEN
      RAISE EXCEPTION 'network_statement_change_forbidden';
    END IF;
    PERFORM public.network_finance_actor_role(NEW.tenant_id, NEW.validated_by, 'validate');
    IF cardinality(public.network_statement_validation_blockers(NEW.tenant_id, NEW.id)) > 0 THEN
      RAISE EXCEPTION 'network_validation_blocked';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('draft', 'annotated')
     OR NOT (v_changed <@ ARRAY['status', 'notes', 'raw_source', 'received_date',
                                'received_date_confirmed_by', 'received_date_confirmed_at',
                                'received_date_evidence', 'declared_total_pence',
                                'declared_total_set_by', 'declared_total_set_at', 'updated_at']) THEN
    RAISE EXCEPTION 'network_statement_change_forbidden';
  END IF;
  IF v_changed && ARRAY['received_date', 'received_date_confirmed_by', 'received_date_confirmed_at',
                        'received_date_evidence']
     AND EXISTS (
       SELECT 1 FROM public.finance_fee_lines f
       JOIN public.network_commission_lines l ON l.id = f.source_network_line_id
       WHERE l.statement_id = NEW.id AND l.tenant_id = NEW.tenant_id
         AND f.status::text <> 'deleted' AND f.fee_event_source = 'network_statement_received_date'
     ) THEN
    RAISE EXCEPTION 'network_received_date_in_use';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER network_commission_statements_source_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.network_commission_statements
  FOR EACH ROW EXECUTE FUNCTION public.network_commission_statements_guard();
CREATE TRIGGER network_commission_statements_no_truncate
  BEFORE TRUNCATE ON public.network_commission_statements
  FOR EACH STATEMENT EXECUTE FUNCTION public.network_commission_statements_guard();

-- J. Network statement operations. The caller (service role) has already resolved the acting
-- tenant and the capability; the actor's membership and permission are re-checked here.
CREATE FUNCTION public.network_finance_actor_role(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_capability text
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_key text;
BEGIN
  IF p_tenant_id IS NULL OR p_actor_user_id IS NULL
     OR p_capability IS NULL OR p_capability NOT IN ('amend', 'validate', 'unlock') THEN
    RAISE EXCEPTION 'network_finance_forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM 1 FROM public.tenants t WHERE t.id = p_tenant_id AND t.status::text = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'network_finance_forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_key := CASE p_capability WHEN 'amend' THEN 'finance_network_statements'
                             WHEN 'validate' THEN 'finance_network_validate' END;
  SELECT m.role::text INTO v_role
  FROM public.tenant_memberships m
  WHERE m.user_id = p_actor_user_id AND m.tenant_id = p_tenant_id AND m.active
    AND (m.role::text = 'owner'
      OR (p_capability <> 'unlock' AND m.role::text = 'supervisor')
      OR (p_capability <> 'unlock' AND m.role::text = 'general' AND EXISTS (
        SELECT 1 FROM public.admin_permissions ap
        WHERE ap.user_id = p_actor_user_id AND ap.tenant_id = p_tenant_id
          AND ap.permission_key = v_key AND ap.access = 'amend')))
  ORDER BY CASE m.role::text WHEN 'owner' THEN 1 WHEN 'supervisor' THEN 2 ELSE 3 END
  LIMIT 1
  FOR SHARE;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'network_finance_forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_role;
END;
$$;

CREATE FUNCTION public.network_finance_audit(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_role text,
  p_audit_type text,
  p_session_id uuid,
  p_customer_id uuid,
  p_fee_type text,
  p_summary text,
  p_detail jsonb
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  INSERT INTO public.finance_audit_log (
    audit_type, session_id, customer_id, role, fee_type, summary, detail, changed_by, tenant_id
  )
  VALUES (
    p_audit_type, p_session_id, p_customer_id, p_role, p_fee_type, p_summary, p_detail,
    p_actor_user_id, p_tenant_id
  );
$$;

CREATE FUNCTION public.allocate_network_line(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_line_id uuid,
  p_session_id uuid
)
RETURNS TABLE (
  fee_line_id uuid,
  created boolean,
  fee_event_date date,
  fee_event_source text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_role text;
  v_line public.network_commission_lines%ROWTYPE;
  v_stmt public.network_commission_statements%ROWTYPE;
  v_session uuid;
  v_customer uuid;
  v_fee public.finance_fee_lines%ROWTYPE;
BEGIN
  v_role := public.network_finance_actor_role(p_tenant_id, p_actor_user_id, 'amend');
  SELECT * INTO v_line FROM public.network_commission_lines l
  WHERE l.id = p_line_id AND l.tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'network_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO v_stmt FROM public.network_commission_statements s
  WHERE s.id = v_line.statement_id AND s.tenant_id = p_tenant_id
  FOR SHARE;
  IF v_stmt.status NOT IN ('draft', 'annotated') THEN
    RAISE EXCEPTION 'network_statement_frozen';
  END IF;
  IF v_line.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'network_line_superseded';
  END IF;
  v_session := COALESCE(p_session_id, v_line.matched_session_id);
  IF v_session IS NULL THEN
    RAISE EXCEPTION 'network_allocation_session_required';
  END IF;
  SELECT s.customer_id INTO v_customer FROM public.interview_sessions s
  WHERE s.id = v_session AND s.tenant_id = p_tenant_id AND s.deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'network_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_line.allocation_status = 'allocated' THEN
    SELECT * INTO v_fee FROM public.finance_fee_lines f
    WHERE f.id = v_line.fee_line_id AND f.tenant_id = p_tenant_id;
    IF v_fee.id IS NOT NULL AND v_fee.status::text <> 'deleted' AND v_fee.session_id = v_session THEN
      fee_line_id := v_fee.id;
      created := false;
      fee_event_date := v_fee.fee_event_date;
      fee_event_source := v_fee.fee_event_source;
      RETURN NEXT;
      RETURN;
    END IF;
    RAISE EXCEPTION 'network_line_already_allocated';
  END IF;
  IF v_line.allocation_status = 'skipped' THEN
    RAISE EXCEPTION 'network_line_skipped';
  END IF;
  IF v_line.amount_received_pence <= 0 THEN
    RAISE EXCEPTION 'network_line_amount_invalid';
  END IF;
  IF v_line.transaction_date IS NULL
     AND (v_stmt.received_date IS NULL OR v_stmt.received_date_confirmed_at IS NULL) THEN
    RAISE EXCEPTION 'network_allocation_date_required';
  END IF;

  UPDATE public.network_commission_lines l
  SET matched_session_id = v_session, matched_customer_id = v_customer, allocation_status = 'matched',
      updated_at = now()
  WHERE l.id = v_line.id;
  INSERT INTO public.finance_fee_lines (
    session_id, fee_type, amount_pence, note, status, created_by, tenant_id, source_network_line_id
  )
  VALUES (
    v_session, v_line.fee_type::public.finance_fee_type, v_line.amount_received_pence,
    'Network statement ' || left(v_stmt.id::text, 8) || ' · '
      || COALESCE(v_line.case_ref, v_line.customer_name, 'line ' || v_line.line_no::text),
    'draft', p_actor_user_id, p_tenant_id, v_line.id
  )
  RETURNING * INTO v_fee;
  UPDATE public.network_commission_lines l
  SET allocation_status = 'allocated', fee_line_id = v_fee.id, allocated_by = p_actor_user_id,
      allocated_at = now(), updated_at = now()
  WHERE l.id = v_line.id;

  PERFORM public.network_finance_audit(
    p_tenant_id, p_actor_user_id, v_role, 'network_line_allocated', v_session, v_customer,
    v_line.fee_type, 'Network line allocated as a draft fee',
    jsonb_build_object('statement_id', v_stmt.id, 'network_line_id', v_line.id,
                       'fee_line_id', v_fee.id, 'amount_pence', v_fee.amount_pence,
                       'fee_event_date', v_fee.fee_event_date,
                       'fee_event_source', v_fee.fee_event_source));
  fee_line_id := v_fee.id;
  created := true;
  fee_event_date := v_fee.fee_event_date;
  fee_event_source := v_fee.fee_event_source;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION public.deallocate_network_line(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_line_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_line public.network_commission_lines%ROWTYPE;
  v_stmt public.network_commission_statements%ROWTYPE;
  v_fee public.finance_fee_lines%ROWTYPE;
BEGIN
  v_role := public.network_finance_actor_role(p_tenant_id, p_actor_user_id, 'amend');
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'network_deallocation_reason_required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_line FROM public.network_commission_lines l
  WHERE l.id = p_line_id AND l.tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'network_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO v_stmt FROM public.network_commission_statements s
  WHERE s.id = v_line.statement_id AND s.tenant_id = p_tenant_id
  FOR SHARE;
  IF v_stmt.status NOT IN ('draft', 'annotated') THEN
    RAISE EXCEPTION 'network_statement_frozen';
  END IF;
  IF v_line.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'network_line_superseded';
  END IF;
  IF v_line.allocation_status <> 'allocated' THEN
    RAISE EXCEPTION 'network_line_not_allocated';
  END IF;
  SELECT * INTO v_fee FROM public.finance_fee_lines f
  WHERE f.id = v_line.fee_line_id AND f.tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'network_line_not_allocated';
  END IF;
  IF v_fee.posted_at IS NOT NULL OR v_fee.status::text IN ('posted', 'amended')
     OR (v_fee.status::text = 'deleted' AND v_fee.voided_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.finance_ledger g WHERE g.fee_line_id = v_fee.id) THEN
    RAISE EXCEPTION 'network_deallocation_fee_not_draft';
  END IF;
  IF v_fee.status::text = 'draft' THEN
    UPDATE public.finance_fee_lines f
    SET status = 'deleted', voided_at = now(), voided_by = p_actor_user_id, void_reason = v_reason,
        updated_at = now()
    WHERE f.id = v_fee.id;
  END IF;
  UPDATE public.network_commission_lines l
  SET allocation_status = CASE WHEN l.matched_session_id IS NULL THEN 'unmatched' ELSE 'matched' END,
      fee_line_id = NULL, allocated_by = NULL, allocated_at = NULL, updated_at = now()
  WHERE l.id = v_line.id;

  PERFORM public.network_finance_audit(
    p_tenant_id, p_actor_user_id, v_role, 'network_line_deallocated', v_fee.session_id,
    v_line.matched_customer_id, v_line.fee_type, 'Network line deallocated; draft fee voided',
    jsonb_build_object('statement_id', v_stmt.id, 'network_line_id', v_line.id,
                       'fee_line_id', v_fee.id, 'reason', v_reason));
  RETURN v_fee.id;
END;
$$;

CREATE FUNCTION public.set_network_line_skip(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_line_id uuid,
  p_skip boolean,
  p_reason text
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_line public.network_commission_lines%ROWTYPE;
  v_stmt public.network_commission_statements%ROWTYPE;
  v_status text;
BEGIN
  v_role := public.network_finance_actor_role(p_tenant_id, p_actor_user_id, 'amend');
  IF p_skip IS NULL THEN
    RAISE EXCEPTION 'network_line_skip_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_skip AND (v_reason IS NULL OR char_length(v_reason) > 500) THEN
    RAISE EXCEPTION 'network_skip_reason_required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_line FROM public.network_commission_lines l
  WHERE l.id = p_line_id AND l.tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'network_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO v_stmt FROM public.network_commission_statements s
  WHERE s.id = v_line.statement_id AND s.tenant_id = p_tenant_id
  FOR SHARE;
  IF v_stmt.status NOT IN ('draft', 'annotated') THEN
    RAISE EXCEPTION 'network_statement_frozen';
  END IF;
  IF v_line.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'network_line_superseded';
  END IF;
  IF p_skip THEN
    IF v_line.allocation_status NOT IN ('unmatched', 'matched') THEN
      RAISE EXCEPTION 'network_line_skip_invalid';
    END IF;
    UPDATE public.network_commission_lines l
    SET allocation_status = 'skipped', skip_reason = v_reason, skipped_by = p_actor_user_id,
        skipped_at = now(), updated_at = now()
    WHERE l.id = v_line.id;
    v_status := 'skipped';
  ELSE
    IF v_line.allocation_status <> 'skipped' THEN
      RAISE EXCEPTION 'network_line_skip_invalid';
    END IF;
    v_status := CASE WHEN v_line.matched_session_id IS NULL AND v_line.matched_customer_id IS NULL
                     THEN 'unmatched' ELSE 'matched' END;
    UPDATE public.network_commission_lines l
    SET allocation_status = v_status, skip_reason = NULL, skipped_by = NULL, skipped_at = NULL,
        updated_at = now()
    WHERE l.id = v_line.id;
  END IF;

  PERFORM public.network_finance_audit(
    p_tenant_id, p_actor_user_id, v_role,
    CASE WHEN p_skip THEN 'network_line_skipped' ELSE 'network_line_unskipped' END,
    v_line.matched_session_id, v_line.matched_customer_id, v_line.fee_type,
    CASE WHEN p_skip THEN 'Network line skipped' ELSE 'Network line skip removed' END,
    jsonb_build_object('statement_id', v_stmt.id, 'network_line_id', v_line.id,
                       'reason', v_reason, 'previous_reason', v_line.skip_reason));
  RETURN v_status;
END;
$$;

CREATE FUNCTION public.set_network_line_transaction_date(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_line_id uuid,
  p_transaction_date date
)
RETURNS date
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_line public.network_commission_lines%ROWTYPE;
  v_stmt public.network_commission_statements%ROWTYPE;
BEGIN
  v_role := public.network_finance_actor_role(p_tenant_id, p_actor_user_id, 'amend');
  IF p_transaction_date IN ('-infinity'::date, 'infinity'::date)
     OR p_transaction_date > (now() AT TIME ZONE 'Europe/London')::date THEN
    RAISE EXCEPTION 'network_line_date_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_line FROM public.network_commission_lines l
  WHERE l.id = p_line_id AND l.tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'network_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO v_stmt FROM public.network_commission_statements s
  WHERE s.id = v_line.statement_id AND s.tenant_id = p_tenant_id
  FOR SHARE;
  IF v_stmt.status NOT IN ('draft', 'annotated') THEN
    RAISE EXCEPTION 'network_statement_frozen';
  END IF;
  IF v_line.superseded_at IS NOT NULL THEN
    RAISE EXCEPTION 'network_line_superseded';
  END IF;
  IF v_line.allocation_status = 'allocated' THEN
    RAISE EXCEPTION 'network_line_allocated_immutable';
  END IF;
  UPDATE public.network_commission_lines l
  SET transaction_date = p_transaction_date,
      transaction_date_source = CASE WHEN p_transaction_date IS NULL THEN NULL ELSE 'staff_entry' END,
      transaction_date_set_by = CASE WHEN p_transaction_date IS NULL THEN NULL ELSE p_actor_user_id END,
      transaction_date_set_at = CASE WHEN p_transaction_date IS NULL THEN NULL ELSE now() END,
      updated_at = now()
  WHERE l.id = v_line.id;

  PERFORM public.network_finance_audit(
    p_tenant_id, p_actor_user_id, v_role, 'network_line_date_set', v_line.matched_session_id,
    v_line.matched_customer_id, v_line.fee_type, 'Network line transaction date set by staff',
    jsonb_build_object('statement_id', v_stmt.id, 'network_line_id', v_line.id,
                       'transaction_date', p_transaction_date,
                       'previous_transaction_date', v_line.transaction_date,
                       'previous_source', v_line.transaction_date_source));
  RETURN p_transaction_date;
END;
$$;

CREATE FUNCTION public.confirm_network_statement_received_date(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_statement_id uuid,
  p_received_date date,
  p_confirmed boolean,
  p_evidence text
)
RETURNS date
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_evidence text := NULLIF(btrim(COALESCE(p_evidence, '')), '');
  v_stmt public.network_commission_statements%ROWTYPE;
BEGIN
  v_role := public.network_finance_actor_role(p_tenant_id, p_actor_user_id, 'amend');
  IF p_confirmed IS NOT TRUE THEN
    RAISE EXCEPTION 'network_received_date_unconfirmed' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_received_date IS NULL OR p_received_date IN ('-infinity'::date, 'infinity'::date)
     OR p_received_date > (now() AT TIME ZONE 'Europe/London')::date
     OR char_length(COALESCE(v_evidence, '')) > 500 THEN
    RAISE EXCEPTION 'network_received_date_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_stmt FROM public.network_commission_statements s
  WHERE s.id = p_statement_id AND s.tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'network_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_stmt.status NOT IN ('draft', 'annotated') THEN
    RAISE EXCEPTION 'network_statement_frozen';
  END IF;
  UPDATE public.network_commission_statements s
  SET received_date = p_received_date, received_date_confirmed_by = p_actor_user_id,
      received_date_confirmed_at = now(), received_date_evidence = v_evidence, updated_at = now()
  WHERE s.id = v_stmt.id;

  PERFORM public.network_finance_audit(
    p_tenant_id, p_actor_user_id, v_role, 'network_statement_received_date_confirmed', NULL, NULL,
    NULL, 'Network statement received date confirmed by staff',
    jsonb_build_object('statement_id', v_stmt.id, 'received_date', p_received_date,
                       'evidence', v_evidence, 'previous_received_date', v_stmt.received_date));
  RETURN p_received_date;
END;
$$;

CREATE FUNCTION public.set_network_statement_declared_total(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_statement_id uuid,
  p_declared_total_pence bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_stmt public.network_commission_statements%ROWTYPE;
BEGIN
  v_role := public.network_finance_actor_role(p_tenant_id, p_actor_user_id, 'amend');
  IF p_declared_total_pence IS NULL OR p_declared_total_pence < 0 THEN
    RAISE EXCEPTION 'network_declared_total_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_stmt FROM public.network_commission_statements s
  WHERE s.id = p_statement_id AND s.tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'network_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_stmt.status NOT IN ('draft', 'annotated') THEN
    RAISE EXCEPTION 'network_statement_frozen';
  END IF;
  UPDATE public.network_commission_statements s
  SET declared_total_pence = p_declared_total_pence, declared_total_set_by = p_actor_user_id,
      declared_total_set_at = now(), updated_at = now()
  WHERE s.id = v_stmt.id;

  PERFORM public.network_finance_audit(
    p_tenant_id, p_actor_user_id, v_role, 'network_statement_declared_total_set', NULL, NULL, NULL,
    'Network statement declared total set',
    jsonb_build_object('statement_id', v_stmt.id, 'declared_total_pence', p_declared_total_pence,
                       'previous_declared_total_pence', v_stmt.declared_total_pence));
  RETURN p_declared_total_pence;
END;
$$;

-- Re-parse supersedes the current lines (never deletes) and is refused while any line of the
-- statement has an active fee line.
CREATE FUNCTION public.replace_network_statement_lines(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_statement_id uuid,
  p_lines jsonb,
  p_raw_source text
)
RETURNS TABLE (parse_batch_id uuid, inserted_count integer, superseded_count integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_role text;
  v_stmt public.network_commission_statements%ROWTYPE;
  v_batch uuid := gen_random_uuid();
  v_item jsonb;
  v_no bigint;
  v_amount numeric;
  v_fee_type text;
  v_date date;
  v_inserted integer := 0;
  v_superseded integer := 0;
BEGIN
  v_role := public.network_finance_actor_role(p_tenant_id, p_actor_user_id, 'amend');
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0
     OR jsonb_array_length(p_lines) > 2000 OR char_length(COALESCE(p_raw_source, '')) > 200000 THEN
    RAISE EXCEPTION 'network_lines_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_stmt FROM public.network_commission_statements s
  WHERE s.id = p_statement_id AND s.tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'network_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_stmt.status NOT IN ('draft', 'annotated') THEN
    RAISE EXCEPTION 'network_statement_frozen';
  END IF;
  PERFORM 1 FROM public.network_commission_lines l
  WHERE l.statement_id = v_stmt.id AND l.superseded_at IS NULL
  FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.network_commission_lines l
    WHERE l.statement_id = v_stmt.id AND l.superseded_at IS NULL AND l.allocation_status = 'allocated'
  ) OR EXISTS (
    SELECT 1 FROM public.finance_fee_lines f
    JOIN public.network_commission_lines l ON l.id = f.source_network_line_id
    WHERE l.statement_id = v_stmt.id AND f.status::text <> 'deleted'
  ) THEN
    RAISE EXCEPTION 'network_reparse_active_allocation';
  END IF;

  UPDATE public.network_commission_lines l
  SET superseded_at = now(), superseded_by = p_actor_user_id, updated_at = now()
  WHERE l.statement_id = v_stmt.id AND l.superseded_at IS NULL;
  GET DIAGNOSTICS v_superseded = ROW_COUNT;

  FOR v_item, v_no IN SELECT e.value, e.ordinality FROM jsonb_array_elements(p_lines) WITH ORDINALITY e
  LOOP
    IF jsonb_typeof(v_item) <> 'object' OR jsonb_typeof(v_item -> 'amount_received_pence') <> 'number' THEN
      RAISE EXCEPTION 'network_lines_invalid' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_amount := (v_item ->> 'amount_received_pence')::numeric;
    v_fee_type := v_item ->> 'fee_type';
    IF v_amount <= 0 OR v_amount <> trunc(v_amount) OR v_amount > 2147483647
       OR v_fee_type IS NULL
       OR v_fee_type NOT IN ('fee', 'mortgage_fee', 'insurance_fee', 'other_fee') THEN
      RAISE EXCEPTION 'network_lines_invalid' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_date := NULL;
    IF v_item ? 'transaction_date' AND jsonb_typeof(v_item -> 'transaction_date') <> 'null' THEN
      IF jsonb_typeof(v_item -> 'transaction_date') <> 'string'
         OR (v_item ->> 'transaction_date') !~ '^\d{4}-\d{2}-\d{2}$' THEN
        RAISE EXCEPTION 'network_line_date_invalid' USING ERRCODE = 'invalid_parameter_value';
      END IF;
      BEGIN
        v_date := (v_item ->> 'transaction_date')::date;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'network_line_date_invalid' USING ERRCODE = 'invalid_parameter_value';
      END;
      IF to_char(v_date, 'YYYY-MM-DD') <> (v_item ->> 'transaction_date')
         OR v_date > (now() AT TIME ZONE 'Europe/London')::date THEN
        RAISE EXCEPTION 'network_line_date_invalid' USING ERRCODE = 'invalid_parameter_value';
      END IF;
    END IF;
    INSERT INTO public.network_commission_lines (
      statement_id, tenant_id, parse_batch_id, line_no, customer_name, customer_email, case_ref,
      fee_type, amount_received_pence, network_product, raw_json, allocation_status, annotation,
      transaction_date, transaction_date_source, transaction_date_set_by, transaction_date_set_at
    )
    VALUES (
      v_stmt.id, p_tenant_id, v_batch, v_no::integer,
      left(NULLIF(btrim(v_item ->> 'customer_name'), ''), 500),
      left(lower(NULLIF(btrim(v_item ->> 'customer_email'), '')), 320),
      left(NULLIF(btrim(v_item ->> 'case_ref'), ''), 200),
      v_fee_type, v_amount::integer,
      left(NULLIF(btrim(v_item ->> 'network_product'), ''), 500),
      v_item -> 'raw_json', 'unmatched',
      left(NULLIF(btrim(v_item ->> 'annotation'), ''), 2000),
      v_date,
      CASE WHEN v_date IS NULL THEN NULL ELSE 'statement_parser' END,
      CASE WHEN v_date IS NULL THEN NULL ELSE p_actor_user_id END,
      CASE WHEN v_date IS NULL THEN NULL ELSE now() END
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  UPDATE public.network_commission_statements s
  SET raw_source = p_raw_source, status = 'draft', updated_at = now()
  WHERE s.id = v_stmt.id;

  PERFORM public.network_finance_audit(
    p_tenant_id, p_actor_user_id, v_role, 'network_lines_replaced', NULL, NULL, NULL,
    'Network statement lines parsed (previous lines superseded)',
    jsonb_build_object('statement_id', v_stmt.id, 'parse_batch_id', v_batch,
                       'inserted', v_inserted, 'superseded', v_superseded));
  parse_batch_id := v_batch;
  inserted_count := v_inserted;
  superseded_count := v_superseded;
  RETURN NEXT;
END;
$$;

-- Validation reconciles and freezes the statement. It never posts and never changes a fee line.
CREATE FUNCTION public.validate_network_statement(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_statement_id uuid
)
RETURNS TABLE (status text, validated_at timestamptz, line_count integer, total_pence bigint)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_role text;
  v_stmt public.network_commission_statements%ROWTYPE;
  v_blockers text[];
  v_lines integer;
  v_now timestamptz := now();
BEGIN
  v_role := public.network_finance_actor_role(p_tenant_id, p_actor_user_id, 'validate');
  SELECT * INTO v_stmt FROM public.network_commission_statements s
  WHERE s.id = p_statement_id AND s.tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'network_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM 1 FROM public.network_commission_lines l
  WHERE l.statement_id = v_stmt.id AND l.superseded_at IS NULL
  FOR SHARE;
  v_blockers := public.network_statement_validation_blockers(p_tenant_id, v_stmt.id);
  IF cardinality(v_blockers) > 0 THEN
    RAISE EXCEPTION 'network_validation_blocked:%', array_to_string(v_blockers, ',');
  END IF;
  SELECT count(*) INTO v_lines FROM public.network_commission_lines l
  WHERE l.statement_id = v_stmt.id AND l.superseded_at IS NULL;
  UPDATE public.network_commission_statements s
  SET status = 'validated', validated_by = p_actor_user_id, validated_at = v_now, updated_at = v_now
  WHERE s.id = v_stmt.id;

  PERFORM public.network_finance_audit(
    p_tenant_id, p_actor_user_id, v_role, 'network_statement_validated', NULL, NULL, NULL,
    'Network statement validated (reconciled; nothing posted)',
    jsonb_build_object('statement_id', v_stmt.id, 'period_month', v_stmt.period_month,
                       'line_count', v_lines, 'declared_total_pence', v_stmt.declared_total_pence,
                       'received_date', v_stmt.received_date));
  status := 'validated';
  validated_at := v_now;
  line_count := v_lines;
  total_pence := v_stmt.declared_total_pence;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION public.unlock_network_statement(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_statement_id uuid,
  p_reason text
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_stmt public.network_commission_statements%ROWTYPE;
BEGIN
  v_role := public.network_finance_actor_role(p_tenant_id, p_actor_user_id, 'unlock');
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'network_unlock_reason_required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_stmt FROM public.network_commission_statements s
  WHERE s.id = p_statement_id AND s.tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'network_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_stmt.status NOT IN ('validated', 'locked') THEN
    RAISE EXCEPTION 'network_statement_not_validated';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.finance_fee_lines f
    JOIN public.network_commission_lines l ON l.id = f.source_network_line_id
    WHERE l.statement_id = v_stmt.id AND l.tenant_id = p_tenant_id
      AND (f.status::text IN ('posted', 'amended') OR f.posted_at IS NOT NULL
           OR EXISTS (SELECT 1 FROM public.finance_ledger g WHERE g.fee_line_id = f.id))
  ) THEN
    RAISE EXCEPTION 'network_unlock_posted_fee';
  END IF;
  UPDATE public.network_commission_statements s
  SET status = 'draft', validated_by = NULL, validated_at = NULL, last_unlocked_by = p_actor_user_id,
      last_unlocked_at = now(), last_unlock_reason = v_reason, updated_at = now()
  WHERE s.id = v_stmt.id;

  PERFORM public.network_finance_audit(
    p_tenant_id, p_actor_user_id, v_role, 'network_statement_unlocked', NULL, NULL, NULL,
    'Network statement unlocked by Owner',
    jsonb_build_object('statement_id', v_stmt.id, 'reason', v_reason,
                       'previous_status', v_stmt.status,
                       'previous_validated_by', v_stmt.validated_by,
                       'previous_validated_at', v_stmt.validated_at));
  RETURN 'draft';
END;
$$;

-- K. Privileges: client roles have no direct access to the canonical finance tables; the service
-- role reads, inserts and updates (guarded) but never deletes or truncates them.
ALTER TABLE public.finance_fee_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.network_commission_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.network_commission_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_adviser_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_adviser_history_capture ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.network_commission_statements_unowned_pre_b4b1 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.finance_fee_lines, public.network_commission_statements,
  public.network_commission_lines, public.finance_ledger, public.finance_audit_log
  FROM PUBLIC, anon, authenticated;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.finance_fee_lines,
  public.network_commission_statements, public.network_commission_lines FROM service_role;
GRANT SELECT, INSERT, UPDATE ON public.finance_fee_lines, public.network_commission_statements,
  public.network_commission_lines TO service_role;

REVOKE ALL ON public.session_adviser_assignments, public.session_adviser_history_capture,
  public.network_commission_statements_unowned_pre_b4b1
  FROM PUBLIC, anon, authenticated, service_role;
-- INSERT/UPDATE serve the session_advisors triggers only; the history guard refuses direct writes.
GRANT SELECT, INSERT, UPDATE ON public.session_adviser_assignments TO service_role;
GRANT SELECT ON public.session_adviser_history_capture,
  public.network_commission_statements_unowned_pre_b4b1 TO service_role;

REVOKE ALL ON FUNCTION public.session_adviser_assignments_guard(),
  public.session_adviser_history_on_insert(), public.session_adviser_history_on_delete(),
  public.session_adviser_identity_guard(), public.finance_fee_lines_guard(),
  public.network_commission_lines_guard(), public.network_commission_statements_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.resolve_session_advisers_as_of(uuid, uuid, timestamptz),
  public.network_statement_validation_blockers(uuid, uuid),
  public.network_finance_actor_role(uuid, uuid, text),
  public.network_finance_audit(uuid, uuid, text, text, uuid, uuid, text, text, jsonb),
  public.allocate_network_line(uuid, uuid, uuid, uuid),
  public.deallocate_network_line(uuid, uuid, uuid, text),
  public.set_network_line_skip(uuid, uuid, uuid, boolean, text),
  public.set_network_line_transaction_date(uuid, uuid, uuid, date),
  public.confirm_network_statement_received_date(uuid, uuid, uuid, date, boolean, text),
  public.set_network_statement_declared_total(uuid, uuid, uuid, bigint),
  public.replace_network_statement_lines(uuid, uuid, uuid, jsonb, text),
  public.validate_network_statement(uuid, uuid, uuid),
  public.unlock_network_statement(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.resolve_session_advisers_as_of(uuid, uuid, timestamptz),
  public.network_statement_validation_blockers(uuid, uuid),
  public.network_finance_actor_role(uuid, uuid, text),
  public.network_finance_audit(uuid, uuid, text, text, uuid, uuid, text, text, jsonb),
  public.allocate_network_line(uuid, uuid, uuid, uuid),
  public.deallocate_network_line(uuid, uuid, uuid, text),
  public.set_network_line_skip(uuid, uuid, uuid, boolean, text),
  public.set_network_line_transaction_date(uuid, uuid, uuid, date),
  public.confirm_network_statement_received_date(uuid, uuid, uuid, date, boolean, text),
  public.set_network_statement_declared_total(uuid, uuid, uuid, bigint),
  public.replace_network_statement_lines(uuid, uuid, uuid, jsonb, text),
  public.validate_network_statement(uuid, uuid, uuid),
  public.unlock_network_statement(uuid, uuid, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.resolve_session_advisers_as_of(uuid, uuid, timestamptz) IS
  'G7F-4S4C4-B4b1: advisers assigned to one tenant session at p_event_at from append-only history. Never the current assignment. no_proof / assigned_history_incomplete before live capture. service_role only.';
COMMENT ON FUNCTION public.allocate_network_line(uuid, uuid, uuid, uuid) IS
  'G7F-4S4C4-B4b1: atomic, idempotent allocation of one tenant network line to one tenant session as a draft fee line carrying the D7 economic date. Never posts. service_role only.';
COMMENT ON FUNCTION public.validate_network_statement(uuid, uuid, uuid) IS
  'G7F-4S4C4-B4b1: reconcile and freeze one tenant network statement. Never posts. service_role only.';
COMMENT ON FUNCTION public.unlock_network_statement(uuid, uuid, uuid, text) IS
  'G7F-4S4C4-B4b1: Owner-only unlock with a mandatory reason; refused once any source fee is posted. service_role only.';

-- L. Postconditions.
DO $$
DECLARE
  v_con record;
  v_fn record;
  v_bad bigint;
BEGIN
  FOR v_con IN
    SELECT * FROM (VALUES
      ('network_commission_statements', 'network_commission_statements_tenant_period_key',
       'UNIQUE (tenant_id, period_month)'),
      ('network_commission_statements', 'network_commission_statements_id_tenant_key',
       'UNIQUE (id, tenant_id)'),
      ('network_commission_lines', 'network_commission_lines_id_tenant_key', 'UNIQUE (id, tenant_id)'),
      ('network_commission_lines', 'network_commission_lines_statement_tenant_fkey',
       'FOREIGN KEY (statement_id, tenant_id) REFERENCES network_commission_statements(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT'),
      ('network_commission_lines', 'network_commission_lines_session_tenant_fkey',
       'FOREIGN KEY (matched_session_id, tenant_id) REFERENCES interview_sessions(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT'),
      ('interview_sessions', 'interview_sessions_id_tenant_key', 'UNIQUE (id, tenant_id)'),
      ('finance_fee_lines', 'finance_fee_lines_session_tenant_fkey',
       'FOREIGN KEY (session_id, tenant_id) REFERENCES interview_sessions(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT'),
      ('finance_fee_lines', 'finance_fee_lines_source_line_tenant_fkey',
       'FOREIGN KEY (source_network_line_id, tenant_id) REFERENCES network_commission_lines(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT'),
      ('session_adviser_assignments', 'session_adviser_assignments_session_tenant_fkey',
       'FOREIGN KEY (session_id, tenant_id) REFERENCES interview_sessions(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT'),
      ('session_adviser_assignments', 'session_adviser_assignments_adviser_capacity_fkey',
       'FOREIGN KEY (adviser_user_id, tenant_id, adviser_capacity) REFERENCES tenant_memberships(user_id, tenant_id, role) ON UPDATE RESTRICT ON DELETE RESTRICT')
    ) AS e(rel, name, def)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = ('public.' || v_con.rel)::regclass AND c.conname = v_con.name
        AND replace(pg_get_constraintdef(c.oid), 'REFERENCES public.', 'REFERENCES ') = v_con.def
    ) THEN
      RAISE EXCEPTION 'g7f4s4c4b4b1_postcondition:key_missing:%', v_con.name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_constraint c
             WHERE c.conrelid = 'public.network_commission_statements'::regclass
               AND pg_get_constraintdef(c.oid) = 'UNIQUE (period_month)')
     OR EXISTS (SELECT 1 FROM pg_constraint c
                WHERE c.conrelid IN ('public.network_commission_lines'::regclass,
                                     'public.finance_fee_lines'::regclass)
                  AND c.contype = 'f' AND pg_get_constraintdef(c.oid) LIKE '%ON DELETE CASCADE%') THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_postcondition:legacy_key_present';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid IN ('public.network_commission_statements'::regclass,
                         'public.network_commission_lines'::regclass,
                         'public.finance_fee_lines'::regclass)
      AND a.attname = 'tenant_id' AND NOT a.attnotnull
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_postcondition:tenant_nullable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes i WHERE i.schemaname = 'public'
                   AND i.indexname = 'finance_fee_lines_active_network_source_key')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes i WHERE i.schemaname = 'public'
                      AND i.indexname = 'network_commission_lines_current_line_no_key')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes i WHERE i.schemaname = 'public'
                      AND i.indexname = 'session_adviser_assignments_open_key') THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_postcondition:index_missing';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t
      WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
        AND t.tgname IN ('session_adviser_assignments_append_only',
                         'session_adviser_assignments_no_truncate',
                         'session_advisors_history_open', 'session_advisors_history_close',
                         'session_advisors_identity_immutable', 'session_advisors_no_truncate',
                         'finance_fee_lines_source_guard', 'finance_fee_lines_no_truncate',
                         'network_commission_lines_source_guard',
                         'network_commission_lines_no_truncate',
                         'network_commission_statements_source_guard',
                         'network_commission_statements_no_truncate')) <> 12 THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_postcondition:guard_trigger_missing';
  END IF;

  -- Client roles hold nothing on the canonical finance tables, the history or the archive.
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('public.finance_fee_lines'), ('public.network_commission_statements'),
                 ('public.network_commission_lines'), ('public.finance_ledger'),
                 ('public.finance_audit_log'), ('public.session_adviser_assignments'),
                 ('public.session_adviser_history_capture'),
                 ('public.network_commission_statements_unowned_pre_b4b1')) AS t(rel)
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
                       ('REFERENCES'), ('TRIGGER')) AS p(priv)
    WHERE has_table_privilege(r.role, t.rel, p.priv)
  ) OR EXISTS (
    SELECT 1 FROM pg_class c, aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
    WHERE c.oid IN ('public.finance_fee_lines'::regclass,
                    'public.network_commission_statements'::regclass,
                    'public.network_commission_lines'::regclass, 'public.finance_ledger'::regclass,
                    'public.finance_audit_log'::regclass,
                    'public.session_adviser_assignments'::regclass,
                    'public.session_adviser_history_capture'::regclass,
                    'public.network_commission_statements_unowned_pre_b4b1'::regclass)
      AND a.grantee = 0
  ) OR has_table_privilege('service_role', 'public.finance_fee_lines', 'DELETE')
    OR has_table_privilege('service_role', 'public.finance_fee_lines', 'TRUNCATE')
    OR has_table_privilege('service_role', 'public.network_commission_statements', 'DELETE')
    OR has_table_privilege('service_role', 'public.network_commission_lines', 'DELETE')
    OR has_table_privilege('service_role', 'public.session_adviser_assignments', 'DELETE')
    OR has_table_privilege('service_role', 'public.session_adviser_history_capture',
                           'INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_table_privilege('service_role', 'public.network_commission_statements_unowned_pre_b4b1',
                           'INSERT,UPDATE,DELETE,TRUNCATE')
    OR NOT has_table_privilege('service_role', 'public.network_commission_statements_unowned_pre_b4b1',
                               'SELECT')
  THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_postcondition:privileges';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid IN ('public.finance_fee_lines'::regclass,
                    'public.network_commission_statements'::regclass,
                    'public.network_commission_lines'::regclass,
                    'public.session_adviser_assignments'::regclass,
                    'public.session_adviser_history_capture'::regclass,
                    'public.network_commission_statements_unowned_pre_b4b1'::regclass)
      AND NOT c.relrowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename IN ('session_adviser_assignments', 'session_adviser_history_capture',
                          'network_commission_statements_unowned_pre_b4b1')
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_postcondition:rls';
  END IF;

  SELECT count(*) AS n, bool_and(NOT p.prosecdef) AS invoker,
         bool_and(p.proconfig = ARRAY['search_path=""']) AS safe_path,
         bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                  AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                                  WHERE a.grantee = 0)
                  AND (p.prorettype = 'trigger'::regtype
                       OR has_function_privilege('service_role', p.oid, 'EXECUTE'))) AS acl_ok
  INTO v_fn
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('session_adviser_history_on_insert', 'session_adviser_history_on_delete',
                      'session_adviser_identity_guard', 'session_adviser_assignments_guard',
                      'resolve_session_advisers_as_of', 'finance_fee_lines_guard',
                      'network_commission_lines_guard', 'network_commission_statements_guard',
                      'network_finance_actor_role', 'network_finance_audit',
                      'network_statement_validation_blockers', 'allocate_network_line',
                      'deallocate_network_line', 'set_network_line_skip',
                      'set_network_line_transaction_date',
                      'confirm_network_statement_received_date',
                      'set_network_statement_declared_total', 'replace_network_statement_lines',
                      'validate_network_statement', 'unlock_network_statement');
  IF v_fn.n IS DISTINCT FROM 20 OR v_fn.invoker IS NOT TRUE OR v_fn.safe_path IS NOT TRUE
     OR v_fn.acl_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_postcondition:function_privileges';
  END IF;

  -- Tenantless statements: archived byte-identically, none left.
  IF EXISTS (SELECT 1 FROM public.network_commission_statements s WHERE s.tenant_id IS NULL)
     OR EXISTS (
       (SELECT row_text FROM pg_temp.g7f4s4c4b4b1_tenantless_before
        EXCEPT ALL SELECT a::text FROM public.network_commission_statements_unowned_pre_b4b1 a)
       UNION ALL
       (SELECT a::text FROM public.network_commission_statements_unowned_pre_b4b1 a
        EXCEPT ALL SELECT row_text FROM pg_temp.g7f4s4c4b4b1_tenantless_before)
     ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_postcondition:archive_mismatch';
  END IF;

  -- History: exactly one open interval per tenant-stamped assignment, none for tenantless ones.
  SELECT count(*) INTO v_bad
  FROM public.session_advisors sa
  WHERE sa.tenant_id IS NOT NULL
    AND (SELECT count(*) FROM public.session_adviser_assignments a
         WHERE a.source_session_advisor_id = sa.id AND a.source = 'session_advisors_backfill'
           AND a.tenant_id = sa.tenant_id AND a.session_id = sa.session_id
           AND a.adviser_user_id = sa.advisor_id AND a.assigned_at = sa.created_at
           AND a.unassigned_at IS NULL AND a.assigned_by IS NULL) <> 1;
  IF v_bad > 0
     OR (SELECT count(*) FROM public.session_adviser_assignments)
        IS DISTINCT FROM (SELECT count(*) FROM public.session_advisors sa WHERE sa.tenant_id IS NOT NULL)
     OR EXISTS (
       SELECT 1 FROM public.session_adviser_assignments a
       JOIN public.session_advisors sa ON sa.id = a.source_session_advisor_id
       WHERE sa.tenant_id IS NULL
     ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_postcondition:history_backfill';
  END IF;

  -- No economic date was claimed; existing network links are carried exactly.
  IF EXISTS (SELECT 1 FROM public.finance_fee_lines f WHERE f.fee_event_date IS NOT NULL)
     OR EXISTS (
       (SELECT b.fee_line_id, b.line_id FROM pg_temp.g7f4s4c4b4b1_fee_links_before b
        EXCEPT ALL SELECT f.id, f.source_network_line_id FROM public.finance_fee_lines f
        WHERE f.source_network_line_id IS NOT NULL)
       UNION ALL
       (SELECT f.id, f.source_network_line_id FROM public.finance_fee_lines f
        WHERE f.source_network_line_id IS NOT NULL
        EXCEPT ALL SELECT b.fee_line_id, b.line_id FROM pg_temp.g7f4s4c4b4b1_fee_links_before b)
     ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_postcondition:fee_event_claimed';
  END IF;

  -- Business rows unchanged on every pre-existing column.
  CREATE TEMP TABLE g7f4s4c4b4b1_rows_after AS
  SELECT 'network_commission_statements'::text AS tbl,
    to_jsonb(t) - ARRAY['received_date', 'received_date_confirmed_by', 'received_date_confirmed_at',
                        'received_date_evidence', 'declared_total_pence', 'declared_total_set_by',
                        'declared_total_set_at', 'last_unlocked_by', 'last_unlocked_at',
                        'last_unlock_reason'] AS j
  FROM public.network_commission_statements t
  UNION ALL SELECT 'network_commission_lines',
    to_jsonb(t) - ARRAY['transaction_date', 'transaction_date_source', 'transaction_date_set_by',
                        'transaction_date_set_at', 'parse_batch_id', 'skip_reason', 'skipped_by',
                        'skipped_at', 'superseded_at', 'superseded_by']
  FROM public.network_commission_lines t
  UNION ALL SELECT 'finance_fee_lines',
    to_jsonb(t) - ARRAY['source_network_line_id', 'fee_event_date', 'fee_event_at',
                        'fee_event_source', 'fee_event_evidence', 'voided_at', 'voided_by',
                        'void_reason']
  FROM public.finance_fee_lines t
  UNION ALL SELECT 'session_advisors', to_jsonb(t) FROM public.session_advisors t
  UNION ALL SELECT 'interview_sessions', to_jsonb(t) FROM public.interview_sessions t
  UNION ALL SELECT 'finance_ledger', to_jsonb(t) FROM public.finance_ledger t
  UNION ALL SELECT 'finance_audit_log', to_jsonb(t) FROM public.finance_audit_log t
  UNION ALL SELECT 'tenant_memberships', to_jsonb(t) FROM public.tenant_memberships t
  UNION ALL SELECT 'admin_permissions', to_jsonb(t) FROM public.admin_permissions t;
  IF EXISTS (
    (SELECT tbl, j FROM pg_temp.g7f4s4c4b4b1_rows_before
     EXCEPT ALL SELECT tbl, j FROM pg_temp.g7f4s4c4b4b1_rows_after)
    UNION ALL
    (SELECT tbl, j FROM pg_temp.g7f4s4c4b4b1_rows_after
     EXCEPT ALL SELECT tbl, j FROM pg_temp.g7f4s4c4b4b1_rows_before)
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b1_postcondition:business_data_changed';
  END IF;
  DROP TABLE pg_temp.g7f4s4c4b4b1_rows_after;
END
$$;

-- M.
DROP TABLE pg_temp.g7f4s4c4b4b1_tenantless_before, pg_temp.g7f4s4c4b4b1_rows_before,
  pg_temp.g7f4s4c4b4b1_fee_links_before;
