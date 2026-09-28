-- G7F-3A rollback-only SQL verification (staging only).
-- Every write (disposable staging-g7f3a-* fixtures, temporary BG classification swap, G7D/BG rows,
-- grants, audit rows) is rolled back by the final RAISE; results are returned in its message.
-- Nothing persists: BG1, standing SOs, Auth factors and memberships are never committed-changed.
DO $body$
DECLARE
  r jsonb := '[]'::jsonb;
  v_so1 uuid; v_bg1 uuid; v_so uuid; v_bg uuid; v_sa uuid; v_sup uuid;
  t1 uuid; t_ext uuid;
  g_sa uuid; g_sup uuid; g_em uuid;
  s_new uuid; v_bg_row uuid;
  v1 jsonb; v2 jsonb; v_ok boolean; v_started timestamptz; v_txt text;
  v_factors_before int; v_users_upd_before timestamptz; v_mem_before int; v_owner_before int;
  v_hist_nonnull int;
BEGIN
  SELECT id INTO v_so1 FROM auth.users WHERE lower(email)='pmabbott2@aol.com';
  SELECT id INTO v_bg1 FROM auth.users WHERE lower(email)='staging-g7f1b-break-glass@example.test';
  IF v_so1 IS NULL OR v_bg1 IS NULL THEN RAISE EXCEPTION 'G7F3A STOP: SO1/BG1 missing'; END IF;
  SELECT id INTO t1 FROM public.tenants WHERE company_code='001' AND tenant_type='GROUP' AND status='active' LIMIT 1;
  IF t1 IS NULL THEN RAISE EXCEPTION 'G7F3A STOP: tenant 001 missing'; END IF;
  -- Staging has no EXTERNAL tenant: disposable one (rolled back).
  INSERT INTO public.tenants(company_code,slug,company_name,tenant_type,status)
  VALUES ('993','staging-g7f3a-ext','G7F3A External','EXTERNAL','active') RETURNING id INTO t_ext;

  SELECT count(*) INTO v_factors_before FROM auth.mfa_factors;
  SELECT max(updated_at) INTO v_users_upd_before FROM auth.users;
  SELECT count(*) INTO v_mem_before FROM public.tenant_memberships;
  SELECT count(*) INTO v_owner_before FROM public.tenant_memberships WHERE role::text ILIKE '%owner%';
  SELECT count(*) INTO v_hist_nonnull FROM public.platform_tenant_access_sessions WHERE auth_session_id IS NOT NULL;

  BEGIN
    v_so  := g6b_private.create_persona('staging-g7f3a-so@example.test','G7F3A SO','07000006001');
    v_bg  := g6b_private.create_persona('staging-g7f3a-bg@example.test','G7F3A BG','07000006002');
    v_sa  := g6b_private.create_persona('staging-g7f3a-sa@example.test','G7F3A SA','07000006003');
    v_sup := g6b_private.create_persona('staging-g7f3a-sup@example.test','G7F3A Support','07000006004');
    INSERT INTO public.platform_roles(user_id,role) VALUES (v_so,'super_owner'),(v_bg,'super_owner'),(v_sa,'super_admin')
      ON CONFLICT DO NOTHING;

    -- 22: new G7D session stores auth_session_id; blank rejected
    INSERT INTO public.platform_tenant_access_sessions(platform_user_id,tenant_id,authority_basis,access_level,reason,expires_at,auth_session_id)
    VALUES (v_so,t1,'super_owner_group_access','operational_admin','g7f3a-bind',now()+interval '1 hour','g7f3a-auth-A')
    RETURNING id INTO s_new;
    SELECT auth_session_id INTO v_txt FROM public.platform_tenant_access_sessions WHERE id=s_new;
    v_ok := v_txt='g7f3a-auth-A';
    BEGIN
      INSERT INTO public.platform_tenant_access_sessions(platform_user_id,tenant_id,authority_basis,access_level,reason,expires_at,auth_session_id)
      VALUES (v_so,t1,'super_owner_group_access','operational_admin','g7f3a-blank',now()+interval '1 hour','   ');
      v_ok := false;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    r := r || jsonb_build_array(jsonb_build_object('t','TEST_22_g7d_stores_auth_session_id','ok',v_ok));

    -- 24 (DB): all historical rows are NULL (so they can never satisfy enforced binding)
    r := r || jsonb_build_array(jsonb_build_object('t','TEST_24_historical_rows_null','ok',v_hist_nonnull=0));

    -- 25: authority revalidation unaffected by auth_session_id (SA grant revoke still ends/denies)
    v1 := public.upsert_super_admin_tenant_grant_atomic(v_so1,v_sa,t1,'data_read',NULL,'g7f3a sa');
    g_sa := (v1->>'grant_id')::uuid;
    INSERT INTO public.platform_tenant_access_sessions(platform_user_id,tenant_id,authority_basis,access_level,grant_id,reason,expires_at,auth_session_id)
    VALUES (v_sa,t1,'super_admin_grant','read_only',g_sa,'g7f3a-sa',now()+interval '1 hour','g7f3a-auth-SA')
    RETURNING id INTO s_new;
    v_ok := public.platform_tenant_access_basis_valid_now(v_sa,t1,'super_admin_grant','read_only',g_sa);
    v2 := public.revoke_super_admin_tenant_grant_cascade(v_so1,g_sa,'g7f3a revoke');
    v_ok := v_ok AND NOT public.platform_tenant_access_basis_valid_now(v_sa,t1,'super_admin_grant','read_only',g_sa)
      AND (SELECT ended_at IS NOT NULL FROM public.platform_tenant_access_sessions WHERE id=s_new);
    r := r || jsonb_build_array(jsonb_build_object('t','TEST_25_g7d_authority_revalidation_intact','ok',v_ok));

    -- 31 SO GROUP boundary / 33 EXTERNAL SO denied
    r := r || jsonb_build_array(jsonb_build_object('t','TEST_31_so_group_boundary','ok',
      public.platform_tenant_access_basis_valid_now(v_so,t1,'super_owner_group_access','operational_admin',NULL)
      AND NOT public.platform_tenant_access_basis_valid_now(v_so,t1,'super_owner_group_access','read_only',NULL)));
    r := r || jsonb_build_array(jsonb_build_object('t','TEST_33_external_so_denied','ok',
      NOT public.platform_tenant_access_basis_valid_now(v_so,t_ext,'super_owner_group_access','operational_admin',NULL)));

    -- 34 SA exact grant binding
    v1 := public.upsert_super_admin_tenant_grant_atomic(v_so1,v_sa,t1,'data_read',NULL,'g7f3a sa2');
    g_sa := (v1->>'grant_id')::uuid;
    r := r || jsonb_build_array(jsonb_build_object('t','TEST_34_sa_exact_grant_binding','ok',
      public.platform_tenant_access_basis_valid_now(v_sa,t1,'super_admin_grant','read_only',g_sa)
      AND NOT public.platform_tenant_access_basis_valid_now(v_sa,t1,'super_admin_grant','read_only',NULL)
      AND NOT public.platform_tenant_access_basis_valid_now(v_sa,t1,'super_admin_grant','read_only',gen_random_uuid())));

    -- 35 support / emergency basis unchanged (NULL-or-id semantics)
    INSERT INTO public.tenant_support_access_grants(tenant_id,grantee_user_id,reason,expires_at,scope)
    VALUES (t1,v_sup,'g7f3a support',now()+interval '1 hour','full_read') RETURNING id INTO g_sup;
    INSERT INTO public.tenant_emergency_access_grants(tenant_id,grantee_user_id,reason,expires_at,scope)
    VALUES (t1,v_sup,'g7f3a emergency',now()+interval '1 hour','full_read') RETURNING id INTO g_em;
    r := r || jsonb_build_array(jsonb_build_object('t','TEST_35_support_emergency_unchanged','ok',
      public.platform_tenant_access_basis_valid_now(v_sup,t1,'support_grant','read_only',g_sup)
      AND public.platform_tenant_access_basis_valid_now(v_sup,t1,'support_grant','read_only',NULL)
      AND NOT public.platform_tenant_access_basis_valid_now(v_sup,t1,'support_grant','operational_admin',g_sup)
      AND public.platform_tenant_access_basis_valid_now(v_sup,t1,'emergency_grant','emergency',g_em)
      AND NOT public.platform_tenant_access_basis_valid_now(v_sup,t1,'emergency_grant','read_only',g_em)));

    -- BG: temporary classification swap to disposable (rolled back)
    UPDATE public.platform_break_glass_identities SET active=false, deactivated_at=now() WHERE user_id=v_bg1 AND active;
    INSERT INTO public.platform_break_glass_identities(user_id,active,created_by,reason)
    VALUES (v_bg,true,v_so1,'g7f3a disposable');

    -- 32 BG GROUP boundary
    r := r || jsonb_build_array(jsonb_build_object('t','TEST_32_bg_group_boundary','ok',
      public.is_active_break_glass(v_bg)
      AND public.platform_tenant_access_basis_valid_now(v_bg,t1,'super_owner_group_access','operational_admin',NULL)
      AND NOT public.platform_tenant_access_basis_valid_now(v_bg,t_ext,'super_owner_group_access','operational_admin',NULL)));

    -- enforce-mode create gate: allow_create=false with no open session creates nothing
    v1 := public.ensure_break_glass_platform_session(v_bg,'g7f3a-bg-A',1000,'session_check',false);
    r := r || jsonb_build_array(jsonb_build_object('t','BG_enforce_no_fresh_creates_nothing','ok',
      (v1->>'reason')='no_active_session'
      AND NOT EXISTS (SELECT 1 FROM public.platform_break_glass_sessions WHERE user_id=v_bg)));

    -- 26 auth_session_id primary binding; 27 iat refresh does not create new authority
    v1 := public.ensure_break_glass_platform_session(v_bg,'g7f3a-bg-A',1000,'session_check',true);
    v_bg_row := (v1->>'session_id')::uuid;
    v_started := (v1->>'started_at')::timestamptz;
    v2 := public.ensure_break_glass_platform_session(v_bg,'g7f3a-bg-A',2000,'session_check',true);
    v_ok := (v1->>'outcome')='created' AND (v2->>'outcome')='existing'
      AND (v2->>'session_id')::uuid=v_bg_row AND (v2->>'auth_session_id')='g7f3a-bg-A'
      AND (SELECT auth_session_id='g7f3a-bg-A' AND auth_iat_bind=1000 FROM public.platform_break_glass_sessions WHERE id=v_bg_row);
    r := r || jsonb_build_array(jsonb_build_object('t','TEST_26_bg_auth_session_primary','ok',v_ok));
    v2 := public.ensure_break_glass_platform_session(v_bg,'g7f3a-bg-A',3000,'session_check',true);
    v_ok := (v2->>'outcome')='existing' AND (v2->>'started_at')::timestamptz=v_started
      AND (SELECT count(*) FROM public.platform_break_glass_sessions WHERE user_id=v_bg)=1
      AND (SELECT count(*) FROM public.security_audit_events WHERE acting_user_id=v_bg AND event_type='BREAK_GLASS_LOGIN_SUCCEEDED')=1;
    r := r || jsonb_build_array(jsonb_build_object('t','TEST_27_iat_refresh_no_new_authority','ok',v_ok));

    -- 29 absolute 60m
    r := r || jsonb_build_array(jsonb_build_object('t','TEST_29_bg_absolute_60m','ok',
      (SELECT absolute_expires_at - started_at = interval '60 minutes' FROM public.platform_break_glass_sessions WHERE id=v_bg_row)));

    -- 28 ended session cannot reopen with same auth_session_id (even with new iat)
    PERFORM public.end_break_glass_platform_session(v_bg,'logout');
    v2 := public.ensure_break_glass_platform_session(v_bg,'g7f3a-bg-A',5000,'session_check',true);
    r := r || jsonb_build_array(jsonb_build_object('t','TEST_28_ended_bg_same_session_reopen_denied','ok',
      (v2->>'active')::boolean=false AND (v2->>'reason')='same_auth_session_locked'));

    -- 30 idle 15m
    v1 := public.ensure_break_glass_platform_session(v_bg,'g7f3a-bg-B',6000,'session_check',true);
    UPDATE public.platform_break_glass_sessions
      SET started_at=now()-interval '20 minutes', last_activity_at=now()-interval '14 minutes',
          absolute_expires_at=(now()-interval '20 minutes')+interval '60 minutes'
      WHERE user_id=v_bg AND ended_at IS NULL;
    v_ok := public.is_break_glass_platform_session_active(v_bg);
    UPDATE public.platform_break_glass_sessions SET last_activity_at=now()-interval '16 minutes'
      WHERE user_id=v_bg AND ended_at IS NULL;
    v2 := public.ensure_break_glass_platform_session(v_bg,'g7f3a-bg-B',6001,'session_check',true);
    v_ok := v_ok AND (v2->>'active')::boolean=false
      AND (SELECT end_reason FROM public.platform_break_glass_sessions WHERE user_id=v_bg AND auth_session_id='g7f3a-bg-B')='idle_expired';
    r := r || jsonb_build_array(jsonb_build_object('t','TEST_30_bg_idle_15m','ok',v_ok));

    -- 36-40 no persistent-identity side effects (fixture rows excluded)
    r := r || jsonb_build_array(jsonb_build_object('t','TEST_36_no_factor_created','ok',
      (SELECT count(*) FROM auth.mfa_factors)=v_factors_before));
    r := r || jsonb_build_array(jsonb_build_object('t','TEST_37_no_factor_removed','ok',
      (SELECT count(*) FROM auth.mfa_factors)=v_factors_before AND v_factors_before=0));
    r := r || jsonb_build_array(jsonb_build_object('t','TEST_38_no_auth_user_changed','ok',
      (SELECT coalesce(max(updated_at),'epoch') FROM auth.users WHERE email NOT LIKE 'staging-g7f3a-%@example.test')<=v_users_upd_before));
    r := r || jsonb_build_array(jsonb_build_object('t','TEST_39_no_membership_created','ok',
      (SELECT count(*) FROM public.tenant_memberships)=v_mem_before));
    r := r || jsonb_build_array(jsonb_build_object('t','TEST_40_no_owner_created','ok',
      (SELECT count(*) FROM public.tenant_memberships WHERE role::text ILIKE '%owner%')=v_owner_before));

    r := r || jsonb_build_array(jsonb_build_object('t','G7D_column_grants_service_only','ok',
      NOT has_table_privilege('anon','public.platform_tenant_access_sessions','UPDATE')
      AND NOT has_table_privilege('authenticated','public.platform_tenant_access_sessions','UPDATE')
      AND NOT has_table_privilege('authenticated','public.platform_tenant_access_sessions','INSERT')));
  EXCEPTION WHEN OTHERS THEN
    r := r || jsonb_build_array(jsonb_build_object('t','EXCEPTION','ok',false,'detail',SQLERRM));
  END;

  RAISE EXCEPTION 'G7F3A_RESULTS %', r::text;
END;
$body$;
