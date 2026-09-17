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
