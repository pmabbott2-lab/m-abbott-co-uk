-- Gate G7F-4S4C4-A2: tenant-specific introducer registrations.
-- One Auth identity may hold one introducer registration per tenant (plus at most one tenantless
-- Test Account row). Each registration has its own id, tenant, company code, slug, lifecycle and
-- commission. Slug stays globally unique. user_roles and tenant_memberships are not changed.
--
-- Atomicity: the file is one multi-statement request and runs as a single transaction. Every
-- precondition is checked before any DDL and every postcondition after it; any miss RAISEs and
-- rolls the whole migration back. No row is deleted, deduplicated, reassigned or backfilled.
--
-- Rollback model: forward-only. A reversal must first prove that no user holds more than one
-- introducer registration and that no (user_id, role) has more than one commission row, and
-- RAISE otherwise; only then may it restore UNIQUE (user_id) / UNIQUE (user_id, role) and the
-- G7F-4S3B accept_staff_invite. It must never delete or merge a registration to get there.

-- A. Lock both tables for the duration of the migration.
LOCK TABLE public.introducers, public.commission_rates IN ACCESS EXCLUSIVE MODE;

-- B–E. Preconditions.
DO $$
DECLARE
  v_con record;
BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION 'g7f4s4c4a2_precondition:postgres_version_below_15';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.introducers i GROUP BY i.tenant_id, i.user_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4a2_precondition:introducers_duplicate_tenant_user';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.commission_rates c
    GROUP BY c.tenant_id, c.user_id, c.role HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4a2_precondition:commission_rates_duplicate_tenant_user_role';
  END IF;

  FOR v_con IN
    SELECT * FROM (VALUES
      ('public.introducers'::regclass, 'introducers_user_id_key', 'UNIQUE (user_id)'),
      ('public.commission_rates'::regclass, 'commission_rates_user_id_role_key', 'UNIQUE (user_id, role)')
    ) AS e(rel, name, def)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conrelid = v_con.rel AND c.conname = v_con.name AND c.contype = 'u'
        AND pg_get_constraintdef(c.oid) = v_con.def
    ) THEN
      RAISE EXCEPTION 'g7f4s4c4a2_precondition:old_key_missing_or_changed:%', v_con.name;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_depend d
        ON (d.refclassid = 'pg_constraint'::regclass AND d.refobjid = c.oid)
        OR (d.refclassid = 'pg_class'::regclass AND d.refobjid = c.conindid)
      WHERE c.conrelid = v_con.rel AND c.conname = v_con.name
        AND NOT (d.classid = 'pg_class'::regclass AND d.objid = c.conindid)
    ) OR EXISTS (
      SELECT 1 FROM pg_constraint f, pg_constraint c
      WHERE c.conrelid = v_con.rel AND c.conname = v_con.name
        AND f.contype = 'f' AND f.conindid = c.conindid
    ) THEN
      RAISE EXCEPTION 'g7f4s4c4a2_precondition:old_key_has_dependants:%', v_con.name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conname IN ('introducers_id_tenant_id_key', 'introducers_tenant_id_user_id_key',
                        'commission_rates_tenant_id_user_id_role_key')
  ) OR to_regclass('public.introducers_user_id_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'g7f4s4c4a2_precondition:new_key_name_in_use';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.introducers'::regclass AND c.conname = 'introducers_slug_key'
      AND c.contype = 'u' AND pg_get_constraintdef(c.oid) = 'UNIQUE (slug)'
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4a2_precondition:slug_key_missing';
  END IF;
END
$$;

-- F. Baseline. Business rows are kept verbatim: the whole-row text of every row (every column,
-- in attribute order) keyed by id, compared afterwards as an exact multiset, not as a hash.
CREATE TEMP TABLE g7f4s4c4a2_rows_before AS
SELECT 'introducers'::text AS tbl, t.id, t::text AS row_text FROM public.introducers t
UNION ALL
SELECT 'commission_rates', t.id, t::text FROM public.commission_rates t
UNION ALL
SELECT 'user_roles', t.id, t::text FROM public.user_roles t
UNION ALL
SELECT 'tenant_memberships', t.id, t::text FROM public.tenant_memberships t;

-- Keys on untouched tables, policies and privileges (catalog text, deterministically ordered).
CREATE TEMP TABLE g7f4s4c4a2_baseline AS
SELECT
  (SELECT md5(COALESCE(string_agg(c.conrelid::regclass::text || ':' || c.conname || ':'
                                  || pg_get_constraintdef(c.oid), '|' ORDER BY c.conrelid::regclass::text, c.conname), ''))
     FROM pg_constraint c
     WHERE c.conrelid IN ('public.user_roles'::regclass, 'public.tenant_memberships'::regclass)) AS untouched_keys,
  (SELECT md5(COALESCE(string_agg(concat_ws(':', p.tablename, p.policyname, p.permissive, p.cmd,
                                            p.roles::text, p.qual, p.with_check), '|'
                                  ORDER BY p.tablename, p.policyname), ''))
     FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.tablename IN ('introducers', 'commission_rates')) AS policies,
  (SELECT md5(COALESCE(string_agg(c.relname || ':' || COALESCE(c.relacl::text, '') || ':'
                                  || c.relrowsecurity::text, '|' ORDER BY c.relname), ''))
     FROM pg_class c
     WHERE c.oid IN ('public.introducers'::regclass, 'public.commission_rates'::regclass)) AS table_acl,
  (SELECT md5(COALESCE(string_agg(a.attrelid::regclass::text || '.' || a.attname || ':'
                                  || COALESCE(a.attacl::text, ''), '|' ORDER BY a.attrelid::regclass::text, a.attname), ''))
     FROM pg_attribute a
     WHERE a.attrelid IN ('public.introducers'::regclass, 'public.commission_rates'::regclass)
       AND a.attnum > 0 AND NOT a.attisdropped) AS column_acl;

-- G–I. New introducer keys.
ALTER TABLE public.introducers
  ADD CONSTRAINT introducers_id_tenant_id_key UNIQUE (id, tenant_id);
CREATE INDEX introducers_user_id_idx ON public.introducers (user_id);
ALTER TABLE public.introducers
  ADD CONSTRAINT introducers_tenant_id_user_id_key UNIQUE NULLS NOT DISTINCT (tenant_id, user_id);
-- J.
ALTER TABLE public.introducers DROP CONSTRAINT introducers_user_id_key;

-- K–L. Commission rates are per tenant.
ALTER TABLE public.commission_rates
  ADD CONSTRAINT commission_rates_tenant_id_user_id_role_key
  UNIQUE NULLS NOT DISTINCT (tenant_id, user_id, role);
ALTER TABLE public.commission_rates DROP CONSTRAINT commission_rates_user_id_role_key;

-- M. Staff invitation acceptance: the introducer registration is the (user, invite tenant) row.
CREATE OR REPLACE FUNCTION public.accept_staff_invite(
  p_token_hash text,
  p_user_id uuid,
  p_full_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_advisor_code text DEFAULT NULL,
  p_company_code text DEFAULT NULL,
  p_introducer_slug text DEFAULT NULL
)
RETURNS TABLE (
  accepted_invitation_id uuid,
  accepted_tenant_id uuid,
  accepted_tenant_slug text,
  granted_role public.app_role,
  granted_membership_role public.tenant_member_role
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inv public.staff_invitations%ROWTYPE;
  v_tenant_status text;
  v_tenant_slug text;
  v_auth_email text;
  v_auth_confirmed timestamptz;
  v_auth_app_meta jsonb;
  v_auth_banned timestamptz;
  v_auth_deleted timestamptz;
  v_auth_anonymous boolean;
  v_admin public.admin_profiles%ROWTYPE;
  v_adv public.advisor_profiles%ROWTYPE;
  v_intro public.introducers%ROWTYPE;
  v_level public.admin_level;
  v_existing_rank int;
  v_new_rank int;
  v_company_code text;
  v_company_name text;
  v_company_names int;
  v_profile_name text;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'staff_invite_invalid' USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  PERFORM pg_advisory_xact_lock(872014004, hashtext(p_token_hash));

  SELECT * INTO v_inv
  FROM public.staff_invitations si
  WHERE si.token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_invite_invalid' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF v_inv.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'staff_invite_used' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'staff_invite_expired' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF v_inv.tenant_id IS NULL THEN
    RAISE EXCEPTION 'staff_invite_invalid' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF v_inv.email IS NULL OR btrim(v_inv.email) = '' THEN
    RAISE EXCEPTION 'staff_invite_email_required' USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  IF NOT (
    (v_inv.role = 'advisor'::public.app_role AND v_inv.membership_role = 'adviser'::public.tenant_member_role)
    OR (v_inv.role = 'introducer'::public.app_role AND v_inv.membership_role = 'introducer'::public.tenant_member_role)
    OR (
      v_inv.role = 'admin'::public.app_role
      AND v_inv.membership_role IN (
        'general'::public.tenant_member_role,
        'supervisor'::public.tenant_member_role,
        'owner'::public.tenant_member_role
      )
    )
  ) THEN
    RAISE EXCEPTION 'staff_invite_role_invalid' USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  SELECT t.status::text, t.slug INTO v_tenant_status, v_tenant_slug
  FROM public.tenants t
  WHERE t.id = v_inv.tenant_id
  FOR SHARE;
  IF NOT FOUND OR v_tenant_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'staff_invite_tenant_inactive' USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  -- Canonical identity: auth.users only. profiles.email is user-editable and never consulted.
  SELECT u.email, u.email_confirmed_at, u.raw_app_meta_data, u.banned_until, u.deleted_at,
         COALESCE(u.is_anonymous, false)
  INTO v_auth_email, v_auth_confirmed, v_auth_app_meta, v_auth_banned, v_auth_deleted,
       v_auth_anonymous
  FROM auth.users u
  WHERE u.id = p_user_id;
  IF NOT FOUND OR v_auth_deleted IS NOT NULL OR v_auth_anonymous
     OR (v_auth_banned IS NOT NULL AND v_auth_banned > now()) THEN
    RAISE EXCEPTION 'staff_invite_identity' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF COALESCE(v_auth_app_meta ->> 'mh_identity', '') = 'appointment_customer'
     OR lower(COALESCE(v_auth_email, '')) LIKE '%@customers.mortgagehub.local' THEN
    RAISE EXCEPTION 'staff_invite_identity' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF v_auth_confirmed IS NULL THEN
    RAISE EXCEPTION 'staff_invite_email_unconfirmed' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF v_auth_email IS NULL OR lower(btrim(v_auth_email)) IS DISTINCT FROM lower(btrim(v_inv.email)) THEN
    RAISE EXCEPTION 'staff_invite_email_mismatch' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  v_auth_email := lower(btrim(v_auth_email));

  -- Consume first; any later failure rolls the consumption back with every grant.
  UPDATE public.staff_invitations si
  SET used_at = now(), used_by = p_user_id
  WHERE si.id = v_inv.id AND si.used_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_invite_used' USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  -- Profile: create for new accounts; existing rows only gain missing name/phone. Email untouched.
  INSERT INTO public.profiles AS pr (id, email, full_name, phone)
  VALUES (p_user_id, v_auth_email, NULLIF(btrim(p_full_name), ''), NULLIF(btrim(p_phone), ''))
  ON CONFLICT (id) DO UPDATE
  SET full_name = CASE
        WHEN NULLIF(btrim(pr.full_name), '') IS NULL THEN EXCLUDED.full_name
        ELSE pr.full_name
      END,
      phone = CASE
        WHEN NULLIF(btrim(pr.phone), '') IS NULL THEN EXCLUDED.phone
        ELSE pr.phone
      END;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_user_id, v_inv.role)
  ON CONFLICT (user_id, role) DO NOTHING;

  IF v_inv.membership_role = 'adviser'::public.tenant_member_role THEN
    SELECT * INTO v_adv FROM public.advisor_profiles ap WHERE ap.user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
      IF p_advisor_code IS NULL OR p_advisor_code !~ '^[A-Z0-9]{5}$' THEN
        RAISE EXCEPTION 'staff_invite_retry_identifier' USING ERRCODE = 'unique_violation';
      END IF;
      IF EXISTS (SELECT 1 FROM public.advisor_profiles ap WHERE ap.code = p_advisor_code) THEN
        RAISE EXCEPTION 'staff_invite_retry_identifier' USING ERRCODE = 'unique_violation';
      END IF;
      INSERT INTO public.advisor_profiles (user_id, code, tenant_id)
      VALUES (p_user_id, p_advisor_code, v_inv.tenant_id);
    ELSIF v_adv.tenant_id IS NULL OR v_adv.tenant_id = v_inv.tenant_id THEN
      UPDATE public.advisor_profiles ap SET deleted_at = NULL WHERE ap.user_id = p_user_id;
    END IF;
    -- An advisor profile bound to another tenant is left untouched.

  ELSIF v_inv.membership_role IN (
    'owner'::public.tenant_member_role,
    'supervisor'::public.tenant_member_role,
    'general'::public.tenant_member_role
  ) THEN
    v_level := (v_inv.membership_role::text)::public.admin_level;
    v_new_rank := CASE v_level WHEN 'owner' THEN 3 WHEN 'supervisor' THEN 2 ELSE 1 END;
    SELECT * INTO v_admin FROM public.admin_profiles ap WHERE ap.user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.admin_profiles (user_id, level, tenant_id, granted_by, updated_at)
      VALUES (p_user_id, v_level, v_inv.tenant_id, v_inv.created_by, now());
    ELSIF v_admin.tenant_id IS DISTINCT FROM v_inv.tenant_id THEN
      -- admin_profiles is keyed by user only; never repoint or relevel another tenant's row.
      RAISE EXCEPTION 'staff_invite_admin_profile_conflict'
        USING ERRCODE = 'invalid_authorization_specification';
    ELSE
      v_existing_rank := CASE v_admin.level WHEN 'owner' THEN 3 WHEN 'supervisor' THEN 2 ELSE 1 END;
      IF v_new_rank > v_existing_rank THEN
        UPDATE public.admin_profiles ap
        SET level = v_level, granted_by = v_inv.created_by, updated_at = now()
        WHERE ap.user_id = p_user_id;
      END IF;
    END IF;

  ELSIF v_inv.membership_role = 'introducer'::public.tenant_member_role THEN
    -- The registration is the (user, invite tenant) row; another tenant's registration is never
    -- read, locked or modified here. UNIQUE NULLS NOT DISTINCT (tenant_id, user_id) is the final
    -- boundary behind this lock.
    PERFORM pg_advisory_xact_lock(872014005, hashtext(p_user_id::text || ':' || v_inv.tenant_id::text));
    SELECT * INTO v_intro
    FROM public.introducers i
    WHERE i.user_id = p_user_id AND i.tenant_id = v_inv.tenant_id
    FOR UPDATE;
    IF FOUND THEN
      -- An established introducer's id, company code, company name, slug and referral history
      -- are its business identity: a re-invite may only reactivate it, never re-home it.
      IF v_inv.create_company
         OR v_intro.company_code IS NULL
         OR v_intro.company_code IS DISTINCT FROM v_inv.company_code THEN
        RAISE EXCEPTION 'staff_invite_introducer_company_conflict'
          USING ERRCODE = 'invalid_authorization_specification';
      END IF;
      UPDATE public.introducers i
      SET active = true,
          deleted_at = NULL
      WHERE i.id = v_intro.id;
    ELSE
      IF v_inv.create_company THEN
        v_company_code := p_company_code;
        IF v_company_code IS NULL OR v_company_code !~ '^[0-9]{4}$' THEN
          RAISE EXCEPTION 'staff_invite_retry_identifier' USING ERRCODE = 'unique_violation';
        END IF;
        IF EXISTS (SELECT 1 FROM public.introducers i WHERE i.company_code = v_company_code) THEN
          RAISE EXCEPTION 'staff_invite_retry_identifier' USING ERRCODE = 'unique_violation';
        END IF;
      ELSE
        -- A company is selected within the invite tenant only; a code that maps to more than
        -- one company name there is ambiguous and fails closed.
        v_company_code := v_inv.company_code;
        SELECT min(i.company_name), count(DISTINCT i.company_name)
        INTO v_company_name, v_company_names
        FROM public.introducers i
        WHERE i.company_code = v_company_code AND i.tenant_id = v_inv.tenant_id;
        IF v_company_code IS NULL OR v_company_names IS DISTINCT FROM 1 THEN
          RAISE EXCEPTION 'staff_invite_company_missing'
            USING ERRCODE = 'invalid_authorization_specification';
        END IF;
      END IF;

      IF p_introducer_slug IS NULL OR p_introducer_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
         OR EXISTS (SELECT 1 FROM public.introducers i WHERE i.slug = p_introducer_slug) THEN
        RAISE EXCEPTION 'staff_invite_retry_identifier' USING ERRCODE = 'unique_violation';
      END IF;
      SELECT pr.full_name INTO v_profile_name FROM public.profiles pr WHERE pr.id = p_user_id;
      INSERT INTO public.introducers (
        user_id, company_name, slug, contact_email, active, company_code, tenant_id
      )
      VALUES (
        p_user_id,
        COALESCE(
          v_company_name,
          NULLIF(btrim(v_profile_name), ''),
          NULLIF(split_part(v_auth_email, '@', 1), ''),
          'introducer'
        ),
        p_introducer_slug,
        v_auth_email,
        true,
        v_company_code,
        v_inv.tenant_id
      );
    END IF;
  END IF;

  INSERT INTO public.tenant_memberships AS tm (tenant_id, user_id, role, active, created_by)
  VALUES (v_inv.tenant_id, p_user_id, v_inv.membership_role, true, v_inv.created_by)
  ON CONFLICT (user_id, tenant_id, role) DO UPDATE SET active = true;

  accepted_invitation_id := v_inv.id;
  accepted_tenant_id := v_inv.tenant_id;
  accepted_tenant_slug := v_tenant_slug;
  granted_role := v_inv.role;
  granted_membership_role := v_inv.membership_role;
  RETURN NEXT;
END;
$$;

-- N. Exact G7F-4S3B grants.
REVOKE ALL ON FUNCTION public.accept_staff_invite(text, uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_staff_invite(text, uuid, text, text, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.accept_staff_invite(text, uuid, text, text, text, text, text) IS
  'G7F-4S3B/G7F-4S4C4-A2: atomic staff invitation acceptance bound to the confirmed auth.users email of p_user_id; introducer registrations are per (user, invite tenant). service_role only.';

-- O–U. Postconditions.
DO $$
DECLARE
  v_base record;
  v_now record;
  v_fn record;
  r text;
  col record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE (c.conrelid = 'public.introducers'::regclass AND c.conname = 'introducers_user_id_key')
       OR (c.conrelid = 'public.commission_rates'::regclass AND c.conname = 'commission_rates_user_id_role_key')
  ) OR EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid IN ('public.introducers'::regclass, 'public.commission_rates'::regclass)
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) IN ('UNIQUE (user_id)', 'UNIQUE (user_id, role)')
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4a2_postcondition:old_key_present';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.introducers'::regclass AND c.conname = 'introducers_tenant_id_user_id_key'
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) = 'UNIQUE NULLS NOT DISTINCT (tenant_id, user_id)'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.introducers'::regclass AND c.conname = 'introducers_id_tenant_id_key'
      AND c.contype = 'u' AND pg_get_constraintdef(c.oid) = 'UNIQUE (id, tenant_id)'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.commission_rates'::regclass
      AND c.conname = 'commission_rates_tenant_id_user_id_role_key' AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) = 'UNIQUE NULLS NOT DISTINCT (tenant_id, user_id, role)'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_index x
    WHERE x.indexrelid = 'public.introducers_user_id_idx'::regclass
      AND x.indrelid = 'public.introducers'::regclass AND NOT x.indisunique
      AND pg_get_indexdef(x.indexrelid) LIKE '% USING btree (user_id)'
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4a2_postcondition:new_key_missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid IN ('public.introducers'::regclass, 'public.commission_rates'::regclass)
      AND a.attname = 'tenant_id' AND a.attnotnull
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4a2_postcondition:tenant_id_not_nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.introducers'::regclass AND c.conname = 'introducers_slug_key'
      AND c.contype = 'u' AND pg_get_constraintdef(c.oid) = 'UNIQUE (slug)'
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4a2_postcondition:slug_key_missing';
  END IF;

  SELECT * INTO v_base FROM pg_temp.g7f4s4c4a2_baseline;
  SELECT
    (SELECT md5(COALESCE(string_agg(c.conrelid::regclass::text || ':' || c.conname || ':'
                                    || pg_get_constraintdef(c.oid), '|' ORDER BY c.conrelid::regclass::text, c.conname), ''))
       FROM pg_constraint c
       WHERE c.conrelid IN ('public.user_roles'::regclass, 'public.tenant_memberships'::regclass)) AS untouched_keys,
    (SELECT md5(COALESCE(string_agg(concat_ws(':', p.tablename, p.policyname, p.permissive, p.cmd,
                                              p.roles::text, p.qual, p.with_check), '|'
                                    ORDER BY p.tablename, p.policyname), ''))
       FROM pg_policies p
       WHERE p.schemaname = 'public' AND p.tablename IN ('introducers', 'commission_rates')) AS policies,
    (SELECT md5(COALESCE(string_agg(c.relname || ':' || COALESCE(c.relacl::text, '') || ':'
                                    || c.relrowsecurity::text, '|' ORDER BY c.relname), ''))
       FROM pg_class c
       WHERE c.oid IN ('public.introducers'::regclass, 'public.commission_rates'::regclass)) AS table_acl,
    (SELECT md5(COALESCE(string_agg(a.attrelid::regclass::text || '.' || a.attname || ':'
                                    || COALESCE(a.attacl::text, ''), '|' ORDER BY a.attrelid::regclass::text, a.attname), ''))
       FROM pg_attribute a
       WHERE a.attrelid IN ('public.introducers'::regclass, 'public.commission_rates'::regclass)
         AND a.attnum > 0 AND NOT a.attisdropped) AS column_acl
  INTO v_now;
  IF v_now.untouched_keys IS DISTINCT FROM v_base.untouched_keys THEN
    RAISE EXCEPTION 'g7f4s4c4a2_postcondition:user_roles_or_membership_keys_changed';
  END IF;
  IF v_now.policies IS DISTINCT FROM v_base.policies
     OR v_now.table_acl IS DISTINCT FROM v_base.table_acl
     OR v_now.column_acl IS DISTINCT FROM v_base.column_acl THEN
    RAISE EXCEPTION 'g7f4s4c4a2_postcondition:policies_or_privileges_changed';
  END IF;
  CREATE TEMP TABLE g7f4s4c4a2_rows_after AS
  SELECT 'introducers'::text AS tbl, t.id, t::text AS row_text FROM public.introducers t
  UNION ALL
  SELECT 'commission_rates', t.id, t::text FROM public.commission_rates t
  UNION ALL
  SELECT 'user_roles', t.id, t::text FROM public.user_roles t
  UNION ALL
  SELECT 'tenant_memberships', t.id, t::text FROM public.tenant_memberships t;
  IF EXISTS (
    SELECT 1
    FROM (SELECT tbl, count(*) AS n FROM pg_temp.g7f4s4c4a2_rows_before GROUP BY tbl) b
    FULL JOIN (SELECT tbl, count(*) AS n FROM pg_temp.g7f4s4c4a2_rows_after GROUP BY tbl) a
      ON a.tbl = b.tbl
    WHERE a.n IS DISTINCT FROM b.n
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4a2_postcondition:business_row_count_changed';
  END IF;
  IF EXISTS (
    (SELECT tbl, id, row_text FROM pg_temp.g7f4s4c4a2_rows_before
     EXCEPT ALL
     SELECT tbl, id, row_text FROM pg_temp.g7f4s4c4a2_rows_after)
    UNION ALL
    (SELECT tbl, id, row_text FROM pg_temp.g7f4s4c4a2_rows_after
     EXCEPT ALL
     SELECT tbl, id, row_text FROM pg_temp.g7f4s4c4a2_rows_before)
  ) THEN
    RAISE EXCEPTION 'g7f4s4c4a2_postcondition:business_data_changed';
  END IF;
  DROP TABLE pg_temp.g7f4s4c4a2_rows_after;

  -- A0 self-write boundary.
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT has_table_privilege(r, 'public.introducers', 'SELECT')
       OR has_table_privilege(r, 'public.introducers', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'g7f4s4c4a2_postcondition:a0_table_privileges:%', r;
    END IF;
  END LOOP;
  FOR col IN
    SELECT a.attname::text AS name
    FROM pg_attribute a
    WHERE a.attrelid = 'public.introducers'::regclass AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    IF has_column_privilege('anon', 'public.introducers', col.name, 'INSERT,UPDATE,REFERENCES')
       OR has_column_privilege('authenticated', 'public.introducers', col.name, 'INSERT,REFERENCES')
       OR has_column_privilege('authenticated', 'public.introducers', col.name, 'UPDATE')
          IS DISTINCT FROM (col.name IN ('company_name', 'contact_email')) THEN
      RAISE EXCEPTION 'g7f4s4c4a2_postcondition:a0_column_privileges:%', col.name;
    END IF;
  END LOOP;

  SELECT count(*) AS n, bool_and(p.prosecdef) AS secdef,
         bool_and(p.proconfig = ARRAY['search_path=""']) AS safe_path,
         bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                  AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                  AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                                  WHERE a.grantee = 0)
                  AND has_function_privilege('service_role', p.oid, 'EXECUTE')) AS service_only
  INTO v_fn
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'accept_staff_invite';
  IF v_fn.n IS DISTINCT FROM 1 OR v_fn.secdef IS NOT TRUE OR v_fn.safe_path IS NOT TRUE
     OR v_fn.service_only IS NOT TRUE THEN
    RAISE EXCEPTION 'g7f4s4c4a2_postcondition:accept_staff_invite_privileges';
  END IF;
END
$$;

DROP TABLE pg_temp.g7f4s4c4a2_baseline, pg_temp.g7f4s4c4a2_rows_before;
