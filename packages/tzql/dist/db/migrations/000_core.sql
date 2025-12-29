
-- DZQL V2 Core Schema
CREATE SCHEMA IF NOT EXISTS dzql_v2;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Migrations Table
CREATE TABLE IF NOT EXISTS dzql_v2.migrations (
  id text PRIMARY KEY,
  applied_at timestamptz DEFAULT now(),
  checksum text NOT NULL,
  name text NOT NULL
);

-- Events Table (Normalized Row Events)
CREATE TABLE IF NOT EXISTS dzql_v2.events (
  id bigserial PRIMARY KEY,
  commit_id bigint NOT NULL,
  table_name text NOT NULL,
  op text NOT NULL,
  pk jsonb NOT NULL,
  data jsonb,
  old_data jsonb,
  user_id int,
  created_at timestamptz DEFAULT now()
);

-- Commit Sequence
CREATE SEQUENCE IF NOT EXISTS dzql_v2.commit_seq;

-- === AUTH FUNCTIONS ===

-- Register User
CREATE OR REPLACE FUNCTION dzql_v2.register_user(p_params jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_user_id int;
  v_email text;
  v_password text;
  v_name text;
  v_options jsonb;
BEGIN
  v_email := p_params->>'email';
  v_password := p_params->>'password';
  v_name := COALESCE(p_params->>'name', v_email);
  v_options := COALESCE(p_params->'options', '{}'::jsonb);

  IF v_email IS NULL OR v_password IS NULL THEN
    RAISE EXCEPTION 'validation_error: email and password required';
  END IF;

  INSERT INTO users (email, password_hash, name)
  VALUES (v_email, crypt(v_password, gen_salt('bf')), v_name)
  RETURNING id INTO v_user_id;

  -- TODO: Handle v_options if needed (e.g. creating orgs)

  -- Return minimal profile (Token generation happens in Runtime layer)
  RETURN jsonb_build_object(
    'user_id', v_user_id,
    'email', v_email,
    'name', v_name
  );
END;
$$;

-- Login User
CREATE OR REPLACE FUNCTION dzql_v2.login_user(p_params jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_user record;
BEGIN
  SELECT * INTO v_user FROM users WHERE email = p_params->>'email';

  IF v_user IS NULL OR v_user.password_hash != crypt(p_params->>'password', v_user.password_hash) THEN
    RAISE EXCEPTION 'permission_denied: invalid credentials';
  END IF;

  RETURN jsonb_build_object(
    'user_id', v_user.id,
    'email', v_user.email,
    'name', v_user.name
  );
END;
$$;
