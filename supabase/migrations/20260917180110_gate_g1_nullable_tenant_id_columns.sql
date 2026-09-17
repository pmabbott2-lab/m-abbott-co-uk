-- Gate G1 part 2: nullable tenant_id columns + indexes (no backfill, not NOT NULL).
-- Companion to gate_g1_multi_tenant_scaffolding.

-- ---------------------------------------------------------------------------
-- Nullable tenant_id on existing tables (NO backfill, NOT NULL)
-- Skips: platform_restore_points (system), user_roles (migrates to memberships later)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.admin_profiles
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.admin_permissions
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.advisor_profiles
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.advisor_availability
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.advisor_diary_settings
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.advisor_diary_exceptions
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.advisor_notes
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.advisor_contact_views
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.advisor_telephony
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.interview_sessions
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.interview_messages
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.interview_answers
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.session_advisors
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.session_contact_tracking
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.customer_contact_log
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.customer_journey_milestones
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.case_mortgage_details
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.callback_requests
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.phone_calls
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.staff_contact_tasks
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.introducers
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.introducer_leads
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.customer_introducer_links
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.introducer_amendment_history
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.referral_codes
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.referrals
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.staff_invitations
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.finance_fee_lines
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.finance_ledger
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.finance_audit_log
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.finance_settings
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.commission_rates
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.commission_rate_history
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.network_commission_statements
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.network_commission_lines
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.communication_settings
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.communication_templates
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.communication_template_versions
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.telephony_numbers
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.telephony_routing_settings
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.lender_remortgage_policies
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);
ALTER TABLE public.view_as_audit_log
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants (id);

-- Indexes for future tenant filters (nullable columns; safe for existing app)
CREATE INDEX IF NOT EXISTS profiles_tenant_id_idx ON public.profiles (tenant_id);
CREATE INDEX IF NOT EXISTS admin_profiles_tenant_id_idx ON public.admin_profiles (tenant_id);
CREATE INDEX IF NOT EXISTS admin_permissions_tenant_id_idx ON public.admin_permissions (tenant_id);
CREATE INDEX IF NOT EXISTS advisor_profiles_tenant_id_idx ON public.advisor_profiles (tenant_id);
CREATE INDEX IF NOT EXISTS advisor_availability_tenant_id_idx ON public.advisor_availability (tenant_id);
CREATE INDEX IF NOT EXISTS advisor_diary_settings_tenant_id_idx ON public.advisor_diary_settings (tenant_id);
CREATE INDEX IF NOT EXISTS advisor_diary_exceptions_tenant_id_idx ON public.advisor_diary_exceptions (tenant_id);
CREATE INDEX IF NOT EXISTS advisor_notes_tenant_id_idx ON public.advisor_notes (tenant_id);
CREATE INDEX IF NOT EXISTS advisor_contact_views_tenant_id_idx ON public.advisor_contact_views (tenant_id);
CREATE INDEX IF NOT EXISTS advisor_telephony_tenant_id_idx ON public.advisor_telephony (tenant_id);
CREATE INDEX IF NOT EXISTS appointments_tenant_id_idx ON public.appointments (tenant_id);
CREATE INDEX IF NOT EXISTS interview_sessions_tenant_id_idx ON public.interview_sessions (tenant_id);
CREATE INDEX IF NOT EXISTS interview_messages_tenant_id_idx ON public.interview_messages (tenant_id);
CREATE INDEX IF NOT EXISTS interview_answers_tenant_id_idx ON public.interview_answers (tenant_id);
CREATE INDEX IF NOT EXISTS session_advisors_tenant_id_idx ON public.session_advisors (tenant_id);
CREATE INDEX IF NOT EXISTS session_contact_tracking_tenant_id_idx ON public.session_contact_tracking (tenant_id);
CREATE INDEX IF NOT EXISTS customer_contact_log_tenant_id_idx ON public.customer_contact_log (tenant_id);
CREATE INDEX IF NOT EXISTS customer_journey_milestones_tenant_id_idx ON public.customer_journey_milestones (tenant_id);
CREATE INDEX IF NOT EXISTS case_mortgage_details_tenant_id_idx ON public.case_mortgage_details (tenant_id);
CREATE INDEX IF NOT EXISTS callback_requests_tenant_id_idx ON public.callback_requests (tenant_id);
CREATE INDEX IF NOT EXISTS phone_calls_tenant_id_idx ON public.phone_calls (tenant_id);
CREATE INDEX IF NOT EXISTS sms_messages_tenant_id_idx ON public.sms_messages (tenant_id);
CREATE INDEX IF NOT EXISTS staff_contact_tasks_tenant_id_idx ON public.staff_contact_tasks (tenant_id);
CREATE INDEX IF NOT EXISTS introducers_tenant_id_idx ON public.introducers (tenant_id);
CREATE INDEX IF NOT EXISTS introducer_leads_tenant_id_idx ON public.introducer_leads (tenant_id);
CREATE INDEX IF NOT EXISTS customer_introducer_links_tenant_id_idx ON public.customer_introducer_links (tenant_id);
CREATE INDEX IF NOT EXISTS introducer_amendment_history_tenant_id_idx ON public.introducer_amendment_history (tenant_id);
CREATE INDEX IF NOT EXISTS referral_codes_tenant_id_idx ON public.referral_codes (tenant_id);
CREATE INDEX IF NOT EXISTS referrals_tenant_id_idx ON public.referrals (tenant_id);
CREATE INDEX IF NOT EXISTS staff_invitations_tenant_id_idx ON public.staff_invitations (tenant_id);
CREATE INDEX IF NOT EXISTS finance_fee_lines_tenant_id_idx ON public.finance_fee_lines (tenant_id);
CREATE INDEX IF NOT EXISTS finance_ledger_tenant_id_idx ON public.finance_ledger (tenant_id);
CREATE INDEX IF NOT EXISTS finance_audit_log_tenant_id_idx ON public.finance_audit_log (tenant_id);
CREATE INDEX IF NOT EXISTS finance_settings_tenant_id_idx ON public.finance_settings (tenant_id);
CREATE INDEX IF NOT EXISTS commission_rates_tenant_id_idx ON public.commission_rates (tenant_id);
CREATE INDEX IF NOT EXISTS commission_rate_history_tenant_id_idx ON public.commission_rate_history (tenant_id);
CREATE INDEX IF NOT EXISTS network_commission_statements_tenant_id_idx ON public.network_commission_statements (tenant_id);
CREATE INDEX IF NOT EXISTS network_commission_lines_tenant_id_idx ON public.network_commission_lines (tenant_id);
CREATE INDEX IF NOT EXISTS communication_settings_tenant_id_idx ON public.communication_settings (tenant_id);
CREATE INDEX IF NOT EXISTS communication_templates_tenant_id_idx ON public.communication_templates (tenant_id);
CREATE INDEX IF NOT EXISTS communication_template_versions_tenant_id_idx ON public.communication_template_versions (tenant_id);
CREATE INDEX IF NOT EXISTS telephony_numbers_tenant_id_idx ON public.telephony_numbers (tenant_id);
CREATE INDEX IF NOT EXISTS telephony_routing_settings_tenant_id_idx ON public.telephony_routing_settings (tenant_id);
CREATE INDEX IF NOT EXISTS lender_remortgage_policies_tenant_id_idx ON public.lender_remortgage_policies (tenant_id);
CREATE INDEX IF NOT EXISTS view_as_audit_log_tenant_id_idx ON public.view_as_audit_log (tenant_id);
