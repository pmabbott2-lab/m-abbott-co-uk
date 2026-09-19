-- G6B STAGING-ONLY — G2 structural bootstrap for a clean project.
-- NOT a production migration. Historical production file remains immutable:
--   supabase/migrations/20260917193000_gate_g2_tenant_ownership_and_memberships.sql
--
-- Reproduces G2 schema/tenant-ownership state without:
--   - production Auth identity assertions
--   - production email identities
--   - production membership seed
--   - production customer/business data
--
-- Impossible against production: refuse if Auth users exist or production emails exist.

DO $$
DECLARE
  v_users int;
BEGIN
  SELECT count(*) INTO v_users FROM auth.users;
  IF v_users <> 0 THEN
    RAISE EXCEPTION 'G6B STAGING G2 STOP: expected 0 auth users on clean staging, found %', v_users;
  END IF;
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE lower(email) IN (
      'pmabbott2@aol.com',
      '1@test.co.uk',
      '4@test.co.uk',
      '5@test.co.uk',
      '6@test.co.uk',
      '13@test.co.uk'
    )
  ) THEN
    RAISE EXCEPTION 'G6B STAGING G2 STOP: production identities present — refusing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_memberships) THEN
    RAISE EXCEPTION 'G6B STAGING G2 STOP: unexpected memberships on clean staging';
  END IF;
  IF EXISTS (SELECT 1 FROM public.platform_roles) THEN
    RAISE EXCEPTION 'G6B STAGING G2 STOP: platform_roles must remain empty';
  END IF;
END $$;

-- Harmless on empty staging (no unused production invites).
DELETE FROM public.staff_invitations
WHERE used_at IS NULL
  AND (
    (lower(email) = '13@test.co.uk' AND expires_at < now())
    OR (email IS NULL AND role = 'advisor'::public.app_role AND used_by IS NULL)
  );

-- Tenant 001 memberships are NOT seeded here. Synthetic identities come later.

-- ---------------------------------------------------------------------------
-- Backfill tenant_id = 001 for confidently Mortgage Easy structural rows
-- profiles intentionally LEFT NULL (auth identity ≠ tenant membership).
-- communication_templates LEFT NULL (platform template catalogue).
-- lender_remortgage_policies LEFT NULL (shared lender reference).
-- ---------------------------------------------------------------------------
UPDATE public.admin_profiles ap
SET tenant_id = t.id
FROM public.tenants t
WHERE t.company_code = '001' AND ap.tenant_id IS NULL;

UPDATE public.admin_permissions p
SET tenant_id = t.id
FROM public.tenants t
WHERE t.company_code = '001' AND p.tenant_id IS NULL;

UPDATE public.advisor_profiles ap
SET tenant_id = t.id
FROM public.tenants t
WHERE t.company_code = '001' AND ap.tenant_id IS NULL;

UPDATE public.advisor_availability a
SET tenant_id = t.id
FROM public.tenants t
WHERE t.company_code = '001' AND a.tenant_id IS NULL;

UPDATE public.advisor_telephony at
SET tenant_id = t.id
FROM public.tenants t
WHERE t.company_code = '001' AND at.tenant_id IS NULL;

UPDATE public.introducers i
SET tenant_id = t.id
FROM public.tenants t
WHERE t.company_code = '001' AND i.tenant_id IS NULL;

UPDATE public.commission_rates cr
SET tenant_id = t.id
FROM public.tenants t
WHERE t.company_code = '001' AND cr.tenant_id IS NULL;

UPDATE public.telephony_numbers n
SET tenant_id = t.id
FROM public.tenants t
WHERE t.company_code = '001' AND n.tenant_id IS NULL;

UPDATE public.telephony_routing_settings s
SET tenant_id = t.id
FROM public.tenants t
WHERE t.company_code = '001' AND s.tenant_id IS NULL;

UPDATE public.communication_settings cs
SET tenant_id = t.id
FROM public.tenants t
WHERE t.company_code = '001' AND cs.tenant_id IS NULL;

UPDATE public.finance_settings fs
SET tenant_id = t.id
FROM public.tenants t
WHERE t.company_code = '001' AND fs.tenant_id IS NULL;

-- ---------------------------------------------------------------------------
-- Safety assertions (same structural invariants as production G2, minus identity)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_001 uuid;
  v_002 uuid;
BEGIN
  SELECT id INTO v_001 FROM public.tenants WHERE company_code = '001';
  SELECT id INTO v_002 FROM public.tenants WHERE company_code = '002';

  IF v_001 IS NULL OR v_002 IS NULL THEN
    RAISE EXCEPTION 'G6B STAGING G2 STOP: tenants 001 and 002 must exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.telephony_numbers WHERE tenant_id = v_002) THEN
    RAISE EXCEPTION 'G6B STAGING G2 STOP: 002 must not receive telephony numbers';
  END IF;
  IF EXISTS (SELECT 1 FROM public.platform_roles) THEN
    RAISE EXCEPTION 'G6B STAGING G2 STOP: platform_roles must remain empty';
  END IF;
  IF (SELECT count(*) FROM public.tenants WHERE tenant_type::text = 'EXTERNAL') > 0 THEN
    RAISE EXCEPTION 'G6B STAGING G2 STOP: unexpected EXTERNAL tenant';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_memberships) THEN
    RAISE EXCEPTION 'G6B STAGING G2 STOP: memberships must remain 0 until synthetic seed';
  END IF;

  IF EXISTS (SELECT 1 FROM public.admin_profiles WHERE tenant_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.admin_permissions WHERE tenant_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.advisor_profiles WHERE tenant_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.advisor_availability WHERE tenant_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.advisor_telephony WHERE tenant_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.introducers WHERE tenant_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.commission_rates WHERE tenant_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.telephony_numbers WHERE tenant_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.telephony_routing_settings WHERE tenant_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.communication_settings WHERE tenant_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.finance_settings WHERE tenant_id IS NULL)
  THEN
    RAISE EXCEPTION 'G6B STAGING G2 STOP: unexpected NULL tenant_id on backfilled structural tables';
  END IF;
END $$;

COMMENT ON TABLE public.tenant_memberships IS
  'Staff/customer membership of a company. Auth identity (profiles) remains multi-tenant capable; membership is the tenant binding. G6B clean staging leaves this empty until synthetic seed.';
