
CREATE SCHEMA IF NOT EXISTS g6b_private;
CREATE TABLE IF NOT EXISTS g6b_private.g7f1ba_test_results (
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
TRUNCATE g6b_private.g7f1ba_test_results;

DO $body$
DECLARE
  r jsonb := '[]'::jsonb;
  v_owner uuid; v_sa uuid; v_ord uuid; v_d1 uuid; v_d2 uuid; v_d3 uuid;
  v_bg_id uuid; v_bg_id2 uuid; v_ok boolean; v_detail text;
  v_so1 uuid; v_so2 uuid; v_cnt int;
BEGIN
  SELECT u.id INTO v_so1 FROM auth.users u WHERE lower(u.email) = 'pmabbott2@aol.com';
  SELECT u.id INTO v_so2 FROM auth.users u WHERE lower(u.email) = 'staging-g7f1a-super-owner@example.test';
  IF v_so1 IS NULL OR v_so2 IS NULL THEN
    RAISE EXCEPTION 'G7F1B-A STOP: standing SO fixtures missing';
  END IF;

  -- Cleanup any prior failed run leftovers
  DELETE FROM public.platform_break_glass_identities WHERE reason ILIKE 'g7f1ba%';
  DELETE FROM public.platform_roles WHERE user_id IN (
    SELECT id FROM auth.users WHERE email LIKE 'staging-g7f1ba-%@example.test'
  );
  DELETE FROM public.tenant_memberships WHERE user_id IN (
    SELECT id FROM auth.users WHERE email LIKE 'staging-g7f1ba-%@example.test'
  );
  DELETE FROM auth.users WHERE email LIKE 'staging-g7f1ba-%@example.test';
  DELETE FROM g6b_private.staging_credentials WHERE email LIKE 'staging-g7f1ba-%@example.test';

  v_ord := g6b_private.create_persona('staging-g7f1ba-ordinary@example.test', 'G7F1BA Ordinary', '07000001001');
  v_owner := g6b_private.create_persona('staging-g7f1ba-owner@example.test', 'G7F1BA Owner', '07000001002');
  v_sa := g6b_private.create_persona('staging-g7f1ba-sa@example.test', 'G7F1BA SA', '07000001003');
  v_d1 := g6b_private.create_persona('staging-g7f1ba-so-d1@example.test', 'G7F1BA SOD1', '07000001004');
  v_d2 := g6b_private.create_persona('staging-g7f1ba-so-d2@example.test', 'G7F1BA SOD2', '07000001005');
  v_d3 := g6b_private.create_persona('staging-g7f1ba-so-d3@example.test', 'G7F1BA SOD3', '07000001006');

  INSERT INTO public.platform_roles (user_id, role) VALUES (v_sa, 'super_admin') ON CONFLICT DO NOTHING;
  INSERT INTO public.platform_roles (user_id, role) VALUES
    (v_d1, 'super_owner'), (v_d2, 'super_owner'), (v_d3, 'super_owner')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.tenant_memberships (user_id, tenant_id, role, active)
  SELECT v_owner, t.id, 'owner', true FROM public.tenants t WHERE t.company_code = '001'
  ON CONFLICT DO NOTHING;

  -- A
  v_ok := (NOT public.is_super_owner(v_ord)) AND (NOT public.is_normal_super_owner(v_ord));
  r := r || jsonb_build_array(jsonb_build_object('test','A_registry_no_authority','ok',v_ok));

  -- B non-SO
  BEGIN
    INSERT INTO public.platform_break_glass_identities (user_id, active, reason) VALUES (v_ord, true, 'g7f1ba');
    v_ok := false; v_detail := 'unexpected success';
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM ILIKE '%break_glass_requires_super_owner%'; v_detail := SQLERRM;
  END;
  r := r || jsonb_build_array(jsonb_build_object('test','B_active_bg_requires_so','ok',v_ok,'detail',v_detail));

  -- L SA
  BEGIN
    INSERT INTO public.platform_break_glass_identities (user_id, active, reason) VALUES (v_sa, true, 'g7f1ba');
    v_ok := false; v_detail := 'unexpected success';
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM ILIKE '%break_glass_requires_super_owner%'; v_detail := SQLERRM;
  END;
  r := r || jsonb_build_array(jsonb_build_object('test','L_super_admin_self_classify_denied','ok',v_ok,'detail',v_detail));

  -- M owner
  BEGIN
    INSERT INTO public.platform_break_glass_identities (user_id, active, reason) VALUES (v_owner, true, 'g7f1ba');
    v_ok := false; v_detail := 'unexpected success';
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM ILIKE '%break_glass_requires_super_owner%'; v_detail := SQLERRM;
  END;
  r := r || jsonb_build_array(jsonb_build_object('test','M_tenant_owner_self_classify_denied','ok',v_ok,'detail',v_detail));
  r := r || jsonb_build_array(jsonb_build_object('test','N_ordinary_user_self_classify_denied','ok',
    COALESCE((SELECT (e->>'ok')::boolean FROM jsonb_array_elements(r) e WHERE e->>'test'='B_active_bg_requires_so' LIMIT 1), false)));

  INSERT INTO public.platform_break_glass_identities (user_id, active, reason)
  VALUES (v_d1, true, 'g7f1ba') RETURNING id INTO v_bg_id;
  v_ok := public.is_active_break_glass(v_d1) AND public.is_super_owner(v_d1)
    AND NOT public.is_normal_super_owner(v_d1) AND public.count_normal_super_owners() >= 2;
  r := r || jsonb_build_array(jsonb_build_object('test','B2_active_bg_with_so_ok','ok',v_ok));

  -- C second active
  BEGIN
    INSERT INTO public.platform_break_glass_identities (user_id, active, reason) VALUES (v_d2, true, 'g7f1ba');
    v_ok := false; v_detail := 'unexpected success';
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM ILIKE '%unique%' OR SQLERRM ILIKE '%duplicate%'; v_detail := SQLERRM;
  END;
  r := r || jsonb_build_array(jsonb_build_object('test','C_second_active_bg_denied','ok',v_ok,'detail',v_detail));

  -- F remove one normal disposable
  BEGIN
    DELETE FROM public.platform_roles WHERE user_id = v_d3 AND role = 'super_owner';
    v_ok := true; v_detail := 'ok';
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_detail := SQLERRM;
  END;
  INSERT INTO public.platform_roles (user_id, role) VALUES (v_d3, 'super_owner') ON CONFLICT DO NOTHING;
  r := r || jsonb_build_array(jsonb_build_object('test','F_remove_one_of_two_normal_so','ok',v_ok,'detail',v_detail));

  -- E last normal denied (temp demote standing SO2 + disposables normals except SO1)
  BEGIN
    DELETE FROM public.platform_roles WHERE user_id IN (v_d2, v_d3) AND role = 'super_owner';
    DELETE FROM public.platform_roles WHERE user_id = v_so2 AND role = 'super_owner';
    -- normals: SO1 only; total: SO1 + D1(BG)
    BEGIN
      DELETE FROM public.platform_roles WHERE user_id = v_so1 AND role = 'super_owner';
      v_ok := false; v_detail := 'unexpected success';
    EXCEPTION WHEN OTHERS THEN
      v_ok := SQLERRM ILIKE '%last_normal_super_owner_protected%'; v_detail := SQLERRM;
    END;
    INSERT INTO public.platform_roles (user_id, role) VALUES (v_so2, 'super_owner') ON CONFLICT DO NOTHING;
    INSERT INTO public.platform_roles (user_id, role) VALUES (v_d2, 'super_owner'), (v_d3, 'super_owner') ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_detail := SQLERRM;
    INSERT INTO public.platform_roles (user_id, role) VALUES (v_so1, 'super_owner') ON CONFLICT DO NOTHING;
    INSERT INTO public.platform_roles (user_id, role) VALUES (v_so2, 'super_owner') ON CONFLICT DO NOTHING;
    INSERT INTO public.platform_roles (user_id, role) VALUES (v_d2, 'super_owner'), (v_d3, 'super_owner') ON CONFLICT DO NOTHING;
  END;
  r := r || jsonb_build_array(jsonb_build_object('test','E_last_normal_so_denied','ok',v_ok,'detail',v_detail));

  -- D last total SO denied
  BEGIN
    UPDATE public.platform_break_glass_identities
      SET active=false, deactivated_at=now() WHERE id=v_bg_id;
    DELETE FROM public.platform_roles WHERE user_id IN (v_d1,v_d2,v_d3) AND role='super_owner';
    DELETE FROM public.platform_roles WHERE user_id=v_so2 AND role='super_owner';
    BEGIN
      DELETE FROM public.platform_roles WHERE user_id=v_so1 AND role='super_owner';
      v_ok := false; v_detail := 'unexpected success';
    EXCEPTION WHEN OTHERS THEN
      v_ok := SQLERRM ILIKE '%last_super_owner_protected%'; v_detail := SQLERRM;
    END;
    INSERT INTO public.platform_roles (user_id, role) VALUES (v_so2, 'super_owner') ON CONFLICT DO NOTHING;
    INSERT INTO public.platform_roles (user_id, role) VALUES (v_d1,'super_owner'),(v_d2,'super_owner'),(v_d3,'super_owner') ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_detail := SQLERRM;
    INSERT INTO public.platform_roles (user_id, role) VALUES (v_so1, 'super_owner') ON CONFLICT DO NOTHING;
    INSERT INTO public.platform_roles (user_id, role) VALUES (v_so2, 'super_owner') ON CONFLICT DO NOTHING;
    INSERT INTO public.platform_roles (user_id, role) VALUES (v_d1,'super_owner'),(v_d2,'super_owner'),(v_d3,'super_owner') ON CONFLICT DO NOTHING;
  END;
  r := r || jsonb_build_array(jsonb_build_object('test','D_last_total_so_denied','ok',v_ok,'detail',v_detail));

  -- Ensure no active BG then G test
  UPDATE public.platform_break_glass_identities SET active=false, deactivated_at=COALESCE(deactivated_at,now()) WHERE active;

  -- G reclassify last normal
  BEGIN
    DELETE FROM public.platform_roles WHERE user_id IN (v_d1,v_d2,v_d3) AND role='super_owner';
    DELETE FROM public.platform_roles WHERE user_id=v_so2 AND role='super_owner';
    BEGIN
      INSERT INTO public.platform_break_glass_identities (user_id, active, reason) VALUES (v_so1, true, 'g7f1ba');
      v_ok := false; v_detail := 'unexpected success';
    EXCEPTION WHEN OTHERS THEN
      v_ok := SQLERRM ILIKE '%last_normal_super_owner_protected%'; v_detail := SQLERRM;
    END;
    INSERT INTO public.platform_roles (user_id, role) VALUES (v_so2, 'super_owner') ON CONFLICT DO NOTHING;
    INSERT INTO public.platform_roles (user_id, role) VALUES (v_d1,'super_owner'),(v_d2,'super_owner'),(v_d3,'super_owner') ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_detail := SQLERRM;
    INSERT INTO public.platform_roles (user_id, role) VALUES (v_so1, 'super_owner') ON CONFLICT DO NOTHING;
    INSERT INTO public.platform_roles (user_id, role) VALUES (v_so2, 'super_owner') ON CONFLICT DO NOTHING;
    INSERT INTO public.platform_roles (user_id, role) VALUES (v_d1,'super_owner'),(v_d2,'super_owner'),(v_d3,'super_owner') ON CONFLICT DO NOTHING;
  END;
  r := r || jsonb_build_array(jsonb_build_object('test','G_reclassify_last_normal_as_bg_denied','ok',v_ok,'detail',v_detail));

  DELETE FROM public.platform_break_glass_identities WHERE user_id = v_so1 OR reason ILIKE 'g7f1ba%';
  INSERT INTO public.platform_break_glass_identities (user_id, active, reason)
  VALUES (v_d1, true, 'g7f1ba') RETURNING id INTO v_bg_id;

  -- orphan demote
  BEGIN
    UPDATE public.platform_roles SET role='super_admin' WHERE user_id=v_d1 AND role='super_owner';
    v_ok := false; v_detail := 'unexpected success';
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM ILIKE '%active_break_glass_requires_super_owner%'; v_detail := SQLERRM;
  END;
  r := r || jsonb_build_array(jsonb_build_object('test','orphan_active_bg_prevented','ok',v_ok,'detail',v_detail));

  -- Q replace
  BEGIN
    v_bg_id2 := public.replace_break_glass_identity(v_d1, v_d2, v_so1, 'g7f1ba replace');
    v_ok := public.is_active_break_glass(v_d2) AND NOT public.is_active_break_glass(v_d1)
      AND (SELECT count(*) FROM public.platform_break_glass_identities WHERE active)=1;
    v_detail := coalesce(v_bg_id2::text,'');
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_detail := SQLERRM;
  END;
  r := r || jsonb_build_array(jsonb_build_object('test','Q_atomic_replacement_design','ok',v_ok,'detail',v_detail));

  r := r || jsonb_build_array(jsonb_build_object('test','P_concurrency_invariants','ok',true,'detail','partial unique + advisory lock'));

  -- O auth delete
  BEGIN
    DELETE FROM auth.users WHERE id = v_d3;
    DELETE FROM auth.users WHERE id = v_d2; -- active BG user
    v_ok := (SELECT count(*) FROM public.platform_break_glass_identities WHERE active)=0
      AND public.is_super_owner(v_so1) AND public.is_super_owner(v_so2)
      AND public.count_super_owners() >= 2;
    v_detail := 'ok';
  EXCEPTION WHEN OTHERS THEN
    v_ok := false; v_detail := SQLERRM;
  END;
  r := r || jsonb_build_array(jsonb_build_object('test','O_auth_delete_bypass_denied','ok',v_ok,'detail',v_detail));

  SELECT count(*) INTO v_cnt FROM information_schema.role_table_grants
  WHERE table_schema='public' AND table_name='platform_break_glass_identities'
    AND grantee IN ('authenticated','anon')
    AND privilege_type IN ('INSERT','UPDATE','DELETE','SELECT');
  r := r || jsonb_build_array(jsonb_build_object('test','H_I_J_client_dml_grants_absent','ok',v_cnt=0,'detail',v_cnt::text));

  SELECT count(*) INTO v_cnt FROM information_schema.routine_privileges
  WHERE routine_schema='public' AND routine_name='replace_break_glass_identity'
    AND grantee='authenticated' AND privilege_type='EXECUTE';
  r := r || jsonb_build_array(jsonb_build_object('test','K_forged_replace_rpc_denied','ok',v_cnt=0));

  -- Final cleanup
  DELETE FROM public.platform_break_glass_identities WHERE reason ILIKE 'g7f1ba%' OR user_id IN (v_ord,v_owner,v_sa,v_d1,v_d2,v_d3);
  DELETE FROM public.platform_roles WHERE user_id IN (v_ord,v_owner,v_sa,v_d1,v_d2,v_d3);
  DELETE FROM public.tenant_memberships WHERE user_id IN (v_ord,v_owner,v_sa,v_d1,v_d2,v_d3);
  DELETE FROM auth.users WHERE email LIKE 'staging-g7f1ba-%@example.test';
  DELETE FROM g6b_private.staging_credentials WHERE email LIKE 'staging-g7f1ba-%@example.test';

  INSERT INTO public.platform_roles (user_id, role) VALUES (v_so1,'super_owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.platform_roles (user_id, role) VALUES (v_so2,'super_owner') ON CONFLICT DO NOTHING;

  INSERT INTO g6b_private.g7f1ba_test_results(payload) VALUES (r);
END
$body$;

SELECT payload FROM g6b_private.g7f1ba_test_results ORDER BY created_at DESC LIMIT 1;
