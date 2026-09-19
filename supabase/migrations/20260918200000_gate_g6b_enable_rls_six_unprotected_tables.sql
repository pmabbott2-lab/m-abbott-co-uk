-- Gate G6B: enable RLS on six tables that G3D left unprotected.
-- Forward-only. Does not rewrite G1–G6A history.
--
-- G3D created SELECT policies for four of these tables but never ran
-- ENABLE ROW LEVEL SECURITY, and default GRANTs left anon/authenticated
-- with full CRUD. Application writes for all six tables are service_role
-- (supabaseAdmin). Authenticated clients receive SELECT only where a
-- legitimate role needs Data-API visibility. No anonymous access.
-- Fail closed when tenant_id is null (helpers require non-null tenant).

-- ---------------------------------------------------------------------------
-- Grants: deny anon; authenticated SELECT only; service_role retains ALL
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE
  public.commission_rate_history,
  public.customer_introducer_links,
  public.finance_audit_log,
  public.finance_settings,
  public.introducer_amendment_history,
  public.view_as_audit_log
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.commission_rate_history,
  public.customer_introducer_links,
  public.finance_audit_log,
  public.finance_settings,
  public.introducer_amendment_history,
  public.view_as_audit_log
TO authenticated;

GRANT ALL ON TABLE
  public.commission_rate_history,
  public.customer_introducer_links,
  public.finance_audit_log,
  public.finance_settings,
  public.introducer_amendment_history,
  public.view_as_audit_log
TO service_role;

-- ---------------------------------------------------------------------------
-- commission_rate_history
-- Append-only audit of commission % changes. Written by setCommissionRate
-- via supabaseAdmin. Tenant admins may SELECT. No client INSERT/UPDATE/DELETE.
-- ---------------------------------------------------------------------------
ALTER TABLE public.commission_rate_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read commission history" ON public.commission_rate_history;
CREATE POLICY "Admins read commission history" ON public.commission_rate_history
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_admin(tenant_id));

-- ---------------------------------------------------------------------------
-- finance_audit_log
-- Append-only finance/relationship audit. Written by finance + introducer
-- server functions via supabaseAdmin. Tenant admins may SELECT.
-- No client INSERT/UPDATE/DELETE.
-- ---------------------------------------------------------------------------
ALTER TABLE public.finance_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read finance audit" ON public.finance_audit_log;
CREATE POLICY "Admins read finance audit" ON public.finance_audit_log
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_admin(tenant_id));

-- ---------------------------------------------------------------------------
-- introducer_amendment_history
-- Append-only introducer change history. Written by amendCustomerIntroducer
-- via supabaseAdmin. G3D had no policies. Tenant admins may SELECT.
-- No client INSERT/UPDATE/DELETE.
-- ---------------------------------------------------------------------------
ALTER TABLE public.introducer_amendment_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read introducer amendment history" ON public.introducer_amendment_history;
CREATE POLICY "Admins read introducer amendment history" ON public.introducer_amendment_history
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_admin(tenant_id));

-- ---------------------------------------------------------------------------
-- view_as_audit_log
-- Append-only view-as audit. Written by logViewAsAudit via supabaseAdmin.
-- Tenant admins may SELECT tenant rows; an actor may SELECT own rows only
-- when they also have data access to that tenant. No client writes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.view_as_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read view as audit" ON public.view_as_audit_log;
CREATE POLICY "Admins read view as audit" ON public.view_as_audit_log
  FOR SELECT TO authenticated
  USING (
    public.auth_is_tenant_admin(tenant_id)
    OR (
      acting_user_id = auth.uid()
      AND public.auth_can_access_tenant(tenant_id)
    )
  );

-- ---------------------------------------------------------------------------
-- finance_settings
-- Per-tenant RAF/config keys. Read/written by finance server functions via
-- supabaseAdmin. Tenant admins may SELECT. G3D FOR ALL client manage policy
-- is removed: authenticated users must not mutate finance configuration
-- through the Data API (Owner/Supervisor finance admin stays on the server
-- permission matrix). No client INSERT/UPDATE/DELETE.
-- ---------------------------------------------------------------------------
ALTER TABLE public.finance_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage finance settings" ON public.finance_settings;
DROP POLICY IF EXISTS "Admins read finance settings" ON public.finance_settings;
CREATE POLICY "Admins read finance settings" ON public.finance_settings
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_admin(tenant_id));

-- ---------------------------------------------------------------------------
-- customer_introducer_links
-- Current customer↔introducer attribution. Written by server upsert
-- (ensureCustomerIntroducerLink / amendCustomerIntroducer). G3D had no
-- policies. SELECT is narrower than whole-tenant membership:
--   - tenant staff / tenant admin / active support data grant
--   - the customer (own row)
--   - the introducer (own introducer_id only)
-- Customers and introducers must not see other principals' links.
-- No client INSERT/UPDATE/DELETE.
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_introducer_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read customer introducer links" ON public.customer_introducer_links;
CREATE POLICY "Read customer introducer links" ON public.customer_introducer_links
  FOR SELECT TO authenticated
  USING (
    public.auth_is_tenant_staff(tenant_id)
    OR public.auth_is_tenant_admin(tenant_id)
    OR public.has_active_support_data_access(auth.uid(), tenant_id)
    OR customer_id = auth.uid()
    OR (
      public.auth_is_tenant_introducer(tenant_id)
      AND EXISTS (
        SELECT 1
        FROM public.introducers i
        WHERE i.id = customer_introducer_links.introducer_id
          AND i.user_id = auth.uid()
          AND i.tenant_id = customer_introducer_links.tenant_id
      )
    )
  );
