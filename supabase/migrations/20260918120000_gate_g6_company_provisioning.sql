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
