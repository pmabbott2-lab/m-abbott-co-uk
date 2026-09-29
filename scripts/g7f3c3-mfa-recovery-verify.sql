-- G7F-3C3 privileged MFA recovery — rollback-only database verification (staging only).
-- Synthetic fixtures only (auth users, factors, sessions, AMR claims, refresh tokens are all
-- created and discarded inside this transaction). Never references SO1 / SO2 / BG1.
-- The block always ends with RAISE EXCEPTION, so nothing persists; results are in the message.
-- Grant hashes are synthetic digests of fixed test strings, not real grants.
DO $g7f3c3$
DECLARE
  uA uuid := gen_random_uuid();  -- normal Super Owner (operator 1)
  uB uuid := gen_random_uuid();  -- normal Super Owner (operator 2)
  uC uuid := gen_random_uuid();  -- normal Super Owner (operator 3 / later target)
  uT uuid := gen_random_uuid();  -- normal Super Owner target
  uS uuid := gen_random_uuid();  -- Super Admin target
  uS2 uuid := gen_random_uuid(); -- Super Admin (factor-changed target)
  uS3 uuid := gen_random_uuid(); -- Super Admin (kind-changed target)
  uS4 uuid := gen_random_uuid(); -- Super Admin (expiry target)
  uS5 uuid := gen_random_uuid(); -- Super Admin (cancel target)
  uS6 uuid := gen_random_uuid(); -- Super Admin (atomicity target)
  uG uuid := gen_random_uuid();  -- break-glass fixture (target)
  uG2 uuid := gen_random_uuid(); -- second break-glass fixture
  uX uuid := gen_random_uuid();  -- tenant Owner, no platform role
  sA uuid; sAstale uuid; sAaal1 uuid; sB uuid; sBstale uuid; sC uuid; sT uuid; sT2 uuid; sT3 uuid; sTold uuid;
  sS uuid; sS2 uuid; sS3 uuid; sS4 uuid; sS5 uuid; sS6 uuid; sSn uuid; sG uuid; sG2 uuid; sX uuid; sCn uuid;
  fA uuid; fB uuid; fC uuid; fT uuid; fT2 uuid; fS uuid; fS2 uuid; fS3 uuid; fS4 uuid; fS5 uuid; fS6 uuid;
  fG uuid; fG2 uuid; fX uuid; fAtt uuid; fSn uuid;
  h1 text := encode(sha256('g7f3c3-harness-grant-1'::bytea), 'hex');
  h2 text := encode(sha256('g7f3c3-harness-grant-2'::bytea), 'hex');
  h3 text := encode(sha256('g7f3c3-harness-grant-3'::bytea), 'hex');
  h4 text := encode(sha256('g7f3c3-harness-grant-4'::bytea), 'hex');
  hbad text := encode(sha256('g7f3c3-harness-wrong'::bytea), 'hex');
  v jsonb; v2 jsonb;
  rT uuid; rS uuid; rG uuid; rC uuid; rS2 uuid; rS3 uuid; rS4 uuid; rS5 uuid; rS5b uuid; rS6 uuid; rB uuid;
  vt text; vn integer; vn2 integer; vb boolean; vb2 boolean; vj jsonb; vj2 jsonb;
  tenant uuid;
  iatOld bigint := floor(extract(epoch FROM now()))::bigint - 60;
  iatNew bigint := floor(extract(epoch FROM now()))::bigint + 2;
  vbase jsonb; vm jsonb; bAt timestamptz; gi0 timestamptz; ge0 timestamptz; sTpre uuid; sTexp uuid;
  can_shift boolean := true;
  can_bg boolean := true;
  tot integer; failed integer; skipped integer; report text;
  f text;
