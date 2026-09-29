-- =============================================================================================
-- G7F-3C3B — post-recovery authentication boundary for tenant authority.
--
-- Defect closed: a validly signed access token issued before execute_platform_mfa_recovery kept
-- tenant operational authority through the user's tenant_memberships rows (PostgREST verifies only
-- the JWT signature; the membership helpers never consulted the G7F-3C3A boundary). A second
-- defect let any authenticated caller obtain another user's tenant authority decision by passing
-- that user's id to the membership RPCs.
--
-- Invariant: the root tenant authority helpers honour the G7F-3C3A boundary for the calling
-- end-user subject and never answer for a different end-user subject. Memberships, roles, tenant
-- types and the G7D ceiling are unchanged; users without a recovery boundary are unaffected.
-- Service-role callers (no end-user subject) keep their existing behaviour; the application
-- rejects superseded contexts in requireSupabaseAuth before reaching them.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 1. Guards
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION public.g7f3c3b_tenant_subject_current(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;
  IF v_uid IS NULL THEN
    RETURN COALESCE(auth.role(), '') <> 'anon';
  END IF;
  IF v_uid IS DISTINCT FROM p_user_id THEN
    RETURN false;
  END IF;
  RETURN public.g7f3c3a_request_context_current(p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.g7f3c3b_tenant_subject_current(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Caller-only context check for RLS policy expressions (evaluated as the invoking role).
CREATE FUNCTION public.g7f3c3b_auth_context_current()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND public.g7f3c3a_request_context_current(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.g7f3c3b_auth_context_current() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.g7f3c3b_auth_context_current() TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. Root tenant authority helpers (bodies unchanged apart from the guard)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_tenant_membership(p_user_id uuid, p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.g7f3c3b_tenant_subject_current(p_user_id)
    AND EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.user_id = p_user_id AND tm.tenant_id = p_tenant_id AND tm.active = true
    );
$function$;

CREATE OR REPLACE FUNCTION public.can_access_tenant_data(p_user_id uuid, p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.g7f3c3b_tenant_subject_current(p_user_id)
    AND (
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
      OR public.has_active_support_data_access(p_user_id, p_tenant_id)
    );
$function$;

CREATE OR REPLACE FUNCTION public.can_administer_tenant(p_user_id uuid, p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.g7f3c3b_tenant_subject_current(p_user_id)
    AND (
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
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.has_active_support_data_access(p_user_id uuid, p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.g7f3c3b_tenant_subject_current(p_user_id)
    AND (
      EXISTS (
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
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.auth_is_tenant_staff(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p_tenant_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND public.g7f3c3b_auth_context_current()
    AND EXISTS (
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
    );
$function$;

CREATE OR REPLACE FUNCTION public.auth_is_tenant_admin(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p_tenant_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND public.g7f3c3b_auth_context_current()
    AND EXISTS (
      SELECT 1
      FROM public.tenant_memberships tm
      WHERE tm.user_id = auth.uid()
        AND tm.tenant_id = p_tenant_id
        AND tm.active = true
        AND tm.role IN (
          'owner'::public.tenant_member_role,
          'supervisor'::public.tenant_member_role,
          'general'::public.tenant_member_role
        )
    );
$function$;

CREATE OR REPLACE FUNCTION public.auth_is_tenant_introducer(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p_tenant_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND public.g7f3c3b_auth_context_current()
    AND EXISTS (
      SELECT 1
      FROM public.tenant_memberships tm
      WHERE tm.user_id = auth.uid()
        AND tm.tenant_id = p_tenant_id
        AND tm.active = true
        AND tm.role = 'introducer'::public.tenant_member_role
    );
$function$;

-- ---------------------------------------------------------------------------------------------
-- 3. Policies that read tenant_memberships directly
-- ---------------------------------------------------------------------------------------------
ALTER POLICY "Users read own memberships" ON public.tenant_memberships
  USING (((user_id = auth.uid()) AND public.g7f3c3b_auth_context_current()) OR public.auth_is_tenant_admin(tenant_id));

ALTER POLICY "Staff view lender policies" ON public.lender_remortgage_policies
  USING (
    (
      (tenant_id IS NULL)
      AND public.g7f3c3b_auth_context_current()
      AND (EXISTS (
        SELECT 1
        FROM public.tenant_memberships tm
        WHERE tm.user_id = auth.uid()
          AND tm.active = true
          AND tm.role = ANY (ARRAY[
            'owner'::public.tenant_member_role,
            'supervisor'::public.tenant_member_role,
            'general'::public.tenant_member_role,
            'adviser'::public.tenant_member_role
          ])
      ))
    )
    OR public.auth_is_tenant_staff(tenant_id)
  );
