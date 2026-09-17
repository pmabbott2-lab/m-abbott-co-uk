-- Gate G2: tenant ownership backfill + 001 memberships for retained accounts.
-- Additive data migration. Does NOT:
--   - convert Super Owner / enable MFA
--   - change Twilio resources
--   - make tenant_id NOT NULL
--   - replace legacy RLS policies
--   - create EXTERNAL tenants or fabricate 002 staff
--
-- Security identity remains tenants.id (UUID). company_code/slug are not authz.

-- ---------------------------------------------------------------------------
-- 0. Remove obsolete unused staff invitations (no tokens referenced)
--    - 13@test.co.uk admin invite: expired, unused; user already exists
--    - advisor invite with NULL email: incomplete/unused demo row
-- ---------------------------------------------------------------------------
DELETE FROM public.staff_invitations
WHERE used_at IS NULL
  AND (
    (lower(email) = '13@test.co.uk' AND expires_at < now())
    OR (email IS NULL AND role = 'advisor'::public.app_role AND used_by IS NULL)
  );

-- ---------------------------------------------------------------------------
-- 1. Tenant 001 memberships for retained Auth users
--    Maps legacy app roles / admin_profiles into tenant_member_role.
--    Does NOT insert platform_roles. Owner remains tenant-level owner.
-- ---------------------------------------------------------------------------
WITH t001 AS (
  SELECT id AS tenant_id FROM public.tenants WHERE company_code = '001' LIMIT 1
),
owner_user AS (
  SELECT id AS user_id FROM auth.users WHERE lower(email) = 'pmabbott2@aol.com' LIMIT 1
),
seed(email, role) AS (
  VALUES
    ('pmabbott2@aol.com', 'owner'::public.tenant_member_role),
    ('pmabbott2@aol.com', 'adviser'::public.tenant_member_role),
    ('pmabbott2@aol.com', 'introducer'::public.tenant_member_role),
    ('1@test.co.uk', 'introducer'::public.tenant_member_role),
    ('1@test.co.uk', 'customer'::public.tenant_member_role),
    ('4@test.co.uk', 'adviser'::public.tenant_member_role),
    ('4@test.co.uk', 'customer'::public.tenant_member_role),
    ('5@test.co.uk', 'adviser'::public.tenant_member_role),
    ('5@test.co.uk', 'customer'::public.tenant_member_role),
    ('6@test.co.uk', 'customer'::public.tenant_member_role),
    ('13@test.co.uk', 'general'::public.tenant_member_role),
    ('13@test.co.uk', 'customer'::public.tenant_member_role)
)
INSERT INTO public.tenant_memberships (user_id, tenant_id, role, active, created_by)
SELECT u.id, t001.tenant_id, seed.role, true, owner_user.user_id
FROM seed
CROSS JOIN t001
CROSS JOIN owner_user
JOIN auth.users u ON lower(u.email) = seed.email
ON CONFLICT (user_id, tenant_id, role) DO UPDATE
SET active = EXCLUDED.active;

-- Guard: refuse if 001 missing or retained users incomplete
DO $$
DECLARE
  v_tenant uuid;
  v_members int;
  v_users int;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE company_code = '001';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'G2 STOP: tenant 001 not found';
  END IF;
  SELECT count(*) INTO v_users FROM auth.users
  WHERE lower(email) IN (
    'pmabbott2@aol.com','1@test.co.uk','4@test.co.uk','5@test.co.uk','6@test.co.uk','13@test.co.uk'
  );
  IF v_users <> 6 THEN
    RAISE EXCEPTION 'G2 STOP: expected 6 retained auth users, found %', v_users;
  END IF;
  SELECT count(*) INTO v_members FROM public.tenant_memberships WHERE tenant_id = v_tenant AND active;
  IF v_members < 12 THEN
    RAISE EXCEPTION 'G2 STOP: expected >=12 active 001 memberships, found %', v_members;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_memberships tm JOIN public.tenants t ON t.id = tm.tenant_id WHERE t.company_code = '002') THEN
    RAISE EXCEPTION 'G2 STOP: unexpected memberships on tenant 002';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Backfill tenant_id = 001 for confidently Mortgage Easy structural rows
--    profiles intentionally LEFT NULL (auth identity ≠ tenant membership).
--    communication_templates LEFT NULL (platform template catalogue).
--    lender_remortgage_policies LEFT NULL (shared lender reference).
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

-- Any remaining staff_invitations (should be 0 after delete) — if any left, bind to 001 only when created by 001 owner
UPDATE public.staff_invitations si
SET tenant_id = t.id
FROM public.tenants t
WHERE t.company_code = '001'
  AND si.tenant_id IS NULL
  AND si.created_by IN (SELECT id FROM auth.users WHERE lower(email) = 'pmabbott2@aol.com');

-- ---------------------------------------------------------------------------
-- 3. Safety assertions
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_001 uuid;
  v_002 uuid;
BEGIN
  SELECT id INTO v_001 FROM public.tenants WHERE company_code = '001';
  SELECT id INTO v_002 FROM public.tenants WHERE company_code = '002';

  IF EXISTS (SELECT 1 FROM public.telephony_numbers WHERE tenant_id = v_002) THEN
    RAISE EXCEPTION 'G2 STOP: 002 must not receive telephony numbers';
  END IF;
  IF EXISTS (SELECT 1 FROM public.platform_roles) THEN
    RAISE EXCEPTION 'G2 STOP: platform_roles must remain empty';
  END IF;
  IF (SELECT count(*) FROM public.tenants WHERE tenant_type::text = 'EXTERNAL') > 0 THEN
    RAISE EXCEPTION 'G2 STOP: unexpected EXTERNAL tenant';
  END IF;

  -- Confidently tenant-owned tables must have no NULL tenant_id after backfill
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
    RAISE EXCEPTION 'G2 STOP: unexpected NULL tenant_id on backfilled structural tables';
  END IF;
END $$;

COMMENT ON TABLE public.tenant_memberships IS
  'Staff/customer membership of a company. G2 seeded 001 retained-account memberships. Auth identity (profiles) remains multi-tenant capable; membership is the tenant binding.';
