-- G7F-4S4C4-B4c-1 — Refer a Friend security, authority and audit foundations.
--
-- Approved business rule: a Refer a Friend bonus is earned only upon verified completion of the
-- referred customer's mortgage.
--
-- * referrals.bonus_status distinguishes: none (referral recorded), provisional (fact-find
--   submitted, provisionally qualified), completion_verified, earned, payment_approved, paid,
--   rejected and cancelled. The legacy value eligible is kept as recorded; it is never relabelled
--   and never treated as earned.
-- * Fact-find submission establishes provisional qualification only, and only while the tenant's
--   refer_a_friend feature is enabled and a positive raf_bonus_pence is configured
--   (record_referral_provisional_qualification).
-- * completion_verified and earned need a verified mortgage completion record, which does not
--   exist yet (B4c-2): no transition into them is permitted, so no bonus can be earned, approved
--   or paid. No RAF ledger accrual is created; finance_ledger keeps refusing RAF accruals.
-- * Bonus decisions are Owner/Supervisor only, by active membership of the tenant
--   (finance_actor_role 'payout'): General Admin, Adviser, Introducer, customers and platform
--   entry without membership are refused. paid and cancelled are terminal; reject, cancel,
--   reopen and approval withdrawal need a reason. Each decision carries a request id: a replay
--   returns already_applied, a different request reusing the id is a conflict.
-- * referral_bonus_transitions is the append-only history. Every bonus status change commits
--   together with exactly one transition row and one finance_audit_log row; referrals refuse a
--   status change without its transition. Legacy rows are not backfilled.
-- * Attribution is preserved: referrals and referral codes are never deleted, their identity
--   columns never change, and only one referral per customer may progress to a financial state.
-- * Client roles keep read access through RLS only; every write goes through service_role.
--
-- Single transaction, forward-only. Every precondition fails closed before any change.

-- A. Locks.
LOCK TABLE public.referrals, public.referral_codes IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.tenants, public.tenant_memberships, public.interview_sessions,
  public.finance_settings, public.finance_ledger, public.finance_audit_log IN SHARE MODE;

