-- P2: tenant RLS helpers derive authority from tenant_memberships.role only.
-- Local migration for review. Do NOT apply in this gate.
-- Removes the global app_role OR-bypass that granted tenant authority merely
-- because a global admin/advisor/introducer role was true.
--
-- Also replaces residual tenant-owned policies that combined global app_role
-- with membership independently of these helpers (G3C leftover).

CREATE OR REPLACE FUNCTION public.auth_is_tenant_staff(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_tenant_id IS NOT NULL
    AND auth.uid() IS NOT NULL
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
$$;

CREATE OR REPLACE FUNCTION public.auth_is_tenant_admin(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_tenant_id IS NOT NULL
    AND auth.uid() IS NOT NULL
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
    AND EXISTS (
      SELECT 1
      FROM public.tenant_memberships tm
      WHERE tm.user_id = auth.uid()
        AND tm.tenant_id = p_tenant_id
        AND tm.active = true
        AND tm.role = 'introducer'::public.tenant_member_role
    );
$$;

REVOKE ALL ON FUNCTION public.auth_is_tenant_staff(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.auth_is_tenant_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.auth_is_tenant_introducer(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.auth_is_tenant_staff(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_is_tenant_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_is_tenant_introducer(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.auth_is_tenant_staff(uuid) IS
  'P2 RLS helper: active membership in THIS tenant as owner/supervisor/general/adviser. Ignores global app_role.';
COMMENT ON FUNCTION public.auth_is_tenant_admin(uuid) IS
  'P2 RLS helper: active membership in THIS tenant as owner/supervisor/general. Ignores global app_role.';
COMMENT ON FUNCTION public.auth_is_tenant_introducer(uuid) IS
  'P2 RLS helper: active membership in THIS tenant as introducer. Ignores global app_role.';

-- ---------------------------------------------------------------------------
-- Residual tenant-owned policies: staff/admin authority from THIS tenant's
-- membership role. Preserve own-row / customer-session access.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Admins view admin profiles" ON public.admin_profiles;
CREATE POLICY "Admins view admin profiles" ON public.admin_profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.auth_is_tenant_admin(tenant_id)
  );

DROP POLICY IF EXISTS "Admins view permissions" ON public.admin_permissions;
CREATE POLICY "Admins view permissions" ON public.admin_permissions
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.auth_is_tenant_admin(tenant_id)
  );

DROP POLICY IF EXISTS "Advisors view advisor codes" ON public.advisor_profiles;
CREATE POLICY "Advisors view advisor codes" ON public.advisor_profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.auth_is_tenant_staff(tenant_id)
  );

DROP POLICY IF EXISTS "Customer manages own sessions" ON public.interview_sessions;
CREATE POLICY "Customer manages own sessions" ON public.interview_sessions
  FOR ALL TO authenticated
  USING (
    customer_id = auth.uid()
    OR public.auth_is_tenant_staff(tenant_id)
  )
  WITH CHECK (
    customer_id = auth.uid()
    OR public.auth_is_tenant_staff(tenant_id)
  );

DROP POLICY IF EXISTS "Access messages for own sessions" ON public.interview_messages;
CREATE POLICY "Access messages for own sessions" ON public.interview_messages
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.interview_sessions s
      WHERE s.id = session_id
        AND (
          s.customer_id = auth.uid()
          OR public.auth_is_tenant_staff(COALESCE(interview_messages.tenant_id, s.tenant_id))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.interview_sessions s
      WHERE s.id = session_id
        AND (
          s.customer_id = auth.uid()
          OR public.auth_is_tenant_staff(COALESCE(interview_messages.tenant_id, s.tenant_id))
        )
    )
  );

DROP POLICY IF EXISTS "Access answers for own sessions" ON public.interview_answers;
CREATE POLICY "Access answers for own sessions" ON public.interview_answers
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.interview_sessions s
      WHERE s.id = session_id
        AND (
          s.customer_id = auth.uid()
          OR public.auth_is_tenant_staff(COALESCE(interview_answers.tenant_id, s.tenant_id))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.interview_sessions s
      WHERE s.id = session_id
        AND (
          s.customer_id = auth.uid()
          OR public.auth_is_tenant_staff(COALESCE(interview_answers.tenant_id, s.tenant_id))
        )
    )
  );

DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
CREATE POLICY "Users view own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR public.auth_is_tenant_staff(tenant_id)
  );

DROP POLICY IF EXISTS "Staff view lender policies" ON public.lender_remortgage_policies;
CREATE POLICY "Staff view lender policies" ON public.lender_remortgage_policies
  FOR SELECT TO authenticated
  USING (
    (
      tenant_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.tenant_memberships tm
        WHERE tm.user_id = auth.uid()
          AND tm.active = true
          AND tm.role IN (
            'owner'::public.tenant_member_role,
            'supervisor'::public.tenant_member_role,
            'general'::public.tenant_member_role,
            'adviser'::public.tenant_member_role
          )
      )
    )
    OR public.auth_is_tenant_staff(tenant_id)
  );
