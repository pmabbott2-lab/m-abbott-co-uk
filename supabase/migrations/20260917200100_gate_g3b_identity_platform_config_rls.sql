-- Gate G3B: identity / platform / tenant-config RLS policies.
-- Deny-by-default tables that had RLS on but zero policies get explicit policies.
-- Mutations of security tables remain service_role (or Owner admin-plane where noted).

-- ---------------------------------------------------------------------------
-- tenants: members may read tenants they belong to; no client mutations
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members read own tenants" ON public.tenants;
CREATE POLICY "Members read own tenants" ON public.tenants
  FOR SELECT TO authenticated
  USING (
    public.has_tenant_membership(auth.uid(), id)
    OR public.is_super_owner(auth.uid())
    OR public.has_super_admin_tenant_access(auth.uid(), id)
  );

GRANT SELECT ON public.tenants TO authenticated;

-- ---------------------------------------------------------------------------
-- tenant_memberships: read own; staff/admin read same-tenant; no client writes
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users read own memberships" ON public.tenant_memberships;
CREATE POLICY "Users read own memberships" ON public.tenant_memberships
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.auth_is_tenant_admin(tenant_id)
  );

GRANT SELECT ON public.tenant_memberships TO authenticated;
-- INSERT/UPDATE/DELETE: no authenticated policies → denied (service_role only)

-- ---------------------------------------------------------------------------
-- platform_roles: readable only for self (empty today); no client writes
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users read own platform roles" ON public.platform_roles;
CREATE POLICY "Users read own platform roles" ON public.platform_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.platform_roles TO authenticated;

-- ---------------------------------------------------------------------------
-- super_admin_tenant_access: readable only for self; no client writes
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users read own super admin grants" ON public.super_admin_tenant_access;
CREATE POLICY "Users read own super admin grants" ON public.super_admin_tenant_access
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_owner(auth.uid()));

GRANT SELECT ON public.super_admin_tenant_access TO authenticated;

-- ---------------------------------------------------------------------------
-- support / emergency grants: readable by subject or Super Owner; no client writes
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users read own support grants" ON public.tenant_support_access_grants;
CREATE POLICY "Users read own support grants" ON public.tenant_support_access_grants
  FOR SELECT TO authenticated
  USING (grantee_user_id = auth.uid() OR public.is_super_owner(auth.uid()));

DROP POLICY IF EXISTS "Users read own emergency grants" ON public.tenant_emergency_access_grants;
CREATE POLICY "Users read own emergency grants" ON public.tenant_emergency_access_grants
  FOR SELECT TO authenticated
  USING (grantee_user_id = auth.uid() OR public.is_super_owner(auth.uid()));

GRANT SELECT ON public.tenant_support_access_grants TO authenticated;
GRANT SELECT ON public.tenant_emergency_access_grants TO authenticated;

-- ---------------------------------------------------------------------------
-- feature_catalogue: authenticated read; no client writes
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated read feature catalogue" ON public.feature_catalogue;
CREATE POLICY "Authenticated read feature catalogue" ON public.feature_catalogue
  FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.feature_catalogue TO authenticated;

-- ---------------------------------------------------------------------------
-- platform_mfa_policy: authenticated read; no client writes
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated read mfa policy" ON public.platform_mfa_policy;
CREATE POLICY "Authenticated read mfa policy" ON public.platform_mfa_policy
  FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON public.platform_mfa_policy TO authenticated;

-- ---------------------------------------------------------------------------
-- security_audit_events: Super Owner / tenant admin read; no client writes
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins read security audit events" ON public.security_audit_events;
CREATE POLICY "Admins read security audit events" ON public.security_audit_events
  FOR SELECT TO authenticated
  USING (
    public.is_super_owner(auth.uid())
    OR (tenant_id IS NOT NULL AND public.auth_is_tenant_admin(tenant_id))
  );

GRANT SELECT ON public.security_audit_events TO authenticated;

-- ---------------------------------------------------------------------------
-- platform_restore_points: enable RLS, service_role only (no authenticated policy)
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_restore_points ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- tenant config: members read; tenant admins update; no client insert/delete
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members read tenant branding" ON public.tenant_branding;
CREATE POLICY "Members read tenant branding" ON public.tenant_branding
  FOR SELECT TO authenticated
  USING (public.auth_can_access_tenant(tenant_id));

DROP POLICY IF EXISTS "Admins update tenant branding" ON public.tenant_branding;
CREATE POLICY "Admins update tenant branding" ON public.tenant_branding
  FOR UPDATE TO authenticated
  USING (public.auth_can_administer_tenant(tenant_id))
  WITH CHECK (public.auth_can_administer_tenant(tenant_id));

DROP POLICY IF EXISTS "Members read tenant settings" ON public.tenant_settings;
CREATE POLICY "Members read tenant settings" ON public.tenant_settings
  FOR SELECT TO authenticated
  USING (public.auth_can_access_tenant(tenant_id));

DROP POLICY IF EXISTS "Admins update tenant settings" ON public.tenant_settings;
CREATE POLICY "Admins update tenant settings" ON public.tenant_settings
  FOR UPDATE TO authenticated
  USING (public.auth_can_administer_tenant(tenant_id))
  WITH CHECK (public.auth_can_administer_tenant(tenant_id));

DROP POLICY IF EXISTS "Members read tenant comms config" ON public.tenant_comms_config;
CREATE POLICY "Members read tenant comms config" ON public.tenant_comms_config
  FOR SELECT TO authenticated
  USING (public.auth_can_access_tenant(tenant_id));

DROP POLICY IF EXISTS "Admins update tenant comms config" ON public.tenant_comms_config;
CREATE POLICY "Admins update tenant comms config" ON public.tenant_comms_config
  FOR UPDATE TO authenticated
  USING (public.auth_can_administer_tenant(tenant_id))
  WITH CHECK (public.auth_can_administer_tenant(tenant_id));

DROP POLICY IF EXISTS "Members read tenant features" ON public.tenant_features;
CREATE POLICY "Members read tenant features" ON public.tenant_features
  FOR SELECT TO authenticated
  USING (public.auth_can_access_tenant(tenant_id));

DROP POLICY IF EXISTS "Admins update tenant features" ON public.tenant_features;
CREATE POLICY "Admins update tenant features" ON public.tenant_features
  FOR UPDATE TO authenticated
  USING (public.auth_can_administer_tenant(tenant_id))
  WITH CHECK (public.auth_can_administer_tenant(tenant_id));

GRANT SELECT ON public.tenant_branding, public.tenant_settings, public.tenant_comms_config, public.tenant_features TO authenticated;
GRANT UPDATE ON public.tenant_branding, public.tenant_settings, public.tenant_comms_config, public.tenant_features TO authenticated;