-- B. Preconditions.
DO $$
DECLARE
  v_con record;
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'g7f4s4c4b4c1_precondition:server_version';
  END IF;
  IF to_regprocedure('public.finance_actor_role(uuid, uuid, text)') IS NULL
     OR to_regprocedure('public.network_finance_audit(uuid, uuid, text, text, uuid, uuid, text, text, jsonb)') IS NULL
     OR to_regprocedure('public.is_tenant_feature_enabled(uuid, text)') IS NULL
     OR to_regprocedure('public.finance_ledger_guard()') IS NULL
     OR to_regclass('public.finance_payout_transitions') IS NULL THEN
    RAISE EXCEPTION 'g7f4s4c4b4c1_precondition:b4b2_missing';
  END IF;
  IF to_regclass('public.referral_bonus_transitions') IS NOT NULL
     OR to_regprocedure('public.set_referral_bonus_status(uuid, uuid, uuid, text, text, text, uuid)') IS NOT NULL
     OR to_regprocedure('public.record_referral_provisional_qualification(uuid, uuid, uuid)') IS NOT NULL
     OR to_regprocedure('public.raf_b4c1_writer()') IS NOT NULL THEN
    RAISE EXCEPTION 'g7f4s4c4b4c1_precondition:objects_present';
  END IF;

  FOR v_con IN
    SELECT * FROM (VALUES
      ('public.referrals',
       'id:uuid:nn,referral_code_id:uuid,code:text,referrer_user_id:uuid,referred_user_id:uuid,referred_email:text,status:text:nn,bonus_status:text:nn,notes:text,created_at:timestamp with time zone:nn,updated_at:timestamp with time zone:nn,tenant_id:uuid'),
      ('public.referral_codes',
       'id:uuid:nn,code:text:nn,referrer_user_id:uuid,referrer_name:text,referrer_phone:text,created_by:uuid,active:boolean:nn,created_at:timestamp with time zone:nn,tenant_id:uuid'),
      ('public.finance_settings',
       'key:text:nn,num_value:integer:nn,updated_at:timestamp with time zone:nn,tenant_id:uuid:nn')
    ) AS e(rel, sig)
  LOOP
    IF (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod)
                          || CASE WHEN a.attnotnull THEN ':nn' ELSE '' END, ',' ORDER BY a.attnum)
        FROM pg_attribute a
        WHERE a.attrelid = v_con.rel::regclass AND a.attnum > 0 AND NOT a.attisdropped)
       IS DISTINCT FROM v_con.sig THEN
      RAISE EXCEPTION 'g7f4s4c4b4c1_precondition:column_signature:%', v_con.rel;
    END IF;
  END LOOP;

  FOR v_con IN
    SELECT * FROM (VALUES
      ('public.referrals', 'referrals_bonus_status_check',
       'CHECK ((bonus_status = ANY (ARRAY[''none''::text, ''eligible''::text, ''paid''::text, ''rejected''::text])))'),
      ('public.referrals', 'referrals_status_check',
       'CHECK ((status = ANY (ARRAY[''pending''::text, ''signed_up''::text, ''qualified''::text, ''rewarded''::text])))'),
      ('public.referrals', 'referrals_code_referred_user_id_key', 'UNIQUE (code, referred_user_id)'),
      ('public.referrals', 'referrals_referral_code_id_fkey',
       'FOREIGN KEY (referral_code_id) REFERENCES referral_codes(id) ON DELETE SET NULL'),
      ('public.referrals', 'referrals_referred_user_id_fkey',
       'FOREIGN KEY (referred_user_id) REFERENCES auth.users(id) ON DELETE SET NULL'),
      ('public.referrals', 'referrals_referrer_user_id_fkey',
       'FOREIGN KEY (referrer_user_id) REFERENCES auth.users(id) ON DELETE SET NULL'),
      ('public.referrals', 'referrals_tenant_id_fkey', 'FOREIGN KEY (tenant_id) REFERENCES tenants(id)'),
      ('public.referral_codes', 'referral_codes_code_key', 'UNIQUE (code)'),
      ('public.referral_codes', 'referral_codes_code_format',
       'CHECK ((code ~ ''^[A-Za-z0-9]{4,16}$''::text))'),
      ('public.referral_codes', 'referral_codes_created_by_fkey',
       'FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL'),
      ('public.referral_codes', 'referral_codes_referrer_user_id_fkey',
       'FOREIGN KEY (referrer_user_id) REFERENCES auth.users(id) ON DELETE SET NULL'),
      ('public.referral_codes', 'referral_codes_tenant_id_fkey',
       'FOREIGN KEY (tenant_id) REFERENCES tenants(id)')
    ) AS e(rel, name, def)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = v_con.rel::regclass AND c.conname = v_con.name
        AND replace(pg_get_constraintdef(c.oid), 'REFERENCES public.', 'REFERENCES ') = v_con.def
    ) THEN
      RAISE EXCEPTION 'g7f4s4c4b4c1_precondition:key_shape:%', v_con.name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_constraint c
      WHERE c.conrelid = 'public.referrals'::regclass AND c.contype IN ('f', 'c', 'u')) <> 7
     OR (SELECT count(*) FROM pg_constraint c
         WHERE c.conrelid = 'public.referral_codes'::regclass AND c.contype IN ('f', 'c', 'u')) <> 5 THEN
    RAISE EXCEPTION 'g7f4s4c4b4c1_precondition:key_shape:unexpected_constraint';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal
             AND t.tgrelid IN ('public.referrals'::regclass, 'public.referral_codes'::regclass)) THEN
    RAISE EXCEPTION 'g7f4s4c4b4c1_precondition:unexpected_trigger';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.referrals'::regclass)
     OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.referral_codes'::regclass)
     OR (SELECT string_agg(p.tablename || '/' || p.policyname || '/' || p.cmd, ','
                           ORDER BY p.tablename COLLATE "C")
         FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename IN ('referrals', 'referral_codes'))
        IS DISTINCT FROM 'referral_codes/Staff manage referral codes/ALL,referrals/Staff view referrals/SELECT' THEN
    RAISE EXCEPTION 'g7f4s4c4b4c1_precondition:policies';
  END IF;

  -- RAF has never accrued: no ledger row may reference a referral or a referrer beneficiary.
  IF EXISTS (SELECT 1 FROM public.finance_ledger g
             WHERE g.referral_id IS NOT NULL OR g.beneficiary_role = 'referrer') THEN
    RAISE EXCEPTION 'g7f4s4c4b4c1_precondition:raf_ledger_present';
  END IF;
END
$$;

CREATE TEMP TABLE g7f4s4c4b4c1_rows_before AS
SELECT 'referrals'::text AS tbl, to_jsonb(t) AS j FROM public.referrals t
UNION ALL SELECT 'referral_codes', to_jsonb(t) FROM public.referral_codes t
UNION ALL SELECT 'finance_settings', to_jsonb(t) FROM public.finance_settings t;

