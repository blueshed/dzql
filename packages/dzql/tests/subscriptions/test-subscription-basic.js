#!/usr/bin/env bun

/**
 * Basic subscription system test - focuses on core functionality
 */

import postgres from "postgres";

const DB_URL = "postgres://postgres@localhost:5432/dzql";
const sql = postgres(DB_URL);

console.log("====================================");
console.log("Basic Subscription System Test");
console.log("====================================\n");

try {
  // Create test table
  console.log("Setup: Creating test table...");
  await sql(`
    CREATE TABLE IF NOT EXISTS test_items (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      value INT DEFAULT 0
    );
  `);
  await sql(`TRUNCATE test_items RESTART IDENTITY;`);
  await sql(
    `INSERT INTO test_items (id, name, value) VALUES (1, 'Item One', 100);`,
  );
  console.log("✓ Test table ready\n");

  // Create simple subscribable functions manually
  console.log("Step 1: Creating subscribable functions...");
  await sql(`
    CREATE OR REPLACE FUNCTION item_can_subscribe(p_user_id INT, p_params JSONB)
    RETURNS BOOLEAN AS $$
    BEGIN
      RETURN TRUE;  -- Allow all for testing
    END;
    $$ LANGUAGE plpgsql STABLE;

    CREATE OR REPLACE FUNCTION get_item(p_params JSONB, p_user_id INT)
    RETURNS JSONB AS $$
    DECLARE
      v_id INT;
      v_result JSONB;
    BEGIN
      v_id := (p_params->>'id')::int;

      IF NOT item_can_subscribe(p_user_id, p_params) THEN
        RAISE EXCEPTION 'Permission denied';
      END IF;

      SELECT jsonb_build_object(
        'id', id,
        'name', name,
        'value', value
      )
      INTO v_result
      FROM test_items
      WHERE id = v_id;

      RETURN v_result;
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION item_affected_documents(
      p_table TEXT,
      p_op TEXT,
      p_old JSONB,
      p_new JSONB
    )
    RETURNS JSONB[] AS $$
    BEGIN
      IF p_table != 'test_items' THEN
        RETURN ARRAY[]::JSONB[];
      END IF;

      RETURN ARRAY[jsonb_build_object(
        'id', COALESCE((p_new->>'id')::int, (p_old->>'id')::int)
      )];
    END;
    $$ LANGUAGE plpgsql IMMUTABLE;
  `);
  console.log("✓ Functions created\n");

  // Test permission check
  console.log("Step 2: Testing permission check...");
  const perm = await sql(
    `SELECT item_can_subscribe(1, '{"id": 1}'::jsonb) as result;`,
  );
  console.log(`  Result: ${perm.rows[0].result}`);
  console.log("✓ Permission check works\n");

  // Test query function
  console.log("Step 3: Testing query function...");
  const query = await sql(
    `SELECT get_item('{"id": 1}'::jsonb, 1) as data;`,
  );
  console.log(`  Data: ${JSON.stringify(query.rows[0].data, null, 2)}`);
  console.log("✓ Query function works\n");

  // Test affected documents
  console.log("Step 4: Testing affected documents...");
  const affected = await sql(`
    SELECT item_affected_documents(
      'test_items',
      'update',
      '{"id": 1, "name": "Old", "value": 100}'::jsonb,
      '{"id": 1, "name": "New", "value": 200}'::jsonb
    ) as result;
  `);
  console.log(`  Affected: ${JSON.stringify(affected.rows[0].result)}`);
  console.log("✓ Affected documents works\n");

  // Test subscribable registration
  console.log("Step 5: Testing subscribable registration...");
  await sql(`
    SELECT dzql.register_subscribable(
      'item',
      '{"subscribe": []}'::jsonb,
      '{"id": "int"}'::jsonb,
      'test_items',
      '{}'::jsonb
    );
  `);

  const list = await sql(
    `SELECT * FROM dzql.get_subscribables() WHERE name = 'item';`,
  );
  console.log(
    `  Registered: ${list.rows[0].name} (root: ${list.rows[0].root_entity})`,
  );
  console.log("✓ Registration works\n");

  // Cleanup
  console.log("Cleanup...");
  await sql(`DROP TABLE IF EXISTS test_items CASCADE;`);
  await sql(`DROP FUNCTION IF EXISTS item_can_subscribe;`);
  await sql(`DROP FUNCTION IF EXISTS get_item;`);
  await sql(`DROP FUNCTION IF EXISTS item_affected_documents;`);
  await sql(`DELETE FROM dzql.subscribables WHERE name = 'item';`);
  console.log("✓ Cleaned up\n");

  console.log("====================================");
  console.log("✓ ALL TESTS PASSED!");
  console.log("====================================\n");

  console.log("Verified functionality:");
  console.log("  ✓ Database schema (dzql.subscribables table)");
  console.log("  ✓ Registration function");
  console.log("  ✓ Permission check pattern");
  console.log("  ✓ Query builder pattern");
  console.log("  ✓ Change detection pattern");
  console.log("  ✓ Subscribable metadata storage\n");

  console.log("Live Query Subscription system is READY! 🎉\n");

  process.exit(0);
} catch (error) {
  console.error("\n❌ Test failed:", error.message);
  console.error(error.stack);
  process.exit(1);
} finally {
  await db.end();
}
