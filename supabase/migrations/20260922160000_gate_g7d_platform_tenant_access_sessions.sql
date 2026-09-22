-- Gate G7D: audited platform tenant entry sessions (LOCAL + staging apply only).
-- Does NOT insert platform_roles, memberships, support/emergency grants, or Auth users.
-- Does NOT make Super Owner automatic operational access without an active session.
-- Keeps G7A can_access_tenant_data / can_administer_tenant unchanged for platform admin plane.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.platform_tenant_access_basis AS ENUM (
    'super_owner_group_access',
    'super_admin_grant',
    'support_grant',
    'emergency_grant'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.platform_tenant_access_level AS ENUM (
    'read_only',
    'operational_admin',
    'emergency'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Session table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_tenant_access_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  authority_basis public.platform_tenant_access_basis NOT NULL,
  access_level public.platform_tenant_access_level NOT NULL,
  grant_id uuid,
  reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_tenant_access_sessions_expires_after_start
    CHECK (expires_at > started_at)
);

CREATE INDEX IF NOT EXISTS platform_tenant_access_sessions_user_idx
  ON public.platform_tenant_access_sessions (platform_user_id);

CREATE INDEX IF NOT EXISTS platform_tenant_access_sessions_tenant_idx
  ON public.platform_tenant_access_sessions (tenant_id);

CREATE INDEX IF NOT EXISTS platform_tenant_access_sessions_active_idx
  ON public.platform_tenant_access_sessions (platform_user_id, tenant_id)
  WHERE ended_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS platform_tenant_access_sessions_expires_idx
  ON public.platform_tenant_access_sessions (expires_at)
  WHERE ended_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE public.platform_tenant_access_sessions IS
  'G7D: explicit time-limited platform operational entry into a tenant. Not a membership. Not a tenant role.';

ALTER TABLE public.platform_tenant_access_sessions ENABLE ROW LEVEL SECURITY;

-- Defense-in-depth: clients may SELECT own/SO rows only. Mutations via service_role server paths.
REVOKE ALL ON TABLE public.platform_tenant_access_sessions FROM PUBLIC;
REVOKE ALL ON TABLE public.platform_tenant_access_sessions FROM anon;
REVOKE ALL ON TABLE public.platform_tenant_access_sessions FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_tenant_access_sessions TO service_role;

DROP POLICY IF EXISTS "Users read own platform tenant access sessions"
  ON public.platform_tenant_access_sessions;
CREATE POLICY "Users read own platform tenant access sessions"
  ON public.platform_tenant_access_sessions
  FOR SELECT TO authenticated
  USING (
    platform_user_id = auth.uid()
    OR public.is_super_owner(auth.uid())
  );

GRANT SELECT ON public.platform_tenant_access_sessions TO authenticated;

-- ---------------------------------------------------------------------------
-- Basis still valid NOW (revalidated on every check)
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
            AND (
              (
                p_access_level = 'read_only'::public.platform_tenant_access_level
                AND public.super_admin_grant_allows_data(g.access_level)
              )
              OR (
                p_access_level = 'operational_admin'::public.platform_tenant_access_level
                AND (
                  public.super_admin_grant_allows_data_write(g.access_level)
                  OR public.super_admin_grant_allows_admin(g.access_level)
                )
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
  'G7D: revalidate underlying platform/grant authority for an entry session. Fail closed.';

-- ---------------------------------------------------------------------------
-- Active session for user+tenant (DB source of truth)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_active_platform_tenant_access_session(
  p_user_id uuid,
  p_tenant_id uuid,
  p_require_write boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_tenant_access_sessions s
    JOIN public.tenants t ON t.id = s.tenant_id
    WHERE s.platform_user_id = p_user_id
      AND s.tenant_id = p_tenant_id
      AND s.ended_at IS NULL
      AND s.revoked_at IS NULL
      AND now() < s.expires_at
      AND t.status = 'active'::public.tenant_status
      AND (
        NOT p_require_write
        OR s.access_level IN (
          'operational_admin'::public.platform_tenant_access_level,
          'emergency'::public.platform_tenant_access_level
        )
      )
      AND public.platform_tenant_access_basis_valid_now(
        s.platform_user_id,
        s.tenant_id,
        s.authority_basis,
        s.access_level,
        s.grant_id
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.auth_has_active_platform_tenant_access(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_tenant_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND public.has_active_platform_tenant_access_session(auth.uid(), p_tenant_id, false);
$$;

CREATE OR REPLACE FUNCTION public.auth_has_platform_tenant_read_access(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.auth_has_active_platform_tenant_access(p_tenant_id);
$$;

CREATE OR REPLACE FUNCTION public.auth_has_platform_tenant_write_access(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_tenant_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND public.has_active_platform_tenant_access_session(auth.uid(), p_tenant_id, true);
$$;

REVOKE ALL ON FUNCTION public.platform_tenant_access_basis_valid_now(uuid, uuid, public.platform_tenant_access_basis, public.platform_tenant_access_level, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_active_platform_tenant_access_session(uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.auth_has_active_platform_tenant_access(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.auth_has_platform_tenant_read_access(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.auth_has_platform_tenant_write_access(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.platform_tenant_access_basis_valid_now(uuid, uuid, public.platform_tenant_access_basis, public.platform_tenant_access_level, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_active_platform_tenant_access_session(uuid, uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_has_active_platform_tenant_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_has_platform_tenant_read_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_has_platform_tenant_write_access(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Operational policies: extend membership staff paths with platform session
-- (platform user is NOT redefined as tenant staff)
-- ---------------------------------------------------------------------------

-- appointments
DROP POLICY IF EXISTS "Staff view tenant appointments" ON public.appointments;
CREATE POLICY "Staff view tenant appointments" ON public.appointments
  FOR SELECT TO authenticated
  USING (
    public.auth_is_tenant_staff(tenant_id)
    OR public.auth_has_platform_tenant_read_access(tenant_id)
  );

DROP POLICY IF EXISTS "Staff update tenant appointments" ON public.appointments;
CREATE POLICY "Staff update tenant appointments" ON public.appointments
  FOR UPDATE TO authenticated
  USING (
    public.auth_is_tenant_staff(tenant_id)
    OR public.auth_has_platform_tenant_write_access(tenant_id)
  )
  WITH CHECK (
    public.auth_is_tenant_staff(tenant_id)
    OR public.auth_has_platform_tenant_write_access(tenant_id)
  );

DROP POLICY IF EXISTS "Staff insert tenant appointments" ON public.appointments;
CREATE POLICY "Staff insert tenant appointments" ON public.appointments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_is_tenant_staff(tenant_id)
    OR advisor_id = auth.uid()
    OR public.auth_has_platform_tenant_write_access(tenant_id)
  );

DROP POLICY IF EXISTS "Staff delete tenant appointments" ON public.appointments;
CREATE POLICY "Staff delete tenant appointments" ON public.appointments
  FOR DELETE TO authenticated
  USING (
    public.auth_is_tenant_staff(tenant_id)
    OR public.auth_has_platform_tenant_write_access(tenant_id)
  );

-- interview_sessions (P2 customer + staff)
DROP POLICY IF EXISTS "Customer manages own sessions" ON public.interview_sessions;
CREATE POLICY "Customer manages own sessions" ON public.interview_sessions
  FOR ALL TO authenticated
  USING (
    customer_id = auth.uid()
    OR public.auth_is_tenant_staff(tenant_id)
    OR public.auth_has_platform_tenant_read_access(tenant_id)
  )
  WITH CHECK (
    customer_id = auth.uid()
    OR public.auth_is_tenant_staff(tenant_id)
    OR public.auth_has_platform_tenant_write_access(tenant_id)
  );

-- admin_profiles / advisor_profiles (P2)
DROP POLICY IF EXISTS "Admins view admin profiles" ON public.admin_profiles;
CREATE POLICY "Admins view admin profiles" ON public.admin_profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.auth_is_tenant_admin(tenant_id)
    OR public.auth_has_platform_tenant_read_access(tenant_id)
  );

DROP POLICY IF EXISTS "Advisors view advisor codes" ON public.advisor_profiles;
CREATE POLICY "Advisors view advisor codes" ON public.advisor_profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.auth_is_tenant_staff(tenant_id)
    OR public.auth_has_platform_tenant_read_access(tenant_id)
  );

COMMENT ON FUNCTION public.auth_has_active_platform_tenant_access(uuid) IS
  'G7D RLS: active valid platform_tenant_access_sessions for auth.uid()+tenant. Not membership.';
COMMENT ON FUNCTION public.auth_has_platform_tenant_read_access(uuid) IS
  'G7D RLS: platform entry session may read operational tenant rows.';
COMMENT ON FUNCTION public.auth_has_platform_tenant_write_access(uuid) IS
  'G7D RLS: platform entry session with operational_admin/emergency may write.';