-- C. Bonus lifecycle vocabulary (legacy values kept as recorded).
ALTER TABLE public.referrals DROP CONSTRAINT referrals_bonus_status_check;
ALTER TABLE public.referrals ADD CONSTRAINT referrals_bonus_status_check CHECK (
  bonus_status IN ('none', 'provisional', 'eligible', 'completion_verified', 'earned',
                   'payment_approved', 'paid', 'rejected', 'cancelled')
);

-- D. Append-only bonus transition history.
CREATE TABLE public.referral_bonus_transitions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  referral_id uuid NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  actor_user_id uuid NOT NULL,
  actor_role text NOT NULL,
  reason text,
  evidence_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  txid bigint NOT NULL DEFAULT txid_current(),
  CONSTRAINT referral_bonus_transitions_pkey PRIMARY KEY (id),
  CONSTRAINT referral_bonus_transitions_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT referral_bonus_transitions_referral_fkey FOREIGN KEY (referral_id)
    REFERENCES public.referrals (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT referral_bonus_transitions_request_key UNIQUE (tenant_id, request_id),
  CONSTRAINT referral_bonus_transitions_pair_check CHECK (
    from_status || '>' || to_status IN (
      'none>provisional',
      'none>rejected', 'none>cancelled',
      'provisional>rejected', 'provisional>cancelled',
      'eligible>rejected', 'eligible>cancelled',
      'completion_verified>rejected', 'completion_verified>cancelled',
      'earned>payment_approved', 'earned>rejected', 'earned>cancelled',
      'payment_approved>paid', 'payment_approved>earned', 'payment_approved>rejected',
      'payment_approved>cancelled',
      'rejected>none', 'rejected>provisional')
  ),
  CONSTRAINT referral_bonus_transitions_actor_check CHECK (
    CASE WHEN from_status || '>' || to_status = 'none>provisional'
      THEN actor_role = 'fact_find_submission'
      ELSE actor_role IN ('owner', 'supervisor') END
  ),
  CONSTRAINT referral_bonus_transitions_reason_check CHECK (
    (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500)
    AND (reason IS NOT NULL OR NOT (to_status IN ('rejected', 'cancelled')
                                    OR from_status = 'rejected'
                                    OR from_status || '>' || to_status = 'payment_approved>earned'))
  ),
  CONSTRAINT referral_bonus_transitions_evidence_check CHECK (
    jsonb_typeof(evidence_ref) = 'object'
    AND (actor_role <> 'fact_find_submission'
         OR (evidence_ref ->> 'kind' = 'fact_find_submitted' AND evidence_ref ? 'session_id'))
  )
);
CREATE INDEX referral_bonus_transitions_referral_idx
  ON public.referral_bonus_transitions (referral_id, recorded_at);
CREATE INDEX referral_bonus_transitions_tenant_idx
  ON public.referral_bonus_transitions (tenant_id, recorded_at);

-- E. Writer flag and guards.
CREATE FUNCTION public.raf_b4c1_writer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(current_setting('raf.b4c1_writer', true), '') = 'on';
$$;

