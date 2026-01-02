/**
 * Tests for the actual db.js API that we ship
 * This ensures the runtime db.api calls match compiled function signatures
 *
 * IMPORTANT: This test replicates the EXACT SQL calls from db.js callDZQLOperation
 * to verify that the runtime signatures match what the compiler generates.
 * If db.js changes, this test must be updated to match.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { DZQLCompiler } from "../../packages/dzql/src/compiler/index.js";
import { setupTests, testEmail, testName } from "../setup/test-helpers.js";

const { sql } = setupTests();

/**
 * Replicates the EXACT SQL calls from db.js callDZQLOperation
 * This ensures we test the same signatures the runtime uses.
 *
 * SYNC WITH: packages/dzql/src/server/db.js callDZQLOperation()
 */
async function callDZQLOperation(operation, entity, args, userId) {
  const compiledFunctionName = `${operation}_${entity}`;

  if (operation === "search") {
    const filters = args.filters || args.p_filters || {};
    const search = args.search || null;
    const sort = args.sort || null;
    const page = args.page || 1;
    const limit = args.limit || 25;

    const result = await sql.unsafe(
      `
      SELECT ${compiledFunctionName}($1::int, $2::jsonb, $3::text, $4::jsonb, $5::int, $6::int) as result
    `,
      [userId, filters, search, sort, page, limit],
    );
    return result[0].result;
  } else if (operation === "get") {
    const result = await sql.unsafe(
      `
      SELECT ${compiledFunctionName}($1::int, $2::int, NULL) as result
    `,
      [userId, args.id],
    );
    return result[0].result;
  } else if (operation === "save") {
    // 2 parameters - matches compiled save_* function signature
    const result = await sql.unsafe(
      `
      SELECT ${compiledFunctionName}($1::int, $2::jsonb) as result
    `,
      [userId, args],
    );
    return result[0].result;
  } else if (operation === "delete") {
    const result = await sql.unsafe(
      `
      SELECT ${compiledFunctionName}($1::int, $2::int) as result
    `,
      [userId, args.id],
    );
    return result[0].result;
  } else if (operation === "lookup") {
    const result = await sql.unsafe(
      `
      SELECT ${compiledFunctionName}($1::int, $2::text, $3::int) as result
    `,
      [userId, args.term || "", args.limit || 10],
    );
    return result[0].result;
  } else {
    throw new Error(`Unknown operation: ${operation}`);
  }
}

