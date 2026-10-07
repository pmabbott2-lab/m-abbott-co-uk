-- Gate G7F-4S4C4-B4a: commission rates are immutable, effective-dated versions owned by one tenant's
-- commercial subject: an introducer registration (tenant_id, introducer_id) or an adviser capacity
-- (tenant_id, user_id, role 'adviser'). A rate never follows an Auth identity into another tenant.
-- "No rate set" is the absence of a version; a 0% rate is an explicit version.
--
-- The applicable rate for (tenant, subject, fee type, event time) is the single version with the
-- latest effective_from <= event time (resolve_commission_rate_as_of). Versions are append-only:
-- UPDATE, DELETE and TRUNCATE are refused and a new version must be effective after the latest one
-- for its subject and fee type. Owner mutations go only through set_commission_rate_versions,
-- which writes the versions and their finance audit rows in one transaction.
--
-- Legacy rates are migrated only from evidence: each commission_rate_history row becomes the
-- version it records, effective at the moment it was recorded (legacy rates applied from the
-- moment they were saved). A legacy rate value without history is accepted only when it is the
-- column default 0, which no Owner ever set; it becomes "no rate set". Any legacy introducer rate,
-- tenantless row, history gap, tie or mismatch RAISEs.
--
-- The legacy tables are kept as read-only archives (commission_rates_pre_b4a,
-- commission_rate_history_pre_b4a): no client policies, no client privileges, service_role SELECT
-- only. They are not a rate source.
--
-- finance_settings is keyed by (tenant_id, key); tenant_id becomes NOT NULL.
--
-- Atomicity: the file is one multi-statement request and runs as a single transaction. Every
-- precondition is checked before any DDL and every postcondition after it; any miss RAISEs and
-- rolls the whole migration back. No business row is deleted, merged or reassigned.
--
-- Rollback model: forward-only. A reversal must recreate commission_rates from the latest version
-- per (tenant, subject, fee type) only where that is unambiguous, and must never delete a version.

-- A. Locks.
LOCK TABLE public.commission_rates, public.commission_rate_history, public.finance_settings
  IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.introducers, public.tenant_memberships, public.tenants, public.finance_audit_log
  IN SHARE MODE;