-- The tenant a referral belongs to: its own tenant, or (legacy tenantless rows) its code's tenant.
CREATE FUNCTION public.referral_effective_tenant(p_referral_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(r.tenant_id, c.tenant_id)
  FROM public.referrals r
  LEFT JOIN public.referral_codes c ON c.id = r.referral_code_id
  WHERE r.id = p_referral_id;
$$;

-- Programme in force for a tenant: refer_a_friend enabled and a positive bonus configured.
CREATE FUNCTION public.raf_programme_configured(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT p_tenant_id IS NOT NULL
    AND COALESCE(public.is_tenant_feature_enabled(p_tenant_id, 'refer_a_friend'), false)
    AND EXISTS (SELECT 1 FROM public.finance_settings s
                WHERE s.tenant_id = p_tenant_id AND s.key = 'raf_bonus_pence' AND s.num_value > 0);
$$;

CREATE FUNCTION public.referral_bonus_transitions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_ref public.referrals%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'raf_history_immutable';
  END IF;
  IF NOT public.raf_b4c1_writer() THEN
    RAISE EXCEPTION 'raf_write_forbidden';
  END IF;
  NEW.recorded_at := now();
  NEW.txid := txid_current();
  SELECT * INTO v_ref FROM public.referrals r WHERE r.id = NEW.referral_id;
  IF NOT FOUND
     OR public.referral_effective_tenant(v_ref.id) IS DISTINCT FROM NEW.tenant_id
     OR v_ref.bonus_status IS DISTINCT FROM NEW.from_status THEN
    RAISE EXCEPTION 'raf_transition_invalid';
  END IF;
  IF NEW.actor_role = 'fact_find_submission' AND NOT EXISTS (
    SELECT 1 FROM public.interview_sessions s
    WHERE s.id::text = NEW.evidence_ref ->> 'session_id' AND s.tenant_id = NEW.tenant_id
      AND s.customer_id = NEW.actor_user_id AND s.customer_id = v_ref.referred_user_id
      AND s.status = 'submitted' AND s.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'raf_transition_invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER referral_bonus_transitions_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.referral_bonus_transitions
  FOR EACH ROW EXECUTE FUNCTION public.referral_bonus_transitions_guard();
CREATE TRIGGER referral_bonus_transitions_no_truncate
  BEFORE TRUNCATE ON public.referral_bonus_transitions
  FOR EACH STATEMENT EXECUTE FUNCTION public.referral_bonus_transitions_guard();

CREATE FUNCTION public.referrals_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_code public.referral_codes%ROWTYPE;
  v_changed text[];
  v_tenant uuid;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'raf_referral_immutable';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A new referral is a recorded claim only: tenant-stamped, through an active code of the same
    -- tenant, crediting that code's referrer, never self-referred, with no bonus decision.
    IF NEW.tenant_id IS NULL OR NEW.referral_code_id IS NULL OR NEW.referred_user_id IS NULL
       OR NEW.bonus_status <> 'none' OR NEW.status NOT IN ('pending', 'signed_up') THEN
      RAISE EXCEPTION 'raf_referral_invalid';
    END IF;
    SELECT * INTO v_code FROM public.referral_codes c WHERE c.id = NEW.referral_code_id FOR SHARE;
    IF NOT FOUND OR v_code.tenant_id IS DISTINCT FROM NEW.tenant_id OR NOT v_code.active
       OR v_code.code IS DISTINCT FROM NEW.code
       OR v_code.referrer_user_id IS DISTINCT FROM NEW.referrer_user_id
       OR NEW.referred_user_id IS NOT DISTINCT FROM v_code.referrer_user_id THEN
      RAISE EXCEPTION 'raf_referral_invalid';
    END IF;
    NEW.created_at := now();
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  SELECT COALESCE(array_agg(n.key), ARRAY[]::text[]) INTO v_changed
  FROM jsonb_each(to_jsonb(NEW)) n JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
  WHERE n.value IS DISTINCT FROM o.value;
  IF cardinality(v_changed) = 0 THEN
    RETURN NEW;
  END IF;

  IF NOT public.raf_b4c1_writer() THEN
    -- Only the auth.users / referral_codes ON DELETE SET NULL actions.
    IF v_changed <@ ARRAY['referrer_user_id', 'referred_user_id', 'referral_code_id']
       AND (NOT ('referrer_user_id' = ANY (v_changed)) OR NEW.referrer_user_id IS NULL)
       AND (NOT ('referred_user_id' = ANY (v_changed)) OR NEW.referred_user_id IS NULL)
       AND (NOT ('referral_code_id' = ANY (v_changed)) OR NEW.referral_code_id IS NULL) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'raf_referral_write_forbidden';
  END IF;

  IF NOT (v_changed <@ ARRAY['bonus_status', 'status', 'updated_at'])
     OR NOT ('bonus_status' = ANY (v_changed)) THEN
    RAISE EXCEPTION 'raf_referral_write_forbidden';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.referral_bonus_transitions t
    WHERE t.referral_id = NEW.id AND t.txid = txid_current()
      AND t.from_status = OLD.bonus_status AND t.to_status = NEW.bonus_status) THEN
    RAISE EXCEPTION 'raf_transition_missing';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.bonus_status = 'none' AND NEW.bonus_status = 'provisional'
        AND OLD.status IN ('pending', 'signed_up') AND NEW.status = 'qualified')
       OR (NEW.bonus_status = 'paid' AND NEW.status = 'rewarded')) THEN
    RAISE EXCEPTION 'raf_referral_write_forbidden';
  END IF;
  IF NEW.bonus_status IN ('completion_verified', 'earned', 'payment_approved', 'paid')
     AND NEW.referred_user_id IS NOT NULL THEN
    v_tenant := public.referral_effective_tenant(NEW.id);
    IF EXISTS (
      SELECT 1 FROM public.referrals o
      LEFT JOIN public.referral_codes oc ON oc.id = o.referral_code_id
      WHERE o.id <> NEW.id AND o.referred_user_id = NEW.referred_user_id
        AND COALESCE(o.tenant_id, oc.tenant_id) IS NOT DISTINCT FROM v_tenant
        AND o.bonus_status IN ('completion_verified', 'earned', 'payment_approved', 'paid')) THEN
      RAISE EXCEPTION 'raf_competing_referral';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER referrals_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.referrals_guard();
