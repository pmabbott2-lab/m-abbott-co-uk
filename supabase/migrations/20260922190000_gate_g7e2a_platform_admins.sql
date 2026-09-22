-- Gate G7E-2A: platform administrator invitations + last Super Owner concurrency lock.
-- Does NOT create platform_roles, Auth users, or Super Admin tenant grants.

-- ---------------------------------------------------------------------------
-- platform_invitations (hashed token; role granted only on acceptance)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  platform_role public.platform_role NOT NULL,
  invited_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  revoked_at timestamptz,
  token_hash text NOT NULL,
  CONSTRAINT platform_invitations_email_lower_chk
    CHECK (email = lower(email)),
  CONSTRAINT platform_invitations_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT platform_invitations_role_chk
    CHECK (platform_role IN (
      'super_owner'::public.platform_role,
      'super_admin'::public.platform_role
    )),
  CONSTRAINT platform_invitations_accept_xor_revoke_chk
    CHECK (
      accepted_at IS NULL
      OR revoked_at IS NULL
    )
);

CREATE INDEX IF NOT EXISTS platform_invitations_email_idx
  ON public.platform_invitations (email);
CREATE INDEX IF NOT EXISTS platform_invitations_pending_idx
  ON public.platform_invitations (created_at DESC)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE public.platform_invitations IS
  'G7E-2A: Super Owner invitations for platform_roles. Token stored hashed only. No authority until accepted.';

ALTER TABLE public.platform_invitations ENABLE ROW LEVEL SECURITY;

-- No authenticated/anon policies: clients cannot read or write invitations.
REVOKE ALL ON public.platform_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_invitations TO service_role;

-- ---------------------------------------------------------------------------
-- Atomic claim: validates hash, identity email, expiry/revoke/replay; inserts role
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_platform_invitation(
  p_token_hash text,
  p_user_id uuid,
  p_email text
)
RETURNS TABLE (
  invitation_id uuid,
  granted_role public.platform_role,
  first_name text,
  last_name text,
  invite_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.platform_invitations%ROWTYPE;
  v_email text := lower(trim(p_email));
BEGIN
  IF p_token_hash IS NULL OR length(trim(p_token_hash)) < 32 THEN
    RAISE EXCEPTION 'platform_invite_invalid'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF p_user_id IS NULL OR v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'platform_invite_invalid'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  -- Serialize acceptances for the same hash / prevent double-claim races.
  PERFORM pg_advisory_xact_lock(872014003, hashtext(p_token_hash));

  SELECT * INTO v_inv
  FROM public.platform_invitations pi
  WHERE pi.token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform_invite_invalid'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  IF v_inv.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'platform_invite_revoked'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'platform_invite_used'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'platform_invite_expired'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  IF lower(v_inv.email) IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'platform_invite_email_mismatch'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  -- Mark accepted first so a second concurrent claim cannot also pass checks.
  UPDATE public.platform_invitations
  SET accepted_at = now(),
      accepted_by = p_user_id
  WHERE id = v_inv.id
    AND accepted_at IS NULL
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'platform_invite_used'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  INSERT INTO public.platform_roles (user_id, role, created_by)
  VALUES (p_user_id, v_inv.platform_role, v_inv.invited_by)
  ON CONFLICT (user_id, role) DO NOTHING;

  invitation_id := v_inv.id;
  granted_role := v_inv.platform_role;
  first_name := v_inv.first_name;
  last_name := v_inv.last_name;
  invite_email := v_inv.email;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.claim_platform_invitation(text, uuid, text) IS
  'G7E-2A: atomically claim a hashed platform invitation and insert platform_roles.';

REVOKE ALL ON FUNCTION public.claim_platform_invitation(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_platform_invitation(text, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Last Super Owner concurrency: advisory lock before remaining-count check
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_last_super_owner_loss()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remaining integer;
BEGIN
  -- Serialize all Super Owner delete/demote checks platform-wide.
  -- Do not lock the row being deleted (that fails for the final row itself).
  PERFORM pg_advisory_xact_lock(872014002);

  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'super_owner'::public.platform_role THEN
      SELECT COUNT(*)::integer
        INTO remaining
      FROM public.platform_roles
      WHERE role = 'super_owner'::public.platform_role
        AND id IS DISTINCT FROM OLD.id;
      IF remaining < 1 THEN
        RAISE EXCEPTION 'last_super_owner_protected'
          USING ERRCODE = 'restrict_violation',
            HINT = 'Mortgage Hub must have at least one Super Owner.';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.role = 'super_owner'::public.platform_role
       AND NEW.role IS DISTINCT FROM 'super_owner'::public.platform_role THEN
      SELECT COUNT(*)::integer
        INTO remaining
      FROM public.platform_roles
      WHERE role = 'super_owner'::public.platform_role
        AND id IS DISTINCT FROM OLD.id;
      IF remaining < 1 THEN
        RAISE EXCEPTION 'last_super_owner_protected'
          USING ERRCODE = 'restrict_violation',
            HINT = 'Mortgage Hub must have at least one Super Owner.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.prevent_last_super_owner_loss() IS
  'G7A/G7E-2A: block DELETE/demote of final super_owner; serializes via pg_advisory_xact_lock(872014002).';

-- Recreate trigger (definition unchanged) so COMMENT/fn swap is live.
DROP TRIGGER IF EXISTS platform_roles_prevent_last_super_owner ON public.platform_roles;
CREATE TRIGGER platform_roles_prevent_last_super_owner
  BEFORE DELETE OR UPDATE OF role ON public.platform_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_super_owner_loss();

REVOKE ALL ON FUNCTION public.prevent_last_super_owner_loss() FROM PUBLIC, anon;