-- B. Preconditions.
DO $$
DECLARE
  v_con record;
  v_cols text;
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_precondition:postgres_version_below_15';
  END IF;

  FOR v_con IN
    SELECT * FROM (VALUES
      ('public.commission_rates'::regclass, 'commission_rates_tenant_id_user_id_role_key', 'u',
       'UNIQUE NULLS NOT DISTINCT (tenant_id, user_id, role)'),
      ('public.finance_settings'::regclass, 'finance_settings_pkey', 'p', 'PRIMARY KEY (key)'),
      ('public.introducers'::regclass, 'introducers_id_tenant_id_key', 'u', 'UNIQUE (id, tenant_id)'),
      ('public.introducers'::regclass, 'introducers_tenant_id_user_id_key', 'u',
       'UNIQUE NULLS NOT DISTINCT (tenant_id, user_id)'),
      ('public.tenant_memberships'::regclass, 'tenant_memberships_user_tenant_role_unique', 'u',
       'UNIQUE (user_id, tenant_id, role)')
    ) AS e(rel, name, kind, def)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = v_con.rel AND c.conname = v_con.name AND c.contype = v_con.kind
        AND pg_get_constraintdef(c.oid) = v_con.def
    ) THEN
      RAISE EXCEPTION 'g7f4s4c4b4a_precondition:key_missing_or_changed:%', v_con.name;
    END IF;
  END LOOP;

  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull,
                    ',' ORDER BY a.attnum)
  INTO v_cols
  FROM pg_attribute a
  WHERE a.attrelid = 'public.commission_rates'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM
     'id:uuid:true,user_id:uuid:true,role:text:true,percentage:numeric(6,3):true,'
     'updated_by:uuid:false,updated_at:timestamp with time zone:true,'
     'pct_fee:numeric(6,3):true,pct_mortgage_fee:numeric(6,3):true,'
     'pct_insurance_fee:numeric(6,3):true,pct_other_fee:numeric(6,3):true,tenant_id:uuid:false' THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_precondition:commission_rates_columns_changed';
  END IF;
  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull,
                    ',' ORDER BY a.attnum)
  INTO v_cols
  FROM pg_attribute a
  WHERE a.attrelid = 'public.commission_rate_history'::regclass AND a.attnum > 0
    AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM
     'id:uuid:true,user_id:uuid:true,role:text:true,fee_type:text:true,'
     'pct_from:numeric(6,3):false,pct_to:numeric(6,3):true,changed_by:uuid:false,'
     'created_at:timestamp with time zone:true,tenant_id:uuid:false' THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_precondition:commission_rate_history_columns_changed';
  END IF;
  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull,
                    ',' ORDER BY a.attnum)
  INTO v_cols
  FROM pg_attribute a
  WHERE a.attrelid = 'public.finance_settings'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM
     'key:text:true,num_value:integer:true,updated_at:timestamp with time zone:true,tenant_id:uuid:false' THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_precondition:finance_settings_columns_changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    WHERE e.enumtypid = 'public.tenant_member_role'::regtype AND e.enumlabel = 'adviser'
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_precondition:adviser_role_missing';
  END IF;

  IF (SELECT COALESCE(array_agg(p.policyname::text ORDER BY p.policyname), ARRAY[]::text[])
      FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'commission_rates')
     IS DISTINCT FROM ARRAY['Admins manage commission rates', 'Admins read commission rates']
  OR (SELECT COALESCE(array_agg(p.policyname::text ORDER BY p.policyname), ARRAY[]::text[])
      FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'commission_rate_history')
     IS DISTINCT FROM ARRAY['Admins read commission history'] THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_precondition:legacy_rate_policies_changed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint f
    WHERE f.confrelid IN ('public.commission_rates'::regclass,
                          'public.commission_rate_history'::regclass,
                          'public.finance_settings'::regclass)
  ) OR EXISTS (
    SELECT 1 FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid
    WHERE d.refobjid IN ('public.commission_rates'::regclass,
                         'public.commission_rate_history'::regclass,
                         'public.finance_settings'::regclass)
      AND r.ev_class NOT IN ('public.commission_rates'::regclass,
                             'public.commission_rate_history'::regclass,
                             'public.finance_settings'::regclass)
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.prosrc ~ 'commission_rate(s|_history)([^a-z_]|$)'
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_precondition:legacy_tables_have_dependants';
  END IF;

  IF to_regclass('public.commission_rate_versions') IS NOT NULL
     OR to_regclass('public.commission_rates_pre_b4a') IS NOT NULL
     OR to_regclass('public.commission_rate_history_pre_b4a') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.proname IN ('set_commission_rate_versions', 'resolve_commission_rate_as_of',
                           'commission_rate_versions_guard')
     ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_precondition:new_name_in_use';
  END IF;

  -- Rates: tenant-stamped adviser capacities only.
  IF EXISTS (SELECT 1 FROM public.commission_rates r WHERE r.tenant_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.commission_rate_history h WHERE h.tenant_id IS NULL) THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_precondition:legacy_rate_tenant_null';
  END IF;
  IF EXISTS (SELECT 1 FROM public.commission_rates r WHERE r.role <> 'advisor')
     OR EXISTS (SELECT 1 FROM public.commission_rate_history h WHERE h.role <> 'advisor') THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_precondition:legacy_introducer_rate_requires_decision';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.commission_rates r
    WHERE NOT EXISTS (
      SELECT 1 FROM public.tenant_memberships m
      WHERE m.user_id = r.user_id AND m.tenant_id = r.tenant_id AND m.role::text = 'adviser'
    )
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_precondition:legacy_adviser_capacity_missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.commission_rate_history h
    WHERE NOT EXISTS (
      SELECT 1 FROM public.commission_rates r
      WHERE r.tenant_id = h.tenant_id AND r.user_id = h.user_id AND r.role = h.role
    )
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_precondition:legacy_history_without_rate';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.commission_rate_history h
    GROUP BY h.tenant_id, h.user_id, h.role, h.fee_type, h.created_at
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_precondition:legacy_history_ambiguous';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.commission_rate_history h
    WHERE h.pct_to < 0 OR h.pct_to > 100
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_precondition:legacy_rate_out_of_range';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT h.pct_from,
             lag(h.pct_to) OVER w AS prev_to,
             row_number() OVER w AS n
      FROM public.commission_rate_history h
      WINDOW w AS (PARTITION BY h.tenant_id, h.user_id, h.role, h.fee_type ORDER BY h.created_at)
    ) s
    WHERE (s.n = 1 AND s.pct_from IS NOT NULL AND s.pct_from <> 0)
       OR (s.n > 1 AND s.pct_from IS DISTINCT FROM s.prev_to)
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_precondition:legacy_history_gap';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.commission_rates r
    CROSS JOIN LATERAL (VALUES ('fee', r.pct_fee), ('mortgage_fee', r.pct_mortgage_fee),
                               ('insurance_fee', r.pct_insurance_fee),
                               ('other_fee', r.pct_other_fee)) AS f(fee_type, pct)
    LEFT JOIN LATERAL (
      SELECT h.pct_to FROM public.commission_rate_history h
      WHERE h.tenant_id = r.tenant_id AND h.user_id = r.user_id AND h.role = r.role
        AND h.fee_type = f.fee_type
      ORDER BY h.created_at DESC LIMIT 1
    ) last ON true
    WHERE (last.pct_to IS NULL AND f.pct <> 0)
       OR (last.pct_to IS NOT NULL AND last.pct_to <> f.pct)
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_precondition:legacy_rate_effective_date_unprovable';
  END IF;

  -- Settings: every row already names its tenant, at most one value per (tenant, key).
  IF EXISTS (SELECT 1 FROM public.finance_settings s WHERE s.tenant_id IS NULL) THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_precondition:settings_tenant_null';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.finance_settings s GROUP BY s.tenant_id, s.key HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_precondition:settings_duplicate';
  END IF;
END
$$;

-- C. Baseline. Whole-row text of every row (every column, in attribute order).
CREATE TEMP TABLE g7f4s4c4b4a_rates_before AS
SELECT t.id, t::text AS row_text FROM public.commission_rates t;
CREATE TEMP TABLE g7f4s4c4b4a_history_before AS
SELECT t.id, t.tenant_id, t.user_id, t.fee_type, t.pct_to, t.changed_by, t.created_at,
       t::text AS row_text
FROM public.commission_rate_history t;
CREATE TEMP TABLE g7f4s4c4b4a_expected_current AS
SELECT r.tenant_id, r.user_id, f.fee_type, f.pct,
       EXISTS (
         SELECT 1 FROM public.commission_rate_history h
         WHERE h.tenant_id = r.tenant_id AND h.user_id = r.user_id AND h.role = r.role
           AND h.fee_type = f.fee_type
       ) AS has_history
FROM public.commission_rates r
CROSS JOIN LATERAL (VALUES ('fee', r.pct_fee), ('mortgage_fee', r.pct_mortgage_fee),
                           ('insurance_fee', r.pct_insurance_fee),
                           ('other_fee', r.pct_other_fee)) AS f(fee_type, pct);
CREATE TEMP TABLE g7f4s4c4b4a_settings_before AS
SELECT t::text AS row_text FROM public.finance_settings t;