CREATE TRIGGER referrals_no_truncate
  BEFORE TRUNCATE ON public.referrals
  FOR EACH STATEMENT EXECUTE FUNCTION public.referrals_guard();

CREATE FUNCTION public.referral_codes_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_changed text[];
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'raf_referral_code_immutable';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Minted by an Owner, Supervisor or General Admin member of the code's tenant, or by a member
    -- for themself; the referrer (if a user) belongs to that tenant.
    IF NEW.tenant_id IS NULL OR NEW.created_by IS NULL THEN
      RAISE EXCEPTION 'raf_referral_code_invalid';
    END IF;
    PERFORM 1 FROM public.tenants t
    WHERE t.id = NEW.tenant_id AND t.status::text = 'active' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'raf_referral_code_invalid';
    END IF;
    IF NOT (
      EXISTS (SELECT 1 FROM public.tenant_memberships m
              WHERE m.user_id = NEW.created_by AND m.tenant_id = NEW.tenant_id AND m.active
                AND m.role::text IN ('owner', 'supervisor', 'general'))
      OR (NEW.referrer_user_id IS NOT NULL AND NEW.created_by = NEW.referrer_user_id
          AND EXISTS (SELECT 1 FROM public.tenant_memberships m
                      WHERE m.user_id = NEW.created_by AND m.tenant_id = NEW.tenant_id
                        AND m.active))) THEN
      RAISE EXCEPTION 'raf_referral_code_forbidden';
    END IF;
    IF NEW.referrer_user_id IS NOT NULL AND NOT (
      EXISTS (SELECT 1 FROM public.tenant_memberships m
              WHERE m.user_id = NEW.referrer_user_id AND m.tenant_id = NEW.tenant_id AND m.active)
      OR EXISTS (SELECT 1 FROM public.interview_sessions s
                 WHERE s.customer_id = NEW.referrer_user_id AND s.tenant_id = NEW.tenant_id)) THEN
      RAISE EXCEPTION 'raf_referral_code_invalid';
    END IF;
    NEW.created_at := now();
    RETURN NEW;
  END IF;

  SELECT COALESCE(array_agg(n.key), ARRAY[]::text[]) INTO v_changed
  FROM jsonb_each(to_jsonb(NEW)) n JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
  WHERE n.value IS DISTINCT FROM o.value;
  IF v_changed <@ ARRAY['active', 'referrer_name', 'referrer_phone', 'referrer_user_id', 'created_by']
     AND (NOT ('referrer_user_id' = ANY (v_changed)) OR NEW.referrer_user_id IS NULL)
     AND (NOT ('created_by' = ANY (v_changed)) OR NEW.created_by IS NULL) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'raf_referral_code_immutable';
END;
$$;

CREATE TRIGGER referral_codes_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.referral_codes
  FOR EACH ROW EXECUTE FUNCTION public.referral_codes_guard();
CREATE TRIGGER referral_codes_no_truncate
  BEFORE TRUNCATE ON public.referral_codes
  FOR EACH STATEMENT EXECUTE FUNCTION public.referral_codes_guard();

