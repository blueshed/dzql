import { test, expect, beforeAll, afterAll } from "bun:test";
import { sql, db } from "dzql";

/**
 * Tests for Graph Rules Validation Features
 * Tests the new 'validate' and 'execute' action types added in migration 010
 */

const PREFIX = `GV_${Date.now()}`;
let testUserId;
let testOrgId;

beforeAll(async () => {
  // Create test user
  const testEmail = `${PREFIX.toLowerCase()}_user@test.local`;
  await sql`DELETE FROM users WHERE email = ${testEmail}`;
  const userResult = await sql`
    SELECT register_user(${testEmail}, 'password123') as user_data
  `;
  testUserId = userResult[0].user_data.user_id;

  // Create test organization
  const orgResult = await db.api.save.organisations(
    { name: `${PREFIX}_Test_Org` },
    testUserId
  );
  testOrgId = orgResult.id;

  // Set up test entity with validation rules

  // Create test table for validation
  await sql`
    CREATE TABLE IF NOT EXISTS test_validation (
      id SERIAL PRIMARY KEY,
      name TEXT,
      value INT,
      status TEXT DEFAULT 'draft',
      org_id INT REFERENCES organisations(id)
    )
  `;

  // Create validation function
  await sql`
    CREATE OR REPLACE FUNCTION validate_positive_value(p_value INT)
    RETURNS BOOLEAN
    LANGUAGE sql
    IMMUTABLE AS $$
      SELECT p_value > 0;
    $$
  `;

  // Create always_false function for unconditional rejection
  await sql`
    CREATE OR REPLACE FUNCTION always_false()
    RETURNS BOOLEAN
    LANGUAGE sql
    IMMUTABLE AS $$
      SELECT false;
    $$
  `;

  // Register entity with validation rules
  await sql`
    SELECT dzql.register_entity(
      'test_validation',
      'name',
      array['name'],
      '{}',
      false,
      '{}',
      '{}',
      '{
        "view": [],
        "create": [],
        "update": [],
        "delete": []
      }',
      '{
        "on_create": {
          "validate_positive": {
            "description": "Ensure value is positive",
            "actions": [{
              "type": "validate",
              "function": "validate_positive_value",
              "params": {"p_value": "@value"},
              "error_message": "Value must be positive"
            }]
          }
        },
        "on_update": {
          "prevent_posted_modification": {
            "description": "Prevent modification of posted records",
            "condition": "@before.status = ''posted''",
            "actions": [{
              "type": "validate",
              "function": "always_false",
              "params": {},
              "error_message": "Cannot modify posted record"
            }]
          }
        }
      }'
    )
  `;
});

afterAll(async () => {
  // Clean up
  await sql`DROP TABLE IF EXISTS test_validation CASCADE`;
  await sql`DELETE FROM dzql.entities WHERE table_name = 'test_validation'`;
  await sql`DELETE FROM organisations WHERE id = ${testOrgId}`;
  await sql`DELETE FROM users WHERE id = ${testUserId}`;
});

test("Validation: Accept valid data", async () => {
  const result = await db.api.save.test_validation(
    {
      name: `${PREFIX}_valid`,
      value: 100,
      org_id: testOrgId,
    },
    testUserId
  );

  expect(result).toBeDefined();
  expect(result.id).toBeDefined();
  expect(result.value).toBe(100);
});

test("Validation: Reject invalid data with custom error", async () => {
  await expect(
    db.api.save.test_validation(
      {
        name: `${PREFIX}_invalid`,
        value: -10, // Negative value should fail validation
        org_id: testOrgId,
      },
      testUserId
    )
  ).rejects.toThrow("Value must be positive");
});

test("Condition: Execute rule only when condition matches", async () => {
  // Create draft record (should succeed)
  const draft = await db.api.save.test_validation(
    {
      name: `${PREFIX}_draft`,
      value: 50,
      status: "draft",
      org_id: testOrgId,
    },
    testUserId
  );

  // Modify draft record (should succeed - condition doesn't match)
  const updated = await db.api.save.test_validation(
    {
      id: draft.id,
      value: 75,
    },
    testUserId
  );
  expect(updated.value).toBe(75);

  // Post the record
  await db.api.save.test_validation(
    {
      id: draft.id,
      status: "posted",
    },
    testUserId
  );

  // Try to modify posted record (should fail - condition matches)
  await expect(
    db.api.save.test_validation(
      {
        id: draft.id,
        value: 100,
      },
      testUserId
    )
  ).rejects.toThrow("Cannot modify posted record");
});

