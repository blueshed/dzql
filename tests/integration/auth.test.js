/**
 * Authentication tests - register_user, login_user, _profile functions
 * Migrated from packages/venues/tests/auth.test.js
 */

import { test, expect, afterAll, beforeAll } from "bun:test";
import { setupTests, testEmail, assertThrows } from '../setup/test-helpers.js';

const { sql } = setupTests();

// Track test users for cleanup
const testUsers = [];

beforeAll(async () => {
  // Ensure users table exists (migrations should have created it)
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id serial PRIMARY KEY,
      name text NOT NULL,
      email text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      created_at timestamptz DEFAULT now()
    )
  `;
});

afterAll(async () => {
  // Clean up test users
  if (testUsers.length > 0) {
    await sql`
      DELETE FROM users
      WHERE email = ANY(${testUsers})
    `;
  }
});

test("register_user function creates new user", async () => {
  const email = testEmail('auth-register');
  testUsers.push(email);

  const result = await sql`
    SELECT register_user(${email}, 'password123') as result
  `;

  expect(result[0].result).toBeDefined();
  expect(result[0].result.email).toBe(email);
  expect(result[0].result.user_id).toBeDefined();
  expect(result[0].result.name).toBe(email.split('@')[0]); // email prefix
  expect(result[0].result.created_at).toBeDefined();
  // Ensure password_hash is not exposed
  expect(result[0].result.password_hash).toBeUndefined();
});

test("login_user function authenticates correctly", async () => {
  const email = testEmail('auth-login');
  testUsers.push(email);

  // First register a user
  await sql`
    SELECT register_user(${email}, 'password123')
  `;

  // Then test login
  const result = await sql`
    SELECT login_user(${email}, 'password123') as result
  `;

  expect(result[0].result).toBeDefined();
  expect(result[0].result.email).toBe(email);
  expect(result[0].result.user_id).toBeDefined();
  expect(result[0].result.name).toBe(email.split('@')[0]);
  expect(result[0].result.created_at).toBeDefined();
  expect(result[0].result.password_hash).toBeUndefined();
});

test("_profile function returns user profile", async () => {
  const email = testEmail('auth-profile');
  testUsers.push(email);

  // First register a user
  const registerResult = await sql`
    SELECT register_user(${email}, 'password123') as result
  `;

  // Then test profile retrieval
  const userId = registerResult[0].result.user_id;
  const result = await sql`
    SELECT _profile(${userId}) as result
  `;

  expect(result[0].result).toBeDefined();
  expect(result[0].result.email).toBe(email);
  expect(result[0].result.user_id).toBe(userId);
  expect(result[0].result.name).toBe(email.split('@')[0]);
  expect(result[0].result.created_at).toBeDefined();
  expect(result[0].result.password_hash).toBeUndefined();
});

test("login_user rejects invalid credentials", async () => {
  const email = testEmail('auth-invalid');
  testUsers.push(email);

  // Test login with non-existent email
  await assertThrows(
    async () => {
      await sql`SELECT login_user('nonexistent@example.com', 'password123')`;
    },
    '28000' // Invalid authorization
  );

  // Register a user
  await sql`SELECT register_user(${email}, 'password123')`;

  // Test login with wrong password
  await assertThrows(
    async () => {
      await sql`SELECT login_user(${email}, 'wrongpassword')`;
    },
    '28000' // Invalid authorization
  );
});

test("register_user rejects duplicate email", async () => {
  const email = testEmail('auth-duplicate');
  testUsers.push(email);

  // First register a user
  const firstResult = await sql`
    SELECT register_user(${email}, 'password123') as result
  `;
  expect(firstResult[0].result).toBeDefined();

  // Try to register same email again - should throw unique violation error
  await assertThrows(
    async () => {
      await sql`SELECT register_user(${email}, 'password456')`;
    },
    '23505' // Unique violation
  );
});

test("register_user hashes password securely", async () => {
  const email = testEmail('auth-hash');
  testUsers.push(email);

  await sql`SELECT register_user(${email}, 'password123')`;

  // Verify password is hashed (not stored in plain text)
  const result = await sql`
    SELECT password_hash FROM users WHERE email = ${email}
  `;

  expect(result[0].password_hash).toBeDefined();
  expect(result[0].password_hash).not.toBe('password123');
  // bcrypt hashes start with $2a$, $2b$, or $2y$
  expect(result[0].password_hash).toMatch(/^\$2[aby]\$/);
});

test("_profile returns null for non-existent user", async () => {
  const result = await sql`
    SELECT _profile(999999) as result
  `;

  expect(result[0].result).toBeNull();
});