-- F. Owner/Supervisor bonus decision. Returns {outcome, bonus_status, transition_id}.
CREATE FUNCTION public.set_referral_bonus_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_referral_id uuid,
  p_expected_status text,
  p_to_status text,
  p_reason text,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_ref public.referrals%ROWTYPE;
  v_prior public.referral_bonus_transitions%ROWTYPE;
  v_last_reason text;
  v_pair text;
  v_transition uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_actor_user_id IS NULL OR p_referral_id IS NULL
     OR p_expected_status IS NULL OR p_to_status IS NULL OR p_request_id IS NULL
     OR char_length(COALESCE(v_reason, '')) > 500 THEN
    RAISE EXCEPTION 'raf_transition_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM set_config('raf.b4c1_writer', 'on', true);
  v_role := public.finance_actor_role(p_tenant_id, p_actor_user_id, 'payout');

  SELECT * INTO v_ref FROM public.referrals r WHERE r.id = p_referral_id;
  IF NOT FOUND OR public.referral_effective_tenant(p_referral_id) IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'raf_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  -- One customer's referrals are decided one at a time (competing-referral rule).
  IF v_ref.referred_user_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'raf_referred:' || p_tenant_id::text || ':' || v_ref.referred_user_id::text, 0));
  END IF;
  SELECT * INTO v_ref FROM public.referrals r WHERE r.id = p_referral_id FOR UPDATE;
  IF NOT FOUND OR public.referral_effective_tenant(p_referral_id) IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'raf_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO v_prior FROM public.referral_bonus_transitions t
  WHERE t.tenant_id = p_tenant_id AND t.request_id = p_request_id;
  IF FOUND THEN
    IF v_prior.referral_id = p_referral_id AND v_prior.from_status = p_expected_status
       AND v_prior.to_status = p_to_status AND v_prior.actor_user_id = p_actor_user_id
       AND v_prior.reason IS NOT DISTINCT FROM v_reason THEN
      RETURN jsonb_build_object('outcome', 'already_applied', 'bonus_status', v_ref.bonus_status,
                                'transition_id', v_prior.id);
    END IF;
    RAISE EXCEPTION 'raf_request_conflict';
  END IF;

  -- Already in the requested status: success only when this request's reason (if any) is the one
  -- recorded for that status, so a reason that was never saved is never reported as applied.
  IF v_ref.bonus_status = p_to_status THEN
    SELECT t.reason INTO v_last_reason FROM public.referral_bonus_transitions t
    WHERE t.referral_id = v_ref.id AND t.to_status = p_to_status
    ORDER BY t.recorded_at DESC, t.txid DESC
    LIMIT 1;
    IF FOUND AND v_reason IS NOT NULL AND v_last_reason IS DISTINCT FROM v_reason THEN
      RAISE EXCEPTION 'raf_status_conflict';
    END IF;
    RETURN jsonb_build_object('outcome', 'already_applied', 'bonus_status', v_ref.bonus_status,
                              'transition_id', NULL);
  END IF;
  IF v_ref.bonus_status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'raf_status_conflict';
  END IF;
  IF v_ref.bonus_status IN ('paid', 'cancelled') THEN
    RAISE EXCEPTION 'raf_bonus_terminal';
  END IF;
  -- Earning needs a verified mortgage completion record (not available before B4c-2). Withdrawing
  -- an approval back to earned is not a new earning.
  IF p_to_status = 'completion_verified'
     OR (p_to_status = 'earned' AND v_ref.bonus_status <> 'payment_approved')
     OR (p_to_status IN ('payment_approved', 'paid')
         AND v_ref.bonus_status NOT IN ('earned', 'payment_approved')) THEN
    RAISE EXCEPTION 'raf_completion_record_required';
  END IF;
  v_pair := v_ref.bonus_status || '>' || p_to_status;
  IF v_pair NOT IN (
      'none>rejected', 'none>cancelled',
      'provisional>rejected', 'provisional>cancelled',
      'eligible>rejected', 'eligible>cancelled',
      'completion_verified>rejected', 'completion_verified>cancelled',
      'earned>payment_approved', 'earned>rejected', 'earned>cancelled',
      'payment_approved>paid', 'payment_approved>earned', 'payment_approved>rejected',
      'payment_approved>cancelled',
      'rejected>none', 'rejected>provisional') THEN
    RAISE EXCEPTION 'raf_transition_invalid';
  END IF;
  -- Reopening returns to provisional only for a referral whose fact-find qualified it, and only
  -- while the programme is in force.
  IF v_pair = 'rejected>provisional' AND (v_ref.status NOT IN ('qualified', 'rewarded')
                                          OR NOT public.raf_programme_configured(p_tenant_id)) THEN
    RAISE EXCEPTION 'raf_programme_not_configured';
  END IF;
  IF v_reason IS NULL AND (p_to_status IN ('rejected', 'cancelled')
                           OR v_ref.bonus_status = 'rejected'
                           OR v_pair = 'payment_approved>earned') THEN
    RAISE EXCEPTION 'raf_reason_required';
  END IF;

  BEGIN
    INSERT INTO public.referral_bonus_transitions (
      tenant_id, referral_id, from_status, to_status, actor_user_id, actor_role, reason,
      evidence_ref, request_id
    )
    VALUES (p_tenant_id, v_ref.id, v_ref.bonus_status, p_to_status, p_actor_user_id, v_role,
            v_reason, jsonb_build_object('kind', 'owner_decision'), p_request_id)
    RETURNING id INTO v_transition;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'raf_request_conflict';
  END;
  UPDATE public.referrals r
  SET bonus_status = p_to_status,
      status = CASE WHEN p_to_status = 'paid' THEN 'rewarded' ELSE r.status END
  WHERE r.id = v_ref.id;
  PERFORM public.network_finance_audit(
    p_tenant_id, p_actor_user_id, v_role, 'raf_bonus_status_changed', NULL,
    v_ref.referred_user_id, NULL, 'Refer a Friend bonus status changed',
    jsonb_build_object('referral_id', v_ref.id, 'transition_id', v_transition,
                       'from', v_ref.bonus_status, 'to', p_to_status, 'reason', v_reason,
                       'request_id', p_request_id, 'referrer_user_id', v_ref.referrer_user_id));
  RETURN jsonb_build_object('outcome', 'applied', 'bonus_status', p_to_status,
                            'transition_id', v_transition);
