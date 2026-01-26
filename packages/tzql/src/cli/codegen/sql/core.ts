import type { EntityIR, ColumnInfo } from "./types.js";
import { stripFKReferences } from "./utils.js";

/**
 * Generate core DZQL schema SQL (migrations table, events table, etc.)
 */
export function generateCoreSQL() {
  return `
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
  affected_keys text[] DEFAULT ARRAY[]::text[],
  notify_users int[] DEFAULT ARRAY[]::int[],
  created_at timestamptz DEFAULT now()
);

-- Commit Sequence
CREATE SEQUENCE IF NOT EXISTS dzql_v2.commit_seq;

-- Default compute_affected_keys (returns empty array, overwritten when subscribables exist)
CREATE OR REPLACE FUNCTION dzql_v2.compute_affected_keys(
  p_table TEXT,
  p_op TEXT,
  p_data JSONB
) RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN ARRAY[]::text[];
END;
$$;
`;
}

/**
 * Generate auth SQL functions.
 * These depend on the 'users' table existing, so must be applied after schema.
 */
export function generateAuthSQL() {
  return `
-- === AUTH SYSTEM ===
-- These functions depend on a 'users' table being created by the domain schema.
-- The users table must have: id (serial PK), email (text unique), password_hash (text)
-- Additional columns can be added and will be returned by _profile() automatically.

-- Get user profile (private function)
-- Returns all user columns except sensitive fields (password_hash, password, secret, token)
-- This allows the users table to have any additional columns without modifying this function
CREATE OR REPLACE FUNCTION dzql_v2._profile(p_user_id int)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
  SELECT jsonb_build_object('user_id', u.id) || (to_jsonb(u.*) - 'id' - 'password_hash' - 'password' - 'secret' - 'token')
  FROM users u
  WHERE id = p_user_id;
$$;

-- Register new user
-- p_email: User's email address (must be unique)
-- p_password: User's password (will be hashed)
-- p_options: Optional JSON object with additional fields to set on the user record
-- Example: register_user('test@example.com', 'password', '{"name": "Test User"}')
CREATE OR REPLACE FUNCTION dzql_v2.register_user(p_email text, p_password text, p_options jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_user_id int;
  v_salt text;
  v_hash text;
  v_insert_data jsonb;
BEGIN
  IF p_email IS NULL OR p_password IS NULL THEN
    RAISE EXCEPTION 'validation_error: email and password required';
  END IF;

  -- Generate salt and hash password
  v_salt := gen_salt('bf', 10);
  v_hash := crypt(p_password, v_salt);

  -- Build insert data: options fields + email + password_hash (options cannot override core fields)
  v_insert_data := jsonb_build_object('email', p_email, 'password_hash', v_hash);
  IF p_options IS NOT NULL THEN
    v_insert_data := (p_options - 'id' - 'email' - 'password_hash' - 'password') || v_insert_data;
  END IF;

  -- Dynamic INSERT from JSONB (same pattern as compiled save functions)
  EXECUTE (
    SELECT format(
      'INSERT INTO users (%s) VALUES (%s) RETURNING id',
      string_agg(quote_ident(key), ', '),
      string_agg(quote_nullable(value), ', ')
    )
    FROM jsonb_each_text(v_insert_data) kv(key, value)
  ) INTO v_user_id;

  -- Return profile (Token generation happens in Runtime layer)
  RETURN dzql_v2._profile(v_user_id);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'validation_error: Email already exists' USING ERRCODE = '23505';
END;
$$;

-- Login user
-- p_email: User's email address
-- p_password: User's password
CREATE OR REPLACE FUNCTION dzql_v2.login_user(p_email text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_user record;
BEGIN
  SELECT id, email, password_hash
  INTO v_user
  FROM users
  WHERE email = p_email;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'permission_denied: invalid credentials' USING ERRCODE = '28000';
  END IF;

  IF NOT (v_user.password_hash = crypt(p_password, v_user.password_hash)) THEN
    RAISE EXCEPTION 'permission_denied: invalid credentials' USING ERRCODE = '28000';
  END IF;

  RETURN dzql_v2._profile(v_user.id);
END;
$$;
`;
}

/**
 * Generate CREATE TABLE SQL for an entity.
 * @param name - Entity/table name
 * @param entityIR - Entity IR definition
 * @param circularFKs - Set of "table.column" strings for circular FK columns to defer
 */
export function generateSchemaSQL(name: string, entityIR: EntityIR, circularFKs?: Set<string>): string {
  const temporal = entityIR.temporal;
  let sequenceSQL = '';

  // For temporal entities, create the ref sequence first
  if (temporal) {
    const sequenceName = temporal.sequence || `${name}_ref_seq`;
    sequenceSQL = `CREATE SEQUENCE IF NOT EXISTS ${sequenceName};\n`;
  }

  const columns = entityIR.columns.map((c: ColumnInfo) => {
    let colType = c.type;

    // If this column is part of a circular FK, strip the REFERENCES clause
    // The constraint will be added later via ALTER TABLE
    if (circularFKs && circularFKs.has(`${name}.${c.name}`)) {
      colType = stripFKReferences(colType);
    }

    return `${c.name} ${colType}`;
  }).join(',\n  ');

  return `${sequenceSQL}
CREATE TABLE IF NOT EXISTS ${name} (
  ${columns}
);
`;
}
