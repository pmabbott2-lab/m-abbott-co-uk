-- Gate G7F-4S3B: staff invitation identity binding.
--
-- * Invitation tokens are stored as SHA-256 hashes only (platform_invitations model).
-- * Tenant clients lose all direct REST/RLS access to staff_invitations; every read and
--   mutation goes through service-role server functions.
-- * Acceptance is one SECURITY DEFINER transaction, executable by service_role only, that
--   binds the invitation to the confirmed auth.users email of the acting user and grants
--   role, profile and membership rows atomically.
--
-- Re-runnable. Do NOT apply to production without the matching application deploy.

-- ---------------------------------------------------------------------------
-- 1) Hashed tokens: backfill from the legacy uuid token, then drop the plaintext column.
--    Legacy links keep working because the application hashes the lower-case uuid text.
-- ---------------------------------------------------------------------------
ALTER TABLE public.staff_invitations ADD COLUMN IF NOT EXISTS token_hash text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'staff_invitations' AND column_name = 'token'
  ) THEN
    EXECUTE $sql$
      UPDATE public.staff_invitations
      SET token_hash = encode(sha256(convert_to(lower(token::text), 'UTF8')), 'hex')
      WHERE token_hash IS NULL AND token IS NOT NULL
    $sql$;
  END IF;
END $$;

ALTER TABLE public.staff_invitations ALTER COLUMN token_hash SET NOT NULL;

ALTER TABLE public.staff_invitations DROP CONSTRAINT IF EXISTS staff_invitations_token_hash_key;
ALTER TABLE public.staff_invitations
  ADD CONSTRAINT staff_invitations_token_hash_key UNIQUE (token_hash);

ALTER TABLE public.staff_invitations DROP CONSTRAINT IF EXISTS staff_invitations_token_hash_format;
ALTER TABLE public.staff_invitations
  ADD CONSTRAINT staff_invitations_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$');

DROP INDEX IF EXISTS public.idx_staff_invitations_token;
ALTER TABLE public.staff_invitations DROP COLUMN IF EXISTS token;

COMMENT ON COLUMN public.staff_invitations.token_hash IS
  'G7F-4S3B: SHA-256 hex of the invitation token. The raw token exists only at creation/delivery.';

-- ---------------------------------------------------------------------------
-- 2) New invitations: tenant, normalised email and a valid role/membership pair required.
--    NOT VALID keeps historical rows; acceptance re-checks every invitation regardless.
-- ---------------------------------------------------------------------------
ALTER TABLE public.staff_invitations DROP CONSTRAINT IF EXISTS staff_invitations_email_required;
ALTER TABLE public.staff_invitations
  ADD CONSTRAINT staff_invitations_email_required
  CHECK (email IS NOT NULL AND email <> '' AND email = lower(btrim(email))) NOT VALID;

ALTER TABLE public.staff_invitations DROP CONSTRAINT IF EXISTS staff_invitations_tenant_required;
ALTER TABLE public.staff_invitations
  ADD CONSTRAINT staff_invitations_tenant_required CHECK (tenant_id IS NOT NULL) NOT VALID;

ALTER TABLE public.staff_invitations DROP CONSTRAINT IF EXISTS staff_invitations_role_membership_pair;
ALTER TABLE public.staff_invitations
  ADD CONSTRAINT staff_invitations_role_membership_pair
  CHECK (
    (role = 'advisor'::public.app_role AND membership_role = 'adviser'::public.tenant_member_role)
    OR (role = 'introducer'::public.app_role AND membership_role = 'introducer'::public.tenant_member_role)
    OR (
      role = 'admin'::public.app_role
      AND membership_role IN (
        'general'::public.tenant_member_role,
        'supervisor'::public.tenant_member_role,
        'owner'::public.tenant_member_role
      )
    )
  ) NOT VALID;

