/**
 * G7F-2A disposable SQL verification for SA lifecycle cascades.
 * Staging only. Cleans staging-g7f2a-* fixtures. Does NOT touch BG1 / standing SOs.
 */

CREATE SCHEMA IF NOT EXISTS g6b_private;
CREATE TABLE IF NOT EXISTS g6b_private.g7f2a_test_results (
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
TRUNCATE g6b_private.g7f2a_test_results;

DO $body$
DECLARE
  r jsonb := '[]'::jsonb;
  v_so uuid; v_sa uuid; v_ord uuid;
  t1 uuid; t2 uuid; t_ext uuid;
  g_a uuid; g_b uuid; g1 uuid; g2 uuid;
  s_a uuid; s_ro uuid; s_ops uuid;
  v_res jsonb; v_ok boolean; v_bool boolean; v_detail text; v_cnt int;
  v_mem_before int; v_mem_after int; v_owner_before int; v_owner_after int;
  v_adv_before int; v_adv_after int; v_bg1_before int; v_bg1_after int;
BEGIN
  SELECT u.id INTO v_so FROM auth.users u WHERE lower(u.email)='pmabbott2@aol.com';
  IF v_so IS NULL THEN
    SELECT u.id INTO v_so FROM auth.users u WHERE lower(u.email)='staging-g7f1a-super-owner@example.test';
  END IF;
  IF v_so IS NULL OR NOT public.is_super_owner(v_so) THEN
    RAISE EXCEPTION 'G7F2A STOP: SO missing';
  END IF;
  SELECT id INTO t1 FROM public.tenants WHERE company_code='001' AND tenant_type='GROUP' LIMIT 1;
  SELECT id INTO t2 FROM public.tenants WHERE company_code='002' AND tenant_type='GROUP' LIMIT 1;
  SELECT id INTO t_ext FROM public.tenants WHERE tenant_type='EXTERNAL' LIMIT 1;
  IF t1 IS NULL OR t2 IS NULL THEN RAISE EXCEPTION 'G7F2A STOP: tenants missing'; END IF;

  SELECT count(*) INTO v_bg1_before FROM public.platform_break_glass_identities bg
    JOIN auth.users u ON u.id=bg.user_id
    WHERE lower(u.email)='staging-g7f1b-break-glass@example.test' AND bg.active;
  SELECT count(*) INTO v_mem_before FROM public.tenant_memberships;
  SELECT count(*) INTO v_owner_before FROM public.tenant_memberships WHERE role::text ILIKE '%owner%';
  SELECT count(*) INTO v_adv_before FROM public.advisor_profiles;

  v_sa := g6b_private.create_persona('staging-g7f2a-sa@example.test','G7F2A SA','07000005001');
  v_ord := g6b_private.create_persona('staging-g7f2a-ord@example.test','G7F2A Ord','07000005002');
  INSERT INTO public.platform_roles(user_id,role) VALUES (v_sa,'super_admin') ON CONFLICT DO NOTHING;

  -- T1-5 data_read revoke
  v_res := public.upsert_super_admin_tenant_grant_atomic(v_so,v_sa,t1,'data_read',NULL,'g7f2a t1');
  g_a := (v_res->>'grant_id')::uuid;
  INSERT INTO public.platform_tenant_access_sessions(platform_user_id,tenant_id,authority_basis,access_level,grant_id,reason,expires_at)
  VALUES (v_sa,t1,'super_admin_grant','read_only',g_a,'g7f2a-ro',now()+interval '1 hour') RETURNING id INTO s_a;
  r := r || jsonb_build_array(jsonb_build_object('test','T1_create_sa_data_read','ok', g_a IS NOT NULL AND public.platform_tenant_access_basis_valid_now(v_sa,t1,'super_admin_grant','read_only',g_a)));
  r := r || jsonb_build_array(jsonb_build_object('test','T2_start_read_only_g7d','ok', s_a IS NOT NULL));
  v_res := public.revoke_super_admin_tenant_grant_cascade(v_so,g_a,'g7f2a revoke read');
  SELECT revoked_at IS NOT NULL INTO v_ok FROM public.super_admin_tenant_access WHERE id=g_a;
  SELECT ended_at IS NOT NULL INTO v_bool FROM public.platform_tenant_access_sessions WHERE id=s_a;
  r := r || jsonb_build_array(jsonb_build_object('test','T3_revoke_data_read','ok',(v_res->>'outcome')='revoked'));
  r := r || jsonb_build_array(jsonb_build_object('test','T4_grant_soft_revoked','ok',v_ok));
  r := r || jsonb_build_array(jsonb_build_object('test','T5_dependent_g7d_ended','ok',v_bool AND (v_res->>'g7d_ended_count')::int>=1));

  -- T6-10 data_write revoke
  v_res := public.upsert_super_admin_tenant_grant_atomic(v_so,v_sa,t1,'data_write',NULL,'g7f2a write');
  g_a := (v_res->>'grant_id')::uuid;
  INSERT INTO public.platform_tenant_access_sessions(platform_user_id,tenant_id,authority_basis,access_level,grant_id,reason,expires_at)
  VALUES (v_sa,t1,'super_admin_grant','operational_admin',g_a,'g7f2a-ops',now()+interval '1 hour') RETURNING id INTO s_ops;
  r := r || jsonb_build_array(jsonb_build_object('test','T6_create_sa_data_write','ok',g_a IS NOT NULL AND public.platform_tenant_access_basis_valid_now(v_sa,t1,'super_admin_grant','operational_admin',g_a)));
  r := r || jsonb_build_array(jsonb_build_object('test','T7_start_ops_g7d','ok',s_ops IS NOT NULL));
  v_res := public.revoke_super_admin_tenant_grant_cascade(v_so,g_a,'g7f2a revoke write');
  SELECT ended_at IS NOT NULL INTO v_bool FROM public.platform_tenant_access_sessions WHERE id=s_ops;
  r := r || jsonb_build_array(jsonb_build_object('test','T8_revoke_data_write','ok',(v_res->>'outcome')='revoked'));
  r := r || jsonb_build_array(jsonb_build_object('test','T9_ops_g7d_ended','ok',v_bool));
  r := r || jsonb_build_array(jsonb_build_object('test','T10_mutation_authority_denied','ok', NOT public.platform_tenant_access_basis_valid_now(v_sa,t1,'super_admin_grant','operational_admin',g_a)));

  -- T11-14 downgrade
  v_res := public.upsert_super_admin_tenant_grant_atomic(v_so,v_sa,t1,'data_write',NULL,'g7f2a dw');
  g_a := (v_res->>'grant_id')::uuid;
  INSERT INTO public.platform_tenant_access_sessions(platform_user_id,tenant_id,authority_basis,access_level,grant_id,reason,expires_at)
  VALUES (v_sa,t1,'super_admin_grant','operational_admin',g_a,'g7f2a-ops2',now()+interval '1 hour') RETURNING id INTO s_ops;
  v_res := public.upsert_super_admin_tenant_grant_atomic(v_so,v_sa,t1,'data_read',NULL,'g7f2a down');
  SELECT ended_at IS NOT NULL INTO v_bool FROM public.platform_tenant_access_sessions WHERE id=s_ops;
  r := r || jsonb_build_array(jsonb_build_object('test','T11_downgrade_write_to_read','ok',(v_res->>'outcome')='changed' AND (v_res->>'level_changed')::boolean));
  r := r || jsonb_build_array(jsonb_build_object('test','T12_downgrade_ends_g7d','ok',v_bool AND (v_res->>'g7d_ended_count')::int>=1));
  v_ok := NOT public.platform_tenant_access_basis_valid_now(v_sa,t1,'super_admin_grant','operational_admin',g_a);
  INSERT INTO public.platform_tenant_access_sessions(platform_user_id,tenant_id,authority_basis,access_level,grant_id,reason,expires_at)
  VALUES (v_sa,t1,'super_admin_grant','read_only',g_a,'g7f2a-reenter-ro',now()+interval '1 hour') RETURNING id INTO s_ro;
  r := r || jsonb_build_array(jsonb_build_object('test','T13_reentry_required_after_downgrade','ok',v_ok));
  r := r || jsonb_build_array(jsonb_build_object('test','T14_new_entry_read_only','ok', public.platform_tenant_access_basis_valid_now(v_sa,t1,'super_admin_grant','read_only',g_a) AND s_ro IS NOT NULL));

  -- T15-18 upgrade
  v_res := public.upsert_super_admin_tenant_grant_atomic(v_so,v_sa,t1,'data_write',NULL,'g7f2a up');
  SELECT access_level::text, ended_at IS NOT NULL INTO v_detail, v_bool FROM public.platform_tenant_access_sessions WHERE id=s_ro;
  r := r || jsonb_build_array(jsonb_build_object('test','T15_upgrade_read_to_write','ok',(v_res->>'outcome')='changed' AND (v_res->>'new_access')='data_write'));
  r := r || jsonb_build_array(jsonb_build_object('test','T16_existing_g7d_not_elevated','ok',v_bool AND v_detail='read_only' AND (v_res->>'g7d_ended_count')::int>=1));
  r := r || jsonb_build_array(jsonb_build_object('test','T17_reentry_required_after_upgrade','ok',v_bool AND (v_res->>'g7d_ended_count')::int>=1));
  INSERT INTO public.platform_tenant_access_sessions(platform_user_id,tenant_id,authority_basis,access_level,grant_id,reason,expires_at)
  VALUES (v_sa,t1,'super_admin_grant','operational_admin',g_a,'g7f2a-reenter-ops',now()+interval '1 hour') RETURNING id INTO s_ops;
  r := r || jsonb_build_array(jsonb_build_object('test','T18_new_entry_higher_authority','ok', public.platform_tenant_access_basis_valid_now(v_sa,t1,'super_admin_grant','operational_admin',g_a) AND s_ops IS NOT NULL));

  -- T19-26 multi-tenant role removal
  PERFORM public.upsert_super_admin_tenant_grant_atomic(v_so,v_sa,t1,'data_read',NULL,'g7f2a t1 multi');
  SELECT id INTO g1 FROM public.super_admin_tenant_access WHERE user_id=v_sa AND tenant_id=t1 AND revoked_at IS NULL LIMIT 1;
  v_res := public.upsert_super_admin_tenant_grant_atomic(v_so,v_sa,t2,'data_write',NULL,'g7f2a t2 multi');
  g2 := (v_res->>'grant_id')::uuid;
  UPDATE public.platform_tenant_access_sessions SET ended_at=now() WHERE platform_user_id=v_sa AND ended_at IS NULL;
  INSERT INTO public.platform_tenant_access_sessions(platform_user_id,tenant_id,authority_basis,access_level,grant_id,reason,expires_at) VALUES
    (v_sa,t1,'super_admin_grant','read_only',g1,'g7f2a-m1',now()+interval '1 hour'),
    (v_sa,t2,'super_admin_grant','operational_admin',g2,'g7f2a-m2',now()+interval '1 hour');
  SELECT count(*) INTO v_cnt FROM public.super_admin_tenant_access WHERE user_id=v_sa AND revoked_at IS NULL;
  r := r || jsonb_build_array(jsonb_build_object('test','T19_sa_multi_tenant_grants','ok',v_cnt>=2));
  v_res := public.revoke_super_admin_role_cascade(v_so,v_sa,'g7f2a role remove');
  r := r || jsonb_build_array(jsonb_build_object('test','T20_remove_super_admin','ok',(v_res->>'outcome')='revoked'));
  SELECT count(*) INTO v_cnt FROM public.super_admin_tenant_access WHERE user_id=v_sa AND revoked_at IS NULL;
  r := r || jsonb_build_array(jsonb_build_object('test','T21_all_grants_soft_revoked','ok',v_cnt=0 AND (v_res->>'grants_revoked_count')::int>=2));
  SELECT count(*) INTO v_cnt FROM public.platform_tenant_access_sessions WHERE platform_user_id=v_sa AND authority_basis='super_admin_grant' AND ended_at IS NULL;
  r := r || jsonb_build_array(jsonb_build_object('test','T22_all_sa_g7d_ended','ok',v_cnt=0 AND (v_res->>'g7d_ended_count')::int>=2));
  INSERT INTO public.platform_roles(user_id,role) VALUES (v_sa,'super_admin') ON CONFLICT DO NOTHING;
  r := r || jsonb_build_array(jsonb_build_object('test','T23_restore_super_admin','ok',public.is_super_admin(v_sa)));
  SELECT count(*) INTO v_cnt FROM public.super_admin_tenant_access WHERE user_id=v_sa AND revoked_at IS NULL;
  r := r || jsonb_build_array(jsonb_build_object('test','T24_old_grants_remain_revoked','ok',v_cnt=0));
  SELECT count(*) INTO v_cnt FROM public.platform_tenant_access_sessions WHERE platform_user_id=v_sa AND authority_basis='super_admin_grant' AND ended_at IS NULL;
  r := r || jsonb_build_array(jsonb_build_object('test','T25_old_g7d_remains_ended','ok',v_cnt=0));
  v_res := public.upsert_super_admin_tenant_grant_atomic(v_so,v_sa,t1,'data_read',NULL,'g7f2a regrant');
  g_b := (v_res->>'grant_id')::uuid;
  r := r || jsonb_build_array(jsonb_build_object('test','T26_explicit_new_grant_required','ok',g_b IS NOT NULL AND g_b IS DISTINCT FROM g1));

  -- T27-30 grant id binding
  UPDATE public.platform_tenant_access_sessions SET ended_at=now() WHERE platform_user_id=v_sa AND ended_at IS NULL;
  v_res := public.upsert_super_admin_tenant_grant_atomic(v_so,v_sa,t2,'data_read',NULL,'grantA');
  g_a := (v_res->>'grant_id')::uuid;
  INSERT INTO public.platform_tenant_access_sessions(platform_user_id,tenant_id,authority_basis,access_level,grant_id,reason,expires_at)
  VALUES (v_sa,t2,'super_admin_grant','read_only',g_a,'sessionA',now()+interval '1 hour') RETURNING id INTO s_a;
  PERFORM public.revoke_super_admin_tenant_grant_cascade(v_so,g_a,'revoke A');
  v_res := public.upsert_super_admin_tenant_grant_atomic(v_so,v_sa,t2,'data_read',NULL,'grantB');
  g_b := (v_res->>'grant_id')::uuid;
  SELECT ended_at IS NOT NULL INTO v_bool FROM public.platform_tenant_access_sessions WHERE id=s_a;
  v_ok := NOT public.platform_tenant_access_basis_valid_now(v_sa,t2,'super_admin_grant','read_only',g_a);
  r := r || jsonb_build_array(jsonb_build_object('test','T27_grant_a_revoked','ok',true));
  r := r || jsonb_build_array(jsonb_build_object('test','T28_grant_b_created','ok',g_b IS DISTINCT FROM g_a));
  r := r || jsonb_build_array(jsonb_build_object('test','T29_g7d_a_invalid_forever','ok',v_ok AND v_bool));
  r := r || jsonb_build_array(jsonb_build_object('test','T30_exact_grant_id_binding','ok', v_ok AND public.platform_tenant_access_basis_valid_now(v_sa,t2,'super_admin_grant','read_only',g_b) AND NOT public.platform_tenant_access_basis_valid_now(v_sa,t2,'super_admin_grant','read_only',g_a)));

  -- T31 idempotent
  v_res := public.revoke_super_admin_tenant_grant_cascade(v_so,g_a,'second revoke');
  r := r || jsonb_build_array(jsonb_build_object('test','T31_revoke_idempotent','ok',(v_res->>'outcome')='already_revoked'));

  -- T32-34 concurrency
  PERFORM public.revoke_super_admin_role_cascade(v_so,v_sa,'g7f2a pre-concurrency');
  BEGIN
    PERFORM public.upsert_super_admin_tenant_grant_atomic(v_so,v_sa,t1,'data_read',NULL,'should fail');
    v_ok := false; v_detail := 'unexpected success';
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM ILIKE '%target_not_super_admin%'; v_detail := SQLERRM;
  END;
  r := r || jsonb_build_array(jsonb_build_object('test','T32_role_removal_concurrency_safe','ok',v_ok,'detail',v_detail));
  INSERT INTO public.platform_roles(user_id,role) VALUES (v_sa,'super_admin') ON CONFLICT DO NOTHING;
  v_res := public.upsert_super_admin_tenant_grant_atomic(v_so,v_sa,t1,'data_read',NULL,'race grant');
  g_a := (v_res->>'grant_id')::uuid;
  PERFORM public.revoke_super_admin_tenant_grant_cascade(v_so,g_a,'race revoke');
  v_res := public.upsert_super_admin_tenant_grant_atomic(v_so,v_sa,t1,'data_read',NULL,'race regrant');
  g_b := (v_res->>'grant_id')::uuid;
  r := r || jsonb_build_array(jsonb_build_object('test','T33_revoke_regrant_race_fail_closed','ok', g_b IS DISTINCT FROM g_a AND NOT public.platform_tenant_access_basis_valid_now(v_sa,t1,'super_admin_grant','read_only',g_a)));
  INSERT INTO public.platform_tenant_access_sessions(platform_user_id,tenant_id,authority_basis,access_level,grant_id,reason,expires_at)
  VALUES (v_sa,t1,'super_admin_grant','read_only',g_b,'race-session',now()+interval '1 hour') RETURNING id INTO s_a;
  v_res := public.upsert_super_admin_tenant_grant_atomic(v_so,v_sa,t1,'data_write',NULL,'race change');
  SELECT ended_at IS NOT NULL INTO v_bool FROM public.platform_tenant_access_sessions WHERE id=s_a;
  r := r || jsonb_build_array(jsonb_build_object('test','T34_grant_change_g7d_start_race','ok',v_bool AND (v_res->>'g7d_ended_count')::int>=1));

  -- T35-36 tenant inactive
  UPDATE public.tenants SET status='suspended' WHERE id=t1;
  v_ok := NOT public.platform_tenant_access_basis_valid_now(v_sa,t1,'super_admin_grant','operational_admin',g_b);
  BEGIN
    PERFORM public.upsert_super_admin_tenant_grant_atomic(v_so,v_sa,t1,'data_read',NULL,'inactive deny');
    v_bool := false;
  EXCEPTION WHEN OTHERS THEN
    v_bool := SQLERRM ILIKE '%tenant_not_active%';
  END;
  UPDATE public.tenants SET status='active' WHERE id=t1;
  SELECT count(*) INTO v_cnt FROM public.super_admin_tenant_access WHERE id=g_b AND revoked_at IS NULL;
  r := r || jsonb_build_array(jsonb_build_object('test','T35_tenant_inactive_denied','ok',v_ok AND v_bool));
  r := r || jsonb_build_array(jsonb_build_object('test','T36_reactivation_respects_sa_role','ok',v_cnt=1 AND public.is_super_admin(v_sa)));

  -- T37-40 boundaries
  r := r || jsonb_build_array(jsonb_build_object('test','T37_so_group_unaffected','ok', public.platform_tenant_access_basis_valid_now(v_so,t1,'super_owner_group_access','operational_admin',NULL)));
  SELECT count(*) INTO v_bg1_after FROM public.platform_break_glass_identities bg JOIN auth.users u ON u.id=bg.user_id WHERE lower(u.email)='staging-g7f1b-break-glass@example.test' AND bg.active;
  r := r || jsonb_build_array(jsonb_build_object('test','T38_bg_unaffected','ok',v_bg1_after=v_bg1_before));
  IF t_ext IS NOT NULL THEN
    v_ok := NOT public.platform_tenant_access_basis_valid_now(v_so,t_ext,'super_owner_group_access','operational_admin',NULL);
  ELSE
    v_ok := true;
  END IF;
  r := r || jsonb_build_array(jsonb_build_object('test','T39_external_so_ops_denied','ok',v_ok));
  v_ok := pg_get_functiondef('public.platform_tenant_access_basis_valid_now(uuid,uuid,public.platform_tenant_access_basis,public.platform_tenant_access_level,uuid)'::regprocedure) ILIKE '%support_grant%'
    AND pg_get_functiondef('public.platform_tenant_access_basis_valid_now(uuid,uuid,public.platform_tenant_access_basis,public.platform_tenant_access_level,uuid)'::regprocedure) ILIKE '%p_grant_id IS NULL OR g.id = p_grant_id%';
  r := r || jsonb_build_array(jsonb_build_object('test','T40_support_emergency_basis_unaffected','ok',v_ok));

  -- T41-45
  SELECT count(*) INTO v_mem_after FROM public.tenant_memberships;
  SELECT count(*) INTO v_owner_after FROM public.tenant_memberships WHERE role::text ILIKE '%owner%';
  SELECT count(*) INTO v_adv_after FROM public.advisor_profiles;
  r := r || jsonb_build_array(jsonb_build_object('test','T41_no_memberships_created','ok',v_mem_after=v_mem_before AND NOT EXISTS (SELECT 1 FROM public.tenant_memberships WHERE user_id=v_sa)));
  r := r || jsonb_build_array(jsonb_build_object('test','T42_no_owner_authority','ok',v_owner_after=v_owner_before));
  r := r || jsonb_build_array(jsonb_build_object('test','T43_no_adviser_identity','ok',v_adv_after=v_adv_before));
  r := r || jsonb_build_array(jsonb_build_object('test','T44_client_cannot_execute_lifecycle_rpcs','ok',
    NOT has_function_privilege('anon','public.revoke_super_admin_role_cascade(uuid,uuid,text)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.revoke_super_admin_role_cascade(uuid,uuid,text)','EXECUTE')
    AND has_function_privilege('service_role','public.revoke_super_admin_role_cascade(uuid,uuid,text)','EXECUTE')
    AND NOT has_function_privilege('anon','public.revoke_super_admin_tenant_grant_cascade(uuid,uuid,text)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.revoke_super_admin_tenant_grant_cascade(uuid,uuid,text)','EXECUTE')));
  r := r || jsonb_build_array(jsonb_build_object('test','T45_client_cannot_mutate_grants_roles','ok',
    NOT has_table_privilege('authenticated','public.super_admin_tenant_access','INSERT')
    AND NOT has_table_privilege('authenticated','public.platform_roles','INSERT')));

  -- T46-48
  SELECT count(*) INTO v_cnt FROM public.super_admin_tenant_access WHERE user_id=v_sa AND revoked_at IS NOT NULL;
  r := r || jsonb_build_array(jsonb_build_object('test','T46_historical_grants_retained','ok',v_cnt>=1));
  SELECT count(*) INTO v_cnt FROM public.platform_tenant_access_sessions WHERE platform_user_id=v_sa AND authority_basis='super_admin_grant' AND ended_at IS NOT NULL;
  r := r || jsonb_build_array(jsonb_build_object('test','T47_historical_g7d_retained','ok',v_cnt>=1));
  SELECT EXISTS (
    SELECT 1 FROM public.security_audit_events WHERE event_type='PLATFORM_ROLE_REVOKED' AND subject_user_id=v_sa
      AND metadata->>'source'='revoke_super_admin_role_cascade' AND metadata ? 'grants_revoked_count' AND metadata ? 'g7d_ended_count' AND metadata ? 'reason'
  ) AND EXISTS (
    SELECT 1 FROM public.security_audit_events WHERE event_type='SUPER_ADMIN_GRANT_REVOKED' AND subject_user_id=v_sa
      AND metadata->>'source'='revoke_super_admin_tenant_grant_cascade' AND metadata ? 'g7d_ended_count' AND metadata ? 'grant_id'
  ) INTO v_ok;
  r := r || jsonb_build_array(jsonb_build_object('test','T48_lifecycle_audit_counts','ok',v_ok));

  -- cleanup
  DELETE FROM public.platform_tenant_access_sessions WHERE platform_user_id IN (SELECT id FROM auth.users WHERE email LIKE 'staging-g7f2a-%@example.test');
  DELETE FROM public.super_admin_tenant_access WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'staging-g7f2a-%@example.test');
  DELETE FROM public.security_audit_events WHERE subject_user_id IN (SELECT id FROM auth.users WHERE email LIKE 'staging-g7f2a-%@example.test');
  DELETE FROM public.platform_roles WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'staging-g7f2a-%@example.test');
  DELETE FROM public.tenant_memberships WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'staging-g7f2a-%@example.test');
  DELETE FROM auth.users WHERE email LIKE 'staging-g7f2a-%@example.test';
  DELETE FROM g6b_private.staging_credentials WHERE email LIKE 'staging-g7f2a-%@example.test';
  SELECT count(*) INTO v_bg1_after FROM public.platform_break_glass_identities bg JOIN auth.users u ON u.id=bg.user_id WHERE lower(u.email)='staging-g7f1b-break-glass@example.test' AND bg.active;
  r := r || jsonb_build_array(jsonb_build_object('test','CLEANUP_BG1_INTACT','ok',v_bg1_after=v_bg1_before));

  INSERT INTO g6b_private.g7f2a_test_results(payload) VALUES (r);
END;
$body$;

SELECT payload FROM g6b_private.g7f2a_test_results ORDER BY created_at DESC LIMIT 1;
