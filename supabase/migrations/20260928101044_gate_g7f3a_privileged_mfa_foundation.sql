-- G7F-3A: trusted server MFA foundation (schema only; no enforcement, no Auth/factor changes).
-- G7D sessions record the verified Supabase Auth session_id that created them.
-- Nullable for historical rows; NULL never satisfies enforced privileged MFA binding (app layer).

ALTER TABLE public.platform_tenant_access_sessions
  ADD COLUMN IF NOT EXISTS auth_session_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'platform_tenant_access_sessions_auth_session_id_chk'
      AND conrelid = 'public.platform_tenant_access_sessions'::regclass
  ) THEN
    ALTER TABLE public.platform_tenant_access_sessions
      ADD CONSTRAINT platform_tenant_access_sessions_auth_session_id_chk
      CHECK (auth_session_id IS NULL OR length(btrim(auth_session_id)) > 0);
  END IF;
END;
$$;

COMMENT ON COLUMN public.platform_tenant_access_sessions.auth_session_id IS
  'G7F-3A: verified Supabase Auth session_id that created this G7D session. NULL = pre-G7F-3A or unverified; never satisfies enforced privileged MFA session binding.';

COMMENT ON TABLE public.platform_mfa_policy IS
  'Optional per-role MFA configuration. Not a security authority: mandatory privileged MFA floors for super_owner, super_admin and break-glass are enforced in server code (privileged-mfa.ts) and cannot be weakened by this table.';