CREATE TEMP TABLE g7f4s4c4b4a_rows_before AS
SELECT 'finance_ledger'::text AS tbl, t::text AS row_text FROM public.finance_ledger t
UNION ALL SELECT 'finance_fee_lines', t::text FROM public.finance_fee_lines t
UNION ALL SELECT 'finance_audit_log', t::text FROM public.finance_audit_log t
UNION ALL SELECT 'network_commission_statements', t::text FROM public.network_commission_statements t
UNION ALL SELECT 'network_commission_lines', t::text FROM public.network_commission_lines t
UNION ALL SELECT 'referrals', t::text FROM public.referrals t
UNION ALL SELECT 'referral_codes', t::text FROM public.referral_codes t
UNION ALL SELECT 'introducers', t::text FROM public.introducers t
UNION ALL SELECT 'tenant_memberships', t::text FROM public.tenant_memberships t
UNION ALL SELECT 'customer_introducer_links', t::text FROM public.customer_introducer_links t
UNION ALL SELECT 'introducer_amendment_history', t::text FROM public.introducer_amendment_history t
UNION ALL SELECT 'interview_sessions', t::text FROM public.interview_sessions t
UNION ALL SELECT 'session_advisors', t::text FROM public.session_advisors t
UNION ALL SELECT 'appointments', t::text FROM public.appointments t;

-- Keys, policies and privileges of every table B4a must not change (catalog text, ordered).
CREATE TEMP TABLE g7f4s4c4b4a_untouched_catalog AS
SELECT md5(
  (SELECT COALESCE(string_agg(c.conrelid::regclass::text || ':' || c.conname || ':'
                              || pg_get_constraintdef(c.oid), '|'
                              ORDER BY c.conrelid::regclass::text, c.conname), '')
   FROM pg_constraint c
   WHERE c.conrelid IN ('public.finance_ledger'::regclass, 'public.finance_fee_lines'::regclass,
                        'public.finance_audit_log'::regclass,
                        'public.network_commission_statements'::regclass,
                        'public.network_commission_lines'::regclass,
                        'public.referrals'::regclass, 'public.referral_codes'::regclass,
                        'public.introducers'::regclass, 'public.tenant_memberships'::regclass,
                        'public.customer_introducer_links'::regclass,
                        'public.introducer_amendment_history'::regclass))
  || '#' ||
  (SELECT COALESCE(string_agg(concat_ws(':', p.tablename, p.policyname, p.permissive, p.cmd,
                                        p.roles::text, p.qual, p.with_check), '|'
                              ORDER BY p.tablename, p.policyname), '')
   FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND p.tablename IN ('finance_ledger', 'finance_fee_lines', 'finance_audit_log',
                         'finance_settings', 'network_commission_statements',
                         'network_commission_lines', 'referrals', 'referral_codes',
                         'introducers', 'tenant_memberships', 'customer_introducer_links',
                         'introducer_amendment_history'))
  || '#' ||
  (SELECT COALESCE(string_agg(c.relname || ':' || COALESCE(c.relacl::text, '') || ':'
                              || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text,
                              '|' ORDER BY c.relname), '')
   FROM pg_class c
   WHERE c.oid IN ('public.finance_ledger'::regclass, 'public.finance_fee_lines'::regclass,
                   'public.finance_audit_log'::regclass, 'public.finance_settings'::regclass,
                   'public.network_commission_statements'::regclass,
                   'public.network_commission_lines'::regclass,
                   'public.referrals'::regclass, 'public.referral_codes'::regclass,
                   'public.introducers'::regclass, 'public.tenant_memberships'::regclass,
                   'public.customer_introducer_links'::regclass,
                   'public.introducer_amendment_history'::regclass))
  || '#' ||
  (SELECT COALESCE(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':'
                              || COALESCE(p.proacl::text, ''), '|'
                              ORDER BY p.oid::regprocedure::text), '')
   FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname = 'amend_customer_introducer_attribution')
) AS fingerprint;

-- D. Versioned rates.
CREATE TABLE public.commission_rate_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  subject_kind text NOT NULL,
  introducer_id uuid,
  adviser_user_id uuid,
  adviser_role public.tenant_member_role,
  fee_type text NOT NULL,
  percentage numeric(6,3) NOT NULL,
  effective_from timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  reason text,
  source text NOT NULL DEFAULT 'owner',
  legacy_history_id uuid,
  CONSTRAINT commission_rate_versions_pkey PRIMARY KEY (id),
  CONSTRAINT commission_rate_versions_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT commission_rate_versions_introducer_tenant_fkey FOREIGN KEY (introducer_id, tenant_id)
    REFERENCES public.introducers (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT commission_rate_versions_adviser_capacity_fkey
    FOREIGN KEY (adviser_user_id, tenant_id, adviser_role)
    REFERENCES public.tenant_memberships (user_id, tenant_id, role)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT commission_rate_versions_subject_kind_check
    CHECK (subject_kind IN ('introducer', 'adviser')),
  CONSTRAINT commission_rate_versions_subject_shape_check CHECK (
    (subject_kind = 'introducer' AND introducer_id IS NOT NULL AND adviser_user_id IS NULL
      AND adviser_role IS NULL)
    OR (subject_kind = 'adviser' AND adviser_user_id IS NOT NULL AND adviser_role = 'adviser'
      AND introducer_id IS NULL)
  ),
  CONSTRAINT commission_rate_versions_fee_type_check
    CHECK (fee_type IN ('fee', 'mortgage_fee', 'insurance_fee', 'other_fee')),
  CONSTRAINT commission_rate_versions_introducer_fee_type_check
    CHECK (subject_kind <> 'introducer' OR fee_type IN ('fee', 'mortgage_fee')),
  CONSTRAINT commission_rate_versions_percentage_check
    CHECK (percentage >= 0 AND percentage <= 100),
  CONSTRAINT commission_rate_versions_reason_check
    CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500),
  CONSTRAINT commission_rate_versions_source_check CHECK (
    (source = 'owner' AND created_by IS NOT NULL AND legacy_history_id IS NULL)
    OR (source = 'legacy_migration' AND legacy_history_id IS NOT NULL)
  ),
  CONSTRAINT commission_rate_versions_subject_effective_key UNIQUE NULLS NOT DISTINCT
    (tenant_id, subject_kind, introducer_id, adviser_user_id, fee_type, effective_from),
  CONSTRAINT commission_rate_versions_legacy_history_key UNIQUE (legacy_history_id)
);

