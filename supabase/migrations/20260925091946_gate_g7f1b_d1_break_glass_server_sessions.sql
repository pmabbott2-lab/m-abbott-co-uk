-- G7F-1B-D1: authoritative server-side break-glass platform sessions.
-- Cookies become non-authoritative cache. service_role RPCs only.
-- Absolute started_at immutable for an open session. Idle = last_activity_at + 15m.
-- Fresh Auth boundary: auth_session_id required to create; same session_id cannot reopen after end.
-- iat alone never authorizes a new session.

CREATE TABLE IF NOT EXISTS public.platform_break_glass_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  auth_session_id text,
  auth_iat_bind bigint,
  started_at timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  end_reason text,
  login_audited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_break_glass_sessions_end_reason_chk CHECK (
    end_reason IS NULL
    OR end_reason IN (
      'logout',
      'absolute_expired',
      'idle_expired',
      'classification_removed',
      'role_removed',
      'replaced'
    )
  ),
  CONSTRAINT platform_break_glass_sessions_times_chk CHECK (
    last_activity_at >= started_at
    AND absolute_expires_at > started_at
    AND absolute_expires_at <= started_at + interval '60 minutes' + interval '1 second'
    AND (ended_at IS NULL OR ended_at >= started_at)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_break_glass_sessions_one_open_per_user
  ON public.platform_break_glass_sessions (user_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS platform_break_glass_sessions_user_started_idx
  ON public.platform_break_glass_sessions (user_id, started_at DESC);

COMMENT ON TABLE public.platform_break_glass_sessions IS
  'G7F-1B-D1: authoritative BG platform session (60m absolute / 15m idle). Not an authority grant.';

ALTER TABLE public.platform_break_glass_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_break_glass_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_break_glass_sessions TO service_role;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.break_glass_activity_is_meaningful(p_activity text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_activity IN (
    'platform_navigation',
    'platform_mutation',
    'g7d_entry',
    'g7d_exit',
    'manual_touch'
  );
$$;

CREATE OR REPLACE FUNCTION public._end_break_glass_platform_session_row(
  p_row public.platform_break_glass_sessions,
  p_end_reason text,
  p_now timestamptz
)
RETURNS public.platform_break_glass_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.platform_break_glass_sessions;
BEGIN
  IF p_row.ended_at IS NOT NULL THEN
    RETURN p_row;
  END IF;

  UPDATE public.platform_break_glass_sessions
  SET
    ended_at = p_now,
    end_reason = p_end_reason,
    updated_at = p_now
  WHERE id = p_row.id
    AND ended_at IS NULL
  RETURNING * INTO v_row;

  -- Best-effort: end open BG-tagged G7D rows (security still depends on validation).
  UPDATE public.platform_tenant_access_sessions
  SET ended_at = p_now
  WHERE platform_user_id = p_row.user_id
    AND ended_at IS NULL
    AND reason LIKE 'break_glass:%';

  RETURN COALESCE(v_row, p_row);
END;
$$;

REVOKE ALL ON FUNCTION public._end_break_glass_platform_session_row(public.platform_break_glass_sessions, text, timestamptz)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- ensure: establish / validate / optional meaningful touch (atomic)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_break_glass_platform_session(
  p_user_id uuid,
  p_auth_session_id text,
  p_auth_iat bigint DEFAULT NULL,
  p_activity text DEFAULT 'session_check',
  p_allow_create boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_open public.platform_break_glass_sessions%ROWTYPE;
  v_session_id text := nullif(btrim(COALESCE(p_auth_session_id, '')), '');
  v_touch boolean := public.break_glass_activity_is_meaningful(COALESCE(p_activity, 'session_check'));
  v_is_so boolean;
  v_is_bg boolean;
  v_new public.platform_break_glass_sessions%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'break_glass_session_user_required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('bg_platform_session:' || p_user_id::text));

  v_is_so := public.is_super_owner(p_user_id);
  v_is_bg := public.is_active_break_glass(p_user_id);

  SELECT * INTO v_open
  FROM public.platform_break_glass_sessions
  WHERE user_id = p_user_id
    AND ended_at IS NULL
  FOR UPDATE;

  IF NOT v_is_so OR NOT v_is_bg THEN
    IF FOUND THEN
      PERFORM public._end_break_glass_platform_session_row(
        v_open,
        CASE WHEN NOT v_is_bg THEN 'classification_removed' ELSE 'role_removed' END,
        v_now
      );
    END IF;
    RETURN jsonb_build_object(
      'active', false,
      'reason', CASE WHEN NOT v_is_bg THEN 'not_break_glass' ELSE 'not_super_owner' END
    );
  END IF;

  IF FOUND THEN
    IF v_now >= v_open.absolute_expires_at THEN
      PERFORM public._end_break_glass_platform_session_row(v_open, 'absolute_expired', v_now);
      -- fall through to create/deny path
    ELSIF v_now >= v_open.last_activity_at + interval '15 minutes' THEN
      PERFORM public._end_break_glass_platform_session_row(v_open, 'idle_expired', v_now);
    ELSE
      IF v_touch THEN
        UPDATE public.platform_break_glass_sessions
        SET last_activity_at = v_now, updated_at = v_now
        WHERE id = v_open.id
        RETURNING * INTO v_open;
      END IF;
      RETURN jsonb_build_object(
        'active', true,
        'outcome', 'existing',
        'session_id', v_open.id,
        'started_at', v_open.started_at,
        'last_activity_at', v_open.last_activity_at,
        'absolute_expires_at', v_open.absolute_expires_at,
        'auth_session_id', v_open.auth_session_id,
        'login_audited', v_open.login_audited_at IS NOT NULL,
        'touched', v_touch
      );
    END IF;
  END IF;

  -- No open valid session.
  IF NOT p_allow_create THEN
    RETURN jsonb_build_object('active', false, 'reason', 'no_active_session');
  END IF;

  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('active', false, 'reason', 'auth_session_id_required');
  END IF;

  -- Same Auth session cannot reopen after any ended BG platform session.
  IF EXISTS (
    SELECT 1
    FROM public.platform_break_glass_sessions s
    WHERE s.user_id = p_user_id
      AND s.ended_at IS NOT NULL
      AND s.auth_session_id IS NOT NULL
      AND s.auth_session_id = v_session_id
  ) THEN
    RETURN jsonb_build_object('active', false, 'reason', 'same_auth_session_locked');
  END IF;

  -- iat alone must never authorize create (only stored as secondary bind).
  INSERT INTO public.platform_break_glass_sessions (
    user_id,
    auth_session_id,
    auth_iat_bind,
    started_at,
    last_activity_at,
    absolute_expires_at,
    login_audited_at
  )
  VALUES (
    p_user_id,
    v_session_id,
    p_auth_iat,
    v_now,
    v_now,
    v_now + interval '60 minutes',
    v_now
  )
  RETURNING * INTO v_new;

  INSERT INTO public.security_audit_events (event_type, acting_user_id, metadata)
  VALUES (
    'BREAK_GLASS_LOGIN_SUCCEEDED',
    p_user_id,
    jsonb_build_object(
      'source', 'break_glass_platform_session',
      'bg_session_id', v_new.id,
      'started_at', v_new.started_at
    )
  );

  INSERT INTO public.security_audit_events (event_type, acting_user_id, metadata)
  VALUES (
    'BREAK_GLASS_PLATFORM_ACCESS',
    p_user_id,
    jsonb_build_object(
      'source', 'break_glass_platform_session',
      'bg_session_id', v_new.id,
      'started_at', v_new.started_at
    )
  );

  RETURN jsonb_build_object(
    'active', true,
    'outcome', 'created',
    'session_id', v_new.id,
    'started_at', v_new.started_at,
    'last_activity_at', v_new.last_activity_at,
    'absolute_expires_at', v_new.absolute_expires_at,
    'auth_session_id', v_new.auth_session_id,
    'login_audited', true,
    'touched', false
  );
END;
$$;

COMMENT ON FUNCTION public.ensure_break_glass_platform_session(uuid, text, bigint, text, boolean) IS
  'G7F-1B-D1: atomic BG platform session ensure/create/validate. service_role only. auth_session_id required to create; iat alone cannot reopen.';

-- ---------------------------------------------------------------------------
-- touch: meaningful activity only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_break_glass_platform_session(
  p_user_id uuid,
  p_auth_session_id text,
  p_activity text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.break_glass_activity_is_meaningful(COALESCE(p_activity, '')) THEN
    RETURN jsonb_build_object('active', false, 'reason', 'activity_not_meaningful', 'touched', false);
  END IF;
  RETURN public.ensure_break_glass_platform_session(
    p_user_id,
    p_auth_session_id,
    NULL,
    p_activity,
    false  -- never create on touch-only
  );
END;
$$;

COMMENT ON FUNCTION public.touch_break_glass_platform_session(uuid, text, text) IS
  'G7F-1B-D1: meaningful-activity idle touch only; never creates a session.';

-- ---------------------------------------------------------------------------
-- end / lock
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.end_break_glass_platform_session(
  p_user_id uuid,
  p_end_reason text DEFAULT 'logout'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_open public.platform_break_glass_sessions%ROWTYPE;
  v_reason text := COALESCE(nullif(btrim(p_end_reason), ''), 'logout');
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'break_glass_session_user_required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_reason NOT IN (
    'logout', 'absolute_expired', 'idle_expired',
    'classification_removed', 'role_removed', 'replaced'
  ) THEN
    v_reason := 'logout';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('bg_platform_session:' || p_user_id::text));

  SELECT * INTO v_open
  FROM public.platform_break_glass_sessions
  WHERE user_id = p_user_id
    AND ended_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ended', false, 'reason', 'no_open_session');
  END IF;

  PERFORM public._end_break_glass_platform_session_row(v_open, v_reason, v_now);

  RETURN jsonb_build_object(
    'ended', true,
    'session_id', v_open.id,
    'end_reason', v_reason,
    'started_at', v_open.started_at
  );
END;
$$;

COMMENT ON FUNCTION public.end_break_glass_platform_session(uuid, text) IS
  'G7F-1B-D1: authoritatively end open BG platform session. service_role only.';

-- Read helper for G7D binding (no create)
CREATE OR REPLACE FUNCTION public.is_break_glass_platform_session_active(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_open public.platform_break_glass_sessions%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT public.is_super_owner(p_user_id) OR NOT public.is_active_break_glass(p_user_id) THEN
    RETURN false;
  END IF;
  SELECT * INTO v_open
  FROM public.platform_break_glass_sessions
  WHERE user_id = p_user_id
    AND ended_at IS NULL;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_now >= v_open.absolute_expires_at THEN
    RETURN false;
  END IF;
  IF v_now >= v_open.last_activity_at + interval '15 minutes' THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_break_glass_platform_session(uuid, text, bigint, text, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_break_glass_platform_session(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.end_break_glass_platform_session(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_break_glass_platform_session_active(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.break_glass_activity_is_meaningful(text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ensure_break_glass_platform_session(uuid, text, bigint, text, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.touch_break_glass_platform_session(uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.end_break_glass_platform_session(uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.is_break_glass_platform_session_active(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.break_glass_activity_is_meaningful(text)
  TO service_role;
