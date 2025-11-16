import { EntityParser } from './src/parser/entity-parser.js';
import { readFileSync } from 'fs';

const parser = new EntityParser();
const sql = readFileSync('./examples/test-graph-rules.sql', 'utf8');

console.log('SQL:', sql);
console.log('\n---\n');

try {
  const entities = parser.parseFromSQL(sql);
  console.log('Parsed entity:', JSON.stringify(entities, null, 2));
  console.log('\n---\n');
  console.log('Graph rules:', entities.graphRules);
  console.log('Graph rules type:', typeof entities.graphRules);
  console.log('Graph rules keys:', Object.keys(entities.graphRules));
} catch (e) {
  console.error('Parse error:', e);
  console.error(e.stack);
}
