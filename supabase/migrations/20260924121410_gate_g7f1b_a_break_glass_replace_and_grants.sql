-- G7F-1B-A (canonical split matching staging MCP history)
-- Staging version/name parity: 20260924121410_gate_g7f1b_a_break_glass_replace_and_grants
-- ---------------------------------------------------------------------------
-- 5. Atomic replacement helper (service_role only; no Auth user creation)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.replace_break_glass_identity(
  p_old_user_id uuid,
  p_new_user_id uuid,
  p_acting_user_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old public.platform_break_glass_identities%ROWTYPE;
  v_new_id uuid;
  v_normal integer;
BEGIN
  PERFORM pg_advisory_xact_lock(872014002);

  IF p_old_user_id IS NULL OR p_new_user_id IS NULL THEN
    RAISE EXCEPTION 'break_glass_replace_invalid'
      USING ERRCODE = 'invalid_parameter_value',
        HINT = 'old and new user_id are required.';
  END IF;

  IF p_old_user_id = p_new_user_id THEN
    RAISE EXCEPTION 'break_glass_replace_invalid'
      USING ERRCODE = 'invalid_parameter_value',
        HINT = 'old and new break-glass user_id must differ.';
  END IF;

  IF NOT public.is_super_owner(p_new_user_id) THEN
    RAISE EXCEPTION 'break_glass_requires_super_owner'
      USING ERRCODE = 'restrict_violation',
        HINT = 'New break-glass identity must already hold platform_roles.role = super_owner.';
  END IF;

  SELECT *
    INTO v_old
  FROM public.platform_break_glass_identities
  WHERE user_id = p_old_user_id
    AND active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'break_glass_replace_missing'
      USING ERRCODE = 'no_data_found',
        HINT = 'No active break-glass classification for old_user_id.';
  END IF;

  IF public.is_active_break_glass(p_new_user_id) THEN
    RAISE EXCEPTION 'break_glass_already_active'
      USING ERRCODE = 'unique_violation',
        HINT = 'New user is already an active break-glass identity.';
  END IF;

  -- After replace: normals = all SOs except new BG (old becomes normal again if still SO).
  SELECT COUNT(*)::integer
    INTO v_normal
  FROM public.platform_roles pr
  WHERE pr.role = 'super_owner'::public.platform_role
    AND pr.user_id IS DISTINCT FROM p_new_user_id;

  IF v_normal < 1 THEN
    RAISE EXCEPTION 'last_normal_super_owner_protected'
      USING ERRCODE = 'restrict_violation',
        HINT = 'Replacement would leave zero normal Super Owners.';
  END IF;

  UPDATE public.platform_break_glass_identities
  SET
    active = false,
    deactivated_at = now(),
    deactivated_by = p_acting_user_id,
    replaced_at = now(),
    replaced_by = p_new_user_id,
    reason = COALESCE(p_reason, reason)
  WHERE id = v_old.id;

  INSERT INTO public.platform_break_glass_identities (
    user_id,
    active,
    created_by,
    reason
  )
  VALUES (
    p_new_user_id,
    true,
    p_acting_user_id,
    p_reason
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION public.replace_break_glass_identity(uuid, uuid, uuid, text) IS
  'G7F-1B-A: atomically deactivate old active BG and activate new SO as BG. Does not create Auth users. service_role only.';

-- ---------------------------------------------------------------------------
-- 6. Grants / RLS — no client writes; no authenticated SELECT required
-- ---------------------------------------------------------------------------
ALTER TABLE public.platform_break_glass_identities ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.platform_break_glass_identities FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_break_glass_identities TO service_role;

-- No authenticated policies: clients cannot read or mutate classifications via Data API.

REVOKE ALL ON FUNCTION public.is_active_break_glass(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_normal_super_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.count_super_owners() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.count_normal_super_owners() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.replace_break_glass_identity(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_break_glass_identity_invariants() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prevent_last_super_owner_loss() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_active_break_glass(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_normal_super_owner(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.count_super_owners() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.count_normal_super_owners() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.replace_break_glass_identity(uuid, uuid, uuid, text) TO service_role;