END;
$$;

-- G. Fact-find submission: provisional qualification only. Returns {outcome, qualified}.
CREATE FUNCTION public.record_referral_provisional_qualification(
  p_tenant_id uuid,
  p_customer_user_id uuid,
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_ref public.referrals%ROWTYPE;
  v_transition uuid;
  v_count integer := 0;
BEGIN
  IF p_tenant_id IS NULL OR p_customer_user_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION 'raf_transition_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM set_config('raf.b4c1_writer', 'on', true);
  PERFORM 1 FROM public.tenants t WHERE t.id = p_tenant_id AND t.status::text = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'tenant_inactive', 'qualified', 0);
  END IF;
  PERFORM 1 FROM public.interview_sessions s
  WHERE s.id = p_session_id AND s.tenant_id = p_tenant_id AND s.customer_id = p_customer_user_id
    AND s.status = 'submitted' AND s.deleted_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'session_not_submitted', 'qualified', 0);
  END IF;
  IF NOT public.raf_programme_configured(p_tenant_id) THEN
    RETURN jsonb_build_object('outcome', 'programme_not_configured', 'qualified', 0);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'raf_referred:' || p_tenant_id::text || ':' || p_customer_user_id::text, 0));
  FOR v_ref IN
    SELECT * FROM public.referrals r
    WHERE r.tenant_id = p_tenant_id AND r.referred_user_id = p_customer_user_id
      AND r.status IN ('pending', 'signed_up') AND r.bonus_status = 'none'
    ORDER BY r.created_at, r.id
    FOR UPDATE
  LOOP
    INSERT INTO public.referral_bonus_transitions (
      tenant_id, referral_id, from_status, to_status, actor_user_id, actor_role, reason,
      evidence_ref, request_id
    )
    VALUES (p_tenant_id, v_ref.id, 'none', 'provisional', p_customer_user_id,
            'fact_find_submission', NULL,
            jsonb_build_object('kind', 'fact_find_submitted', 'session_id', p_session_id),
            gen_random_uuid())
    RETURNING id INTO v_transition;
    UPDATE public.referrals r SET bonus_status = 'provisional', status = 'qualified'
    WHERE r.id = v_ref.id;
    PERFORM public.network_finance_audit(
      p_tenant_id, p_customer_user_id, 'fact_find_submission', 'raf_provisional_qualification',
      p_session_id, p_customer_user_id, NULL, 'Refer a Friend referral provisionally qualified',
      jsonb_build_object('referral_id', v_ref.id, 'transition_id', v_transition,
                         'from', 'none', 'to', 'provisional',
                         'referrer_user_id', v_ref.referrer_user_id));
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('outcome', CASE WHEN v_count = 0 THEN 'no_change' ELSE 'qualified' END,
                            'qualified', v_count);
END;
$$;

-- H. Row-level protections and privileges.
DROP POLICY "Staff manage referral codes" ON public.referral_codes;
CREATE POLICY "Staff read referral codes" ON public.referral_codes
  FOR SELECT TO authenticated USING (public.auth_is_tenant_staff(tenant_id));
ALTER TABLE public.referral_bonus_transitions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.referrals, public.referral_codes, public.referral_bonus_transitions
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.referrals, public.referral_codes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.referrals, public.referral_codes TO service_role;
GRANT SELECT, INSERT ON public.referral_bonus_transitions TO service_role;