COMMENT ON TABLE public.commission_rate_versions IS
  'G7F-4S4C4-B4a: the only commission rate source. Immutable effective-dated versions per tenant commercial subject (introducer registration or adviser capacity) and fee type. No version = no rate set.';

CREATE FUNCTION public.commission_rate_versions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_latest timestamptz;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'commission_rate_versions_immutable';
  END IF;
  PERFORM pg_advisory_xact_lock(872014100, hashtext(
    NEW.tenant_id::text || ':' || NEW.subject_kind || ':'
    || COALESCE(NEW.introducer_id, NEW.adviser_user_id)::text));
  SELECT max(v.effective_from) INTO v_latest
  FROM public.commission_rate_versions v
  WHERE v.tenant_id = NEW.tenant_id AND v.subject_kind = NEW.subject_kind
    AND v.introducer_id IS NOT DISTINCT FROM NEW.introducer_id
    AND v.adviser_user_id IS NOT DISTINCT FROM NEW.adviser_user_id
    AND v.fee_type = NEW.fee_type;
  IF v_latest IS NOT NULL AND NEW.effective_from <= v_latest THEN
    RAISE EXCEPTION 'commission_rate_effective_not_after_latest';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER commission_rate_versions_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.commission_rate_versions
  FOR EACH ROW EXECUTE FUNCTION public.commission_rate_versions_guard();
CREATE TRIGGER commission_rate_versions_no_truncate
  BEFORE TRUNCATE ON public.commission_rate_versions
  FOR EACH STATEMENT EXECUTE FUNCTION public.commission_rate_versions_guard();

-- E. Legacy adviser history becomes versions, in recorded order.
DO $$
DECLARE
  v_h record;
  v_expected bigint;
  v_inserted bigint := 0;
BEGIN
  SELECT count(*) INTO v_expected FROM pg_temp.g7f4s4c4b4a_history_before;
  FOR v_h IN
    SELECT h.* FROM public.commission_rate_history h
    ORDER BY h.tenant_id, h.user_id, h.fee_type, h.created_at
  LOOP
    INSERT INTO public.commission_rate_versions (
      tenant_id, subject_kind, adviser_user_id, adviser_role, fee_type, percentage,
      effective_from, created_at, created_by, source, legacy_history_id
    )
    VALUES (
      v_h.tenant_id, 'adviser', v_h.user_id, 'adviser', v_h.fee_type, v_h.pct_to,
      v_h.created_at, v_h.created_at, v_h.changed_by, 'legacy_migration', v_h.id
    );
    v_inserted := v_inserted + 1;
  END LOOP;
  IF v_inserted IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_backfill:row_count_mismatch';
  END IF;
END
$$;

-- F. Legacy tables become read-only archives.
DROP POLICY "Admins manage commission rates" ON public.commission_rates;
DROP POLICY "Admins read commission rates" ON public.commission_rates;
DROP POLICY "Admins read commission history" ON public.commission_rate_history;
REVOKE ALL ON public.commission_rates, public.commission_rate_history
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.commission_rates, public.commission_rate_history TO service_role;
ALTER TABLE public.commission_rates RENAME TO commission_rates_pre_b4a;
ALTER TABLE public.commission_rate_history RENAME TO commission_rate_history_pre_b4a;
COMMENT ON TABLE public.commission_rates_pre_b4a IS
  'G7F-4S4C4-B4a archive of the legacy current-rate table. Read-only evidence; not a rate source. See commission_rate_versions.';
COMMENT ON TABLE public.commission_rate_history_pre_b4a IS
  'G7F-4S4C4-B4a archive of the legacy rate history. Each row was migrated to commission_rate_versions (legacy_history_id). Read-only evidence; not a rate source.';

-- G. Finance settings are keyed by tenant.
ALTER TABLE public.finance_settings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.finance_settings DROP CONSTRAINT finance_settings_pkey;
ALTER TABLE public.finance_settings ADD CONSTRAINT finance_settings_pkey PRIMARY KEY (tenant_id, key);

