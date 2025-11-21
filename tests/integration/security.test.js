/**
 * Security Tests
 *
 * Tests that DZQL properly prevents security vulnerabilities:
 * - SQL injection in all operations
 * - Parameter validation
 * - Sensitive field filtering (password_hash)
 * - Permission bypass attempts
 *
 * Contract: TEST_CONTRACT.md Section 17
 */

import { describe, test, expect, beforeAll } from "bun:test";
import {
  setupTests,
  createTestUser,
  testEmail,
} from "../setup/test-helpers.js";

const { sql } = setupTests();

describe("Security", () => {
  let testUserId;

  beforeAll(async () => {
    await sql`DROP TABLE IF EXISTS items CASCADE`;
    await sql`
      CREATE TABLE items (
        id serial PRIMARY KEY,
        name text NOT NULL,
        description text,
        owner_id int
      )
    `;

    await sql`
      SELECT dzql.register_entity(
        'items',
        'name',
        array['name', 'description'],
        '{}',
        false,
        '{}',
        '{}',
        jsonb_build_object(
          'view', array[]::text[],
          'create', array[]::text[],
          'update', array['@owner_id'],
          'delete', array['@owner_id']
        )
      )
    `;

    const user = await createTestUser(sql);
    testUserId = user.user_id;
  });

  test("SQL injection prevented in name field", async () => {
    const maliciousName = "'; DROP TABLE items; --";

    const result = await sql`
      SELECT dzql.save_items(${sql.json({
        name: maliciousName,
        description: "Test",
        owner_id: testUserId,
      })}, ${testUserId}) as item
    `;

    // Table should still exist
    expect(result[0].item.name).toBe(maliciousName);

    // Verify table wasn't dropped
    const check = await sql`
      SELECT COUNT(*) as count FROM items
    `;
    expect(Number(check[0].count)).toBeGreaterThan(0);
  });

  test("SQL injection prevented in search filter", async () => {
    const maliciousSearch = "x' OR '1'='1";

    // Should not return all records
    const result = await sql`
      SELECT dzql.search_items(${sql.json({
        filters: { _search: maliciousSearch },
      })}, ${testUserId}) as result
    `;

    // Should treat as literal search string, not SQL
    expect(result[0].result.data).toBeArray();
  });

  test("SQL injection prevented in ID parameter", async () => {
    const maliciousId = "1 OR 1=1";

    await expect(async () => {
      await sql`
        SELECT dzql.get_items(${sql.json({
          id: maliciousId,
        })}, ${testUserId}) as item
      `;
    }).toThrow(); // Should error, not return all records
  });

  test("Password hash never exposed in results", async () => {
    // Create a user directly
    const uniqueEmail = testEmail("security");
    const result = await sql`
      SELECT register_user(${uniqueEmail}, 'password123') as user
    `;

    // Result should never contain password_hash
    expect(result[0].user).not.toHaveProperty("password_hash");
    expect(result[0].user).not.toHaveProperty("password");
  });

  test("Password hash not exposed in _profile", async () => {
    const profile = await sql`
      SELECT _profile(${testUserId}) as profile
    `;

    expect(profile[0].profile).not.toHaveProperty("password_hash");
    expect(profile[0].profile).not.toHaveProperty("password");
  });

  test("Cannot bypass permissions with crafted JSON", async () => {
    // Create item owned by testUserId
    const created = await sql`
      SELECT dzql.save_items(${sql.json({
        name: "Protected Item",
        owner_id: testUserId,
      })}, ${testUserId}) as item
    `;
    const itemId = created[0].item.id;

    // Create another user
    const other = await createTestUser(sql);
    const otherId = other.user_id;

    // Try to bypass permission by including owner_id in update
    await expect(async () => {
      await sql`
        SELECT dzql.save_items(${sql.json({
          id: itemId,
          name: "Hacked",
          owner_id: otherId, // Try to change owner
        })}, ${otherId}) as item
      `;
    }).toThrow(/Permission denied/);
  });

  test("XSS payloads stored safely", async () => {
    const xssPayload = '<script>alert("XSS")</script>';

    const result = await sql`
      SELECT dzql.save_items(${sql.json({
        name: xssPayload,
        description: "<img src=x onerror=alert(1)>",
        owner_id: testUserId,
      })}, ${testUserId}) as item
    `;

    // Should store the literal strings without executing
    expect(result[0].item.name).toBe(xssPayload);
    expect(result[0].item.description).toBe("<img src=x onerror=alert(1)>");
  });

  test("Unicode and special characters handled safely", async () => {
    const specialChars =
      "测试 émojis 🎉 tabs\t\nnewlines\r\n quotes'\"backslash\\";

    const result = await sql`
      SELECT dzql.save_items(${sql.json({
        name: "Unicode Test",
        description: specialChars,
        owner_id: testUserId,
      })}, ${testUserId}) as item
    `;

    expect(result[0].item.description).toBe(specialChars);
  });

  test("JSONB injection prevented", async () => {
    const maliciousJson = '{"id": 999, "owner_id": 1}';

    // Try to inject via string that looks like JSON
    const result = await sql`
      SELECT dzql.save_items(${sql.json({
        name: maliciousJson,
        owner_id: testUserId,
      })}, ${testUserId}) as item
    `;

    // Should treat as literal string, not parse
    expect(result[0].item.name).toBe(maliciousJson);
    expect(result[0].item.owner_id).toBe(testUserId);
  });
});
