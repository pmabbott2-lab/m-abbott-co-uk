-- G7F-4S4C4-B4b2-F1 — deterministic lock order for commission payout changes.
--
-- Lock order for every case-scoped finance RPC: the tenant and the actor's membership (shared,
-- finance_actor_role), then the case (interview_sessions FOR UPDATE), then the fee line, then the
-- ledger rows. set_commission_payout_status locked the accrual first and then, through the
-- finance_audit_log case foreign key, needed a key share lock on the case; an Owner reversal,
-- clawback or reassignment of the same commission holds the case and waits for the accrual, so the
-- two deadlocked (40P01). The payout RPC now locks the case before the accrual and so queues behind
-- (or ahead of) the Owner adjustment instead.
--
-- Authority (Owner/Supervisor), transition rules, paid/reversed terminality, the reopen reason,
-- immutable transition history, audit and privileges are unchanged. No data is read or written.
--
-- Forward-only; replaces only set_commission_payout_status. Fails closed unless B4b2 is applied.

-- A. Preconditions.
DO $$
BEGIN
  IF to_regprocedure('public.set_commission_payout_status(uuid, uuid, uuid, text, text)') IS NULL
     OR to_regclass('public.finance_payout_transitions') IS NULL
     OR to_regprocedure('public.finance_actor_role(uuid, uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'g7f4s4c4b4b2f1_precondition:b4b2_missing';
  END IF;
END
$$;

-- B. Payout status (D5/D6): Owner or Supervisor; received -> paid | rejected, rejected -> received
-- with a reason; paid and reversed are terminal. A commission on a reversed fee is frozen: a
-- rejected commission is never reopened once its fee is reversed.
CREATE OR REPLACE FUNCTION public.set_commission_payout_status(
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
  v_session uuid;
BEGIN
  PERFORM set_config('finance.b4b2_writer', 'on', true);
  v_role := public.finance_actor_role(p_tenant_id, p_actor_user_id, 'payout');
  IF p_to_status IS NULL OR p_to_status NOT IN ('received', 'paid', 'rejected')
     OR char_length(COALESCE(v_note, '')) > 500 THEN
    RAISE EXCEPTION 'finance_payout_transition_invalid';
  END IF;
  SELECT g.session_id INTO v_session FROM public.finance_ledger g
  WHERE g.id = p_event_id AND g.tenant_id = p_tenant_id AND g.event_type = 'commission_accrued';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finance_resource_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_session IS NOT NULL THEN
    PERFORM 1 FROM public.interview_sessions s
    WHERE s.id = v_session AND s.tenant_id = p_tenant_id FOR UPDATE;
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

-- C. Privileges (as B4b2): service_role only.
REVOKE ALL ON FUNCTION public.set_commission_payout_status(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_commission_payout_status(uuid, uuid, uuid, text, text)
  TO service_role;

-- D. Postconditions.
DO $$
DECLARE
  v_fn record;
BEGIN
  SELECT p.prosecdef, p.proconfig, p.prosrc, p.oid, p.proacl, p.proowner INTO v_fn
  FROM pg_proc p
  WHERE p.oid = 'public.set_commission_payout_status(uuid, uuid, uuid, text, text)'::regprocedure;
  IF v_fn.prosecdef OR v_fn.proconfig IS DISTINCT FROM ARRAY['search_path=""']
     OR has_function_privilege('anon', v_fn.oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn.oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM aclexplode(COALESCE(v_fn.proacl, acldefault('f', v_fn.proowner))) a
                WHERE a.grantee = 0)
     OR NOT has_function_privilege('service_role', v_fn.oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'g7f4s4c4b4b2f1_postcondition:function_privileges';
  END IF;
  IF strpos(v_fn.prosrc, 'FROM public.interview_sessions s') = 0
     OR strpos(v_fn.prosrc, 'FROM public.interview_sessions s')
        > strpos(v_fn.prosrc, 'SELECT * INTO v_ev FROM public.finance_ledger g') THEN
    RAISE EXCEPTION 'g7f4s4c4b4b2f1_postcondition:case_lock_order';
  END IF;
END
$$;
