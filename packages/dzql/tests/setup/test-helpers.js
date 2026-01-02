/**
 * Test helper utilities
 */

import { createTestConnection, cleanTestData } from "./db-setup.js";

/**
 * Global test database connection
 */
export let testSql = null;

/**
 * Initialize test database connection
 */
export function initTestDb() {
  if (!testSql) {
    testSql = createTestConnection();
  }
  return testSql;
}

/**
 * Get the test database connection (creates if needed)
 */
export function getTestDb() {
  return testSql || initTestDb();
}

/**
 * Close test database connection
 */
export async function closeTestDb() {
  if (testSql) {
    await testSql.end();
    testSql = null;
  }
}

/**
 * Clean data between tests
 */
export async function cleanBetweenTests() {
  const sql = getTestDb();
  await cleanTestData(sql);
}

/**
 * Setup for test file - import this in your test files
 */
export function setupTests() {
  const sql = initTestDb();

  // Return helper object
  return {
    sql,
    cleanData: () => cleanTestData(sql),
  };
}

/**
 * Generate unique test email
 */
export function testEmail(prefix = "test") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}@test.com`;
}

/**
 * Generate unique test name
 */
export function testName(prefix = "Test") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Retry a database operation with exponential backoff
 */
export async function retryOperation(operation, maxRetries = 3) {
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (i < maxRetries - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, i) * 100),
        );
      }
    }
  }

  throw lastError;
}

/**
 * Assert that a promise throws an error
 */
export async function assertThrows(fn, expectedCode = null) {
  let threw = false;
  let error = null;

  try {
    await fn();
  } catch (e) {
    threw = true;
    error = e;
  }

  if (!threw) {
    throw new Error("Expected function to throw an error");
  }

  if (expectedCode && error.code !== expectedCode) {
    throw new Error(`Expected error code ${expectedCode}, got ${error.code}`);
  }

  return error;
}

/**
 * Create a test user and return their profile
 * @param {object} sql - Database connection
 * @param {string} email - Email address (optional, generates random if not provided)
 * @param {string} password - Password (default: testpass123)
 * @param {object} extra - Extra fields to pass to register_user (e.g., { name: 'Test' })
 *                         If not provided, no extra fields are passed (core users table has no name)
 */
export async function createTestUser(
  sql,
  email = null,
  password = "testpass123",
  extra = null,
) {
  if (!email) {
    email = testEmail();
  }

  // Only pass extra if explicitly provided - core users table has no name column
  if (extra !== null) {
    const result = await sql`
      SELECT register_user(${email}, ${password}, ${sql.json(extra)}) as result
    `;
    return result[0].result;
  }

  const result = await sql`
    SELECT register_user(${email}, ${password}) as result
  `;
  return result[0].result;
}
