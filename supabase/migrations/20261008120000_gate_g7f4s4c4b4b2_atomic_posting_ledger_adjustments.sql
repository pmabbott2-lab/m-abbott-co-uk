-- G7F-4S4C4-B4b2 — atomic financial posting, canonical append-only ledger, Owner adjustments,
-- payout transition history and clawbacks.
--
-- * Posting is one server-mediated RPC per session (post_session_fees): exact draft fee-line set,
--   validated source statement, economic date (fee_event_at) required, adviser entitlement from
--   the B4b1 history resolver, introducer attribution from the DB resolver (parity with the
--   TypeScript resolveIntroducerIdForCustomerAtDate), rates from the B4a resolver, all at
--   fee_event_at. Fee event, commission accruals, determinations, exceptions, transitions and audit
--   commit together or not at all.
-- * Each entitled adviser (max 3) earns their own full percentage. Incomplete or unprovable
--   history, more than 3 advisers, or a non-adviser assignee posts the fee with no accrual for
--   that beneficiary and raises an Owner exception (D1/D2). No rate posts the fee and raises a
--   missing_rate exception (D3: Owner event percentage or no commission, with a reason). An
--   explicit 0% records the evidence and accrues nothing.
-- * finance_ledger is the canonical typed ledger: fee_posted, fee_reversed, commission_accrued,
--   commission_reversed, commission_reassigned, clawback, clawback_settled, clawback_written_off.
--   Rows are inserted only by these RPCs, never deleted or amended; only the operational payout /
--   recovery status changes, and only together with an immutable transition row.
-- * Reversal, correction (D4: inherits the reversed fee's economic date and evidence),
--   reassignment, clawback, settlement and exception resolution are Owner-only. Payout status is
--   Owner/Supervisor only (D6); paid and reversed are terminal; rejected may reopen to received
--   with a reason (D5). A commission on a reversed fee is frozen.
-- * A correction never revives a beneficiary's earlier outcome: a rejected, reassigned or Owner
--   clawed-back commission (or an earlier hold or Owner decline) on any fee it corrects raises a
--   prior_commission_held exception; only the Owner reinstates it (rate and entitlement rules at
--   the economic date) or declines it, with a reason.
-- * RAF has no authoritative economic date until B4c: every accrual must be dated, so no RAF
--   ledger accrual is created; referrals.bonus_status remains the non-ledger RAF record.
-- * Preconditions refuse any existing ledger row or posted/amended fee line: legacy financial
--   records are never classified or fabricated here (production analysis is a later gate).
--
-- Single transaction, forward-only. Every precondition fails closed before any change.

-- A. Locks.
LOCK TABLE public.finance_ledger, public.finance_fee_lines, public.finance_audit_log
  IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.interview_sessions, public.tenant_memberships, public.tenants,
  public.network_commission_statements, public.network_commission_lines, public.introducers,
  public.customer_introducer_links, public.introducer_amendment_history,
  public.commission_rate_versions, public.session_adviser_assignments, public.referrals,
  public.admin_permissions IN SHARE MODE;

-- B. Preconditions.
DO $$
DECLARE
  v_con record;
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'g7f4s4c4b4b2_precondition:server_version';
  END IF;
  IF to_regprocedure('public.resolve_session_advisers_as_of(uuid, uuid, timestamptz)') IS NULL
     OR to_regprocedure('public.resolve_commission_rate_as_of(uuid, text, uuid, uuid, text, timestamptz)') IS NULL
     OR to_regprocedure('public.network_finance_audit(uuid, uuid, text, text, uuid, uuid, text, text, jsonb)') IS NULL
     OR to_regprocedure('public.finance_fee_lines_guard()') IS NULL
     OR to_regclass('public.session_adviser_history_capture') IS NULL THEN
    RAISE EXCEPTION 'g7f4s4c4b4b2_precondition:b4b1_b4a_missing';
  END IF;

  IF (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod)
                        || CASE WHEN a.attnotnull THEN ':nn' ELSE '' END, ',' ORDER BY a.attnum)
      FROM pg_attribute a
      WHERE a.attrelid = 'public.finance_ledger'::regclass AND a.attnum > 0 AND NOT a.attisdropped)
     IS DISTINCT FROM
     'id:uuid:nn,session_id:uuid,fee_line_id:uuid,kind:finance_ledger_kind:nn,fee_type:text,amount_pence:integer:nn,is_reversal:boolean:nn,note:text,beneficiary_user_id:uuid,beneficiary_role:text,commission_pct:numeric(6,3),created_by:uuid,created_at:timestamp with time zone:nn,payout_status:text,payout_at:timestamp with time zone,payout_by:uuid,payout_note:text,referral_id:uuid,lost_reason:text,tenant_id:uuid' THEN
    RAISE EXCEPTION 'g7f4s4c4b4b2_precondition:column_signature:finance_ledger';
  END IF;
  -- The ledger keys this migration replaces are exactly the staging keys.
  FOR v_con IN
    SELECT * FROM (VALUES
      ('finance_ledger_beneficiary_user_id_fkey',
       'FOREIGN KEY (beneficiary_user_id) REFERENCES auth.users(id) ON DELETE SET NULL'),
      ('finance_ledger_created_by_fkey',
       'FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL'),
      ('finance_ledger_fee_line_id_fkey',
       'FOREIGN KEY (fee_line_id) REFERENCES finance_fee_lines(id) ON DELETE SET NULL'),
      ('finance_ledger_payout_by_fkey',
       'FOREIGN KEY (payout_by) REFERENCES auth.users(id) ON DELETE SET NULL'),
      ('finance_ledger_referral_id_fkey',
       'FOREIGN KEY (referral_id) REFERENCES referrals(id) ON DELETE SET NULL'),
      ('finance_ledger_session_id_fkey',
       'FOREIGN KEY (session_id) REFERENCES interview_sessions(id) ON DELETE SET NULL'),
      ('finance_ledger_tenant_id_fkey', 'FOREIGN KEY (tenant_id) REFERENCES tenants(id)')
    ) AS e(name, def)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = 'public.finance_ledger'::regclass AND c.conname = v_con.name
        AND replace(pg_get_constraintdef(c.oid), 'REFERENCES public.', 'REFERENCES ') = v_con.def
    ) THEN
      RAISE EXCEPTION 'g7f4s4c4b4b2_precondition:key_shape:%', v_con.name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_constraint c
      WHERE c.conrelid = 'public.finance_ledger'::regclass AND c.contype = 'f') <> 7 THEN
    RAISE EXCEPTION 'g7f4s4c4b4b2_precondition:key_shape:unexpected_ledger_key';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = 'public.finance_fee_lines'::regclass AND NOT a.attisdropped
               AND a.attname IN ('corrects_fee_line_id', 'reversed_at', 'reversed_by',
                                 'reversal_reason'))
     OR NOT EXISTS (SELECT 1 FROM pg_constraint c
                    WHERE c.conrelid = 'public.finance_fee_lines'::regclass
                      AND c.conname = 'finance_fee_lines_fee_event_check')
     OR to_regclass('public.finance_payout_transitions') IS NOT NULL
     OR to_regclass('public.finance_commission_exceptions') IS NOT NULL
     OR to_regclass('public.finance_commission_determinations') IS NOT NULL THEN
    RAISE EXCEPTION 'g7f4s4c4b4b2_precondition:objects_present';
  END IF;
  IF (SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e
      WHERE e.enumtypid = 'public.finance_line_status'::regtype)
       IS DISTINCT FROM 'draft,posted,amended,deleted'
     OR (SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_enum e
         WHERE e.enumtypid = 'public.finance_ledger_kind'::regtype)
       IS DISTINCT FROM 'post,amend,delete,commission' THEN
    RAISE EXCEPTION 'g7f4s4c4b4b2_precondition:finance_enums';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal
             AND t.tgrelid IN ('public.finance_ledger'::regclass,
                               'public.finance_audit_log'::regclass)) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b2_precondition:unexpected_trigger';
  END IF;

  -- No legacy financial record is classified, rewritten or fabricated by this migration.
  IF EXISTS (SELECT 1 FROM public.finance_ledger) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b2_precondition:ledger_not_empty';
  END IF;
  IF EXISTS (SELECT 1 FROM public.finance_fee_lines f
             WHERE f.status::text IN ('posted', 'amended') OR f.posted_at IS NOT NULL
               OR f.batch_id IS NOT NULL) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b2_precondition:posted_fee_present';
  END IF;
  IF EXISTS (SELECT 1 FROM public.finance_audit_log a WHERE a.tenant_id IS NULL
             AND a.audit_type IN ('fee_posted', 'fee_reversed', 'commission_accrued')) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b2_precondition:audit_inconsistent';
  END IF;
END
$$;

CREATE TEMP TABLE g7f4s4c4b4b2_rows_before AS
SELECT 'finance_fee_lines'::text AS tbl, to_jsonb(t) AS j FROM public.finance_fee_lines t
UNION ALL SELECT 'finance_audit_log', to_jsonb(t) FROM public.finance_audit_log t
UNION ALL SELECT 'network_commission_statements', to_jsonb(t)
  FROM public.network_commission_statements t
UNION ALL SELECT 'network_commission_lines', to_jsonb(t) FROM public.network_commission_lines t
UNION ALL SELECT 'session_adviser_assignments', to_jsonb(t)
  FROM public.session_adviser_assignments t
UNION ALL SELECT 'commission_rate_versions', to_jsonb(t) FROM public.commission_rate_versions t
UNION ALL SELECT 'referrals', to_jsonb(t) FROM public.referrals t;

-- C. Fee lines: Owner correction provenance (D4) and reversal provenance.
ALTER TABLE public.finance_fee_lines
  ADD COLUMN corrects_fee_line_id uuid,
  ADD COLUMN reversed_at timestamptz,
  ADD COLUMN reversed_by uuid,
  ADD COLUMN reversal_reason text;
