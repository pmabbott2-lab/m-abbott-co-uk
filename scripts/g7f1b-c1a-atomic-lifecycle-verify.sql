/**
 * G7F-1B-C1A disposable SQL verification for establish_break_glass_identity.
 * Post-C2: BG1 (staging-g7f1b-break-glass@example.test) intentionally exists as the active BG.
 * BG1's classification + super_owner row are parked for the functional cases and restored
 * exactly (same identity row, same role row). Final state: SO=3 / NORMAL=2 / ACTIVE_BG=1 (BG1).
 * Apply via staging MCP execute_sql (service_role / postgres); prefer running rollback-only.
 */
CREATE SCHEMA IF NOT EXISTS g6b_private;
CREATE TABLE IF NOT EXISTS g6b_private.g7f1bc1a_test_results (
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
TRUNCATE g6b_private.g7f1bc1a_test_results;

DO $body$
DECLARE
  r jsonb := '[]'::jsonb;
  v_so1 uuid; v_so2 uuid;
  v_ord uuid; v_sa uuid; v_d1 uuid; v_d2 uuid;
  v_res jsonb; v_ok boolean; v_detail text;
  v_cnt int; v_audit_created int; v_audit_replaced int;
  v_missing uuid := '00000000-0000-4000-8000-000000000099';
  v_bg1 uuid;
  v_bg1_identity public.platform_break_glass_identities%ROWTYPE;
  v_bg1_role public.platform_roles%ROWTYPE;
BEGIN
  SELECT u.id INTO v_so1 FROM auth.users u WHERE lower(u.email) = 'pmabbott2@aol.com';
  SELECT u.id INTO v_so2 FROM auth.users u WHERE lower(u.email) = 'staging-g7f1a-super-owner@example.test';
  IF v_so1 IS NULL OR v_so2 IS NULL THEN
    RAISE EXCEPTION 'G7F1B-C1A STOP: standing SO fixtures missing';
  END IF;
  SELECT u.id INTO v_bg1 FROM auth.users u WHERE lower(u.email) = 'staging-g7f1b-break-glass@example.test';
  SELECT * INTO v_bg1_identity FROM public.platform_break_glass_identities WHERE user_id = v_bg1 AND active;
  SELECT * INTO v_bg1_role FROM public.platform_roles WHERE user_id = v_bg1 AND role = 'super_owner';
  IF v_bg1 IS NULL OR v_bg1_identity.id IS NULL OR v_bg1_role.id IS NULL
     OR (SELECT COUNT(*) FROM public.platform_break_glass_identities WHERE active) <> 1 THEN
    RAISE EXCEPTION 'G7F1B-C1A STOP: post-C2 BG1 state not as expected';
  END IF;

  -- Park BG1 so the functional cases run against the no-active-BG precondition.
  UPDATE public.platform_break_glass_identities
  SET active = false, deactivated_at = now()
  WHERE id = v_bg1_identity.id;
  DELETE FROM public.platform_roles WHERE id = v_bg1_role.id;

  -- Cleanup prior leftovers
  DELETE FROM public.platform_break_glass_identities
  WHERE reason ILIKE 'g7f1bc1a%'
     OR user_id IN (SELECT id FROM auth.users WHERE email LIKE 'staging-g7f1bc1a-%@example.test');
  DELETE FROM public.security_audit_events
  WHERE metadata->>'source' = 'establish_break_glass_identity'
    AND metadata->>'reason' ILIKE 'g7f1bc1a%';
  DELETE FROM public.platform_roles WHERE user_id IN (
    SELECT id FROM auth.users WHERE email LIKE 'staging-g7f1bc1a-%@example.test'
  );
  DELETE FROM public.tenant_memberships WHERE user_id IN (
    SELECT id FROM auth.users WHERE email LIKE 'staging-g7f1bc1a-%@example.test'
  );
  DELETE FROM auth.users WHERE email LIKE 'staging-g7f1bc1a-%@example.test';
  DELETE FROM g6b_private.staging_credentials WHERE email LIKE 'staging-g7f1bc1a-%@example.test';

  v_ord := g6b_private.create_persona('staging-g7f1bc1a-ord@example.test', 'G7F1BC1A Ord', '07000002001');
  v_sa := g6b_private.create_persona('staging-g7f1bc1a-sa@example.test', 'G7F1BC1A SA', '07000002002');
  v_d1 := g6b_private.create_persona('staging-g7f1bc1a-d1@example.test', 'G7F1BC1A D1', '07000002003');
  v_d2 := g6b_private.create_persona('staging-g7f1bc1a-d2@example.test', 'G7F1BC1A D2', '07000002004');
  INSERT INTO public.platform_roles (user_id, role) VALUES (v_sa, 'super_admin') ON CONFLICT DO NOTHING;

  -- A invalid actor (ordinary)
  BEGIN
    PERFORM public.establish_break_glass_identity(v_d1, v_ord, 'g7f1bc1a invalid actor');
    v_ok := false; v_detail := 'unexpected success';
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM ILIKE '%break_glass_lifecycle_actor_not_super_owner%';
    v_detail := SQLERRM;
  END;
  v_ok := v_ok
    AND NOT EXISTS (SELECT 1 FROM public.platform_roles WHERE user_id = v_d1 AND role = 'super_owner')
    AND NOT public.is_active_break_glass(v_d1)
    AND NOT EXISTS (
      SELECT 1 FROM public.security_audit_events
      WHERE event_type IN ('BREAK_GLASS_IDENTITY_CREATED','BREAK_GLASS_IDENTITY_REPLACED')
        AND metadata->>'reason' = 'g7f1bc1a invalid actor'
    );
  r := r || jsonb_build_array(jsonb_build_object('test','A_invalid_actor','ok',v_ok,'detail',v_detail));

  -- A2 SA actor denied
  BEGIN
    PERFORM public.establish_break_glass_identity(v_d1, v_sa, 'g7f1bc1a sa actor');
    v_ok := false; v_detail := 'unexpected success';
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM ILIKE '%break_glass_lifecycle_actor_not_super_owner%';
    v_detail := SQLERRM;
  END;
  r := r || jsonb_build_array(jsonb_build_object('test','A2_sa_actor_denied','ok',v_ok,'detail',v_detail));

  -- B nonexistent target
  BEGIN
    PERFORM public.establish_break_glass_identity(v_missing, v_so1, 'g7f1bc1a missing target');
    v_ok := false; v_detail := 'unexpected success';
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM ILIKE '%break_glass_lifecycle_target_missing%';
    v_detail := SQLERRM;
  END;
  v_ok := v_ok AND NOT EXISTS (
    SELECT 1 FROM public.security_audit_events WHERE metadata->>'reason' = 'g7f1bc1a missing target'
  );
  r := r || jsonb_build_array(jsonb_build_object('test','B_nonexistent_target','ok',v_ok,'detail',v_detail));

  -- C first create
  v_res := public.establish_break_glass_identity(v_d1, v_so1, 'g7f1bc1a create d1');
  v_ok := (v_res->>'outcome') = 'created'
    AND public.is_active_break_glass(v_d1)
    AND public.is_super_owner(v_d1)
    AND NOT public.is_normal_super_owner(v_d1)
    AND public.count_super_owners() = 3
    AND public.count_normal_super_owners() = 2
    AND EXISTS (
      SELECT 1 FROM public.security_audit_events
      WHERE event_type = 'BREAK_GLASS_IDENTITY_CREATED'
        AND acting_user_id = v_so1
        AND subject_user_id = v_d1
        AND metadata->>'reason' = 'g7f1bc1a create d1'
        AND metadata->>'source' = 'establish_break_glass_identity'
    );
  r := r || jsonb_build_array(jsonb_build_object('test','C_first_create','ok',v_ok,'result',v_res));

  -- D same target idempotent
  SELECT COUNT(*)::int INTO v_audit_created
  FROM public.security_audit_events
  WHERE event_type = 'BREAK_GLASS_IDENTITY_CREATED'
    AND subject_user_id = v_d1
    AND metadata->>'reason' LIKE 'g7f1bc1a%';
  v_res := public.establish_break_glass_identity(v_d1, v_so1, 'g7f1bc1a already');
  v_ok := (v_res->>'outcome') = 'already_active'
    AND (SELECT COUNT(*)::int FROM public.security_audit_events
         WHERE event_type = 'BREAK_GLASS_IDENTITY_CREATED'
           AND subject_user_id = v_d1
           AND metadata->>'reason' LIKE 'g7f1bc1a%') = v_audit_created
    AND NOT EXISTS (
      SELECT 1 FROM public.security_audit_events
      WHERE metadata->>'reason' = 'g7f1bc1a already'
    );
  r := r || jsonb_build_array(jsonb_build_object('test','D_same_target_idempotent','ok',v_ok,'result',v_res));

  -- E replacement
  v_res := public.establish_break_glass_identity(v_d2, v_so2, 'g7f1bc1a replace d2');
  v_ok := (v_res->>'outcome') = 'replaced'
    AND public.is_active_break_glass(v_d2)
    AND NOT public.is_active_break_glass(v_d1)
    AND public.is_super_owner(v_d1)  -- previous BG keeps SO role
    AND public.is_super_owner(v_d2)
    AND (SELECT COUNT(*)::int FROM public.platform_break_glass_identities WHERE active) = 1
    AND public.count_normal_super_owners() = 3  -- SO1, SO2, D1
    AND EXISTS (
      SELECT 1 FROM public.security_audit_events
      WHERE event_type = 'BREAK_GLASS_IDENTITY_REPLACED'
        AND acting_user_id = v_so2
        AND subject_user_id = v_d2
        AND metadata->>'previous_user_id' = v_d1::text
        AND metadata->>'reason' = 'g7f1bc1a replace d2'
    );
  r := r || jsonb_build_array(jsonb_build_object('test','E_replacement','ok',v_ok,'result',v_res));

  -- F classification failure: temporarily demote SO2 so SO1 is sole normal; establish(SO1) denied.
  UPDATE public.platform_break_glass_identities SET active = false, deactivated_at = now()
  WHERE active = true;
  DELETE FROM public.platform_roles WHERE user_id IN (v_d1, v_d2) AND role = 'super_owner';
  DELETE FROM public.platform_roles WHERE user_id = v_so2 AND role = 'super_owner';
  BEGIN
    PERFORM public.establish_break_glass_identity(v_so1, v_so1, 'g7f1bc1a classify fail');
    v_ok := false; v_detail := 'unexpected success';
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM ILIKE '%last_normal_super_owner_protected%';
    v_detail := SQLERRM;
  END;
  INSERT INTO public.platform_roles (user_id, role) VALUES (v_so2, 'super_owner') ON CONFLICT DO NOTHING;
  v_ok := v_ok
    AND NOT public.is_active_break_glass(v_so1)
    AND NOT EXISTS (
      SELECT 1 FROM public.security_audit_events WHERE metadata->>'reason' = 'g7f1bc1a classify fail'
    );
  r := r || jsonb_build_array(jsonb_build_object('test','F_classification_failure','ok',v_ok,'detail',v_detail));

  -- G grants: anon/authenticated cannot execute (checked outside); structural lock
  v_ok := (
    SELECT pg_get_functiondef(p.oid) ILIKE '%pg_advisory_xact_lock(872014002)%'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'establish_break_glass_identity'
  );
  r := r || jsonb_build_array(jsonb_build_object('test','G_advisory_lock_structural','ok',v_ok));

  -- H audit in same function (static position check via definition)
  v_ok := (
    SELECT pg_get_functiondef(p.oid) ILIKE '%BREAK_GLASS_IDENTITY_CREATED%'
       AND pg_get_functiondef(p.oid) ILIKE '%BREAK_GLASS_IDENTITY_REPLACED%'
       AND pg_get_functiondef(p.oid) ILIKE '%security_audit_events%'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'establish_break_glass_identity'
  );
  r := r || jsonb_build_array(jsonb_build_object('test','H_audit_in_rpc_structural','ok',v_ok));

  -- Cleanup disposables + temp SO1 BG audit rows for this gate
  DELETE FROM public.platform_break_glass_identities
  WHERE reason ILIKE 'g7f1bc1a%'
     OR user_id IN (SELECT id FROM auth.users WHERE email LIKE 'staging-g7f1bc1a-%@example.test');
  -- Ensure SO1 not left as BG
  UPDATE public.platform_break_glass_identities
  SET active = false, deactivated_at = COALESCE(deactivated_at, now())
  WHERE user_id = v_so1 AND active = true;
  DELETE FROM public.security_audit_events
  WHERE metadata->>'source' = 'establish_break_glass_identity'
    AND metadata->>'reason' ILIKE 'g7f1bc1a%';
  DELETE FROM public.platform_roles WHERE user_id IN (
    SELECT id FROM auth.users WHERE email LIKE 'staging-g7f1bc1a-%@example.test'
  );
  DELETE FROM public.tenant_memberships WHERE user_id IN (
    SELECT id FROM auth.users WHERE email LIKE 'staging-g7f1bc1a-%@example.test'
  );
  DELETE FROM auth.users WHERE email LIKE 'staging-g7f1bc1a-%@example.test';
  DELETE FROM g6b_private.staging_credentials WHERE email LIKE 'staging-g7f1bc1a-%@example.test';

  -- Restore BG1 exactly: role row first (identity trigger requires super_owner), then classification.
  INSERT INTO public.platform_roles SELECT v_bg1_role.*;
  UPDATE public.platform_break_glass_identities
  SET active = v_bg1_identity.active,
      deactivated_at = v_bg1_identity.deactivated_at,
      deactivated_by = v_bg1_identity.deactivated_by,
      replaced_at = v_bg1_identity.replaced_at,
      replaced_by = v_bg1_identity.replaced_by
  WHERE id = v_bg1_identity.id;

  v_ok := public.count_super_owners() = 3
    AND public.count_normal_super_owners() = 2
    AND (SELECT COUNT(*)::int FROM public.platform_break_glass_identities WHERE active) = 1
    AND public.is_super_owner(v_so1) AND public.is_normal_super_owner(v_so1)
    AND public.is_super_owner(v_so2) AND public.is_normal_super_owner(v_so2)
    AND public.is_super_owner(v_bg1) AND public.is_active_break_glass(v_bg1)
    AND NOT public.is_normal_super_owner(v_bg1)
    AND (SELECT id FROM public.platform_break_glass_identities WHERE active) = v_bg1_identity.id
    AND EXISTS (
      SELECT 1 FROM public.platform_roles
      WHERE id = v_bg1_role.id AND user_id = v_bg1 AND role = 'super_owner'
        AND created_at = v_bg1_role.created_at AND created_by IS NOT DISTINCT FROM v_bg1_role.created_by
    )
    AND NOT EXISTS (SELECT 1 FROM public.tenant_memberships WHERE user_id = v_bg1)
    AND NOT EXISTS (SELECT 1 FROM auth.users WHERE email LIKE 'staging-g7f1bc1a-%@example.test');
  r := r || jsonb_build_array(jsonb_build_object('test','Z_final_state','ok',v_ok,
    'so', public.count_super_owners(),
    'normal', public.count_normal_super_owners(),
    'bg', (SELECT COUNT(*)::int FROM public.platform_break_glass_identities WHERE active),
    'bg1_restored', public.is_active_break_glass(v_bg1)));

  INSERT INTO g6b_private.g7f1bc1a_test_results (payload) VALUES (r);
END;
$body$;

SELECT payload FROM g6b_private.g7f1bc1a_test_results ORDER BY created_at DESC LIMIT 1;
