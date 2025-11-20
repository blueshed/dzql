/**
 * Test custom function pass-through functionality
 */

import { parseEntitiesFromSQL } from '../../src/compiler/parser/entity-parser.js';
import { DZQLCompiler } from '../../src/compiler/compiler.js';

const testSQL = `
-- Test entity with custom function
SELECT dzql.register_entity(
  'tags',
  'name',
  ARRAY['name'],
  '{}',
  false,
  '{}',
  '{}',
  '{"view": [], "create": [], "update": ["@owner_id"], "delete": ["@owner_id"]}',
  '{}'
);

-- Custom function after entity registration
CREATE OR REPLACE FUNCTION toggle_resource_tag(
  p_user_id INT,
  p_resource_id INT,
  p_tag_id INT
) RETURNS JSONB AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM resource_tags
    WHERE resource_id = p_resource_id
    AND tag_id = p_tag_id
  ) INTO v_exists;

  IF v_exists THEN
    DELETE FROM resource_tags
    WHERE resource_id = p_resource_id
    AND tag_id = p_tag_id;
  ELSE
    INSERT INTO resource_tags (resource_id, tag_id)
    VALUES (p_resource_id, p_tag_id);
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Register the custom function
INSERT INTO dzql.registry (fn_regproc)
VALUES ('toggle_resource_tag'::regproc);
`;

console.log('Testing Custom Function Pass-through\n');
console.log('=====================================\n');

// Test 1: Parse entities and check custom functions
console.log('Test 1: Parsing entity with custom function...');
const entities = parseEntitiesFromSQL(testSQL);

if (entities.length === 0) {
  console.error('❌ FAILED: No entities parsed');
  process.exit(1);
}

console.log(`✓ Parsed ${entities.length} entity`);

const entity = entities[0];
console.log(`✓ Entity name: ${entity.tableName}`);

if (!entity.customFunctions) {
  console.error('❌ FAILED: customFunctions property missing');
  process.exit(1);
}

console.log(`✓ Found ${entity.customFunctions.length} custom function(s)`);

if (entity.customFunctions.length === 0) {
  console.error('❌ FAILED: No custom functions extracted');
  process.exit(1);
}

// Check if CREATE FUNCTION was captured
const hasCreateFunction = entity.customFunctions.some(fn =>
  fn.includes('CREATE OR REPLACE FUNCTION toggle_resource_tag')
);

if (!hasCreateFunction) {
  console.error('❌ FAILED: CREATE FUNCTION not captured');
  console.log('Captured functions:', entity.customFunctions);
  process.exit(1);
}

console.log('✓ CREATE FUNCTION statement captured');

// Check if registry INSERT was captured
const hasRegistry = entity.customFunctions.some(fn =>
  fn.includes('INSERT INTO dzql.registry')
);

if (!hasRegistry) {
  console.error('❌ FAILED: Registry INSERT not captured');
  process.exit(1);
}

console.log('✓ Registry INSERT statement captured\n');

// Test 2: Compile and check output
console.log('Test 2: Compiling entity with custom functions...');
const compiler = new DZQLCompiler();
const result = compiler.compile(entity);

if (!result.sql) {
  console.error('❌ FAILED: No SQL generated');
  process.exit(1);
}

console.log('✓ SQL compiled successfully');

// Check if custom functions section is in output
if (!result.sql.includes('Custom Functions for: tags')) {
  console.error('❌ FAILED: Custom functions section not found in compiled SQL');
  process.exit(1);
}

console.log('✓ Custom functions section present');

if (!result.sql.includes('toggle_resource_tag')) {
  console.error('❌ FAILED: Custom function not in compiled output');
  process.exit(1);
}

console.log('✓ Custom function included in output\n');

// Test 3: Multiple entities
console.log('Test 3: Multiple entities with custom functions...');
const multiEntitySQL = `
SELECT dzql.register_entity('users', 'name', ARRAY['name'], '{}', false, '{}', '{}', '{}', '{}');
CREATE FUNCTION user_helper() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;

SELECT dzql.register_entity('posts', 'title', ARRAY['title'], '{}', false, '{}', '{}', '{}', '{}');
CREATE FUNCTION post_helper() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;
`;

const multiEntities = parseEntitiesFromSQL(multiEntitySQL);

if (multiEntities.length !== 2) {
  console.error(`❌ FAILED: Expected 2 entities, got ${multiEntities.length}`);
  process.exit(1);
}

console.log(`✓ Parsed ${multiEntities.length} entities`);

const usersEntity = multiEntities.find(e => e.tableName === 'users');
const postsEntity = multiEntities.find(e => e.tableName === 'posts');

if (!usersEntity || !postsEntity) {
  console.error('❌ FAILED: Missing expected entities');
  process.exit(1);
}

if (!usersEntity.customFunctions.some(fn => fn.includes('user_helper'))) {
  console.error('❌ FAILED: user_helper not captured for users entity');
  process.exit(1);
}

console.log('✓ user_helper associated with users entity');

if (!postsEntity.customFunctions.some(fn => fn.includes('post_helper'))) {
  console.error('❌ FAILED: post_helper not captured for posts entity');
  process.exit(1);
}

console.log('✓ post_helper associated with posts entity');

// Make sure functions aren't crossed
if (usersEntity.customFunctions.some(fn => fn.includes('post_helper'))) {
  console.error('❌ FAILED: post_helper incorrectly in users entity');
  process.exit(1);
}

console.log('✓ Functions correctly isolated to their entities\n');

console.log('=====================================');
console.log('✅ All tests passed!');
console.log('=====================================\n');
