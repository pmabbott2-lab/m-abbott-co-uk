-- ============================================================================
-- Staff soft-delete (recoverable bin) + invite-link registration
-- Safe / re-runnable: guarded with IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Soft-delete (recoverable bin) for advisors & introducers
-- ---------------------------------------------------------------------------
-- An advisor is "binned" by removing their `advisor` role and stamping
-- advisor_profiles.deleted_at. The row + code are KEPT so a restore re-grants
-- the role and preserves the same advisor code.
ALTER TABLE public.advisor_profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- An introducer is "binned" by removing their `introducer` role, setting
-- introducers.active = false AND stamping introducers.deleted_at. deleted_at
-- distinguishes a binned introducer from one that is merely inactive. A restore
-- clears deleted_at, sets active = true and re-grants the role.
ALTER TABLE public.introducers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 2) Staff invitations (invite-link registration for advisors & introducers)
-- ---------------------------------------------------------------------------
-- An admin creates an invite encoding the intended role (advisor|introducer)
-- and, for introducers, optional company linkage (create a new company vs join
-- an existing 4-digit company_code). The public /register route resolves the
-- invite by its secret token via a service-role server function (NOT client
-- RLS) and consumes it on successful signup.
CREATE TABLE IF NOT EXISTS public.staff_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  role public.app_role NOT NULL,
  email TEXT,
  company_code TEXT,
  company_name TEXT,
  create_company BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  used_at TIMESTAMPTZ,
  used_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT staff_invitations_role_chk CHECK (role IN ('advisor','introducer')),
  CONSTRAINT staff_invitations_company_code_format
    CHECK (company_code IS NULL OR company_code ~ '^[0-9]{4}$')
);
GRANT SELECT, INSERT, UPDATE ON public.staff_invitations TO authenticated;
GRANT ALL ON public.staff_invitations TO service_role;
ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;

-- Only advisors/admins can see or manage invitations from the client. The
-- public registration route never reads this table directly — it goes through a
-- service-role server function that resolves the token.
DROP POLICY IF EXISTS "Staff manage invitations" ON public.staff_invitations;
CREATE POLICY "Staff manage invitations" ON public.staff_invitations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'advisor') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'advisor') OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_staff_invitations_token ON public.staff_invitations (token);
CREATE INDEX IF NOT EXISTS idx_staff_invitations_open ON public.staff_invitations (created_at DESC) WHERE used_at IS NULL;
