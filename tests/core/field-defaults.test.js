/**
 * Test field defaults functionality
 */

import { parseEntitiesFromSQL } from '../../packages/dzql/src/compiler/parser/entity-parser.js';
import { DZQLCompiler } from '../../packages/dzql/src/compiler/compiler.js';

const testSQL = "SELECT dzql.register_entity('resources', 'title', ARRAY['title'], '{}', false, '{}', '{}', '{}', '{}', '{\"owner_id\": \"@user_id\", \"created_by\": \"@user_id\", \"created_at\": \"@now\", \"status\": \"draft\"}');";

console.log('Testing Field Defaults');
console.log('=====');

const entities = parseEntitiesFromSQL(testSQL);

if (entities.length === 0) {
  console.error('FAILED: No entities parsed');
  process.exit(1);
}

console.log('✓ Parsed', entities.length, 'entity');

const entity = entities[0];
console.log('✓ Entity name:', entity.tableName);

if (!entity.fieldDefaults) {
  console.error('FAILED: fieldDefaults property missing');
  process.exit(1);
}

console.log('✓ Found', Object.keys(entity.fieldDefaults).length, 'field defaults');

if (Object.keys(entity.fieldDefaults).length === 0) {
  console.error('FAILED: No field defaults extracted');
  process.exit(1);
}

if (entity.fieldDefaults.owner_id !== '@user_id') {
  console.error('FAILED: owner_id default incorrect');
  console.log('Expected: @user_id, Got:', entity.fieldDefaults.owner_id);
  process.exit(1);
}

console.log('✓ owner_id default: @user_id');

if (entity.fieldDefaults.created_by !== '@user_id') {
  console.error('FAILED: created_by default incorrect');
  process.exit(1);
}

console.log('✓ created_by default: @user_id');

if (entity.fieldDefaults.created_at !== '@now') {
  console.error('FAILED: created_at default incorrect');
  process.exit(1);
}

console.log('✓ created_at default: @now');

if (entity.fieldDefaults.status !== 'draft') {
  console.error('FAILED: status default incorrect');
  process.exit(1);
}

console.log('✓ status default: draft (literal)');

const compiler = new DZQLCompiler();
const result = compiler.compile(entity);

if (!result.sql) {
  console.error('FAILED: No SQL generated');
  process.exit(1);
}

console.log('✓ SQL compiled successfully');
console.log('✓ Generated', result.sql.length, 'characters of SQL');

console.log('=====');
console.log('✅ All field defaults tests passed!');