-- H. As-of resolver: the one version effective at p_event_at for exactly this tenant, subject and
-- fee type. No row means no rate set. Ties RAISE.
CREATE FUNCTION public.resolve_commission_rate_as_of(
  p_tenant_id uuid,
  p_subject_kind text,
  p_introducer_id uuid,
  p_adviser_user_id uuid,
  p_fee_type text,
  p_event_at timestamptz
)
RETURNS TABLE (version_id uuid, percentage numeric, effective_from timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_top timestamptz;
  v_n integer;
BEGIN
  IF p_tenant_id IS NULL OR p_fee_type IS NULL OR p_event_at IS NULL OR p_subject_kind IS NULL
     OR p_fee_type NOT IN ('fee', 'mortgage_fee', 'insurance_fee', 'other_fee')
     OR NOT (
       (p_subject_kind = 'introducer' AND p_introducer_id IS NOT NULL AND p_adviser_user_id IS NULL)
       OR (p_subject_kind = 'adviser' AND p_adviser_user_id IS NOT NULL AND p_introducer_id IS NULL)
     ) THEN
    RAISE EXCEPTION 'commission_rate_resolve_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT max(v.effective_from) INTO v_top
  FROM public.commission_rate_versions v
  WHERE v.tenant_id = p_tenant_id AND v.subject_kind = p_subject_kind
    AND v.introducer_id IS NOT DISTINCT FROM p_introducer_id
    AND v.adviser_user_id IS NOT DISTINCT FROM p_adviser_user_id
    AND v.fee_type = p_fee_type AND v.effective_from <= p_event_at;
  IF v_top IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_n
  FROM public.commission_rate_versions v
  WHERE v.tenant_id = p_tenant_id AND v.subject_kind = p_subject_kind
    AND v.introducer_id IS NOT DISTINCT FROM p_introducer_id
    AND v.adviser_user_id IS NOT DISTINCT FROM p_adviser_user_id
    AND v.fee_type = p_fee_type AND v.effective_from = v_top;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'commission_rate_ambiguous' USING ERRCODE = 'cardinality_violation';
  END IF;

  RETURN QUERY
  SELECT v.id, v.percentage::numeric, v.effective_from
  FROM public.commission_rate_versions v
  WHERE v.tenant_id = p_tenant_id AND v.subject_kind = p_subject_kind
    AND v.introducer_id IS NOT DISTINCT FROM p_introducer_id
    AND v.adviser_user_id IS NOT DISTINCT FROM p_adviser_user_id
    AND v.fee_type = p_fee_type AND v.effective_from = v_top;
END;
$$;

-- I. Owner rate mutation: versions and finance audit rows together or not at all. The caller
-- (service role) has already established Owner authority in p_tenant_id; Owner membership, the
-- subject's tenant and the version timeline are re-checked here under a per-subject lock.
CREATE FUNCTION public.set_commission_rate_versions(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_subject_kind text,
  p_introducer_id uuid,
  p_adviser_user_id uuid,
  p_rates jsonb,
  p_effective_now boolean,
  p_effective_from timestamptz,
  p_backdate_confirmed boolean,
  p_reason text
)
RETURNS TABLE (
  version_id uuid,
  fee_type text,
  percentage numeric,
  previous_version_id uuid,
  previous_percentage numeric,
  effective_from timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_now timestamptz := now();
  v_eff timestamptz;
  v_backdated boolean;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_allowed text[];
  v_role_label text;
  v_subject_user uuid;
  v_subject_label text;
  v_key text;
  v_val jsonb;
  v_pct numeric;
  v_has_prev boolean;
  v_prev_id uuid;
  v_prev_pct numeric;
  v_prev_from timestamptz;
  v_new uuid;
  v_changed integer := 0;
BEGIN
  IF p_tenant_id IS NULL OR p_actor_user_id IS NULL OR p_subject_kind IS NULL OR p_rates IS NULL
     OR p_effective_now IS NULL OR p_backdate_confirmed IS NULL
     OR char_length(COALESCE(p_reason, '')) > 500
     OR jsonb_typeof(p_rates) <> 'object' OR p_rates = '{}'::jsonb THEN
    RAISE EXCEPTION 'commission_rate_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_subject_kind = 'introducer' AND p_introducer_id IS NOT NULL AND p_adviser_user_id IS NULL THEN
    v_allowed := ARRAY['fee', 'mortgage_fee'];
    v_role_label := 'introducer';
  ELSIF p_subject_kind = 'adviser' AND p_adviser_user_id IS NOT NULL AND p_introducer_id IS NULL THEN
    v_allowed := ARRAY['fee', 'mortgage_fee', 'insurance_fee', 'other_fee'];
    v_role_label := 'advisor';
  ELSE
    RAISE EXCEPTION 'commission_rate_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_effective_now THEN
    IF p_effective_from IS NOT NULL THEN
      RAISE EXCEPTION 'commission_rate_effective_invalid' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_eff := v_now;
  ELSE
    IF p_effective_from IS NULL OR p_effective_from = '-infinity'::timestamptz
       OR p_effective_from = 'infinity'::timestamptz THEN
      RAISE EXCEPTION 'commission_rate_effective_invalid' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_eff := p_effective_from;
  END IF;
  v_backdated := v_eff < v_now;
  IF v_backdated AND NOT p_backdate_confirmed THEN
    RAISE EXCEPTION 'commission_rate_backdate_unconfirmed' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_backdated AND v_reason IS NULL THEN
    RAISE EXCEPTION 'commission_rate_backdate_reason_required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR v_key, v_val IN SELECT e.key, e.value FROM jsonb_each(p_rates) AS e LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'commission_rate_fee_type_not_allowed' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF jsonb_typeof(v_val) <> 'number' THEN
      RAISE EXCEPTION 'commission_rate_percentage_invalid' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_pct := (v_val #>> '{}')::numeric;
    IF v_pct < 0 OR v_pct > 100 OR v_pct <> round(v_pct, 3) THEN
      RAISE EXCEPTION 'commission_rate_percentage_invalid' USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END LOOP;

  PERFORM 1 FROM public.tenants t
  WHERE t.id = p_tenant_id AND t.status::text = 'active'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'commission_rate_tenant_inactive' USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM 1 FROM public.tenant_memberships m
  WHERE m.user_id = p_actor_user_id AND m.tenant_id = p_tenant_id AND m.role::text = 'owner'
    AND m.active
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'commission_rate_forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_subject_kind = 'introducer' THEN
    SELECT i.user_id, i.company_name INTO v_subject_user, v_subject_label
    FROM public.introducers i
    WHERE i.id = p_introducer_id AND i.tenant_id = p_tenant_id AND i.active
      AND i.deleted_at IS NULL
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'commission_rate_subject_not_found' USING ERRCODE = 'no_data_found';
    END IF;
  ELSE
    PERFORM 1 FROM public.tenant_memberships m
    WHERE m.user_id = p_adviser_user_id AND m.tenant_id = p_tenant_id
      AND m.role::text = 'adviser' AND m.active
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'commission_rate_subject_not_found' USING ERRCODE = 'no_data_found';
    END IF;
    v_subject_user := p_adviser_user_id;
    SELECT p.full_name INTO v_subject_label FROM public.profiles p WHERE p.id = p_adviser_user_id;
  END IF;

  PERFORM pg_advisory_xact_lock(872014100, hashtext(
    p_tenant_id::text || ':' || p_subject_kind || ':'
    || COALESCE(p_introducer_id, p_adviser_user_id)::text));

  FOR v_key IN
    SELECT k FROM jsonb_object_keys(p_rates) AS k ORDER BY array_position(v_allowed, k)
  LOOP
    v_pct := (p_rates ->> v_key)::numeric;
    SELECT v.id, v.percentage, v.effective_from INTO v_prev_id, v_prev_pct, v_prev_from
    FROM public.commission_rate_versions v
    WHERE v.tenant_id = p_tenant_id AND v.subject_kind = p_subject_kind
      AND v.introducer_id IS NOT DISTINCT FROM p_introducer_id
      AND v.adviser_user_id IS NOT DISTINCT FROM p_adviser_user_id
      AND v.fee_type = v_key
    ORDER BY v.effective_from DESC
    LIMIT 1;
    v_has_prev := FOUND;
    IF v_has_prev AND v_prev_pct = v_pct THEN
      CONTINUE;
    END IF;
    IF v_has_prev AND v_eff <= v_prev_from THEN
      RAISE EXCEPTION 'commission_rate_effective_not_after_latest' USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.commission_rate_versions (
      tenant_id, subject_kind, introducer_id, adviser_user_id, adviser_role, fee_type, percentage,
      effective_from, created_by, reason, source
    )
    VALUES (
      p_tenant_id, p_subject_kind, p_introducer_id, p_adviser_user_id,
      CASE WHEN p_subject_kind = 'adviser' THEN 'adviser'::public.tenant_member_role END,
      v_key, v_pct, v_eff, p_actor_user_id, v_reason, 'owner'
    )
    RETURNING id INTO v_new;

    INSERT INTO public.finance_audit_log (
      audit_type, subject_user_id, role, fee_type, summary, detail, changed_by, tenant_id
    )
    VALUES (
      'commission_rate_version', v_subject_user, v_role_label, v_key,
      format('%s %s: %s %s → %s%% effective %s%s', v_role_label,
             COALESCE(NULLIF(btrim(v_subject_label), ''), '(unnamed)'), v_key,
             CASE WHEN v_has_prev THEN v_prev_pct::text || '%' ELSE 'not set' END, v_pct,
             to_char(v_eff AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'),
             CASE WHEN v_backdated THEN ' (backdated)' ELSE '' END),
      jsonb_build_object(
        'version_id', v_new,
        'subject_kind', p_subject_kind,
        'introducer_id', p_introducer_id,
        'adviser_user_id', p_adviser_user_id,
        'fee_type', v_key,
        'previous_version_id', CASE WHEN v_has_prev THEN v_prev_id END,
        'previous_percentage', CASE WHEN v_has_prev THEN v_prev_pct END,
        'percentage', v_pct,
        'effective_from', v_eff,
        'effective_mode', CASE WHEN p_effective_now THEN 'now' ELSE 'date' END,
        'backdated', v_backdated,
        'reason', v_reason
      ),
      p_actor_user_id, p_tenant_id
    );

    v_changed := v_changed + 1;
    version_id := v_new;
    fee_type := v_key;
    percentage := v_pct;
    previous_version_id := CASE WHEN v_has_prev THEN v_prev_id END;
    previous_percentage := CASE WHEN v_has_prev THEN v_prev_pct END;
    effective_from := v_eff;
    RETURN NEXT;
  END LOOP;

  IF v_changed = 0 THEN
    RAISE EXCEPTION 'commission_rate_no_change' USING ERRCODE = 'invalid_parameter_value';
  END IF;
END;
$$;

-- J. Privileges: no client role reads or writes versions; service role reads and appends only.
ALTER TABLE public.commission_rate_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commission_rate_versions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.commission_rate_versions TO service_role;

REVOKE ALL ON FUNCTION public.commission_rate_versions_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_commission_rate_as_of(uuid, text, uuid, uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_commission_rate_as_of(uuid, text, uuid, uuid, text, timestamptz)
  TO service_role;
REVOKE ALL ON FUNCTION public.set_commission_rate_versions(
  uuid, uuid, text, uuid, uuid, jsonb, boolean, timestamptz, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_commission_rate_versions(
  uuid, uuid, text, uuid, uuid, jsonb, boolean, timestamptz, boolean, text)
  TO service_role;

COMMENT ON FUNCTION public.resolve_commission_rate_as_of(uuid, text, uuid, uuid, text, timestamptz) IS
  'G7F-4S4C4-B4a: the commission rate version effective at p_event_at for one tenant subject and fee type. No row = no rate set. service_role only.';
COMMENT ON FUNCTION public.set_commission_rate_versions(
  uuid, uuid, text, uuid, uuid, jsonb, boolean, timestamptz, boolean, text) IS
  'G7F-4S4C4-B4a: atomic Owner commission rate change (versions + finance audit). Caller establishes Owner authority first. service_role only.';

-- K. Postconditions.
DO $$
DECLARE
  v_con record;
  v_fn record;
  v_bad bigint;
BEGIN
  FOR v_con IN
    SELECT * FROM (VALUES
      ('commission_rate_versions_pkey', 'p', 'PRIMARY KEY (id)'),
      ('commission_rate_versions_tenant_fkey', 'f',
       'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT'),
      ('commission_rate_versions_introducer_tenant_fkey', 'f',
       'FOREIGN KEY (introducer_id, tenant_id) REFERENCES introducers(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT'),
      ('commission_rate_versions_adviser_capacity_fkey', 'f',
       'FOREIGN KEY (adviser_user_id, tenant_id, adviser_role) REFERENCES tenant_memberships(user_id, tenant_id, role) ON UPDATE RESTRICT ON DELETE RESTRICT'),
      ('commission_rate_versions_subject_effective_key', 'u',
       'UNIQUE NULLS NOT DISTINCT (tenant_id, subject_kind, introducer_id, adviser_user_id, fee_type, effective_from)'),
      ('commission_rate_versions_legacy_history_key', 'u', 'UNIQUE (legacy_history_id)'),
      ('commission_rate_versions_percentage_check', 'c',
       'CHECK (((percentage >= (0)::numeric) AND (percentage <= (100)::numeric)))')
    ) AS e(name, kind, def)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = 'public.commission_rate_versions'::regclass AND c.conname = v_con.name
        AND c.contype = v_con.kind
        AND replace(pg_get_constraintdef(c.oid), 'REFERENCES public.', 'REFERENCES ') = v_con.def
    ) THEN
      RAISE EXCEPTION 'g7f4s4c4b4a_postcondition:key_missing:%', v_con.name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_constraint c
      WHERE c.conrelid = 'public.commission_rate_versions'::regclass AND c.contype = 'c'
        AND c.conname IN ('commission_rate_versions_subject_kind_check',
                          'commission_rate_versions_subject_shape_check',
                          'commission_rate_versions_fee_type_check',
                          'commission_rate_versions_introducer_fee_type_check',
                          'commission_rate_versions_percentage_check',
                          'commission_rate_versions_reason_check',
                          'commission_rate_versions_source_check')) <> 7 THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_postcondition:check_missing';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t
      WHERE t.tgrelid = 'public.commission_rate_versions'::regclass AND NOT t.tgisinternal
        AND t.tgenabled = 'O'
        AND t.tgname IN ('commission_rate_versions_append_only',
                         'commission_rate_versions_no_truncate')) <> 2 THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_postcondition:guard_trigger_missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = 'public.finance_settings'::regclass AND a.attname = 'tenant_id'
      AND NOT a.attnotnull
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.finance_settings'::regclass AND c.conname = 'finance_settings_pkey'
      AND c.contype = 'p' AND pg_get_constraintdef(c.oid) = 'PRIMARY KEY (tenant_id, key)'
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_postcondition:settings_key';
  END IF;

  -- Client roles have no privilege on versions or on the archives; service role reads and appends.
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('public.commission_rate_versions'), ('public.commission_rates_pre_b4a'),
                 ('public.commission_rate_history_pre_b4a')) AS t(rel)
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
                       ('REFERENCES'), ('TRIGGER')) AS p(priv)
    WHERE has_table_privilege(r.role, t.rel, p.priv)
  ) OR EXISTS (
    SELECT 1 FROM pg_class c, aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
    WHERE c.oid IN ('public.commission_rate_versions'::regclass,
                    'public.commission_rates_pre_b4a'::regclass,
                    'public.commission_rate_history_pre_b4a'::regclass)
      AND a.grantee = 0
  ) OR NOT has_table_privilege('service_role', 'public.commission_rate_versions', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.commission_rate_versions', 'INSERT')
    OR has_table_privilege('service_role', 'public.commission_rate_versions', 'UPDATE')
    OR has_table_privilege('service_role', 'public.commission_rate_versions', 'DELETE')
    OR has_table_privilege('service_role', 'public.commission_rate_versions', 'TRUNCATE')
    OR has_table_privilege('service_role', 'public.commission_rates_pre_b4a', 'INSERT,UPDATE,DELETE,TRUNCATE')
    OR has_table_privilege('service_role', 'public.commission_rate_history_pre_b4a', 'INSERT,UPDATE,DELETE,TRUNCATE')
  THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_postcondition:rate_privileges';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c
          WHERE c.oid = 'public.commission_rate_versions'::regclass)
     OR EXISTS (
       SELECT 1 FROM pg_policies p
       WHERE p.schemaname = 'public'
         AND p.tablename IN ('commission_rate_versions', 'commission_rates_pre_b4a',
                             'commission_rate_history_pre_b4a')
     ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_postcondition:rate_rls';
  END IF;

  SELECT count(*) AS n, bool_and(NOT p.prosecdef) AS invoker,
         bool_and(p.proconfig = ARRAY['search_path=""']) AS safe_path,
         bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                  AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                                  WHERE a.grantee = 0)
                  AND (p.proname = 'commission_rate_versions_guard'
                       OR has_function_privilege('service_role', p.oid, 'EXECUTE'))) AS acl_ok
  INTO v_fn
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('set_commission_rate_versions', 'resolve_commission_rate_as_of',
                      'commission_rate_versions_guard');
  IF v_fn.n IS DISTINCT FROM 3 OR v_fn.invoker IS NOT TRUE OR v_fn.safe_path IS NOT TRUE
     OR v_fn.acl_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_postcondition:function_privileges';
  END IF;

  -- Every legacy history row is exactly one version with the same facts.
  IF (SELECT count(*) FROM public.commission_rate_versions)
     IS DISTINCT FROM (SELECT count(*) FROM pg_temp.g7f4s4c4b4a_history_before) THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_postcondition:version_count';
  END IF;
  SELECT count(*) INTO v_bad
  FROM pg_temp.g7f4s4c4b4a_history_before b
  LEFT JOIN public.commission_rate_versions v ON v.legacy_history_id = b.id
  WHERE v.id IS NULL
     OR v.tenant_id IS DISTINCT FROM b.tenant_id
     OR v.subject_kind <> 'adviser'
     OR v.adviser_user_id IS DISTINCT FROM b.user_id
     OR v.fee_type IS DISTINCT FROM b.fee_type
     OR v.percentage IS DISTINCT FROM b.pct_to
     OR v.effective_from IS DISTINCT FROM b.created_at
     OR v.created_by IS DISTINCT FROM b.changed_by
     OR v.source <> 'legacy_migration';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_postcondition:version_mismatch';
  END IF;

  -- Each legacy current value is what the resolver now returns; untouched default zeros are "no rate".
  SELECT count(*) INTO v_bad
  FROM pg_temp.g7f4s4c4b4a_expected_current e
  LEFT JOIN LATERAL (
    SELECT r.percentage FROM public.resolve_commission_rate_as_of(
      e.tenant_id, 'adviser', NULL, e.user_id, e.fee_type, 'infinity'::timestamptz) r
  ) cur ON true
  WHERE (e.has_history AND cur.percentage IS DISTINCT FROM e.pct)
     OR (NOT e.has_history AND cur.percentage IS NOT NULL);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_postcondition:current_rate_mismatch';
  END IF;

  IF EXISTS (
    (SELECT row_text FROM pg_temp.g7f4s4c4b4a_rates_before
     EXCEPT ALL SELECT t::text FROM public.commission_rates_pre_b4a t)
    UNION ALL
    (SELECT t::text FROM public.commission_rates_pre_b4a t
     EXCEPT ALL SELECT row_text FROM pg_temp.g7f4s4c4b4a_rates_before)
  ) OR EXISTS (
    (SELECT row_text FROM pg_temp.g7f4s4c4b4a_history_before
     EXCEPT ALL SELECT t::text FROM public.commission_rate_history_pre_b4a t)
    UNION ALL
    (SELECT t::text FROM public.commission_rate_history_pre_b4a t
     EXCEPT ALL SELECT row_text FROM pg_temp.g7f4s4c4b4a_history_before)
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_postcondition:archive_changed';
  END IF;
  IF EXISTS (
    (SELECT row_text FROM pg_temp.g7f4s4c4b4a_settings_before
     EXCEPT ALL SELECT t::text FROM public.finance_settings t)
    UNION ALL
    (SELECT t::text FROM public.finance_settings t
     EXCEPT ALL SELECT row_text FROM pg_temp.g7f4s4c4b4a_settings_before)
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_postcondition:settings_changed';
  END IF;

  CREATE TEMP TABLE g7f4s4c4b4a_rows_after AS
  SELECT 'finance_ledger'::text AS tbl, t::text AS row_text FROM public.finance_ledger t
  UNION ALL SELECT 'finance_fee_lines', t::text FROM public.finance_fee_lines t
  UNION ALL SELECT 'finance_audit_log', t::text FROM public.finance_audit_log t
  UNION ALL SELECT 'network_commission_statements', t::text FROM public.network_commission_statements t
  UNION ALL SELECT 'network_commission_lines', t::text FROM public.network_commission_lines t
  UNION ALL SELECT 'referrals', t::text FROM public.referrals t
  UNION ALL SELECT 'referral_codes', t::text FROM public.referral_codes t
  UNION ALL SELECT 'introducers', t::text FROM public.introducers t
  UNION ALL SELECT 'tenant_memberships', t::text FROM public.tenant_memberships t
  UNION ALL SELECT 'customer_introducer_links', t::text FROM public.customer_introducer_links t
  UNION ALL SELECT 'introducer_amendment_history', t::text FROM public.introducer_amendment_history t
  UNION ALL SELECT 'interview_sessions', t::text FROM public.interview_sessions t
  UNION ALL SELECT 'session_advisors', t::text FROM public.session_advisors t
  UNION ALL SELECT 'appointments', t::text FROM public.appointments t;
  IF EXISTS (
    (SELECT tbl, row_text FROM pg_temp.g7f4s4c4b4a_rows_before
     EXCEPT ALL
     SELECT tbl, row_text FROM pg_temp.g7f4s4c4b4a_rows_after)
    UNION ALL
    (SELECT tbl, row_text FROM pg_temp.g7f4s4c4b4a_rows_after
     EXCEPT ALL
     SELECT tbl, row_text FROM pg_temp.g7f4s4c4b4a_rows_before)
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_postcondition:business_data_changed';
  END IF;
  DROP TABLE pg_temp.g7f4s4c4b4a_rows_after;

  IF (SELECT b.fingerprint FROM pg_temp.g7f4s4c4b4a_untouched_catalog b) IS DISTINCT FROM md5(
    (SELECT COALESCE(string_agg(c.conrelid::regclass::text || ':' || c.conname || ':'
                                || pg_get_constraintdef(c.oid), '|'
                                ORDER BY c.conrelid::regclass::text, c.conname), '')
     FROM pg_constraint c
     WHERE c.conrelid IN ('public.finance_ledger'::regclass, 'public.finance_fee_lines'::regclass,
                          'public.finance_audit_log'::regclass,
                          'public.network_commission_statements'::regclass,
                          'public.network_commission_lines'::regclass,
                          'public.referrals'::regclass, 'public.referral_codes'::regclass,
                          'public.introducers'::regclass, 'public.tenant_memberships'::regclass,
                          'public.customer_introducer_links'::regclass,
                          'public.introducer_amendment_history'::regclass))
    || '#' ||
    (SELECT COALESCE(string_agg(concat_ws(':', p.tablename, p.policyname, p.permissive, p.cmd,
                                          p.roles::text, p.qual, p.with_check), '|'
                                ORDER BY p.tablename, p.policyname), '')
     FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename IN ('finance_ledger', 'finance_fee_lines', 'finance_audit_log',
                           'finance_settings', 'network_commission_statements',
                           'network_commission_lines', 'referrals', 'referral_codes',
                           'introducers', 'tenant_memberships', 'customer_introducer_links',
                           'introducer_amendment_history'))
    || '#' ||
    (SELECT COALESCE(string_agg(c.relname || ':' || COALESCE(c.relacl::text, '') || ':'
                                || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text,
                                '|' ORDER BY c.relname), '')
     FROM pg_class c
     WHERE c.oid IN ('public.finance_ledger'::regclass, 'public.finance_fee_lines'::regclass,
                     'public.finance_audit_log'::regclass, 'public.finance_settings'::regclass,
                     'public.network_commission_statements'::regclass,
                     'public.network_commission_lines'::regclass,
                     'public.referrals'::regclass, 'public.referral_codes'::regclass,
                     'public.introducers'::regclass, 'public.tenant_memberships'::regclass,
                     'public.customer_introducer_links'::regclass,
                     'public.introducer_amendment_history'::regclass))
    || '#' ||
    (SELECT COALESCE(string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':'
                                || COALESCE(p.proacl::text, ''), '|'
                                ORDER BY p.oid::regprocedure::text), '')
     FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = 'amend_customer_introducer_attribution')
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4a_postcondition:untouched_catalog_changed';
  END IF;
END
$$;

-- L.
DROP TABLE pg_temp.g7f4s4c4b4a_rates_before, pg_temp.g7f4s4c4b4a_history_before,
  pg_temp.g7f4s4c4b4a_expected_current, pg_temp.g7f4s4c4b4a_settings_before,
  pg_temp.g7f4s4c4b4a_rows_before, pg_temp.g7f4s4c4b4a_untouched_catalog;
