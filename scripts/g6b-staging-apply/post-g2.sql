-- >>> 20260917200000_gate_g3a_rls_security_helpers.sql
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


-- >>> 20260917200100_gate_g3b_identity_platform_config_rls.sql
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


-- >>> 20260917200200_gate_g3c_business_tenant_rls.sql
-- Gate G3C: tenant boundary on CRM / case / staff structural + transactional tables.
-- Preserves inner ownership (customer own rows, introducer own leads, etc.)
-- and adds outer tenant_id isolation for staff paths.
-- Empty tables with NULL tenant_id become invisible to authenticated staff (fail closed).

-- ---------------------------------------------------------------------------
-- Structural staff tables (backfilled to 001)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins view admin profiles" ON public.admin_profiles;
CREATE POLICY "Admins view admin profiles" ON public.admin_profiles
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.auth_can_access_tenant(tenant_id)
  );

DROP POLICY IF EXISTS "Admins view permissions" ON public.admin_permissions;
CREATE POLICY "Admins view permissions" ON public.admin_permissions
  FOR SELECT TO authenticated
  USING (
    (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      AND public.auth_can_access_tenant(tenant_id)
    )
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Advisors view advisor codes" ON public.advisor_profiles;
CREATE POLICY "Advisors view advisor codes" ON public.advisor_profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      (public.has_role(auth.uid(), 'advisor'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role))
      AND public.auth_can_access_tenant(tenant_id)
    )
  );

DROP POLICY IF EXISTS "Advisors manage own availability" ON public.advisor_availability;
DROP POLICY IF EXISTS "Anyone can read availability for booking" ON public.advisor_availability;
CREATE POLICY "Public read active availability" ON public.advisor_availability
  FOR SELECT TO authenticated, anon
  USING (active = true);
CREATE POLICY "Advisors manage own availability" ON public.advisor_availability
  FOR ALL TO authenticated
  USING (
    advisor_id = auth.uid()
    AND (tenant_id IS NULL OR public.auth_can_access_tenant(tenant_id))
  )
  WITH CHECK (
    advisor_id = auth.uid()
    AND (tenant_id IS NULL OR public.auth_can_access_tenant(tenant_id))
  );

DROP POLICY IF EXISTS "Introducers view and update own profile" ON public.introducers;
CREATE POLICY "Introducers view and update own profile" ON public.introducers
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      public.auth_is_tenant_staff(tenant_id)
    )
  );
CREATE POLICY "Introducers update own profile" ON public.introducers
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.auth_can_access_tenant(tenant_id))
  WITH CHECK (user_id = auth.uid() AND public.auth_can_access_tenant(tenant_id));

