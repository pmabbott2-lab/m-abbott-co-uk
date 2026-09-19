-- >>> 20260917180039_gate_g1_multi_tenant_scaffolding.sql
-- Gate G1: multi-tenant schema scaffolding (additive, reversible).
-- Creates platform/tenant structures, seeds tenants 001/002, adds nullable tenant_id
-- columns. Does NOT backfill business data, convert Super Owner, enable MFA,
-- change existing RLS policies, or make tenant_id NOT NULL.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.platform_role AS ENUM ('super_owner', 'super_admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.tenant_member_role AS ENUM (
    'owner',
    'supervisor',
    'general',
    'adviser',
    'introducer',
    'customer'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.tenant_status AS ENUM (
    'provisioning',
    'active',
    'suspended',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Core platform / tenant tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_code text NOT NULL,
  slug text NOT NULL,
  company_name text NOT NULL,
  trading_name text,
  status public.tenant_status NOT NULL DEFAULT 'provisioning',
  website_url text,
  company_email text,
  telephone text,
  legal_name text,
  fca_details text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenants_company_code_format CHECK (company_code ~ '^[0-9]{3}$'),
  CONSTRAINT tenants_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT tenants_company_code_unique UNIQUE (company_code),
  CONSTRAINT tenants_slug_unique UNIQUE (slug)
);

COMMENT ON TABLE public.tenants IS
  'Mortgage Hub companies. tenant_id (id) is the immutable security/ownership key. company_code and slug are identifiers only — not security boundaries.';
COMMENT ON COLUMN public.tenants.company_code IS
  'Display/ops company code (001, 002, …). Not a security boundary. Distinct from introducers.company_code (introducer-firm code).';

CREATE TABLE IF NOT EXISTS public.platform_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role public.platform_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT platform_roles_user_role_unique UNIQUE (user_id, role)
);

CREATE INDEX IF NOT EXISTS platform_roles_user_id_idx
  ON public.platform_roles (user_id);

COMMENT ON TABLE public.platform_roles IS
  'Platform-level roles (super_owner, super_admin). Super Owner access does not require tenant_memberships.';

CREATE TABLE IF NOT EXISTS public.super_admin_tenant_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT super_admin_tenant_access_unique UNIQUE (user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS super_admin_tenant_access_user_idx
  ON public.super_admin_tenant_access (user_id);
CREATE INDEX IF NOT EXISTS super_admin_tenant_access_tenant_idx
  ON public.super_admin_tenant_access (tenant_id);

COMMENT ON TABLE public.super_admin_tenant_access IS
  'Explicit Option B grants: which tenants a Super Admin may enter. Super Owner needs no rows here.';

CREATE TABLE IF NOT EXISTS public.tenant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  role public.tenant_member_role NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT tenant_memberships_user_tenant_role_unique UNIQUE (user_id, tenant_id, role)
);

CREATE INDEX IF NOT EXISTS tenant_memberships_user_idx
  ON public.tenant_memberships (user_id);
CREATE INDEX IF NOT EXISTS tenant_memberships_tenant_idx
  ON public.tenant_memberships (tenant_id);
CREATE INDEX IF NOT EXISTS tenant_memberships_tenant_user_idx
  ON public.tenant_memberships (tenant_id, user_id);

COMMENT ON TABLE public.tenant_memberships IS
  'Staff/customer membership of a company. Not used for Super Admin platform grants.';

