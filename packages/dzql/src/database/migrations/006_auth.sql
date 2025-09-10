-- Authentication System
-- Simple users table with login/register/profile functions

-- Enable pgcrypto extension for password hashing
create extension if not exists pgcrypto;

-- === Users Table ===
create table if not exists users (
  id serial primary key,
  email text unique not null,
  name text not null,
  password_hash text not null,
  created_at timestamptz default now()
);

-- === Auth Functions ===

-- Register new user
create or replace function register_user(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
as $$
declare
  user_id int;
  salt text;
  hash text;
begin
  -- Generate salt and hash password
  salt := gen_salt('bf', 10);
  hash := crypt(p_password, salt);

  -- Insert user
  insert into users (email, name, password_hash)
  values (p_email, split_part(p_email, '@', 1), hash)
  returning id into user_id;

  return _profile(user_id);
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
  select id, email, name, password_hash
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
create or replace function _profile(p_user_id int)
returns jsonb
language sql
security definer
as $$
  select jsonb_build_object(
    'user_id', id,
    'email', email,
    'name', name,
    'created_at', created_at
  )
  from users
  where id = p_user_id;
$$;