describe("db.js API Integration - Tests actual runtime SQL signatures", () => {
  let testUserId;

  beforeAll(async () => {
    // Create test schema
    await sql`DROP TABLE IF EXISTS test_items CASCADE`;
    await sql`DROP TABLE IF EXISTS test_users CASCADE`;

    await sql`
      CREATE TABLE test_users (
        id serial PRIMARY KEY,
        name text NOT NULL,
        email text UNIQUE NOT NULL,
        created_at timestamptz DEFAULT now()
      )
    `;

    await sql`
      CREATE TABLE test_items (
        id serial PRIMARY KEY,
        title text NOT NULL,
        owner_id int REFERENCES test_users(id),
        created_at timestamptz DEFAULT now(),
        deleted_at timestamptz
      )
    `;

    // Compile entities using the actual compiler
    const compiler = new DZQLCompiler();

    const entitiesSQL = `
      SELECT dzql.register_entity(
        'test_users',
        'name',
        array['name', 'email'],
        '{}',
        false,
        '{}',
        '{}',
        jsonb_build_object(
          'view', array[]::text[],
          'create', array[]::text[],
          'update', array['@id'],
          'delete', array['@id']
        )
      );

      SELECT dzql.register_entity(
        'test_items',
        'title',
        array['title'],
        '{"owner": "test_users"}',
        true,
        '{}',
        '{}',
        jsonb_build_object(
          'view', array[]::text[],
          'create', array[]::text[],
          'update', array['@owner_id'],
          'delete', array['@owner_id']
        )
      );
    `;

    const compiled = compiler.compileFromSQL(entitiesSQL);

    // Execute compiled SQL to create functions
    for (const result of compiled.results) {
      await sql.unsafe(result.sql);
    }

    // Create a test user directly
    const userResult = await sql`
      INSERT INTO test_users (name, email)
      VALUES (${testName("DbApiUser")}, ${testEmail("db-api")})
      RETURNING id
    `;
    testUserId = userResult[0].id;
  });

  afterAll(async () => {
    // Clean up
    await sql`DROP TABLE IF EXISTS test_items CASCADE`;
    await sql`DROP TABLE IF EXISTS test_users CASCADE`;
  });

  describe("save operation - verifies 2-parameter signature", () => {
    test("save creates new record via compiled function", async () => {
      const itemData = {
        title: testName("Item"),
        owner_id: testUserId,
      };

      // This calls using the EXACT same SQL signature as db.js
      const item = await callDZQLOperation(
        "save",
        "test_items",
        itemData,
        testUserId,
      );

      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("title", itemData.title);
      expect(item).toHaveProperty("owner_id", testUserId);
    });

    test("save updates existing record via compiled function", async () => {
      // Create item first
      const createData = {
        title: testName("UpdateMe"),
        owner_id: testUserId,
      };
      const created = await callDZQLOperation(
        "save",
        "test_items",
        createData,
        testUserId,
      );

      // Update it
      const updateData = {
        id: created.id,
        title: testName("Updated"),
        owner_id: testUserId,
      };
      const updated = await callDZQLOperation(
        "save",
        "test_items",
        updateData,
        testUserId,
      );

      expect(updated.id).toBe(created.id);
      expect(updated.title).toBe(updateData.title);
    });
  });

  describe("get operation - verifies 3-parameter signature with NULL", () => {
    test("get retrieves record via compiled function", async () => {
      // Create item first
      const itemData = {
        title: testName("GetMe"),
        owner_id: testUserId,
      };
      const created = await callDZQLOperation(
        "save",
        "test_items",
        itemData,
        testUserId,
      );

      // Get it using db.js signature
      const item = await callDZQLOperation(
        "get",
        "test_items",
        { id: created.id },
        testUserId,
      );

      expect(item).toHaveProperty("id", created.id);
      expect(item).toHaveProperty("title", itemData.title);
    });
  });

  describe("search operation - verifies 6-parameter signature", () => {
    test("search finds records via compiled function", async () => {
      // Create a couple items
      await callDZQLOperation(
        "save",
        "test_items",
        { title: testName("SearchItem1"), owner_id: testUserId },
        testUserId,
      );
      await callDZQLOperation(
        "save",
        "test_items",
        { title: testName("SearchItem2"), owner_id: testUserId },
        testUserId,
      );

      // Search using db.js signature
      const result = await callDZQLOperation(
        "search",
        "test_items",
        {},
        testUserId,
      );

      expect(result).toHaveProperty("data");
      expect(result).toHaveProperty("total");
      expect(result.data).toBeArray();
      expect(result.data.length).toBeGreaterThan(0);
    });
  });

  describe("delete operation - verifies 2-parameter signature", () => {
    test("delete soft-deletes record via compiled function", async () => {
      // Create item first
      const itemData = {
        title: testName("DeleteMe"),
        owner_id: testUserId,
      };
      const created = await callDZQLOperation(
        "save",
        "test_items",
        itemData,
        testUserId,
      );

      // Delete it using db.js signature
      const deleted = await callDZQLOperation(
        "delete",
        "test_items",
        { id: created.id },
        testUserId,
      );

      expect(deleted).toHaveProperty("deleted_at");
      expect(deleted.deleted_at).not.toBeNull();
    });
  });

  describe("lookup operation - verifies 3-parameter signature", () => {
    test("lookup returns value/label pairs via compiled function", async () => {
      // Create item with known title
      const uniqueTitle = testName("LookupItem");
      await callDZQLOperation(
        "save",
        "test_items",
        { title: uniqueTitle, owner_id: testUserId },
        testUserId,
      );

      // Lookup using db.js signature
      const results = await callDZQLOperation(
        "lookup",
        "test_items",
        { term: "Lookup", limit: 10 },
        testUserId,
      );

      expect(results).toBeArray();
      // Results should have value/label structure
      if (results.length > 0) {
        expect(results[0]).toHaveProperty("value");
        expect(results[0]).toHaveProperty("label");
      }
    });
  });
});