REVOKE ALL ON FUNCTION public.referral_bonus_transitions_guard(), public.referrals_guard(),
  public.referral_codes_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.raf_b4c1_writer(),
  public.referral_effective_tenant(uuid),
  public.raf_programme_configured(uuid),
  public.set_referral_bonus_status(uuid, uuid, uuid, text, text, text, uuid),
  public.record_referral_provisional_qualification(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.raf_b4c1_writer(),
  public.referral_effective_tenant(uuid),
  public.raf_programme_configured(uuid),
  public.set_referral_bonus_status(uuid, uuid, uuid, text, text, text, uuid),
  public.record_referral_provisional_qualification(uuid, uuid, uuid)
  TO service_role;

COMMENT ON TABLE public.referral_bonus_transitions IS
  'G7F-4S4C4-B4c-1: append-only Refer a Friend bonus status history; one row per change, written atomically with the referral and finance_audit_log. Legacy statuses are not backfilled.';
COMMENT ON FUNCTION public.set_referral_bonus_status(uuid, uuid, uuid, text, text, text, uuid) IS
  'G7F-4S4C4-B4c-1: Owner/Supervisor Refer a Friend bonus decision (active tenant membership), compare-and-set on the expected status, idempotent by request id. service_role only.';
COMMENT ON FUNCTION public.record_referral_provisional_qualification(uuid, uuid, uuid) IS
  'G7F-4S4C4-B4c-1: provisional qualification of a customer''s tenant referrals from their own submitted fact-find, only while the programme is enabled and a bonus is configured. Never earns a bonus. service_role only.';

-- I. Postconditions.
DO $$
DECLARE
  v_fn record;
BEGIN
  IF (SELECT count(*) FROM pg_trigger t
      WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
        AND t.tgname IN ('referral_bonus_transitions_append_only',
                         'referral_bonus_transitions_no_truncate', 'referrals_guard',
                         'referrals_no_truncate', 'referral_codes_guard',
                         'referral_codes_no_truncate')) <> 6 THEN
    RAISE EXCEPTION 'g7f4s4c4b4c1_postcondition:guard_trigger_missing';
  END IF;
  IF (SELECT string_agg(p.tablename || '/' || p.policyname || '/' || p.cmd, ','
                        ORDER BY p.tablename COLLATE "C")
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename IN ('referrals', 'referral_codes', 'referral_bonus_transitions'))
     IS DISTINCT FROM 'referral_codes/Staff read referral codes/SELECT,referrals/Staff view referrals/SELECT'
     OR NOT (SELECT c.relrowsecurity FROM pg_class c
             WHERE c.oid = 'public.referral_bonus_transitions'::regclass) THEN
    RAISE EXCEPTION 'g7f4s4c4b4c1_postcondition:policies';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('public.referrals'), ('public.referral_codes'),
                 ('public.referral_bonus_transitions')) AS t(rel)
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'),
                       ('TRIGGER')) AS p(priv)
    WHERE has_table_privilege(r.role, t.rel, p.priv)
  ) OR has_table_privilege('anon', 'public.referrals', 'SELECT')
    OR has_table_privilege('anon', 'public.referral_codes', 'SELECT')
    OR has_table_privilege('authenticated', 'public.referral_bonus_transitions', 'SELECT')
    OR has_table_privilege('service_role', 'public.referrals', 'DELETE,TRUNCATE')
    OR has_table_privilege('service_role', 'public.referral_codes', 'DELETE,TRUNCATE')
    OR has_table_privilege('service_role', 'public.referral_bonus_transitions',
                           'UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'g7f4s4c4b4c1_postcondition:privileges';
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
    AND p.proname IN ('raf_b4c1_writer', 'referral_effective_tenant', 'raf_programme_configured',
                      'referral_bonus_transitions_guard', 'referrals_guard',
                      'referral_codes_guard', 'set_referral_bonus_status',
                      'record_referral_provisional_qualification');
  IF v_fn.n IS DISTINCT FROM 8 OR v_fn.invoker IS NOT TRUE OR v_fn.safe_path IS NOT TRUE
     OR v_fn.acl_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'g7f4s4c4b4c1_postcondition:function_privileges';
  END IF;

  IF EXISTS (SELECT 1 FROM public.referral_bonus_transitions)
     OR EXISTS (SELECT 1 FROM public.finance_ledger g
                WHERE g.referral_id IS NOT NULL OR g.beneficiary_role = 'referrer') THEN
    RAISE EXCEPTION 'g7f4s4c4b4c1_postcondition:rows_created';
  END IF;
  CREATE TEMP TABLE g7f4s4c4b4c1_rows_after AS
  SELECT 'referrals'::text AS tbl, to_jsonb(t) AS j FROM public.referrals t
  UNION ALL SELECT 'referral_codes', to_jsonb(t) FROM public.referral_codes t
  UNION ALL SELECT 'finance_settings', to_jsonb(t) FROM public.finance_settings t;
  IF EXISTS (
    (SELECT tbl, j FROM pg_temp.g7f4s4c4b4c1_rows_before
     EXCEPT ALL SELECT tbl, j FROM pg_temp.g7f4s4c4b4c1_rows_after)
    UNION ALL
    (SELECT tbl, j FROM pg_temp.g7f4s4c4b4c1_rows_after
     EXCEPT ALL SELECT tbl, j FROM pg_temp.g7f4s4c4b4c1_rows_before)
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4c1_postcondition:business_data_changed';
  END IF;
  DROP TABLE pg_temp.g7f4s4c4b4c1_rows_after;
END
$$;

-- J.
DROP TABLE pg_temp.g7f4s4c4b4c1_rows_before;
