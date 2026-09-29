-- =============================================================================================
-- G7F-3C3A — privileged MFA recovery: post-recovery authentication boundary.
--
-- Defect closed: after recovery completed, a validly signed access token issued BEFORE recovery
-- execution regained platform authority (PostgREST verifies only the JWT signature, so a token
-- whose Auth session was deleted by execute_platform_mfa_recovery stayed usable until expiry).
--
-- Invariant: once a recovery has executed for a user, privileged platform authority for that user
-- requires an authentication context established after the latest recovery boundary:
--   * the token's session_id must identify a live auth.sessions row of that user created at or
--     after the boundary (refresh keeps session_id, so legitimate rotation survives), and
--   * the token's iat must not predate the boundary.
-- The boundary is durable (never lowered, removed only when the Auth user itself is deleted) and
-- independent of PRIVILEGED_MFA_MODE. Completing recovery never moves it.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 1. Durable boundary
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.platform_mfa_recovery_auth_boundaries (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  boundary_at timestamptz NOT NULL,
  request_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_mfa_recovery_auth_boundaries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_mfa_recovery_auth_boundaries FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.platform_mfa_recovery_auth_boundaries TO service_role;

CREATE FUNCTION public.g7f3c3a_guard_boundary_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Cascade from auth.users deletion only; the boundary is otherwise permanent.
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = OLD.user_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'mfa_recovery_boundary_immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF pg_catalog.current_setting('g7f3c3.rpc', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'mfa_recovery_state_rpc_only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.boundary_at < OLD.boundary_at) THEN
    RAISE EXCEPTION 'mfa_recovery_boundary_immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER platform_mfa_recovery_auth_boundaries_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.platform_mfa_recovery_auth_boundaries
  FOR EACH ROW EXECUTE FUNCTION public.g7f3c3a_guard_boundary_write();

-- Every grant issuance after execution (execute and reissue both set grant_issued_at) moves the
-- boundary forward inside the same transaction as the Auth revocation it accompanies.
CREATE FUNCTION public.g7f3c3a_record_auth_boundary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_at timestamptz := GREATEST(NEW.executed_at, NEW.grant_issued_at);
BEGIN
  INSERT INTO public.platform_mfa_recovery_auth_boundaries AS b (user_id, boundary_at, request_id, updated_at)
  VALUES (NEW.target_user_id, v_at, NEW.id, pg_catalog.now())
  ON CONFLICT (user_id) DO UPDATE
    SET boundary_at = GREATEST(b.boundary_at, EXCLUDED.boundary_at),
        request_id = CASE WHEN EXCLUDED.boundary_at >= b.boundary_at THEN EXCLUDED.request_id ELSE b.request_id END,
        updated_at = pg_catalog.now();
  RETURN NULL;
END;
$$;

CREATE TRIGGER platform_mfa_recovery_requests_auth_boundary
  AFTER UPDATE OF grant_issued_at ON public.platform_mfa_recovery_requests
  FOR EACH ROW
  WHEN (NEW.executed_at IS NOT NULL AND NEW.grant_issued_at IS NOT NULL
        AND NEW.grant_issued_at IS DISTINCT FROM OLD.grant_issued_at)
  EXECUTE FUNCTION public.g7f3c3a_record_auth_boundary();

