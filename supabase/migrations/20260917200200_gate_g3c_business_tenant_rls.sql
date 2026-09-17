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
