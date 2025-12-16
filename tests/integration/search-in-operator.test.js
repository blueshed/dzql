/**
 * Search 'in' operator tests
 * Tests that the 'in' operator works correctly with integer columns
 * Fixes: Type mismatch with integer columns - "operator does not exist: integer = text"
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { DZQLCompiler } from "../../packages/dzql/src/compiler/index.js";
import { setupTests } from "../setup/test-helpers.js";

const { sql } = setupTests();

describe("Search 'in' operator with integer columns", () => {
  let db;

  beforeAll(async () => {
    // Create test schema with integer FK column (similar to performance -> site_id)
    await sql`DROP TABLE IF EXISTS search_test_items CASCADE`;
    await sql`DROP TABLE IF EXISTS search_test_categories CASCADE`;

    await sql`
      CREATE TABLE search_test_categories (
        id serial PRIMARY KEY,
        name text NOT NULL
      )
    `;

    await sql`
      CREATE TABLE search_test_items (
        id serial PRIMARY KEY,
        name text NOT NULL,
        category_id int REFERENCES search_test_categories(id),
        quantity int NOT NULL DEFAULT 0
      )
    `;

    // Insert test categories
    await sql`
      INSERT INTO search_test_categories (id, name) VALUES
        (1, 'Category A'),
        (2, 'Category B'),
        (3, 'Category C')
    `;

    // Insert test items
    await sql`
      INSERT INTO search_test_items (id, name, category_id, quantity) VALUES
        (1, 'Item 1', 1, 10),
        (2, 'Item 2', 1, 20),
        (3, 'Item 3', 2, 30),
        (4, 'Item 4', 2, 40),
        (5, 'Item 5', 3, 50)
    `;

    // Compile entities
    const compiler = new DZQLCompiler();

    const entitiesSQL = `
      SELECT dzql.register_entity(
        'search_test_categories',
        'name',
        array['name'],
        '{}',
        false,
        '{}',
        '{}',
        jsonb_build_object(
          'view', array[]::text[],
          'create', array[]::text[],
          'update', array[]::text[],
          'delete', array[]::text[]
        )
      );

      SELECT dzql.register_entity(
        'search_test_items',
        'name',
        array['name'],
        '{"category": "search_test_categories"}',
        false,
        '{}',
        '{}',
        jsonb_build_object(
          'view', array[]::text[],
          'create', array[]::text[],
          'update', array[]::text[],
          'delete', array[]::text[]
        )
      );
    `;

    const compiled = compiler.compileFromSQL(entitiesSQL);

    // Execute compiled SQL
    for (const result of compiled.results) {
      await sql.unsafe(result.sql);
    }

    // Create db.api wrapper for search
    db = { api: {} };

    const entities = ["search_test_categories", "search_test_items"];

    for (const entity of entities) {
      db.api[`search_${entity}`] = async (userId, options = {}) => {
        const {
          filters = {},
          search = null,
          sort = null,
          page = 1,
          limit = 25,
        } = options;
        const result = await sql`
          SELECT ${sql.unsafe(`search_${entity}`)}(
            ${userId}::int,
            ${sql.json(filters)},
            ${search},
            ${sort ? sql.json(sort) : null},
            ${page}::int,
            ${limit}::int
          ) as result
        `;
        return result[0].result;
      };
    }
  });

  afterAll(async () => {
    // Clean up
    await sql`DROP TABLE IF EXISTS search_test_items CASCADE`;
    await sql`DROP TABLE IF EXISTS search_test_categories CASCADE`;
  });

  test("'in' operator works with integer FK column (category_id)", async () => {
    // This was the bug: using 'in' on an integer column would fail with
    // "operator does not exist: integer = text"
    const result = await db.api.search_search_test_items(1, {
      filters: { category_id: { in: [1, 2] } },
      limit: 100,
    });

    expect(result.total).toBe(4);
    expect(result.data.length).toBe(4);

    // Verify we got items from categories 1 and 2 only
    const categoryIds = result.data.map((item) => item.category_id);
    expect(categoryIds.every((id) => id === 1 || id === 2)).toBe(true);
  });

  test("'in' operator works with integer quantity column", async () => {
    const result = await db.api.search_search_test_items(1, {
      filters: { quantity: { in: [10, 30, 50] } },
      limit: 100,
    });

    expect(result.total).toBe(3);
    expect(result.data.length).toBe(3);

    const quantities = result.data.map((item) => item.quantity);
    expect(quantities.sort((a, b) => a - b)).toEqual([10, 30, 50]);
  });

  test("'in' operator works with single value array", async () => {
    const result = await db.api.search_search_test_items(1, {
      filters: { category_id: { in: [3] } },
      limit: 100,
    });

    expect(result.total).toBe(1);
    expect(result.data[0].name).toBe("Item 5");
  });

  test("'in' operator works with id column (integer primary key)", async () => {
    const result = await db.api.search_search_test_items(1, {
      filters: { id: { in: [1, 3, 5] } },
      limit: 100,
    });

    expect(result.total).toBe(3);
    const names = result.data.map((item) => item.name).sort();
    expect(names).toEqual(["Item 1", "Item 3", "Item 5"]);
  });

  test("'in' operator returns empty when no matches", async () => {
    const result = await db.api.search_search_test_items(1, {
      filters: { category_id: { in: [999, 1000] } },
      limit: 100,
    });

    expect(result.total).toBe(0);
    // Search returns null for data when no matches (not empty array)
    expect(result.data === null || result.data.length === 0).toBe(true);
  });
});