-- ---------------------------------------------------------------------------
-- 3) No client access. RLS stays enabled with no policies; privileges revoked.
-- ---------------------------------------------------------------------------
ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff manage invitations" ON public.staff_invitations;
REVOKE ALL ON public.staff_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_invitations TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Atomic acceptance.
--    p_user_id must be the authenticated actor resolved by the calling server function.
--    p_advisor_code / p_company_code / p_introducer_slug are server-generated identifier
--    candidates; a collision raises staff_invite_retry_identifier and rolls back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_staff_invite(
  p_token_hash text,
  p_user_id uuid,
  p_full_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_advisor_code text DEFAULT NULL,
  p_company_code text DEFAULT NULL,
  p_introducer_slug text DEFAULT NULL
)
RETURNS TABLE (
  accepted_invitation_id uuid,
  accepted_tenant_id uuid,
  accepted_tenant_slug text,
  granted_role public.app_role,
  granted_membership_role public.tenant_member_role
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inv public.staff_invitations%ROWTYPE;
  v_tenant_status text;
  v_tenant_slug text;
  v_auth_email text;
  v_auth_confirmed timestamptz;
  v_auth_app_meta jsonb;
  v_auth_banned timestamptz;
  v_auth_deleted timestamptz;
  v_auth_anonymous boolean;
  v_admin public.admin_profiles%ROWTYPE;
  v_adv public.advisor_profiles%ROWTYPE;
  v_intro public.introducers%ROWTYPE;
  v_level public.admin_level;
  v_existing_rank int;
  v_new_rank int;
  v_company_code text;
  v_company_name text;
  v_profile_name text;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'staff_invite_invalid' USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  PERFORM pg_advisory_xact_lock(872014004, hashtext(p_token_hash));

  SELECT * INTO v_inv
  FROM public.staff_invitations si
  WHERE si.token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_invite_invalid' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF v_inv.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'staff_invite_used' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'staff_invite_expired' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF v_inv.tenant_id IS NULL THEN
    RAISE EXCEPTION 'staff_invite_invalid' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF v_inv.email IS NULL OR btrim(v_inv.email) = '' THEN
    RAISE EXCEPTION 'staff_invite_email_required' USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  IF NOT (
    (v_inv.role = 'advisor'::public.app_role AND v_inv.membership_role = 'adviser'::public.tenant_member_role)
    OR (v_inv.role = 'introducer'::public.app_role AND v_inv.membership_role = 'introducer'::public.tenant_member_role)
    OR (
      v_inv.role = 'admin'::public.app_role
      AND v_inv.membership_role IN (
        'general'::public.tenant_member_role,
        'supervisor'::public.tenant_member_role,
        'owner'::public.tenant_member_role
      )
    )
  ) THEN
    RAISE EXCEPTION 'staff_invite_role_invalid' USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  SELECT t.status::text, t.slug INTO v_tenant_status, v_tenant_slug
  FROM public.tenants t
  WHERE t.id = v_inv.tenant_id
  FOR SHARE;
  IF NOT FOUND OR v_tenant_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'staff_invite_tenant_inactive' USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  -- Canonical identity: auth.users only. profiles.email is user-editable and never consulted.
  SELECT u.email, u.email_confirmed_at, u.raw_app_meta_data, u.banned_until, u.deleted_at,
         COALESCE(u.is_anonymous, false)
  INTO v_auth_email, v_auth_confirmed, v_auth_app_meta, v_auth_banned, v_auth_deleted,
       v_auth_anonymous
  FROM auth.users u
  WHERE u.id = p_user_id;
  IF NOT FOUND OR v_auth_deleted IS NOT NULL OR v_auth_anonymous
     OR (v_auth_banned IS NOT NULL AND v_auth_banned > now()) THEN
    RAISE EXCEPTION 'staff_invite_identity' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF COALESCE(v_auth_app_meta ->> 'mh_identity', '') = 'appointment_customer'
     OR lower(COALESCE(v_auth_email, '')) LIKE '%@customers.mortgagehub.local' THEN
    RAISE EXCEPTION 'staff_invite_identity' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF v_auth_confirmed IS NULL THEN
    RAISE EXCEPTION 'staff_invite_email_unconfirmed' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF v_auth_email IS NULL OR lower(btrim(v_auth_email)) IS DISTINCT FROM lower(btrim(v_inv.email)) THEN
    RAISE EXCEPTION 'staff_invite_email_mismatch' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  v_auth_email := lower(btrim(v_auth_email));

  -- Consume first; any later failure rolls the consumption back with every grant.
  UPDATE public.staff_invitations si
  SET used_at = now(), used_by = p_user_id
  WHERE si.id = v_inv.id AND si.used_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_invite_used' USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  -- Profile: create for new accounts; existing rows only gain missing name/phone. Email untouched.
  INSERT INTO public.profiles AS pr (id, email, full_name, phone)
  VALUES (p_user_id, v_auth_email, NULLIF(btrim(p_full_name), ''), NULLIF(btrim(p_phone), ''))
  ON CONFLICT (id) DO UPDATE
  SET full_name = CASE
        WHEN NULLIF(btrim(pr.full_name), '') IS NULL THEN EXCLUDED.full_name
        ELSE pr.full_name
      END,
      phone = CASE
        WHEN NULLIF(btrim(pr.phone), '') IS NULL THEN EXCLUDED.phone
        ELSE pr.phone
      END;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_user_id, v_inv.role)
  ON CONFLICT (user_id, role) DO NOTHING;

  IF v_inv.membership_role = 'adviser'::public.tenant_member_role THEN
    SELECT * INTO v_adv FROM public.advisor_profiles ap WHERE ap.user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
      IF p_advisor_code IS NULL OR p_advisor_code !~ '^[A-Z0-9]{5}$' THEN
        RAISE EXCEPTION 'staff_invite_retry_identifier' USING ERRCODE = 'unique_violation';
      END IF;
      IF EXISTS (SELECT 1 FROM public.advisor_profiles ap WHERE ap.code = p_advisor_code) THEN
        RAISE EXCEPTION 'staff_invite_retry_identifier' USING ERRCODE = 'unique_violation';
      END IF;
      INSERT INTO public.advisor_profiles (user_id, code, tenant_id)
      VALUES (p_user_id, p_advisor_code, v_inv.tenant_id);
    ELSIF v_adv.tenant_id IS NULL OR v_adv.tenant_id = v_inv.tenant_id THEN
      UPDATE public.advisor_profiles ap SET deleted_at = NULL WHERE ap.user_id = p_user_id;
    END IF;
    -- An advisor profile bound to another tenant is left untouched.

  ELSIF v_inv.membership_role IN (
    'owner'::public.tenant_member_role,
    'supervisor'::public.tenant_member_role,
    'general'::public.tenant_member_role
  ) THEN
    v_level := (v_inv.membership_role::text)::public.admin_level;
    v_new_rank := CASE v_level WHEN 'owner' THEN 3 WHEN 'supervisor' THEN 2 ELSE 1 END;
    SELECT * INTO v_admin FROM public.admin_profiles ap WHERE ap.user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.admin_profiles (user_id, level, tenant_id, granted_by, updated_at)
      VALUES (p_user_id, v_level, v_inv.tenant_id, v_inv.created_by, now());
    ELSIF v_admin.tenant_id IS DISTINCT FROM v_inv.tenant_id THEN
      -- admin_profiles is keyed by user only; never repoint or relevel another tenant's row.
      RAISE EXCEPTION 'staff_invite_admin_profile_conflict'
        USING ERRCODE = 'invalid_authorization_specification';
    ELSE
      v_existing_rank := CASE v_admin.level WHEN 'owner' THEN 3 WHEN 'supervisor' THEN 2 ELSE 1 END;
      IF v_new_rank > v_existing_rank THEN
        UPDATE public.admin_profiles ap
        SET level = v_level, granted_by = v_inv.created_by, updated_at = now()
        WHERE ap.user_id = p_user_id;
      END IF;
    END IF;

  ELSIF v_inv.membership_role = 'introducer'::public.tenant_member_role THEN
    SELECT * INTO v_intro FROM public.introducers i WHERE i.user_id = p_user_id FOR UPDATE;
    IF FOUND THEN
      IF v_intro.tenant_id IS DISTINCT FROM v_inv.tenant_id THEN
        -- introducers.user_id is globally unique; another tenant's row is never repointed.
        RAISE EXCEPTION 'staff_invite_introducer_conflict'
          USING ERRCODE = 'invalid_authorization_specification';
      END IF;
      -- An established introducer's id, company code, company name, slug and referral history
      -- are its business identity: a re-invite may only reactivate it, never re-home it.
      IF v_inv.create_company
         OR v_intro.company_code IS NULL
         OR v_intro.company_code IS DISTINCT FROM v_inv.company_code THEN
        RAISE EXCEPTION 'staff_invite_introducer_company_conflict'
          USING ERRCODE = 'invalid_authorization_specification';
      END IF;
      UPDATE public.introducers i
      SET active = true,
          deleted_at = NULL
      WHERE i.id = v_intro.id;
    ELSE
      IF v_inv.create_company THEN
        v_company_code := p_company_code;
        IF v_company_code IS NULL OR v_company_code !~ '^[0-9]{4}$' THEN
          RAISE EXCEPTION 'staff_invite_retry_identifier' USING ERRCODE = 'unique_violation';
        END IF;
        IF EXISTS (SELECT 1 FROM public.introducers i WHERE i.company_code = v_company_code) THEN
          RAISE EXCEPTION 'staff_invite_retry_identifier' USING ERRCODE = 'unique_violation';
        END IF;
      ELSE
        v_company_code := v_inv.company_code;
        SELECT i.company_name INTO v_company_name
        FROM public.introducers i
        WHERE i.company_code = v_company_code AND i.tenant_id = v_inv.tenant_id
        LIMIT 1;
        IF v_company_code IS NULL OR NOT FOUND THEN
          RAISE EXCEPTION 'staff_invite_company_missing'
            USING ERRCODE = 'invalid_authorization_specification';
        END IF;
      END IF;

      IF p_introducer_slug IS NULL OR p_introducer_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
         OR EXISTS (SELECT 1 FROM public.introducers i WHERE i.slug = p_introducer_slug) THEN
        RAISE EXCEPTION 'staff_invite_retry_identifier' USING ERRCODE = 'unique_violation';
      END IF;
      SELECT pr.full_name INTO v_profile_name FROM public.profiles pr WHERE pr.id = p_user_id;
      INSERT INTO public.introducers (
        user_id, company_name, slug, contact_email, active, company_code, tenant_id
      )
      VALUES (
        p_user_id,
        COALESCE(
          v_company_name,
          NULLIF(btrim(v_profile_name), ''),
          NULLIF(split_part(v_auth_email, '@', 1), ''),
          'introducer'
        ),
        p_introducer_slug,
        v_auth_email,
        true,
        v_company_code,
        v_inv.tenant_id
      );
    END IF;
  END IF;

  INSERT INTO public.tenant_memberships AS tm (tenant_id, user_id, role, active, created_by)
  VALUES (v_inv.tenant_id, p_user_id, v_inv.membership_role, true, v_inv.created_by)
  ON CONFLICT (user_id, tenant_id, role) DO UPDATE SET active = true;

  accepted_invitation_id := v_inv.id;
  accepted_tenant_id := v_inv.tenant_id;
  accepted_tenant_slug := v_tenant_slug;
  granted_role := v_inv.role;
  granted_membership_role := v_inv.membership_role;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_staff_invite(text, uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_staff_invite(text, uuid, text, text, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.accept_staff_invite(text, uuid, text, text, text, text, text) IS
  'G7F-4S3B: atomic staff invitation acceptance bound to the confirmed auth.users email of p_user_id. service_role only.';

-- ---------------------------------------------------------------------------
-- 5) Appointment-customer identity lookups (server-side re-entry and duplicate prevention).
--    Read-only, service_role only. Callers must fail closed on anything but one clean match.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_auth_identity_by_email(p_email text)
RETURNS TABLE (
  user_id uuid,
  appointment_identity boolean,
  disabled boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    u.id,
    COALESCE(u.raw_app_meta_data ->> 'mh_identity', '') = 'appointment_customer',
    (u.banned_until IS NOT NULL AND u.banned_until > now())
      OR u.deleted_at IS NOT NULL
      OR COALESCE(u.is_anonymous, false)
  FROM auth.users u
  WHERE lower(u.email) = lower(btrim(p_email))
    AND btrim(COALESCE(p_email, '')) <> ''
  ORDER BY u.id
  LIMIT 2;
$$;

REVOKE ALL ON FUNCTION public.lookup_auth_identity_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_auth_identity_by_email(text) TO service_role;

COMMENT ON FUNCTION public.lookup_auth_identity_by_email(text) IS
  'G7F-4S3D: exact Auth email lookup (at most 2 rows) for appointment-customer phone re-entry. service_role only.';

CREATE OR REPLACE FUNCTION public.lookup_appointment_identities_by_contact_email(p_email text)
RETURNS TABLE (user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id
  FROM auth.users u
  WHERE u.raw_app_meta_data ->> 'mh_identity' = 'appointment_customer'
    AND lower(btrim(u.raw_app_meta_data ->> 'contact_email')) = lower(btrim(p_email))
    AND btrim(COALESCE(p_email, '')) <> ''
  ORDER BY u.id
  LIMIT 3;
$$;

REVOKE ALL ON FUNCTION public.lookup_appointment_identities_by_contact_email(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_appointment_identities_by_contact_email(text) TO service_role;

COMMENT ON FUNCTION public.lookup_appointment_identities_by_contact_email(text) IS
  'G7F-4S3D: appointment-created identities whose booking contact email matches (at most 3 rows). service_role only.';
