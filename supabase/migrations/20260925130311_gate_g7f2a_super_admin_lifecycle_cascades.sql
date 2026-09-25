-- Gate G7F-2A: Super Admin lifecycle hardening — atomic revocation/downgrade cascades.
-- Staging apply only. Does NOT touch Auth, MFA, break-glass, SO GROUP semantics,
-- support/emergency grant tables, or tenant memberships.

-- ---------------------------------------------------------------------------
-- Exact grant_id binding for super_admin_grant G7D revalidation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_tenant_access_basis_valid_now(
  p_user_id uuid,
  p_tenant_id uuid,
  p_basis public.platform_tenant_access_basis,
  p_access_level public.platform_tenant_access_level,
  p_grant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE p_basis
      WHEN 'super_owner_group_access'::public.platform_tenant_access_basis THEN
        public.is_super_owner(p_user_id)
        AND EXISTS (
          SELECT 1 FROM public.tenants t
          WHERE t.id = p_tenant_id
            AND t.status = 'active'::public.tenant_status
            AND t.tenant_type = 'GROUP'::public.tenant_type
        )
        AND p_access_level = 'operational_admin'::public.platform_tenant_access_level

      WHEN 'super_admin_grant'::public.platform_tenant_access_basis THEN
        public.is_super_admin(p_user_id)
        AND EXISTS (
          SELECT 1 FROM public.tenants t
          WHERE t.id = p_tenant_id AND t.status = 'active'::public.tenant_status
        )
        AND p_grant_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.super_admin_tenant_access g
          WHERE g.id = p_grant_id
            AND g.user_id = p_user_id
            AND g.tenant_id = p_tenant_id
            AND g.revoked_at IS NULL
            AND (g.expires_at IS NULL OR now() < g.expires_at)
            AND (
              (
                p_access_level = 'read_only'::public.platform_tenant_access_level
                AND public.super_admin_grant_allows_data(g.access_level)
              )
              OR (
                p_access_level = 'operational_admin'::public.platform_tenant_access_level
                AND public.super_admin_grant_allows_data_write(g.access_level)
              )
            )
        )

      WHEN 'support_grant'::public.platform_tenant_access_basis THEN
        EXISTS (
          SELECT 1 FROM public.tenants t
          WHERE t.id = p_tenant_id AND t.status = 'active'::public.tenant_status
        )
        AND EXISTS (
          SELECT 1
          FROM public.tenant_support_access_grants g
          WHERE g.grantee_user_id = p_user_id
            AND g.tenant_id = p_tenant_id
            AND (p_grant_id IS NULL OR g.id = p_grant_id)
            AND g.revoked_at IS NULL
            AND now() >= g.starts_at
            AND now() < g.expires_at
            AND public.support_scope_allows_data(g.scope)
            AND (
              (
                p_access_level = 'read_only'::public.platform_tenant_access_level
                AND g.scope IN (
                  'read_cases'::public.support_access_scope,
                  'read_comms'::public.support_access_scope,
                  'read_finance'::public.support_access_scope,
                  'full_read'::public.support_access_scope,
                  'write_limited'::public.support_access_scope,
                  'full_write'::public.support_access_scope
                )
              )
              OR (
                p_access_level IN (
                  'operational_admin'::public.platform_tenant_access_level,
                  'emergency'::public.platform_tenant_access_level
                )
                AND g.scope IN (
                  'write_limited'::public.support_access_scope,
                  'full_write'::public.support_access_scope
                )
              )
            )
        )

      WHEN 'emergency_grant'::public.platform_tenant_access_basis THEN
        EXISTS (
          SELECT 1 FROM public.tenants t
          WHERE t.id = p_tenant_id AND t.status = 'active'::public.tenant_status
        )
        AND EXISTS (
          SELECT 1
          FROM public.tenant_emergency_access_grants g
          WHERE g.grantee_user_id = p_user_id
            AND g.tenant_id = p_tenant_id
            AND (p_grant_id IS NULL OR g.id = p_grant_id)
            AND g.revoked_at IS NULL
            AND now() >= g.starts_at
            AND now() < g.expires_at
            AND public.support_scope_allows_data(g.scope)
            AND p_access_level = 'emergency'::public.platform_tenant_access_level
        )

      ELSE false
    END;
$$;

COMMENT ON FUNCTION public.platform_tenant_access_basis_valid_now(uuid, uuid, public.platform_tenant_access_basis, public.platform_tenant_access_level, uuid) IS
  'G7D/G7E-2B/G7F-2A: revalidate entry session. SA basis requires exact grant_id match.';

