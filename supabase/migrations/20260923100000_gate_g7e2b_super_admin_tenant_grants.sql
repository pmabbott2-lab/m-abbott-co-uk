-- Gate G7E-2B: Super Admin tenant grant soft-revoke/expiry + helper/G7D hardening.
-- Does NOT insert platform_roles, Auth users, memberships, or G7D sessions.

-- ---------------------------------------------------------------------------
-- Schema: soft revoke / expiry / audit columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.super_admin_tenant_access
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.super_admin_tenant_access.expires_at IS
  'G7E-2B: NULL = no expiry. Expired when expires_at IS NOT NULL AND now() >= expires_at.';
COMMENT ON COLUMN public.super_admin_tenant_access.revoked_at IS
  'G7E-2B: soft revoke timestamp. Expired != revoked.';

-- Replace hard unique with active-only unique (revoked history may coexist).
ALTER TABLE public.super_admin_tenant_access
  DROP CONSTRAINT IF EXISTS super_admin_tenant_access_unique;

DROP INDEX IF EXISTS public.super_admin_tenant_access_unique;

CREATE UNIQUE INDEX IF NOT EXISTS super_admin_tenant_access_active_unique
  ON public.super_admin_tenant_access (user_id, tenant_id)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Valid grant predicate (shared by helpers)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.super_admin_tenant_grant_is_valid_now(
  p_user_id uuid,
  p_tenant_id uuid,
  p_access_level public.super_admin_access_level
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin(p_user_id)
    AND EXISTS (
      SELECT 1
      FROM public.super_admin_tenant_access g
      JOIN public.tenants t ON t.id = g.tenant_id
      WHERE g.user_id = p_user_id
        AND g.tenant_id = p_tenant_id
        AND g.access_level = p_access_level
        AND g.revoked_at IS NULL
        AND (g.expires_at IS NULL OR now() < g.expires_at)
        AND t.status = 'active'::public.tenant_status
    );
$$;

COMMENT ON FUNCTION public.super_admin_tenant_grant_is_valid_now(uuid, uuid, public.super_admin_access_level) IS
  'G7E-2B: true if current Super Admin has a non-revoked, non-expired grant at this exact level.';

CREATE OR REPLACE FUNCTION public.super_admin_has_valid_grant(
  p_user_id uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin(p_user_id)
    AND EXISTS (
      SELECT 1
      FROM public.super_admin_tenant_access g
      JOIN public.tenants t ON t.id = g.tenant_id
      WHERE g.user_id = p_user_id
        AND g.tenant_id = p_tenant_id
        AND g.revoked_at IS NULL
        AND (g.expires_at IS NULL OR now() < g.expires_at)
        AND t.status = 'active'::public.tenant_status
        AND public.super_admin_grant_allows_visibility(g.access_level)
    );
$$;

-- ---------------------------------------------------------------------------
-- Helpers: ignore revoked/expired; require current Super Admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_super_admin_tenant_access(
  p_user_id uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin(p_user_id)
    AND EXISTS (
      SELECT 1
      FROM public.super_admin_tenant_access g
      JOIN public.tenants t ON t.id = g.tenant_id
      WHERE g.user_id = p_user_id
        AND g.tenant_id = p_tenant_id
        AND g.revoked_at IS NULL
        AND (g.expires_at IS NULL OR now() < g.expires_at)
        AND t.status = 'active'::public.tenant_status
        AND public.super_admin_grant_allows_visibility(g.access_level)
    );
$$;

CREATE OR REPLACE FUNCTION public.has_super_admin_tenant_admin(
  p_user_id uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin(p_user_id)
    AND EXISTS (
      SELECT 1
      FROM public.super_admin_tenant_access g
      JOIN public.tenants t ON t.id = g.tenant_id
      WHERE g.user_id = p_user_id
        AND g.tenant_id = p_tenant_id
        AND g.revoked_at IS NULL
        AND (g.expires_at IS NULL OR now() < g.expires_at)
        AND t.status = 'active'::public.tenant_status
        AND public.super_admin_grant_allows_admin(g.access_level)
    );
$$;

CREATE OR REPLACE FUNCTION public.has_super_admin_tenant_data(
  p_user_id uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin(p_user_id)
    AND EXISTS (
      SELECT 1
      FROM public.super_admin_tenant_access g
      JOIN public.tenants t ON t.id = g.tenant_id
      WHERE g.user_id = p_user_id
        AND g.tenant_id = p_tenant_id
        AND g.revoked_at IS NULL
        AND (g.expires_at IS NULL OR now() < g.expires_at)
        AND t.status = 'active'::public.tenant_status
        AND public.super_admin_grant_allows_data(g.access_level)
    );
$$;

CREATE OR REPLACE FUNCTION public.can_administer_tenant(
  p_user_id uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (
      public.is_super_owner(p_user_id)
      AND EXISTS (
        SELECT 1
        FROM public.tenants t
        WHERE t.id = p_tenant_id
          AND t.tenant_type = 'GROUP'::public.tenant_type
      )
    )
    OR (
      public.is_super_admin(p_user_id)
      AND EXISTS (
        SELECT 1
        FROM public.super_admin_tenant_access g
        JOIN public.tenants t ON t.id = g.tenant_id
        WHERE g.user_id = p_user_id
          AND g.tenant_id = p_tenant_id
          AND g.revoked_at IS NULL
          AND (g.expires_at IS NULL OR now() < g.expires_at)
          AND t.status = 'active'::public.tenant_status
          AND public.super_admin_grant_allows_admin(g.access_level)
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.tenant_memberships tm
      WHERE tm.user_id = p_user_id
        AND tm.tenant_id = p_tenant_id
        AND tm.active = true
        AND tm.role IN (
          'owner'::public.tenant_member_role,
          'supervisor'::public.tenant_member_role
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_access_tenant_data(
  p_user_id uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_tenant_membership(p_user_id, p_tenant_id)
    OR (
      public.is_super_owner(p_user_id)
      AND EXISTS (
        SELECT 1
        FROM public.tenants t
        WHERE t.id = p_tenant_id
          AND t.tenant_type = 'GROUP'::public.tenant_type
      )
    )
    OR (
      public.is_super_admin(p_user_id)
      AND EXISTS (
        SELECT 1
        FROM public.super_admin_tenant_access g
        JOIN public.tenants t ON t.id = g.tenant_id
        WHERE g.user_id = p_user_id
          AND g.tenant_id = p_tenant_id
          AND g.revoked_at IS NULL
          AND (g.expires_at IS NULL OR now() < g.expires_at)
          AND t.status = 'active'::public.tenant_status
          AND public.super_admin_grant_allows_data(g.access_level)
      )
    )
    OR public.has_active_support_data_access(p_user_id, p_tenant_id);
$$;

-- ---------------------------------------------------------------------------
-- G7D: fix operational_admin revalidation; enforce revoke/expiry
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
        AND EXISTS (
          SELECT 1
          FROM public.super_admin_tenant_access g
          WHERE g.user_id = p_user_id
            AND g.tenant_id = p_tenant_id
            AND g.revoked_at IS NULL
            AND (g.expires_at IS NULL OR now() < g.expires_at)
            AND (
              (
                p_access_level = 'read_only'::public.platform_tenant_access_level
                AND public.super_admin_grant_allows_data(g.access_level)
              )
              OR (
                -- G7E-2B: operational_admin requires WRITE capability only.
                -- platform_admin must NOT keep an ops session alive.
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
  'G7D/G7E-2B: revalidate entry session. SA operational_admin requires data_write/full only.';

-- ---------------------------------------------------------------------------
-- Privileges: defense in depth (RLS alone is insufficient)
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.super_admin_tenant_access FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.super_admin_tenant_access FROM authenticated;
GRANT SELECT ON TABLE public.super_admin_tenant_access TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.super_admin_tenant_access TO service_role;

-- Keep SELECT policy (self or Super Owner). No write policies.
DROP POLICY IF EXISTS "Users read own super admin grants" ON public.super_admin_tenant_access;
CREATE POLICY "Users read own super admin grants" ON public.super_admin_tenant_access
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_owner(auth.uid()));

REVOKE ALL ON FUNCTION public.super_admin_tenant_grant_is_valid_now(uuid, uuid, public.super_admin_access_level) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.super_admin_has_valid_grant(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.super_admin_tenant_grant_is_valid_now(uuid, uuid, public.super_admin_access_level) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.super_admin_has_valid_grant(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Atomic upsert (active change OR expired soft-revoke + insert) — one txn
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

  -- Serialise concurrent upserts for the same (user, tenant).
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_target_user_id::text || ':' || p_tenant_id::text, 0)
  );

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
      UPDATE public.super_admin_tenant_access
      SET
        access_level = p_access_level,
        expires_at = p_expires_at,
        reason = p_reason,
        updated_at = v_now,
        updated_by = p_acting_user_id
      WHERE id = v_existing.id
        AND revoked_at IS NULL;
      v_outcome := 'changed';
      RETURN jsonb_build_object(
        'outcome', v_outcome,
        'old_access', v_old_access::text,
        'old_expiry', v_old_expiry,
        'new_access', p_access_level::text,
        'new_expiry', p_expires_at
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
  );

  RETURN jsonb_build_object(
    'outcome', 'created',
    'old_access', NULL,
    'old_expiry', NULL,
    'new_access', p_access_level::text,
    'new_expiry', p_expires_at
  );
END;
$$;

COMMENT ON FUNCTION public.upsert_super_admin_tenant_grant_atomic(uuid, uuid, uuid, public.super_admin_access_level, timestamptz, text) IS
  'G7E-2B: Super Owner atomic SA grant create/change/expired-replace. service_role only.';

REVOKE ALL ON FUNCTION public.upsert_super_admin_tenant_grant_atomic(uuid, uuid, uuid, public.super_admin_access_level, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_super_admin_tenant_grant_atomic(uuid, uuid, uuid, public.super_admin_access_level, timestamptz, text)
  TO service_role;
