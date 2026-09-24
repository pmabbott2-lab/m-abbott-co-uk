-- G7F-1B-C1A: atomic break-glass lifecycle (role + classification + audit)
-- One transactional service_role RPC. No new tables. No Auth user creation.
-- Advisory lock: pg_advisory_xact_lock(872014002) — same order as G7F-1B-A.

CREATE OR REPLACE FUNCTION public.establish_break_glass_identity(
  p_target_user_id uuid,
  p_acting_user_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_bg public.platform_break_glass_identities%ROWTYPE;
  v_had_active boolean := false;
  v_bg_id uuid;
  v_prev_user_id uuid;
  v_reason text;
  v_role_inserted boolean := false;
  v_outcome text;
BEGIN
  -- Serialize with G7F-1B-A SO/BG invariant checks (identical lock id / order).
  PERFORM pg_advisory_xact_lock(872014002);

  IF p_acting_user_id IS NULL THEN
    RAISE EXCEPTION 'break_glass_lifecycle_actor_required'
      USING ERRCODE = 'invalid_parameter_value',
        HINT = 'p_acting_user_id is required.';
  END IF;

  IF NOT public.is_super_owner(p_acting_user_id) THEN
    RAISE EXCEPTION 'break_glass_lifecycle_actor_not_super_owner'
      USING ERRCODE = 'insufficient_privilege',
        HINT = 'Acting user must hold platform_roles.role = super_owner.';
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'break_glass_lifecycle_target_required'
      USING ERRCODE = 'invalid_parameter_value',
        HINT = 'p_target_user_id is required.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_target_user_id) THEN
    RAISE EXCEPTION 'break_glass_lifecycle_target_missing'
      USING ERRCODE = 'no_data_found',
        HINT = 'Target Auth user UUID does not exist.';
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    v_reason := left(v_reason, 500);
  END IF;

  SELECT *
    INTO v_active_bg
  FROM public.platform_break_glass_identities
  WHERE active = true
  FOR UPDATE;

  v_had_active := FOUND;

  IF v_had_active AND v_active_bg.user_id = p_target_user_id THEN
    RETURN jsonb_build_object(
      'outcome', 'already_active',
      'target_user_id', p_target_user_id,
      'break_glass_id', v_active_bg.id,
      'previous_user_id', NULL
    );
  END IF;

  IF NOT public.is_super_owner(p_target_user_id) THEN
    INSERT INTO public.platform_roles (user_id, role, created_by)
    VALUES (p_target_user_id, 'super_owner'::public.platform_role, p_acting_user_id)
    ON CONFLICT (user_id, role) DO NOTHING;
    v_role_inserted := true;
  END IF;

  IF NOT public.is_super_owner(p_target_user_id) THEN
    RAISE EXCEPTION 'break_glass_lifecycle_role_failed'
      USING ERRCODE = 'restrict_violation',
        HINT = 'Failed to ensure platform_roles.super_owner for target.';
  END IF;

  IF v_had_active AND v_active_bg.user_id IS DISTINCT FROM p_target_user_id THEN
    -- Replacement: deactivate prior BG classification; keep prior SO role.
    v_prev_user_id := v_active_bg.user_id;

    UPDATE public.platform_break_glass_identities
    SET
      active = false,
      deactivated_at = now(),
      deactivated_by = p_acting_user_id,
      replaced_at = now(),
      replaced_by = p_target_user_id,
      reason = COALESCE(v_reason, reason)
    WHERE id = v_active_bg.id;

    INSERT INTO public.platform_break_glass_identities (
      user_id,
      active,
      created_by,
      reason
    )
    VALUES (
      p_target_user_id,
      true,
      p_acting_user_id,
      v_reason
    )
    RETURNING id INTO v_bg_id;

    INSERT INTO public.security_audit_events (
      event_type,
      acting_user_id,
      subject_user_id,
      metadata
    )
    VALUES (
      'BREAK_GLASS_IDENTITY_REPLACED',
      p_acting_user_id,
      p_target_user_id,
      jsonb_build_object(
        'source', 'establish_break_glass_identity',
        'outcome', 'replaced',
        'previous_user_id', v_prev_user_id,
        'target_user_id', p_target_user_id,
        'break_glass_id', v_bg_id,
        'previous_break_glass_id', v_active_bg.id,
        'role_inserted', v_role_inserted,
        'reason', v_reason
      )
    );

    v_outcome := 'replaced';
  ELSE
    INSERT INTO public.platform_break_glass_identities (
      user_id,
      active,
      created_by,
      reason
    )
    VALUES (
      p_target_user_id,
      true,
      p_acting_user_id,
      v_reason
    )
    RETURNING id INTO v_bg_id;

    INSERT INTO public.security_audit_events (
      event_type,
      acting_user_id,
      subject_user_id,
      metadata
    )
    VALUES (
      'BREAK_GLASS_IDENTITY_CREATED',
      p_acting_user_id,
      p_target_user_id,
      jsonb_build_object(
        'source', 'establish_break_glass_identity',
        'outcome', 'created',
        'target_user_id', p_target_user_id,
        'break_glass_id', v_bg_id,
        'role_inserted', v_role_inserted,
        'reason', v_reason
      )
    );

    v_outcome := 'created';
    v_prev_user_id := NULL;
  END IF;

  RETURN jsonb_build_object(
    'outcome', v_outcome,
    'target_user_id', p_target_user_id,
    'break_glass_id', v_bg_id,
    'previous_user_id', v_prev_user_id,
    'role_inserted', v_role_inserted
  );
END;
$$;

COMMENT ON FUNCTION public.establish_break_glass_identity(uuid, uuid, text) IS
  'G7F-1B-C1A: atomically ensure target super_owner, activate/replace break-glass classification, and write BREAK_GLASS_IDENTITY_CREATED|REPLACED audit in one transaction. service_role only. Does not create Auth users.';

REVOKE ALL ON FUNCTION public.establish_break_glass_identity(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.establish_break_glass_identity(uuid, uuid, text)
  TO service_role;
