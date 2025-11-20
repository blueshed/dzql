-- Authentication Functions
-- Required for DZQL WebSocket server

-- Enable pgcrypto extension for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Register new user
CREATE OR REPLACE FUNCTION register_user(p_email TEXT, p_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_id INT;
  salt TEXT;
  hash TEXT;
BEGIN
  -- Generate salt and hash password
  salt := gen_salt('bf', 10);
  hash := crypt(p_password, salt);

  -- Insert user (assumes users table has: id, email, name, password_hash)
  INSERT INTO users (email, name, password_hash)
  VALUES (p_email, split_part(p_email, '@', 1), hash)
  RETURNING id INTO user_id;

  RETURN _profile(user_id);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Email already exists' USING errcode = '23505';
END $$;

-- Login user
CREATE OR REPLACE FUNCTION login_user(p_email TEXT, p_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  user_record RECORD;
BEGIN
  SELECT id, email, name, password_hash
  INTO user_record
  FROM users
  WHERE email = p_email;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid credentials' USING errcode = '28000';
  END IF;

  IF NOT (user_record.password_hash = crypt(p_password, user_record.password_hash)) THEN
    RAISE EXCEPTION 'Invalid credentials' USING errcode = '28000';
  END IF;

  RETURN _profile(user_record.id);
END $$;

-- Get user profile (private function, called after login/register)
CREATE OR REPLACE FUNCTION _profile(p_user_id INT)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object('user_id', u.id) || (to_jsonb(u.*) - 'id' - 'password_hash' - 'password' - 'secret' - 'token')
  FROM users u
  WHERE id = p_user_id;
$$;
