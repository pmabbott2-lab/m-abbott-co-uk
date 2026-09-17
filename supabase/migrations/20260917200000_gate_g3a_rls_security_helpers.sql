-- Gate G3A: RLS security helpers for tenant isolation.
-- Additive. Does not replace business-table policies yet.
-- Does NOT assign Super Owner / enable MFA / touch Twilio.

-- Convenience wrappers using auth.uid() — for policy expressions only.
CREATE OR REPLACE FUNCTION public.auth_can_access_tenant(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_tenant_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND public.can_access_tenant_data(auth.uid(), p_tenant_id);
$$;

CREATE OR REPLACE FUNCTION public.auth_can_administer_tenant(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_tenant_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND public.can_administer_tenant(auth.uid(), p_tenant_id);
$$;

-- Staff within a tenant: app advisor/admin role + membership, or non-customer membership roles.
CREATE OR REPLACE FUNCTION public.auth_is_tenant_staff(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_tenant_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND public.has_tenant_membership(auth.uid(), p_tenant_id)
    AND (
      public.has_role(auth.uid(), 'advisor'::public.app_role)
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR EXISTS (
        SELECT 1
        FROM public.tenant_memberships tm
        WHERE tm.user_id = auth.uid()
          AND tm.tenant_id = p_tenant_id
          AND tm.active = true
          AND tm.role IN (
            'owner'::public.tenant_member_role,
            'supervisor'::public.tenant_member_role,
            'general'::public.tenant_member_role,
            'adviser'::public.tenant_member_role
          )
      )
    );
$$;

-- Admin-capable within tenant: Owner/Supervisor admin-plane OR legacy admin role + membership.
-- General Admin keeps legacy has_role('admin') path without becoming Owner.
CREATE OR REPLACE FUNCTION public.auth_is_tenant_admin(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_tenant_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND (
      public.can_administer_tenant(auth.uid(), p_tenant_id)
      OR (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        AND public.has_tenant_membership(auth.uid(), p_tenant_id)
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.auth_is_tenant_introducer(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_tenant_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND public.has_tenant_membership(auth.uid(), p_tenant_id)
    AND (
      public.has_role(auth.uid(), 'introducer'::public.app_role)
      OR EXISTS (
        SELECT 1 FROM public.tenant_memberships tm
        WHERE tm.user_id = auth.uid()
          AND tm.tenant_id = p_tenant_id
          AND tm.active = true
          AND tm.role = 'introducer'::public.tenant_member_role
      )
    );
$$;

-- Harden grant-level helpers with fixed search_path (preserve G1A semantics).
CREATE OR REPLACE FUNCTION public.super_admin_grant_allows_admin(
  p_access_level public.super_admin_access_level
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Any non-null grant level may administer (matches G1A).
  SELECT p_access_level IS NOT NULL;
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

REVOKE ALL ON FUNCTION public.auth_can_access_tenant(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.auth_can_administer_tenant(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.auth_is_tenant_staff(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.auth_is_tenant_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.auth_is_tenant_introducer(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.super_admin_grant_allows_admin(public.super_admin_access_level) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.super_admin_grant_allows_data(public.super_admin_access_level) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.auth_can_access_tenant(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_can_administer_tenant(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_is_tenant_staff(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_is_tenant_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_is_tenant_introducer(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.super_admin_grant_allows_admin(public.super_admin_access_level) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.super_admin_grant_allows_data(public.super_admin_access_level) TO authenticated, service_role;

COMMENT ON FUNCTION public.auth_can_access_tenant(uuid) IS
  'G3 RLS helper: can_access_tenant_data(auth.uid(), tenant_id). Fail closed if tenant_id or uid null.';
COMMENT ON FUNCTION public.auth_is_tenant_admin(uuid) IS
  'G3 RLS helper: Owner/Supervisor admin-plane OR legacy admin role with membership (General Admin).';
