import { parseEntitiesFromSQL } from '../../packages/dzql/src/compiler/parser/entity-parser.js';
import fs from 'fs';

const sql = fs.readFileSync('/Users/peterb/Workshop/hump/entities/calendar.sql', 'utf8');

// Find the resources entity registration
const match = sql.match(/SELECT dzql\.register_entity\s*\(\s*'resources'[\s\S]*?\);/);

if (match) {
  console.log('=== RAW SQL ===');
  console.log(match[0]);
  console.log('\n=== PARSING ===\n');

  const entities = parseEntitiesFromSQL(sql);
  const resources = entities.find(e => e.tableName === 'resources');

  console.log('Parsed config:');
  console.log('  tableName:', resources.tableName);
  console.log('  graphRules:', JSON.stringify(resources.graphRules, null, 2));
  console.log('  manyToMany:', JSON.stringify(resources.manyToMany, null, 2));
  console.log('  fieldDefaults:', JSON.stringify(resources.fieldDefaults, null, 2));
}
