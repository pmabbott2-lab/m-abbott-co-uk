-- G7F-1B-D1 disposable SQL matrix.
-- Temporarily swaps active BG classification to a disposable user, then ALWAYS restores BG1.
-- Does not end BG1 Auth, create BG1 server sessions, or alter BG1 platform_roles permanently.
CREATE SCHEMA IF NOT EXISTS g6b_private;
CREATE TABLE IF NOT EXISTS g6b_private.g7f1bd1_test_results (
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
TRUNCATE g6b_private.g7f1bd1_test_results;

DO $body$
DECLARE
  r jsonb := '[]'::jsonb;
  v_so1 uuid; v_bg1 uuid; v_d1 uuid;
  v1 jsonb; v2 jsonb;
  v_ok boolean; v_started timestamptz; v_last timestamptz;
  v_login1 int; v_access1 int;
  v_sid text := 'd1-auth-session-A';
  v_bg1_bg_id uuid;
BEGIN
  SELECT id INTO v_so1 FROM auth.users WHERE lower(email)='pmabbott2@aol.com';
  SELECT id INTO v_bg1 FROM auth.users WHERE lower(email)='staging-g7f1b-break-glass@example.test';
  IF v_so1 IS NULL OR v_bg1 IS NULL THEN RAISE EXCEPTION 'SO1/BG1 missing'; END IF;
  SELECT id INTO v_bg1_bg_id FROM public.platform_break_glass_identities WHERE user_id=v_bg1 AND active LIMIT 1;

  DELETE FROM public.platform_break_glass_sessions
    WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'staging-g7f1bd1-%@example.test');
  DELETE FROM public.platform_break_glass_identities
    WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'staging-g7f1bd1-%@example.test')
       OR reason ILIKE 'g7f1bd1%';
  DELETE FROM public.security_audit_events
    WHERE metadata->>'source'='break_glass_platform_session'
      AND acting_user_id IN (SELECT id FROM auth.users WHERE email LIKE 'staging-g7f1bd1-%@example.test');
  DELETE FROM public.platform_roles WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE 'staging-g7f1bd1-%@example.test');
  DELETE FROM auth.users WHERE email LIKE 'staging-g7f1bd1-%@example.test';
  DELETE FROM g6b_private.staging_credentials WHERE email LIKE 'staging-g7f1bd1-%@example.test';

  v_d1 := g6b_private.create_persona('staging-g7f1bd1-bg@example.test', 'D1 BG', '07000004001');
  INSERT INTO public.platform_roles (user_id, role) VALUES (v_d1, 'super_owner') ON CONFLICT DO NOTHING;

  -- Soft-swap active BG to disposable (restore BG1 in cleanup)
  UPDATE public.platform_break_glass_identities
  SET active=false, deactivated_at=now()
  WHERE user_id=v_bg1 AND active;
  INSERT INTO public.platform_break_glass_identities (user_id, active, created_by, reason)
  VALUES (v_d1, true, v_so1, 'g7f1bd1 disposable');

  BEGIN
    v1 := public.ensure_break_glass_platform_session(v_d1, v_sid, 1000, 'session_check', true);
    v_ok := (v1->>'active')::boolean AND (v1->>'outcome')='created';
    r := r || jsonb_build_array(jsonb_build_object('t','01_first_login','ok',v_ok));
    v_started := (v1->>'started_at')::timestamptz;
    SELECT count(*)::int INTO v_login1 FROM public.security_audit_events
      WHERE acting_user_id=v_d1 AND event_type='BREAK_GLASS_LOGIN_SUCCEEDED' AND metadata->>'source'='break_glass_platform_session';
    SELECT count(*)::int INTO v_access1 FROM public.security_audit_events
      WHERE acting_user_id=v_d1 AND event_type='BREAK_GLASS_PLATFORM_ACCESS' AND metadata->>'source'='break_glass_platform_session';

    v2 := public.ensure_break_glass_platform_session(v_d1, v_sid, 1000, 'session_check', true);
    v_ok := (v2->>'outcome')='existing' AND (v2->>'started_at')::timestamptz=v_started;
    r := r || jsonb_build_array(jsonb_build_object('t','02_refresh','ok',v_ok));

    v2 := public.ensure_break_glass_platform_session(v_d1, v_sid, 1000, 'session_check', true);
    v_ok := (v2->>'started_at')::timestamptz=v_started
      AND (SELECT count(*) FROM public.platform_break_glass_sessions WHERE user_id=v_d1 AND ended_at IS NULL)=1;
    r := r || jsonb_build_array(jsonb_build_object('t','03_second_tab','ok',v_ok));

    v2 := public.ensure_break_glass_platform_session(v_d1, v_sid, 9999, 'session_check', true);
    v_ok := (v2->>'started_at')::timestamptz=v_started AND (v2->>'outcome')='existing';
    r := r || jsonb_build_array(jsonb_build_object('t','04_05_06_07_cookie_delete_no_reset','ok',v_ok));

    v_ok := v_login1=1 AND v_access1=1 AND
      (SELECT count(*)::int FROM public.security_audit_events WHERE acting_user_id=v_d1 AND event_type='BREAK_GLASS_LOGIN_SUCCEEDED' AND metadata->>'source'='break_glass_platform_session')=1;
    r := r || jsonb_build_array(jsonb_build_object('t','17_25_audit_dedup','ok',v_ok));

    SELECT last_activity_at INTO v_last FROM public.platform_break_glass_sessions WHERE user_id=v_d1 AND ended_at IS NULL;
    PERFORM pg_sleep(0.05);
    v2 := public.touch_break_glass_platform_session(v_d1, v_sid, 'platform_navigation');
    v_ok := (v2->>'touched')::boolean
      AND (SELECT last_activity_at FROM public.platform_break_glass_sessions WHERE user_id=v_d1 AND ended_at IS NULL) > v_last
      AND (SELECT started_at FROM public.platform_break_glass_sessions WHERE user_id=v_d1 AND ended_at IS NULL)=v_started;
    r := r || jsonb_build_array(jsonb_build_object('t','08_meaningful_touch','ok',v_ok));

    SELECT last_activity_at INTO v_last FROM public.platform_break_glass_sessions WHERE user_id=v_d1 AND ended_at IS NULL;
    v2 := public.ensure_break_glass_platform_session(v_d1, v_sid, 1000, 'session_check', true);
    v_ok := (SELECT last_activity_at FROM public.platform_break_glass_sessions WHERE user_id=v_d1 AND ended_at IS NULL)=v_last;
    r := r || jsonb_build_array(jsonb_build_object('t','09_background_no_touch','ok',v_ok));

    v_ok := (SELECT absolute_expires_at <= started_at + interval '60 minutes' + interval '1 second'
               AND absolute_expires_at > started_at
             FROM public.platform_break_glass_sessions WHERE user_id=v_d1 AND ended_at IS NULL);
    r := r || jsonb_build_array(jsonb_build_object('t','24_absolute_immutable','ok',v_ok));

    -- Backdate started_at so last_activity_at >= started_at CHECK still holds.
    UPDATE public.platform_break_glass_sessions
      SET started_at = now() - interval '20 minutes',
          last_activity_at = now() - interval '16 minutes',
          absolute_expires_at = (now() - interval '20 minutes') + interval '60 minutes'
      WHERE user_id=v_d1 AND ended_at IS NULL;
    v2 := public.ensure_break_glass_platform_session(v_d1, v_sid, 1000, 'session_check', true);
    v_ok := (v2->>'active')::boolean=false AND (v2->>'reason')='same_auth_session_locked';
    r := r || jsonb_build_array(jsonb_build_object('t','10_idle_expiry','ok',v_ok));

    v1 := public.ensure_break_glass_platform_session(v_d1, 'd1-auth-session-B', 2000, 'session_check', true);
    UPDATE public.platform_break_glass_sessions
      SET started_at = now() - interval '61 minutes',
          last_activity_at = now() - interval '1 minutes',
          absolute_expires_at = now() - interval '1 minutes'
      WHERE user_id=v_d1 AND ended_at IS NULL;
    v2 := public.ensure_break_glass_platform_session(v_d1, 'd1-auth-session-B', 2000, 'session_check', true);
    v_ok := (v2->>'active')::boolean=false AND (v2->>'reason')='same_auth_session_locked';
    r := r || jsonb_build_array(jsonb_build_object('t','11_absolute_expiry','ok',v_ok));
    r := r || jsonb_build_array(jsonb_build_object('t','12_same_auth_reopen','ok',v_ok));

    v2 := public.ensure_break_glass_platform_session(v_d1, NULL, 99999, 'session_check', true);
    v_ok := (v2->>'reason')='auth_session_id_required';
    r := r || jsonb_build_array(jsonb_build_object('t','21_no_session_id','ok',v_ok));

    v2 := public.ensure_break_glass_platform_session(v_d1, 'd1-auth-session-B', 999999, 'session_check', true);
    v_ok := (v2->>'reason')='same_auth_session_locked';
    r := r || jsonb_build_array(jsonb_build_object('t','22_iat_alone','ok',v_ok));

    v1 := public.ensure_break_glass_platform_session(v_d1, 'd1-auth-session-C', 3000, 'session_check', true);
    UPDATE public.platform_break_glass_identities SET active=false, deactivated_at=now() WHERE user_id=v_d1 AND active;
    v2 := public.ensure_break_glass_platform_session(v_d1, 'd1-auth-session-C', 3000, 'session_check', true);
    v_ok := (v2->>'reason')='not_break_glass';
    r := r || jsonb_build_array(jsonb_build_object('t','13_classification_removal','ok',v_ok));

    UPDATE public.platform_break_glass_identities SET active=true, deactivated_at=null WHERE user_id=v_d1;
    -- ensure still only one active
    UPDATE public.platform_break_glass_identities SET active=false WHERE active AND user_id<>v_d1 AND user_id<>v_bg1;
    v1 := public.ensure_break_glass_platform_session(v_d1, 'd1-auth-session-D', 4000, 'session_check', true);
    -- G7F-1B-A refuses DELETE of SO while BG is active. App authority-loss path ends
    -- the server session with role_removed; prove that lock + deny reopen.
    v2 := public.end_break_glass_platform_session(v_d1, 'role_removed');
    v_ok := (v2->>'ended')::boolean
      AND public.is_break_glass_platform_session_active(v_d1)=false
      AND (SELECT end_reason FROM public.platform_break_glass_sessions
           WHERE user_id=v_d1 AND auth_session_id='d1-auth-session-D'
           ORDER BY ended_at DESC NULLS LAST LIMIT 1)='role_removed';
    v2 := public.ensure_break_glass_platform_session(v_d1, 'd1-auth-session-D', 4000, 'session_check', true);
    v_ok := v_ok AND (v2->>'reason')='same_auth_session_locked';
    r := r || jsonb_build_array(jsonb_build_object('t','14_role_removal','ok',v_ok));
    UPDATE public.platform_break_glass_identities SET active=true WHERE user_id=v_d1;

    v1 := public.ensure_break_glass_platform_session(v_d1, 'd1-auth-session-E', 5000, 'session_check', true);
    v_ok := public.is_break_glass_platform_session_active(v_d1)=true;
    PERFORM public.end_break_glass_platform_session(v_d1, 'logout');
    v_ok := v_ok AND public.is_break_glass_platform_session_active(v_d1)=false;
    r := r || jsonb_build_array(jsonb_build_object('t','15_16_g7d_bind_and_logout','ok',v_ok));

    v1 := public.ensure_break_glass_platform_session(v_d1, 'd1-auth-session-G', 7000, 'session_check', true);
    BEGIN
      INSERT INTO public.platform_break_glass_sessions (
        user_id, auth_session_id, auth_iat_bind, started_at, last_activity_at, absolute_expires_at
      ) VALUES (v_d1, 'x', 1, now(), now(), now()+interval '60 minutes');
      v_ok := false;
    EXCEPTION WHEN unique_violation THEN
      v_ok := true;
    END;
    r := r || jsonb_build_array(jsonb_build_object('t','23_unique_open','ok',v_ok));

    v_ok := NOT has_function_privilege('anon','public.ensure_break_glass_platform_session(uuid,text,bigint,text,boolean)','EXECUTE')
      AND has_function_privilege('service_role','public.ensure_break_glass_platform_session(uuid,text,bigint,text,boolean)','EXECUTE');
    r := r || jsonb_build_array(jsonb_build_object('t','rpc_grants','ok',v_ok));

    v_ok := NOT EXISTS (SELECT 1 FROM public.tenant_memberships WHERE user_id=v_d1);
    r := r || jsonb_build_array(jsonb_build_object('t','20_no_memberships','ok',v_ok));

  EXCEPTION WHEN OTHERS THEN
    r := r || jsonb_build_array(jsonb_build_object('t','EXCEPTION','ok',false,'detail',SQLERRM));
  END;

  -- CLEANUP + restore BG1 classification (never leave disposable as active BG)
  DELETE FROM public.platform_break_glass_sessions WHERE user_id=v_d1;
  DELETE FROM public.platform_break_glass_identities WHERE user_id=v_d1 OR reason ILIKE 'g7f1bd1%';
  DELETE FROM public.security_audit_events WHERE acting_user_id=v_d1 AND metadata->>'source'='break_glass_platform_session';
  DELETE FROM public.platform_roles WHERE user_id=v_d1;
  DELETE FROM auth.users WHERE id=v_d1;
  DELETE FROM g6b_private.staging_credentials WHERE email LIKE 'staging-g7f1bd1-%@example.test';

  UPDATE public.platform_break_glass_identities SET active=false WHERE active AND user_id<>v_bg1;
  UPDATE public.platform_break_glass_identities
  SET active=true, deactivated_at=null
  WHERE user_id=v_bg1;
  IF NOT FOUND THEN
    INSERT INTO public.platform_break_glass_identities (user_id, active, created_by, reason)
    VALUES (v_bg1, true, v_so1, 'g7f1b-c2 staging break-glass identity restored after d1 tests');
  END IF;
  -- Ensure no open server session invented for BG1
  DELETE FROM public.platform_break_glass_sessions WHERE user_id=v_bg1;

  v_ok := public.is_super_owner(v_bg1)
    AND public.is_active_break_glass(v_bg1)
    AND public.count_super_owners()=3
    AND public.count_normal_super_owners()=2
    AND (SELECT count(*) FROM public.platform_break_glass_identities WHERE active)=1
    AND NOT EXISTS (SELECT 1 FROM public.platform_break_glass_sessions WHERE user_id=v_bg1);
  r := r || jsonb_build_array(jsonb_build_object('t','Z_bg1_restored_no_server_session','ok',v_ok));

  INSERT INTO g6b_private.g7f1bd1_test_results(payload) VALUES (r);
END;
$body$;

SELECT payload FROM g6b_private.g7f1bd1_test_results ORDER BY created_at DESC LIMIT 1;
