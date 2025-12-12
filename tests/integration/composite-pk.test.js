/**
 * Composite Primary Key tests
 * Tests CRUD operations for entities with composite primary keys
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { DZQLCompiler } from "../../packages/dzql/src/compiler/index.js";
import { setupTests } from "../setup/test-helpers.js";

const { sql } = setupTests();

describe("Composite Primary Key - CRUD Operations", () => {
  let userId;

  beforeAll(async () => {
    // Create test tables with composite primary keys
    await sql`DROP TABLE IF EXISTS canvas_positions CASCADE`;
    await sql`DROP TABLE IF EXISTS cpk_users CASCADE`;

    // Create a simple users table for testing
    await sql`
      CREATE TABLE cpk_users (
        id serial PRIMARY KEY,
        name text NOT NULL,
        email text UNIQUE NOT NULL,
        password_hash text NOT NULL
      )
    `;

    // Create a table with composite primary key (the bug reproduction case)
    await sql`
      CREATE TABLE canvas_positions (
        entity_type VARCHAR(50) NOT NULL,
        entity_id INTEGER NOT NULL,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        width INTEGER DEFAULT 100,
        height INTEGER DEFAULT 100,
        PRIMARY KEY (entity_type, entity_id)
      )
    `;

    // Compile entities
    const compiler = new DZQLCompiler();

    const entitiesSQL = `
      SELECT dzql.register_entity(
        'cpk_users',
        'name',
        array['name', 'email'],
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
        'canvas_positions',                          -- table_name
        'entity_type',                               -- label_field
        array['x', 'y', 'width', 'height'],          -- searchable_fields
        '{}',                                        -- fk_includes
        false,                                       -- soft_delete
        '{}',                                        -- temporal_fields
        '{}',                                        -- notification_paths
        jsonb_build_object(                          -- permission_paths
          'view', array[]::text[],
          'create', array[]::text[],
          'update', array[]::text[],
          'delete', array[]::text[]
        ),
        jsonb_build_object(                          -- graph_rules
          'primary_key', array['entity_type', 'entity_id']
        )
      );
    `;

    const compiled = compiler.compileFromSQL(entitiesSQL);

    // Execute compiled SQL
    for (const result of compiled.results) {
      await sql.unsafe(result.sql);
    }

    // Create a test user
    const userResult = await sql`
      INSERT INTO cpk_users (name, email, password_hash)
      VALUES ('Test User', 'cpk-test@example.com', 'dummy')
      RETURNING id
    `;
    userId = userResult[0].id;
  });

  afterAll(async () => {
    // Cleanup
    await sql`DROP TABLE IF EXISTS canvas_positions CASCADE`;
    await sql`DROP TABLE IF EXISTS cpk_users CASCADE`;
  });

  test("save_canvas_positions inserts new record with composite PK", async () => {
    const result = await sql`
      SELECT save_canvas_positions(
        ${userId},
        '{"entity_type": "node", "entity_id": 1, "x": 100, "y": 200}'::jsonb
      ) as result
    `;

    expect(result[0].result).toBeDefined();
    expect(result[0].result.entity_type).toBe("node");
    expect(result[0].result.entity_id).toBe(1);
    expect(result[0].result.x).toBe(100);
    expect(result[0].result.y).toBe(200);
  });

  test("save_canvas_positions updates existing record with composite PK", async () => {
    // First insert a record
    await sql`
      SELECT save_canvas_positions(
        ${userId},
        '{"entity_type": "edge", "entity_id": 5, "x": 50, "y": 50}'::jsonb
      )
    `;

    // Then update it using the same composite PK
    const result = await sql`
      SELECT save_canvas_positions(
        ${userId},
        '{"entity_type": "edge", "entity_id": 5, "x": 300, "y": 400}'::jsonb
      ) as result
    `;

    expect(result[0].result).toBeDefined();
    expect(result[0].result.entity_type).toBe("edge");
    expect(result[0].result.entity_id).toBe(5);
    expect(result[0].result.x).toBe(300);
    expect(result[0].result.y).toBe(400);

    // Verify only one record exists
    const count = await sql`
      SELECT COUNT(*) as cnt FROM canvas_positions
      WHERE entity_type = 'edge' AND entity_id = 5
    `;
    expect(parseInt(count[0].cnt)).toBe(1);
  });

  test("get_canvas_positions retrieves record by composite PK", async () => {
    // Insert a record first
    await sql`
      SELECT save_canvas_positions(
        ${userId},
        '{"entity_type": "widget", "entity_id": 10, "x": 500, "y": 600}'::jsonb
      )
    `;

    // Retrieve using composite PK
    const result = await sql`
      SELECT get_canvas_positions(
        ${userId},
        '{"entity_type": "widget", "entity_id": 10}'::jsonb
      ) as result
    `;

    expect(result[0].result).toBeDefined();
    expect(result[0].result.entity_type).toBe("widget");
    expect(result[0].result.entity_id).toBe(10);
    expect(result[0].result.x).toBe(500);
    expect(result[0].result.y).toBe(600);
  });

  test("delete_canvas_positions removes record by composite PK", async () => {
    // Insert a record first
    await sql`
      SELECT save_canvas_positions(
        ${userId},
        '{"entity_type": "container", "entity_id": 20, "x": 0, "y": 0}'::jsonb
      )
    `;

    // Delete using composite PK
    const result = await sql`
      SELECT delete_canvas_positions(
        ${userId},
        '{"entity_type": "container", "entity_id": 20}'::jsonb
      ) as result
    `;

    expect(result[0].result).toBeDefined();
    expect(result[0].result.entity_type).toBe("container");
    expect(result[0].result.entity_id).toBe(20);

    // Verify record is deleted
    const count = await sql`
      SELECT COUNT(*) as cnt FROM canvas_positions
      WHERE entity_type = 'container' AND entity_id = 20
    `;
    expect(parseInt(count[0].cnt)).toBe(0);
  });

  test("save_canvas_positions handles partial update (non-PK fields only)", async () => {
    // Insert initial record
    await sql`
      SELECT save_canvas_positions(
        ${userId},
        '{"entity_type": "panel", "entity_id": 30, "x": 10, "y": 20, "width": 200, "height": 150}'::jsonb
      )
    `;

    // Update only x and y (plus PK fields for identification)
    const result = await sql`
      SELECT save_canvas_positions(
        ${userId},
        '{"entity_type": "panel", "entity_id": 30, "x": 999, "y": 888}'::jsonb
      ) as result
    `;

    expect(result[0].result.x).toBe(999);
    expect(result[0].result.y).toBe(888);
    // width and height should remain unchanged
    expect(result[0].result.width).toBe(200);
    expect(result[0].result.height).toBe(150);
  });

  test("search_canvas_positions finds records", async () => {
    // Insert some records
    await sql`
      SELECT save_canvas_positions(
        ${userId},
        '{"entity_type": "search_test", "entity_id": 1, "x": 100, "y": 100}'::jsonb
      )
    `;
    await sql`
      SELECT save_canvas_positions(
        ${userId},
        '{"entity_type": "search_test", "entity_id": 2, "x": 200, "y": 200}'::jsonb
      )
    `;

    // Search with filter
    const result = await sql`
      SELECT search_canvas_positions(
        ${userId},
        '{"entity_type": "search_test"}'::jsonb
      ) as result
    `;

    expect(result[0].result).toBeDefined();
    expect(result[0].result.data.length).toBe(2);
    expect(result[0].result.total).toBe(2);
  });

  test("save_canvas_positions handles concurrent saves without duplicate key error (race condition fix)", async () => {
    // This test verifies the fix for the race condition where two concurrent requests
    // to save the same composite PK could both attempt INSERT and cause duplicate key errors.
    // The fix uses INSERT ... ON CONFLICT DO UPDATE (UPSERT) which is atomic.

    const entityType = "concurrent_test";
    const entityId = 999;

    // Clean up any existing record
    await sql`
      DELETE FROM canvas_positions
      WHERE entity_type = ${entityType} AND entity_id = ${entityId}
    `;

    // Simulate concurrent saves by running multiple saves in parallel
    // All targeting the same composite PK (entity_type, entity_id)
    const concurrentSaves = [];
    for (let i = 0; i < 10; i++) {
      const data = {
        entity_type: entityType,
        entity_id: entityId,
        x: i * 10,
        y: i * 20,
      };
      concurrentSaves.push(
        sql`
          SELECT save_canvas_positions(
            ${userId},
            ${sql.json(data)}
          ) as result
        `,
      );
    }

    // All saves should succeed without duplicate key errors
    const results = await Promise.all(concurrentSaves);

    // Verify all saves completed successfully
    for (const result of results) {
      expect(result[0].result).toBeDefined();
      expect(result[0].result.entity_type).toBe(entityType);
      expect(result[0].result.entity_id).toBe(entityId);
    }

    // Verify only one record exists
    const count = await sql`
      SELECT COUNT(*) as cnt FROM canvas_positions
      WHERE entity_type = ${entityType} AND entity_id = ${entityId}
    `;
    expect(parseInt(count[0].cnt)).toBe(1);

    // The final state should be one of the concurrent saves
    const finalRecord = await sql`
      SELECT * FROM canvas_positions
      WHERE entity_type = ${entityType} AND entity_id = ${entityId}
    `;
    expect(finalRecord[0]).toBeDefined();
    expect(finalRecord[0].entity_type).toBe(entityType);
    expect(finalRecord[0].entity_id).toBe(entityId);
  });
});