ALTER TABLE public.finance_fee_lines
  ADD CONSTRAINT finance_fee_lines_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE public.finance_fee_lines
  ADD CONSTRAINT finance_fee_lines_corrects_tenant_fkey FOREIGN KEY (corrects_fee_line_id, tenant_id)
    REFERENCES public.finance_fee_lines (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT finance_fee_lines_reversed_by_fkey FOREIGN KEY (reversed_by)
    REFERENCES auth.users (id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE public.finance_fee_lines DROP CONSTRAINT finance_fee_lines_fee_event_check;
ALTER TABLE public.finance_fee_lines
  ADD CONSTRAINT finance_fee_lines_fee_event_check CHECK (COALESCE(
    (fee_event_date IS NULL AND fee_event_at IS NULL AND fee_event_source IS NULL
      AND fee_event_evidence IS NULL)
    OR (fee_event_date IS NOT NULL AND source_network_line_id IS NOT NULL
      AND corrects_fee_line_id IS NULL
      AND fee_event_source IN ('network_line_transaction_date', 'network_statement_received_date')
      AND fee_event_at = (fee_event_date::timestamp AT TIME ZONE 'Europe/London')
      AND jsonb_typeof(fee_event_evidence) = 'object')
    OR (fee_event_date IS NOT NULL AND source_network_line_id IS NULL
      AND corrects_fee_line_id IS NOT NULL AND fee_event_source = 'owner_correction'
      AND fee_event_at = (fee_event_date::timestamp AT TIME ZONE 'Europe/London')
      AND jsonb_typeof(fee_event_evidence) = 'object'), false)
  ),
  ADD CONSTRAINT finance_fee_lines_source_check CHECK (
    num_nonnulls(source_network_line_id, corrects_fee_line_id) <= 1
  ),
  ADD CONSTRAINT finance_fee_lines_posted_check CHECK (COALESCE(
    status::text NOT IN ('posted', 'amended')
    OR (posted_at IS NOT NULL AND batch_id IS NOT NULL AND fee_event_at IS NOT NULL), false)
  ),
  ADD CONSTRAINT finance_fee_lines_reversal_check CHECK (COALESCE(
    (status::text <> 'amended' AND reversed_at IS NULL AND reversed_by IS NULL
      AND reversal_reason IS NULL)
    OR (status::text = 'amended' AND reversed_at IS NOT NULL AND reversed_by IS NOT NULL
      AND char_length(btrim(COALESCE(reversal_reason, ''))) BETWEEN 1 AND 500), false)
  );
CREATE UNIQUE INDEX finance_fee_lines_one_correction_key
  ON public.finance_fee_lines (corrects_fee_line_id) WHERE corrects_fee_line_id IS NOT NULL;
COMMENT ON COLUMN public.finance_fee_lines.corrects_fee_line_id IS
  'G7F-4S4C4-B4b2: an Owner correction fee event replacing this reversed fee line. Inherits the reversed line''s economic date and evidence.';

-- D. Canonical ledger.
ALTER TABLE public.finance_ledger
  DROP CONSTRAINT finance_ledger_beneficiary_user_id_fkey,
  DROP CONSTRAINT finance_ledger_created_by_fkey,
  DROP CONSTRAINT finance_ledger_fee_line_id_fkey,
  DROP CONSTRAINT finance_ledger_payout_by_fkey,
  DROP CONSTRAINT finance_ledger_referral_id_fkey,
  DROP CONSTRAINT finance_ledger_session_id_fkey;
ALTER TABLE public.finance_ledger ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.finance_ledger ALTER COLUMN payout_status DROP DEFAULT;
ALTER TABLE public.finance_ledger
  ADD COLUMN event_type text NOT NULL,
  ADD COLUMN idempotency_key text NOT NULL,
  ADD COLUMN customer_id uuid,
  ADD COLUMN economic_date date,
  ADD COLUMN economic_at timestamptz,
  ADD COLUMN beneficiary_capacity text,
  ADD COLUMN introducer_id uuid,
  ADD COLUMN beneficiary_name text,
  ADD COLUMN beneficiary_code text,
  ADD COLUMN commission_basis_pence integer,
  ADD COLUMN rate_source text,
  ADD COLUMN rate_version_id uuid,
  ADD COLUMN original_event_id uuid,
  ADD COLUMN exception_id uuid,
  ADD COLUMN reason text,
  ADD COLUMN actor_role text,
  ADD COLUMN evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN recovery_status text,
  ADD COLUMN recovery_at timestamptz,
  ADD COLUMN recovery_by uuid;

-- E. Owner exceptions and per-beneficiary determinations.
CREATE TABLE public.finance_commission_exceptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  session_id uuid NOT NULL,
  fee_line_id uuid NOT NULL,
  fee_event_id uuid NOT NULL,
  exception_kind text NOT NULL,
  beneficiary_role text NOT NULL,
  beneficiary_user_id uuid,
  introducer_id uuid,
  beneficiary_capacity text,
  fee_type text NOT NULL,
  commission_basis_pence integer NOT NULL,
  economic_date date NOT NULL,
  economic_at timestamptz NOT NULL,
  evidence jsonb NOT NULL,
  parent_exception_id uuid,
  status text NOT NULL DEFAULT 'open',
  resolution text,
  resolution_pct numeric(6,3),
  resolution_adviser_ids uuid[],
  resolution_reason text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_commission_exceptions_pkey PRIMARY KEY (id),
  CONSTRAINT finance_commission_exceptions_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT finance_commission_exceptions_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT finance_commission_exceptions_session_tenant_fkey FOREIGN KEY (session_id, tenant_id)
    REFERENCES public.interview_sessions (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT finance_commission_exceptions_fee_tenant_fkey FOREIGN KEY (fee_line_id, tenant_id)
    REFERENCES public.finance_fee_lines (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT finance_commission_exceptions_introducer_tenant_fkey
    FOREIGN KEY (introducer_id, tenant_id)
    REFERENCES public.introducers (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT finance_commission_exceptions_parent_tenant_fkey
    FOREIGN KEY (parent_exception_id, tenant_id)
    REFERENCES public.finance_commission_exceptions (id, tenant_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT finance_commission_exceptions_user_fkey FOREIGN KEY (beneficiary_user_id)
    REFERENCES auth.users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT finance_commission_exceptions_kind_check CHECK (exception_kind IN
    ('missing_rate', 'adviser_capacity_unrated', 'adviser_entitlement_unproven',
     'prior_commission_held')),
  CONSTRAINT finance_commission_exceptions_role_check
    CHECK (beneficiary_role IN ('advisor', 'introducer')),
  CONSTRAINT finance_commission_exceptions_shape_check CHECK (COALESCE(
    (exception_kind = 'adviser_entitlement_unproven' AND beneficiary_role = 'advisor'
      AND beneficiary_user_id IS NULL AND introducer_id IS NULL)
    OR (exception_kind = 'adviser_capacity_unrated' AND beneficiary_role = 'advisor'
      AND beneficiary_user_id IS NOT NULL AND introducer_id IS NULL
      AND beneficiary_capacity IN ('owner', 'supervisor', 'general'))
    OR (exception_kind = 'missing_rate' AND beneficiary_user_id IS NOT NULL
      AND ((beneficiary_role = 'advisor' AND introducer_id IS NULL
            AND beneficiary_capacity = 'adviser')
        OR (beneficiary_role = 'introducer' AND introducer_id IS NOT NULL)))
    OR (exception_kind = 'prior_commission_held' AND beneficiary_user_id IS NOT NULL
      AND ((beneficiary_role = 'advisor' AND introducer_id IS NULL
            AND beneficiary_capacity IS NOT NULL)
        OR (beneficiary_role = 'introducer' AND introducer_id IS NOT NULL))), false)
  ),
  CONSTRAINT finance_commission_exceptions_status_check CHECK (COALESCE(
    (status = 'open' AND resolution IS NULL AND resolution_pct IS NULL
      AND resolution_adviser_ids IS NULL AND resolution_reason IS NULL AND resolved_by IS NULL
      AND resolved_at IS NULL)
    OR (status = 'resolved' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL
      AND char_length(btrim(COALESCE(resolution_reason, ''))) BETWEEN 1 AND 500
      AND ((resolution = 'event_pct' AND resolution_pct > 0 AND resolution_pct <= 100
            AND exception_kind IN ('missing_rate', 'adviser_capacity_unrated'))
        OR (resolution = 'no_commission' AND resolution_pct IS NULL
            AND exception_kind IN ('missing_rate', 'adviser_capacity_unrated',
                                   'prior_commission_held'))
        OR (resolution = 'reinstate' AND resolution_pct IS NULL
            AND resolution_adviser_ids IS NULL AND exception_kind = 'prior_commission_held')
        OR (resolution = 'advisers_determined' AND resolution_pct IS NULL
            AND exception_kind = 'adviser_entitlement_unproven'
            AND resolution_adviser_ids IS NOT NULL
            AND COALESCE(cardinality(resolution_adviser_ids), 0) <= 3)
        OR (resolution = 'fee_reversed' AND resolution_pct IS NULL))), false)
  ),
  CONSTRAINT finance_commission_exceptions_amount_check CHECK (commission_basis_pence > 0)
);
CREATE UNIQUE INDEX finance_commission_exceptions_subject_key
  ON public.finance_commission_exceptions (tenant_id, fee_event_id, exception_kind,
    COALESCE(introducer_id, beneficiary_user_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX finance_commission_exceptions_open_idx
  ON public.finance_commission_exceptions (tenant_id, status, created_at);
COMMENT ON TABLE public.finance_commission_exceptions IS
  'G7F-4S4C4-B4b2: durable unresolved commission evidence (missing rate, non-adviser assignee, unprovable adviser entitlement) awaiting an Owner determination. Resolved once; never deleted.';

CREATE TABLE public.finance_commission_determinations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  fee_line_id uuid NOT NULL,
  fee_event_id uuid NOT NULL,
  beneficiary_role text NOT NULL,
  beneficiary_user_id uuid,
  introducer_id uuid,
  beneficiary_capacity text,
  outcome text NOT NULL,
  rate_source text,
  rate_version_id uuid,
  commission_pct numeric(6,3),
  commission_basis_pence integer NOT NULL,
  amount_pence integer,
  ledger_event_id uuid,
  exception_id uuid,
  source_exception_id uuid,
  source_event_id uuid,
  evidence jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_commission_determinations_pkey PRIMARY KEY (id),
  CONSTRAINT finance_commission_determinations_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT finance_commission_determinations_fee_tenant_fkey FOREIGN KEY (fee_line_id, tenant_id)
    REFERENCES public.finance_fee_lines (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT finance_commission_determinations_introducer_tenant_fkey
    FOREIGN KEY (introducer_id, tenant_id)
    REFERENCES public.introducers (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT finance_commission_determinations_exception_tenant_fkey
    FOREIGN KEY (exception_id, tenant_id)
    REFERENCES public.finance_commission_exceptions (id, tenant_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT finance_commission_determinations_source_exception_tenant_fkey
    FOREIGN KEY (source_exception_id, tenant_id)
    REFERENCES public.finance_commission_exceptions (id, tenant_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT finance_commission_determinations_rate_fkey FOREIGN KEY (rate_version_id)
    REFERENCES public.commission_rate_versions (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT finance_commission_determinations_role_check
    CHECK (beneficiary_role IN ('advisor', 'introducer')),
  CONSTRAINT finance_commission_determinations_outcome_check CHECK (outcome IN
    ('accrued', 'explicit_zero', 'rounded_to_zero', 'exception', 'not_eligible_fee_type',
     'no_adviser_assigned', 'no_introducer_attributed', 'owner_no_commission')),
  CONSTRAINT finance_commission_determinations_shape_check CHECK (COALESCE(
    (outcome = 'accrued') = (ledger_event_id IS NOT NULL)
    AND (outcome = 'exception') = (exception_id IS NOT NULL)
    AND (outcome NOT IN ('accrued', 'explicit_zero', 'rounded_to_zero')
         OR (commission_pct IS NOT NULL AND rate_source IS NOT NULL AND amount_pence IS NOT NULL))
    AND (rate_source IS NULL OR rate_source IN ('rate_version', 'owner_event_pct'))
    AND ((COALESCE(rate_source, '') = 'rate_version') = (rate_version_id IS NOT NULL)), false)
  )
);
CREATE UNIQUE INDEX finance_commission_determinations_subject_key
  ON public.finance_commission_determinations (tenant_id, fee_event_id, beneficiary_role,
    COALESCE(introducer_id, beneficiary_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(source_exception_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(source_event_id, '00000000-0000-0000-0000-000000000000'::uuid));
COMMENT ON TABLE public.finance_commission_determinations IS
  'G7F-4S4C4-B4b2: append-only evidence of every commission decision per fee event and beneficiary (accrued, explicit 0%, rounded to zero, exception, ineligible fee type, nobody assigned/attributed, Owner no commission).';

-- F. Payout and recovery transition history.
CREATE TABLE public.finance_payout_transitions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  ledger_event_id uuid NOT NULL,
  transition_kind text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_user_id uuid NOT NULL,
  actor_role text NOT NULL,
  reason text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  txid bigint NOT NULL DEFAULT txid_current(),
  CONSTRAINT finance_payout_transitions_pkey PRIMARY KEY (id),
  CONSTRAINT finance_payout_transitions_tenant_fkey FOREIGN KEY (tenant_id)
    REFERENCES public.tenants (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT finance_payout_transitions_kind_check
    CHECK (transition_kind IN ('payout', 'recovery')),
  CONSTRAINT finance_payout_transitions_pair_check CHECK (COALESCE(
    (transition_kind = 'payout' AND COALESCE(from_status, '-') || '>' || to_status IN
      ('->received', 'received>paid', 'received>rejected', 'rejected>received',
       'received>reversed'))
    OR (transition_kind = 'recovery' AND COALESCE(from_status, '-') || '>' || to_status IN
      ('->due', 'due>settled', 'due>written_off')), false)
  ),
  CONSTRAINT finance_payout_transitions_reason_check CHECK (
    reason IS NULL OR char_length(reason) BETWEEN 1 AND 500
  ),
  CONSTRAINT finance_payout_transitions_reopen_reason_check CHECK (COALESCE(
    COALESCE(from_status, '-') || '>' || to_status <> 'rejected>received'
    OR char_length(btrim(COALESCE(reason, ''))) BETWEEN 1 AND 500, false)
  )
);
CREATE INDEX finance_payout_transitions_event_idx
  ON public.finance_payout_transitions (tenant_id, ledger_event_id, recorded_at);
COMMENT ON TABLE public.finance_payout_transitions IS
  'G7F-4S4C4-B4b2: immutable history of every payout status (received, paid, rejected, reversed) and clawback recovery (due, settled, written_off) change. Paid and reversed are terminal.';

-- G. Ledger keys, shapes and indexes.
ALTER TABLE public.finance_ledger
  ADD CONSTRAINT finance_ledger_id_tenant_key UNIQUE (id, tenant_id),
  ADD CONSTRAINT finance_ledger_idempotency_key UNIQUE (tenant_id, idempotency_key);
ALTER TABLE public.finance_ledger
  ADD CONSTRAINT finance_ledger_session_tenant_fkey FOREIGN KEY (session_id, tenant_id)
    REFERENCES public.interview_sessions (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT finance_ledger_fee_tenant_fkey FOREIGN KEY (fee_line_id, tenant_id)
    REFERENCES public.finance_fee_lines (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT finance_ledger_introducer_tenant_fkey FOREIGN KEY (introducer_id, tenant_id)
    REFERENCES public.introducers (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT finance_ledger_original_tenant_fkey FOREIGN KEY (original_event_id, tenant_id)
    REFERENCES public.finance_ledger (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT finance_ledger_exception_tenant_fkey FOREIGN KEY (exception_id, tenant_id)
    REFERENCES public.finance_commission_exceptions (id, tenant_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT finance_ledger_rate_version_fkey FOREIGN KEY (rate_version_id)
    REFERENCES public.commission_rate_versions (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT finance_ledger_referral_fkey FOREIGN KEY (referral_id)
    REFERENCES public.referrals (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT finance_ledger_beneficiary_fkey FOREIGN KEY (beneficiary_user_id)
    REFERENCES auth.users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT finance_ledger_created_by_fkey FOREIGN KEY (created_by)
    REFERENCES auth.users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT finance_ledger_payout_by_fkey FOREIGN KEY (payout_by)
    REFERENCES auth.users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT finance_ledger_recovery_by_fkey FOREIGN KEY (recovery_by)
    REFERENCES auth.users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT finance_ledger_event_type_check CHECK (event_type IN
    ('fee_posted', 'fee_reversed', 'commission_accrued', 'commission_reversed',
     'commission_reassigned', 'clawback', 'clawback_settled', 'clawback_written_off')),
  ADD CONSTRAINT finance_ledger_common_check CHECK (COALESCE(
    created_by IS NOT NULL AND actor_role IS NOT NULL AND jsonb_typeof(evidence) = 'object'
    AND kind::text IN ('post', 'commission')
    AND (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 500)
    AND ((economic_date IS NULL AND economic_at IS NULL)
      OR (economic_date IS NOT NULL
          AND economic_at = (economic_date::timestamp AT TIME ZONE 'Europe/London')))
    AND (recovery_status IS NULL) = (event_type <> 'clawback'), false)
  ),
  ADD CONSTRAINT finance_ledger_fee_event_check CHECK (COALESCE(
    event_type NOT IN ('fee_posted', 'fee_reversed')
    OR (kind::text = 'post' AND fee_line_id IS NOT NULL AND session_id IS NOT NULL
      AND customer_id IS NOT NULL AND fee_type IS NOT NULL AND economic_at IS NOT NULL
      AND beneficiary_user_id IS NULL AND beneficiary_role IS NULL AND commission_pct IS NULL
      AND payout_status IS NULL AND referral_id IS NULL AND rate_version_id IS NULL
      AND ((event_type = 'fee_posted' AND amount_pence > 0 AND NOT is_reversal
            AND original_event_id IS NULL)
        OR (event_type = 'fee_reversed' AND amount_pence < 0 AND is_reversal
            AND original_event_id IS NOT NULL AND reason IS NOT NULL))), false)
  ),
  ADD CONSTRAINT finance_ledger_accrual_check CHECK (COALESCE(
    event_type <> 'commission_accrued'
    OR (kind::text = 'commission' AND amount_pence > 0 AND NOT is_reversal
      AND payout_status IS NOT NULL
      AND payout_status IN ('received', 'paid', 'rejected', 'reversed')
      AND ((payout_status = 'received') = (payout_at IS NULL))
      AND beneficiary_role IS NOT NULL AND economic_at IS NOT NULL
      AND ((beneficiary_role IN ('advisor', 'introducer') AND fee_line_id IS NOT NULL
            AND session_id IS NOT NULL AND customer_id IS NOT NULL AND fee_type IS NOT NULL
            AND beneficiary_user_id IS NOT NULL AND economic_at IS NOT NULL
            AND commission_pct IS NOT NULL AND commission_pct > 0
            AND commission_basis_pence IS NOT NULL AND commission_basis_pence > 0
            AND referral_id IS NULL AND rate_source IS NOT NULL
            AND rate_source IN ('rate_version', 'owner_event_pct')
            AND ((rate_source = 'rate_version') = (rate_version_id IS NOT NULL))
            AND ((rate_source = 'owner_event_pct') = (exception_id IS NOT NULL))
            AND ((beneficiary_role = 'introducer') = (introducer_id IS NOT NULL))
            AND (beneficiary_role <> 'advisor' OR beneficiary_capacity IS NOT NULL))
        OR (beneficiary_role = 'referrer' AND referral_id IS NOT NULL AND fee_line_id IS NULL
            AND rate_version_id IS NULL AND introducer_id IS NULL AND original_event_id IS NULL
            AND exception_id IS NULL
            AND (beneficiary_user_id IS NOT NULL OR beneficiary_name IS NOT NULL)))), false)
  ),
  ADD CONSTRAINT finance_ledger_cancellation_check CHECK (COALESCE(
    event_type NOT IN ('commission_reversed', 'commission_reassigned', 'clawback')
    OR (kind::text = 'commission' AND amount_pence < 0 AND is_reversal
      AND original_event_id IS NOT NULL AND reason IS NOT NULL AND payout_status IS NULL
      AND (event_type <> 'clawback'
        OR (recovery_status IN ('due', 'settled', 'written_off')
            AND ((recovery_status = 'due') = (recovery_at IS NULL))))), false)
  ),
  ADD CONSTRAINT finance_ledger_recovery_event_check CHECK (COALESCE(
    event_type NOT IN ('clawback_settled', 'clawback_written_off')
    OR (kind::text = 'commission' AND amount_pence = 0 AND NOT is_reversal
      AND original_event_id IS NOT NULL AND reason IS NOT NULL AND payout_status IS NULL), false)
  ),
  ADD CONSTRAINT finance_ledger_beneficiary_role_check CHECK (
    beneficiary_role IS NULL OR beneficiary_role IN ('advisor', 'introducer', 'referrer')
  );
CREATE UNIQUE INDEX finance_ledger_fee_posted_key
  ON public.finance_ledger (tenant_id, fee_line_id) WHERE event_type = 'fee_posted';
CREATE UNIQUE INDEX finance_ledger_fee_reversed_key
  ON public.finance_ledger (tenant_id, original_event_id) WHERE event_type = 'fee_reversed';
CREATE UNIQUE INDEX finance_ledger_accrual_key
  ON public.finance_ledger (tenant_id, fee_line_id, beneficiary_role, beneficiary_user_id)
  WHERE event_type = 'commission_accrued' AND fee_line_id IS NOT NULL;
CREATE UNIQUE INDEX finance_ledger_raf_accrual_key
  ON public.finance_ledger (tenant_id, referral_id)
  WHERE event_type = 'commission_accrued' AND referral_id IS NOT NULL;
CREATE UNIQUE INDEX finance_ledger_cancellation_key
  ON public.finance_ledger (tenant_id, original_event_id)
  WHERE event_type IN ('commission_reversed', 'commission_reassigned', 'clawback');
CREATE UNIQUE INDEX finance_ledger_recovery_key
  ON public.finance_ledger (tenant_id, original_event_id)
  WHERE event_type IN ('clawback_settled', 'clawback_written_off');
CREATE INDEX finance_ledger_session_idx ON public.finance_ledger (tenant_id, session_id);
CREATE INDEX finance_ledger_beneficiary_idx
  ON public.finance_ledger (tenant_id, beneficiary_user_id, event_type);
ALTER TABLE public.finance_payout_transitions
  ADD CONSTRAINT finance_payout_transitions_event_tenant_fkey
    FOREIGN KEY (ledger_event_id, tenant_id)
    REFERENCES public.finance_ledger (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT finance_payout_transitions_actor_fkey FOREIGN KEY (actor_user_id)
    REFERENCES auth.users (id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE public.finance_commission_exceptions
  ADD CONSTRAINT finance_commission_exceptions_event_tenant_fkey
    FOREIGN KEY (fee_event_id, tenant_id)
    REFERENCES public.finance_ledger (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE public.finance_commission_determinations
  ADD CONSTRAINT finance_commission_determinations_event_tenant_fkey
    FOREIGN KEY (fee_event_id, tenant_id)
    REFERENCES public.finance_ledger (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT finance_commission_determinations_ledger_tenant_fkey
    FOREIGN KEY (ledger_event_id, tenant_id)
    REFERENCES public.finance_ledger (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT finance_commission_determinations_source_event_tenant_fkey
    FOREIGN KEY (source_event_id, tenant_id)
    REFERENCES public.finance_ledger (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
COMMENT ON TABLE public.finance_ledger IS
  'G7F-4S4C4-B4b2: canonical append-only typed financial ledger. Inserted only by the posting / adjustment RPCs; never deleted or amended; payout and recovery status change only with an immutable transition row.';

-- H. Guards.
-- Writes to the canonical finance tables are refused unless a B4b2 RPC set the writer marker
-- in this transaction; the row-level checks below still apply to every write.
CREATE FUNCTION public.finance_b4b2_writer()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(current_setting('finance.b4b2_writer', true), '') = 'on';
$$;

CREATE FUNCTION public.finance_ledger_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_changed text[];
  v_fee public.finance_fee_lines%ROWTYPE;
  v_fp public.finance_ledger%ROWTYPE;
  v_orig public.finance_ledger%ROWTYPE;
  v_rate public.commission_rate_versions%ROWTYPE;
  v_customer uuid;
  v_exc public.finance_commission_exceptions%ROWTYPE;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'finance_ledger_immutable';
  END IF;
  IF NOT public.finance_b4b2_writer() THEN
    RAISE EXCEPTION 'finance_ledger_write_forbidden';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(array_agg(n.key), ARRAY[]::text[]) INTO v_changed
    FROM jsonb_each(to_jsonb(NEW)) n JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
    WHERE n.value IS DISTINCT FROM o.value;
    IF OLD.event_type = 'commission_accrued'
       AND v_changed <@ ARRAY['payout_status', 'payout_at', 'payout_by', 'payout_note']
       AND 'payout_status' = ANY (v_changed)
       AND EXISTS (SELECT 1 FROM public.finance_payout_transitions t
                   WHERE t.ledger_event_id = OLD.id AND t.tenant_id = OLD.tenant_id
                     AND t.transition_kind = 'payout' AND t.from_status = OLD.payout_status
                     AND t.to_status = NEW.payout_status AND t.txid = txid_current()) THEN
      RETURN NEW;
    END IF;
    IF OLD.event_type = 'clawback'
       AND v_changed <@ ARRAY['recovery_status', 'recovery_at', 'recovery_by']
       AND 'recovery_status' = ANY (v_changed)
       AND EXISTS (SELECT 1 FROM public.finance_payout_transitions t
                   WHERE t.ledger_event_id = OLD.id AND t.tenant_id = OLD.tenant_id
                     AND t.transition_kind = 'recovery' AND t.from_status = OLD.recovery_status
                     AND t.to_status = NEW.recovery_status AND t.txid = txid_current()) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'finance_ledger_immutable';
  END IF;

  NEW.created_at := now();
  IF NEW.event_type IN ('fee_posted', 'fee_reversed', 'commission_accrued') AND NEW.fee_line_id IS NOT NULL THEN
    SELECT * INTO v_fee FROM public.finance_fee_lines f
    WHERE f.id = NEW.fee_line_id AND f.tenant_id = NEW.tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'finance_ledger_link_invalid';
    END IF;
  END IF;

  IF NEW.event_type = 'fee_posted' THEN
    SELECT s.customer_id INTO v_customer FROM public.interview_sessions s
    WHERE s.id = v_fee.session_id AND s.tenant_id = NEW.tenant_id;
    IF v_fee.status::text <> 'draft' OR v_fee.fee_event_at IS NULL
       OR NEW.session_id IS DISTINCT FROM v_fee.session_id
       OR NEW.amount_pence IS DISTINCT FROM v_fee.amount_pence
       OR NEW.fee_type IS DISTINCT FROM v_fee.fee_type::text
       OR NEW.economic_date IS DISTINCT FROM v_fee.fee_event_date
       OR NEW.economic_at IS DISTINCT FROM v_fee.fee_event_at
       OR v_customer IS NULL OR NEW.customer_id IS DISTINCT FROM v_customer THEN
      RAISE EXCEPTION 'finance_ledger_link_invalid';
    END IF;
    NEW.idempotency_key := 'fee_posted:' || NEW.fee_line_id::text;
    RETURN NEW;
  END IF;

  IF NEW.event_type = 'fee_reversed' THEN
    SELECT * INTO v_orig FROM public.finance_ledger g
    WHERE g.id = NEW.original_event_id AND g.tenant_id = NEW.tenant_id;
    IF NOT FOUND OR v_orig.event_type <> 'fee_posted' OR v_fee.status::text <> 'posted'
       OR v_orig.fee_line_id IS DISTINCT FROM NEW.fee_line_id
       OR NEW.amount_pence IS DISTINCT FROM -v_orig.amount_pence
       OR NEW.session_id IS DISTINCT FROM v_orig.session_id
       OR NEW.customer_id IS DISTINCT FROM v_orig.customer_id
       OR NEW.fee_type IS DISTINCT FROM v_orig.fee_type
       OR NEW.economic_at IS DISTINCT FROM v_orig.economic_at THEN
      RAISE EXCEPTION 'finance_ledger_link_invalid';
    END IF;
    NEW.idempotency_key := 'fee_reversed:' || NEW.fee_line_id::text;
    RETURN NEW;
  END IF;

  IF NEW.event_type = 'commission_accrued' THEN
    IF NEW.payout_status IS DISTINCT FROM 'received' OR NEW.payout_at IS NOT NULL
       OR NEW.payout_by IS NOT NULL THEN
      RAISE EXCEPTION 'finance_ledger_link_invalid';
    END IF;
    -- RAF has no authoritative economic date before B4c; no payable RAF accrual is created.
    IF NEW.beneficiary_role = 'referrer' OR NEW.referral_id IS NOT NULL THEN
      RAISE EXCEPTION 'finance_raf_accrual_deferred';
    END IF;
    SELECT * INTO v_fp FROM public.finance_ledger g
    WHERE g.tenant_id = NEW.tenant_id AND g.fee_line_id = NEW.fee_line_id
      AND g.event_type = 'fee_posted';
    IF NOT FOUND OR v_fee.status::text <> 'posted'
       OR NEW.session_id IS DISTINCT FROM v_fp.session_id
       OR NEW.customer_id IS DISTINCT FROM v_fp.customer_id
       OR NEW.fee_type IS DISTINCT FROM v_fp.fee_type
       OR NEW.economic_at IS DISTINCT FROM v_fp.economic_at
       OR NEW.commission_basis_pence IS DISTINCT FROM v_fp.amount_pence
       OR NEW.amount_pence IS DISTINCT FROM
          round(NEW.commission_basis_pence::numeric * NEW.commission_pct / 100)::integer THEN
      RAISE EXCEPTION 'finance_ledger_link_invalid';
    END IF;
    IF NEW.beneficiary_role = 'introducer' THEN
      IF NEW.fee_type NOT IN ('fee', 'mortgage_fee') OR NOT EXISTS (
        SELECT 1 FROM public.introducers i
        WHERE i.id = NEW.introducer_id AND i.tenant_id = NEW.tenant_id
          AND i.user_id = NEW.beneficiary_user_id) THEN
        RAISE EXCEPTION 'finance_ledger_link_invalid';
      END IF;
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.tenant_memberships m
      WHERE m.user_id = NEW.beneficiary_user_id AND m.tenant_id = NEW.tenant_id
        AND m.role::text = NEW.beneficiary_capacity
        AND m.role::text IN ('owner', 'supervisor', 'general', 'adviser')) THEN
      RAISE EXCEPTION 'finance_ledger_link_invalid';
    END IF;
    IF NEW.rate_source = 'rate_version' THEN
      SELECT * INTO v_rate FROM public.commission_rate_versions v WHERE v.id = NEW.rate_version_id;
      IF NOT FOUND OR v_rate.tenant_id <> NEW.tenant_id OR v_rate.fee_type <> NEW.fee_type
         OR v_rate.percentage IS DISTINCT FROM NEW.commission_pct
         OR v_rate.effective_from > NEW.economic_at
         OR NOT ((NEW.beneficiary_role = 'introducer' AND v_rate.subject_kind = 'introducer'
                  AND v_rate.introducer_id = NEW.introducer_id)
              OR (NEW.beneficiary_role = 'advisor' AND v_rate.subject_kind = 'adviser'
                  AND NEW.beneficiary_capacity = 'adviser'
                  AND v_rate.adviser_user_id = NEW.beneficiary_user_id)) THEN
        RAISE EXCEPTION 'finance_ledger_link_invalid';
      END IF;
    ELSE
      SELECT * INTO v_exc FROM public.finance_commission_exceptions e
      WHERE e.id = NEW.exception_id AND e.tenant_id = NEW.tenant_id;
      IF NOT FOUND OR v_exc.fee_line_id <> NEW.fee_line_id OR v_exc.status <> 'open'
         OR v_exc.beneficiary_role <> NEW.beneficiary_role
         OR v_exc.exception_kind NOT IN ('missing_rate', 'adviser_capacity_unrated')
         OR v_exc.beneficiary_user_id IS DISTINCT FROM NEW.beneficiary_user_id THEN
        RAISE EXCEPTION 'finance_ledger_link_invalid';
      END IF;
    END IF;
    IF NEW.original_event_id IS NOT NULL THEN
      SELECT * INTO v_orig FROM public.finance_ledger g
      WHERE g.id = NEW.original_event_id AND g.tenant_id = NEW.tenant_id;
      IF NOT FOUND OR v_orig.event_type NOT IN ('commission_reassigned', 'clawback')
         OR v_orig.fee_line_id IS DISTINCT FROM NEW.fee_line_id THEN
        RAISE EXCEPTION 'finance_ledger_link_invalid';
      END IF;
    END IF;
    NEW.idempotency_key := 'accrual:' || NEW.fee_line_id::text || ':' || NEW.beneficiary_role
                           || ':' || NEW.beneficiary_user_id::text;
    RETURN NEW;
  END IF;

  SELECT * INTO v_orig FROM public.finance_ledger g
  WHERE g.id = NEW.original_event_id AND g.tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finance_ledger_link_invalid';
  END IF;
  IF NEW.event_type IN ('commission_reversed', 'commission_reassigned', 'clawback') THEN
    IF v_orig.event_type <> 'commission_accrued'
       OR NEW.amount_pence IS DISTINCT FROM -v_orig.amount_pence
       OR NEW.beneficiary_user_id IS DISTINCT FROM v_orig.beneficiary_user_id
       OR NEW.beneficiary_role IS DISTINCT FROM v_orig.beneficiary_role
       OR NEW.introducer_id IS DISTINCT FROM v_orig.introducer_id
       OR NEW.fee_line_id IS DISTINCT FROM v_orig.fee_line_id
       OR NEW.referral_id IS DISTINCT FROM v_orig.referral_id
       OR NEW.session_id IS DISTINCT FROM v_orig.session_id
       OR (NEW.event_type = 'clawback' AND v_orig.payout_status <> 'paid')
       OR (NEW.event_type <> 'clawback' AND v_orig.payout_status <> 'received')
       OR (NEW.event_type = 'clawback' AND NEW.recovery_status IS DISTINCT FROM 'due') THEN
      RAISE EXCEPTION 'finance_ledger_link_invalid';
    END IF;
    NEW.idempotency_key := 'cancel:' || v_orig.id::text;
    RETURN NEW;
  END IF;
  IF v_orig.event_type <> 'clawback' OR v_orig.recovery_status <> 'due'
     OR NEW.beneficiary_user_id IS DISTINCT FROM v_orig.beneficiary_user_id
     OR NEW.beneficiary_role IS DISTINCT FROM v_orig.beneficiary_role THEN
    RAISE EXCEPTION 'finance_ledger_link_invalid';
  END IF;
  NEW.idempotency_key := 'recovery:' || v_orig.id::text;
  RETURN NEW;
END;
$$;

CREATE TRIGGER finance_ledger_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.finance_ledger
  FOR EACH ROW EXECUTE FUNCTION public.finance_ledger_guard();
CREATE TRIGGER finance_ledger_no_truncate
  BEFORE TRUNCATE ON public.finance_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION public.finance_ledger_guard();

CREATE FUNCTION public.finance_payout_transitions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_ev public.finance_ledger%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'finance_payout_history_immutable';
  END IF;
  IF NOT public.finance_b4b2_writer() THEN
    RAISE EXCEPTION 'finance_ledger_write_forbidden';
  END IF;
  NEW.recorded_at := now();
  NEW.txid := txid_current();
  SELECT * INTO v_ev FROM public.finance_ledger g
  WHERE g.id = NEW.ledger_event_id AND g.tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finance_payout_transition_invalid';
  END IF;
  IF NEW.transition_kind = 'payout' THEN
    IF v_ev.event_type <> 'commission_accrued' THEN
      RAISE EXCEPTION 'finance_payout_transition_invalid';
    END IF;
    IF NEW.from_status IS NULL THEN
      IF v_ev.payout_status <> 'received' OR EXISTS (
        SELECT 1 FROM public.finance_payout_transitions t
        WHERE t.ledger_event_id = v_ev.id AND t.tenant_id = v_ev.tenant_id) THEN
        RAISE EXCEPTION 'finance_payout_transition_invalid';
      END IF;
    ELSIF v_ev.payout_status IS DISTINCT FROM NEW.from_status THEN
      RAISE EXCEPTION 'finance_payout_transition_invalid';
    END IF;
  ELSE
    IF v_ev.event_type <> 'clawback' THEN
      RAISE EXCEPTION 'finance_payout_transition_invalid';
    END IF;
    IF NEW.from_status IS NULL THEN
      IF v_ev.recovery_status <> 'due' OR EXISTS (
        SELECT 1 FROM public.finance_payout_transitions t
        WHERE t.ledger_event_id = v_ev.id AND t.tenant_id = v_ev.tenant_id) THEN
        RAISE EXCEPTION 'finance_payout_transition_invalid';
      END IF;
    ELSIF v_ev.recovery_status IS DISTINCT FROM NEW.from_status THEN
      RAISE EXCEPTION 'finance_payout_transition_invalid';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER finance_payout_transitions_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.finance_payout_transitions
  FOR EACH ROW EXECUTE FUNCTION public.finance_payout_transitions_guard();
CREATE TRIGGER finance_payout_transitions_no_truncate
  BEFORE TRUNCATE ON public.finance_payout_transitions
  FOR EACH STATEMENT EXECUTE FUNCTION public.finance_payout_transitions_guard();

CREATE FUNCTION public.finance_commission_exceptions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_changed text[];
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'finance_exception_immutable';
  END IF;
  IF NOT public.finance_b4b2_writer() THEN
    RAISE EXCEPTION 'finance_ledger_write_forbidden';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' OR NOT EXISTS (
      SELECT 1 FROM public.finance_ledger g
      WHERE g.id = NEW.fee_event_id AND g.tenant_id = NEW.tenant_id
        AND g.event_type = 'fee_posted' AND g.fee_line_id = NEW.fee_line_id
        AND g.session_id = NEW.session_id AND g.amount_pence = NEW.commission_basis_pence
        AND g.economic_at = NEW.economic_at AND g.fee_type = NEW.fee_type) THEN
      RAISE EXCEPTION 'finance_exception_invalid';
    END IF;
    NEW.created_at := now();
    RETURN NEW;
  END IF;
  SELECT COALESCE(array_agg(n.key), ARRAY[]::text[]) INTO v_changed
  FROM jsonb_each(to_jsonb(NEW)) n JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
  WHERE n.value IS DISTINCT FROM o.value;
  IF OLD.status = 'open' AND NEW.status = 'resolved' AND NEW.resolved_at = now()
     AND v_changed <@ ARRAY['status', 'resolution', 'resolution_pct', 'resolution_adviser_ids',
                            'resolution_reason', 'resolved_by', 'resolved_at'] THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'finance_exception_immutable';
END;
$$;

CREATE TRIGGER finance_commission_exceptions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.finance_commission_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.finance_commission_exceptions_guard();
CREATE TRIGGER finance_commission_exceptions_no_truncate
  BEFORE TRUNCATE ON public.finance_commission_exceptions
  FOR EACH STATEMENT EXECUTE FUNCTION public.finance_commission_exceptions_guard();

CREATE FUNCTION public.finance_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'finance_record_immutable';
  END IF;
  IF NOT public.finance_b4b2_writer() THEN
    RAISE EXCEPTION 'finance_ledger_write_forbidden';
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER finance_commission_determinations_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.finance_commission_determinations
  FOR EACH ROW EXECUTE FUNCTION public.finance_append_only_guard();
CREATE TRIGGER finance_commission_determinations_no_truncate
  BEFORE TRUNCATE ON public.finance_commission_determinations
  FOR EACH STATEMENT EXECUTE FUNCTION public.finance_append_only_guard();

-- Finance audit: append-only. Only auth.users / session ON DELETE SET NULL may change a row.
CREATE FUNCTION public.finance_audit_log_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_changed text[];
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'finance_audit_immutable';
  END IF;
  SELECT COALESCE(array_agg(n.key), ARRAY[]::text[]) INTO v_changed
  FROM jsonb_each(to_jsonb(NEW)) n JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
  WHERE n.value IS DISTINCT FROM o.value;
  IF cardinality(v_changed) > 0
     AND v_changed <@ ARRAY['changed_by', 'customer_id', 'subject_user_id', 'session_id']
     AND (NOT ('changed_by' = ANY (v_changed)) OR NEW.changed_by IS NULL)
     AND (NOT ('customer_id' = ANY (v_changed)) OR NEW.customer_id IS NULL)
     AND (NOT ('subject_user_id' = ANY (v_changed)) OR NEW.subject_user_id IS NULL)
     AND (NOT ('session_id' = ANY (v_changed)) OR NEW.session_id IS NULL) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'finance_audit_immutable';
END;
$$;

CREATE TRIGGER finance_audit_log_append_only
  BEFORE UPDATE OR DELETE ON public.finance_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.finance_audit_log_guard();
CREATE TRIGGER finance_audit_log_no_truncate
  BEFORE TRUNCATE ON public.finance_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.finance_audit_log_guard();

-- Fee lines (replaces the B4b1 guard): every B4b1 rule is kept; posting, reversal and the Owner
-- correction insert are added, each only through a B4b2 RPC with its ledger event in place.
CREATE OR REPLACE FUNCTION public.finance_fee_lines_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_line public.network_commission_lines%ROWTYPE;
  v_stmt public.network_commission_statements%ROWTYPE;
  v_corr public.finance_fee_lines%ROWTYPE;
  v_changed text[];
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'finance_fee_line_delete_forbidden';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status::text <> 'draft' OR NEW.posted_at IS NOT NULL OR NEW.batch_id IS NOT NULL
       OR NEW.voided_at IS NOT NULL OR NEW.voided_by IS NOT NULL OR NEW.void_reason IS NOT NULL
       OR NEW.reversed_at IS NOT NULL OR NEW.reversed_by IS NOT NULL
       OR NEW.reversal_reason IS NOT NULL THEN
      RAISE EXCEPTION 'finance_fee_line_insert_invalid';
    END IF;
    IF NEW.corrects_fee_line_id IS NOT NULL THEN
      IF NOT public.finance_b4b2_writer() OR NEW.source_network_line_id IS NOT NULL THEN
        RAISE EXCEPTION 'finance_fee_line_correction_invalid';
      END IF;
      -- The economic date and its evidence are inherited, never supplied.
      IF NEW.fee_event_date IS NOT NULL OR NEW.fee_event_at IS NOT NULL
         OR NEW.fee_event_source IS NOT NULL THEN
        RAISE EXCEPTION 'finance_fee_line_correction_date_supplied';
      END IF;
      IF jsonb_typeof(NEW.fee_event_evidence) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'finance_fee_line_correction_invalid';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_each(NEW.fee_event_evidence) e
                 WHERE e.key NOT IN ('reason', 'evidence') OR jsonb_typeof(e.value) <> 'string') THEN
        RAISE EXCEPTION 'finance_fee_line_correction_invalid';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.tenant_memberships m
                     WHERE m.user_id = NEW.created_by AND m.tenant_id = NEW.tenant_id
                       AND m.active AND m.role::text = 'owner') THEN
        RAISE EXCEPTION 'finance_fee_line_correction_owner_required';
      END IF;
      SELECT * INTO v_corr FROM public.finance_fee_lines f
      WHERE f.id = NEW.corrects_fee_line_id AND f.tenant_id = NEW.tenant_id;
      IF NOT FOUND OR v_corr.status::text <> 'amended' OR v_corr.fee_event_at IS NULL
         OR NEW.session_id IS DISTINCT FROM v_corr.session_id
         OR NEW.fee_type IS DISTINCT FROM v_corr.fee_type OR NEW.amount_pence <= 0
         OR jsonb_typeof(NEW.fee_event_evidence) IS DISTINCT FROM 'object'
         OR NULLIF(btrim(COALESCE(NEW.fee_event_evidence->>'reason', '')), '') IS NULL
         OR NULLIF(btrim(COALESCE(NEW.fee_event_evidence->>'evidence', '')), '') IS NULL
         OR NOT EXISTS (SELECT 1 FROM public.finance_ledger g
                        WHERE g.tenant_id = v_corr.tenant_id AND g.fee_line_id = v_corr.id
                          AND g.event_type = 'fee_reversed') THEN
        RAISE EXCEPTION 'finance_fee_line_correction_invalid';
      END IF;
      NEW.fee_event_date := v_corr.fee_event_date;
      NEW.fee_event_at := v_corr.fee_event_at;
      NEW.fee_event_source := 'owner_correction';
      NEW.fee_event_evidence := jsonb_build_object(
        'corrects_fee_line_id', v_corr.id,
        'inherited_fee_event_source', v_corr.fee_event_source,
        'inherited_fee_event_evidence', v_corr.fee_event_evidence,
        'correction', NEW.fee_event_evidence
      );
      RETURN NEW;
    END IF;
    IF NEW.source_network_line_id IS NULL THEN
      RAISE EXCEPTION 'finance_fee_line_source_required';
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

  IF OLD.status::text = 'draft' AND NEW.status::text = 'posted'
     AND public.finance_b4b2_writer()
     AND v_changed <@ ARRAY['status', 'posted_at', 'batch_id', 'updated_at']
     AND NEW.posted_at = now() AND NEW.batch_id IS NOT NULL AND OLD.fee_event_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.finance_ledger g
                 WHERE g.tenant_id = OLD.tenant_id AND g.fee_line_id = OLD.id
                   AND g.event_type = 'fee_posted' AND g.amount_pence = OLD.amount_pence
                   AND g.economic_at = OLD.fee_event_at) THEN
    RETURN NEW;
  END IF;

  IF OLD.status::text = 'posted' AND NEW.status::text = 'amended'
     AND public.finance_b4b2_writer()
     AND v_changed <@ ARRAY['status', 'reversed_at', 'reversed_by', 'reversal_reason', 'updated_at']
     AND NEW.reversed_at = now()
     AND EXISTS (SELECT 1 FROM public.finance_ledger g
                 WHERE g.tenant_id = OLD.tenant_id AND g.fee_line_id = OLD.id
                   AND g.event_type = 'fee_reversed') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'finance_fee_line_transition_forbidden';
END;
$$;

-- I. Resolvers and authority.
-- Introducer attributed to a tenant session's customer at p_event_at. Behavioural parity with
-- src/lib/introducer-attribution.ts resolveIntroducerIdForCustomerAtDate.
CREATE FUNCTION public.resolve_customer_introducer_as_of(
  p_tenant_id uuid,
  p_session_id uuid,
  p_event_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_customer uuid;
  v_new uuid;
  v_link record;
  v_prev uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_event_at IS NULL
     OR p_event_at IN ('-infinity'::timestamptz, 'infinity'::timestamptz) THEN
    RAISE EXCEPTION 'introducer_resolve_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_session_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT s.customer_id INTO v_customer FROM public.interview_sessions s
  WHERE s.id = p_session_id AND s.tenant_id = p_tenant_id;
  IF v_customer IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT h.new_introducer_id INTO v_new
  FROM public.introducer_amendment_history h
  WHERE h.tenant_id = p_tenant_id AND h.customer_id = v_customer
    AND h.effective_from <= p_event_at
  ORDER BY h.effective_from DESC
  LIMIT 1;
  IF v_new IS NOT NULL THEN
    RETURN v_new;
  END IF;
  SELECT l.introducer_id, l.created_at, l.effective_from INTO v_link
  FROM public.customer_introducer_links l
  WHERE l.tenant_id = p_tenant_id AND l.customer_id = v_customer;
  IF NOT FOUND OR v_link.introducer_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_link.created_at IS NULL OR v_link.created_at > p_event_at THEN
    RETURN NULL;
  END IF;
  IF v_link.effective_from IS NULL OR v_link.effective_from <= p_event_at THEN
    RETURN v_link.introducer_id;
  END IF;
  SELECT h.previous_introducer_id INTO v_prev
  FROM public.introducer_amendment_history h
  WHERE h.tenant_id = p_tenant_id AND h.customer_id = v_customer
    AND h.effective_from > p_event_at
  ORDER BY h.effective_from ASC
  LIMIT 1;
  RETURN v_prev;
END;
$$;

-- 'post': Owner, Supervisor or General Admin with finance_customer = amend.
-- 'owner': Owner only. 'payout': Owner or Supervisor (D6).
CREATE FUNCTION public.finance_actor_role(
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
BEGIN
  IF p_tenant_id IS NULL OR p_actor_user_id IS NULL OR p_capability IS NULL
     OR p_capability NOT IN ('post', 'owner', 'payout') THEN
    RAISE EXCEPTION 'finance_forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM 1 FROM public.tenants t WHERE t.id = p_tenant_id AND t.status::text = 'active' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finance_forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT m.role::text INTO v_role
  FROM public.tenant_memberships m
  WHERE m.user_id = p_actor_user_id AND m.tenant_id = p_tenant_id AND m.active
    AND (m.role::text = 'owner'
      OR (p_capability IN ('post', 'payout') AND m.role::text = 'supervisor')
      OR (p_capability = 'post' AND m.role::text = 'general' AND EXISTS (
        SELECT 1 FROM public.admin_permissions ap
        WHERE ap.user_id = p_actor_user_id AND ap.tenant_id = p_tenant_id
          AND ap.permission_key = 'finance_customer' AND ap.access = 'amend')))
  ORDER BY CASE m.role::text WHEN 'owner' THEN 1 WHEN 'supervisor' THEN 2 ELSE 3 END
  LIMIT 1
  FOR SHARE;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'finance_forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN v_role;
END;
$$;

-- H1: the commission outcome a correction fee event inherits for one beneficiary. Walks the
-- corrects_fee_line_id chain to the nearest ancestor fee carrying a record for the beneficiary.
-- Returns NULL (normal engine rules apply) when that record was unpaid-reversed or paid and
-- clawed back by the fee reversal itself; otherwise the Owner must decide (rejected, reassigned,
-- Owner clawback, held without reinstatement, or declined).
CREATE FUNCTION public.finance_prior_commission_hold(
  p_tenant_id uuid,
  p_fee_line_id uuid,
  p_beneficiary_role text,
  p_beneficiary_user_id uuid,
  p_introducer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_cur uuid;
  v_depth integer := 0;
  v_acc public.finance_ledger%ROWTYPE;
  v_adj public.finance_ledger%ROWTYPE;
  v_exc public.finance_commission_exceptions%ROWTYPE;
BEGIN
  SELECT f.corrects_fee_line_id INTO v_cur FROM public.finance_fee_lines f
  WHERE f.id = p_fee_line_id AND f.tenant_id = p_tenant_id;
  WHILE v_cur IS NOT NULL LOOP
    v_depth := v_depth + 1;
    IF v_depth > 1000 THEN
      RAISE EXCEPTION 'finance_correction_chain_invalid';
    END IF;
    SELECT * INTO v_acc FROM public.finance_ledger g
    WHERE g.tenant_id = p_tenant_id AND g.fee_line_id = v_cur
      AND g.event_type = 'commission_accrued' AND g.beneficiary_role = p_beneficiary_role
      AND g.beneficiary_user_id = p_beneficiary_user_id
      AND g.introducer_id IS NOT DISTINCT FROM p_introducer_id
    ORDER BY g.created_at DESC, g.id DESC
    LIMIT 1;
    IF FOUND THEN
      SELECT * INTO v_adj FROM public.finance_ledger c
      WHERE c.tenant_id = p_tenant_id AND c.original_event_id = v_acc.id
        AND c.event_type IN ('commission_reversed', 'commission_reassigned', 'clawback');
      IF v_acc.payout_status = 'rejected' THEN
        RETURN jsonb_build_object('prior_fee_line_id', v_cur, 'prior_event_id', v_acc.id,
                                  'prior_outcome', 'rejected');
      ELSIF v_adj.event_type = 'commission_reassigned' THEN
        RETURN jsonb_build_object('prior_fee_line_id', v_cur, 'prior_event_id', v_acc.id,
                                  'prior_outcome', 'reassigned');
      ELSIF v_adj.event_type = 'clawback'
            AND v_adj.evidence->>'cause' IS DISTINCT FROM 'fee_reversed' THEN
        RETURN jsonb_build_object('prior_fee_line_id', v_cur, 'prior_event_id', v_acc.id,
                                  'prior_outcome', 'owner_clawback');
      ELSIF v_adj.id IS NULL
            OR v_adj.evidence->>'cause' IS DISTINCT FROM 'fee_reversed' THEN
        RETURN jsonb_build_object('prior_fee_line_id', v_cur, 'prior_event_id', v_acc.id,
                                  'prior_outcome', 'unresolved');
      END IF;
      RETURN NULL;
    END IF;
    SELECT * INTO v_exc FROM public.finance_commission_exceptions e
    WHERE e.tenant_id = p_tenant_id AND e.fee_line_id = v_cur
      AND e.exception_kind = 'prior_commission_held' AND e.beneficiary_role = p_beneficiary_role
      AND e.beneficiary_user_id = p_beneficiary_user_id
      AND e.introducer_id IS NOT DISTINCT FROM p_introducer_id
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('prior_fee_line_id', v_cur, 'prior_exception_id', v_exc.id,
                                'prior_outcome', CASE WHEN v_exc.resolution = 'no_commission'
                                                      THEN 'owner_declined'
                                                      ELSE 'held_unresolved' END);
    END IF;
    SELECT f.corrects_fee_line_id INTO v_cur FROM public.finance_fee_lines f
    WHERE f.id = v_cur AND f.tenant_id = p_tenant_id;
  END LOOP;
  RETURN NULL;
END;
$$;

-- J. Commission engine.
-- One beneficiary on one posted fee event: accrual, explicit zero, rounded to zero or exception,
-- always with a determination row. p_owner_pct is an Owner event percentage (D3) resolving
-- p_source_exception_id; otherwise the B4a rate at the fee's economic instant applies.
CREATE FUNCTION public.finance_commission_for_beneficiary(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_actor_role text,
  p_fee_event_id uuid,
  p_beneficiary_role text,
  p_beneficiary_user_id uuid,
  p_introducer_id uuid,
  p_capacity text,
  p_owner_pct numeric,
  p_source_exception_id uuid,
  p_original_event_id uuid,
  p_evidence jsonb
)
RETURNS TABLE (outcome text, ledger_event_id uuid, exception_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_fp public.finance_ledger%ROWTYPE;
  v_version uuid;
  v_pct numeric;
  v_eff timestamptz;
  v_rate_source text;
  v_amount integer;
  v_outcome text;
  v_event uuid;
  v_exc uuid;
  v_kind text;
  v_name text;
  v_code text;
  v_evidence jsonb;
  v_hold jsonb;
BEGIN
  IF NOT public.finance_b4b2_writer() THEN
    RAISE EXCEPTION 'finance_ledger_write_forbidden';
  END IF;
  SELECT * INTO v_fp FROM public.finance_ledger g
  WHERE g.id = p_fee_event_id AND g.tenant_id = p_tenant_id AND g.event_type = 'fee_posted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finance_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  v_evidence := COALESCE(p_evidence, '{}'::jsonb);

  IF p_owner_pct IS NULL AND p_source_exception_id IS NULL AND p_original_event_id IS NULL THEN
    v_hold := public.finance_prior_commission_hold(p_tenant_id, v_fp.fee_line_id,
                                                   p_beneficiary_role, p_beneficiary_user_id,
                                                   p_introducer_id);
  END IF;

  IF p_owner_pct IS NOT NULL THEN
    v_pct := p_owner_pct;
    v_rate_source := 'owner_event_pct';
  ELSIF v_hold IS NOT NULL THEN
    v_kind := 'prior_commission_held';
    v_evidence := v_evidence || jsonb_build_object('prior_commission', v_hold);
  ELSIF p_beneficiary_role = 'advisor' AND p_capacity IS DISTINCT FROM 'adviser' THEN
    v_kind := 'adviser_capacity_unrated';
  ELSE
    SELECT r.version_id, r.percentage, r.effective_from INTO v_version, v_pct, v_eff
    FROM public.resolve_commission_rate_as_of(
      p_tenant_id,
      CASE p_beneficiary_role WHEN 'introducer' THEN 'introducer' ELSE 'adviser' END,
      CASE p_beneficiary_role WHEN 'introducer' THEN p_introducer_id END,
      CASE p_beneficiary_role WHEN 'advisor' THEN p_beneficiary_user_id END,
      v_fp.fee_type, v_fp.economic_at) r;
    IF v_version IS NULL THEN
      v_kind := 'missing_rate';
    ELSE
      v_rate_source := 'rate_version';
      v_evidence := v_evidence || jsonb_build_object(
        'rate_version_id', v_version, 'rate_effective_from', v_eff, 'percentage', v_pct);
    END IF;
  END IF;

  IF v_kind IS NOT NULL THEN
    INSERT INTO public.finance_commission_exceptions (
      tenant_id, session_id, fee_line_id, fee_event_id, exception_kind, beneficiary_role,
      beneficiary_user_id, introducer_id, beneficiary_capacity, fee_type,
      commission_basis_pence, economic_date, economic_at, evidence, parent_exception_id,
      created_by
    )
    VALUES (
      p_tenant_id, v_fp.session_id, v_fp.fee_line_id, v_fp.id, v_kind, p_beneficiary_role,
      p_beneficiary_user_id, p_introducer_id, p_capacity, v_fp.fee_type, v_fp.amount_pence,
      v_fp.economic_date, v_fp.economic_at, v_evidence, p_source_exception_id, p_actor_user_id
    )
    RETURNING id INTO v_exc;
    INSERT INTO public.finance_commission_determinations (
      tenant_id, fee_line_id, fee_event_id, beneficiary_role, beneficiary_user_id, introducer_id,
      beneficiary_capacity, outcome, commission_basis_pence, exception_id, source_exception_id,
      source_event_id, evidence, created_by
    )
    VALUES (
      p_tenant_id, v_fp.fee_line_id, v_fp.id, p_beneficiary_role, p_beneficiary_user_id,
      p_introducer_id, p_capacity, 'exception', v_fp.amount_pence, v_exc, p_source_exception_id,
      p_original_event_id, v_evidence || jsonb_build_object('exception_kind', v_kind),
      p_actor_user_id
    );
    PERFORM public.network_finance_audit(
      p_tenant_id, p_actor_user_id, p_actor_role, 'commission_exception_raised', v_fp.session_id,
      v_fp.customer_id, v_fp.fee_type, 'Commission exception raised for Owner determination',
      jsonb_build_object('exception_id', v_exc, 'exception_kind', v_kind,
                         'fee_line_id', v_fp.fee_line_id, 'beneficiary_role', p_beneficiary_role,
                         'beneficiary_user_id', p_beneficiary_user_id,
                         'introducer_id', p_introducer_id));
    outcome := 'exception';
    ledger_event_id := NULL;
    exception_id := v_exc;
    RETURN NEXT;
    RETURN;
  END IF;

  v_amount := round(v_fp.amount_pence::numeric * v_pct / 100)::integer;
  IF v_pct = 0 THEN
    v_outcome := 'explicit_zero';
  ELSIF v_amount <= 0 THEN
    v_outcome := 'rounded_to_zero';
  ELSE
    v_outcome := 'accrued';
    IF p_beneficiary_role = 'introducer' THEN
      SELECT i.company_name, i.company_code INTO v_name, v_code
      FROM public.introducers i WHERE i.id = p_introducer_id AND i.tenant_id = p_tenant_id;
    ELSE
      SELECT COALESCE(NULLIF(btrim(p.full_name), ''), p.email) INTO v_name
      FROM public.profiles p WHERE p.id = p_beneficiary_user_id;
      SELECT ap.code INTO v_code FROM public.advisor_profiles ap
      WHERE ap.user_id = p_beneficiary_user_id AND ap.tenant_id = p_tenant_id;
    END IF;
    INSERT INTO public.finance_ledger (
      tenant_id, event_type, kind, idempotency_key, session_id, fee_line_id, customer_id,
      fee_type, amount_pence, is_reversal, beneficiary_user_id, beneficiary_role,
      beneficiary_capacity, introducer_id, beneficiary_name, beneficiary_code, commission_pct,
      commission_basis_pence, rate_source, rate_version_id, economic_date, economic_at,
      original_event_id, exception_id, payout_status, created_by, actor_role, evidence, note
    )
    VALUES (
      p_tenant_id, 'commission_accrued', 'commission', '-', v_fp.session_id, v_fp.fee_line_id,
      v_fp.customer_id, v_fp.fee_type, v_amount, false, p_beneficiary_user_id,
      p_beneficiary_role, p_capacity, p_introducer_id, v_name, v_code, v_pct,
      v_fp.amount_pence, v_rate_source, v_version, v_fp.economic_date, v_fp.economic_at,
      p_original_event_id,
      CASE WHEN v_rate_source = 'owner_event_pct' THEN p_source_exception_id END,
      'received', p_actor_user_id, p_actor_role, v_evidence,
      CASE p_beneficiary_role WHEN 'introducer' THEN 'Introducer commission'
                              ELSE 'Adviser commission' END
    )
    RETURNING id INTO v_event;
    INSERT INTO public.finance_payout_transitions (
      tenant_id, ledger_event_id, transition_kind, from_status, to_status, actor_user_id,
      actor_role
    )
    VALUES (p_tenant_id, v_event, 'payout', NULL, 'received', p_actor_user_id, p_actor_role);
  END IF;
  INSERT INTO public.finance_commission_determinations (
    tenant_id, fee_line_id, fee_event_id, beneficiary_role, beneficiary_user_id, introducer_id,
    beneficiary_capacity, outcome, rate_source, rate_version_id, commission_pct,
    commission_basis_pence, amount_pence, ledger_event_id, source_exception_id, source_event_id,
    evidence, created_by
  )
  VALUES (
    p_tenant_id, v_fp.fee_line_id, v_fp.id, p_beneficiary_role, p_beneficiary_user_id,
    p_introducer_id, p_capacity, v_outcome, v_rate_source, v_version, v_pct, v_fp.amount_pence,
    v_amount, v_event, p_source_exception_id, p_original_event_id, v_evidence, p_actor_user_id
  );
  PERFORM public.network_finance_audit(
    p_tenant_id, p_actor_user_id, p_actor_role,
    CASE v_outcome WHEN 'accrued' THEN 'commission_accrued' ELSE 'commission_not_accrued' END,
    v_fp.session_id, v_fp.customer_id, v_fp.fee_type,
    CASE v_outcome WHEN 'accrued' THEN 'Commission accrued at the fee economic date'
                   WHEN 'explicit_zero' THEN 'Commission rate is an explicit 0%'
                   ELSE 'Commission rounds to zero' END,
    jsonb_build_object('fee_line_id', v_fp.fee_line_id, 'ledger_event_id', v_event,
                       'beneficiary_role', p_beneficiary_role,
                       'beneficiary_user_id', p_beneficiary_user_id,
                       'introducer_id', p_introducer_id, 'rate_source', v_rate_source,
                       'rate_version_id', v_version, 'percentage', v_pct,
                       'amount_pence', v_amount, 'economic_date', v_fp.economic_date));
  outcome := v_outcome;
  ledger_event_id := v_event;
  exception_id := NULL;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION public.finance_record_determination(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_fee_event_id uuid,
  p_beneficiary_role text,
  p_introducer_id uuid,
  p_outcome text,
  p_source_exception_id uuid,
  p_evidence jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_fp public.finance_ledger%ROWTYPE;
BEGIN
  IF NOT public.finance_b4b2_writer() THEN
    RAISE EXCEPTION 'finance_ledger_write_forbidden';
  END IF;
  SELECT * INTO v_fp FROM public.finance_ledger g
  WHERE g.id = p_fee_event_id AND g.tenant_id = p_tenant_id AND g.event_type = 'fee_posted';
  IF NOT FOUND OR p_outcome NOT IN ('not_eligible_fee_type', 'no_adviser_assigned',
                                    'no_introducer_attributed', 'owner_no_commission') THEN
    RAISE EXCEPTION 'finance_determination_invalid';
  END IF;
  INSERT INTO public.finance_commission_determinations (
    tenant_id, fee_line_id, fee_event_id, beneficiary_role, introducer_id, outcome,
    commission_basis_pence, source_exception_id, evidence, created_by
  )
  VALUES (
    p_tenant_id, v_fp.fee_line_id, v_fp.id, p_beneficiary_role, p_introducer_id, p_outcome,
    v_fp.amount_pence, p_source_exception_id, COALESCE(p_evidence, '{}'::jsonb), p_actor_user_id
  );
END;
$$;

-- Posts one draft fee line of a tenant session. Caller holds the session lock.
CREATE FUNCTION public.finance_post_fee_line(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_actor_role text,
  p_fee_line_id uuid,
  p_batch_id uuid
)
RETURNS TABLE (fee_event_id uuid, accrued integer, exceptions integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_fee public.finance_fee_lines%ROWTYPE;
  v_line public.network_commission_lines%ROWTYPE;
  v_stmt_status text;
  v_customer uuid;
  v_event uuid;
  v_adv record;
  v_advisers jsonb := '[]'::jsonb;
  v_resolution text;
  v_count integer := 0;
  v_res record;
  v_intro uuid;
  v_intro_user uuid;
  v_accrued integer := 0;
  v_exceptions integer := 0;
  v_evidence jsonb;
BEGIN
  IF NOT public.finance_b4b2_writer() THEN
    RAISE EXCEPTION 'finance_ledger_write_forbidden';
  END IF;
  SELECT * INTO v_fee FROM public.finance_fee_lines f
  WHERE f.id = p_fee_line_id AND f.tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finance_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_fee.status::text <> 'draft' THEN
    RAISE EXCEPTION 'finance_fee_not_draft';
  END IF;
  IF v_fee.fee_event_date IS NULL OR v_fee.fee_event_at IS NULL THEN
    RAISE EXCEPTION 'finance_fee_event_date_required';
  END IF;
  IF v_fee.amount_pence IS NULL OR v_fee.amount_pence <= 0 THEN
    RAISE EXCEPTION 'finance_fee_amount_invalid';
  END IF;
  SELECT s.customer_id INTO v_customer FROM public.interview_sessions s
  WHERE s.id = v_fee.session_id AND s.tenant_id = p_tenant_id AND s.deleted_at IS NULL;
  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'finance_session_customer_invalid';
  END IF;

  IF v_fee.source_network_line_id IS NOT NULL THEN
    SELECT * INTO v_line FROM public.network_commission_lines l
    WHERE l.id = v_fee.source_network_line_id AND l.tenant_id = p_tenant_id
    FOR SHARE;
    SELECT s.status INTO v_stmt_status FROM public.network_commission_statements s
    WHERE s.id = v_line.statement_id AND s.tenant_id = p_tenant_id
    FOR SHARE;
    IF v_line.id IS NULL OR v_line.superseded_at IS NOT NULL
       OR v_line.allocation_status <> 'allocated' OR v_line.fee_line_id IS DISTINCT FROM v_fee.id
       OR v_line.matched_session_id IS DISTINCT FROM v_fee.session_id
       OR v_line.amount_received_pence IS DISTINCT FROM v_fee.amount_pence
       OR v_line.fee_type IS DISTINCT FROM v_fee.fee_type::text THEN
      RAISE EXCEPTION 'finance_fee_source_invalid';
    END IF;
    IF v_line.matched_customer_id IS DISTINCT FROM v_customer THEN
      RAISE EXCEPTION 'finance_session_customer_invalid';
    END IF;
    IF v_stmt_status IS NULL OR v_stmt_status NOT IN ('validated', 'locked') THEN
      RAISE EXCEPTION 'finance_statement_not_validated';
    END IF;
  ELSIF v_fee.corrects_fee_line_id IS NULL OR v_fee.fee_event_source <> 'owner_correction'
        OR p_actor_role <> 'owner' THEN
    RAISE EXCEPTION 'finance_fee_source_invalid';
  END IF;

  INSERT INTO public.finance_ledger (
    tenant_id, event_type, kind, idempotency_key, session_id, fee_line_id, customer_id, fee_type,
    amount_pence, is_reversal, economic_date, economic_at, created_by, actor_role, evidence, note
  )
  VALUES (
    p_tenant_id, 'fee_posted', 'post', '-', v_fee.session_id, v_fee.id, v_customer,
    v_fee.fee_type::text, v_fee.amount_pence, false, v_fee.fee_event_date, v_fee.fee_event_at,
    p_actor_user_id, p_actor_role,
    jsonb_build_object('fee_event_source', v_fee.fee_event_source,
                       'fee_event_evidence', v_fee.fee_event_evidence,
                       'network_line_id', v_fee.source_network_line_id,
                       'corrects_fee_line_id', v_fee.corrects_fee_line_id,
                       'batch_id', p_batch_id),
    v_fee.note
  )
  RETURNING id INTO v_event;
  UPDATE public.finance_fee_lines f
  SET status = 'posted', posted_at = now(), batch_id = p_batch_id, updated_at = now()
  WHERE f.id = v_fee.id;

  -- Advisers: entitlement at fee_event_at from the B4b1 history only.
  FOR v_adv IN
    SELECT * FROM public.resolve_session_advisers_as_of(p_tenant_id, v_fee.session_id,
                                                         v_fee.fee_event_at)
  LOOP
    v_resolution := v_adv.resolution;
    IF v_adv.adviser_user_id IS NOT NULL THEN
      v_count := v_count + 1;
      v_advisers := v_advisers || jsonb_build_array(jsonb_build_object(
        'adviser_user_id', v_adv.adviser_user_id, 'adviser_capacity', v_adv.adviser_capacity,
        'assignment_id', v_adv.assignment_id, 'assigned_at', v_adv.assigned_at,
        'unassigned_at', v_adv.unassigned_at));
    END IF;
  END LOOP;
  v_evidence := jsonb_build_object('adviser_resolution', v_resolution,
                                   'advisers', v_advisers, 'fee_event_at', v_fee.fee_event_at);
  IF v_resolution = 'none_assigned' THEN
    PERFORM public.finance_record_determination(p_tenant_id, p_actor_user_id, v_event, 'advisor',
                                                NULL, 'no_adviser_assigned', NULL, v_evidence);
  ELSIF v_resolution = 'assigned' AND v_count <= 3 THEN
    FOR v_adv IN
      SELECT * FROM public.resolve_session_advisers_as_of(p_tenant_id, v_fee.session_id,
                                                           v_fee.fee_event_at)
    LOOP
      SELECT * INTO v_res FROM public.finance_commission_for_beneficiary(
        p_tenant_id, p_actor_user_id, p_actor_role, v_event, 'advisor', v_adv.adviser_user_id,
        NULL, v_adv.adviser_capacity::text, NULL, NULL, NULL,
        v_evidence || jsonb_build_object('assignment_id', v_adv.assignment_id));
      IF v_res.outcome = 'accrued' THEN v_accrued := v_accrued + 1; END IF;
      IF v_res.outcome = 'exception' THEN v_exceptions := v_exceptions + 1; END IF;
    END LOOP;
  ELSE
    -- History incomplete, unprovable, or more than 3 advisers: hold all adviser commission (D2).
    INSERT INTO public.finance_commission_exceptions (
      tenant_id, session_id, fee_line_id, fee_event_id, exception_kind, beneficiary_role,
      fee_type, commission_basis_pence, economic_date, economic_at, evidence, created_by
    )
    VALUES (
      p_tenant_id, v_fee.session_id, v_fee.id, v_event, 'adviser_entitlement_unproven', 'advisor',
      v_fee.fee_type::text, v_fee.amount_pence, v_fee.fee_event_date, v_fee.fee_event_at,
      v_evidence || jsonb_build_object('adviser_count', v_count,
        'reason', CASE WHEN v_resolution = 'assigned' THEN 'more_than_three_advisers'
                       ELSE v_resolution END),
      p_actor_user_id
    );
    INSERT INTO public.finance_commission_determinations (
      tenant_id, fee_line_id, fee_event_id, beneficiary_role, outcome, commission_basis_pence,
      exception_id, evidence, created_by
    )
    SELECT p_tenant_id, v_fee.id, v_event, 'advisor', 'exception', v_fee.amount_pence, e.id,
           v_evidence, p_actor_user_id
    FROM public.finance_commission_exceptions e
    WHERE e.tenant_id = p_tenant_id AND e.fee_event_id = v_event
      AND e.exception_kind = 'adviser_entitlement_unproven';
    PERFORM public.network_finance_audit(
      p_tenant_id, p_actor_user_id, p_actor_role, 'commission_exception_raised', v_fee.session_id,
      v_customer, v_fee.fee_type::text, 'Adviser entitlement unproven; held for Owner determination',
      v_evidence || jsonb_build_object('fee_line_id', v_fee.id));
    v_exceptions := v_exceptions + 1;
  END IF;

  -- Introducer: attribution at fee_event_at; introducers earn only on fee and mortgage_fee.
  v_intro := public.resolve_customer_introducer_as_of(p_tenant_id, v_fee.session_id,
                                                      v_fee.fee_event_at);
  IF v_intro IS NULL THEN
    PERFORM public.finance_record_determination(
      p_tenant_id, p_actor_user_id, v_event, 'introducer', NULL, 'no_introducer_attributed', NULL,
      jsonb_build_object('fee_event_at', v_fee.fee_event_at));
  ELSIF v_fee.fee_type::text NOT IN ('fee', 'mortgage_fee') THEN
    PERFORM public.finance_record_determination(
      p_tenant_id, p_actor_user_id, v_event, 'introducer', v_intro, 'not_eligible_fee_type', NULL,
      jsonb_build_object('fee_event_at', v_fee.fee_event_at, 'fee_type', v_fee.fee_type));
  ELSE
    SELECT i.user_id INTO v_intro_user FROM public.introducers i
    WHERE i.id = v_intro AND i.tenant_id = p_tenant_id;
    IF v_intro_user IS NULL THEN
      RAISE EXCEPTION 'finance_introducer_attribution_invalid';
    END IF;
    SELECT * INTO v_res FROM public.finance_commission_for_beneficiary(
      p_tenant_id, p_actor_user_id, p_actor_role, v_event, 'introducer', v_intro_user, v_intro,
      NULL, NULL, NULL, NULL,
      jsonb_build_object('introducer_id', v_intro, 'fee_event_at', v_fee.fee_event_at));
    IF v_res.outcome = 'accrued' THEN v_accrued := v_accrued + 1; END IF;
    IF v_res.outcome = 'exception' THEN v_exceptions := v_exceptions + 1; END IF;
  END IF;

  PERFORM public.network_finance_audit(
    p_tenant_id, p_actor_user_id, p_actor_role, 'fee_posted', v_fee.session_id, v_customer,
    v_fee.fee_type::text, 'Fee posted at its economic date',
    jsonb_build_object('fee_line_id', v_fee.id, 'fee_event_id', v_event,
                       'amount_pence', v_fee.amount_pence, 'fee_event_date', v_fee.fee_event_date,
                       'fee_event_source', v_fee.fee_event_source, 'batch_id', p_batch_id,
                       'accrued', v_accrued, 'exceptions', v_exceptions));
  fee_event_id := v_event;
  accrued := v_accrued;
  exceptions := v_exceptions;
  RETURN NEXT;
END;
$$;

-- K. Public RPCs. The caller (service role) resolved the acting tenant; the actor's tenant
-- authority is re-checked here and every write commits together or not at all.
CREATE FUNCTION public.post_session_fees(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_session_id uuid,
  p_fee_line_ids uuid[]
)
RETURNS TABLE (fee_line_id uuid, fee_event_id uuid, created boolean, accrued integer,
               exceptions integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_role text;
  v_ids uuid[];
  v_n integer;
  v_posted integer;
  v_batch uuid := gen_random_uuid();
  v_id uuid;
  v_r record;
BEGIN
  PERFORM set_config('finance.b4b2_writer', 'on', true);
  v_role := public.finance_actor_role(p_tenant_id, p_actor_user_id, 'post');
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_ids
  FROM unnest(p_fee_line_ids) x WHERE x IS NOT NULL;
  IF v_ids IS NULL OR cardinality(v_ids) = 0 OR cardinality(v_ids) > 50
     OR cardinality(v_ids) <> cardinality(p_fee_line_ids) THEN
    RAISE EXCEPTION 'finance_fee_selection_invalid';
  END IF;
  PERFORM 1 FROM public.interview_sessions s
  WHERE s.id = p_session_id AND s.tenant_id = p_tenant_id AND s.deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finance_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM 1 FROM public.finance_fee_lines f
  WHERE f.id = ANY (v_ids) AND f.tenant_id = p_tenant_id AND f.session_id = p_session_id
  ORDER BY f.id
  FOR UPDATE;
  SELECT count(*), count(*) FILTER (WHERE f.status::text = 'posted') INTO v_n, v_posted
  FROM public.finance_fee_lines f
  WHERE f.id = ANY (v_ids) AND f.tenant_id = p_tenant_id AND f.session_id = p_session_id;
  IF v_n <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'finance_fee_selection_invalid';
  END IF;
  -- Exact replay of an already-posted selection returns the existing events.
  IF v_posted = v_n THEN
    FOR v_r IN
      SELECT g.fee_line_id AS fid, g.id AS eid FROM public.finance_ledger g
      WHERE g.tenant_id = p_tenant_id AND g.event_type = 'fee_posted'
        AND g.fee_line_id = ANY (v_ids)
      ORDER BY g.fee_line_id
    LOOP
      fee_line_id := v_r.fid;
      fee_event_id := v_r.eid;
      created := false;
      accrued := NULL;
      exceptions := NULL;
      RETURN NEXT;
    END LOOP;
    RETURN;
  END IF;
  IF v_posted > 0 THEN
    RAISE EXCEPTION 'finance_fee_not_draft';
  END IF;
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO v_r FROM public.finance_post_fee_line(p_tenant_id, p_actor_user_id, v_role,
                                                        v_id, v_batch);
    fee_line_id := v_id;
    fee_event_id := v_r.fee_event_id;
    created := true;
    accrued := v_r.accrued;
    exceptions := v_r.exceptions;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Owner reversal of a posted fee: linked fee_reversed, unpaid commission reversed, paid
-- commission clawed back, rejected commission preserved, open exceptions closed.
CREATE FUNCTION public.reverse_posted_fee(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_fee_line_id uuid,
  p_reason text
)
RETURNS TABLE (fee_reversed_event_id uuid, commissions_reversed integer, clawbacks integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_role text;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_session uuid;
  v_fee public.finance_fee_lines%ROWTYPE;
  v_fp public.finance_ledger%ROWTYPE;
  v_event uuid;
  v_acc public.finance_ledger%ROWTYPE;
  v_rev integer := 0;
  v_claw integer := 0;
BEGIN
  PERFORM set_config('finance.b4b2_writer', 'on', true);
  v_role := public.finance_actor_role(p_tenant_id, p_actor_user_id, 'owner');
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'finance_reason_required';
  END IF;
  SELECT f.session_id INTO v_session FROM public.finance_fee_lines f
  WHERE f.id = p_fee_line_id AND f.tenant_id = p_tenant_id;
  IF v_session IS NULL THEN
    RAISE EXCEPTION 'finance_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM 1 FROM public.interview_sessions s
  WHERE s.id = v_session AND s.tenant_id = p_tenant_id FOR UPDATE;
  SELECT * INTO v_fee FROM public.finance_fee_lines f
  WHERE f.id = p_fee_line_id AND f.tenant_id = p_tenant_id FOR UPDATE;
  IF v_fee.status::text = 'amended' THEN
    RAISE EXCEPTION 'finance_fee_already_reversed';
  END IF;
  IF v_fee.status::text <> 'posted' THEN
    RAISE EXCEPTION 'finance_fee_not_posted';
  END IF;
  SELECT * INTO v_fp FROM public.finance_ledger g
  WHERE g.tenant_id = p_tenant_id AND g.fee_line_id = v_fee.id AND g.event_type = 'fee_posted';
  INSERT INTO public.finance_ledger (
    tenant_id, event_type, kind, idempotency_key, session_id, fee_line_id, customer_id, fee_type,
    amount_pence, is_reversal, economic_date, economic_at, original_event_id, reason, created_by,
    actor_role, evidence, note
  )
  VALUES (
    p_tenant_id, 'fee_reversed', 'post', '-', v_fp.session_id, v_fee.id, v_fp.customer_id,
    v_fp.fee_type, -v_fp.amount_pence, true, v_fp.economic_date, v_fp.economic_at, v_fp.id,
    v_reason, p_actor_user_id, v_role, jsonb_build_object('reversed_fee_event_id', v_fp.id),
    'Fee reversed'
  )
  RETURNING id INTO v_event;
  UPDATE public.finance_fee_lines f
  SET status = 'amended', reversed_at = now(), reversed_by = p_actor_user_id,
      reversal_reason = v_reason, updated_at = now()
  WHERE f.id = v_fee.id;

  FOR v_acc IN
    SELECT * FROM public.finance_ledger g
    WHERE g.tenant_id = p_tenant_id AND g.fee_line_id = v_fee.id
      AND g.event_type = 'commission_accrued'
      AND NOT EXISTS (SELECT 1 FROM public.finance_ledger c
                      WHERE c.tenant_id = g.tenant_id AND c.original_event_id = g.id
                        AND c.event_type IN ('commission_reversed', 'commission_reassigned',
                                             'clawback'))
    ORDER BY g.id
    FOR UPDATE
  LOOP
    IF v_acc.payout_status = 'received' THEN
      PERFORM public.finance_cancel_accrual(p_tenant_id, p_actor_user_id, v_role, v_acc.id,
                                            'commission_reversed', v_reason, 'fee_reversed');
      v_rev := v_rev + 1;
    ELSIF v_acc.payout_status = 'paid' THEN
      PERFORM public.finance_cancel_accrual(p_tenant_id, p_actor_user_id, v_role, v_acc.id,
                                            'clawback', v_reason, 'fee_reversed');
      v_claw := v_claw + 1;
    END IF;
  END LOOP;

  UPDATE public.finance_commission_exceptions e
  SET status = 'resolved', resolution = 'fee_reversed', resolution_reason = v_reason,
      resolved_by = p_actor_user_id, resolved_at = now()
  WHERE e.tenant_id = p_tenant_id AND e.fee_line_id = v_fee.id AND e.status = 'open';

  PERFORM public.network_finance_audit(
    p_tenant_id, p_actor_user_id, v_role, 'fee_reversed', v_fp.session_id, v_fp.customer_id,
    v_fp.fee_type, 'Posted fee reversed by Owner',
    jsonb_build_object('fee_line_id', v_fee.id, 'fee_event_id', v_fp.id,
                       'fee_reversed_event_id', v_event, 'reason', v_reason,
                       'commissions_reversed', v_rev, 'clawbacks', v_claw));
  fee_reversed_event_id := v_event;
  commissions_reversed := v_rev;
  clawbacks := v_claw;
  RETURN NEXT;
END;
$$;

-- Linked negative event for one live accrual: commission_reversed / commission_reassigned
-- (received only, payout -> reversed) or clawback (paid only; the payment stays paid).
-- p_cause records why (fee_reversed, owner_reassignment, owner_clawback) for correction holds.
CREATE FUNCTION public.finance_cancel_accrual(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_actor_role text,
  p_accrual_id uuid,
  p_event_type text,
  p_reason text,
  p_cause text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_acc public.finance_ledger%ROWTYPE;
  v_event uuid;
BEGIN
  IF NOT public.finance_b4b2_writer() THEN
    RAISE EXCEPTION 'finance_ledger_write_forbidden';
  END IF;
  IF NOT COALESCE((p_event_type = 'commission_reversed' AND p_cause = 'fee_reversed')
                  OR (p_event_type = 'commission_reassigned' AND p_cause = 'owner_reassignment')
                  OR (p_event_type = 'clawback' AND p_cause IN ('fee_reversed', 'owner_clawback')),
                  false) THEN
    RAISE EXCEPTION 'finance_adjustment_invalid';
  END IF;
  SELECT * INTO v_acc FROM public.finance_ledger g
  WHERE g.id = p_accrual_id AND g.tenant_id = p_tenant_id AND g.event_type = 'commission_accrued'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finance_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.finance_ledger c
             WHERE c.tenant_id = p_tenant_id AND c.original_event_id = v_acc.id
               AND c.event_type IN ('commission_reversed', 'commission_reassigned', 'clawback')) THEN
    RAISE EXCEPTION 'finance_commission_already_adjusted';
  END IF;
  IF p_event_type = 'clawback' AND v_acc.payout_status <> 'paid' THEN
    RAISE EXCEPTION 'finance_commission_not_paid';
  END IF;
  IF p_event_type <> 'clawback' AND v_acc.payout_status = 'paid' THEN
    RAISE EXCEPTION 'finance_commission_paid';
  END IF;
  IF p_event_type <> 'clawback' AND v_acc.payout_status <> 'received' THEN
    RAISE EXCEPTION 'finance_commission_not_payable';
  END IF;
  INSERT INTO public.finance_ledger (
    tenant_id, event_type, kind, idempotency_key, session_id, fee_line_id, customer_id, fee_type,
    amount_pence, is_reversal, beneficiary_user_id, beneficiary_role, beneficiary_capacity,
    introducer_id, beneficiary_name, beneficiary_code, commission_pct, commission_basis_pence,
    economic_date, economic_at, referral_id, original_event_id, reason, recovery_status,
    created_by, actor_role, evidence, note
  )
  VALUES (
    p_tenant_id, p_event_type, 'commission', '-', v_acc.session_id, v_acc.fee_line_id,
    v_acc.customer_id, v_acc.fee_type, -v_acc.amount_pence, true, v_acc.beneficiary_user_id,
    v_acc.beneficiary_role, v_acc.beneficiary_capacity, v_acc.introducer_id,
    v_acc.beneficiary_name, v_acc.beneficiary_code, v_acc.commission_pct,
    v_acc.commission_basis_pence, v_acc.economic_date, v_acc.economic_at, v_acc.referral_id,
    v_acc.id, p_reason, CASE WHEN p_event_type = 'clawback' THEN 'due' END, p_actor_user_id,
    p_actor_role, jsonb_build_object('original_payout_status', v_acc.payout_status,
                                     'cause', p_cause),
    CASE p_event_type WHEN 'clawback' THEN 'Commission clawback'
                      WHEN 'commission_reassigned' THEN 'Commission reassigned'
                      ELSE 'Commission reversed' END
  )
  RETURNING id INTO v_event;
  IF p_event_type = 'clawback' THEN
    INSERT INTO public.finance_payout_transitions (
      tenant_id, ledger_event_id, transition_kind, from_status, to_status, actor_user_id,
      actor_role, reason
    )
    VALUES (p_tenant_id, v_event, 'recovery', NULL, 'due', p_actor_user_id, p_actor_role,
            p_reason);
  ELSE
    INSERT INTO public.finance_payout_transitions (
      tenant_id, ledger_event_id, transition_kind, from_status, to_status, actor_user_id,
      actor_role, reason
    )
    VALUES (p_tenant_id, v_acc.id, 'payout', 'received', 'reversed', p_actor_user_id,
            p_actor_role, p_reason);
    UPDATE public.finance_ledger g
    SET payout_status = 'reversed', payout_at = now(), payout_by = p_actor_user_id
    WHERE g.id = v_acc.id;
  END IF;
  PERFORM public.network_finance_audit(
    p_tenant_id, p_actor_user_id, p_actor_role, p_event_type, v_acc.session_id, v_acc.customer_id,
    v_acc.fee_type,
    CASE p_event_type WHEN 'clawback' THEN 'Paid commission clawed back (recovery due)'
                      WHEN 'commission_reassigned' THEN 'Unpaid commission reassigned'
                      ELSE 'Unpaid commission reversed' END,
    jsonb_build_object('accrual_event_id', v_acc.id, 'event_id', v_event, 'reason', p_reason,
                       'beneficiary_role', v_acc.beneficiary_role,
                       'beneficiary_user_id', v_acc.beneficiary_user_id,
                       'amount_pence', v_acc.amount_pence));
  RETURN v_event;
END;
$$;

-- D4: Owner correction fee event for a reversed fee, posted through the same engine.
CREATE FUNCTION public.post_fee_correction(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_reversed_fee_line_id uuid,
  p_amount_pence integer,
  p_reason text,
  p_evidence text
)
RETURNS TABLE (fee_line_id uuid, fee_event_id uuid, accrued integer, exceptions integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_role text;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_evidence text := NULLIF(btrim(COALESCE(p_evidence, '')), '');
  v_orig public.finance_fee_lines%ROWTYPE;
  v_new uuid;
  v_r record;
BEGIN
  PERFORM set_config('finance.b4b2_writer', 'on', true);
  v_role := public.finance_actor_role(p_tenant_id, p_actor_user_id, 'owner');
  IF v_reason IS NULL OR char_length(v_reason) > 500 OR v_evidence IS NULL
     OR char_length(v_evidence) > 1000 THEN
    RAISE EXCEPTION 'finance_reason_required';
  END IF;
  IF p_amount_pence IS NULL OR p_amount_pence <= 0 THEN
    RAISE EXCEPTION 'finance_fee_amount_invalid';
  END IF;
  SELECT * INTO v_orig FROM public.finance_fee_lines f
  WHERE f.id = p_reversed_fee_line_id AND f.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finance_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM 1 FROM public.interview_sessions s
  WHERE s.id = v_orig.session_id AND s.tenant_id = p_tenant_id FOR UPDATE;
  SELECT * INTO v_orig FROM public.finance_fee_lines f
  WHERE f.id = p_reversed_fee_line_id AND f.tenant_id = p_tenant_id FOR UPDATE;
  IF v_orig.status::text <> 'amended' THEN
    RAISE EXCEPTION 'finance_fee_not_reversed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.finance_fee_lines f
             WHERE f.tenant_id = p_tenant_id AND f.corrects_fee_line_id = v_orig.id) THEN
    RAISE EXCEPTION 'finance_fee_already_corrected';
  END IF;
  INSERT INTO public.finance_fee_lines (
    session_id, fee_type, amount_pence, note, status, created_by, tenant_id, corrects_fee_line_id,
    fee_event_evidence
  )
  VALUES (
    v_orig.session_id, v_orig.fee_type, p_amount_pence,
    'Owner correction of ' || left(v_orig.id::text, 8), 'draft', p_actor_user_id, p_tenant_id,
    v_orig.id, jsonb_build_object('reason', v_reason, 'evidence', v_evidence)
  )
  RETURNING id INTO v_new;
  SELECT * INTO v_r FROM public.finance_post_fee_line(p_tenant_id, p_actor_user_id, v_role, v_new,
                                                      gen_random_uuid());
  PERFORM public.network_finance_audit(
    p_tenant_id, p_actor_user_id, v_role, 'fee_correction_posted', v_orig.session_id, NULL,
    v_orig.fee_type::text, 'Owner correction fee event posted',
    jsonb_build_object('fee_line_id', v_new, 'corrects_fee_line_id', v_orig.id,
                       'amount_pence', p_amount_pence, 'reason', v_reason,
                       'evidence', v_evidence, 'fee_event_date', v_orig.fee_event_date));
  fee_line_id := v_new;
  fee_event_id := v_r.fee_event_id;
  accrued := v_r.accrued;
  exceptions := v_r.exceptions;
  RETURN NEXT;
END;
$$;

-- Owner reassignment of an unpaid introducer accrual: linked commission_reassigned and a
-- replacement determination for the new introducer at the original economic date. Paid
-- commission is refused here (claw_back_commission).
CREATE FUNCTION public.reassign_introducer_commission(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_accrual_id uuid,
  p_new_introducer_id uuid,
  p_reason text
)
RETURNS TABLE (reassigned_event_id uuid, outcome text, new_event_id uuid, exception_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_role text;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_acc public.finance_ledger%ROWTYPE;
  v_user uuid;
  v_event uuid;
  v_fp uuid;
  v_r record;
BEGIN
  PERFORM set_config('finance.b4b2_writer', 'on', true);
  v_role := public.finance_actor_role(p_tenant_id, p_actor_user_id, 'owner');
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'finance_reason_required';
  END IF;
  SELECT * INTO v_acc FROM public.finance_ledger g
  WHERE g.id = p_accrual_id AND g.tenant_id = p_tenant_id AND g.event_type = 'commission_accrued'
    AND g.beneficiary_role = 'introducer';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finance_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM 1 FROM public.interview_sessions s
  WHERE s.id = v_acc.session_id AND s.tenant_id = p_tenant_id FOR UPDATE;
  SELECT * INTO v_acc FROM public.finance_ledger g WHERE g.id = p_accrual_id FOR UPDATE;
  IF v_acc.payout_status = 'paid' THEN
    RAISE EXCEPTION 'finance_commission_paid';
  END IF;
  IF p_new_introducer_id IS NULL OR p_new_introducer_id = v_acc.introducer_id THEN
    RAISE EXCEPTION 'finance_reassignment_invalid';
  END IF;
  SELECT i.user_id INTO v_user FROM public.introducers i
  WHERE i.id = p_new_introducer_id AND i.tenant_id = p_tenant_id;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'finance_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.finance_fee_lines f
             WHERE f.id = v_acc.fee_line_id AND f.status::text <> 'posted') THEN
    RAISE EXCEPTION 'finance_fee_not_posted';
  END IF;
  IF EXISTS (SELECT 1 FROM public.finance_ledger g
             WHERE g.tenant_id = p_tenant_id AND g.fee_line_id = v_acc.fee_line_id
               AND g.event_type = 'commission_accrued' AND g.beneficiary_role = 'introducer'
               AND g.beneficiary_user_id = v_user) THEN
    RAISE EXCEPTION 'finance_beneficiary_already_accrued';
  END IF;
  v_event := public.finance_cancel_accrual(p_tenant_id, p_actor_user_id, v_role, v_acc.id,
                                           'commission_reassigned', v_reason,
                                           'owner_reassignment');
  SELECT g.id INTO v_fp FROM public.finance_ledger g
  WHERE g.tenant_id = p_tenant_id AND g.fee_line_id = v_acc.fee_line_id
    AND g.event_type = 'fee_posted';
  SELECT * INTO v_r FROM public.finance_commission_for_beneficiary(
    p_tenant_id, p_actor_user_id, v_role, v_fp, 'introducer', v_user, p_new_introducer_id, NULL,
    NULL, NULL, v_event,
    jsonb_build_object('reassigned_from_event_id', v_acc.id,
                       'previous_introducer_id', v_acc.introducer_id, 'reason', v_reason));
  reassigned_event_id := v_event;
  outcome := v_r.outcome;
  new_event_id := v_r.ledger_event_id;
  exception_id := v_r.exception_id;
  RETURN NEXT;
END;
$$;

-- Owner clawback of a paid accrual, optionally with a separate replacement introducer accrual.
CREATE FUNCTION public.claw_back_commission(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_accrual_id uuid,
  p_reason text,
  p_replacement_introducer_id uuid
)
RETURNS TABLE (clawback_event_id uuid, replacement_outcome text, replacement_event_id uuid,
               exception_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_role text;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_acc public.finance_ledger%ROWTYPE;
  v_user uuid;
  v_event uuid;
  v_fp uuid;
  v_r record;
BEGIN
  PERFORM set_config('finance.b4b2_writer', 'on', true);
  v_role := public.finance_actor_role(p_tenant_id, p_actor_user_id, 'owner');
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'finance_reason_required';
  END IF;
  SELECT * INTO v_acc FROM public.finance_ledger g
  WHERE g.id = p_accrual_id AND g.tenant_id = p_tenant_id AND g.event_type = 'commission_accrued';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finance_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_acc.session_id IS NOT NULL THEN
    PERFORM 1 FROM public.interview_sessions s
    WHERE s.id = v_acc.session_id AND s.tenant_id = p_tenant_id FOR UPDATE;
  END IF;
  IF p_replacement_introducer_id IS NOT NULL THEN
    IF v_acc.beneficiary_role <> 'introducer' OR p_replacement_introducer_id = v_acc.introducer_id
       OR EXISTS (SELECT 1 FROM public.finance_fee_lines f
                  WHERE f.id = v_acc.fee_line_id AND f.status::text <> 'posted') THEN
      RAISE EXCEPTION 'finance_reassignment_invalid';
    END IF;
    SELECT i.user_id INTO v_user FROM public.introducers i
    WHERE i.id = p_replacement_introducer_id AND i.tenant_id = p_tenant_id;
    IF v_user IS NULL THEN
      RAISE EXCEPTION 'finance_resource_not_found' USING ERRCODE = 'no_data_found';
    END IF;
    IF EXISTS (SELECT 1 FROM public.finance_ledger g
               WHERE g.tenant_id = p_tenant_id AND g.fee_line_id = v_acc.fee_line_id
                 AND g.event_type = 'commission_accrued' AND g.beneficiary_role = 'introducer'
                 AND g.beneficiary_user_id = v_user) THEN
      RAISE EXCEPTION 'finance_beneficiary_already_accrued';
    END IF;
  END IF;
  v_event := public.finance_cancel_accrual(p_tenant_id, p_actor_user_id, v_role, v_acc.id,
                                           'clawback', v_reason, 'owner_clawback');
  clawback_event_id := v_event;
  IF p_replacement_introducer_id IS NOT NULL THEN
    SELECT g.id INTO v_fp FROM public.finance_ledger g
    WHERE g.tenant_id = p_tenant_id AND g.fee_line_id = v_acc.fee_line_id
      AND g.event_type = 'fee_posted';
    SELECT * INTO v_r FROM public.finance_commission_for_beneficiary(
      p_tenant_id, p_actor_user_id, v_role, v_fp, 'introducer', v_user,
      p_replacement_introducer_id, NULL, NULL, NULL, v_event,
      jsonb_build_object('replaces_clawed_back_event_id', v_acc.id, 'reason', v_reason));
    replacement_outcome := v_r.outcome;
    replacement_event_id := v_r.ledger_event_id;
    exception_id := v_r.exception_id;
  END IF;
  RETURN NEXT;
END;
$$;

-- Owner determination of an open exception (D2/D3).
CREATE FUNCTION public.resolve_commission_exception(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_exception_id uuid,
  p_resolution text,
  p_pct numeric,
  p_adviser_user_ids uuid[],
  p_reason text
)
RETURNS TABLE (outcome text, ledger_event_id uuid, child_exception_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_role text;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_exc public.finance_commission_exceptions%ROWTYPE;
  v_ids uuid[];
  v_id uuid;
  v_r record;
  v_any boolean := false;
BEGIN
  PERFORM set_config('finance.b4b2_writer', 'on', true);
  v_role := public.finance_actor_role(p_tenant_id, p_actor_user_id, 'owner');
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'finance_reason_required';
  END IF;
  SELECT * INTO v_exc FROM public.finance_commission_exceptions e
  WHERE e.id = p_exception_id AND e.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finance_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM 1 FROM public.interview_sessions s
  WHERE s.id = v_exc.session_id AND s.tenant_id = p_tenant_id FOR UPDATE;
  SELECT * INTO v_exc FROM public.finance_commission_exceptions e
  WHERE e.id = p_exception_id FOR UPDATE;
  IF v_exc.status <> 'open' THEN
    RAISE EXCEPTION 'finance_exception_already_resolved';
  END IF;
  IF EXISTS (SELECT 1 FROM public.finance_fee_lines f
             WHERE f.id = v_exc.fee_line_id AND f.status::text <> 'posted') THEN
    RAISE EXCEPTION 'finance_fee_not_posted';
  END IF;

  IF v_exc.exception_kind = 'prior_commission_held' AND p_resolution = 'reinstate' THEN
    IF p_pct IS NOT NULL OR p_adviser_user_ids IS NOT NULL THEN
      RAISE EXCEPTION 'finance_resolution_invalid';
    END IF;
    SELECT * INTO v_r FROM public.finance_commission_for_beneficiary(
      p_tenant_id, p_actor_user_id, v_role, v_exc.fee_event_id, v_exc.beneficiary_role,
      v_exc.beneficiary_user_id, v_exc.introducer_id, v_exc.beneficiary_capacity, NULL,
      v_exc.id, NULL, jsonb_build_object('exception_id', v_exc.id, 'reason', v_reason,
                                         'owner_reinstated', true));
    outcome := v_r.outcome;
    ledger_event_id := v_r.ledger_event_id;
    child_exception_id := v_r.exception_id;
    v_any := true;
    RETURN NEXT;
  ELSIF v_exc.exception_kind IN ('missing_rate', 'adviser_capacity_unrated',
                                 'prior_commission_held') THEN
    IF p_resolution = 'event_pct' AND v_exc.exception_kind <> 'prior_commission_held' THEN
      IF p_pct IS NULL OR p_pct <= 0 OR p_pct > 100 OR p_pct <> round(p_pct, 3)
         OR p_adviser_user_ids IS NOT NULL THEN
        RAISE EXCEPTION 'finance_resolution_invalid';
      END IF;
      SELECT * INTO v_r FROM public.finance_commission_for_beneficiary(
        p_tenant_id, p_actor_user_id, v_role, v_exc.fee_event_id, v_exc.beneficiary_role,
        v_exc.beneficiary_user_id, v_exc.introducer_id, v_exc.beneficiary_capacity, p_pct,
        v_exc.id, NULL, jsonb_build_object('exception_id', v_exc.id, 'reason', v_reason,
                                           'owner_event_pct', p_pct));
      outcome := v_r.outcome;
      ledger_event_id := v_r.ledger_event_id;
      child_exception_id := NULL;
      v_any := true;
      RETURN NEXT;
    ELSIF p_resolution = 'no_commission' THEN
      IF p_pct IS NOT NULL OR p_adviser_user_ids IS NOT NULL THEN
        RAISE EXCEPTION 'finance_resolution_invalid';
      END IF;
      INSERT INTO public.finance_commission_determinations (
        tenant_id, fee_line_id, fee_event_id, beneficiary_role, beneficiary_user_id,
        introducer_id, beneficiary_capacity, outcome, commission_basis_pence,
        source_exception_id, evidence, created_by
      )
      VALUES (
        p_tenant_id, v_exc.fee_line_id, v_exc.fee_event_id, v_exc.beneficiary_role,
        v_exc.beneficiary_user_id, v_exc.introducer_id, v_exc.beneficiary_capacity,
        'owner_no_commission', v_exc.commission_basis_pence, v_exc.id,
        jsonb_build_object('exception_id', v_exc.id, 'reason', v_reason), p_actor_user_id
      );
      outcome := 'owner_no_commission';
      ledger_event_id := NULL;
      child_exception_id := NULL;
      v_any := true;
      RETURN NEXT;
    ELSE
      RAISE EXCEPTION 'finance_resolution_invalid';
    END IF;
  ELSE
    IF p_resolution <> 'advisers_determined' OR p_pct IS NOT NULL OR p_adviser_user_ids IS NULL THEN
      RAISE EXCEPTION 'finance_resolution_invalid';
    END IF;
    SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), ARRAY[]::uuid[]) INTO v_ids
    FROM unnest(p_adviser_user_ids) x;
    IF cardinality(v_ids) <> cardinality(p_adviser_user_ids) OR cardinality(v_ids) > 3
       OR EXISTS (SELECT 1 FROM unnest(v_ids) x WHERE x IS NULL) THEN
      RAISE EXCEPTION 'finance_resolution_invalid';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_ids) x
               WHERE NOT EXISTS (SELECT 1 FROM public.tenant_memberships m
                                 WHERE m.user_id = x AND m.tenant_id = p_tenant_id
                                   AND m.role::text = 'adviser')) THEN
      RAISE EXCEPTION 'finance_resolution_invalid';
    END IF;
    IF cardinality(v_ids) = 0 THEN
      PERFORM public.finance_record_determination(
        p_tenant_id, p_actor_user_id, v_exc.fee_event_id, 'advisor', NULL, 'owner_no_commission',
        v_exc.id, jsonb_build_object('exception_id', v_exc.id, 'reason', v_reason,
                                     'advisers', '[]'::jsonb));
      outcome := 'owner_no_commission';
      ledger_event_id := NULL;
      child_exception_id := NULL;
      RETURN NEXT;
    END IF;
    FOREACH v_id IN ARRAY v_ids LOOP
      SELECT * INTO v_r FROM public.finance_commission_for_beneficiary(
        p_tenant_id, p_actor_user_id, v_role, v_exc.fee_event_id, 'advisor', v_id, NULL,
        'adviser', NULL, v_exc.id, NULL,
        jsonb_build_object('exception_id', v_exc.id, 'reason', v_reason,
                           'owner_determined_advisers', to_jsonb(v_ids)));
      outcome := v_r.outcome;
      ledger_event_id := v_r.ledger_event_id;
      child_exception_id := v_r.exception_id;
      RETURN NEXT;
    END LOOP;
    v_any := true;
  END IF;

  UPDATE public.finance_commission_exceptions e
  SET status = 'resolved', resolution = p_resolution,
      resolution_pct = CASE WHEN p_resolution = 'event_pct' THEN p_pct END,
      resolution_adviser_ids = CASE WHEN p_resolution = 'advisers_determined' THEN v_ids END,
      resolution_reason = v_reason, resolved_by = p_actor_user_id, resolved_at = now()
  WHERE e.id = v_exc.id;
  PERFORM public.network_finance_audit(
    p_tenant_id, p_actor_user_id, v_role, 'commission_exception_resolved', v_exc.session_id, NULL,
    v_exc.fee_type, 'Commission exception resolved by Owner',
    jsonb_build_object('exception_id', v_exc.id, 'exception_kind', v_exc.exception_kind,
                       'resolution', p_resolution, 'pct', p_pct,
                       'adviser_user_ids', to_jsonb(v_ids), 'reason', v_reason));
END;
$$;

-- Payout status (D5/D6): Owner or Supervisor; received -> paid | rejected, rejected -> received
-- with a reason; paid and reversed are terminal. A commission on a reversed fee is frozen: a
-- rejected commission is never reopened once its fee is reversed.
CREATE FUNCTION public.set_commission_payout_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_event_id uuid,
  p_to_status text,
  p_note text
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_ev public.finance_ledger%ROWTYPE;
BEGIN
  PERFORM set_config('finance.b4b2_writer', 'on', true);
  v_role := public.finance_actor_role(p_tenant_id, p_actor_user_id, 'payout');
  IF p_to_status IS NULL OR p_to_status NOT IN ('received', 'paid', 'rejected')
     OR char_length(COALESCE(v_note, '')) > 500 THEN
    RAISE EXCEPTION 'finance_payout_transition_invalid';
  END IF;
  SELECT * INTO v_ev FROM public.finance_ledger g
  WHERE g.id = p_event_id AND g.tenant_id = p_tenant_id AND g.event_type = 'commission_accrued'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finance_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_ev.payout_status = p_to_status THEN
    RETURN v_ev.payout_status;
  END IF;
  IF v_ev.payout_status IN ('paid', 'reversed') THEN
    RAISE EXCEPTION 'finance_payout_terminal';
  END IF;
  IF v_ev.fee_line_id IS NULL OR EXISTS (
    SELECT 1 FROM public.finance_fee_lines f
    WHERE f.id = v_ev.fee_line_id AND f.tenant_id = p_tenant_id AND f.status::text <> 'posted') THEN
    RAISE EXCEPTION 'finance_fee_not_posted';
  END IF;
  IF NOT ((v_ev.payout_status = 'received' AND p_to_status IN ('paid', 'rejected'))
          OR (v_ev.payout_status = 'rejected' AND p_to_status = 'received')) THEN
    RAISE EXCEPTION 'finance_payout_transition_invalid';
  END IF;
  IF v_ev.payout_status = 'rejected' AND v_note IS NULL THEN
    RAISE EXCEPTION 'finance_reason_required';
  END IF;
  INSERT INTO public.finance_payout_transitions (
    tenant_id, ledger_event_id, transition_kind, from_status, to_status, actor_user_id,
    actor_role, reason
  )
  VALUES (p_tenant_id, v_ev.id, 'payout', v_ev.payout_status, p_to_status, p_actor_user_id,
          v_role, v_note);
  UPDATE public.finance_ledger g
  SET payout_status = p_to_status,
      payout_at = CASE WHEN p_to_status = 'received' THEN NULL ELSE now() END,
      payout_by = CASE WHEN p_to_status = 'received' THEN NULL ELSE p_actor_user_id END,
      payout_note = COALESCE(v_note, g.payout_note)
  WHERE g.id = v_ev.id;
  PERFORM public.network_finance_audit(
    p_tenant_id, p_actor_user_id, v_role, 'payout_status_changed', v_ev.session_id,
    v_ev.customer_id, v_ev.fee_type, 'Commission payout status changed',
    jsonb_build_object('event_id', v_ev.id, 'from', v_ev.payout_status, 'to', p_to_status,
                       'note', v_note, 'beneficiary_role', v_ev.beneficiary_role,
                       'beneficiary_user_id', v_ev.beneficiary_user_id,
                       'amount_pence', v_ev.amount_pence));
  RETURN p_to_status;
END;
$$;

-- Owner settlement or write-off of a due clawback; never automatic collection.
CREATE FUNCTION public.settle_commission_clawback(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_clawback_id uuid,
  p_outcome text,
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
  v_cb public.finance_ledger%ROWTYPE;
  v_event uuid;
BEGIN
  PERFORM set_config('finance.b4b2_writer', 'on', true);
  v_role := public.finance_actor_role(p_tenant_id, p_actor_user_id, 'owner');
  IF v_reason IS NULL OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'finance_reason_required';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('settled', 'written_off') THEN
    RAISE EXCEPTION 'finance_recovery_invalid';
  END IF;
  SELECT * INTO v_cb FROM public.finance_ledger g
  WHERE g.id = p_clawback_id AND g.tenant_id = p_tenant_id AND g.event_type = 'clawback'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finance_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_cb.recovery_status <> 'due' THEN
    RAISE EXCEPTION 'finance_recovery_closed';
  END IF;
  INSERT INTO public.finance_ledger (
    tenant_id, event_type, kind, idempotency_key, session_id, fee_line_id, customer_id, fee_type,
    amount_pence, is_reversal, beneficiary_user_id, beneficiary_role, beneficiary_capacity,
    introducer_id, beneficiary_name, beneficiary_code, economic_date, economic_at, referral_id,
    original_event_id, reason, created_by, actor_role, evidence, note
  )
  VALUES (
    p_tenant_id, CASE p_outcome WHEN 'settled' THEN 'clawback_settled'
                                ELSE 'clawback_written_off' END,
    'commission', '-', v_cb.session_id, v_cb.fee_line_id, v_cb.customer_id, v_cb.fee_type, 0,
    false, v_cb.beneficiary_user_id, v_cb.beneficiary_role, v_cb.beneficiary_capacity,
    v_cb.introducer_id, v_cb.beneficiary_name, v_cb.beneficiary_code, v_cb.economic_date,
    v_cb.economic_at, v_cb.referral_id, v_cb.id, v_reason, p_actor_user_id, v_role,
    jsonb_build_object('clawback_amount_pence', v_cb.amount_pence),
    CASE p_outcome WHEN 'settled' THEN 'Clawback settled' ELSE 'Clawback written off' END
  )
  RETURNING id INTO v_event;
  INSERT INTO public.finance_payout_transitions (
    tenant_id, ledger_event_id, transition_kind, from_status, to_status, actor_user_id,
    actor_role, reason
  )
  VALUES (p_tenant_id, v_cb.id, 'recovery', 'due', p_outcome, p_actor_user_id, v_role, v_reason);
  UPDATE public.finance_ledger g
  SET recovery_status = p_outcome, recovery_at = now(), recovery_by = p_actor_user_id
  WHERE g.id = v_cb.id;
  PERFORM public.network_finance_audit(
    p_tenant_id, p_actor_user_id, v_role,
    CASE p_outcome WHEN 'settled' THEN 'clawback_settled' ELSE 'clawback_written_off' END,
    v_cb.session_id, v_cb.customer_id, v_cb.fee_type,
    CASE p_outcome WHEN 'settled' THEN 'Clawback recovery settled by Owner'
                   ELSE 'Clawback written off by Owner' END,
    jsonb_build_object('clawback_event_id', v_cb.id, 'event_id', v_event, 'reason', v_reason,
                       'amount_pence', v_cb.amount_pence));
  RETURN v_event;
END;
$$;

-- L. Privileges.
ALTER TABLE public.finance_payout_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_commission_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_commission_determinations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_ledger, public.finance_audit_log, public.finance_payout_transitions,
  public.finance_commission_exceptions, public.finance_commission_determinations
  FROM PUBLIC, anon, authenticated;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.finance_ledger, public.finance_audit_log
  FROM service_role;
REVOKE UPDATE ON public.finance_audit_log FROM service_role;
REVOKE ALL ON public.finance_payout_transitions, public.finance_commission_exceptions,
  public.finance_commission_determinations FROM service_role;
GRANT SELECT, INSERT, UPDATE ON public.finance_ledger TO service_role;
GRANT SELECT, INSERT ON public.finance_audit_log TO service_role;
GRANT SELECT, INSERT ON public.finance_payout_transitions,
  public.finance_commission_determinations TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.finance_commission_exceptions TO service_role;

REVOKE ALL ON FUNCTION public.finance_ledger_guard(), public.finance_payout_transitions_guard(),
  public.finance_commission_exceptions_guard(), public.finance_append_only_guard(),
  public.finance_audit_log_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.finance_b4b2_writer(),
  public.resolve_customer_introducer_as_of(uuid, uuid, timestamptz),
  public.finance_actor_role(uuid, uuid, text),
  public.finance_commission_for_beneficiary(uuid, uuid, text, uuid, text, uuid, uuid, text, numeric, uuid, uuid, jsonb),
  public.finance_record_determination(uuid, uuid, uuid, text, uuid, text, uuid, jsonb),
  public.finance_post_fee_line(uuid, uuid, text, uuid, uuid),
  public.finance_cancel_accrual(uuid, uuid, text, uuid, text, text, text),
  public.post_session_fees(uuid, uuid, uuid, uuid[]),
  public.reverse_posted_fee(uuid, uuid, uuid, text),
  public.post_fee_correction(uuid, uuid, uuid, integer, text, text),
  public.reassign_introducer_commission(uuid, uuid, uuid, uuid, text),
  public.claw_back_commission(uuid, uuid, uuid, text, uuid),
  public.resolve_commission_exception(uuid, uuid, uuid, text, numeric, uuid[], text),
  public.set_commission_payout_status(uuid, uuid, uuid, text, text),
  public.settle_commission_clawback(uuid, uuid, uuid, text, text),
  public.finance_prior_commission_hold(uuid, uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.finance_b4b2_writer(),
  public.resolve_customer_introducer_as_of(uuid, uuid, timestamptz),
  public.finance_actor_role(uuid, uuid, text),
  public.finance_commission_for_beneficiary(uuid, uuid, text, uuid, text, uuid, uuid, text, numeric, uuid, uuid, jsonb),
  public.finance_record_determination(uuid, uuid, uuid, text, uuid, text, uuid, jsonb),
  public.finance_post_fee_line(uuid, uuid, text, uuid, uuid),
  public.finance_cancel_accrual(uuid, uuid, text, uuid, text, text, text),
  public.post_session_fees(uuid, uuid, uuid, uuid[]),
  public.reverse_posted_fee(uuid, uuid, uuid, text),
  public.post_fee_correction(uuid, uuid, uuid, integer, text, text),
  public.reassign_introducer_commission(uuid, uuid, uuid, uuid, text),
  public.claw_back_commission(uuid, uuid, uuid, text, uuid),
  public.resolve_commission_exception(uuid, uuid, uuid, text, numeric, uuid[], text),
  public.set_commission_payout_status(uuid, uuid, uuid, text, text),
  public.settle_commission_clawback(uuid, uuid, uuid, text, text),
  public.finance_prior_commission_hold(uuid, uuid, text, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.post_session_fees(uuid, uuid, uuid, uuid[]) IS
  'G7F-4S4C4-B4b2: atomic, idempotent posting of an exact set of draft fee lines of one tenant session at their economic date with as-of adviser, introducer and rate resolution. service_role only.';
COMMENT ON FUNCTION public.resolve_customer_introducer_as_of(uuid, uuid, timestamptz) IS
  'G7F-4S4C4-B4b2: introducer attributed to a tenant session''s customer at p_event_at; parity with resolveIntroducerIdForCustomerAtDate. service_role only.';

-- M. Postconditions.
DO $$
DECLARE
  v_fn record;
BEGIN
  IF (SELECT count(*) FROM pg_trigger t
      WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
        AND t.tgname IN ('finance_ledger_append_only', 'finance_ledger_no_truncate',
                         'finance_payout_transitions_append_only',
                         'finance_payout_transitions_no_truncate',
                         'finance_commission_exceptions_guard',
                         'finance_commission_exceptions_no_truncate',
                         'finance_commission_determinations_append_only',
                         'finance_commission_determinations_no_truncate',
                         'finance_audit_log_append_only', 'finance_audit_log_no_truncate',
                         'finance_fee_lines_source_guard', 'finance_fee_lines_no_truncate')) <> 12 THEN
    RAISE EXCEPTION 'g7f4s4c4b4b2_postcondition:guard_trigger_missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint c
             WHERE c.conrelid IN ('public.finance_ledger'::regclass,
                                  'public.finance_payout_transitions'::regclass,
                                  'public.finance_commission_exceptions'::regclass,
                                  'public.finance_commission_determinations'::regclass)
               AND c.contype = 'f'
               AND (pg_get_constraintdef(c.oid) LIKE '%ON DELETE CASCADE%'
                    OR pg_get_constraintdef(c.oid) LIKE '%ON DELETE SET NULL%'))
     OR (SELECT count(*) FROM pg_constraint c
         WHERE c.conrelid = 'public.finance_ledger'::regclass AND c.contype = 'f'
           AND c.conname IN ('finance_ledger_session_tenant_fkey', 'finance_ledger_fee_tenant_fkey',
                             'finance_ledger_introducer_tenant_fkey',
                             'finance_ledger_original_tenant_fkey',
                             'finance_ledger_exception_tenant_fkey')
           AND cardinality(c.conkey) = 2) <> 5 THEN
    RAISE EXCEPTION 'g7f4s4c4b4b2_postcondition:keys';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES ('public.finance_ledger'), ('public.finance_audit_log'),
                 ('public.finance_payout_transitions'), ('public.finance_commission_exceptions'),
                 ('public.finance_commission_determinations')) AS t(rel)
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
                       ('REFERENCES'), ('TRIGGER')) AS p(priv)
    WHERE has_table_privilege(r.role, t.rel, p.priv)
  ) OR has_table_privilege('service_role', 'public.finance_ledger', 'DELETE')
    OR has_table_privilege('service_role', 'public.finance_ledger', 'TRUNCATE')
    OR has_table_privilege('service_role', 'public.finance_audit_log', 'UPDATE')
    OR has_table_privilege('service_role', 'public.finance_audit_log', 'DELETE')
    OR has_table_privilege('service_role', 'public.finance_audit_log', 'TRUNCATE')
    OR has_table_privilege('service_role', 'public.finance_payout_transitions', 'UPDATE,DELETE,TRUNCATE')
    OR has_table_privilege('service_role', 'public.finance_commission_determinations', 'UPDATE,DELETE,TRUNCATE')
    OR has_table_privilege('service_role', 'public.finance_commission_exceptions', 'DELETE,TRUNCATE')
  THEN
    RAISE EXCEPTION 'g7f4s4c4b4b2_postcondition:privileges';
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
    AND p.proname IN ('finance_b4b2_writer', 'finance_ledger_guard',
                      'finance_payout_transitions_guard', 'finance_commission_exceptions_guard',
                      'finance_append_only_guard', 'finance_audit_log_guard',
                      'finance_fee_lines_guard', 'resolve_customer_introducer_as_of',
                      'finance_actor_role', 'finance_commission_for_beneficiary',
                      'finance_record_determination', 'finance_post_fee_line',
                      'finance_cancel_accrual', 'post_session_fees', 'reverse_posted_fee',
                      'post_fee_correction', 'reassign_introducer_commission',
                      'claw_back_commission', 'resolve_commission_exception',
                      'set_commission_payout_status', 'settle_commission_clawback',
                      'finance_prior_commission_hold');
  IF v_fn.n IS DISTINCT FROM 22 OR v_fn.invoker IS NOT TRUE OR v_fn.safe_path IS NOT TRUE
     OR v_fn.acl_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'g7f4s4c4b4b2_postcondition:function_privileges';
  END IF;

  IF EXISTS (SELECT 1 FROM public.finance_ledger)
     OR EXISTS (SELECT 1 FROM public.finance_payout_transitions)
     OR EXISTS (SELECT 1 FROM public.finance_commission_exceptions)
     OR EXISTS (SELECT 1 FROM public.finance_commission_determinations) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b2_postcondition:financial_rows_created';
  END IF;
  -- Business rows unchanged on every pre-existing column.
  CREATE TEMP TABLE g7f4s4c4b4b2_rows_after AS
  SELECT 'finance_fee_lines'::text AS tbl,
    to_jsonb(t) - ARRAY['corrects_fee_line_id', 'reversed_at', 'reversed_by',
                        'reversal_reason'] AS j
  FROM public.finance_fee_lines t
  UNION ALL SELECT 'finance_audit_log', to_jsonb(t) FROM public.finance_audit_log t
  UNION ALL SELECT 'network_commission_statements', to_jsonb(t)
    FROM public.network_commission_statements t
  UNION ALL SELECT 'network_commission_lines', to_jsonb(t) FROM public.network_commission_lines t
  UNION ALL SELECT 'session_adviser_assignments', to_jsonb(t)
    FROM public.session_adviser_assignments t
  UNION ALL SELECT 'commission_rate_versions', to_jsonb(t) FROM public.commission_rate_versions t
  UNION ALL SELECT 'referrals', to_jsonb(t) FROM public.referrals t;
  IF EXISTS (
    (SELECT tbl, j FROM pg_temp.g7f4s4c4b4b2_rows_before
     EXCEPT ALL SELECT tbl, j FROM pg_temp.g7f4s4c4b4b2_rows_after)
    UNION ALL
    (SELECT tbl, j FROM pg_temp.g7f4s4c4b4b2_rows_after
     EXCEPT ALL SELECT tbl, j FROM pg_temp.g7f4s4c4b4b2_rows_before)
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b2_postcondition:business_data_changed';
  END IF;
  DROP TABLE pg_temp.g7f4s4c4b4b2_rows_after;
  IF EXISTS (SELECT 1 FROM public.finance_fee_lines f
             WHERE f.corrects_fee_line_id IS NOT NULL OR f.reversed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'g7f4s4c4b4b2_postcondition:fee_provenance_claimed';
  END IF;
END
$$;

-- N.
DROP TABLE pg_temp.g7f4s4c4b4b2_rows_before;
