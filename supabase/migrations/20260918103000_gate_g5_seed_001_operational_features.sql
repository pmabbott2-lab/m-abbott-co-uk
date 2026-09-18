-- Gate G5: seed Mortgage Easy (001) operational feature rows so enforcement
-- does not disable live 001 behaviour when catalogue.default_enabled = false.
-- Trent Valley (002) is NOT mass-enabled — only existing susan_ai_journey=disabled remains.
-- password_recovery stays on catalogue default_enabled=true (no forced row required).

INSERT INTO public.tenant_features (tenant_id, feature_key, state)
SELECT t.id, fc.feature_key, 'enabled'::public.feature_state
FROM public.tenants t
CROSS JOIN public.feature_catalogue fc
WHERE t.company_code = '001'
  AND fc.active = true
  AND fc.feature_key <> 'password_recovery'
ON CONFLICT (tenant_id, feature_key) DO NOTHING;

-- Ensure Susan remains enabled for 001 (idempotent)
UPDATE public.tenant_features tf
SET state = 'enabled'::public.feature_state,
    updated_at = now()
FROM public.tenants t
WHERE tf.tenant_id = t.id
  AND t.company_code = '001'
  AND tf.feature_key = 'susan_ai_journey';

-- Ensure Susan remains disabled for 002
UPDATE public.tenant_features tf
SET state = 'disabled'::public.feature_state,
    updated_at = now()
FROM public.tenants t
WHERE tf.tenant_id = t.id
  AND t.company_code = '002'
  AND tf.feature_key = 'susan_ai_journey';

COMMENT ON TABLE public.tenant_features IS
  'Per-tenant feature state. G5: 001 seeded operational enabled; 002 susan disabled; defaults apply when no row.';
