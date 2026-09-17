-- Gate G4: seed safe public branding + website URLs for known tenants.
-- Additive only. Does not weaken RLS. Does not invent FCA numbers.

UPDATE public.tenant_branding b
SET
  logo_path = 'mortgageeasy/logo.png',
  primary_colour = '#1a2f4f',
  secondary_colour = '#3d9e47',
  updated_at = now()
FROM public.tenants t
WHERE b.tenant_id = t.id
  AND t.company_code = '001';

UPDATE public.tenant_branding b
SET
  logo_path = 'trentvalleyfs/logo.png',
  primary_colour = '#0b1524',
  secondary_colour = '#6b93b0',
  updated_at = now()
FROM public.tenants t
WHERE b.tenant_id = t.id
  AND t.company_code = '002';

-- Marketing mock sites are same-origin under these paths when the proxy serves them.
-- Prefer relative website URLs so we do not invent external domains.
UPDATE public.tenants
SET
  website_url = '/mortgageeasy/',
  trading_name = COALESCE(NULLIF(trading_name, ''), 'Mortgage Easy'),
  updated_at = now()
WHERE company_code = '001';

UPDATE public.tenants
SET
  website_url = NULL,
  trading_name = COALESCE(NULLIF(trading_name, ''), 'Trent Valley Financial Services'),
  updated_at = now()
WHERE company_code = '002';

COMMENT ON COLUMN public.tenant_branding.logo_path IS
  'Public asset path under /tenant-branding/ or absolute URL. Never a secret.';
