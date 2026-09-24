-- G7F-1B-A (canonical split matching staging MCP history)
-- Staging version/name parity: 20260924121348_gate_g7f1b_a_break_glass_helpers_invariants
-- ---------------------------------------------------------------------------
-- 2. Helpers (UUID only; no email)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_active_break_glass(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.platform_break_glass_identities bg
      WHERE bg.user_id = p_user_id
        AND bg.active = true
    );
$$;

COMMENT ON FUNCTION public.is_active_break_glass(uuid) IS
  'True when user_id has an active break-glass classification row. Not an authority grant.';

CREATE OR REPLACE FUNCTION public.is_normal_super_owner(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_owner(p_user_id)
    AND NOT public.is_active_break_glass(p_user_id);
$$;

COMMENT ON FUNCTION public.is_normal_super_owner(uuid) IS
  'Super Owner who is NOT an active break-glass identity. UUID + platform_roles + registry only.';

CREATE OR REPLACE FUNCTION public.count_super_owners()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.platform_roles
  WHERE role = 'super_owner'::public.platform_role;
$$;

CREATE OR REPLACE FUNCTION public.count_normal_super_owners()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.platform_roles pr
  WHERE pr.role = 'super_owner'::public.platform_role
    AND NOT public.is_active_break_glass(pr.user_id);
$$;

COMMENT ON FUNCTION public.count_normal_super_owners() IS
  'Count of super_owner rows whose user_id is not active break-glass. BG does not satisfy this count.';

-- ---------------------------------------------------------------------------
-- 3. Absolute last-SO + normal-SO minimum (advisory lock preserved/extended)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_last_super_owner_loss()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remaining_total integer;
  remaining_normal integer;
  user_still_exists boolean;
BEGIN
  -- Serialize all Super Owner delete/demote checks platform-wide (G7A/G7E-2A/G7F-1B-A).
  PERFORM pg_advisory_xact_lock(872014002);

  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'super_owner'::public.platform_role THEN
      SELECT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id)
        INTO user_still_exists;

      -- Role revoke while Auth user remains: cannot strip SO from an active BG identity
      -- (would orphan the classification). Auth CASCADE delete skips this branch.
      IF user_still_exists AND public.is_active_break_glass(OLD.user_id) THEN
        RAISE EXCEPTION 'active_break_glass_requires_super_owner'
          USING ERRCODE = 'restrict_violation',
            HINT = 'Deactivate or replace the break-glass classification before removing super_owner.';
      END IF;

      SELECT COUNT(*)::integer
        INTO remaining_total
      FROM public.platform_roles
      WHERE role = 'super_owner'::public.platform_role
        AND id IS DISTINCT FROM OLD.id;

      IF remaining_total < 1 THEN
        RAISE EXCEPTION 'last_super_owner_protected'
          USING ERRCODE = 'restrict_violation',
            HINT = 'Mortgage Hub must have at least one Super Owner.';
      END IF;

      SELECT COUNT(*)::integer
        INTO remaining_normal
      FROM public.platform_roles pr
      WHERE pr.role = 'super_owner'::public.platform_role
        AND pr.id IS DISTINCT FROM OLD.id
        AND NOT public.is_active_break_glass(pr.user_id);

      IF remaining_normal < 1 THEN
        RAISE EXCEPTION 'last_normal_super_owner_protected'
          USING ERRCODE = 'restrict_violation',
            HINT = 'Mortgage Hub must retain at least one normal (non-break-glass) Super Owner.';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.role = 'super_owner'::public.platform_role
       AND NEW.role IS DISTINCT FROM 'super_owner'::public.platform_role THEN
      IF public.is_active_break_glass(OLD.user_id) THEN
        RAISE EXCEPTION 'active_break_glass_requires_super_owner'
          USING ERRCODE = 'restrict_violation',
            HINT = 'Deactivate or replace the break-glass classification before demoting super_owner.';
      END IF;

      SELECT COUNT(*)::integer
        INTO remaining_total
      FROM public.platform_roles
      WHERE role = 'super_owner'::public.platform_role
        AND id IS DISTINCT FROM OLD.id;

      IF remaining_total < 1 THEN
        RAISE EXCEPTION 'last_super_owner_protected'
          USING ERRCODE = 'restrict_violation',
            HINT = 'Mortgage Hub must have at least one Super Owner.';
      END IF;

      SELECT COUNT(*)::integer
        INTO remaining_normal
      FROM public.platform_roles pr
      WHERE pr.role = 'super_owner'::public.platform_role
        AND pr.id IS DISTINCT FROM OLD.id
        AND NOT public.is_active_break_glass(pr.user_id);

      IF remaining_normal < 1 THEN
        RAISE EXCEPTION 'last_normal_super_owner_protected'
          USING ERRCODE = 'restrict_violation',
            HINT = 'Mortgage Hub must retain at least one normal (non-break-glass) Super Owner.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.prevent_last_super_owner_loss() IS
  'G7A/G7E-2A/G7F-1B-A: block DELETE/demote of final total SO and final normal SO; serialize via pg_advisory_xact_lock(872014002); refuse stripping SO from active BG while Auth user remains.';

DROP TRIGGER IF EXISTS platform_roles_prevent_last_super_owner ON public.platform_roles;
CREATE TRIGGER platform_roles_prevent_last_super_owner
  BEFORE DELETE OR UPDATE OF role ON public.platform_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_super_owner_loss();

-- ---------------------------------------------------------------------------
-- 4. Break-glass row invariants (activate only for current SO; protect normals)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_break_glass_identity_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  remaining_normal integer;
BEGIN
  PERFORM pg_advisory_xact_lock(872014002);

  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    IF NEW.active = true THEN
      IF NOT public.is_super_owner(NEW.user_id) THEN
        RAISE EXCEPTION 'break_glass_requires_super_owner'
          USING ERRCODE = 'restrict_violation',
            HINT = 'Active break-glass classification requires platform_roles.role = super_owner.';
      END IF;

      -- Activating BG reduces normal-SO count for this user.
      SELECT COUNT(*)::integer
        INTO remaining_normal
      FROM public.platform_roles pr
      WHERE pr.role = 'super_owner'::public.platform_role
        AND pr.user_id IS DISTINCT FROM NEW.user_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.platform_break_glass_identities bg
          WHERE bg.user_id = pr.user_id
            AND bg.active = true
            AND (TG_OP = 'INSERT' OR bg.id IS DISTINCT FROM NEW.id)
        );

      IF remaining_normal < 1 THEN
        RAISE EXCEPTION 'last_normal_super_owner_protected'
          USING ERRCODE = 'restrict_violation',
            HINT = 'Cannot classify the last normal Super Owner as break-glass.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_break_glass_identity_invariants() IS
  'G7F-1B-A: active BG requires super_owner; refuses classifying the last normal SO as BG.';

DROP TRIGGER IF EXISTS platform_break_glass_identities_enforce ON public.platform_break_glass_identities;
CREATE TRIGGER platform_break_glass_identities_enforce
  BEFORE INSERT OR UPDATE OF user_id, active ON public.platform_break_glass_identities
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_break_glass_identity_invariants();