-- Backfill from any recovery already executed before this migration.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('g7f3c3.rpc', 'on', true);
  INSERT INTO public.platform_mfa_recovery_auth_boundaries (user_id, boundary_at, request_id, updated_at)
  SELECT DISTINCT ON (r.target_user_id)
         r.target_user_id, GREATEST(r.executed_at, COALESCE(r.grant_issued_at, r.executed_at)), r.id, now()
  FROM public.platform_mfa_recovery_requests r
  WHERE r.executed_at IS NOT NULL
  ORDER BY r.target_user_id, GREATEST(r.executed_at, COALESCE(r.grant_issued_at, r.executed_at)) DESC;
  PERFORM pg_catalog.set_config('g7f3c3.rpc', 'off', true);
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. Context checks
-- ---------------------------------------------------------------------------------------------
-- True when p_user has no recovery boundary, or when (p_session_id, p_iat) is an authentication
-- context established after it. Fails closed on missing / malformed evidence.
CREATE FUNCTION public.g7f3c3a_auth_context_current(p_user_id uuid, p_session_id text, p_iat bigint)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_boundary timestamptz;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN false;
  END IF;
  SELECT b.boundary_at INTO v_boundary
  FROM public.platform_mfa_recovery_auth_boundaries b
  WHERE b.user_id = p_user_id;
  IF v_boundary IS NULL THEN
    RETURN true;
  END IF;
  -- iat has whole-second precision; a same-second pre-execution token still fails the session test.
  IF p_iat IS NULL OR p_iat < pg_catalog.floor(pg_catalog.date_part('epoch', v_boundary))::bigint THEN
    RETURN false;
  END IF;
  IF p_session_id IS NULL
     OR p_session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM auth.sessions s
    WHERE s.id = p_session_id::uuid
      AND s.user_id = p_user_id
      AND s.created_at >= v_boundary
      AND (s.not_after IS NULL OR s.not_after > pg_catalog.now())
  );
END;
$$;

-- Applies the check to the request's own JWT (PostgREST / Realtime / Storage) whenever the helper
-- is evaluating the caller's own authority. Calls without JWT claims (service role, internal SQL)
-- and checks about a different user are unaffected here; the application server applies the
-- same check through platform_mfa_recovery_authority_state.
CREATE FUNCTION public.g7f3c3a_request_context_current(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claims jsonb;
  v_iat bigint;
BEGIN
  IF p_user_id IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.platform_mfa_recovery_auth_boundaries b WHERE b.user_id = p_user_id) THEN
    RETURN true;
  END IF;
  v_claims := auth.jwt();
  BEGIN
    v_iat := pg_catalog.floor((v_claims->>'iat')::numeric)::bigint;
  EXCEPTION WHEN OTHERS THEN
    v_iat := NULL;
  END;
  RETURN public.g7f3c3a_auth_context_current(p_user_id, v_claims->>'session_id', v_iat);
END;
$$;

REVOKE ALL ON FUNCTION public.g7f3c3a_guard_boundary_write() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.g7f3c3a_record_auth_boundary() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.g7f3c3a_auth_context_current(uuid, text, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.g7f3c3a_request_context_current(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. Root platform authority helpers (every RLS policy / tenant helper derives from these)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_super_owner(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_roles pr WHERE pr.user_id = p_user_id AND pr.role = 'super_owner')
    AND NOT public.is_platform_mfa_recovery_locked(p_user_id)
    AND public.g7f3c3a_request_context_current(p_user_id);
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_roles pr WHERE pr.user_id = p_user_id AND pr.role = 'super_admin')
    AND NOT public.is_platform_mfa_recovery_locked(p_user_id)
    AND public.g7f3c3a_request_context_current(p_user_id);
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Application server state (service role only)
-- ---------------------------------------------------------------------------------------------
-- 'locked'             recovery executed and not completed (mode-independent lock)
-- 'stale_auth_context' the presented session / iat predates the latest recovery boundary
-- 'ok'                 neither
CREATE FUNCTION public.platform_mfa_recovery_authority_state(p_user_id uuid, p_session_id text, p_iat bigint)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN 'stale_auth_context'
    WHEN public.is_platform_mfa_recovery_locked(p_user_id) THEN 'locked'
    WHEN NOT public.g7f3c3a_auth_context_current(p_user_id, p_session_id, p_iat) THEN 'stale_auth_context'
    ELSE 'ok'
  END;
$$;

REVOKE ALL ON FUNCTION public.platform_mfa_recovery_authority_state(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_mfa_recovery_authority_state(uuid, text, bigint) TO service_role;
