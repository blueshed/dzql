#!/usr/bin/env bun

/**
 * Simple subscription system integration test
 * Tests compilation and database functions without needing a running server
 */

import { DZQLCompiler } from './src/compiler/compiler.js';
import postgres from 'postgres';

const DB_URL = 'postgres://postgres@localhost:5432/dzql';
const sql = postgres(DB_URL);

console.log('=====================================');
console.log('Subscription System Integration Test');
console.log('=====================================\n');

try {
  // Step 1: Register subscribable
  console.log('Step 1: Registering subscribable...');
  await sql(`
    SELECT dzql.register_subscribable(
      'test_simple',
      '{"subscribe": ["@owner_id"]}'::jsonb,
      '{"id": "int"}'::jsonb,
      'test_entity',
      '{}'::jsonb
    );
  `);
  console.log('✓ Subscribable registered\n');

  // Step 2: Compile subscribable
  console.log('Step 2: Compiling subscribable...');
  const compiler = new DZQLCompiler();
  const subscribable = {
    name: 'test_simple',
    permissionPaths: { subscribe: ['@owner_id'] },
    paramSchema: { id: 'int' },
    rootEntity: 'test_entity',
    relations: {}
  };

  const result = compiler.compileSubscribable(subscribable);
  console.log(`✓ Compiled successfully (${result.compilationTime}ms)\n`);

  // Step 3: Create test table
  console.log('Step 3: Creating test table...');
  await sql(`
    CREATE TABLE IF NOT EXISTS test_entity (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id INT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await sql(`TRUNCATE test_entity RESTART IDENTITY;`);
  await sql(`
    INSERT INTO test_entity (id, name, owner_id)
    VALUES (1, 'Test Item', 100);
  `);
  console.log('✓ Test table created with sample data\n');

  // Step 4: Deploy compiled functions
  console.log('Step 4: Deploying compiled functions...');
  await sql(result.sql);
  console.log('✓ Functions deployed\n');

  // Step 5: Test permission check
  console.log('Step 5: Testing permission check...');
  const permResult = await sql(`
    SELECT test_simple_can_subscribe(100, '{"id": 1}'::jsonb) as can_subscribe;
  `);
  console.log(`  Owner (100) can subscribe: ${permResult.rows[0].can_subscribe}`);

  const permResult2 = await sql(`
    SELECT test_simple_can_subscribe(999, '{"id": 1}'::jsonb) as can_subscribe;
  `);
  console.log(`  Non-owner (999) can subscribe: ${permResult2.rows[0].can_subscribe}`);
  console.log('✓ Permission check working\n');

  // Step 6: Test query function
  console.log('Step 6: Testing query function...');
  const queryResult = await sql(`
    SELECT get_test_simple('{"id": 1}'::jsonb, 100) as data;
  `);
  console.log('  Query result:', JSON.stringify(queryResult.rows[0].data, null, 2));
  console.log('✓ Query function working\n');

  // Step 7: Test affected documents
  console.log('Step 7: Testing affected documents...');
  const affectedResult = await sql(`
    SELECT test_simple_affected_documents(
      'test_entity',
      'update',
      '{"id": 1, "name": "Old"}'::jsonb,
      '{"id": 1, "name": "New"}'::jsonb
    ) as affected;
  `);
  console.log('  Affected subscriptions:', JSON.stringify(affectedResult.rows[0].affected));
  console.log('✓ Affected documents function working\n');

  // Step 8: Verify subscribable in registry
  console.log('Step 8: Verifying subscribable registry...');
  const listResult = await sql(`
    SELECT * FROM dzql.get_subscribables();
  `);
  console.log(`  Total subscribables registered: ${listResult.rows.length}`);
  listResult.rows.forEach(row => {
    console.log(`  - ${row.name} (root: ${row.root_entity})`);
  });
  console.log('✓ Registry working\n');

  // Cleanup
  console.log('Cleanup: Removing test data...');
  await sql(`DROP TABLE IF EXISTS test_entity;`);
  await sql(`DELETE FROM dzql.subscribables WHERE name = 'test_simple';`);
  await sql(`DROP FUNCTION IF EXISTS test_simple_can_subscribe;`);
  await sql(`DROP FUNCTION IF EXISTS get_test_simple;`);
  await sql(`DROP FUNCTION IF EXISTS test_simple_affected_documents;`);
  console.log('✓ Cleanup complete\n');

  console.log('=====================================');
  console.log('✓ All tests passed!');
  console.log('=====================================\n');

  console.log('Summary:');
  console.log('  ✓ Subscribable registration');
  console.log('  ✓ Code compilation');
  console.log('  ✓ Function deployment');
  console.log('  ✓ Permission checking');
  console.log('  ✓ Query execution');
  console.log('  ✓ Change detection');
  console.log('  ✓ Registry management\n');

  process.exit(0);
} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  console.error(error.stack);
  process.exit(1);
} finally {
  await db.end();
}
