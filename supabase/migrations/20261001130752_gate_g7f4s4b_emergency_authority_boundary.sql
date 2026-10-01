-- Gate G7F-4S4B: emergency authority boundary hardening.
--
-- * public.user_roles is a legacy, global table; tenant authority lives in tenant_memberships.
--   Signed-in and anonymous clients lose every direct write path to it and may read only their
--   own rows. Service-role server code and SECURITY DEFINER functions (handle_new_user,
--   accept_staff_invite) are unaffected.
-- * Platform/global communication templates (tenant_id IS NULL) are no longer writable through
--   the client API by any tenant role or legacy role. Tenant admins keep managing their own
--   tenant's templates and staff keep reading the global fallbacks.
--
-- Re-runnable. Do NOT apply to production without the matching application deploy.

-- ---------------------------------------------------------------------------
-- 1) user_roles: no client writes, own-row reads only.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_roles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_roles', p.policyname);
  END LOOP;
END $$;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.user_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO service_role;

-- ---------------------------------------------------------------------------
-- 2) communication_templates: client writes limited to the caller's own tenant rows.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins manage communication templates" ON public.communication_templates;
CREATE POLICY "Admins manage communication templates" ON public.communication_templates
  FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND public.auth_is_tenant_admin(tenant_id))
  WITH CHECK (tenant_id IS NOT NULL AND public.auth_is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Staff read communication templates" ON public.communication_templates;
CREATE POLICY "Staff read communication templates" ON public.communication_templates
  FOR SELECT TO authenticated
  USING (
    tenant_id IS NULL
    OR public.auth_is_tenant_staff(tenant_id)
  );