-- ---------------------------------------------------------------------------
-- Interview / case data — customer self-access + tenant-scoped staff
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Customer manages own sessions" ON public.interview_sessions;
CREATE POLICY "Customer manages own sessions" ON public.interview_sessions
  FOR ALL TO authenticated
  USING (
    customer_id = auth.uid()
    OR (
      (public.has_role(auth.uid(), 'advisor'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role))
      AND public.auth_can_access_tenant(tenant_id)
    )
  )
  WITH CHECK (
    customer_id = auth.uid()
    OR (
      (public.has_role(auth.uid(), 'advisor'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role))
      AND public.auth_can_access_tenant(tenant_id)
    )
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
          OR (
            (public.has_role(auth.uid(), 'advisor'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role))
            AND public.auth_can_access_tenant(COALESCE(interview_messages.tenant_id, s.tenant_id))
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.interview_sessions s
      WHERE s.id = session_id
        AND (
          s.customer_id = auth.uid()
          OR (
            (public.has_role(auth.uid(), 'advisor'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role))
            AND public.auth_can_access_tenant(COALESCE(interview_messages.tenant_id, s.tenant_id))
          )
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
          OR (
            (public.has_role(auth.uid(), 'advisor'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role))
            AND public.auth_can_access_tenant(COALESCE(interview_answers.tenant_id, s.tenant_id))
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.interview_sessions s
      WHERE s.id = session_id
        AND (
          s.customer_id = auth.uid()
          OR (
            (public.has_role(auth.uid(), 'advisor'::public.app_role) OR public.has_role(auth.uid(), 'admin'::public.app_role))
            AND public.auth_can_access_tenant(COALESCE(interview_answers.tenant_id, s.tenant_id))
          )
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Appointments / callbacks / leads
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Advisors view all appointments" ON public.appointments;
DROP POLICY IF EXISTS "Advisors update appointments" ON public.appointments;
DROP POLICY IF EXISTS "Customers view appointments for own sessions" ON public.appointments;
DROP POLICY IF EXISTS "Introducers view own appointments" ON public.appointments;

CREATE POLICY "Staff view tenant appointments" ON public.appointments
  FOR SELECT TO authenticated
  USING (
    public.auth_is_tenant_staff(tenant_id)
    OR advisor_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.interview_sessions s
      WHERE s.id = appointments.session_id AND s.customer_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.introducers i
      WHERE i.id = appointments.introducer_id AND i.user_id = auth.uid()
    )
  );

CREATE POLICY "Staff update tenant appointments" ON public.appointments
  FOR UPDATE TO authenticated
  USING (
    public.auth_is_tenant_staff(tenant_id)
    OR advisor_id = auth.uid()
  )
  WITH CHECK (
    public.auth_is_tenant_staff(tenant_id)
    OR advisor_id = auth.uid()
  );

CREATE POLICY "Staff insert tenant appointments" ON public.appointments
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_tenant_staff(tenant_id) OR advisor_id = auth.uid());

CREATE POLICY "Staff delete tenant appointments" ON public.appointments
  FOR DELETE TO authenticated
  USING (public.auth_is_tenant_admin(tenant_id) OR advisor_id = auth.uid());

DROP POLICY IF EXISTS "Advisors view all callbacks" ON public.callback_requests;
DROP POLICY IF EXISTS "Advisors update callbacks" ON public.callback_requests;
CREATE POLICY "Staff view tenant callbacks" ON public.callback_requests
  FOR SELECT TO authenticated
  USING (
    public.auth_is_tenant_staff(tenant_id)
    OR advisor_id = auth.uid()
    OR customer_id = auth.uid()
  );
CREATE POLICY "Staff update tenant callbacks" ON public.callback_requests
  FOR UPDATE TO authenticated
  USING (
    public.auth_is_tenant_staff(tenant_id)
    OR advisor_id = auth.uid()
  )
  WITH CHECK (
    public.auth_is_tenant_staff(tenant_id)
    OR advisor_id = auth.uid()
  );
CREATE POLICY "Staff insert tenant callbacks" ON public.callback_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_is_tenant_staff(tenant_id)
    OR customer_id = auth.uid()
  );

DROP POLICY IF EXISTS "Introducers manage own leads" ON public.introducer_leads;
CREATE POLICY "Introducers manage own leads" ON public.introducer_leads
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.introducers i
      WHERE i.id = introducer_id AND i.user_id = auth.uid()
    )
    OR public.auth_is_tenant_staff(tenant_id)
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.introducers i
      WHERE i.id = introducer_id AND i.user_id = auth.uid()
    )
    OR public.auth_is_tenant_staff(tenant_id)
  );

-- ---------------------------------------------------------------------------
-- Contact / journey / notes / allocations — staff + tenant
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Advisors view contact log" ON public.customer_contact_log;
CREATE POLICY "Staff view tenant contact log" ON public.customer_contact_log
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_staff(tenant_id));

DROP POLICY IF EXISTS "Advisors view contact tracking" ON public.session_contact_tracking;
CREATE POLICY "Staff view tenant contact tracking" ON public.session_contact_tracking
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_staff(tenant_id));

DROP POLICY IF EXISTS "Advisors view own contact views" ON public.advisor_contact_views;
CREATE POLICY "Advisors view own contact views" ON public.advisor_contact_views
  FOR SELECT TO authenticated
  USING (
    advisor_id = auth.uid()
    OR public.auth_is_tenant_admin(tenant_id)
  );

DROP POLICY IF EXISTS "Advisors view journey milestones" ON public.customer_journey_milestones;
DROP POLICY IF EXISTS "Customers view own journey milestones" ON public.customer_journey_milestones;
CREATE POLICY "Customers view own journey milestones" ON public.customer_journey_milestones
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.interview_sessions s
      WHERE s.id = session_id AND s.customer_id = auth.uid()
    )
    OR public.auth_is_tenant_staff(tenant_id)
  );

DROP POLICY IF EXISTS "Advisors view own allocations" ON public.session_advisors;
CREATE POLICY "Advisors view own allocations" ON public.session_advisors
  FOR SELECT TO authenticated
  USING (
    advisor_id = auth.uid()
    OR public.auth_is_tenant_staff(tenant_id)
  );

