import { test, expect, afterAll } from "bun:test";
import { sql } from "../server/db.js";

afterAll(async () => {
  // Clean up test users
  await sql`
    DELETE FROM users
    WHERE email IN ('auth-test-1@example.com', 'auth-test-2@example.com', 'auth-test-3@example.com', 'auth-test-duplicate@example.com')
  `;
});

test("register_user function", async () => {
  const result = await sql`
    SELECT register_user('auth-test-1@example.com', 'password123') as result
  `;
  expect(result[0].result).toBeDefined();
  expect(result[0].result.email).toBe("auth-test-1@example.com");
  expect(result[0].result.user_id).toBeDefined();
  expect(result[0].result.name).toBe("auth-test-1"); // email prefix
  expect(result[0].result.created_at).toBeDefined();
});

test("login_user function", async () => {
  // First register a user
  await sql`
    SELECT register_user('auth-test-2@example.com', 'password123')
  `;

  // Then test login
  const result = await sql`
    SELECT login_user('auth-test-2@example.com', 'password123') as result
  `;
  expect(result[0].result).toBeDefined();
  expect(result[0].result.email).toBe("auth-test-2@example.com");
  expect(result[0].result.user_id).toBeDefined();
  expect(result[0].result.name).toBe("auth-test-2");
  expect(result[0].result.created_at).toBeDefined();
});

test("_profile function", async () => {
  // First register a user
  const registerResult = await sql`
    SELECT register_user('auth-test-3@example.com', 'password123') as result
  `;

  // Then test profile retrieval
  const userId = registerResult[0].result.user_id;
  const result = await sql`
    SELECT _profile(${userId}) as result
  `;
  expect(result[0].result).toBeDefined();
  expect(result[0].result.email).toBe("auth-test-3@example.com");
  expect(result[0].result.user_id).toBe(userId);
  expect(result[0].result.name).toBe("auth-test-3");
  expect(result[0].result.created_at).toBeDefined();
});

test("login_user function - invalid credentials", async () => {
  let threwError = false;

  // Test login with non-existent email
  try {
    await sql`
      SELECT login_user('nonexistent@example.com', 'password123') as result
    `;
  } catch (error) {
    threwError = true;
    expect(error.code).toBe("28000"); // Invalid authorization
  }
  expect(threwError).toBe(true);

  // Test login with wrong password (using existing user from previous test)
  threwError = false;
  try {
    await sql`
      SELECT login_user('auth-test-2@example.com', 'wrongpassword') as result
    `;
  } catch (error) {
    threwError = true;
    expect(error.code).toBe("28000"); // Invalid authorization
  }
  expect(threwError).toBe(true);
});

test("register_user function - duplicate email", async () => {
  // First register a user
  const firstResult = await sql`
    SELECT register_user('auth-test-duplicate@example.com', 'password123') as result
  `;
  expect(firstResult[0].result).toBeDefined();

  // Try to register same email again - should throw unique violation error
  let threwError = false;
  try {
    await sql`
      SELECT register_user('auth-test-duplicate@example.com', 'password456') as result
    `;
  } catch (error) {
    threwError = true;
    expect(error.code).toBe("23505"); // Unique violation
  }
  expect(threwError).toBe(true);
});
