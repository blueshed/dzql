import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestDatabase } from "../setup/TestDatabase.js";

let db;
let sql;

beforeAll(async () => {
  db = new TestDatabase();
  sql = await db.setup();
});

afterAll(async () => {
  await db.teardown();
});

describe("Atomic Subscription Updates - Schema in Subscribe Response", () => {
  beforeAll(async () => {
    // Create test tables for subscribable
    await sql`
      CREATE TABLE IF NOT EXISTS test_venues (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        org_id INT
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS test_sites (
        id SERIAL PRIMARY KEY,
        venue_id INT REFERENCES test_venues(id),
        name TEXT NOT NULL
      )
    `;

    // Insert test data
    await sql`INSERT INTO test_venues (id, name, org_id) VALUES (1, 'Test Venue', 1) ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO test_sites (id, venue_id, name) VALUES (1, 1, 'Site A'), (2, 1, 'Site B') ON CONFLICT DO NOTHING`;

    // Register a test subscribable
    await sql`
      SELECT dzql.register_subscribable(
        'test_venue_detail',
        '{}'::jsonb,
        '{"venue_id": "int"}'::jsonb,
        'test_venues',
        '{"sites": {"entity": "test_sites", "filter": "venue_id=$venue_id"}}'::jsonb
      )
    `;

    // Create the subscribable functions manually for testing
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION test_venue_detail_can_subscribe(p_user_id INT, p_params JSONB)
      RETURNS BOOLEAN AS $$
      BEGIN
        RETURN TRUE;
      END;
      $$ LANGUAGE plpgsql STABLE;

      CREATE OR REPLACE FUNCTION get_test_venue_detail(p_params JSONB, p_user_id INT)
      RETURNS JSONB AS $$
      DECLARE
        v_venue_id INT;
        v_result JSONB;
      BEGIN
        v_venue_id := (p_params->>'venue_id')::int;

        SELECT jsonb_build_object(
          'test_venues', row_to_json(v.*),
          'sites', (
            SELECT jsonb_agg(row_to_json(s.*))
            FROM test_sites s
            WHERE s.venue_id = v.id
          )
        )
        INTO v_result
        FROM test_venues v
        WHERE v.id = v_venue_id;

        RETURN v_result;
      END;
      $$ LANGUAGE plpgsql;

      CREATE OR REPLACE FUNCTION test_venue_detail_affected_documents(
        p_table TEXT,
        p_op TEXT,
        p_old JSONB,
        p_new JSONB
      ) RETURNS JSONB[] AS $$
      BEGIN
        CASE p_table
          WHEN 'test_venues' THEN
            RETURN ARRAY[jsonb_build_object('venue_id', COALESCE((p_new->>'id')::int, (p_old->>'id')::int))];
          WHEN 'test_sites' THEN
            RETURN ARRAY[jsonb_build_object('venue_id', COALESCE((p_new->>'venue_id')::int, (p_old->>'venue_id')::int))];
          ELSE
            RETURN ARRAY[]::JSONB[];
        END CASE;
      END;
      $$ LANGUAGE plpgsql IMMUTABLE;
    `);
  });

  afterAll(async () => {
    await sql`DROP TABLE IF EXISTS test_sites CASCADE`;
    await sql`DROP TABLE IF EXISTS test_venues CASCADE`;
    await sql`DROP FUNCTION IF EXISTS test_venue_detail_can_subscribe`;
    await sql`DROP FUNCTION IF EXISTS get_test_venue_detail`;
    await sql`DROP FUNCTION IF EXISTS test_venue_detail_affected_documents`;
    await sql`DELETE FROM dzql.subscribables WHERE name = 'test_venue_detail'`;
  });

  test("subscribable has scope_tables populated", async () => {
    const result = await sql`
      SELECT scope_tables FROM dzql.subscribables WHERE name = 'test_venue_detail'
    `;

    expect(result[0].scope_tables).toContain("test_venues");
    expect(result[0].scope_tables).toContain("test_sites");
  });

  test("get_subscribable returns scope_tables", async () => {
    const result = await sql`
      SELECT * FROM dzql.get_subscribable('test_venue_detail')
    `;

    expect(result[0].scope_tables).toBeDefined();
    expect(result[0].scope_tables).toContain("test_venues");
    expect(result[0].scope_tables).toContain("test_sites");
  });

  test("subscribable query function returns data", async () => {
    const result = await sql`
      SELECT get_test_venue_detail('{"venue_id": 1}'::jsonb, 1) as data
    `;

    expect(result[0].data).toBeDefined();
    expect(result[0].data.test_venues).toBeDefined();
    expect(result[0].data.test_venues.name).toBe("Test Venue");
    expect(result[0].data.sites).toHaveLength(2);
  });

  test("affected_documents identifies venue changes", async () => {
    const result = await sql`
      SELECT test_venue_detail_affected_documents(
        'test_venues',
        'update',
        '{"id": 1}'::jsonb,
        '{"id": 1, "name": "Updated Venue"}'::jsonb
      ) as affected
    `;

    expect(result[0].affected).toHaveLength(1);
    expect(result[0].affected[0].venue_id).toBe(1);
  });

  test("affected_documents identifies site changes", async () => {
    const result = await sql`
      SELECT test_venue_detail_affected_documents(
        'test_sites',
        'insert',
        NULL,
        '{"id": 3, "venue_id": 1, "name": "New Site"}'::jsonb
      ) as affected
    `;

    expect(result[0].affected).toHaveLength(1);
    expect(result[0].affected[0].venue_id).toBe(1);
  });

  test("affected_documents returns empty for unrelated tables", async () => {
    const result = await sql`
      SELECT test_venue_detail_affected_documents(
        'users',
        'update',
        '{"id": 1}'::jsonb,
        '{"id": 1}'::jsonb
      ) as affected
    `;

    expect(result[0].affected).toHaveLength(0);
  });
});

describe("Atomic Subscription Updates - Path Mapping Logic", () => {
  // Test the path mapping that would be built on the server and sent to client

  test("buildPathMappingFromRelations generates correct paths", async () => {
    // This tests what the server-side buildPathMappingFromRelations function does
    const rootEntity = "venues";
    const relations = {
      org: "organisations",
      sites: { entity: "sites", filter: "venue_id=$venue_id" },
    };

    const paths = buildTestPathMapping(rootEntity, relations);

    expect(paths["venues"]).toBe(".");
    expect(paths["organisations"]).toBe("org");
    expect(paths["sites"]).toBe("sites");
  });

  test("nested relations create dot-separated paths", async () => {
    const rootEntity = "venues";
    const relations = {
      packages: {
        entity: "packages",
        filter: "venue_id=$venue_id",
        include: {
          allocations: "allocations",
        },
      },
    };

    const paths = buildTestPathMapping(rootEntity, relations);

    expect(paths["venues"]).toBe(".");
    expect(paths["packages"]).toBe("packages");
    expect(paths["allocations"]).toBe("packages.allocations");
  });
});

describe("Atomic Subscription Updates - Event Processing", () => {
  // Test that events are correctly identified as in-scope or out-of-scope

  beforeAll(async () => {
    // Register a simple subscribable for event processing tests
    await sql`
      SELECT dzql.register_subscribable(
        'event_test_sub',
        '{}'::jsonb,
        '{"id": "int"}'::jsonb,
        'test_root',
        '{"items": {"entity": "test_items", "filter": "root_id=$id"}}'::jsonb
      )
    `;
  });

  afterAll(async () => {
    await sql`DELETE FROM dzql.subscribables WHERE name = 'event_test_sub'`;
  });

  test("event from scope table should be processed", async () => {
    // Get scope tables for our test subscribable
    const result = await sql`
      SELECT scope_tables FROM dzql.subscribables WHERE name = 'event_test_sub'
    `;

    const scopeTables = result[0].scope_tables;
    const eventTable = "test_items";

    // Check if event table is in scope
    expect(scopeTables.includes(eventTable)).toBe(true);
  });

  test("event from out-of-scope table should be skipped", async () => {
    const result = await sql`
      SELECT scope_tables FROM dzql.subscribables WHERE name = 'event_test_sub'
    `;

    const scopeTables = result[0].scope_tables;
    const eventTable = "users"; // Not in scope

    // Check if event table is NOT in scope
    expect(scopeTables.includes(eventTable)).toBe(false);
  });

  test("root entity is always in scope", async () => {
    const result = await sql`
      SELECT scope_tables FROM dzql.subscribables WHERE name = 'event_test_sub'
    `;

    const scopeTables = result[0].scope_tables;

    // Root entity should always be in scope
    expect(scopeTables.includes("test_root")).toBe(true);
  });
});

// Helper function that mirrors the server-side implementation
function buildTestPathMapping(rootEntity, relations) {
  const paths = {};

  if (rootEntity) {
    paths[rootEntity] = ".";
  }

  const buildPaths = (rels, parentPath = "") => {
    for (const [relName, relConfig] of Object.entries(rels || {})) {
      const entity =
        typeof relConfig === "string" ? relConfig : relConfig?.entity;
      const currentPath = parentPath ? `${parentPath}.${relName}` : relName;

      if (entity) {
        paths[entity] = currentPath;
      }

      if (typeof relConfig === "object" && relConfig !== null) {
        if (relConfig.include) {
          buildPaths(relConfig.include, currentPath);
        }
        if (relConfig.relations) {
          buildPaths(relConfig.relations, currentPath);
        }
      }
    }
  };

  buildPaths(relations);
  return paths;
}