DROP POLICY IF EXISTS "Staff view case mortgage details" ON public.case_mortgage_details;
CREATE POLICY "Staff view case mortgage details" ON public.case_mortgage_details
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_staff(tenant_id));

-- advisor_notes: keep customer session read + advisor ownership, add tenant for staff
DROP POLICY IF EXISTS "Advisors manage notes; customers read their own session notes" ON public.advisor_notes;
DROP POLICY IF EXISTS "Advisors insert notes" ON public.advisor_notes;
DROP POLICY IF EXISTS "Advisors update own notes" ON public.advisor_notes;
DROP POLICY IF EXISTS "Advisors delete own notes" ON public.advisor_notes;

CREATE POLICY "Read advisor notes" ON public.advisor_notes
  FOR SELECT TO authenticated
  USING (
    advisor_id = auth.uid()
    OR public.auth_is_tenant_staff(tenant_id)
    OR EXISTS (
      SELECT 1 FROM public.interview_sessions s
      WHERE s.id = session_id AND s.customer_id = auth.uid()
    )
  );
CREATE POLICY "Insert advisor notes" ON public.advisor_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    advisor_id = auth.uid()
    AND public.auth_is_tenant_staff(tenant_id)
  );
CREATE POLICY "Update own advisor notes" ON public.advisor_notes
  FOR UPDATE TO authenticated
  USING (advisor_id = auth.uid() AND public.auth_can_access_tenant(tenant_id))
  WITH CHECK (advisor_id = auth.uid() AND public.auth_can_access_tenant(tenant_id));
CREATE POLICY "Delete own advisor notes" ON public.advisor_notes
  FOR DELETE TO authenticated
  USING (advisor_id = auth.uid() AND public.auth_can_access_tenant(tenant_id));

-- staff invitations / referral codes — tenant scoped
DROP POLICY IF EXISTS "Staff manage invitations" ON public.staff_invitations;
CREATE POLICY "Staff manage invitations" ON public.staff_invitations
  FOR ALL TO authenticated
  USING (
    public.auth_is_tenant_admin(tenant_id)
    OR (tenant_id IS NULL AND (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'advisor'::public.app_role)))
  )
  WITH CHECK (
    public.auth_is_tenant_admin(tenant_id)
  );

DROP POLICY IF EXISTS "Staff manage referral codes" ON public.referral_codes;
CREATE POLICY "Staff manage referral codes" ON public.referral_codes
  FOR ALL TO authenticated
  USING (public.auth_is_tenant_staff(tenant_id))
  WITH CHECK (public.auth_is_tenant_staff(tenant_id));

DROP POLICY IF EXISTS "Staff view referrals" ON public.referrals;
CREATE POLICY "Staff view referrals" ON public.referrals
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_staff(tenant_id));

-- lender reference: staff read (shared; tenant_id may be null)
DROP POLICY IF EXISTS "Staff view lender policies" ON public.lender_remortgage_policies;
CREATE POLICY "Staff view lender policies" ON public.lender_remortgage_policies
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'advisor'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

-- diary settings: keep public read for booking; manage own with tenant check
DROP POLICY IF EXISTS "Anyone can read diary settings for booking" ON public.advisor_diary_settings;
DROP POLICY IF EXISTS "Advisors manage own diary settings" ON public.advisor_diary_settings;
CREATE POLICY "Public read diary settings" ON public.advisor_diary_settings
  FOR SELECT TO authenticated, anon
  USING (true);
CREATE POLICY "Advisors manage own diary settings" ON public.advisor_diary_settings
  FOR ALL TO authenticated
  USING (advisor_id = auth.uid() AND (tenant_id IS NULL OR public.auth_can_access_tenant(tenant_id)))
  WITH CHECK (advisor_id = auth.uid() AND (tenant_id IS NULL OR public.auth_can_access_tenant(tenant_id)));

DROP POLICY IF EXISTS "Anyone can read diary exceptions for booking" ON public.advisor_diary_exceptions;
DROP POLICY IF EXISTS "Advisors manage own diary exceptions" ON public.advisor_diary_exceptions;
CREATE POLICY "Public read diary exceptions" ON public.advisor_diary_exceptions
  FOR SELECT TO authenticated, anon
  USING (true);
