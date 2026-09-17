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
