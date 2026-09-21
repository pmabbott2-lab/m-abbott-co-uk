-- Gate G7A: platform authority hardening (LOCAL ONLY — do not apply in this gate).
-- Does NOT insert platform_roles, assign Super Owner, enable MFA, or change Auth users.
--
-- BEFORE can_administer_tenant Super Owner:
--   is_super_owner(user) → true for EVERY tenant (GROUP and EXTERNAL).
-- AFTER:
--   is_super_owner(user) AND tenants.tenant_type = GROUP only.
-- Super Owner retains platform visibility of EXTERNAL tenants via tenants SELECT
-- (is_super_owner). Operational/data entry into EXTERNAL is not automatic.
--
-- BEFORE super_admin_grant_allows_admin:
--   any non-null access_level → admin.
-- AFTER (enum public.super_admin_access_level):
--   visibility:     platform_admin | data_read | data_write | full
--   administration: platform_admin | full
--   data read:      data_read | data_write | full
--   data write:     data_write | full
--
-- has_super_admin_tenant_access(user, tenant) is visibility only (not "everything").
-- Admin/data continue to use can_administer_tenant / can_access_tenant_data.

-- ---------------------------------------------------------------------------
-- Super Admin grant-level helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.super_admin_grant_allows_visibility(
  p_access_level public.super_admin_access_level
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_access_level IN (
    'platform_admin'::public.super_admin_access_level,
    'data_read'::public.super_admin_access_level,
    'data_write'::public.super_admin_access_level,
    'full'::public.super_admin_access_level
  );
$$;

CREATE OR REPLACE FUNCTION public.super_admin_grant_allows_admin(
  p_access_level public.super_admin_access_level
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_access_level IN (
    'platform_admin'::public.super_admin_access_level,
    'full'::public.super_admin_access_level
  );
$$;

CREATE OR REPLACE FUNCTION public.super_admin_grant_allows_data(
  p_access_level public.super_admin_access_level
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_access_level IN (
    'data_read'::public.super_admin_access_level,
    'data_write'::public.super_admin_access_level,
    'full'::public.super_admin_access_level
  );
$$;

CREATE OR REPLACE FUNCTION public.super_admin_grant_allows_data_write(
  p_access_level public.super_admin_access_level
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_access_level IN (
    'data_write'::public.super_admin_access_level,
    'full'::public.super_admin_access_level
  );
$$;

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
  -- Visibility of one explicitly granted tenant. Not administration. Not data.
  SELECT public.is_super_admin(p_user_id)
    AND EXISTS (
      SELECT 1
      FROM public.super_admin_tenant_access g
      WHERE g.user_id = p_user_id
        AND g.tenant_id = p_tenant_id
        AND public.super_admin_grant_allows_visibility(g.access_level)
    );
$$;

COMMENT ON FUNCTION public.has_super_admin_tenant_access(uuid, uuid) IS
  'G7A: Super Admin visibility of one tenant (any recognised access_level). Not admin or data.';

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
      WHERE g.user_id = p_user_id
        AND g.tenant_id = p_tenant_id
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
      WHERE g.user_id = p_user_id
        AND g.tenant_id = p_tenant_id
        AND public.super_admin_grant_allows_data(g.access_level)
    );
$$;

-- ---------------------------------------------------------------------------
-- Super Owner GROUP-only automatic tenant administration
-- ---------------------------------------------------------------------------
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
        WHERE g.user_id = p_user_id
          AND g.tenant_id = p_tenant_id
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

COMMENT ON FUNCTION public.can_administer_tenant(uuid, uuid) IS
  'G7A: tenant Owner/Supervisor, Super Admin admin-level grant, or Super Owner for GROUP tenants only.';

-- ---------------------------------------------------------------------------
-- Support / emergency scope (coarse data-plane only)
-- Enum evidence:
--   read_metadata = metadata, not business data
--   read_cases / read_comms / read_finance / write_limited / full_read / full_write
--     = data-plane scopes
-- Per-table (cases vs comms vs finance) is NOT enforced here: callers pass no
-- operation. Fine-grained scope remains schema-insufficient without new policies.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.support_scope_allows_data(
  p_scope public.support_access_scope
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_scope IN (
    'read_cases'::public.support_access_scope,
    'read_comms'::public.support_access_scope,
    'read_finance'::public.support_access_scope,
    'write_limited'::public.support_access_scope,
    'full_read'::public.support_access_scope,
    'full_write'::public.support_access_scope
  );
$$;

CREATE OR REPLACE FUNCTION public.has_active_support_data_access(
  p_user_id uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_support_access_grants g
    WHERE g.grantee_user_id = p_user_id
      AND g.tenant_id = p_tenant_id
      AND g.revoked_at IS NULL
      AND now() >= g.starts_at
      AND now() < g.expires_at
      AND public.support_scope_allows_data(g.scope)
  )
  OR EXISTS (
    SELECT 1
    FROM public.tenant_emergency_access_grants g
    WHERE g.grantee_user_id = p_user_id
      AND g.tenant_id = p_tenant_id
      AND g.revoked_at IS NULL
      AND now() >= g.starts_at
      AND now() < g.expires_at
      AND public.support_scope_allows_data(g.scope)
  );
$$;

-- ---------------------------------------------------------------------------
-- Last Super Owner protection
-- Blocks DELETE / role-change of the final super_owner row.
-- auth.users ON DELETE CASCADE fires this DELETE trigger on platform_roles.
-- We cannot attach triggers to auth.users; Auth-user deletion of the last
-- Super Owner is blocked only if this trigger remains enabled (operational guard).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_last_super_owner_loss()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remaining integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'super_owner'::public.platform_role THEN
      SELECT COUNT(*)::integer
        INTO remaining
      FROM public.platform_roles
      WHERE role = 'super_owner'::public.platform_role
        AND id IS DISTINCT FROM OLD.id;
      IF remaining < 1 THEN
        RAISE EXCEPTION 'last_super_owner_protected'
          USING ERRCODE = 'restrict_violation',
            HINT = 'Add another Super Owner before removing the final super_owner platform role.';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.role = 'super_owner'::public.platform_role
       AND NEW.role IS DISTINCT FROM 'super_owner'::public.platform_role THEN
      SELECT COUNT(*)::integer
        INTO remaining
      FROM public.platform_roles
      WHERE role = 'super_owner'::public.platform_role
        AND id IS DISTINCT FROM OLD.id;
      IF remaining < 1 THEN
        RAISE EXCEPTION 'last_super_owner_protected'
          USING ERRCODE = 'restrict_violation',
            HINT = 'Add another Super Owner before changing the final super_owner platform role.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS platform_roles_prevent_last_super_owner ON public.platform_roles;
CREATE TRIGGER platform_roles_prevent_last_super_owner
  BEFORE DELETE OR UPDATE OF role ON public.platform_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_super_owner_loss();

CREATE OR REPLACE FUNCTION public.prevent_platform_roles_truncate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'platform_roles_truncate_forbidden'
    USING ERRCODE = 'restrict_violation',
      HINT = 'Truncating platform_roles would remove Super Owner protection.';
END;
$$;

DROP TRIGGER IF EXISTS platform_roles_prevent_truncate ON public.platform_roles;
CREATE TRIGGER platform_roles_prevent_truncate
  BEFORE TRUNCATE ON public.platform_roles
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.prevent_platform_roles_truncate();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.super_admin_grant_allows_visibility(public.super_admin_access_level) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.super_admin_grant_allows_admin(public.super_admin_access_level) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.super_admin_grant_allows_data(public.super_admin_access_level) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.super_admin_grant_allows_data_write(public.super_admin_access_level) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_super_admin_tenant_access(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_super_admin_tenant_admin(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_super_admin_tenant_data(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_administer_tenant(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.support_scope_allows_data(public.support_access_scope) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_active_support_data_access(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prevent_last_super_owner_loss() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prevent_platform_roles_truncate() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.super_admin_grant_allows_visibility(public.super_admin_access_level) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.super_admin_grant_allows_admin(public.super_admin_access_level) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.super_admin_grant_allows_data(public.super_admin_access_level) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.super_admin_grant_allows_data_write(public.super_admin_access_level) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_super_admin_tenant_access(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_super_admin_tenant_admin(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_super_admin_tenant_data(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_administer_tenant(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.support_scope_allows_data(public.support_access_scope) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_active_support_data_access(uuid, uuid) TO authenticated, service_role;
