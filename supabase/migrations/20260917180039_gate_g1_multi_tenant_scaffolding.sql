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
