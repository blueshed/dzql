import { DZQLCompiler } from './packages/dzql/src/compiler/index.js';
import postgres from 'postgres';

const sql = postgres('postgres://postgres@localhost:5432/dzql_test');

const entitiesSQL = `
  SELECT dzql.register_entity(
    'users',
    'name',
    array['name', 'email'],
    '{}',
    false,
    '{}',
    '{}',
    jsonb_build_object(
      'view', array[]::text[],
      'create', array[]::text[],
      'update', array['@id'],
      'delete', array['@id']
    )
  );
`;

const compiler = new DZQLCompiler();
const compiled = compiler.compileFromSQL(entitiesSQL);

console.log('Compilation results:');
console.log('  Results count:', compiled.results.length);
console.log('  Errors count:', compiled.errors.length);

if (compiled.errors.length > 0) {
  console.log('\nErrors:');
  compiled.errors.forEach((err, i) => {
    console.log(`  ${i + 1}.`, err);
  });
}

if (compiled.results.length > 0) {
  console.log('\nGenerated SQL length:', compiled.results[0].sql.length);
  console.log('\nFirst 500 chars:');
  console.log(compiled.results[0].sql.substring(0, 500));
}

await sql.end();
