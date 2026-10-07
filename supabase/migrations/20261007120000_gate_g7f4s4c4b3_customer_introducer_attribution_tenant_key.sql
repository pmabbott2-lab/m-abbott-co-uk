-- Gate G7F-4S4C4-B3: customer introducer attribution is keyed by (tenant, customer).
-- Each tenant holds at most one current attribution per customer, naming one of that tenant's own
-- introducers. The attribution of another tenant is never read, overwritten or blocked by this one.
-- Amendment history rows carry the same composite reference. Introducers referenced by an
-- attribution or by history can no longer be deleted or re-keyed underneath it (RESTRICT).
--
-- Legacy rows with a NULL tenant_id are stamped with their introducer's tenant only when the
-- database proves it: the introducer has a tenant and no appointment, introducer lead or history
-- row for that customer and introducer names a different tenant. Any unprovable row RAISEs.
--
-- Atomicity: the file is one multi-statement request and runs as a single transaction. Every
-- precondition is checked before any DDL and every postcondition after it; any miss RAISEs and
-- rolls the whole migration back. No row is deleted, merged or reassigned.
--
-- Rollback model: forward-only. A reversal must first prove that no customer holds more than one
-- attribution row, and RAISE otherwise; only then may it restore PRIMARY KEY (customer_id). It
-- must never delete or merge an attribution row to get there.

-- A. Locks.
LOCK TABLE public.customer_introducer_links, public.introducer_amendment_history
  IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.introducers, public.appointments, public.introducer_leads,
  public.interview_sessions IN SHARE MODE;

