-- Authentication System
-- Simple users table with login/register/profile functions

-- Enable pgcrypto extension for password hashing
create extension if not exists pgcrypto;

-- === Users Table ===
-- Minimal auth table - applications can add columns via migrations
-- Note: created_at is tracked via the action log, not here
create table if not exists users (
  id serial primary key,
  email text unique not null,
  password_hash text not null
);

-- === Auth Functions ===

-- Register new user
-- p_options: optional JSON object with additional fields to set on the user record
-- Example: register_user('test@example.com', 'password', '{"name": "Test User"}')
create or replace function register_user(p_email text, p_password text, p_options jsonb default null)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_user_id int;
  v_salt text;
  v_hash text;
  v_insert_data jsonb;
begin
  -- Generate salt and hash password
  v_salt := gen_salt('bf', 10);
  v_hash := crypt(p_password, v_salt);

  -- Build insert data: options fields + email + password_hash (options cannot override core fields)
  v_insert_data := jsonb_build_object('email', p_email, 'password_hash', v_hash);
  if p_options is not null then
    v_insert_data := (p_options - 'id' - 'email' - 'password_hash' - 'password') || v_insert_data;
  end if;

  -- Dynamic INSERT from JSONB (same pattern as compiled save functions)
  execute (
    select format(
      'INSERT INTO users (%s) VALUES (%s) RETURNING id',
      string_agg(quote_ident(key), ', '),
      string_agg(quote_nullable(value), ', ')
    )
    from jsonb_each_text(v_insert_data) kv(key, value)
  ) into v_user_id;

  return _profile(v_user_id);
exception
  when unique_violation then
    raise exception 'Email already exists' using errcode = '23505';
end $$;

-- Login user
create or replace function login_user(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
as $$
declare
  user_record record;
begin
  select id, email, password_hash
  into user_record
  from users
  where email = p_email;

  if not found then
    raise exception 'Invalid credentials' using errcode = '28000';
  end if;

  if not (user_record.password_hash = crypt(p_password, user_record.password_hash)) then
    raise exception 'Invalid credentials' using errcode = '28000';
  end if;

  return _profile(user_record.id);
end $$;

-- Get user profile (private function)
-- Returns all user columns except sensitive fields (password_hash, password, secret, token)
-- This allows the users table to have any additional columns without modifying this function
create or replace function _profile(p_user_id int)
returns jsonb
language sql
security definer
as $$
  select jsonb_build_object('user_id', u.id) || (to_jsonb(u.*) - 'id' - 'password_hash' - 'password' - 'secret' - 'token')
  from users u
  where id = p_user_id;
$$;
