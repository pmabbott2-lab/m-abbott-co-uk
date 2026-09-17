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
