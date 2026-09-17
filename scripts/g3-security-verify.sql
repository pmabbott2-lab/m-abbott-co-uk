-- Gate G3 authenticated RLS verification (JWT claim simulation).
-- Privileged runner may SET ROLE authenticated; fixtures are cleaned up.

CREATE TEMP TABLE IF NOT EXISTS g3_test_results (
  test_name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text
);

TRUNCATE g3_test_results;

DO $$
DECLARE
  v_owner uuid := '5eef06a0-5292-44fd-bf01-4c934f8c8725';
  v_customer uuid;
  v_adviser uuid;
  v_introducer uuid;
  v_t001 uuid;
  v_t002 uuid;
  v_unknown uuid := '00000000-0000-4000-8000-000000000099';
  v_cnt int;
  v_num_id uuid;
  v_tmp_id uuid;
  v_ext uuid;
  v_grant uuid;
  v_orig_label text;
BEGIN
  SELECT id INTO v_t001 FROM public.tenants WHERE company_code = '001';
  SELECT id INTO v_t002 FROM public.tenants WHERE company_code = '002';
  SELECT id INTO v_customer FROM auth.users WHERE email = '6@test.co.uk';
  SELECT id INTO v_adviser FROM auth.users WHERE email = '4@test.co.uk';
  SELECT id INTO v_introducer FROM auth.users WHERE email = '1@test.co.uk';
  SELECT id, label INTO v_num_id, v_orig_label FROM public.telephony_numbers WHERE tenant_id = v_t001 LIMIT 1;

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  INSERT INTO g3_test_results VALUES ('owner_can_access_001', public.can_access_tenant_data(v_owner, v_t001), NULL);
  INSERT INTO g3_test_results VALUES ('owner_cannot_access_002', NOT public.can_access_tenant_data(v_owner, v_t002), NULL);
  INSERT INTO g3_test_results VALUES ('owner_can_admin_001', public.can_administer_tenant(v_owner, v_t001), NULL);
  INSERT INTO g3_test_results VALUES ('owner_auth_can_access_001', public.auth_can_access_tenant(v_t001), NULL);
  INSERT INTO g3_test_results VALUES ('owner_auth_denied_002', NOT public.auth_can_access_tenant(v_t002), NULL);

  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';

    SELECT COUNT(*) INTO v_cnt FROM public.telephony_numbers WHERE tenant_id = v_t001;
    INSERT INTO g3_test_results VALUES ('owner_select_001_telephony', v_cnt >= 1, 'cnt=' || v_cnt);

    SELECT COUNT(*) INTO v_cnt FROM public.telephony_numbers WHERE tenant_id = v_t002;
    INSERT INTO g3_test_results VALUES ('owner_select_002_telephony_denied', v_cnt = 0, 'cnt=' || v_cnt);

    SELECT COUNT(*) INTO v_cnt FROM public.tenants WHERE id = v_t001;
    INSERT INTO g3_test_results VALUES ('owner_read_tenant_001', v_cnt = 1, 'cnt=' || v_cnt);

    SELECT COUNT(*) INTO v_cnt FROM public.tenants WHERE id = v_t002;
    INSERT INTO g3_test_results VALUES ('owner_read_tenant_002_denied', v_cnt = 0, 'cnt=' || v_cnt);

    SELECT COUNT(*) INTO v_cnt FROM public.tenant_features
      WHERE tenant_id = v_t001 AND feature_key = 'susan_ai_journey';
    INSERT INTO g3_test_results VALUES ('owner_read_susan_001', v_cnt = 1, 'cnt=' || v_cnt);

    SELECT COUNT(*) INTO v_cnt FROM public.tenant_features
      WHERE tenant_id = v_t002 AND feature_key = 'susan_ai_journey';
    INSERT INTO g3_test_results VALUES ('owner_read_susan_002_denied', v_cnt = 0, 'cnt=' || v_cnt);

    BEGIN
      INSERT INTO public.telephony_numbers (e164, label, kind, is_firm_inbound, active, tenant_id)
      VALUES ('+447700900001', 'g3-test', 'voice', false, false, v_t002);
      INSERT INTO g3_test_results VALUES ('owner_insert_002_telephony_denied', false, 'INSERT unexpectedly allowed');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO g3_test_results VALUES ('owner_insert_002_telephony_denied', true, SQLERRM);
    END;

    BEGIN
      UPDATE public.telephony_numbers SET tenant_id = v_t002 WHERE id = v_num_id;
      IF FOUND THEN
        UPDATE public.telephony_numbers SET tenant_id = v_t001 WHERE id = v_num_id;
        INSERT INTO g3_test_results VALUES ('owner_update_tenant_reassign_denied', false, 'UPDATE unexpectedly applied');
      ELSE
        INSERT INTO g3_test_results VALUES ('owner_update_tenant_reassign_denied', true, '0 rows updated');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO g3_test_results VALUES ('owner_update_tenant_reassign_denied', true, SQLERRM);
    END;

    BEGIN
      INSERT INTO public.platform_roles (user_id, role)
      VALUES (v_owner, 'super_owner');
      INSERT INTO g3_test_results VALUES ('owner_platform_role_insert_denied', false, 'INSERT allowed');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO g3_test_results VALUES ('owner_platform_role_insert_denied', true, SQLERRM);
    END;

    BEGIN
      INSERT INTO public.tenant_memberships (user_id, tenant_id, role, active)
      VALUES (v_owner, v_t002, 'owner', true);
      INSERT INTO g3_test_results VALUES ('owner_membership_002_insert_denied', false, 'INSERT allowed');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO g3_test_results VALUES ('owner_membership_002_insert_denied', true, SQLERRM);
    END;

    BEGIN
      INSERT INTO public.tenant_support_access_grants (
        tenant_id, grantee_user_id, reason, starts_at, expires_at, scope
      ) VALUES (
        v_t002, v_owner, 'g3-test', now(), now() + interval '1 hour', 'full_read'
      );
      INSERT INTO g3_test_results VALUES ('owner_support_grant_insert_denied', false, 'INSERT allowed');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO g3_test_results VALUES ('owner_support_grant_insert_denied', true, SQLERRM);
    END;

    BEGIN
      INSERT INTO public.tenant_emergency_access_grants (
        tenant_id, grantee_user_id, reason, starts_at, expires_at, scope
      ) VALUES (
        v_t001, v_owner, 'g3-test', now(), now() + interval '1 hour', 'full_read'
      );
      INSERT INTO g3_test_results VALUES ('owner_emergency_grant_insert_denied', false, 'INSERT allowed');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO g3_test_results VALUES ('owner_emergency_grant_insert_denied', true, SQLERRM);
    END;

    BEGIN
      INSERT INTO public.super_admin_tenant_access (user_id, tenant_id, access_level)
      VALUES (v_owner, v_t002, 'full');
      INSERT INTO g3_test_results VALUES ('owner_super_admin_grant_insert_denied', false, 'INSERT allowed');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO g3_test_results VALUES ('owner_super_admin_grant_insert_denied', true, SQLERRM);
    END;

    -- Customer identity
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', v_customer::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer::text, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    BEGIN
      UPDATE public.tenant_features
      SET state = 'disabled'
      WHERE tenant_id = v_t001 AND feature_key = 'susan_ai_journey';
      IF FOUND THEN
        UPDATE public.tenant_features SET state = 'enabled'
          WHERE tenant_id = v_t001 AND feature_key = 'susan_ai_journey';
        INSERT INTO g3_test_results VALUES ('customer_feature_update_denied', false, 'UPDATE applied');
      ELSE
        INSERT INTO g3_test_results VALUES ('customer_feature_update_denied', true, '0 rows');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO g3_test_results VALUES ('customer_feature_update_denied', true, SQLERRM);
    END;

    SELECT COUNT(*) INTO v_cnt FROM public.telephony_numbers WHERE tenant_id = v_t001;
    INSERT INTO g3_test_results VALUES ('customer_telephony_001_denied', v_cnt = 0, 'cnt=' || v_cnt);

    SELECT COUNT(*) INTO v_cnt FROM public.finance_settings WHERE tenant_id = v_t001;
    INSERT INTO g3_test_results VALUES ('customer_finance_denied', v_cnt = 0, 'cnt=' || v_cnt);

    -- Adviser
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', v_adviser::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adviser::text, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    SELECT COUNT(*) INTO v_cnt FROM public.telephony_numbers WHERE tenant_id = v_t001;
    INSERT INTO g3_test_results VALUES ('adviser_select_001_telephony', v_cnt >= 1, 'cnt=' || v_cnt);
    SELECT COUNT(*) INTO v_cnt FROM public.telephony_numbers WHERE tenant_id = v_t002;
    INSERT INTO g3_test_results VALUES ('adviser_select_002_telephony_denied', v_cnt = 0, 'cnt=' || v_cnt);
    SELECT COUNT(*) INTO v_cnt FROM public.finance_ledger WHERE tenant_id = v_t001;
    INSERT INTO g3_test_results VALUES ('adviser_finance_ledger_denied', v_cnt = 0, 'cnt=' || v_cnt);

    -- Introducer
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', v_introducer::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_introducer::text, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    SELECT COUNT(*) INTO v_cnt FROM public.finance_settings WHERE tenant_id = v_t001;
    INSERT INTO g3_test_results VALUES ('introducer_finance_denied', v_cnt = 0, 'cnt=' || v_cnt);

    BEGIN
      UPDATE public.telephony_numbers SET label = 'hacked' WHERE id = v_num_id;
      IF FOUND THEN
        UPDATE public.telephony_numbers SET label = v_orig_label WHERE id = v_num_id;
        INSERT INTO g3_test_results VALUES ('introducer_telephony_update_denied', false, 'UPDATE applied');
      ELSE
        INSERT INTO g3_test_results VALUES ('introducer_telephony_update_denied', true, '0 rows');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO g3_test_results VALUES ('introducer_telephony_update_denied', true, SQLERRM);
    END;

    -- Unknown user
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', v_unknown::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_unknown::text, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    SELECT COUNT(*) INTO v_cnt FROM public.telephony_numbers;
    INSERT INTO g3_test_results VALUES ('unknown_telephony_denied', v_cnt = 0, 'cnt=' || v_cnt);
    SELECT COUNT(*) INTO v_cnt FROM public.tenants;
    INSERT INTO g3_test_results VALUES ('unknown_tenants_denied', v_cnt = 0, 'cnt=' || v_cnt);

    EXECUTE 'RESET ROLE';

    -- Temp 002 membership for adviser (postgres path)
    INSERT INTO public.tenant_memberships (user_id, tenant_id, role, active)
    VALUES (v_adviser, v_t002, 'adviser', true)
    RETURNING id INTO v_tmp_id;

    PERFORM set_config('request.jwt.claim.sub', v_adviser::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_adviser::text, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';

    SELECT COUNT(*) INTO v_cnt FROM public.telephony_numbers WHERE tenant_id = v_t002;
    INSERT INTO g3_test_results VALUES ('temp_002_member_sees_no_001_numbers_on_002', v_cnt = 0, 'cnt=' || v_cnt);

    BEGIN
      DELETE FROM public.telephony_numbers WHERE tenant_id = v_t001 AND id = v_num_id;
      IF FOUND THEN
        INSERT INTO g3_test_results VALUES ('temp_002_delete_001_telephony_denied', false, 'DELETE applied');
      ELSE
        INSERT INTO g3_test_results VALUES ('temp_002_delete_001_telephony_denied', true, '0 rows');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO g3_test_results VALUES ('temp_002_delete_001_telephony_denied', true, SQLERRM);
    END;

    EXECUTE 'RESET ROLE';
    DELETE FROM public.tenant_memberships WHERE id = v_tmp_id;

    -- GROUP / EXTERNAL wall fixtures
    INSERT INTO public.tenants (company_code, slug, company_name, status, tenant_type)
    VALUES ('003', 'g3-external-fixture', 'G3 External Fixture', 'active', 'EXTERNAL')
    RETURNING id INTO v_ext;

    INSERT INTO public.platform_roles (user_id, role) VALUES (v_owner, 'super_owner');

    INSERT INTO g3_test_results VALUES (
      'external_super_owner_auto_data_denied',
      NOT public.can_access_tenant_data(v_owner, v_ext),
      NULL
    );
    INSERT INTO g3_test_results VALUES (
      'group_super_owner_data_allowed_001',
      public.can_access_tenant_data(v_owner, v_t001),
      NULL
    );

    INSERT INTO public.tenant_support_access_grants (
      tenant_id, grantee_user_id, reason, starts_at, expires_at, scope, revoked_at
    ) VALUES (
      v_ext, v_owner, 'g3-fixture', now() - interval '1 minute', now() + interval '1 hour', 'full_read', NULL
    ) RETURNING id INTO v_grant;

    INSERT INTO g3_test_results VALUES (
      'external_support_grant_allows_data',
      public.can_access_tenant_data(v_owner, v_ext),
      NULL
    );

    UPDATE public.tenant_support_access_grants SET revoked_at = now() WHERE id = v_grant;
    INSERT INTO g3_test_results VALUES (
      'external_revoked_support_denied',
      NOT public.can_access_tenant_data(v_owner, v_ext),
      NULL
    );

    DELETE FROM public.tenant_support_access_grants WHERE tenant_id = v_ext;
    DELETE FROM public.tenant_emergency_access_grants WHERE tenant_id = v_ext;
    DELETE FROM public.platform_roles WHERE user_id = v_owner AND role = 'super_owner';
    DELETE FROM public.tenants WHERE id = v_ext;

  EXCEPTION WHEN OTHERS THEN
    BEGIN EXECUTE 'RESET ROLE'; EXCEPTION WHEN OTHERS THEN NULL; END;
    DELETE FROM public.tenant_memberships WHERE user_id = v_adviser AND tenant_id = v_t002;
    DELETE FROM public.tenant_support_access_grants WHERE reason IN ('g3-test', 'g3-fixture');
    DELETE FROM public.tenant_emergency_access_grants WHERE reason IN ('g3-test', 'g3-fixture');
    DELETE FROM public.platform_roles WHERE user_id = v_owner;
    DELETE FROM public.tenants WHERE slug = 'g3-external-fixture';
    RAISE;
  END;

  SELECT COUNT(*) INTO v_cnt FROM public.platform_roles;
  INSERT INTO g3_test_results VALUES ('post_fixture_platform_roles_0', v_cnt = 0, 'cnt=' || v_cnt);

  SELECT COUNT(*) INTO v_cnt FROM public.tenant_memberships tm
    JOIN public.tenants t ON t.id = tm.tenant_id WHERE t.company_code = '002';
  INSERT INTO g3_test_results VALUES ('post_fixture_mem_002_0', v_cnt = 0, 'cnt=' || v_cnt);

  SELECT COUNT(*) INTO v_cnt FROM public.tenants WHERE company_code = '003' OR slug = 'g3-external-fixture';
  INSERT INTO g3_test_results VALUES ('post_fixture_no_003', v_cnt = 0, 'cnt=' || v_cnt);

  SELECT COUNT(*) INTO v_cnt FROM auth.users;
  INSERT INTO g3_test_results VALUES ('auth_users_6', v_cnt = 6, 'cnt=' || v_cnt);

  INSERT INTO g3_test_results VALUES (
    'owner_still_admin_001',
    public.can_administer_tenant(v_owner, v_t001),
    NULL
  );

  -- Ensure susan still correct
  SELECT COUNT(*) INTO v_cnt FROM public.tenant_features
    WHERE tenant_id = v_t001 AND feature_key = 'susan_ai_journey' AND state::text = 'enabled';
  INSERT INTO g3_test_results VALUES ('susan_001_enabled', v_cnt = 1, 'cnt=' || v_cnt);
  SELECT COUNT(*) INTO v_cnt FROM public.tenant_features
    WHERE tenant_id = v_t002 AND feature_key = 'susan_ai_journey' AND state::text = 'disabled';
  INSERT INTO g3_test_results VALUES ('susan_002_disabled', v_cnt = 1, 'cnt=' || v_cnt);
END $$;

SELECT test_name, passed, detail FROM g3_test_results ORDER BY passed ASC, test_name;
SELECT COUNT(*) FILTER (WHERE NOT passed) AS failures,
       COUNT(*) FILTER (WHERE passed) AS passes,
       COUNT(*) AS total
FROM g3_test_results;
