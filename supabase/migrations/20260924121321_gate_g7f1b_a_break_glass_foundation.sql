-- G7F-1B-A (canonical split matching staging MCP history)
-- Staging version/name parity: 20260924121321_gate_g7f1b_a_break_glass_foundation
-- Gate G7F-1B-A: break-glass Super Owner classification foundation (schema only).
-- Does NOT create Auth users, grant authority by itself, enable MFA, or write audit events.
-- Authority remains platform_roles.role = super_owner only.
-- Classification is keyed only by auth.users.id (never email).

-- ---------------------------------------------------------------------------
-- 1. Registry (classification / policy metadata — not a grant)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_break_glass_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  deactivated_at timestamptz,
  deactivated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  replaced_at timestamptz,
  replaced_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT platform_break_glass_identities_active_state_chk CHECK (
    (
      active = true
      AND deactivated_at IS NULL
      AND replaced_at IS NULL
    )
    OR (
      active = false
      AND deactivated_at IS NOT NULL
    )
  ),
  CONSTRAINT platform_break_glass_identities_reason_len_chk CHECK (
    reason IS NULL OR char_length(reason) <= 500
  )
);

COMMENT ON TABLE public.platform_break_glass_identities IS
  'G7F-1B-A: break-glass classification metadata only. Does NOT grant Super Owner authority. Authority requires platform_roles.role = super_owner for the same user_id.';

COMMENT ON COLUMN public.platform_break_glass_identities.user_id IS
  'Auth UUID of the classified identity. Never use email for authority or classification.';

COMMENT ON COLUMN public.platform_break_glass_identities.metadata IS
  'Non-secret operational metadata only. Never store passwords, MFA secrets, recovery codes, or tokens.';

CREATE INDEX IF NOT EXISTS platform_break_glass_identities_user_idx
  ON public.platform_break_glass_identities (user_id);

CREATE INDEX IF NOT EXISTS platform_break_glass_identities_active_idx
  ON public.platform_break_glass_identities (active)
  WHERE active;

-- Exactly one active break-glass identity (concurrency-safe unique index).
CREATE UNIQUE INDEX IF NOT EXISTS platform_break_glass_identities_one_active_uidx
  ON public.platform_break_glass_identities ((true))
  WHERE active;

-- A given user may have at most one active classification row.
CREATE UNIQUE INDEX IF NOT EXISTS platform_break_glass_identities_user_active_uidx
  ON public.platform_break_glass_identities (user_id)
  WHERE active;