BEGIN
  CREATE TEMP TABLE g7t (n serial, name text, ok boolean, detail text, skip boolean DEFAULT false) ON COMMIT DROP;

  CREATE FUNCTION pg_temp.ck(p_name text, p_ok boolean, p_detail text DEFAULT '') RETURNS void
  LANGUAGE sql AS $f$ INSERT INTO g7t (name, ok, detail) VALUES (p_name, COALESCE(p_ok, false), COALESCE(p_detail, '')) $f$;

  CREATE FUNCTION pg_temp.skip(p_name text, p_detail text) RETURNS void
  LANGUAGE sql AS $f$ INSERT INTO g7t (name, ok, detail, skip) VALUES (p_name, true, p_detail, true) $f$;

  CREATE TEMP TABLE g7t_state (denied_total integer) ON COMMIT DROP;
  INSERT INTO g7t_state VALUES (0);

  -- Denial must be returned (not raised) AND a new MFA_RECOVERY_DENIED row with that reason must exist.
  CREATE FUNCTION pg_temp.ckdeny(p_name text, p_res jsonb, p_reason text) RETURNS void
  LANGUAGE plpgsql AS $f$
  DECLARE n integer; prev integer; hit boolean;
  BEGIN
    SELECT denied_total INTO prev FROM g7t_state;
    SELECT count(*) INTO n FROM public.security_audit_events
    WHERE event_type = 'MFA_RECOVERY_DENIED' AND created_at >= now();
    SELECT EXISTS (SELECT 1 FROM public.security_audit_events
                   WHERE event_type = 'MFA_RECOVERY_DENIED' AND metadata->>'result_reason' = p_reason AND created_at >= now())
      INTO hit;
    UPDATE g7t_state SET denied_total = n;
    PERFORM pg_temp.ck(p_name,
      p_res->>'ok' = 'false' AND p_res->>'reason' = p_reason AND n > prev AND hit,
      'got=' || COALESCE(p_res->>'reason', p_res->>'ok', 'null') || ' new_denials=' || (n - prev));
  END $f$;

  CREATE FUNCTION pg_temp.mk_user(p_id uuid, p_tag text) RETURNS void
  LANGUAGE sql AS $f$
    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
    VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
            'g7f3c3-h-' || p_tag || '-' || left(p_id::text, 8) || '@example.test', '', now(), now(), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb)
  $f$;

  CREATE FUNCTION pg_temp.mk_factor(p_user uuid, p_created timestamptz DEFAULT now(), p_status text DEFAULT 'verified')
  RETURNS uuid LANGUAGE plpgsql AS $f$
  DECLARE v uuid := gen_random_uuid();
  BEGIN
    INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
    VALUES (v, p_user, 'h-' || left(v::text, 8), 'totp'::auth.factor_type, p_status::auth.factor_status,
            p_created, p_created, 'HARNESS-NOT-A-SECRET');
    RETURN v;
  END $f$;

  CREATE FUNCTION pg_temp.mk_session(p_user uuid, p_factor uuid, p_aal text, p_amr_age integer,
                                     p_created timestamptz DEFAULT now())
  RETURNS uuid LANGUAGE plpgsql AS $f$
  DECLARE v uuid := gen_random_uuid();
  BEGIN
    INSERT INTO auth.sessions (id, user_id, created_at, updated_at, factor_id, aal)
    VALUES (v, p_user, p_created, p_created, p_factor, p_aal::auth.aal_level);
    INSERT INTO auth.mfa_amr_claims (id, session_id, created_at, updated_at, authentication_method)
    VALUES (gen_random_uuid(), v, p_created, p_created, 'password');
    IF p_amr_age IS NOT NULL THEN
      INSERT INTO auth.mfa_amr_claims (id, session_id, created_at, updated_at, authentication_method)
      VALUES (gen_random_uuid(), v, now() - make_interval(secs => p_amr_age), now() - make_interval(secs => p_amr_age), 'totp');
    END IF;
    INSERT INTO auth.refresh_tokens (instance_id, token, user_id, revoked, created_at, updated_at, session_id)
    VALUES ('00000000-0000-0000-0000-000000000000', encode(gen_random_bytes(16), 'hex'), p_user::text, false,
            p_created, p_created, v);
    RETURN v;
  END $f$;

  -- Direct database/API view of a JWT (PostgREST sets these claims and switches to authenticated).
  CREATE FUNCTION pg_temp.jwt_view(p_sub uuid, p_sid uuid, p_iat bigint, p_tenant uuid DEFAULT NULL) RETURNS jsonb
  LANGUAGE plpgsql AS $f$
  DECLARE r jsonb;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_strip_nulls(json_build_object('sub', p_sub, 'role', 'authenticated',
      'aal', 'aal2', 'session_id', p_sid, 'iat', p_iat))::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE 'SELECT jsonb_build_object(''so'', public.is_super_owner($1), ''sa'', public.is_super_admin($1),
               ''tenants'', (SELECT count(*) FROM public.tenants),
               ''audit'', (SELECT count(*) FROM public.security_audit_events),
               ''group_data'', public.can_access_tenant_data($1, $2),
               ''group_admin'', public.can_administer_tenant($1, $2),
               ''g7d_basis'', public.platform_tenant_access_basis_valid_now($1, $2,
                   ''super_owner_group_access''::public.platform_tenant_access_basis,
                   ''operational_admin''::public.platform_tenant_access_level, NULL))' INTO r USING p_sub, p_tenant;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN r;
  END $f$;

  -- G7F-3C3B: tenant authority as seen by a JWT for p_sub, asking about p_subject in p_tenant.
  CREATE FUNCTION pg_temp.tenant_view(p_sub uuid, p_sid uuid, p_iat bigint, p_subject uuid, p_tenant uuid) RETURNS jsonb
  LANGUAGE plpgsql AS $f$
  DECLARE r jsonb;
  BEGIN
    PERFORM set_config('request.jwt.claims', json_strip_nulls(json_build_object('sub', p_sub, 'role', 'authenticated',
      'aal', 'aal2', 'session_id', p_sid, 'iat', p_iat))::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE 'SELECT jsonb_build_object(''member'', public.has_tenant_membership($1, $2),
               ''data'', public.can_access_tenant_data($1, $2), ''admin'', public.can_administer_tenant($1, $2),
               ''access'', public.can_access_tenant($1, $2), ''staff_rls'', public.auth_is_tenant_staff($2),
               ''admin_rls'', public.auth_is_tenant_admin($2),
               ''own_rows'', (SELECT count(*) FROM public.tenant_memberships WHERE tenant_id = $2 AND user_id = $1),
               ''tenant_row'', (SELECT count(*) FROM public.tenants WHERE id = $2))' INTO r USING p_subject, p_tenant;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN r;
  END $f$;

  CREATE FUNCTION pg_temp.shift(p_req uuid, p_by interval) RETURNS void
  LANGUAGE plpgsql AS $f$
  BEGIN
    ALTER TABLE public.platform_mfa_recovery_requests DISABLE TRIGGER USER;
    UPDATE public.platform_mfa_recovery_requests
    SET created_at = created_at - p_by, approved_at = approved_at - p_by,
        second_approved_at = second_approved_at - p_by, cooling_off_until = cooling_off_until - p_by,
        expires_at = expires_at - p_by, executed_at = executed_at - p_by,
        grant_issued_at = grant_issued_at - p_by, grant_expires_at = grant_expires_at - p_by,
        grant_redeemed_at = grant_redeemed_at - p_by
    WHERE id = p_req;
    ALTER TABLE public.platform_mfa_recovery_requests ENABLE TRIGGER USER;
  END $f$;

  -- ============================================================================================
  -- A. Auth schema pins
  -- ============================================================================================
  PERFORM pg_temp.ck('A1 auth.sessions columns (id,user_id,aal,not_after,factor_id,created_at)',
    (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'sessions'
      AND column_name IN ('id', 'user_id', 'aal', 'not_after', 'factor_id', 'created_at')) = 6);
  PERFORM pg_temp.ck('A2 auth.refresh_tokens.user_id is character varying',
    (SELECT data_type FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'refresh_tokens'
      AND column_name = 'user_id') = 'character varying');
  PERFORM pg_temp.ck('A3 auth.mfa_amr_claims (session_id, authentication_method, updated_at)',
    (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'mfa_amr_claims'
      AND column_name IN ('session_id', 'authentication_method', 'updated_at')) = 3);
  PERFORM pg_temp.ck('A4 factor enums contain totp / verified; aal enum contains aal1 / aal2',
    EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'factor_type' AND e.enumlabel = 'totp')
    AND EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'factor_status' AND e.enumlabel = 'verified')
    AND EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'aal_level' AND e.enumlabel = 'aal2'));
  PERFORM pg_temp.ck('A5 mfa_challenges -> mfa_factors ON DELETE CASCADE',
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'auth.mfa_challenges'::regclass AND contype = 'f'
      AND confrelid = 'auth.mfa_factors'::regclass AND confdeltype = 'c'));
  PERFORM pg_temp.ck('A6 mfa_amr_claims -> sessions ON DELETE CASCADE',
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'auth.mfa_amr_claims'::regclass AND contype = 'f'
      AND confrelid = 'auth.sessions'::regclass AND confdeltype = 'c'));
  PERFORM pg_temp.ck('A7 refresh_tokens -> sessions ON DELETE CASCADE',
    EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'auth.refresh_tokens'::regclass AND contype = 'f'
      AND confrelid = 'auth.sessions'::regclass AND confdeltype = 'c'));

  -- ============================================================================================
  -- B. Grants, RLS, SECURITY DEFINER hygiene
  -- ============================================================================================
  FOREACH f IN ARRAY ARRAY[
    'public.request_platform_mfa_recovery(uuid,uuid,uuid,text,integer,text)',
    'public.approve_platform_mfa_recovery(uuid,uuid,uuid,text)',
    'public.execute_platform_mfa_recovery(uuid,uuid,uuid,text,text)',
    'public.reissue_platform_mfa_recovery_grant(uuid,uuid,uuid,text,text)',
    'public.redeem_platform_mfa_recovery_grant(uuid,uuid,text,text)',
    'public.complete_platform_mfa_recovery(uuid,uuid,text)',
    'public.cancel_platform_mfa_recovery(uuid,uuid,uuid,text,text)',
    'public.expire_platform_mfa_recovery_requests(text)',
    'public.get_platform_mfa_recovery_self_state(uuid,uuid)',
    'public.is_platform_mfa_recovery_locked(uuid)',
    'public.platform_mfa_recovery_authority_state(uuid,text,bigint)'
  ] LOOP
    PERFORM pg_temp.ck('B1 service_role only: ' || split_part(f, '(', 1),
      has_function_privilege('service_role', f, 'EXECUTE')
      AND NOT has_function_privilege('anon', f, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', f, 'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                      WHERE p.oid = f::regprocedure AND a.grantee = 0));
  END LOOP;
  PERFORM pg_temp.ck('B2 internal g7f3c3_* functions: no EXECUTE for service_role / authenticated / anon / PUBLIC',
    NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'g7f3c3\_%'
        AND (has_function_privilege('service_role', p.oid, 'EXECUTE')
             OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
             OR has_function_privilege('anon', p.oid, 'EXECUTE'))));
  PERFORM pg_temp.ck('B3 every recovery function pins search_path to empty',
    NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND (p.proname LIKE 'g7f3c3\_%' OR p.proname LIKE '%platform\_mfa\_recovery%')
        AND NOT (COALESCE(p.proconfig, '{}') @> ARRAY['search_path=""'])));
  PERFORM pg_temp.ck('B4 is_super_owner / is_super_admin keep search_path=public and existing grants',
    (SELECT bool_and(COALESCE(p.proconfig, '{}') @> ARRAY['search_path=public']) FROM pg_proc p
      WHERE p.oid IN ('public.is_super_owner(uuid)'::regprocedure, 'public.is_super_admin(uuid)'::regprocedure))
    AND has_function_privilege('authenticated', 'public.is_super_owner(uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.is_super_admin(uuid)', 'EXECUTE'));
  PERFORM pg_temp.ck('B5 RLS enabled, zero policies on both recovery tables',
    (SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.platform_mfa_recovery_requests'::regclass, 'public.platform_mfa_recovery_locks'::regclass))
    AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename IN ('platform_mfa_recovery_requests', 'platform_mfa_recovery_locks')));
  PERFORM pg_temp.ck('B6 anon / authenticated: no table privileges',
    NOT has_table_privilege('anon', 'public.platform_mfa_recovery_requests', 'SELECT,INSERT,UPDATE,DELETE')
    AND NOT has_table_privilege('authenticated', 'public.platform_mfa_recovery_requests', 'SELECT,INSERT,UPDATE,DELETE')
    AND NOT has_table_privilege('anon', 'public.platform_mfa_recovery_locks', 'SELECT,INSERT,UPDATE,DELETE')
    AND NOT has_table_privilege('authenticated', 'public.platform_mfa_recovery_locks', 'SELECT,INSERT,UPDATE,DELETE'));
  PERFORM pg_temp.ck('B7 service_role: no write privileges',
    NOT has_table_privilege('service_role', 'public.platform_mfa_recovery_requests', 'INSERT,UPDATE,DELETE')
    AND NOT has_table_privilege('service_role', 'public.platform_mfa_recovery_locks', 'INSERT,UPDATE,DELETE'));
  PERFORM pg_temp.ck('B8 grant_hash / session ids / evidence_ref unreadable by service_role; status readable',
    NOT has_column_privilege('service_role', 'public.platform_mfa_recovery_requests', 'grant_hash', 'SELECT')
    AND NOT has_column_privilege('service_role', 'public.platform_mfa_recovery_requests', 'redeemed_session_id', 'SELECT')
    AND NOT has_column_privilege('service_role', 'public.platform_mfa_recovery_requests', 'evidence_ref', 'SELECT')
    AND NOT has_column_privilege('service_role', 'public.platform_mfa_recovery_requests', 'grant_failed_attempts', 'SELECT')
    AND has_column_privilege('service_role', 'public.platform_mfa_recovery_requests', 'status', 'SELECT'));
  PERFORM pg_temp.ck('B9 BG end_reason allows mfa_recovery',
    pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'platform_break_glass_sessions_end_reason_chk')) LIKE '%mfa_recovery%');
  PERFORM pg_temp.ck('B10 boundary table: RLS on, no policies, no client access, service_role read-only',
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.platform_mfa_recovery_auth_boundaries'::regclass)
    AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'platform_mfa_recovery_auth_boundaries')
    AND NOT has_table_privilege('anon', 'public.platform_mfa_recovery_auth_boundaries', 'SELECT,INSERT,UPDATE,DELETE')
    AND NOT has_table_privilege('authenticated', 'public.platform_mfa_recovery_auth_boundaries', 'SELECT,INSERT,UPDATE,DELETE')
    AND has_table_privilege('service_role', 'public.platform_mfa_recovery_auth_boundaries', 'SELECT')
    AND NOT has_table_privilege('service_role', 'public.platform_mfa_recovery_auth_boundaries', 'INSERT,UPDATE,DELETE'));
  PERFORM pg_temp.ck('B11 internal g7f3c3a_* functions: no EXECUTE for any client role; search_path empty',
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'g7f3c3a\_%') = 4
    AND NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'g7f3c3a\_%'
        AND (has_function_privilege('service_role', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
             OR has_function_privilege('anon', p.oid, 'EXECUTE') OR NOT (COALESCE(p.proconfig, '{}') @> ARRAY['search_path=""']))));
  PERFORM pg_temp.ck('B12 root helpers carry the boundary check',
    pg_get_functiondef('public.is_super_owner(uuid)'::regprocedure) LIKE '%g7f3c3a_request_context_current(p_user_id)%'
    AND pg_get_functiondef('public.is_super_admin(uuid)'::regprocedure) LIKE '%g7f3c3a_request_context_current(p_user_id)%');

  -- ============================================================================================
  -- Fixtures
  -- ============================================================================================
  SELECT id INTO tenant FROM public.tenants WHERE status = 'active' ORDER BY created_at LIMIT 1;
  PERFORM pg_temp.mk_user(uA, 'a'); PERFORM pg_temp.mk_user(uB, 'b'); PERFORM pg_temp.mk_user(uC, 'c');
  PERFORM pg_temp.mk_user(uT, 't'); PERFORM pg_temp.mk_user(uS, 's'); PERFORM pg_temp.mk_user(uS2, 's2');
  PERFORM pg_temp.mk_user(uS3, 's3'); PERFORM pg_temp.mk_user(uS4, 's4'); PERFORM pg_temp.mk_user(uS5, 's5');
  PERFORM pg_temp.mk_user(uS6, 's6');
  PERFORM pg_temp.mk_user(uG, 'g'); PERFORM pg_temp.mk_user(uG2, 'g2'); PERFORM pg_temp.mk_user(uX, 'x');
  INSERT INTO public.platform_roles (user_id, role) VALUES
    (uA, 'super_owner'), (uB, 'super_owner'), (uC, 'super_owner'), (uT, 'super_owner'),
    (uS, 'super_admin'), (uS2, 'super_admin'), (uS3, 'super_admin'), (uS4, 'super_admin'),
    (uS5, 'super_admin'), (uS6, 'super_admin'), (uG, 'super_owner'), (uG2, 'super_owner');
  BEGIN
    INSERT INTO public.tenant_memberships (tenant_id, user_id, role, active) VALUES (tenant, uX, 'owner', true);
    PERFORM pg_temp.ck('F1 tenant Owner fixture created', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.skip('F1 tenant Owner membership fixture', SQLERRM);
  END;
  fA := pg_temp.mk_factor(uA); fB := pg_temp.mk_factor(uB); fC := pg_temp.mk_factor(uC);
  fT := pg_temp.mk_factor(uT); fS := pg_temp.mk_factor(uS); fS2 := pg_temp.mk_factor(uS2);
  fS3 := pg_temp.mk_factor(uS3); fS4 := pg_temp.mk_factor(uS4); fS5 := pg_temp.mk_factor(uS5);
  fS6 := pg_temp.mk_factor(uS6);
  fG := pg_temp.mk_factor(uG); fG2 := pg_temp.mk_factor(uG2); fX := pg_temp.mk_factor(uX);
  sA := pg_temp.mk_session(uA, fA, 'aal2', 30);
  sAstale := pg_temp.mk_session(uA, fA, 'aal2', 600);
  sAaal1 := pg_temp.mk_session(uA, NULL, 'aal1', NULL);
  sB := pg_temp.mk_session(uB, fB, 'aal2', 30);
  sBstale := pg_temp.mk_session(uB, fB, 'aal2', 400);
  sC := pg_temp.mk_session(uC, fC, 'aal2', 30);
  sT := pg_temp.mk_session(uT, fT, 'aal2', 30);
  sTold := pg_temp.mk_session(uT, NULL, 'aal1', NULL);
  sS := pg_temp.mk_session(uS, fS, 'aal2', 30);
  sS2 := pg_temp.mk_session(uS2, fS2, 'aal2', 30);
  sS3 := pg_temp.mk_session(uS3, fS3, 'aal2', 30);
  sS4 := pg_temp.mk_session(uS4, fS4, 'aal2', 30);
  sS5 := pg_temp.mk_session(uS5, fS5, 'aal2', 30);
  sS6 := pg_temp.mk_session(uS6, fS6, 'aal2', 30);
  sG := pg_temp.mk_session(uG, fG, 'aal2', 30);
  sG2 := pg_temp.mk_session(uG2, fG2, 'aal2', 30);
  sX := pg_temp.mk_session(uX, fX, 'aal2', 30);
  INSERT INTO public.platform_tenant_access_sessions (platform_user_id, tenant_id, authority_basis, access_level, reason, expires_at, auth_session_id)
  VALUES (uT, tenant, 'super_owner_group_access', 'operational_admin', 'g7f3c3 harness', now() + interval '1 hour', sT::text);

  -- ============================================================================================
  -- C. Final recovery path formula + counts
  -- ============================================================================================
  PERFORM pg_temp.ck('C1 formula matrix',
    public.g7f3c3_final_path_formula(1, 1, 'normal_so') AND NOT public.g7f3c3_final_path_formula(1, 0, 'normal_so')
    AND public.g7f3c3_final_path_formula(2, 0, 'normal_so') AND NOT public.g7f3c3_final_path_formula(0, 1, 'normal_so')
    AND NOT public.g7f3c3_final_path_formula(0, 0, 'normal_so')
    AND NOT public.g7f3c3_final_path_formula(1, 1, 'break_glass') AND public.g7f3c3_final_path_formula(2, 0, 'break_glass')
    AND NOT public.g7f3c3_final_path_formula(0, 5, 'break_glass') AND NOT public.g7f3c3_final_path_formula(1, 9, 'break_glass')
    AND public.g7f3c3_final_path_formula(1, 1, 'super_admin') AND NOT public.g7f3c3_final_path_formula(NULL, NULL, 'normal_so'));
  vj := public.g7f3c3_final_path_counts(uT);
  vj2 := public.g7f3c3_final_path_counts(uA);
  PERFORM pg_temp.ck('C2 counts exclude the target', (vj->>'usable_normal_so')::int = (vj2->>'usable_normal_so')::int,
    'counts equal when target swaps between two usable normal SOs');
  DELETE FROM auth.mfa_factors WHERE id = fC;
  PERFORM pg_temp.ck('C3 SO without verified TOTP is not usable',
    (public.g7f3c3_final_path_counts(uT)->>'usable_normal_so')::int = (vj->>'usable_normal_so')::int - 1);
  fC := pg_temp.mk_factor(uC);
  UPDATE auth.sessions SET factor_id = fC WHERE id = sC;

  -- ============================================================================================
  -- D. Request negatives (every denial audited; mode never changes the decision)
  -- ============================================================================================
  v := public.request_platform_mfa_recovery(uA, sA, uA, 'Lost phone on holiday abroad', 15, 'disabled');
  PERFORM pg_temp.ckdeny('D1 self recovery initiation denied', v, 'self_recovery_denied');
  vb := true;
  FOREACH vt IN ARRAY ARRAY['disabled', 'audit', 'enforce', 'bogus'] LOOP
    v := public.request_platform_mfa_recovery(uA, sA, uA, 'Lost phone on holiday abroad', 15, vt);
    vb := vb AND v->>'reason' = 'self_recovery_denied';
  END LOOP;
  PERFORM pg_temp.ck('D2 decision identical in disabled / audit / enforce / unknown mode', vb);
  PERFORM pg_temp.ck('D3 audit records normalised mode (bogus -> unknown)',
    EXISTS (SELECT 1 FROM public.security_audit_events WHERE event_type = 'MFA_RECOVERY_DENIED' AND acting_user_id = uA
            AND metadata->>'mode' = 'unknown' AND created_at >= now()));
  v := public.request_platform_mfa_recovery(uS, sS, uT, 'Lost phone on holiday abroad', 15, 'disabled');
  PERFORM pg_temp.ckdeny('D4 Super Admin cannot initiate SO recovery', v, 'actor_not_recovery_authority');
  v := public.request_platform_mfa_recovery(uX, sX, uT, 'Lost phone on holiday abroad', 15, 'disabled');
  PERFORM pg_temp.ckdeny('D5 tenant Owner (no platform role) cannot initiate', v, 'actor_not_recovery_authority');
  v := public.request_platform_mfa_recovery(uA, sAstale, uT, 'Lost phone on holiday abroad', 15, 'disabled');
  PERFORM pg_temp.ckdeny('D6 stale TOTP (10 min) request denied', v, 'fresh_mfa_stale');
  v := public.request_platform_mfa_recovery(uA, sAaal1, uT, 'Lost phone on holiday abroad', 15, 'disabled');
  PERFORM pg_temp.ckdeny('D7 aal1 session request denied', v, 'aal_insufficient');
  v := public.request_platform_mfa_recovery(uA, sB, uT, 'Lost phone on holiday abroad', 15, 'disabled');
  PERFORM pg_temp.ckdeny('D8 another user''s session denied', v, 'session_user_mismatch');
  v := public.request_platform_mfa_recovery(uA, gen_random_uuid(), uT, 'Lost phone on holiday abroad', 15, 'disabled');
  PERFORM pg_temp.ckdeny('D9 unknown session denied', v, 'session_missing');
  v := public.request_platform_mfa_recovery(uA, sA, uX, 'Lost phone on holiday abroad', 15, 'disabled');
  PERFORM pg_temp.ckdeny('D10 non-privileged target denied', v, 'target_not_privileged');
  v := public.request_platform_mfa_recovery(uA, sA, uT, 'short', 15, 'disabled');
  PERFORM pg_temp.ckdeny('D11 reason too short denied', v, 'reason_invalid');
  v := public.request_platform_mfa_recovery(uA, sA, uT, 'Lost phone on holiday abroad', 5, 'disabled');
  PERFORM pg_temp.ckdeny('D12 cooling-off below 15 min denied', v, 'cooling_off_invalid');

  -- ============================================================================================
  -- E. Normal SO target: request -> second approval (expedite) -> execute -> redeem -> complete
  -- ============================================================================================
  v := public.request_platform_mfa_recovery(uA, sA, uT, 'Lost phone on holiday abroad', 15, 'audit');
  rT := (v->>'request_id')::uuid;
  PERFORM pg_temp.ck('E1 request by other normal SO accepted',
    v->>'ok' = 'true' AND v->>'target_kind' = 'normal_so' AND v->>'status' = 'requested'
    AND (v->>'cooling_off_until')::timestamptz = now() + interval '15 minutes'
    AND (v->>'expires_at')::timestamptz = now() + interval '75 minutes', COALESCE(v->>'reason', ''));
  PERFORM pg_temp.ck('E2 REQUESTED + APPROVED(first) audited transactionally',
    (SELECT count(*) FROM public.security_audit_events WHERE metadata->>'request_id' = rT::text
      AND event_type IN ('MFA_RECOVERY_REQUESTED', 'MFA_RECOVERY_APPROVED')) = 2);
  v := public.request_platform_mfa_recovery(uB, sB, uT, 'Duplicate request for target', 15, 'disabled');
  PERFORM pg_temp.ckdeny('E3 one non-terminal request per target', v, 'active_request_exists');
  v := public.request_platform_mfa_recovery(uT, sT, uC, 'Target tries to act on others', 15, 'disabled');
  PERFORM pg_temp.ckdeny('E4 SO with pending recovery cannot initiate', v, 'actor_in_recovery');
  v := public.execute_platform_mfa_recovery(uA, sA, rT, h1, 'disabled');
  PERFORM pg_temp.ckdeny('E5 execute during cooling-off denied', v, 'cooling_off_active');
  v := public.approve_platform_mfa_recovery(uA, sA, rT, 'disabled');
  PERFORM pg_temp.ckdeny('E6 requester cannot second-approve', v, 'approver_not_distinct');
  v := public.approve_platform_mfa_recovery(uT, sT, rT, 'disabled');
  PERFORM pg_temp.ckdeny('E7 target cannot approve own recovery', v, 'self_approval_denied');
  v := public.approve_platform_mfa_recovery(uS, sS, rT, 'disabled');
  PERFORM pg_temp.ckdeny('E8 Super Admin cannot approve', v, 'actor_not_recovery_authority');
  v := public.approve_platform_mfa_recovery(uX, sX, rT, 'disabled');
  PERFORM pg_temp.ckdeny('E9 tenant Owner cannot approve', v, 'actor_not_recovery_authority');
  v := public.approve_platform_mfa_recovery(uB, sBstale, rT, 'disabled');
  PERFORM pg_temp.ckdeny('E10 stale TOTP approval denied', v, 'fresh_mfa_stale');
  v := public.approve_platform_mfa_recovery(uB, sA, rT, 'disabled');
  PERFORM pg_temp.ckdeny('E11 approver cannot reuse requester session', v, 'session_user_mismatch');
  v := public.approve_platform_mfa_recovery(uB, sB, rT, 'enforce');
  PERFORM pg_temp.ck('E12 distinct normal SO second approval accepted (expedite)',
    v->>'ok' = 'true' AND v->>'status' = 'approved' AND v->>'approval_basis' = 'normal_super_owner');
  v := public.approve_platform_mfa_recovery(uC, sC, rT, 'disabled');
  PERFORM pg_temp.ckdeny('E13 third approval denied (not pending)', v, 'request_not_pending');
  v := public.execute_platform_mfa_recovery(uC, sC, rT, h1, 'disabled');
  PERFORM pg_temp.ckdeny('E14 unrelated SO cannot execute', v, 'executor_not_request_authority');
  v := public.execute_platform_mfa_recovery(uB, sB, rT, 'not-a-hash', 'disabled');
  PERFORM pg_temp.ckdeny('E15 malformed grant hash rejected before destruction', v, 'grant_hash_invalid');
  PERFORM pg_temp.ck('E16 nothing destroyed by denied execute',
    EXISTS (SELECT 1 FROM auth.mfa_factors WHERE id = fT) AND NOT public.is_platform_mfa_recovery_locked(uT));
  v := public.execute_platform_mfa_recovery(uA, sAstale, rT, h1, 'disabled');
  PERFORM pg_temp.ckdeny('E17 stale TOTP execute denied', v, 'fresh_mfa_stale');

  -- Old-token view (claims as T before execution) for the RLS comparison.
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uT, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sT)::text, true);
  EXECUTE 'SELECT count(*) FROM public.platform_roles' INTO vn;
  EXECUTE 'SELECT count(*) FROM public.tenants' INTO vn2;
  EXECUTE 'SELECT public.is_super_owner($1)' INTO vb USING uT;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);

  vbase := pg_temp.jwt_view(uT, sT, iatOld);
  PERFORM pg_temp.ck('M1 pre-execution: old token has fixture Super Owner authority; no boundary yet',
    vbase->>'so' = 'true' AND NOT EXISTS (SELECT 1 FROM public.platform_mfa_recovery_auth_boundaries WHERE user_id = uT)
    AND public.platform_mfa_recovery_authority_state(uT, sT::text, iatOld) = 'ok', vbase::text);

  vj := public.g7f3c3_authority_snapshot(uT);
  v := public.execute_platform_mfa_recovery(uA, sA, rT, h1, 'audit');
  PERFORM pg_temp.ck('E18 executor (requester) executes expedited normal SO recovery',
    v->>'ok' = 'true' AND v->>'status' = 'executed_awaiting_enrolment'
    AND (v->>'factors_removed_count')::int = 1 AND (v->>'sessions_revoked_count')::int = 2
    AND (v->>'refresh_revoked_count')::int = 2 AND (v->>'g7d_ended_count')::int = 1, v::text);
  PERFORM pg_temp.ck('E19 postconditions: 0 factors, 0 sessions, 0 refresh tokens, G7D ended',
    NOT EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id = uT)
    AND NOT EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = uT)
    AND NOT EXISTS (SELECT 1 FROM auth.refresh_tokens WHERE user_id = uT::text)
    AND NOT EXISTS (SELECT 1 FROM auth.mfa_amr_claims c WHERE c.session_id IN (sT, sTold))
    AND NOT EXISTS (SELECT 1 FROM public.platform_tenant_access_sessions WHERE platform_user_id = uT AND ended_at IS NULL));
  PERFORM pg_temp.ck('E20 lock present; is_super_owner(T) false; role row and memberships unchanged',
    public.is_platform_mfa_recovery_locked(uT) AND NOT public.is_super_owner(uT)
    AND EXISTS (SELECT 1 FROM public.platform_roles WHERE user_id = uT AND role = 'super_owner')
    AND public.g7f3c3_authority_snapshot(uT) = vj);
  PERFORM pg_temp.ck('E21 operators untouched (A factor + 3 sessions, B factor)',
    EXISTS (SELECT 1 FROM auth.mfa_factors WHERE id = fA) AND (SELECT count(*) FROM auth.sessions WHERE user_id = uA) = 3
    AND EXISTS (SELECT 1 FROM auth.mfa_factors WHERE id = fB));
  PERFORM pg_temp.ck('E22 execution audit trail complete',
    (SELECT count(DISTINCT event_type) FROM public.security_audit_events WHERE metadata->>'request_id' = rT::text
      AND event_type IN ('MFA_RECOVERY_SECOND_APPROVAL', 'MFA_RECOVERY_EXECUTED', 'MFA_FACTOR_REMOVED',
                         'MFA_TARGET_SESSIONS_REVOKED', 'PLATFORM_TENANT_ENTRY_ENDED', 'MFA_RECOVERY_GRANT_ISSUED')) = 6);

  -- Old access token (claims) after execution: DB authority denied regardless of token validity.
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uT, 'role', 'authenticated', 'aal', 'aal2', 'session_id', sT)::text, true);
  EXECUTE 'SELECT count(*) FROM public.platform_roles' INTO tot;
  EXECUTE 'SELECT count(*) FROM public.tenants' INTO failed;
  EXECUTE 'SELECT public.is_super_owner($1)' INTO vb2 USING uT;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM pg_temp.ck('E23 old token: is_super_owner true before, false after execution', vb = true AND vb2 = false);
  PERFORM pg_temp.ck('E24 old token: RLS platform visibility not greater after lock',
    tot <= vn AND failed <= vn2, format('platform_roles %s->%s tenants %s->%s', vn, tot, vn2, failed));
  SELECT boundary_at INTO bAt FROM public.platform_mfa_recovery_auth_boundaries WHERE user_id = uT AND request_id = rT;
  vm := pg_temp.jwt_view(uT, sT, iatOld);
  PERFORM pg_temp.ck('M2 after execution: durable boundary = executed_at; old token denied; app state locked',
    bAt = (SELECT executed_at FROM public.platform_mfa_recovery_requests WHERE id = rT)
    AND vm->>'so' = 'false' AND vm->>'sa' = 'false'
    AND public.platform_mfa_recovery_authority_state(uT, sT::text, iatOld) = 'locked', vm::text);

  v := public.execute_platform_mfa_recovery(uA, sA, rT, h2, 'disabled');
  PERFORM pg_temp.ckdeny('E25 double execute denied', v, 'request_not_executable');
  v := public.cancel_platform_mfa_recovery(uA, sA, rT, NULL, 'disabled');
  PERFORM pg_temp.ckdeny('E26 no cancel after execution', v, 'cannot_cancel_after_execution');
  v := public.request_platform_mfa_recovery(uT, gen_random_uuid(), uC, 'Locked target tries to act', 15, 'disabled');
  PERFORM pg_temp.ck('E27 locked target has no recovery authority', v->>'ok' = 'false');

  -- Redemption
  v := public.redeem_platform_mfa_recovery_grant(uA, sA, h1, 'disabled');
  PERFORM pg_temp.ckdeny('E28 wrong user''s redemption denied', v, 'no_recovery_in_progress');
  sT2 := pg_temp.mk_session(uT, NULL, 'aal1', NULL, now() + interval '1 second');
  v := public.redeem_platform_mfa_recovery_grant(uT, sT2, hbad, 'disabled');
  PERFORM pg_temp.ckdeny('E29 wrong grant denied', v, 'grant_mismatch');
  sTold := pg_temp.mk_session(uT, NULL, 'aal1', NULL, now() - interval '1 minute');
  v := public.redeem_platform_mfa_recovery_grant(uT, sTold, h1, 'disabled');
  PERFORM pg_temp.ckdeny('E30 pre-recovery session cannot redeem', v, 'session_predates_recovery');
  DELETE FROM auth.sessions WHERE id = sTold;
  v := public.redeem_platform_mfa_recovery_grant(uT, sA, h1, 'disabled');
  PERFORM pg_temp.ckdeny('E31 redemption with another user''s session denied', v, 'session_user_mismatch');
  v := public.complete_platform_mfa_recovery(uT, sT2, 'disabled');
  PERFORM pg_temp.ckdeny('E32 completion before redemption denied', v, 'grant_not_redeemed');
  v := public.redeem_platform_mfa_recovery_grant(uT, sT2, h1, 'disabled');
  PERFORM pg_temp.ck('E33 new aal1 session redeems grant', v->>'ok' = 'true', v::text);
  vm := pg_temp.jwt_view(uT, sT, iatOld);
  PERFORM pg_temp.ck('M3 after grant redemption: old token denied', vm->>'so' = 'false' AND vm->>'sa' = 'false', vm::text);
  v := public.redeem_platform_mfa_recovery_grant(uT, sT2, h1, 'disabled');
  PERFORM pg_temp.ckdeny('E34 reused grant denied', v, 'grant_already_redeemed');
  sT3 := pg_temp.mk_session(uT, NULL, 'aal1', NULL, now() + interval '2 seconds');
  v := public.complete_platform_mfa_recovery(uT, sT3, 'disabled');
  PERFORM pg_temp.ckdeny('E35 completion from a different session denied', v, 'session_not_redeemed_session');
  v := public.complete_platform_mfa_recovery(uT, sT2, 'disabled');
  PERFORM pg_temp.ckdeny('E36 completion at aal1 denied (enrol() alone is not enough)', v, 'aal_insufficient');
  PERFORM pg_temp.ck('E37 target still locked before completion', public.is_platform_mfa_recovery_locked(uT) AND NOT public.is_super_owner(uT));
  fT2 := pg_temp.mk_factor(uT, now() + interval '3 seconds');
  vm := pg_temp.jwt_view(uT, sT, iatOld);
  PERFORM pg_temp.ck('M4 after replacement factor enrolment: old token denied', vm->>'so' = 'false', vm::text);
  UPDATE auth.sessions SET aal = 'aal2', factor_id = fT2 WHERE id = sT2;
  INSERT INTO auth.mfa_amr_claims (id, session_id, created_at, updated_at, authentication_method)
  VALUES (gen_random_uuid(), sT2, now() - interval '10 minutes', now() - interval '10 minutes', 'totp');
  vm := pg_temp.jwt_view(uT, sT, iatOld);
  vm := vm || jsonb_build_object('new_so', pg_temp.jwt_view(uT, sT2, iatNew)->>'so');
  PERFORM pg_temp.ck('M5 after aal2: old token denied; new session still locked until completion',
    vm->>'so' = 'false' AND vm->>'new_so' = 'false'
    AND public.platform_mfa_recovery_authority_state(uT, sT2::text, iatNew) = 'locked', vm::text);
  v := public.complete_platform_mfa_recovery(uT, sT2, 'disabled');
  PERFORM pg_temp.ckdeny('E38 stale TOTP completion denied', v, 'fresh_mfa_stale');
  UPDATE auth.mfa_amr_claims SET updated_at = now() WHERE session_id = sT2 AND authentication_method = 'totp';
  v := public.complete_platform_mfa_recovery(uT, sT2, 'enforce');
  PERFORM pg_temp.ck('E39 completion with verified new factor + fresh aal2 on redeemed session',
    v->>'ok' = 'true' AND v->>'status' = 'completed', v::text);
  PERFORM pg_temp.ck('E40 lock removed, authority restored, records unchanged',
    NOT public.is_platform_mfa_recovery_locked(uT) AND public.is_super_owner(uT) AND public.g7f3c3_authority_snapshot(uT) = vj);

  -- G7F-3C3A: completion must not resurrect any pre-execution authentication context.
  vm := pg_temp.jwt_view(uT, sT, iatOld);
  PERFORM pg_temp.ck('M6 after completion: OLD TOKEN STILL DENIED (so, sa, RLS tenants, audit)',
    vm->>'so' = 'false' AND vm->>'sa' = 'false' AND (vm->>'tenants')::int < (vbase->>'tenants')::int
    AND (vm->>'audit')::int < (vbase->>'audit')::int, format('before=%s after=%s', vbase, vm));
  PERFORM pg_temp.ck('M7 after completion: app state for the old context is stale_auth_context',
    public.platform_mfa_recovery_authority_state(uT, sT::text, iatOld) = 'stale_auth_context');
  vm := pg_temp.jwt_view(uT, sT2, iatNew);
  PERFORM pg_temp.ck('M8 post-recovery session token: authority restored to the pre-recovery level',
    vm->>'so' = 'true' AND vm->>'tenants' = vbase->>'tenants' AND public.platform_mfa_recovery_authority_state(uT, sT2::text, iatNew) = 'ok',
    vm::text);
  vm := pg_temp.jwt_view(uT, sT2, iatNew + 3000);
  UPDATE auth.sessions SET refreshed_at = (now() + interval '50 minutes')::timestamp, updated_at = now() + interval '50 minutes' WHERE id = sT2;
  PERFORM pg_temp.ck('M9 refreshed post-recovery token (same session_id, later iat) keeps authority',
    vm->>'so' = 'true' AND pg_temp.jwt_view(uT, sT2, iatNew + 3000)->>'so' = 'true'
    AND public.platform_mfa_recovery_authority_state(uT, sT2::text, iatNew + 3000) = 'ok', vm::text);
  PERFORM pg_temp.ck('M10 new session id but iat before the boundary denied',
    pg_temp.jwt_view(uT, sT2, iatOld)->>'so' = 'false' AND public.platform_mfa_recovery_authority_state(uT, sT2::text, iatOld) = 'stale_auth_context');
  PERFORM pg_temp.ck('M11 destroyed pre-recovery session denied even with a post-boundary iat',
    pg_temp.jwt_view(uT, sT, iatNew)->>'so' = 'false' AND public.platform_mfa_recovery_authority_state(uT, sT::text, iatNew) = 'stale_auth_context');
  PERFORM pg_temp.ck('M12 another user''s live session / unknown session / no session / no iat all denied',
    pg_temp.jwt_view(uT, sA, iatNew)->>'so' = 'false' AND pg_temp.jwt_view(uT, gen_random_uuid(), iatNew)->>'so' = 'false'
    AND pg_temp.jwt_view(uT, NULL, iatNew)->>'so' = 'false' AND pg_temp.jwt_view(uT, sT2, NULL)->>'so' = 'false'
    AND public.platform_mfa_recovery_authority_state(uT, NULL, NULL) = 'stale_auth_context'
    AND public.platform_mfa_recovery_authority_state(uT, 'not-a-uuid', iatNew) = 'stale_auth_context');
  sTpre := pg_temp.mk_session(uT, NULL, 'aal1', NULL, now() - interval '1 minute');
  sTexp := pg_temp.mk_session(uT, NULL, 'aal1', NULL, now() + interval '4 seconds');
  UPDATE auth.sessions SET not_after = now() - interval '1 second' WHERE id = sTexp;
  PERFORM pg_temp.ck('M13 live session created before the boundary denied; expired post-boundary session denied',
    pg_temp.jwt_view(uT, sTpre, iatNew)->>'so' = 'false' AND pg_temp.jwt_view(uT, sTexp, iatNew)->>'so' = 'false');
  DELETE FROM auth.sessions WHERE id IN (sTpre, sTexp);
  PERFORM pg_temp.ck('M14 users without a recovery history unaffected (any or no claims; app state ok)',
    pg_temp.jwt_view(uA, sA, iatOld)->>'so' = 'true' AND pg_temp.jwt_view(uA, NULL, NULL)->>'so' = 'true'
    AND public.platform_mfa_recovery_authority_state(uA, NULL, NULL) = 'ok');
  SELECT id INTO vt FROM public.tenants WHERE tenant_type = 'GROUP' AND status = 'active' ORDER BY created_at LIMIT 1;
  IF vt IS NULL THEN
    PERFORM pg_temp.skip('M15 tenant / G7D helpers', 'no active GROUP tenant on staging');
  ELSE
    vm := pg_temp.jwt_view(uT, sT, iatOld, vt::uuid)
          || jsonb_build_object('new', pg_temp.jwt_view(uT, sT2, iatNew, vt::uuid));
    PERFORM pg_temp.ck('M15 old token denied by tenant data / tenant admin / G7D basis helpers; new token allowed',
      vm->>'group_data' = 'false' AND vm->>'group_admin' = 'false' AND vm->>'g7d_basis' = 'false'
      AND vm->'new'->>'group_data' = 'true' AND vm->'new'->>'group_admin' = 'true' AND vm->'new'->>'g7d_basis' = 'true', vm::text);
  END IF;
  vt := NULL;

  -- G7F-3C3B: tenant membership authority honours the boundary and is never answered for another subject.
  BEGIN
    INSERT INTO public.tenant_memberships (tenant_id, user_id, role, active) VALUES (tenant, uT, 'supervisor', true);
    vm := jsonb_build_object('old', pg_temp.tenant_view(uT, sT, iatOld, uT, tenant),
                             'new', pg_temp.tenant_view(uT, sT2, iatNew, uT, tenant));
    PERFORM pg_temp.ck('N1 old token: membership row kept but tenant authority, RLS helpers and row reads denied; new token restored',
      vm->'old'->>'member' = 'false' AND vm->'old'->>'data' = 'false' AND vm->'old'->>'admin' = 'false'
      AND vm->'old'->>'access' = 'false' AND vm->'old'->>'staff_rls' = 'false' AND vm->'old'->>'admin_rls' = 'false'
      AND vm->'old'->>'own_rows' = '0' AND vm->'old'->>'tenant_row' = '0'
      AND vm->'new'->>'member' = 'true' AND vm->'new'->>'admin' = 'true' AND vm->'new'->>'staff_rls' = 'true'
      AND vm->'new'->>'admin_rls' = 'true' AND vm->'new'->>'own_rows' = '1' AND vm->'new'->>'tenant_row' = '1'
      AND EXISTS (SELECT 1 FROM public.tenant_memberships WHERE tenant_id = tenant AND user_id = uT AND role = 'supervisor' AND active),
      vm::text);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.skip('N1 tenant membership boundary', SQLERRM);
  END;
  vm := jsonb_build_object('spoof', pg_temp.tenant_view(uA, sA, iatOld, uX, tenant),
                           'self', pg_temp.tenant_view(uX, sX, iatOld, uX, tenant));
  PERFORM pg_temp.ck('N2 caller-supplied subject never answered; ordinary tenant Owner (no recovery) unchanged',
    vm->'spoof'->>'member' = 'false' AND vm->'spoof'->>'data' = 'false' AND vm->'spoof'->>'admin' = 'false'
    AND vm->'spoof'->>'access' = 'false'
    AND vm->'self'->>'member' = 'true' AND vm->'self'->>'data' = 'true' AND vm->'self'->>'admin' = 'true'
    AND vm->'self'->>'admin_rls' = 'true' AND vm->'self'->>'own_rows' = '1', vm::text);
  PERFORM pg_temp.ck('N3 service-role callers (no end-user claims) keep existing membership answers',
    public.has_tenant_membership(uX, tenant) AND public.can_administer_tenant(uX, tenant)
    AND public.has_tenant_membership(uT, tenant));
  PERFORM pg_temp.ck('N4 subject guard not client-executable; membership helpers not anon-executable',
    NOT has_function_privilege('authenticated', 'public.g7f3c3b_tenant_subject_current(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.g7f3c3b_tenant_subject_current(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.has_tenant_membership(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.g7f3c3b_auth_context_current()', 'EXECUTE'));
  PERFORM pg_temp.ck('M16 completion did not move or remove the boundary',
    (SELECT boundary_at FROM public.platform_mfa_recovery_auth_boundaries WHERE user_id = uT) = bAt);
  BEGIN
    DELETE FROM public.platform_mfa_recovery_auth_boundaries WHERE user_id = uT;
    vt := 'deleted';
  EXCEPTION WHEN OTHERS THEN vt := SQLERRM;
  END;
  BEGIN
    PERFORM set_config('g7f3c3.rpc', 'on', true);
    UPDATE public.platform_mfa_recovery_auth_boundaries SET boundary_at = boundary_at - interval '1 day' WHERE user_id = uT;
    vt := vt || '/lowered';
  EXCEPTION WHEN OTHERS THEN vt := vt || '/' || SQLERRM;
  END;
  PERFORM set_config('g7f3c3.rpc', 'off', true);
  BEGIN
    UPDATE public.platform_mfa_recovery_auth_boundaries SET boundary_at = boundary_at + interval '1 day' WHERE user_id = uT;
    vt := vt || '/raised_outside_rpc';
  EXCEPTION WHEN OTHERS THEN vt := vt || '/' || SQLERRM;
  END;
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    BEGIN
      EXECUTE 'DELETE FROM public.platform_mfa_recovery_auth_boundaries WHERE user_id = $1' USING uT;
      vt := vt || '/service_deleted';
    EXCEPTION WHEN insufficient_privilege THEN vt := vt || '/service_denied';
    END;
    EXECUTE 'RESET ROLE';
  END;
  PERFORM pg_temp.ck('M17 boundary cannot be deleted, lowered or written outside recovery RPCs',
    vt = 'mfa_recovery_boundary_immutable/mfa_recovery_boundary_immutable/mfa_recovery_state_rpc_only/service_denied', vt);
  PERFORM pg_temp.ck('E41 REPLACEMENT_ENROLLED + COMPLETED audited',
    (SELECT count(*) FROM public.security_audit_events WHERE metadata->>'request_id' = rT::text
      AND event_type IN ('MFA_REPLACEMENT_ENROLLED', 'MFA_RECOVERY_COMPLETED', 'MFA_RECOVERY_GRANT_REDEEMED')) = 3);
  v := public.complete_platform_mfa_recovery(uT, sT2, 'disabled');
  PERFORM pg_temp.ckdeny('E42 double completion denied', v, 'no_recovery_in_progress');
  v := public.cancel_platform_mfa_recovery(uA, sA, rT, NULL, 'disabled');
  PERFORM pg_temp.ckdeny('E43 completed request cannot be cancelled', v, 'request_terminal');
  v := public.execute_platform_mfa_recovery(uA, sA, rT, h2, 'disabled');
  PERFORM pg_temp.ckdeny('E44 completed request cannot be re-executed', v, 'request_not_executable');
  BEGIN
    PERFORM set_config('g7f3c3.rpc', 'on', true);
    UPDATE public.platform_mfa_recovery_requests SET status = 'requested' WHERE id = rT;
    PERFORM set_config('g7f3c3.rpc', 'off', true);
    PERFORM pg_temp.ck('E45 terminal cannot revive', false, 'update succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('g7f3c3.rpc', 'off', true);
    PERFORM pg_temp.ck('E45 terminal cannot revive (even past the write guard)', SQLERRM = 'mfa_recovery_terminal_state', SQLERRM);
  END;
  BEGIN
    UPDATE public.platform_mfa_recovery_requests SET reason = 'tampered reason text' WHERE id = rT;
    PERFORM pg_temp.ck('E46 direct write blocked', false, 'update succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.ck('E46 direct table write blocked outside RPCs', SQLERRM = 'mfa_recovery_state_rpc_only', SQLERRM);
  END;
  BEGIN
    INSERT INTO public.platform_mfa_recovery_locks (user_id, request_id) VALUES (uA, rT);
    PERFORM pg_temp.ck('E47 direct lock insert blocked', false, 'insert succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.ck('E47 direct lock insert/delete blocked outside RPCs', SQLERRM = 'mfa_recovery_state_rpc_only', SQLERRM);
  END;
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    BEGIN
      EXECUTE 'UPDATE public.platform_mfa_recovery_requests SET reason = $1 WHERE id = $2' USING 'tampered by service', rT;
      vt := 'allowed';
    EXCEPTION WHEN insufficient_privilege THEN vt := 'denied';
    END;
    BEGIN
      EXECUTE 'SELECT grant_hash FROM public.platform_mfa_recovery_requests LIMIT 1';
      vt := vt || '/hash_readable';
    EXCEPTION WHEN insufficient_privilege THEN vt := vt || '/hash_denied';
    END;
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.ck('E48 service_role cannot write rows or read grant_hash', vt = 'denied/hash_denied', vt);
  END;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      EXECUTE 'SELECT public.execute_platform_mfa_recovery($1,$2,$3,$4,$5)' USING uA, sA, rT, h2, 'disabled';
      vt := 'allowed';
    EXCEPTION WHEN insufficient_privilege THEN vt := 'denied';
    END;
    EXECUTE 'RESET ROLE';
    PERFORM pg_temp.ck('E49 authenticated clients cannot call recovery RPCs', vt = 'denied', vt);
  END;

  -- ============================================================================================
  -- F. Super Admin target: no cooling-off; pre-enrolled attacker factor fails closed
  -- ============================================================================================
  v := public.request_platform_mfa_recovery(uA, sA, uS, 'Super Admin lost authenticator', NULL, 'disabled');
  rS := (v->>'request_id')::uuid;
  PERFORM pg_temp.ck('F2 SA target request: no cooling-off',
    v->>'ok' = 'true' AND v->>'target_kind' = 'super_admin' AND (v->>'cooling_off_until')::timestamptz = now(), v::text);
  v := public.approve_platform_mfa_recovery(uB, sB, rS, 'disabled');
  PERFORM pg_temp.ckdeny('F3 SA target takes no second approval', v, 'second_approval_not_applicable');
  v := public.execute_platform_mfa_recovery(uA, sA, rS, h2, 'disabled');
  PERFORM pg_temp.ck('F4 SA recovery executes immediately', v->>'ok' = 'true', v::text);
  PERFORM pg_temp.ck('F5 is_super_admin(S) false while locked', NOT public.is_super_admin(uS) AND public.is_platform_mfa_recovery_locked(uS));
  fAtt := pg_temp.mk_factor(uS, now());  -- enrolled at/before redemption (attacker with password)
  sSn := pg_temp.mk_session(uS, NULL, 'aal1', NULL, now() + interval '1 second');
  v := public.redeem_platform_mfa_recovery_grant(uS, sSn, h2, 'disabled');
  PERFORM pg_temp.ck('F6 target redeems grant', v->>'ok' = 'true', v::text);
  UPDATE auth.sessions SET aal = 'aal2', factor_id = fAtt WHERE id = sSn;
  INSERT INTO auth.mfa_amr_claims (id, session_id, created_at, updated_at, authentication_method)
  VALUES (gen_random_uuid(), sSn, now(), now(), 'totp');
  v := public.complete_platform_mfa_recovery(uS, sSn, 'disabled');
  PERFORM pg_temp.ckdeny('F7 pre-enrolled attacker factor fails closed', v, 'unexpected_factor_state');
  PERFORM pg_temp.ck('F8 request failed (terminal), target stays locked, audit flagged',
    (SELECT status FROM public.platform_mfa_recovery_requests WHERE id = rS) = 'failed'
    AND public.is_platform_mfa_recovery_locked(uS) AND NOT public.is_super_admin(uS)
    AND EXISTS (SELECT 1 FROM public.security_audit_events WHERE event_type = 'MFA_RECOVERY_DENIED'
                AND metadata->>'request_id' = rS::text AND metadata->>'flagged' = 'true'));
  vj2 := public.get_platform_mfa_recovery_self_state(uS, sSn);
  PERFORM pg_temp.ck('F9 self state: locked, failed, no grant_hash key',
    vj2->>'locked' = 'true' AND vj2->>'status' = 'failed' AND NOT (vj2 ? 'grant_hash'), vj2::text);

  -- ============================================================================================
  -- G. Execution-time re-checks
  -- ============================================================================================
  v := public.request_platform_mfa_recovery(uA, sA, uS2, 'Super Admin two factor change', NULL, 'disabled');
  rS2 := (v->>'request_id')::uuid;
  PERFORM pg_temp.mk_factor(uS2);
  v := public.execute_platform_mfa_recovery(uA, sA, rS2, h3, 'disabled');
  PERFORM pg_temp.ckdeny('G1 factor changed before execution denied', v, 'target_factor_changed');
  PERFORM pg_temp.ck('G2 factor-changed request is terminal (denied), factors intact',
    (SELECT status FROM public.platform_mfa_recovery_requests WHERE id = rS2) = 'denied'
    AND (SELECT count(*) FROM auth.mfa_factors WHERE user_id = uS2) = 2);
  v := public.request_platform_mfa_recovery(uA, sA, uS2, 'Super Admin ambiguous factors', NULL, 'disabled');
  PERFORM pg_temp.ckdeny('G3 ambiguous (2 verified) factors cannot be requested', v, 'target_factor_ambiguous');
  v := public.request_platform_mfa_recovery(uA, sA, uS3, 'Super Admin kind change test', NULL, 'disabled');
  rS3 := (v->>'request_id')::uuid;
  INSERT INTO public.platform_roles (user_id, role) VALUES (uS3, 'super_owner');
  v := public.execute_platform_mfa_recovery(uA, sA, rS3, h3, 'disabled');
  PERFORM pg_temp.ckdeny('G4 target role changed before execution denied', v, 'target_kind_changed');
  DELETE FROM public.platform_roles WHERE user_id = uS3 AND role = 'super_owner';

  v := public.request_platform_mfa_recovery(uA, sA, uC, 'Approver becomes unusable', 15, 'disabled');
  rC := (v->>'request_id')::uuid;
  v := public.approve_platform_mfa_recovery(uB, sB, rC, 'disabled');
  DELETE FROM auth.mfa_factors WHERE id = fA;
  v := public.execute_platform_mfa_recovery(uB, sB, rC, h3, 'disabled');
  PERFORM pg_temp.ckdeny('G5 requester no longer qualified at execution', v, 'approver_no_longer_qualified');
  PERFORM pg_temp.ck('G6 request denied (terminal); C untouched',
    (SELECT status FROM public.platform_mfa_recovery_requests WHERE id = rC) = 'denied'
    AND EXISTS (SELECT 1 FROM auth.mfa_factors WHERE id = fC) AND NOT public.is_platform_mfa_recovery_locked(uC));
  v := public.request_platform_mfa_recovery(uA, sA, uS4, 'Unusable requester tries again', NULL, 'disabled');
  PERFORM pg_temp.ckdeny('G7 SO without verified TOTP cannot initiate', v, 'actor_not_recovery_authority');
  fA := pg_temp.mk_factor(uA);
  UPDATE auth.sessions SET factor_id = fA WHERE user_id = uA;

  -- ============================================================================================
  -- H. Cancellation
  -- ============================================================================================
  v := public.request_platform_mfa_recovery(uA, sA, uS5, 'Cancel path for Super Admin', NULL, 'disabled');
  rS5 := (v->>'request_id')::uuid;
  v := public.cancel_platform_mfa_recovery(uX, sX, rS5, NULL, 'disabled');
  PERFORM pg_temp.ckdeny('H1 tenant Owner cannot cancel', v, 'actor_cannot_cancel');
  v := public.cancel_platform_mfa_recovery(uS5, sS5, rS5, 'I still have my phone', 'disabled');
  PERFORM pg_temp.ck('H2 target cancels with fresh TOTP', v->>'ok' = 'true' AND v->>'cancel_basis' = 'target', v::text);
  v := public.execute_platform_mfa_recovery(uA, sA, rS5, h3, 'disabled');
  PERFORM pg_temp.ckdeny('H3 cancelled request cannot execute', v, 'request_not_executable');
  v := public.cancel_platform_mfa_recovery(uA, sA, rS5, NULL, 'disabled');
  PERFORM pg_temp.ckdeny('H4 cancelled request cannot be re-cancelled', v, 'request_terminal');
  PERFORM pg_temp.ck('H5 cancelled target untouched', EXISTS (SELECT 1 FROM auth.mfa_factors WHERE id = fS5)
    AND public.is_super_admin(uS5));
  v := public.request_platform_mfa_recovery(uA, sA, uS5, 'Second cancel path request', NULL, 'disabled');
  rS5b := (v->>'request_id')::uuid;
  v := public.cancel_platform_mfa_recovery(uB, sB, rS5b, NULL, 'disabled');
  PERFORM pg_temp.ck('H6 another normal SO can cancel', v->>'ok' = 'true' AND v->>'cancel_basis' = 'normal_super_owner', v::text);

  -- ============================================================================================
  -- I. Atomicity: a failing postcondition rolls back the whole execution
  -- ============================================================================================
  v := public.request_platform_mfa_recovery(uA, sA, uS6, 'Atomicity rollback check', NULL, 'disabled');
  rS6 := (v->>'request_id')::uuid;
  BEGIN
    CREATE FUNCTION pg_temp.g7t_reinject() RETURNS trigger LANGUAGE plpgsql AS $t$
    BEGIN
      IF NEW.status = 'executed_awaiting_enrolment' THEN
        INSERT INTO auth.sessions (id, user_id, created_at, updated_at, aal) VALUES (gen_random_uuid(), NEW.target_user_id, now(), now(), 'aal1');
      END IF;
      RETURN NEW;
    END $t$;
    CREATE TRIGGER g7t_reinject AFTER UPDATE ON public.platform_mfa_recovery_requests
      FOR EACH ROW EXECUTE FUNCTION pg_temp.g7t_reinject();
    BEGIN
      v := public.execute_platform_mfa_recovery(uA, sA, rS6, h4, 'disabled');
      vt := 'no_error:' || v::text;
    EXCEPTION WHEN OTHERS THEN vt := SQLERRM;
    END;
    DROP TRIGGER g7t_reinject ON public.platform_mfa_recovery_requests;
    PERFORM pg_temp.ck('I1 postcondition failure raises and rolls back everything',
      vt = 'g7f3c3_postcondition_failed:sessions_remain'
      AND EXISTS (SELECT 1 FROM auth.mfa_factors WHERE id = fS6)
      AND EXISTS (SELECT 1 FROM auth.sessions WHERE id = sS6)
      AND NOT public.is_platform_mfa_recovery_locked(uS6)
      AND (SELECT status FROM public.platform_mfa_recovery_requests WHERE id = rS6) = 'requested'
      AND NOT EXISTS (SELECT 1 FROM public.security_audit_events WHERE metadata->>'request_id' = rS6::text
                      AND event_type = 'MFA_RECOVERY_EXECUTED'), vt);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.skip('I1 atomicity (test trigger not permitted)', SQLERRM);
  END;

  -- ============================================================================================
  -- J. Break-glass target (fixtures G, G2; BG1 untouched)
  -- ============================================================================================
  BEGIN
    DROP INDEX public.platform_break_glass_identities_one_active_uidx;
    INSERT INTO public.platform_break_glass_identities (id, user_id, active, created_at, reason, metadata)
    VALUES (gen_random_uuid(), uG, true, now(), 'g7f3c3 harness', '{}'::jsonb),
           (gen_random_uuid(), uG2, true, now(), 'g7f3c3 harness', '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    can_bg := false;
    PERFORM pg_temp.skip('J* break-glass fixtures', SQLERRM);
  END;
  IF can_bg THEN
    vn := (public.g7f3c3_final_path_counts(uT)->>'usable_bg')::int;
    PERFORM pg_temp.ck('J1 BG fixtures counted as BG, not normal SO',
      public.g7f3c3_target_kind(uG) = 'break_glass' AND public.g7f3c3_usable_bg(uG) AND NOT public.g7f3c3_usable_normal_so(uG));
    v := public.request_platform_mfa_recovery(uG2, sG2, uT, 'Break-glass tries to initiate', 15, 'disabled');
    PERFORM pg_temp.ckdeny('J2 BG cannot initiate', v, 'actor_not_recovery_authority');
    v := public.request_platform_mfa_recovery(uG, sG, uG, 'Break-glass self recovery try', 15, 'disabled');
    PERFORM pg_temp.ckdeny('J3 BG cannot recover itself', v, 'self_recovery_denied');
    v := public.request_platform_mfa_recovery(uA, sA, uG, 'Break-glass lost authenticator', 15, 'disabled');
    rG := (v->>'request_id')::uuid;
    PERFORM pg_temp.ck('J4 BG target request needs second approval', v->>'ok' = 'true' AND v->>'requires_second_approval' = 'true', v::text);
    v := public.execute_platform_mfa_recovery(uA, sA, rG, h3, 'disabled');
    PERFORM pg_temp.ckdeny('J5 BG with one approval cannot execute', v, 'second_approval_required');
    v := public.approve_platform_mfa_recovery(uG2, sG2, rG, 'disabled');
    PERFORM pg_temp.ckdeny('J6 BG cannot approve BG recovery', v, 'actor_not_recovery_authority');
    v := public.approve_platform_mfa_recovery(uG, sG, rG, 'disabled');
    PERFORM pg_temp.ckdeny('J7 BG target cannot approve itself', v, 'self_approval_denied');
    v := public.approve_platform_mfa_recovery(uB, sB, rG, 'disabled');
    PERFORM pg_temp.ck('J8 second distinct normal SO approves BG recovery', v->>'ok' = 'true', v::text);
    v := public.execute_platform_mfa_recovery(uB, sB, rG, h3, 'disabled');
    PERFORM pg_temp.ckdeny('J9 BG cooling-off still applies after two approvals', v, 'cooling_off_active');
    INSERT INTO public.platform_break_glass_sessions (user_id, auth_session_id, started_at, last_activity_at, absolute_expires_at)
    VALUES (uG, sG::text, now(), now(), now() + interval '1 hour');
    BEGIN
      PERFORM pg_temp.shift(rG, interval '16 minutes');
    EXCEPTION WHEN OTHERS THEN
      can_shift := false;
      PERFORM pg_temp.skip('J10 time shift', SQLERRM);
    END;
    IF can_shift THEN
      v := public.execute_platform_mfa_recovery(uB, sB, rG, h3, 'disabled');
      PERFORM pg_temp.ck('J10 BG recovery executes after cooling-off by second approver',
        v->>'ok' = 'true' AND (v->>'bg_sessions_ended_count')::int = 1, v::text);
      PERFORM pg_temp.ck('J11 BG session ended with mfa_recovery; BG identity unchanged; G locked',
        EXISTS (SELECT 1 FROM public.platform_break_glass_sessions WHERE user_id = uG AND end_reason = 'mfa_recovery')
        AND NOT EXISTS (SELECT 1 FROM public.platform_break_glass_sessions WHERE user_id = uG AND ended_at IS NULL)
        AND EXISTS (SELECT 1 FROM public.platform_break_glass_identities WHERE user_id = uG AND active)
        AND public.is_platform_mfa_recovery_locked(uG) AND NOT public.is_super_owner(uG)
        AND EXISTS (SELECT 1 FROM public.security_audit_events WHERE metadata->>'request_id' = rG::text
                    AND event_type = 'BREAK_GLASS_SESSION_ENDED'));
      PERFORM pg_temp.ck('J12 locked BG no longer counted as usable BG',
        (public.g7f3c3_final_path_counts(uT)->>'usable_bg')::int = vn - 1);
    END IF;

    -- BG may expedite a normal SO recovery but never execute it.
    v := public.request_platform_mfa_recovery(uA, sA, uC, 'BG expedites normal SO recovery', 15, 'disabled');
    rC := (v->>'request_id')::uuid;
    v := public.approve_platform_mfa_recovery(uG2, sG2, rC, 'disabled');
    PERFORM pg_temp.ck('J13 BG approves (expedites) normal SO recovery', v->>'ok' = 'true' AND v->>'approval_basis' = 'break_glass', v::text);
    v := public.execute_platform_mfa_recovery(uG2, sG2, rC, h4, 'disabled');
    PERFORM pg_temp.ckdeny('J14 BG cannot execute', v, 'actor_not_recovery_authority');
    vn2 := (public.g7f3c3_final_path_counts(uT)->>'usable_normal_so')::int;
    v := public.execute_platform_mfa_recovery(uA, sA, rC, h4, 'disabled');
    PERFORM pg_temp.ck('J15 requester executes BG-expedited recovery', v->>'ok' = 'true', v::text);
    PERFORM pg_temp.ck('J16 two SOs in recovery reduce usable count (serialised, re-counted)',
      (public.g7f3c3_final_path_counts(uT)->>'usable_normal_so')::int = vn2 - 1);

    -- Reissue + grant attempt limit on C
    v := public.reissue_platform_mfa_recovery_grant(uX, sX, rC, h1, 'disabled');
    PERFORM pg_temp.ckdeny('J17 unrelated user cannot reissue', v, 'executor_not_request_authority');
    sCn := pg_temp.mk_session(uC, NULL, 'aal1', NULL, now() + interval '1 second');
    fSn := pg_temp.mk_factor(uC, now() + interval '1 second', 'unverified');
    v := public.reissue_platform_mfa_recovery_grant(uA, sA, rC, h1, 'disabled');
    PERFORM pg_temp.ck('J18 reissue purges post-execution sessions/factors and issues new grant',
      v->>'ok' = 'true' AND NOT EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = uC)
      AND NOT EXISTS (SELECT 1 FROM auth.mfa_factors WHERE user_id = uC), v::text);
    SELECT boundary_at INTO bAt FROM public.platform_mfa_recovery_auth_boundaries WHERE user_id = uC AND request_id = rC;
    SELECT grant_issued_at, grant_expires_at INTO gi0, ge0 FROM public.platform_mfa_recovery_requests WHERE id = rC;
    BEGIN
      PERFORM set_config('g7f3c3.rpc', 'on', true);
      UPDATE public.platform_mfa_recovery_requests SET grant_issued_at = now() + interval '5 minutes' WHERE id = rC;
      vb := (SELECT boundary_at FROM public.platform_mfa_recovery_auth_boundaries WHERE user_id = uC) = now() + interval '5 minutes';
      UPDATE public.platform_mfa_recovery_requests
      SET grant_issued_at = now() - interval '1 hour', grant_expires_at = now() - interval '45 minutes' WHERE id = rC;
      vb := vb AND (SELECT boundary_at FROM public.platform_mfa_recovery_auth_boundaries WHERE user_id = uC) = now() + interval '5 minutes';
      UPDATE public.platform_mfa_recovery_requests SET grant_issued_at = gi0, grant_expires_at = ge0 WHERE id = rC;
      PERFORM set_config('g7f3c3.rpc', 'off', true);
    EXCEPTION WHEN OTHERS THEN
      PERFORM set_config('g7f3c3.rpc', 'off', true);
      vb := false; vt := SQLERRM;
    END;
    PERFORM pg_temp.ck('M18 execute/reissue record the boundary; later grant issuance moves it forward only',
      bAt IS NOT NULL AND vb, COALESCE(vt, ''));
    sCn := pg_temp.mk_session(uC, NULL, 'aal1', NULL, now() + interval '1 second');
    v := public.redeem_platform_mfa_recovery_grant(uC, sCn, h4, 'disabled');
    PERFORM pg_temp.ckdeny('J19 superseded grant rejected after reissue', v, 'grant_mismatch');
    FOR vn IN 1..4 LOOP
      v := public.redeem_platform_mfa_recovery_grant(uC, sCn, hbad, 'disabled');
    END LOOP;
    v := public.redeem_platform_mfa_recovery_grant(uC, sCn, h1, 'disabled');
    PERFORM pg_temp.ckdeny('J20 five wrong attempts invalidate the grant', v, 'grant_expired');
    PERFORM pg_temp.ck('J21 target remains locked after grant invalidation', public.is_platform_mfa_recovery_locked(uC));
  END IF;

  -- ============================================================================================
  -- K. Expiry (execution window; enrolment window keeps the target locked)
  -- ============================================================================================
  IF can_shift THEN
    v := public.request_platform_mfa_recovery(uA, sA, uS4, 'Expiry path for Super Admin', NULL, 'disabled');
    rS4 := (v->>'request_id')::uuid;
    PERFORM pg_temp.shift(rS4, interval '2 hours');
    v := public.execute_platform_mfa_recovery(uA, sA, rS4, h4, 'disabled');
    PERFORM pg_temp.ckdeny('K1 expired request cannot execute', v, 'request_expired');
    PERFORM pg_temp.ck('K2 expired is terminal and audited; target untouched',
      (SELECT status FROM public.platform_mfa_recovery_requests WHERE id = rS4) = 'expired'
      AND EXISTS (SELECT 1 FROM public.security_audit_events WHERE event_type = 'MFA_RECOVERY_EXPIRED' AND metadata->>'request_id' = rS4::text)
      AND EXISTS (SELECT 1 FROM auth.mfa_factors WHERE id = fS4));
    v := public.request_platform_mfa_recovery(uA, sA, uS4, 'Enrolment window expiry path', NULL, 'disabled');
    rS4 := (v->>'request_id')::uuid;
    v := public.execute_platform_mfa_recovery(uA, sA, rS4, h4, 'disabled');
    PERFORM pg_temp.shift(rS4, interval '25 hours');
    PERFORM pg_temp.ck('K3 sweep expires executed request past 24 h', public.expire_platform_mfa_recovery_requests('disabled') >= 1);
    PERFORM pg_temp.ck('K4 enrolment-window expiry keeps the target locked',
      (SELECT status FROM public.platform_mfa_recovery_requests WHERE id = rS4) = 'expired'
      AND public.is_platform_mfa_recovery_locked(uS4) AND NOT public.is_super_admin(uS4)
      AND public.get_platform_mfa_recovery_self_state(uS4, NULL)->>'status' = 'expired');
    v := public.request_platform_mfa_recovery(uA, sA, uS4, 'New recovery after expiry', NULL, 'disabled');
    PERFORM pg_temp.ck('K5 a new recovery can be started for a locked factorless target', v->>'ok' = 'true', v::text);
  ELSE
    PERFORM pg_temp.skip('K* expiry', 'time shift unavailable');
  END IF;

  -- ============================================================================================
  -- L. Audit hygiene
  -- ============================================================================================
  PERFORM pg_temp.ck('L1 no grant hash, TOTP secret, token or password in any recovery audit metadata',
    NOT EXISTS (
      SELECT 1 FROM public.security_audit_events
      WHERE created_at >= now() AND metadata->>'source' = 'g7f3c3_mfa_recovery'
        AND (metadata::text LIKE '%' || h1 || '%' OR metadata::text LIKE '%' || h2 || '%'
             OR metadata::text LIKE '%' || h3 || '%' OR metadata::text LIKE '%' || h4 || '%'
             OR metadata::text LIKE '%' || hbad || '%'
             OR metadata ? 'grant_hash' OR metadata ? 'grant' OR metadata ? 'secret' OR metadata ? 'totp_secret'
             OR metadata ? 'refresh_token' OR metadata ? 'access_token' OR metadata ? 'password'
             OR metadata::text LIKE '%HARNESS-NOT-A-SECRET%')));
  PERFORM pg_temp.ck('L2 all recovery audit rows authoritative with source tag',
    NOT EXISTS (SELECT 1 FROM public.security_audit_events WHERE created_at >= now()
      AND event_type LIKE 'MFA_RECOVERY%' AND (metadata->>'source' IS DISTINCT FROM 'g7f3c3_mfa_recovery'
                                               OR metadata->>'authoritative' IS DISTINCT FROM 'true')));
  BEGIN
    DELETE FROM auth.users WHERE id = uT;
    PERFORM pg_temp.ck('M19 boundary removed only by Auth user deletion (cascade)',
      NOT EXISTS (SELECT 1 FROM public.platform_mfa_recovery_auth_boundaries WHERE user_id = uT));
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.skip('M19 Auth user deletion cascade', SQLERRM);
  END;

  -- ============================================================================================
  SELECT count(*), count(*) FILTER (WHERE NOT ok), count(*) FILTER (WHERE skip),
         string_agg(CASE WHEN skip THEN 'SKIP ' WHEN ok THEN 'PASS ' ELSE 'FAIL ' END || name
                    || CASE WHEN (NOT ok OR skip) AND detail <> '' THEN ' [' || left(detail, 300) || ']' ELSE '' END,
                    E'\n' ORDER BY n)
    INTO tot, failed, skipped, report FROM g7t;
  RAISE EXCEPTION E'G7F3C3_HARNESS total=% failed=% skipped=% (rolled back)\n%', tot, failed, skipped, report;
END
$g7f3c3$;