test("Condition: Variables resolve correctly", async () => {
  // Create a record
  const record = await db.api.save.test_validation(
    {
      name: `${PREFIX}_condition_test`,
      value: 200,
      status: "draft",
      org_id: testOrgId,
    },
    testUserId
  );

  // Verify the record exists and has correct status
  expect(record.status).toBe("draft");

  // Update to posted (should trigger condition on next update)
  await db.api.save.test_validation(
    {
      id: record.id,
      status: "posted",
    },
    testUserId
  );

  // Now @before.status = 'posted', so validation should trigger
  await expect(
    db.api.save.test_validation(
      {
        id: record.id,
        name: "changed",
      },
      testUserId
    )
  ).rejects.toThrow("Cannot modify posted record");
});

test("Graph rules execute within transaction", async () => {
  // If validation fails, the entire operation should rollback
  const countBefore = await sql`SELECT COUNT(*) as count FROM test_validation WHERE name LIKE ${PREFIX + '%'}`;

  try {
    await db.api.save.test_validation(
      {
        name: `${PREFIX}_transaction_test`,
        value: -50, // This will fail validation
        org_id: testOrgId,
      },
      testUserId
    );
  } catch (error) {
    // Expected to throw
  }

  const countAfter = await sql`SELECT COUNT(*) as count FROM test_validation WHERE name LIKE ${PREFIX + '%'}`;

  // Count should be the same - no partial insert
  expect(countAfter[0].count).toBe(countBefore[0].count);
});

test("Multiple validation rules execute in order", async () => {
  // Create entity with multiple validation rules

  // Create second validation function
  await sql`
    CREATE OR REPLACE FUNCTION validate_reasonable_value(p_value INT)
    RETURNS BOOLEAN
    LANGUAGE sql
    IMMUTABLE AS $$
      SELECT p_value <= 1000;
    $$
  `;

  // Update entity registration with multiple validations
  await sql`
    UPDATE dzql.entities
    SET graph_rules = '{
      "on_create": {
        "validate_positive": {
          "description": "Ensure value is positive",
          "actions": [{
            "type": "validate",
            "function": "validate_positive_value",
            "params": {"p_value": "@value"},
            "error_message": "Value must be positive"
          }]
        },
        "validate_reasonable": {
          "description": "Ensure value is reasonable",
          "actions": [{
            "type": "validate",
            "function": "validate_reasonable_value",
            "params": {"p_value": "@value"},
            "error_message": "Value must be <= 1000"
          }]
        }
      }
    }'::jsonb
    WHERE table_name = 'test_validation'
  `;

  // Test first validation (negative value)
  await expect(
    db.api.save.test_validation(
      {
        name: `${PREFIX}_multi_test_1`,
        value: -10,
        org_id: testOrgId,
      },
      testUserId
    )
  ).rejects.toThrow("Value must be positive");

  // Test second validation (too large)
  await expect(
    db.api.save.test_validation(
      {
        name: `${PREFIX}_multi_test_2`,
        value: 5000,
        org_id: testOrgId,
      },
      testUserId
    )
  ).rejects.toThrow("Value must be <= 1000");

  // Test valid value (passes both)
  const valid = await db.api.save.test_validation(
    {
      name: `${PREFIX}_multi_test_3`,
      value: 500,
      org_id: testOrgId,
    },
    testUserId
  );
  expect(valid.value).toBe(500);
});

test("Condition evaluation with complex expressions", async () => {
  // Update entity with complex condition
  await sql`
    UPDATE dzql.entities
    SET graph_rules = '{
      "on_update": {
        "complex_condition": {
          "condition": "@after.status = ''posted'' AND @after.value > 100",
          "actions": [{
            "type": "validate",
            "function": "always_false",
            "params": {},
            "error_message": "Cannot post with value > 100"
          }]
        }
      }
    }'::jsonb
    WHERE table_name = 'test_validation';
  `;

  // Create draft with low value
  const record = await db.api.save.test_validation(
    {
      name: `${PREFIX}_complex`,
      value: 50,
      status: "draft",
      org_id: testOrgId,
    },
    testUserId
  );

  // Post with low value (should succeed - condition not met)
  const posted1 = await db.api.save.test_validation(
    {
      id: record.id,
      status: "posted",
    },
    testUserId
  );
  expect(posted1.status).toBe("posted");

  // Create another draft with high value
  const record2 = await db.api.save.test_validation(
    {
      name: `${PREFIX}_complex2`,
      value: 150,
      status: "draft",
      org_id: testOrgId,
    },
    testUserId
  );

  // Try to post with high value (should fail - condition met)
  await expect(
    db.api.save.test_validation(
      {
        id: record2.id,
        status: "posted",
      },
      testUserId
    )
  ).rejects.toThrow("Cannot post with value > 100");
});