-- ---------------------------------------------------------------------------
-- Helper: end open SA-basis G7D rows for a grant (or all SA G7D for a user)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.g7f2a_end_sa_g7d_sessions(
  p_platform_user_id uuid,
  p_grant_id uuid DEFAULT NULL,
  p_tenant_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_now timestamptz := now();
BEGIN
  UPDATE public.platform_tenant_access_sessions s
  SET ended_at = v_now
  WHERE s.platform_user_id = p_platform_user_id
    AND s.authority_basis = 'super_admin_grant'::public.platform_tenant_access_basis
    AND s.ended_at IS NULL
    AND s.revoked_at IS NULL
    AND (p_grant_id IS NULL OR s.grant_id = p_grant_id)
    AND (p_tenant_id IS NULL OR s.tenant_id = p_tenant_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.g7f2a_end_sa_g7d_sessions(uuid, uuid, uuid) IS
  'G7F-2A internal: end open super_admin_grant G7D sessions. service_role only.';

REVOKE ALL ON FUNCTION public.g7f2a_end_sa_g7d_sessions(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.g7f2a_end_sa_g7d_sessions(uuid, uuid, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Atomic role removal cascade
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_super_admin_role_cascade(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_grants_revoked integer := 0;
  v_g7d_ended integer := 0;
  v_roles_deleted integer := 0;
  v_had_sa boolean := false;
BEGIN
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_revoke_sa_role_args';
  END IF;
  IF NOT public.is_super_owner(p_actor_user_id) THEN
    RAISE EXCEPTION 'not_super_owner';
  END IF;

  -- Serialise vs grant upsert / concurrent role revoke for this user.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('sa_cascade:' || p_target_user_id::text, 0)
  );

  SELECT EXISTS (
    SELECT 1 FROM public.platform_roles pr
    WHERE pr.user_id = p_target_user_id AND pr.role = 'super_admin'
  ) INTO v_had_sa;

  IF NOT v_had_sa THEN
    RETURN jsonb_build_object(
      'outcome', 'noop',
      'target_user_id', p_target_user_id,
      'grants_revoked_count', 0,
      'g7d_ended_count', 0,
      'roles_deleted_count', 0
    );
  END IF;

  -- Remove role first so concurrent upsert_super_admin_tenant_grant_atomic fails closed.
  DELETE FROM public.platform_roles
  WHERE user_id = p_target_user_id
    AND role = 'super_admin';
  GET DIAGNOSTICS v_roles_deleted = ROW_COUNT;

  UPDATE public.super_admin_tenant_access g
  SET
    revoked_at = v_now,
    revoked_by = p_actor_user_id,
    updated_at = v_now,
    updated_by = p_actor_user_id,
    reason = COALESCE(
      NULLIF(trim(COALESCE(g.reason, '')), ''),
      COALESCE(v_reason, 'revoked_on_super_admin_role_removal')
    )
  WHERE g.user_id = p_target_user_id
    AND g.revoked_at IS NULL;
  GET DIAGNOSTICS v_grants_revoked = ROW_COUNT;

  v_g7d_ended := public.g7f2a_end_sa_g7d_sessions(p_target_user_id, NULL, NULL);

  INSERT INTO public.security_audit_events (
    event_type,
    acting_user_id,
    subject_user_id,
    metadata
  )
  VALUES (
    'PLATFORM_ROLE_REVOKED',
    p_actor_user_id,
    p_target_user_id,
    jsonb_build_object(
      'source', 'revoke_super_admin_role_cascade',
      'action', 'revoke_super_admin_role_cascade',
      'oldRole', 'Super Admin',
      'role', 'super_admin',
      'reason', COALESCE(v_reason, ''),
      'grants_revoked_count', v_grants_revoked,
      'g7d_ended_count', v_g7d_ended,
      'roles_deleted_count', v_roles_deleted
    )
  );

  RETURN jsonb_build_object(
    'outcome', 'revoked',
    'target_user_id', p_target_user_id,
    'grants_revoked_count', v_grants_revoked,
    'g7d_ended_count', v_g7d_ended,
    'roles_deleted_count', v_roles_deleted
  );
END;
$$;

COMMENT ON FUNCTION public.revoke_super_admin_role_cascade(uuid, uuid, text) IS
  'G7F-2A: Super Owner atomic SA role removal + soft-revoke grants + end SA G7D. service_role only.';

REVOKE ALL ON FUNCTION public.revoke_super_admin_role_cascade(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_super_admin_role_cascade(uuid, uuid, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Atomic grant revocation cascade
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_super_admin_tenant_grant_cascade(
  p_actor_user_id uuid,
  p_grant_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_grant public.super_admin_tenant_access%ROWTYPE;
  v_g7d_ended integer := 0;
  v_already_revoked boolean := false;
BEGIN
  IF p_actor_user_id IS NULL OR p_grant_id IS NULL THEN
    RAISE EXCEPTION 'invalid_revoke_sa_grant_args';
  END IF;
  IF NOT public.is_super_owner(p_actor_user_id) THEN
    RAISE EXCEPTION 'not_super_owner';
  END IF;

  SELECT * INTO v_grant
  FROM public.super_admin_tenant_access g
  WHERE g.id = p_grant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'grant_not_found';
  END IF;

  -- Serialise vs upsert for same (user, tenant) and role cascade for user.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('sa_cascade:' || v_grant.user_id::text, 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_grant.user_id::text || ':' || v_grant.tenant_id::text, 0)
  );

  -- Re-read under locks.
  SELECT * INTO v_grant
  FROM public.super_admin_tenant_access g
  WHERE g.id = p_grant_id
  FOR UPDATE;

  IF v_grant.revoked_at IS NOT NULL THEN
    v_already_revoked := true;
    v_g7d_ended := public.g7f2a_end_sa_g7d_sessions(v_grant.user_id, v_grant.id, v_grant.tenant_id);
    RETURN jsonb_build_object(
      'outcome', 'already_revoked',
      'grant_id', v_grant.id,
      'target_user_id', v_grant.user_id,
      'tenant_id', v_grant.tenant_id,
      'prior_access_level', v_grant.access_level::text,
      'g7d_ended_count', v_g7d_ended
    );
  END IF;

  UPDATE public.super_admin_tenant_access
  SET
    revoked_at = v_now,
    revoked_by = p_actor_user_id,
    updated_at = v_now,
    updated_by = p_actor_user_id,
    reason = COALESCE(v_reason, reason, 'revoked')
  WHERE id = v_grant.id
    AND revoked_at IS NULL;

  v_g7d_ended := public.g7f2a_end_sa_g7d_sessions(v_grant.user_id, v_grant.id, v_grant.tenant_id);

  INSERT INTO public.security_audit_events (
    event_type,
    acting_user_id,
    subject_user_id,
    tenant_id,
    metadata
  )
  VALUES (
    'SUPER_ADMIN_GRANT_REVOKED',
    p_actor_user_id,
    v_grant.user_id,
    v_grant.tenant_id,
    jsonb_build_object(
      'source', 'revoke_super_admin_tenant_grant_cascade',
      'action', 'revoke_sa_grant_cascade',
      'grant_id', v_grant.id,
      'prior_access_level', v_grant.access_level::text,
      'oldAccess', v_grant.access_level::text,
      'reason', COALESCE(v_reason, ''),
      'g7d_ended_count', v_g7d_ended
    )
  );

  RETURN jsonb_build_object(
    'outcome', 'revoked',
    'grant_id', v_grant.id,
    'target_user_id', v_grant.user_id,
    'tenant_id', v_grant.tenant_id,
    'prior_access_level', v_grant.access_level::text,
    'g7d_ended_count', v_g7d_ended,
    'already_revoked', v_already_revoked
  );
END;
$$;

COMMENT ON FUNCTION public.revoke_super_admin_tenant_grant_cascade(uuid, uuid, text) IS
  'G7F-2A: Super Owner atomic SA grant soft-revoke + end bound G7D. service_role only.';

REVOKE ALL ON FUNCTION public.revoke_super_admin_tenant_grant_cascade(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_super_admin_tenant_grant_cascade(uuid, uuid, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- Upsert: end G7D on any access_level change; take user cascade lock
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_super_admin_tenant_grant_atomic(
  p_acting_user_id uuid,
  p_target_user_id uuid,
  p_tenant_id uuid,
  p_access_level public.super_admin_access_level,
  p_expires_at timestamptz,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.super_admin_tenant_access%ROWTYPE;
  v_was_active boolean;
  v_old_access public.super_admin_access_level;
  v_old_expiry timestamptz;
  v_outcome text;
  v_now timestamptz := now();
  v_g7d_ended integer := 0;
  v_level_changed boolean := false;
  v_new_id uuid;
BEGIN
  IF p_acting_user_id IS NULL OR p_target_user_id IS NULL OR p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'invalid_upsert_args';
  END IF;
  IF NOT public.is_super_owner(p_acting_user_id) THEN
    RAISE EXCEPTION 'not_super_owner';
  END IF;
  IF NOT public.is_super_admin(p_target_user_id) THEN
    RAISE EXCEPTION 'target_not_super_admin';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tenants t
    WHERE t.id = p_tenant_id AND t.status = 'active'::public.tenant_status
  ) THEN
    RAISE EXCEPTION 'tenant_not_active';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= v_now THEN
    RAISE EXCEPTION 'expiry_not_future';
  END IF;

  -- Serialise vs role-removal cascade and concurrent upserts.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('sa_cascade:' || p_target_user_id::text, 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_target_user_id::text || ':' || p_tenant_id::text, 0)
  );

  -- Re-check role after lock (role cascade may have removed it).
  IF NOT public.is_super_admin(p_target_user_id) THEN
    RAISE EXCEPTION 'target_not_super_admin';
  END IF;

  SELECT * INTO v_existing
  FROM public.super_admin_tenant_access g
  WHERE g.user_id = p_target_user_id
    AND g.tenant_id = p_tenant_id
    AND g.revoked_at IS NULL
  FOR UPDATE;

  IF FOUND THEN
    v_was_active := (v_existing.expires_at IS NULL OR v_now < v_existing.expires_at);
    IF v_was_active THEN
      v_old_access := v_existing.access_level;
      v_old_expiry := v_existing.expires_at;
      v_level_changed := (v_existing.access_level IS DISTINCT FROM p_access_level);

      UPDATE public.super_admin_tenant_access
      SET
        access_level = p_access_level,
        expires_at = p_expires_at,
        reason = p_reason,
        updated_at = v_now,
        updated_by = p_acting_user_id
      WHERE id = v_existing.id
        AND revoked_at IS NULL;

      -- Any actual access_level change ends dependent G7D (upgrade or downgrade).
      IF v_level_changed THEN
        v_g7d_ended := public.g7f2a_end_sa_g7d_sessions(
          p_target_user_id,
          v_existing.id,
          p_tenant_id
        );
      END IF;

      v_outcome := 'changed';
      RETURN jsonb_build_object(
        'outcome', v_outcome,
        'grant_id', v_existing.id,
        'old_access', v_old_access::text,
        'old_expiry', v_old_expiry,
        'new_access', p_access_level::text,
        'new_expiry', p_expires_at,
        'level_changed', v_level_changed,
        'g7d_ended_count', v_g7d_ended
      );
    END IF;

    -- Expired non-revoked: soft-revoke then insert in same transaction.
    UPDATE public.super_admin_tenant_access
    SET
      revoked_at = v_now,
      revoked_by = p_acting_user_id,
      updated_at = v_now,
      updated_by = p_acting_user_id,
      reason = COALESCE(v_existing.reason, 'superseded_after_expiry')
    WHERE id = v_existing.id
      AND revoked_at IS NULL;

    -- End G7D bound to expired grant id (fail-closed hygiene).
    v_g7d_ended := public.g7f2a_end_sa_g7d_sessions(
      p_target_user_id,
      v_existing.id,
      p_tenant_id
    );
  END IF;

  INSERT INTO public.super_admin_tenant_access (
    user_id,
    tenant_id,
    access_level,
    created_by,
    expires_at,
    reason,
    updated_at,
    updated_by
  ) VALUES (
    p_target_user_id,
    p_tenant_id,
    p_access_level,
    p_acting_user_id,
    p_expires_at,
    p_reason,
    v_now,
    p_acting_user_id
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'outcome', 'created',
    'grant_id', v_new_id,
    'old_access', NULL,
    'old_expiry', NULL,
    'new_access', p_access_level::text,
    'new_expiry', p_expires_at,
    'level_changed', false,
    'g7d_ended_count', v_g7d_ended
  );
END;
$$;

COMMENT ON FUNCTION public.upsert_super_admin_tenant_grant_atomic(uuid, uuid, uuid, public.super_admin_access_level, timestamptz, text) IS
  'G7E-2B/G7F-2A: atomic SA grant create/change; ends G7D on access_level change. service_role only.';

REVOKE ALL ON FUNCTION public.upsert_super_admin_tenant_grant_atomic(uuid, uuid, uuid, public.super_admin_access_level, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_super_admin_tenant_grant_atomic(uuid, uuid, uuid, public.super_admin_access_level, timestamptz, text)
  TO service_role;