CREATE POLICY "Advisors manage own diary exceptions" ON public.advisor_diary_exceptions
  FOR ALL TO authenticated
  USING (advisor_id = auth.uid() AND (tenant_id IS NULL OR public.auth_can_access_tenant(tenant_id)))
  WITH CHECK (advisor_id = auth.uid() AND (tenant_id IS NULL OR public.auth_can_access_tenant(tenant_id)));


-- >>> 20260917200300_gate_g3d_telephony_comms_finance_rls.sql
-- Gate G3D: telephony, communications, finance RLS with tenant isolation.
-- Restrictive: finance/telephony mutations require tenant admin (or Owner plane).

-- ---------------------------------------------------------------------------
-- Telephony
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff read telephony numbers" ON public.telephony_numbers;
CREATE POLICY "Staff read tenant telephony numbers" ON public.telephony_numbers
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_staff(tenant_id));

CREATE POLICY "Admins manage tenant telephony numbers" ON public.telephony_numbers
  FOR ALL TO authenticated
  USING (public.auth_is_tenant_admin(tenant_id))
  WITH CHECK (public.auth_is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Staff read advisor telephony" ON public.advisor_telephony;
CREATE POLICY "Staff read advisor telephony" ON public.advisor_telephony
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.auth_is_tenant_staff(tenant_id)
  );

CREATE POLICY "Admins manage advisor telephony" ON public.advisor_telephony
  FOR ALL TO authenticated
  USING (public.auth_is_tenant_admin(tenant_id) OR user_id = auth.uid())
  WITH CHECK (public.auth_is_tenant_admin(tenant_id) OR user_id = auth.uid());

DROP POLICY IF EXISTS "Staff read telephony settings" ON public.telephony_routing_settings;
CREATE POLICY "Staff read telephony settings" ON public.telephony_routing_settings
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_staff(tenant_id));

CREATE POLICY "Admins manage telephony settings" ON public.telephony_routing_settings
  FOR UPDATE TO authenticated
  USING (public.auth_is_tenant_admin(tenant_id))
  WITH CHECK (public.auth_is_tenant_admin(tenant_id));

-- ---------------------------------------------------------------------------
-- Communications
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Advisors view SMS log" ON public.sms_messages;
CREATE POLICY "Staff view tenant SMS" ON public.sms_messages
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_staff(tenant_id));

CREATE POLICY "Staff insert tenant SMS" ON public.sms_messages
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_is_tenant_staff(tenant_id));

DROP POLICY IF EXISTS "Advisors view phone calls" ON public.phone_calls;
CREATE POLICY "Staff view tenant phone calls" ON public.phone_calls
  FOR SELECT TO authenticated
  USING (
    public.auth_is_tenant_staff(tenant_id)
    OR advisor_id = auth.uid()
    OR customer_id = auth.uid()
  );

-- Platform/global communication templates (NULL tenant_id): staff read
DROP POLICY IF EXISTS "Staff read communication templates" ON public.communication_templates;
CREATE POLICY "Staff read communication templates" ON public.communication_templates
  FOR SELECT TO authenticated
  USING (
    tenant_id IS NULL
    OR public.auth_is_tenant_staff(tenant_id)
  );

DROP POLICY IF EXISTS "Admins manage communication templates" ON public.communication_templates;
CREATE POLICY "Admins manage communication templates" ON public.communication_templates
  FOR ALL TO authenticated
  USING (
    (tenant_id IS NULL AND public.has_role(auth.uid(), 'admin'::public.app_role))
    OR public.auth_is_tenant_admin(tenant_id)
  )
  WITH CHECK (
    (tenant_id IS NULL AND public.has_role(auth.uid(), 'admin'::public.app_role))
    OR public.auth_is_tenant_admin(tenant_id)
  );

DROP POLICY IF EXISTS "Staff read communication settings" ON public.communication_settings;
CREATE POLICY "Staff read communication settings" ON public.communication_settings
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_staff(tenant_id));

