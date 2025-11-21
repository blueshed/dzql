/**
 * End-to-End Integration Test
 *
 * This test validates the complete DZQL lifecycle:
 * 1. Define entity with M2M, field defaults, permissions
 * 2. Compile to SQL
 * 3. Install compiled functions
 * 4. Full CRUD lifecycle with validation of:
 *    - Field defaults applied
 *    - M2M junction tables synced
 *    - Events created with complete data
 *    - FK expansion works
 *    - Permissions enforced
 *
 * This ONE test validates features work TOGETHER, not just individually.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { DZQLCompiler } from "../../packages/dzql/src/compiler/index.js";
import {
  setupTests,
  createTestUser,
  testEmail,
  testName,
} from "../setup/test-helpers.js";

const { sql } = setupTests();

describe("End-to-End Integration: Compile → Install → CRUD", () => {
  let aliceUserId;
  let bobUserId;

  beforeAll(async () => {
    // Create test schema
    await sql`DROP FUNCTION IF EXISTS delete_resources CASCADE`;
    await sql`DROP FUNCTION IF EXISTS save_resources CASCADE`;
    await sql`DROP FUNCTION IF EXISTS get_resources CASCADE`;
    await sql`DROP FUNCTION IF EXISTS search_resources CASCADE`;
    await sql`DROP FUNCTION IF EXISTS lookup_resources CASCADE`;
    await sql`DROP FUNCTION IF EXISTS can_view_resources CASCADE`;
    await sql`DROP FUNCTION IF EXISTS can_create_resources CASCADE`;
    await sql`DROP FUNCTION IF EXISTS can_update_resources CASCADE`;
    await sql`DROP FUNCTION IF EXISTS can_delete_resources CASCADE`;
    await sql`DROP TABLE IF EXISTS resource_tags CASCADE`;
    await sql`DROP TABLE IF EXISTS resources CASCADE`;
    await sql`DROP TABLE IF EXISTS tags CASCADE`;
    await sql`DROP TABLE IF EXISTS users CASCADE`;

    await sql`
      CREATE TABLE users (
        id serial PRIMARY KEY,
        name text NOT NULL,
        email text UNIQUE NOT NULL,
        password_hash text NOT NULL,
        created_at timestamptz DEFAULT now()
      )
    `;

    await sql`
      CREATE TABLE tags (
        id serial PRIMARY KEY,
        name text UNIQUE NOT NULL,
        created_at timestamptz DEFAULT now()
      )
    `;

    await sql`
      CREATE TABLE resources (
        id serial PRIMARY KEY,
        title text NOT NULL,
        content text,
        owner_id int REFERENCES users(id),
        created_by int REFERENCES users(id),
        created_at timestamptz DEFAULT now(),
        deleted_at timestamptz
      )
    `;

    await sql`
      CREATE TABLE resource_tags (
        resource_id int REFERENCES resources(id) ON DELETE CASCADE,
        tag_id int REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (resource_id, tag_id)
      )
    `;

    // Create test users
    const alice = await createTestUser(sql);
    const bob = await createTestUser(sql);
    aliceUserId = alice.user_id;
    bobUserId = bob.user_id;

    // Create some tags (if they don't exist)
    await sql`
      INSERT INTO tags (name) VALUES ('javascript'), ('typescript'), ('python')
      ON CONFLICT (name) DO NOTHING
    `;

    // Define entity with M2M, field defaults, permissions
    const entitySQL = `
      SELECT dzql.register_entity(
        'resources',                                    -- table_name
        'title',                                        -- label_field
        array['title', 'content'],                      -- searchable_fields
        '{"owner": "users", "created_by": "users"}', -- fk_includes
        true,                                           -- soft_delete
        '{}',                                           -- temporal_fields
        '{}',                                           -- notification_paths
        jsonb_build_object(                             -- permission_paths
          'view', array[]::text[],
          'create', array[]::text[],
          'update', array['@owner_id'],
          'delete', array['@owner_id']
        ),
        jsonb_build_object(                             -- graph_rules (includes M2M)
          'many_to_many', jsonb_build_object(
            'tags', jsonb_build_object(
              'junction_table', 'resource_tags',
              'local_key', 'resource_id',
              'foreign_key', 'tag_id',
              'target_entity', 'tags',
              'id_field', 'tag_ids',
              'expand', true
            )
          )
        ),
        '{"owner_id": "@user_id", "created_by": "@user_id", "created_at": "@now"}' -- field_defaults
      );
    `;

    // Compile entity
    const compiler = new DZQLCompiler();
    const compiled = compiler.compileFromSQL(entitySQL);

    if (compiled.errors.length > 0) {
      console.error(
        "Compilation errors:",
        JSON.stringify(compiled.errors, null, 2),
      );
      throw new Error("Compilation failed: " + JSON.stringify(compiled.errors));
    }

    // Install compiled functions
    for (const result of compiled.results) {
      try {
        await sql.unsafe(result.sql);
      } catch (err) {
        console.error("Failed to execute generated SQL:");
        console.error("First 2000 chars:", result.sql.substring(0, 2000));
        console.error(
          "Last 500 chars:",
          result.sql.substring(result.sql.length - 500),
        );
        throw err;
      }
    }
  });

  test("Complete lifecycle: create → get → update → delete with M2M, defaults, events", async () => {
    // 1. CREATE - Test field defaults + M2M sync
    const createData = {
      title: testName("Resource"),
      content: "Test content",
      tag_ids: [1, 2], // javascript, typescript
    };

    const created = await sql`
      SELECT save_resources(${aliceUserId}, ${sql.json(createData)}) as result
    `;
    const resource = created[0].result;

    // Validate field defaults were applied
    expect(resource.owner_id).toBe(aliceUserId);
    expect(resource.created_by).toBe(aliceUserId);
    expect(resource.created_at).toBeDefined();

    // Validate M2M junction table was synced
    expect(resource.tag_ids).toEqual([1, 2]);
    expect(resource.tags).toBeArray();
    expect(resource.tags.length).toBe(2);
    expect(resource.tags[0].name).toBeOneOf(["javascript", "typescript"]);

    // Validate event was created
    const events = await sql`
      SELECT * FROM dzql.events
      WHERE table_name = 'resources'
      AND pk->>'id' = ${resource.id.toString()}
      AND op = 'insert'
      ORDER BY event_id DESC
      LIMIT 1
    `;
    expect(events.length).toBe(1);
    expect(events[0].user_id).toBe(aliceUserId);
    expect(events[0].data).toBeDefined();
    // Event should include M2M data
    expect(events[0].data.tag_ids).toEqual([1, 2]);

    const resourceId = resource.id;

    // 2. GET - Test FK expansion
    const fetched = await sql`
      SELECT get_resources(${aliceUserId}, ${resourceId}) as result
    `;
    const fetchedResource = fetched[0].result;

    expect(fetchedResource.id).toBe(resourceId);
    expect(fetchedResource.title).toBe(createData.title);
    // FK should be expanded
    expect(fetchedResource.owner).toBeDefined();
    expect(fetchedResource.owner.id).toBe(aliceUserId);
    // M2M should be included
    expect(fetchedResource.tag_ids).toEqual([1, 2]);
    expect(fetchedResource.tags).toBeArray();

    // 3. UPDATE - Test M2M sync (add tag, remove tag) + event
    const updateData = {
      id: resourceId,
      title: "Updated Title",
      tag_ids: [2, 3], // keep typescript, replace javascript with python
    };

    const updated = await sql`
      SELECT save_resources(${aliceUserId}, ${sql.json(updateData)}) as result
    `;
    const updatedResource = updated[0].result;

    expect(updatedResource.title).toBe("Updated Title");
    expect(updatedResource.tag_ids).toEqual([2, 3]);

    // Validate junction table was synced correctly
    const junctionRows = await sql`
      SELECT tag_id FROM resource_tags
      WHERE resource_id = ${resourceId}
      ORDER BY tag_id
    `;
    expect(junctionRows.map((r) => r.tag_id)).toEqual([2, 3]);

    // Validate update event was created
    const updateEvents = await sql`
      SELECT * FROM dzql.events
      WHERE table_name = 'resources'
      AND pk->>'id' = ${resourceId.toString()}
      AND op = 'update'
      ORDER BY event_id DESC
      LIMIT 1
    `;
    expect(updateEvents.length).toBe(1);
    expect(updateEvents[0].data).toBeDefined();
    expect(updateEvents[0].data.title).toBe("Updated Title");
    // Events should include M2M current state
    expect(updateEvents[0].data.tag_ids).toEqual([2, 3]);

    // 4. SEARCH - Test filtering
    const searchResults = await sql`
      SELECT search_resources(${aliceUserId}, ${sql.json({})}) as result
    `;
    const searchData = searchResults[0].result;

    expect(searchData.data).toBeArray();
    expect(searchData.total).toBeGreaterThan(0);
    expect(searchData.data.some((r) => r.id === resourceId)).toBe(true);
    // Search results should include M2M
    const found = searchData.data.find((r) => r.id === resourceId);
    expect(found.tag_ids).toEqual([2, 3]);

    // 5. DELETE - Test soft delete + event
    const deleted = await sql`
      SELECT delete_resources(${aliceUserId}, ${resourceId}) as result
    `;
    const deletedResource = deleted[0].result;

    expect(deletedResource.deleted_at).not.toBeNull();

    // Validate delete event was created
    const deleteEvents = await sql`
      SELECT * FROM dzql.events
      WHERE table_name = 'resources'
      AND pk->>'id' = ${resourceId.toString()}
      AND op = 'delete'
      ORDER BY event_id DESC
      LIMIT 1
    `;
    expect(deleteEvents.length).toBe(1);
    expect(deleteEvents[0].data).toBeNull();

    // 6. PERMISSIONS - Test that Bob can't update Alice's resource
    await expect(async () => {
      await sql`
        SELECT save_resources(${bobUserId}, ${sql.json({ id: resourceId, title: "Hacked" })}) as result
      `;
    }).toThrow(); // Should throw permission denied
  });
});