-- B. Preconditions.
DO $$
DECLARE
  v_con record;
  v_cols text;
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'g7f4s4c4b3_precondition:postgres_version_below_15';
  END IF;

  FOR v_con IN
    SELECT * FROM (VALUES
      ('public.customer_introducer_links'::regclass, 'customer_introducer_links_pkey', 'p',
       'PRIMARY KEY (customer_id)'),
      ('public.customer_introducer_links'::regclass, 'customer_introducer_links_introducer_id_fkey', 'f',
       'FOREIGN KEY (introducer_id) REFERENCES introducers(id) ON DELETE CASCADE'),
      ('public.introducer_amendment_history'::regclass,
       'introducer_amendment_history_previous_introducer_id_fkey', 'f',
       'FOREIGN KEY (previous_introducer_id) REFERENCES introducers(id) ON DELETE SET NULL'),
      ('public.introducer_amendment_history'::regclass,
       'introducer_amendment_history_new_introducer_id_fkey', 'f',
       'FOREIGN KEY (new_introducer_id) REFERENCES introducers(id) ON DELETE SET NULL'),
      ('public.introducers'::regclass, 'introducers_id_tenant_id_key', 'u', 'UNIQUE (id, tenant_id)')
    ) AS e(rel, name, kind, def)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = v_con.rel AND c.conname = v_con.name AND c.contype = v_con.kind
        AND replace(pg_get_constraintdef(c.oid), 'REFERENCES public.', 'REFERENCES ') = v_con.def
    ) THEN
      RAISE EXCEPTION 'g7f4s4c4b3_precondition:key_missing_or_changed:%', v_con.name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_constraint f WHERE f.confrelid = 'public.customer_introducer_links'::regclass
  ) OR EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_depend d
      ON (d.refclassid = 'pg_constraint'::regclass AND d.refobjid = c.oid)
      OR (d.refclassid = 'pg_class'::regclass AND d.refobjid = c.conindid)
    WHERE c.conrelid = 'public.customer_introducer_links'::regclass
      AND c.conname = 'customer_introducer_links_pkey'
      AND NOT (d.classid = 'pg_class'::regclass AND d.objid = c.conindid)
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b3_precondition:links_key_has_dependants';
  END IF;

  SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull,
                    ',' ORDER BY a.attnum)
  INTO v_cols
  FROM pg_attribute a
  WHERE a.attrelid = 'public.customer_introducer_links'::regclass AND a.attnum > 0
    AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM
     'customer_id:uuid:true,introducer_id:uuid:true,source:text:false,'
     'created_at:timestamp with time zone:true,effective_from:timestamp with time zone:true,'
     'updated_at:timestamp with time zone:true,tenant_id:uuid:false' THEN
    RAISE EXCEPTION 'g7f4s4c4b3_precondition:links_columns_changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = 'public.introducer_amendment_history'::regclass AND a.attname = 'tenant_id'
      AND a.atttypid = 'uuid'::regtype AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b3_precondition:history_tenant_column_missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conname IN ('customer_introducer_links_introducer_tenant_fkey',
                        'introducer_amendment_history_previous_introducer_tenant_fkey',
                        'introducer_amendment_history_new_introducer_tenant_fkey')
  ) OR to_regclass('public.customer_introducer_links_customer_id_idx') IS NOT NULL
    OR to_regclass('public.introducer_amendment_history_tenant_customer_idx') IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace
        AND p.proname = 'amend_customer_introducer_attribution'
    ) THEN
    RAISE EXCEPTION 'g7f4s4c4b3_precondition:new_name_in_use';
  END IF;

  -- Stamped rows already name their introducer's tenant.
  IF EXISTS (
    SELECT 1 FROM public.customer_introducer_links l
    JOIN public.introducers i ON i.id = l.introducer_id
    WHERE l.tenant_id IS NOT NULL AND i.tenant_id IS DISTINCT FROM l.tenant_id
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b3_precondition:stamped_link_tenant_mismatch';
  END IF;

  -- Legacy tenantless rows: the introducer's tenant is the only tenant the evidence names.
  IF EXISTS (
    SELECT 1 FROM public.customer_introducer_links l
    LEFT JOIN public.introducers i ON i.id = l.introducer_id
    WHERE l.tenant_id IS NULL AND (i.id IS NULL OR i.tenant_id IS NULL)
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b3_precondition:legacy_link_unprovable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.customer_introducer_links l
    JOIN public.introducers i ON i.id = l.introducer_id
    WHERE l.tenant_id IS NULL
      AND (
        EXISTS (
          SELECT 1 FROM public.interview_sessions s
          JOIN public.appointments a ON a.session_id = s.id
          WHERE s.customer_id = l.customer_id AND a.introducer_id = l.introducer_id
            AND a.tenant_id IS NOT NULL AND a.tenant_id <> i.tenant_id
        )
        OR EXISTS (
          SELECT 1 FROM public.interview_sessions s
          JOIN public.introducer_leads ld ON ld.session_id = s.id
          WHERE s.customer_id = l.customer_id AND ld.introducer_id = l.introducer_id
            AND ld.tenant_id IS NOT NULL AND ld.tenant_id <> i.tenant_id
        )
        OR EXISTS (
          SELECT 1 FROM public.introducer_amendment_history h
          WHERE h.customer_id = l.customer_id
            AND l.introducer_id IN (h.previous_introducer_id, h.new_introducer_id)
            AND h.tenant_id IS NOT NULL AND h.tenant_id <> i.tenant_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b3_precondition:legacy_link_conflicting_evidence';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customer_introducer_links l
    JOIN public.introducers i ON i.id = l.introducer_id
    GROUP BY COALESCE(l.tenant_id, i.tenant_id), l.customer_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b3_precondition:projected_tenant_customer_duplicate';
  END IF;

  IF EXISTS (SELECT 1 FROM public.introducer_amendment_history h WHERE h.tenant_id IS NULL) THEN
    RAISE EXCEPTION 'g7f4s4c4b3_precondition:history_tenant_null';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.introducer_amendment_history h
    JOIN public.introducers i ON i.id IN (h.previous_introducer_id, h.new_introducer_id)
    WHERE i.tenant_id IS DISTINCT FROM h.tenant_id
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b3_precondition:history_introducer_tenant_mismatch';
  END IF;
END
$$;

-- C. Baseline. Whole-row text of every row (every column, in attribute order).
CREATE TEMP TABLE g7f4s4c4b3_links_before AS
SELECT t.customer_id, t.tenant_id, t::text AS row_text, to_jsonb(t) AS row_json
FROM public.customer_introducer_links t;

CREATE TEMP TABLE g7f4s4c4b3_rows_before AS
SELECT 'introducer_amendment_history'::text AS tbl, t::text AS row_text
FROM public.introducer_amendment_history t
UNION ALL SELECT 'introducers', t::text FROM public.introducers t
UNION ALL SELECT 'appointments', t::text FROM public.appointments t
UNION ALL SELECT 'introducer_leads', t::text FROM public.introducer_leads t
UNION ALL SELECT 'interview_sessions', t::text FROM public.interview_sessions t
UNION ALL SELECT 'tenant_memberships', t::text FROM public.tenant_memberships t
UNION ALL SELECT 'finance_ledger', t::text FROM public.finance_ledger t
UNION ALL SELECT 'finance_fee_lines', t::text FROM public.finance_fee_lines t
UNION ALL SELECT 'finance_audit_log', t::text FROM public.finance_audit_log t
UNION ALL SELECT 'finance_settings', t::text FROM public.finance_settings t
UNION ALL SELECT 'commission_rates', t::text FROM public.commission_rates t
UNION ALL SELECT 'commission_rate_history', t::text FROM public.commission_rate_history t
UNION ALL SELECT 'referrals', t::text FROM public.referrals t
UNION ALL SELECT 'referral_codes', t::text FROM public.referral_codes t;

-- Keys on untouched tables, policies and privileges (catalog text, deterministically ordered).
CREATE TEMP TABLE g7f4s4c4b3_baseline AS
SELECT
  (SELECT count(*) FROM public.customer_introducer_links l WHERE l.tenant_id IS NULL) AS tenantless,
  (SELECT md5(COALESCE(string_agg(c.conrelid::regclass::text || ':' || c.conname || ':'
                                  || pg_get_constraintdef(c.oid), '|'
                                  ORDER BY c.conrelid::regclass::text, c.conname), ''))
     FROM pg_constraint c
     WHERE c.conrelid IN ('public.introducers'::regclass, 'public.tenant_memberships'::regclass)) AS untouched_keys,
  (SELECT md5(COALESCE(string_agg(concat_ws(':', p.tablename, p.policyname, p.permissive, p.cmd,
                                            p.roles::text, p.qual, p.with_check), '|'
                                  ORDER BY p.tablename, p.policyname), ''))
     FROM pg_policies p
     WHERE p.schemaname = 'public'
       AND p.tablename IN ('customer_introducer_links', 'introducer_amendment_history',
                           'introducers', 'finance_audit_log')) AS policies,
  (SELECT md5(COALESCE(string_agg(c.relname || ':' || COALESCE(c.relacl::text, '') || ':'
                                  || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text,
                                  '|' ORDER BY c.relname), ''))
     FROM pg_class c
     WHERE c.oid IN ('public.customer_introducer_links'::regclass,
                     'public.introducer_amendment_history'::regclass,
                     'public.introducers'::regclass, 'public.finance_audit_log'::regclass)) AS table_acl,
  (SELECT md5(COALESCE(string_agg(a.attrelid::regclass::text || '.' || a.attname || ':'
                                  || COALESCE(a.attacl::text, ''), '|'
                                  ORDER BY a.attrelid::regclass::text, a.attname), ''))
     FROM pg_attribute a
     WHERE a.attrelid IN ('public.customer_introducer_links'::regclass,
                          'public.introducer_amendment_history'::regclass)
       AND a.attnum > 0 AND NOT a.attisdropped) AS column_acl;

-- D. Stamp proven legacy rows with their introducer's tenant.
DO $$
DECLARE
  v_expected bigint;
  v_stamped bigint;
BEGIN
  SELECT b.tenantless INTO v_expected FROM pg_temp.g7f4s4c4b3_baseline b;
  UPDATE public.customer_introducer_links l
  SET tenant_id = i.tenant_id
  FROM public.introducers i
  WHERE l.tenant_id IS NULL AND i.id = l.introducer_id AND i.tenant_id IS NOT NULL;
  GET DIAGNOSTICS v_stamped = ROW_COUNT;
  IF v_stamped IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'g7f4s4c4b3_backfill:row_count_mismatch';
  END IF;
END
$$;

-- E–H. Attribution key: (tenant, customer), naming an introducer of the same tenant.
ALTER TABLE public.customer_introducer_links ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.customer_introducer_links DROP CONSTRAINT customer_introducer_links_pkey;
ALTER TABLE public.customer_introducer_links
  ADD CONSTRAINT customer_introducer_links_pkey PRIMARY KEY (tenant_id, customer_id);
ALTER TABLE public.customer_introducer_links
  DROP CONSTRAINT customer_introducer_links_introducer_id_fkey;
ALTER TABLE public.customer_introducer_links
  ADD CONSTRAINT customer_introducer_links_introducer_tenant_fkey
  FOREIGN KEY (introducer_id, tenant_id) REFERENCES public.introducers (id, tenant_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT;
CREATE INDEX customer_introducer_links_customer_id_idx
  ON public.customer_introducer_links (customer_id);

-- I. Amendment history: tenant required; both introducers belong to the history row's tenant.
ALTER TABLE public.introducer_amendment_history ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.introducer_amendment_history
  DROP CONSTRAINT introducer_amendment_history_previous_introducer_id_fkey;
ALTER TABLE public.introducer_amendment_history
  DROP CONSTRAINT introducer_amendment_history_new_introducer_id_fkey;
ALTER TABLE public.introducer_amendment_history
  ADD CONSTRAINT introducer_amendment_history_previous_introducer_tenant_fkey
  FOREIGN KEY (previous_introducer_id, tenant_id) REFERENCES public.introducers (id, tenant_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE public.introducer_amendment_history
  ADD CONSTRAINT introducer_amendment_history_new_introducer_tenant_fkey
  FOREIGN KEY (new_introducer_id, tenant_id) REFERENCES public.introducers (id, tenant_id)
  ON UPDATE RESTRICT ON DELETE RESTRICT;
CREATE INDEX introducer_amendment_history_tenant_customer_idx
  ON public.introducer_amendment_history (tenant_id, customer_id, effective_from DESC);

-- J. Owner amendment: link, history and finance audit change together or not at all.
-- The caller (service role) has already established Owner authority in p_tenant_id; the
-- structural invariants are re-checked here under a per-(tenant, customer) lock.
CREATE FUNCTION public.amend_customer_introducer_attribution(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_introducer_id uuid,
  p_changed_by uuid,
  p_session_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS TABLE (
  changed boolean,
  previous_introducer_id uuid,
  new_introducer_id uuid,
  effective_from timestamptz,
  history_id uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_intro record;
  v_prev uuid;
  v_prev_from timestamptz;
  v_has_link boolean;
  v_now timestamptz;
  v_history uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_customer_id IS NULL OR p_introducer_id IS NULL
     OR p_changed_by IS NULL OR char_length(COALESCE(p_note, '')) > 500 THEN
    RAISE EXCEPTION 'attribution_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM 1 FROM public.tenants t
  WHERE t.id = p_tenant_id AND t.status::text = 'active'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'attribution_tenant_inactive' USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM pg_advisory_xact_lock(872014006, hashtext(p_tenant_id::text || ':' || p_customer_id::text));

  IF NOT EXISTS (
    SELECT 1 FROM public.interview_sessions s
    WHERE s.customer_id = p_customer_id AND s.tenant_id = p_tenant_id AND s.deleted_at IS NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM public.tenant_memberships m
    WHERE m.user_id = p_customer_id AND m.tenant_id = p_tenant_id
      AND m.role::text = 'customer' AND m.active
  ) THEN
    RAISE EXCEPTION 'attribution_customer_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.interview_sessions s
    WHERE s.id = p_session_id AND s.tenant_id = p_tenant_id AND s.customer_id = p_customer_id
      AND s.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'attribution_session_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT i.id, i.company_code, i.company_name INTO v_intro
  FROM public.introducers i
  WHERE i.id = p_introducer_id AND i.tenant_id = p_tenant_id AND i.active AND i.deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'attribution_introducer_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT l.introducer_id, l.effective_from INTO v_prev, v_prev_from
  FROM public.customer_introducer_links l
  WHERE l.tenant_id = p_tenant_id AND l.customer_id = p_customer_id
  FOR UPDATE;
  v_has_link := FOUND;

  v_now := now();
  IF NOT v_has_link THEN
    INSERT INTO public.customer_introducer_links
      (tenant_id, customer_id, introducer_id, source, effective_from, updated_at)
    VALUES (p_tenant_id, p_customer_id, p_introducer_id, 'amended', v_now, v_now)
    ON CONFLICT (tenant_id, customer_id) DO NOTHING;
    IF NOT FOUND THEN
      -- A concurrent booking created the attribution first: amend that row instead.
      SELECT l.introducer_id, l.effective_from INTO v_prev, v_prev_from
      FROM public.customer_introducer_links l
      WHERE l.tenant_id = p_tenant_id AND l.customer_id = p_customer_id
      FOR UPDATE;
      v_has_link := FOUND;
      IF NOT v_has_link THEN
        RAISE EXCEPTION 'attribution_conflict' USING ERRCODE = 'serialization_failure';
      END IF;
    END IF;
  END IF;

  IF v_has_link THEN
    IF v_prev = p_introducer_id THEN
      changed := false;
      previous_introducer_id := v_prev;
      new_introducer_id := v_prev;
      effective_from := v_prev_from;
      history_id := NULL;
      RETURN NEXT;
      RETURN;
    END IF;
    UPDATE public.customer_introducer_links l
    SET introducer_id = p_introducer_id, source = 'amended', effective_from = v_now,
        updated_at = v_now
    WHERE l.tenant_id = p_tenant_id AND l.customer_id = p_customer_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'attribution_conflict' USING ERRCODE = 'serialization_failure';
    END IF;
  END IF;

  INSERT INTO public.introducer_amendment_history (
    tenant_id, customer_id, session_id, previous_introducer_id, new_introducer_id,
    company_code, company_name, effective_from, commission_refreshed, changed_by, note
  )
  VALUES (
    p_tenant_id, p_customer_id, p_session_id, v_prev, p_introducer_id,
    v_intro.company_code, v_intro.company_name, v_now, false, p_changed_by,
    NULLIF(btrim(p_note), '')
  )
  RETURNING id INTO v_history;

  INSERT INTO public.finance_audit_log (
    audit_type, customer_id, session_id, summary, detail, changed_by, tenant_id
  )
  VALUES (
    'introducer_amendment', p_customer_id, p_session_id, 'Introducer attribution amended',
    jsonb_build_object(
      'history_id', v_history,
      'previous_introducer_id', v_prev,
      'new_introducer_id', p_introducer_id,
      'company_code', v_intro.company_code,
      'effective_from', v_now,
      'commission_refresh', false
    ),
    p_changed_by, p_tenant_id
  );

  changed := true;
  previous_introducer_id := v_prev;
  new_introducer_id := p_introducer_id;
  effective_from := v_now;
  history_id := v_history;
  RETURN NEXT;
END;
$$;

-- K. Service role only.
REVOKE ALL ON FUNCTION public.amend_customer_introducer_attribution(uuid, uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amend_customer_introducer_attribution(uuid, uuid, uuid, uuid, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.amend_customer_introducer_attribution(uuid, uuid, uuid, uuid, uuid, text) IS
  'G7F-4S4C4-B3: atomic Owner amendment of one tenant''s introducer attribution for a customer (link, history, finance audit). Caller establishes Owner authority first. service_role only.';

-- L. Postconditions.
DO $$
DECLARE
  v_base record;
  v_now record;
  v_fn record;
  v_con record;
BEGIN
  FOR v_con IN
    SELECT * FROM (VALUES
      ('public.customer_introducer_links'::regclass, 'customer_introducer_links_pkey', 'p',
       'PRIMARY KEY (tenant_id, customer_id)'),
      ('public.customer_introducer_links'::regclass, 'customer_introducer_links_introducer_tenant_fkey', 'f',
       'FOREIGN KEY (introducer_id, tenant_id) REFERENCES introducers(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT'),
      ('public.introducer_amendment_history'::regclass,
       'introducer_amendment_history_previous_introducer_tenant_fkey', 'f',
       'FOREIGN KEY (previous_introducer_id, tenant_id) REFERENCES introducers(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT'),
      ('public.introducer_amendment_history'::regclass,
       'introducer_amendment_history_new_introducer_tenant_fkey', 'f',
       'FOREIGN KEY (new_introducer_id, tenant_id) REFERENCES introducers(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT')
    ) AS e(rel, name, kind, def)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = v_con.rel AND c.conname = v_con.name AND c.contype = v_con.kind
        AND replace(pg_get_constraintdef(c.oid), 'REFERENCES public.', 'REFERENCES ') = v_con.def
    ) THEN
      RAISE EXCEPTION 'g7f4s4c4b3_postcondition:key_missing:%', v_con.name;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid IN ('public.customer_introducer_links'::regclass,
                         'public.introducer_amendment_history'::regclass)
      AND c.contype = 'f' AND c.confrelid = 'public.introducers'::regclass
      AND (c.confdeltype <> 'r' OR c.confupdtype <> 'r' OR array_length(c.conkey, 1) <> 2)
  ) OR EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conname IN ('customer_introducer_links_introducer_id_fkey',
                        'introducer_amendment_history_previous_introducer_id_fkey',
                        'introducer_amendment_history_new_introducer_id_fkey')
  ) OR EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.customer_introducer_links'::regclass AND c.contype IN ('p', 'u')
      AND pg_get_constraintdef(c.oid) IN ('PRIMARY KEY (customer_id)', 'UNIQUE (customer_id)')
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b3_postcondition:old_key_present';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index x
    WHERE x.indexrelid = 'public.customer_introducer_links_customer_id_idx'::regclass
      AND NOT x.indisunique AND pg_get_indexdef(x.indexrelid) LIKE '% USING btree (customer_id)'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_index x
    WHERE x.indexrelid = 'public.introducer_amendment_history_tenant_customer_idx'::regclass
      AND NOT x.indisunique
      AND pg_get_indexdef(x.indexrelid) LIKE '% USING btree (tenant_id, customer_id, effective_from DESC)'
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b3_postcondition:index_missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid IN ('public.customer_introducer_links'::regclass,
                         'public.introducer_amendment_history'::regclass)
      AND a.attname = 'tenant_id' AND NOT a.attnotnull
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b3_postcondition:tenant_id_nullable';
  END IF;

  -- Every attribution row survives; stamped rows unchanged; legacy rows gained only tenant_id.
  IF (SELECT count(*) FROM public.customer_introducer_links)
     IS DISTINCT FROM (SELECT count(*) FROM pg_temp.g7f4s4c4b3_links_before) THEN
    RAISE EXCEPTION 'g7f4s4c4b3_postcondition:links_row_count_changed';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_temp.g7f4s4c4b3_links_before b
    LEFT JOIN public.customer_introducer_links l ON l.customer_id = b.customer_id
    LEFT JOIN public.introducers i ON i.id = l.introducer_id
    WHERE l.customer_id IS NULL
       OR (b.tenant_id IS NOT NULL AND l::text IS DISTINCT FROM b.row_text)
       OR (b.tenant_id IS NULL
           AND ((to_jsonb(l) - 'tenant_id') IS DISTINCT FROM (b.row_json - 'tenant_id')
                OR l.tenant_id IS DISTINCT FROM i.tenant_id))
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b3_postcondition:links_data_changed';
  END IF;

  CREATE TEMP TABLE g7f4s4c4b3_rows_after AS
  SELECT 'introducer_amendment_history'::text AS tbl, t::text AS row_text
  FROM public.introducer_amendment_history t
  UNION ALL SELECT 'introducers', t::text FROM public.introducers t
  UNION ALL SELECT 'appointments', t::text FROM public.appointments t
  UNION ALL SELECT 'introducer_leads', t::text FROM public.introducer_leads t
  UNION ALL SELECT 'interview_sessions', t::text FROM public.interview_sessions t
  UNION ALL SELECT 'tenant_memberships', t::text FROM public.tenant_memberships t
  UNION ALL SELECT 'finance_ledger', t::text FROM public.finance_ledger t
  UNION ALL SELECT 'finance_fee_lines', t::text FROM public.finance_fee_lines t
  UNION ALL SELECT 'finance_audit_log', t::text FROM public.finance_audit_log t
  UNION ALL SELECT 'finance_settings', t::text FROM public.finance_settings t
  UNION ALL SELECT 'commission_rates', t::text FROM public.commission_rates t
  UNION ALL SELECT 'commission_rate_history', t::text FROM public.commission_rate_history t
  UNION ALL SELECT 'referrals', t::text FROM public.referrals t
  UNION ALL SELECT 'referral_codes', t::text FROM public.referral_codes t;
  IF EXISTS (
    (SELECT tbl, row_text FROM pg_temp.g7f4s4c4b3_rows_before
     EXCEPT ALL
     SELECT tbl, row_text FROM pg_temp.g7f4s4c4b3_rows_after)
    UNION ALL
    (SELECT tbl, row_text FROM pg_temp.g7f4s4c4b3_rows_after
     EXCEPT ALL
     SELECT tbl, row_text FROM pg_temp.g7f4s4c4b3_rows_before)
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b3_postcondition:business_data_changed';
  END IF;
  DROP TABLE pg_temp.g7f4s4c4b3_rows_after;

  SELECT * INTO v_base FROM pg_temp.g7f4s4c4b3_baseline;
  SELECT
    (SELECT md5(COALESCE(string_agg(c.conrelid::regclass::text || ':' || c.conname || ':'
                                    || pg_get_constraintdef(c.oid), '|'
                                    ORDER BY c.conrelid::regclass::text, c.conname), ''))
       FROM pg_constraint c
       WHERE c.conrelid IN ('public.introducers'::regclass, 'public.tenant_memberships'::regclass)) AS untouched_keys,
    (SELECT md5(COALESCE(string_agg(concat_ws(':', p.tablename, p.policyname, p.permissive, p.cmd,
                                              p.roles::text, p.qual, p.with_check), '|'
                                    ORDER BY p.tablename, p.policyname), ''))
       FROM pg_policies p
       WHERE p.schemaname = 'public'
         AND p.tablename IN ('customer_introducer_links', 'introducer_amendment_history',
                             'introducers', 'finance_audit_log')) AS policies,
    (SELECT md5(COALESCE(string_agg(c.relname || ':' || COALESCE(c.relacl::text, '') || ':'
                                    || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text,
                                    '|' ORDER BY c.relname), ''))
       FROM pg_class c
       WHERE c.oid IN ('public.customer_introducer_links'::regclass,
                       'public.introducer_amendment_history'::regclass,
                       'public.introducers'::regclass, 'public.finance_audit_log'::regclass)) AS table_acl,
    (SELECT md5(COALESCE(string_agg(a.attrelid::regclass::text || '.' || a.attname || ':'
                                    || COALESCE(a.attacl::text, ''), '|'
                                    ORDER BY a.attrelid::regclass::text, a.attname), ''))
       FROM pg_attribute a
       WHERE a.attrelid IN ('public.customer_introducer_links'::regclass,
                            'public.introducer_amendment_history'::regclass)
         AND a.attnum > 0 AND NOT a.attisdropped) AS column_acl
  INTO v_now;
  IF v_now.untouched_keys IS DISTINCT FROM v_base.untouched_keys THEN
    RAISE EXCEPTION 'g7f4s4c4b3_postcondition:introducer_or_membership_keys_changed';
  END IF;
  IF v_now.policies IS DISTINCT FROM v_base.policies
     OR v_now.table_acl IS DISTINCT FROM v_base.table_acl
     OR v_now.column_acl IS DISTINCT FROM v_base.column_acl THEN
    RAISE EXCEPTION 'g7f4s4c4b3_postcondition:policies_or_privileges_changed';
  END IF;

  SELECT count(*) AS n, bool_and(NOT p.prosecdef) AS invoker,
         bool_and(p.proconfig = ARRAY['search_path=""']) AS safe_path,
         bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                  AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                                  WHERE a.grantee = 0)
                  AND has_function_privilege('service_role', p.oid, 'EXECUTE')) AS service_only
  INTO v_fn
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'amend_customer_introducer_attribution';
  IF v_fn.n IS DISTINCT FROM 1 OR v_fn.invoker IS NOT TRUE OR v_fn.safe_path IS NOT TRUE
     OR v_fn.service_only IS NOT TRUE THEN
    RAISE EXCEPTION 'g7f4s4c4b3_postcondition:amend_function_privileges';
  END IF;
END
$$;

-- M.
DROP TABLE pg_temp.g7f4s4c4b3_baseline, pg_temp.g7f4s4c4b3_links_before,
  pg_temp.g7f4s4c4b3_rows_before;