CREATE POLICY "Admins manage communication settings" ON public.communication_settings
  FOR ALL TO authenticated
  USING (public.auth_is_tenant_admin(tenant_id))
  WITH CHECK (public.auth_is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Staff read template versions" ON public.communication_template_versions;
CREATE POLICY "Staff read template versions" ON public.communication_template_versions
  FOR SELECT TO authenticated
  USING (
    tenant_id IS NULL
    OR public.auth_is_tenant_staff(tenant_id)
  );

GRANT SELECT ON public.communication_templates, public.communication_settings, public.communication_template_versions TO authenticated;

-- ---------------------------------------------------------------------------
-- Finance / commission — restrictive (admin within tenant)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins read commission rates" ON public.commission_rates;
CREATE POLICY "Admins read commission rates" ON public.commission_rates
  FOR SELECT TO authenticated
  USING (
    public.auth_is_tenant_admin(tenant_id)
    OR user_id = auth.uid()
  );

CREATE POLICY "Admins manage commission rates" ON public.commission_rates
  FOR ALL TO authenticated
  USING (public.auth_is_tenant_admin(tenant_id))
  WITH CHECK (public.auth_is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Admins read commission history" ON public.commission_rate_history;
CREATE POLICY "Admins read commission history" ON public.commission_rate_history
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Admins read finance settings" ON public.finance_settings;
CREATE POLICY "Admins read finance settings" ON public.finance_settings
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_admin(tenant_id));

CREATE POLICY "Admins manage finance settings" ON public.finance_settings
  FOR ALL TO authenticated
  USING (public.auth_is_tenant_admin(tenant_id))
  WITH CHECK (public.auth_is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Admins read finance ledger" ON public.finance_ledger;
CREATE POLICY "Admins read finance ledger" ON public.finance_ledger
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Admins read finance fee lines" ON public.finance_fee_lines;
CREATE POLICY "Admins read finance fee lines" ON public.finance_fee_lines
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Admins read finance audit" ON public.finance_audit_log;
CREATE POLICY "Admins read finance audit" ON public.finance_audit_log
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Admins read network statements" ON public.network_commission_statements;
CREATE POLICY "Admins read network statements" ON public.network_commission_statements
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_admin(tenant_id));

DROP POLICY IF EXISTS "Admins read network lines" ON public.network_commission_lines;
CREATE POLICY "Admins read network lines" ON public.network_commission_lines
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_admin(tenant_id));

GRANT SELECT ON public.commission_rates, public.commission_rate_history, public.finance_settings,
  public.finance_ledger, public.finance_fee_lines, public.finance_audit_log,
  public.network_commission_statements, public.network_commission_lines TO authenticated;

-- view_as_audit_log
DROP POLICY IF EXISTS "Admins read view as audit" ON public.view_as_audit_log;
CREATE POLICY "Admins read view as audit" ON public.view_as_audit_log
  FOR SELECT TO authenticated
  USING (public.auth_is_tenant_admin(tenant_id) OR acting_user_id = auth.uid());

GRANT SELECT ON public.view_as_audit_log TO authenticated;


-- >>> 20260917210000_gate_g4_tenant_branding_seed.sql
-- Gate G4: seed safe public branding + website URLs for known tenants.
-- Additive only. Does not weaken RLS. Does not invent FCA numbers.

UPDATE public.tenant_branding b
SET
  logo_path = 'mortgageeasy/logo.png',
  primary_colour = '#1a2f4f',
  secondary_colour = '#3d9e47',
  updated_at = now()
FROM public.tenants t
WHERE b.tenant_id = t.id
  AND t.company_code = '001';

UPDATE public.tenant_branding b
SET
  logo_path = 'trentvalleyfs/logo.png',
  primary_colour = '#0b1524',
  secondary_colour = '#6b93b0',
  updated_at = now()
FROM public.tenants t
WHERE b.tenant_id = t.id
  AND t.company_code = '002';

-- Marketing mock sites are same-origin under these paths when the proxy serves them.
-- Prefer relative website URLs so we do not invent external domains.
UPDATE public.tenants
SET
  website_url = '/mortgageeasy/',
  trading_name = COALESCE(NULLIF(trading_name, ''), 'Mortgage Easy'),
  updated_at = now()
WHERE company_code = '001';

UPDATE public.tenants
SET
  website_url = NULL,
  trading_name = COALESCE(NULLIF(trading_name, ''), 'Trent Valley Financial Services'),
  updated_at = now()
WHERE company_code = '002';

COMMENT ON COLUMN public.tenant_branding.logo_path IS
  'Public asset path under /tenant-branding/ or absolute URL. Never a secret.';


-- >>> 20260918103000_gate_g5_seed_001_operational_features.sql
-- Gate G5: seed Mortgage Easy (001) operational feature rows so enforcement
-- does not disable live 001 behaviour when catalogue.default_enabled = false.
-- Trent Valley (002) is NOT mass-enabled — only existing susan_ai_journey=disabled remains.
-- password_recovery stays on catalogue default_enabled=true (no forced row required).

