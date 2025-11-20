/**
 * Test Many-to-Many functionality
 */

import { parseEntitiesFromSQL } from '../../packages/dzql/src/compiler/parser/entity-parser.js';
import { DZQLCompiler } from '../../packages/dzql/src/compiler/compiler.js';

const testSQL = "SELECT dzql.register_entity('resources', 'title', ARRAY['title'], '{}', false, '{}', '{}', '{}', '{\"many_to_many\": {\"tags\": {\"junction_table\": \"resource_tags\", \"local_key\": \"resource_id\", \"foreign_key\": \"tag_id\", \"target_entity\": \"tags\", \"id_field\": \"tag_ids\", \"expand\": false}}}', '{}');";

console.log('Testing Many-to-Many Support');
console.log('=====');

const entities = parseEntitiesFromSQL(testSQL);

if (entities.length === 0) {
  console.error('FAILED: No entities parsed');
  process.exit(1);
}

console.log('✓ Parsed', entities.length, 'entity');

const entity = entities[0];
console.log('✓ Entity name:', entity.tableName);

if (!entity.manyToMany) {
  console.error('FAILED: manyToMany property missing');
  console.log('Entity:', JSON.stringify(entity, null, 2));
  process.exit(1);
}

console.log('✓ manyToMany property exists');

const m2mKeys = Object.keys(entity.manyToMany);
if (m2mKeys.length === 0) {
  console.error('FAILED: No M2M relationships found');
  process.exit(1);
}

console.log('✓ Found', m2mKeys.length, 'M2M relationship(s)');

if (!entity.manyToMany.tags) {
  console.error('FAILED: tags M2M relationship not found');
  process.exit(1);
}

console.log('✓ tags relationship found');

const tagsConfig = entity.manyToMany.tags;

if (tagsConfig.junction_table !== 'resource_tags') {
  console.error('FAILED: junction_table incorrect');
  console.log('Expected: resource_tags, Got:', tagsConfig.junction_table);
  process.exit(1);
}

console.log('✓ junction_table: resource_tags');

if (tagsConfig.local_key !== 'resource_id') {
  console.error('FAILED: local_key incorrect');
  process.exit(1);
}

console.log('✓ local_key: resource_id');

if (tagsConfig.foreign_key !== 'tag_id') {
  console.error('FAILED: foreign_key incorrect');
  process.exit(1);
}

console.log('✓ foreign_key: tag_id');

if (tagsConfig.target_entity !== 'tags') {
  console.error('FAILED: target_entity incorrect');
  process.exit(1);
}

console.log('✓ target_entity: tags');

if (tagsConfig.id_field !== 'tag_ids') {
  console.error('FAILED: id_field incorrect');
  process.exit(1);
}

console.log('✓ id_field: tag_ids');

if (tagsConfig.expand !== 'false' && tagsConfig.expand !== false) {
  console.error('FAILED: expand flag incorrect');
  console.log('Expected: false, Got:', tagsConfig.expand);
  process.exit(1);
}

console.log('✓ expand: false (default for performance)');

// Test compilation
const compiler = new DZQLCompiler();
const result = compiler.compile(entity);

if (!result.sql) {
  console.error('FAILED: No SQL generated');
  process.exit(1);
}

console.log('✓ SQL compiled successfully');
console.log('✓ Generated', result.sql.length, 'characters of SQL');

// Test with expand: true
const expandTrueSQL = "SELECT dzql.register_entity('posts', 'title', ARRAY['title'], '{}', false, '{}', '{}', '{}', '{\"many_to_many\": {\"categories\": {\"junction_table\": \"post_categories\", \"local_key\": \"post_id\", \"foreign_key\": \"category_id\", \"target_entity\": \"categories\", \"id_field\": \"category_ids\", \"expand\": true}}}', '{}');";

const expandEntities = parseEntitiesFromSQL(expandTrueSQL);

if (expandEntities.length === 0) {
  console.error('FAILED: expand: true entity not parsed');
  process.exit(1);
}

const expandEntity = expandEntities[0];

if (expandEntity.manyToMany.categories.expand !== 'true' && expandEntity.manyToMany.categories.expand !== true) {
  console.error('FAILED: expand: true not parsed correctly');
  console.log('Got:', expandEntity.manyToMany.categories.expand);
  process.exit(1);
}

console.log('✓ expand: true parsed correctly');

console.log('=====');
console.log('✅ All M2M tests passed!');
