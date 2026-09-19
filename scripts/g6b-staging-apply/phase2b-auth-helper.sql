-- G6B Phase 2B — staging-only synthetic Auth, memberships, and minimal UAT rows.
-- Target: fwgjtbeigpipvayytwlu only. No production identities. No live comms.
-- Passwords are generated in-database and stored in g6b_private.staging_credentials.
-- Do NOT SELECT that table from agent chat.

CREATE SCHEMA IF NOT EXISTS g6b_private;
REVOKE ALL ON SCHEMA g6b_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA g6b_private TO postgres, service_role;

CREATE TABLE IF NOT EXISTS g6b_private.staging_credentials (
  email text PRIMARY KEY,
  password text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE g6b_private.staging_credentials FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE g6b_private.staging_credentials TO postgres, service_role;

CREATE OR REPLACE FUNCTION g6b_private.create_persona(
  p_email text,
  p_full_name text,
  p_phone text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public, extensions, g6b_private
AS $$
DECLARE
  v_id uuid;
  v_pw text;
BEGIN
  IF p_email NOT LIKE '%@example.test' THEN
    RAISE EXCEPTION 'G6B STOP: persona email must use @example.test';
  END IF;
  IF lower(p_email) IN (
    'pmabbott2@aol.com','1@test.co.uk','4@test.co.uk','5@test.co.uk','6@test.co.uk','13@test.co.uk'
  ) THEN
    RAISE EXCEPTION 'G6B STOP: production identity refused';
  END IF;

  SELECT id INTO v_id FROM auth.users WHERE lower(email) = lower(p_email);
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  v_id := gen_random_uuid();
  v_pw := encode(extensions.gen_random_bytes(24), 'base64');

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, reauthentication_token, phone_change, phone_change_token,
    is_sso_user, is_anonymous
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_id,
    'authenticated',
    'authenticated',
    lower(p_email),
    extensions.crypt(v_pw, extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name, 'phone', p_phone),
    '', '', '', '', '', '', '', '',
    false, false
  );

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at, email
  ) VALUES (
    gen_random_uuid(),
    v_id,
    jsonb_build_object('sub', v_id::text, 'email', lower(p_email)),
    'email',
    v_id::text,
    now(), now(), now(),
    lower(p_email)
  );

  INSERT INTO g6b_private.staging_credentials (email, password)
  VALUES (lower(p_email), v_pw)
  ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password, created_at = now();

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION g6b_private.create_persona(text, text, text) FROM PUBLIC, anon, authenticated;
