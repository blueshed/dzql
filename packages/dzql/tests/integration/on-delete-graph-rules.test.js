/**
 * On-Delete Graph Rules Integration Test
 *
 * Tests that on_delete graph rules correctly use p_old_record for @field references.
 *
 * Bug: The compiler was generating `p_record->>'id'` in on_delete functions,
 * but the parameter is named `p_old_record`, causing "column p_record does not exist" errors.
 *
 * Fix: graph-rules-codegen.js now passes operation context to _resolveValue(),
 * which uses p_old_record for delete, p_new_record for update, p_record for create.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { DZQLCompiler } from "../../packages/dzql/src/compiler/index.js";
import { setupTests, testName } from "../setup/test-helpers.js";

const { sql } = setupTests();

describe("On-Delete Graph Rules", () => {
  let testUserId;
  let db;

  beforeAll(async () => {
    // Create test tables
    await sql`DROP TABLE IF EXISTS gr_allocations CASCADE`;
    await sql`DROP TABLE IF EXISTS gr_sites CASCADE`;
    await sql`DROP TABLE IF EXISTS gr_test_users CASCADE`;

    // Parent table: sites
    await sql`
      CREATE TABLE gr_sites (
        id serial PRIMARY KEY,
        name text NOT NULL,
        created_at timestamptz DEFAULT now()
      )
    `;

    // Child table: allocations (references sites)
    await sql`
      CREATE TABLE gr_allocations (
        id serial PRIMARY KEY,
        site_id int REFERENCES gr_sites(id),
        description text NOT NULL,
        created_at timestamptz DEFAULT now()
      )
    `;

    // Simple users table for test
    await sql`
      CREATE TABLE gr_test_users (
        id serial PRIMARY KEY,
        email text UNIQUE NOT NULL
      )
    `;

    // Create a validation function that checks if a site has allocations
    // This function uses p_site_id parameter - the key thing is that the
    // on_delete graph rule must pass (p_old_record->>'id') not (p_record->>'id')
    await sql`
      CREATE OR REPLACE FUNCTION _gr_site_has_no_allocations(p_site_id TEXT)
      RETURNS BOOLEAN AS $$
      BEGIN
        RETURN NOT EXISTS (
          SELECT 1 FROM gr_allocations WHERE site_id = p_site_id::int
        );
      END;
      $$ LANGUAGE plpgsql
    `;

    // Compile entity with on_delete graph rule
    const compiler = new DZQLCompiler();

    const entitiesSQL = `
      SELECT dzql.register_entity(
        'gr_sites',
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
        ),
        jsonb_build_object(
          'on_delete', jsonb_build_object(
            'prevent_with_allocations', jsonb_build_object(
              'description', 'Cannot delete site with allocations',
              'actions', jsonb_build_array(
                jsonb_build_object(
                  'type', 'validate',
                  'function', '_gr_site_has_no_allocations',
                  'params', jsonb_build_object('p_site_id', '@id'),
                  'error_message', 'Cannot delete site - it has allocations'
                )
              )
            )
          )
        )
      );

      SELECT dzql.register_entity(
        'gr_allocations',
        'description',
        array['description'],
        '{"site": "gr_sites"}',
        false
      );
    `;

    const compiled = compiler.compileFromSQL(entitiesSQL);

    // Execute compiled SQL
    for (const result of compiled.results) {
      await sql.unsafe(result.sql);
    }

    // Create test user
    const userResult = await sql`
      INSERT INTO gr_test_users (email) VALUES ('test@example.com') RETURNING id
    `;
    testUserId = userResult[0].id;

    // Create db.api wrapper following the pattern from compiled-crud.test.js
    db = { api: {} };

    const entities = ["gr_sites", "gr_allocations"];

    for (const entity of entities) {
      // save_* takes (user_id, data jsonb)
      db.api[`save_${entity}`] = async (userId, data) => {
        const result = await sql`
          SELECT ${sql.unsafe(`save_${entity}`)}(${userId}::int, ${sql.json(data)}) as result
        `;
        return result[0].result;
      };

      // delete_* takes (user_id, id)
      db.api[`delete_${entity}`] = async (userId, id) => {
        const result = await sql`
          SELECT ${sql.unsafe(`delete_${entity}`)}(${userId}::int, ${id}::int) as result
        `;
        return result[0].result;
      };
    }
  });

  afterAll(async () => {
    // Cleanup
    await sql`DROP TABLE IF EXISTS gr_allocations CASCADE`;
    await sql`DROP TABLE IF EXISTS gr_sites CASCADE`;
    await sql`DROP TABLE IF EXISTS gr_test_users CASCADE`;
    await sql`DROP FUNCTION IF EXISTS _gr_site_has_no_allocations(TEXT)`;
  });

  test("on_delete graph rule with @id parameter executes without p_record error", async () => {
    // Create a site
    const site = await db.api.save_gr_sites(testUserId, {
      name: testName("TestSite"),
    });
    const siteId = site.id;

    // Delete the site (no allocations, so validation should pass)
    // This is the key test - if the bug exists, this will throw:
    // "PostgresError: column p_record does not exist"
    await db.api.delete_gr_sites(testUserId, siteId);

    // Verify site was deleted
    const remaining = await sql`SELECT * FROM gr_sites WHERE id = ${siteId}`;
    expect(remaining.length).toBe(0);
  });

  test("on_delete validation prevents delete when children exist", async () => {
    // Create a site
    const site = await db.api.save_gr_sites(testUserId, {
      name: testName("SiteWithAlloc"),
    });
    const siteId = site.id;

    // Create an allocation referencing the site
    await db.api.save_gr_allocations(testUserId, {
      site_id: siteId,
      description: "Test allocation",
    });

    // Try to delete the site - should fail with our custom error message
    let errorThrown = false;
    let errorMessage = "";
    try {
      await db.api.delete_gr_sites(testUserId, siteId);
    } catch (e) {
      errorThrown = true;
      errorMessage = e.message;
    }

    expect(errorThrown).toBe(true);
    expect(errorMessage).toContain("Cannot delete site - it has allocations");

    // Site should still exist
    const remaining = await sql`SELECT * FROM gr_sites WHERE id = ${siteId}`;
    expect(remaining.length).toBe(1);
  });

  test("on_delete validation allows delete after children removed", async () => {
    // Create a site
    const site = await db.api.save_gr_sites(testUserId, {
      name: testName("SiteRemoveAlloc"),
    });
    const siteId = site.id;

    // Create an allocation
    const alloc = await db.api.save_gr_allocations(testUserId, {
      site_id: siteId,
      description: "Temporary allocation",
    });
    const allocId = alloc.id;

    // Delete the allocation first
    await db.api.delete_gr_allocations(testUserId, allocId);

    // Now delete the site - should succeed
    await db.api.delete_gr_sites(testUserId, siteId);

    // Verify site was deleted
    const remaining = await sql`SELECT * FROM gr_sites WHERE id = ${siteId}`;
    expect(remaining.length).toBe(0);
  });
});