CREATE TABLE IF NOT EXISTS public.tenant_branding (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  logo_path text,
  primary_colour text,
  secondary_colour text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tenant_comms_config (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  from_name text,
  email_footer text,
  sms_footer text,
  regulatory_footer text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants (id) ON DELETE CASCADE,
  feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  diary_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  telephony_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- MFA enforcement flags (all false — MFA not enabled/enforced in G1)
CREATE TABLE IF NOT EXISTS public.platform_mfa_policy (
  role_key text PRIMARY KEY,
  mfa_required boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_mfa_policy_role_key_check CHECK (
    role_key = ANY (
      ARRAY[
        'super_owner',
        'super_admin',
        'owner',
        'supervisor',
        'general',
        'adviser',
        'customer'
      ]
    )
  )
);

COMMENT ON TABLE public.platform_mfa_policy IS
  'Per-role MFA mandatory flags. G1 seeds all false — do not enforce until Gate G10.';

CREATE TABLE IF NOT EXISTS public.security_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  acting_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  subject_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES public.tenants (id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_audit_events_created_at_idx
  ON public.security_audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS security_audit_events_type_idx
  ON public.security_audit_events (event_type);

COMMENT ON TABLE public.security_audit_events IS
  'Security audit log. Never store TOTP secrets, passwords, or credentials in metadata.';

-- ---------------------------------------------------------------------------
-- Seed tenants 001 / 002 + empty config shells (NOT business-data backfill)
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (
  company_code, slug, company_name, trading_name, status, legal_name
)
VALUES
  (
    '001',
    'mortgageeasy',
    'Mortgage Easy',
    'Mortgage Easy',
    'active',
    'Mortgage Easy'
  ),
  (
    '002',
    'trentvalleyfs',
    'Trent Valley Financial Services',
    'Trent Valley Financial Services',
    'active',
    'Trent Valley Financial Services'
  )
ON CONFLICT (company_code) DO NOTHING;

INSERT INTO public.tenant_branding (tenant_id)
SELECT id FROM public.tenants WHERE company_code IN ('001', '002')
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO public.tenant_comms_config (tenant_id)
SELECT id FROM public.tenants WHERE company_code IN ('001', '002')
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO public.tenant_settings (tenant_id)
SELECT id FROM public.tenants WHERE company_code IN ('001', '002')
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO public.platform_mfa_policy (role_key, mfa_required)
VALUES
  ('super_owner', false),
  ('super_admin', false),
  ('owner', false),
  ('supervisor', false),
  ('general', false),
  ('adviser', false),
  ('customer', false)
ON CONFLICT (role_key) DO NOTHING;

-- Explicitly ensure no Super Owner conversion in G1 (no-op guard comment).
-- platform_roles intentionally left empty.

-- ---------------------------------------------------------------------------
-- Authorisation helpers (available for later gates; existing RLS unchanged)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_super_owner(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_roles pr
    WHERE pr.user_id = p_user_id
      AND pr.role = 'super_owner'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_roles pr
    WHERE pr.user_id = p_user_id
      AND pr.role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_super_admin_tenant_access(
  p_user_id uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin(p_user_id)
    AND EXISTS (
      SELECT 1
      FROM public.super_admin_tenant_access g
      WHERE g.user_id = p_user_id
        AND g.tenant_id = p_tenant_id
    );
$$;

CREATE OR REPLACE FUNCTION public.has_tenant_membership(
  p_user_id uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_memberships tm
    WHERE tm.user_id = p_user_id
      AND tm.tenant_id = p_tenant_id
      AND tm.active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_tenant(
  p_user_id uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_super_owner(p_user_id)
    OR public.has_super_admin_tenant_access(p_user_id, p_tenant_id)
    OR public.has_tenant_membership(p_user_id, p_tenant_id);
$$;

CREATE OR REPLACE FUNCTION public.mfa_required_for_role(p_role_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT mfa_required FROM public.platform_mfa_policy WHERE role_key = p_role_key),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.is_super_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_super_admin_tenant_access(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_tenant_membership(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_tenant(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mfa_required_for_role(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_super_owner(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_super_admin_tenant_access(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_tenant_membership(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_tenant(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mfa_required_for_role(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS on NEW tables only (deny-by-default for authenticated/anon).
-- Existing table policies are intentionally untouched (RLS cutover = Gate G5).
-- service_role bypasses RLS.
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.super_admin_tenant_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_comms_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_mfa_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_audit_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_roles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.super_admin_tenant_access TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_memberships TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_branding TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_comms_config TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_mfa_policy TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_audit_events TO service_role;

-- No authenticated/anon policies on new tables in G1 — app continues on legacy paths.


-- >>> 20260917180110_gate_g1_nullable_tenant_id_columns.sql
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


-- >>> 20260917182141_gate_g1a_classification_and_support.sql
-- Gate G1A part 1: classification, Super Admin access_level, support/emergency grants.
-- See also gate_g1a_features_and_helpers.

DO $$ BEGIN
  CREATE TYPE public.tenant_type AS ENUM ('GROUP', 'EXTERNAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS tenant_type public.tenant_type;

UPDATE public.tenants
SET tenant_type = 'GROUP'
WHERE company_code IN ('001', '002')
  AND (tenant_type IS DISTINCT FROM 'GROUP');

ALTER TABLE public.tenants
  ALTER COLUMN tenant_type SET DEFAULT 'EXTERNAL';

UPDATE public.tenants SET tenant_type = 'GROUP' WHERE tenant_type IS NULL;

ALTER TABLE public.tenants
  ALTER COLUMN tenant_type SET NOT NULL;

COMMENT ON COLUMN public.tenants.tenant_type IS
  'GROUP = Mortgage Hub group companies (routine Super Owner data access). EXTERNAL = licensed firms (data wall). Orthogonal to Features & Journeys.';

DO $$ BEGIN
  CREATE TYPE public.super_admin_access_level AS ENUM (
    'platform_admin',
    'data_read',
    'data_write',
    'full'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.super_admin_tenant_access
  ADD COLUMN IF NOT EXISTS access_level public.super_admin_access_level NOT NULL DEFAULT 'platform_admin';

COMMENT ON COLUMN public.super_admin_tenant_access.access_level IS
  'platform_admin = administer only. data_read/data_write/full = business-data scopes. EXTERNAL grants should default to platform_admin.';

DO $$ BEGIN
  CREATE TYPE public.support_access_scope AS ENUM (
    'read_metadata',
    'read_cases',
    'read_comms',
    'read_finance',
    'write_limited',
    'full_read',
    'full_write'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.tenant_support_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  grantee_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  reason text NOT NULL,
  requested_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  scope public.support_access_scope NOT NULL DEFAULT 'read_metadata',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_support_access_expires_after_start CHECK (expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS tenant_support_access_grantee_idx
  ON public.tenant_support_access_grants (grantee_user_id);
CREATE INDEX IF NOT EXISTS tenant_support_access_tenant_idx
  ON public.tenant_support_access_grants (tenant_id);
CREATE INDEX IF NOT EXISTS tenant_support_access_active_idx
  ON public.tenant_support_access_grants (tenant_id, grantee_user_id)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.tenant_support_access_grants IS
  'Time-limited support data access. No permanent bypass. Empty in G1A.';

CREATE TABLE IF NOT EXISTS public.tenant_emergency_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  grantee_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  reason text NOT NULL,
  authorised_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  second_authorised_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  scope public.support_access_scope NOT NULL DEFAULT 'full_read',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_emergency_access_expires_after_start CHECK (expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS tenant_emergency_access_grantee_idx
  ON public.tenant_emergency_access_grants (grantee_user_id);
CREATE INDEX IF NOT EXISTS tenant_emergency_access_tenant_idx
  ON public.tenant_emergency_access_grants (tenant_id);

COMMENT ON TABLE public.tenant_emergency_access_grants IS
  'Exceptional break-glass data access. Distinct from support grants. Empty in G1A.';

ALTER TABLE public.tenant_support_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_emergency_access_grants ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_support_access_grants TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_emergency_access_grants TO service_role;


-- >>> 20260917182412_gate_g1a_features_and_helpers.sql
-- Gate G1A part 2: feature catalogue, tenant_features, access/feature helpers.

-- ---------------------------------------------------------------------------
-- E/F. Feature catalogue + tenant_features
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.feature_category AS ENUM (
    'customer_journey',
    'public_access',
    'staff_capability',
    'comms',
    'integration'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.feature_state AS ENUM (
    'disabled',
    'enabled',
    'entitlement_blocked',
    'rollout_hidden'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.feature_catalogue (
  feature_key text PRIMARY KEY,
  name text NOT NULL,
  description text,
  category public.feature_category NOT NULL,
  default_enabled boolean NOT NULL DEFAULT false,
  supports_config boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.feature_catalogue IS
  'Platform feature catalogue. Canonical source with tenant_features — not tenants.feature_flags.';

CREATE TABLE IF NOT EXISTS public.tenant_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  feature_key text NOT NULL REFERENCES public.feature_catalogue (feature_key),
  state public.feature_state NOT NULL DEFAULT 'disabled',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  entitlement jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  CONSTRAINT tenant_features_unique UNIQUE (tenant_id, feature_key)
);

CREATE INDEX IF NOT EXISTS tenant_features_tenant_idx
  ON public.tenant_features (tenant_id);
CREATE INDEX IF NOT EXISTS tenant_features_key_idx
  ON public.tenant_features (feature_key);

COMMENT ON TABLE public.tenant_features IS
  'Per-tenant feature state. Canonical over tenant_settings.feature_flags (temporary bridge — retire when app reads this table).';

ALTER TABLE public.feature_catalogue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_features ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.feature_catalogue TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_features TO service_role;

-- Seed catalogue (defaults: false unless clearly always-on platform hygiene)
INSERT INTO public.feature_catalogue (
  feature_key, name, description, category, default_enabled, supports_config, sort_order
) VALUES
  ('susan_ai_journey', 'Susan AI journey', 'Spoken avatar fact-find (Susan)', 'customer_journey', false, true, 10),
  ('susan_chat_journey', 'Susan typed chat', 'Typed chat fact-find with Susan', 'customer_journey', false, true, 20),
  ('appointment_booking', 'Appointment booking', 'Public and Hub appointment booking', 'customer_journey', false, true, 30),
  ('request_callback', 'Request a callback', 'Customer callback requests', 'customer_journey', false, false, 40),
  ('external_website_links', 'External / return website links', 'Tenant website_url return links', 'public_access', false, true, 50),
  ('introducer_journey', 'Introducer journey', 'Introducer portal, /go, /book', 'customer_journey', false, true, 60),
  ('refer_a_friend', 'Refer a Friend', 'RAF links and marketing', 'customer_journey', false, true, 70),
  ('customer_portal', 'Customer portal / login', 'Customer Hub login and home', 'customer_journey', false, false, 80),
  ('telephone_voice', 'Telephone / voice journeys', 'Softphone, Twilio voice, voicemail', 'integration', false, true, 90),
  ('public_hub_landing', 'Public Hub landing', 'Public / landing CTAs', 'public_access', false, false, 100),
  ('customer_case_hub', 'Customer case hub', 'Customer sessions/cases views', 'customer_journey', false, false, 110),
  ('staff_diary', 'Staff diary', 'Diary and appointments for staff', 'staff_capability', false, true, 120),
  ('staff_crm', 'Staff CRM', 'Customers and contacts CRM', 'staff_capability', false, false, 130),
  ('staff_cases', 'Staff cases', 'Staff cases pipeline', 'staff_capability', false, false, 140),
  ('staff_finance', 'Staff finance', 'Finance and commissions', 'staff_capability', false, false, 150),
  ('staff_marketing_scripts', 'Marketing scripts', 'Comms templates / scripts', 'comms', false, true, 160),
  ('journey_analytics', 'Journey analytics', 'Management journey analytics', 'staff_capability', false, false, 170),
  ('view_as', 'View-as modes', 'Advisor/introducer/customer view-as', 'staff_capability', false, false, 180),
  ('teams_calendar', 'Teams calendar sync', 'Microsoft Teams calendar OAuth', 'integration', false, true, 190),
  ('mortgage_calculator_public', 'Public mortgage calculator', 'Public calculator APIs', 'public_access', false, false, 200),
  ('introducer_calculator_lead', 'Introducer calculator lead', 'Calculator lead capture API', 'customer_journey', false, false, 210),
  ('password_recovery', 'Password recovery', 'Password reset flows', 'public_access', true, false, 220),
  ('sms_notifications', 'SMS notifications', 'Outbound/inbound SMS', 'comms', false, true, 230),
  ('relationship_pipeline', 'Relationship pipeline', 'Renewals / relationship', 'staff_capability', false, false, 240)
ON CONFLICT (feature_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  default_enabled = EXCLUDED.default_enabled,
  supports_config = EXCLUDED.supports_config,
  sort_order = EXCLUDED.sort_order,
  active = true;

-- Only explicit Susan rows for 001 / 002 (do not invent other tenant feature rows)
INSERT INTO public.tenant_features (tenant_id, feature_key, state)
SELECT t.id, 'susan_ai_journey', 'enabled'::public.feature_state
FROM public.tenants t
WHERE t.company_code = '001'
ON CONFLICT (tenant_id, feature_key) DO UPDATE SET
  state = 'enabled',
  updated_at = now();

INSERT INTO public.tenant_features (tenant_id, feature_key, state)
SELECT t.id, 'susan_ai_journey', 'disabled'::public.feature_state
FROM public.tenants t
WHERE t.company_code = '002'
ON CONFLICT (tenant_id, feature_key) DO UPDATE SET
  state = 'disabled',
  updated_at = now();

-- Document temporary bridge on tenant_settings
COMMENT ON COLUMN public.tenant_settings.feature_flags IS
  'TEMPORARY bridge only. Canonical feature entitlement is feature_catalogue + tenant_features. Retire when app/server resolves features exclusively via tenant_features (pre-feature-enforcement gate). Do not write new long-term flags here.';

-- ---------------------------------------------------------------------------
-- B/G. Administration vs data-access helpers + feature helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.super_admin_grant_allows_admin(
  p_access_level public.super_admin_access_level
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_access_level IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.super_admin_grant_allows_data(
  p_access_level public.super_admin_access_level
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_access_level IN (
    'data_read'::public.super_admin_access_level,
    'data_write'::public.super_admin_access_level,
    'full'::public.super_admin_access_level
  );
$$;

CREATE OR REPLACE FUNCTION public.has_active_support_data_access(
  p_user_id uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_support_access_grants g
    WHERE g.grantee_user_id = p_user_id
      AND g.tenant_id = p_tenant_id
      AND g.revoked_at IS NULL
      AND now() >= g.starts_at
      AND now() < g.expires_at
  )
  OR EXISTS (
    SELECT 1
    FROM public.tenant_emergency_access_grants g
    WHERE g.grantee_user_id = p_user_id
      AND g.tenant_id = p_tenant_id
      AND g.revoked_at IS NULL
      AND now() >= g.starts_at
      AND now() < g.expires_at
  );
$$;

CREATE OR REPLACE FUNCTION public.can_administer_tenant(
  p_user_id uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_super_owner(p_user_id)
    OR (
      public.is_super_admin(p_user_id)
      AND EXISTS (
        SELECT 1
        FROM public.super_admin_tenant_access g
        WHERE g.user_id = p_user_id
          AND g.tenant_id = p_tenant_id
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
    );
$$;

CREATE OR REPLACE FUNCTION public.can_access_tenant_data(
  p_user_id uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Tenant staff/customers with membership
    public.has_tenant_membership(p_user_id, p_tenant_id)
    -- Super Owner: GROUP only (not automatic EXTERNAL data)
    OR (
      public.is_super_owner(p_user_id)
      AND EXISTS (
        SELECT 1
        FROM public.tenants t
        WHERE t.id = p_tenant_id
          AND t.tenant_type = 'GROUP'::public.tenant_type
      )
    )
    -- Super Admin with explicit data-scoped grant
    OR (
      public.is_super_admin(p_user_id)
      AND EXISTS (
        SELECT 1
        FROM public.super_admin_tenant_access g
        WHERE g.user_id = p_user_id
          AND g.tenant_id = p_tenant_id
          AND public.super_admin_grant_allows_data(g.access_level)
      )
    )
    -- Explicit time-limited support / emergency
    OR public.has_active_support_data_access(p_user_id, p_tenant_id);
$$;

-- Retire coarse helper: alias to data-access only (never implies EXTERNAL Super Owner data)
CREATE OR REPLACE FUNCTION public.can_access_tenant(
  p_user_id uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_access_tenant_data(p_user_id, p_tenant_id);
$$;

COMMENT ON FUNCTION public.can_access_tenant(uuid, uuid) IS
  'DEPRECATED alias of can_access_tenant_data. Do not use for platform administration. Prefer can_administer_tenant / can_access_tenant_data.';

CREATE OR REPLACE FUNCTION public.is_tenant_feature_enabled(
  p_tenant_id uuid,
  p_feature_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT tf.state = 'enabled'::public.feature_state
      FROM public.tenant_features tf
      WHERE tf.tenant_id = p_tenant_id
        AND tf.feature_key = p_feature_key
    ),
    (
      SELECT fc.default_enabled
      FROM public.feature_catalogue fc
      WHERE fc.feature_key = p_feature_key
        AND fc.active = true
    ),
    false
  );
$$;

-- Scaffolding for later app gates: raises when not enabled (not wired to routes in G1A)
CREATE OR REPLACE FUNCTION public.require_tenant_feature(
  p_tenant_id uuid,
  p_feature_key text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_tenant_feature_enabled(p_tenant_id, p_feature_key) THEN
    RAISE EXCEPTION 'feature_not_enabled:%', p_feature_key
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.can_administer_tenant(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_tenant_data(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_tenant(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_active_support_data_access(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_tenant_feature_enabled(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.require_tenant_feature(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.super_admin_grant_allows_admin(public.super_admin_access_level) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.super_admin_grant_allows_data(public.super_admin_access_level) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_administer_tenant(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_tenant_data(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_tenant(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_active_support_data_access(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_tenant_feature_enabled(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.require_tenant_feature(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.super_admin_grant_allows_admin(public.super_admin_access_level) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.super_admin_grant_allows_data(public.super_admin_access_level) TO authenticated, service_role;