INSERT INTO public.tenant_features (tenant_id, feature_key, state)
SELECT t.id, fc.feature_key, 'enabled'::public.feature_state
FROM public.tenants t
CROSS JOIN public.feature_catalogue fc
WHERE t.company_code = '001'
  AND fc.active = true
  AND fc.feature_key <> 'password_recovery'
ON CONFLICT (tenant_id, feature_key) DO NOTHING;

-- Ensure Susan remains enabled for 001 (idempotent)
UPDATE public.tenant_features tf
SET state = 'enabled'::public.feature_state,
    updated_at = now()
FROM public.tenants t
WHERE tf.tenant_id = t.id
  AND t.company_code = '001'
  AND tf.feature_key = 'susan_ai_journey';

-- Ensure Susan remains disabled for 002
UPDATE public.tenant_features tf
SET state = 'disabled'::public.feature_state,
    updated_at = now()
FROM public.tenants t
WHERE tf.tenant_id = t.id
  AND t.company_code = '002'
  AND tf.feature_key = 'susan_ai_journey';

COMMENT ON TABLE public.tenant_features IS
  'Per-tenant feature state. G5: 001 seeded operational enabled; 002 susan disabled; defaults apply when no row.';


-- >>> 20260918120000_gate_g6_company_provisioning.sql
-- Gate G6: company-code allocator + regulatory config shell on tenant_settings.
-- Does NOT create platform roles or Super Owner.

CREATE OR REPLACE FUNCTION public.allocate_next_company_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_n int;
BEGIN
  -- Serialize code allocation across concurrent provisioners.
  PERFORM pg_advisory_xact_lock(872014001);
  SELECT COALESCE(MAX(company_code::int), 0) + 1
    INTO next_n
  FROM public.tenants
  WHERE company_code ~ '^[0-9]{3}$';
  IF next_n IS NULL OR next_n < 1 THEN
    next_n := 1;
  END IF;
  IF next_n > 999 THEN
    RAISE EXCEPTION 'company_code_exhausted';
  END IF;
  RETURN lpad(next_n::text, 3, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_next_company_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_next_company_code() TO service_role;

COMMENT ON FUNCTION public.allocate_next_company_code() IS
  'G6: allocate next zero-padded company_code under advisory lock. Service-role / provisioning only.';

ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS regulatory jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.tenant_settings.regulatory IS
  'G6 regulatory/legal URLs and wording (FRN, privacy/terms/complaints URLs, registered office, company number). Never copy from another tenant.';

-- Soft uniqueness helper for invite acceptance: one membership row per user+tenant (role may update)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_memberships_user_tenant_unique'
  ) THEN
    -- Existing unique is (user_id, tenant_id, role). Keep as-is for compatibility.
    NULL;
  END IF;
END $$;


-- >>> 20260918123000_gate_g6_invite_membership_role.sql
-- Gate G6: bind staff invitations to an explicit tenant membership role.
-- Does NOT create platform roles or Super Owner.
-- Fixes prior ambiguity where admin invites mapped to membership role 'owner'.

ALTER TABLE public.staff_invitations
  ADD COLUMN IF NOT EXISTS membership_role public.tenant_member_role;

COMMENT ON COLUMN public.staff_invitations.membership_role IS
  'G6: intended tenant_membership.role on accept. Independent of legacy app_role column. Owner invites use owner; General Admin uses general; adviser invites use adviser.';

-- Backfill open invites: admin → general (never auto-owner); advisor → adviser; introducer → introducer.
UPDATE public.staff_invitations
SET membership_role = CASE
  WHEN role = 'admin'::public.app_role THEN 'general'::public.tenant_member_role
  WHEN role = 'advisor'::public.app_role THEN 'adviser'::public.tenant_member_role
  WHEN role = 'introducer'::public.app_role THEN 'introducer'::public.tenant_member_role
  ELSE membership_role
END
WHERE membership_role IS NULL
  AND used_at IS NULL;

-- Used invites: leave NULL (historical); acceptance already applied.

ALTER TABLE public.staff_invitations
  DROP CONSTRAINT IF EXISTS staff_invitations_membership_role_owner_chk;

-- Owner membership invites must use app_role admin (no app_role 'owner').
ALTER TABLE public.staff_invitations
  ADD CONSTRAINT staff_invitations_membership_role_owner_chk
  CHECK (
    membership_role IS NULL
    OR membership_role <> 'owner'::public.tenant_member_role
    OR role = 'admin'::public.app_role
  );

