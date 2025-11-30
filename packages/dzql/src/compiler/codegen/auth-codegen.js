/**
 * Auth Code Generator
 * Generates PostgreSQL functions for user authentication
 * Only generated when the entity is named 'users'
 */

export class AuthCodegen {
  constructor(entity) {
    this.entity = entity;
    this.tableName = entity.tableName;
  }

  /**
   * Check if this entity should have auth functions generated
   * @returns {boolean}
   */
  shouldGenerate() {
    return this.tableName === 'users';
  }

  /**
   * Generate all auth functions
   * @returns {string} SQL for auth functions
   */
  generateAll() {
    if (!this.shouldGenerate()) {
      return '';
    }

    return [
      '-- Enable pgcrypto extension for password hashing',
      'CREATE EXTENSION IF NOT EXISTS pgcrypto;',
      '',
      this._generateProfileFunction(),
      this._generateRegisterFunction(),
      this._generateLoginFunction()
    ].join('\n\n');
  }

  /**
   * Generate _profile function
   * Returns all user columns except sensitive fields
   * @private
   */
  _generateProfileFunction() {
    return `-- ============================================================================
-- Auth: _profile function for ${this.tableName}
-- Returns user record minus sensitive fields
-- ============================================================================
CREATE OR REPLACE FUNCTION _profile(p_user_id INT)
RETURNS JSONB
LANGUAGE SQL
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object('user_id', u.id) || (to_jsonb(u.*) - 'id' - 'password_hash' - 'password' - 'secret' - 'token')
  FROM ${this.tableName} u
  WHERE id = p_user_id;
$$;`;
  }

  /**
   * Generate register_user function
   * Supports optional fields via JSON parameter
   * @private
   */
  _generateRegisterFunction() {
    return `-- ============================================================================
-- Auth: register_user function for ${this.tableName}
-- p_options: optional JSON object with additional fields to set on the user record
-- Example: register_user('test@example.com', 'password', '{"name": "Test User"}')
-- ============================================================================
CREATE OR REPLACE FUNCTION register_user(p_email TEXT, p_password TEXT, p_options JSONB DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id INT;
  v_salt TEXT;
  v_hash TEXT;
  v_insert_data JSONB;
BEGIN
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
      'INSERT INTO ${this.tableName} (%s) VALUES (%s) RETURNING id',
      string_agg(quote_ident(key), ', '),
      string_agg(quote_nullable(value), ', ')
    )
    FROM jsonb_each_text(v_insert_data) kv(key, value)
  ) INTO v_user_id;

  RETURN _profile(v_user_id);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Email already exists' USING errcode = '23505';
END $$;`;
  }

  /**
   * Generate login_user function
   * @private
   */
  _generateLoginFunction() {
    return `-- ============================================================================
-- Auth: login_user function for ${this.tableName}
-- ============================================================================
CREATE OR REPLACE FUNCTION login_user(p_email TEXT, p_password TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_record RECORD;
BEGIN
  SELECT id, email, password_hash
  INTO v_user_record
  FROM ${this.tableName}
  WHERE email = p_email;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid credentials' USING errcode = '28000';
  END IF;

  IF NOT (v_user_record.password_hash = crypt(p_password, v_user_record.password_hash)) THEN
    RAISE EXCEPTION 'Invalid credentials' USING errcode = '28000';
  END IF;

  RETURN _profile(v_user_record.id);
END $$;`;
  }
}

/**
 * Generate auth functions for an entity (only if it's the users table)
 * @param {Object} entity - Entity configuration
 * @returns {string} SQL for auth functions (empty string if not users table)
 */
export function generateAuthFunctions(entity) {
  const codegen = new AuthCodegen(entity);
  return codegen.generateAll();
}
