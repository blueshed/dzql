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

console.log('=== COMPILING ===\n');
const compiler = new DZQLCompiler();
const compiled = compiler.compileFromSQL(entitiesSQL);

console.log('Results:', compiled.results.length);
console.log('Errors:', compiled.errors.length);

if (compiled.results.length > 0) {
  const generatedSQL = compiled.results[0].sql;
  console.log('\n=== GENERATED SQL (first 2000 chars) ===\n');
  console.log(generatedSQL.substring(0, 2000));

  console.log('\n=== EXECUTING GENERATED SQL ===\n');
  try {
    await sql.unsafe(generatedSQL);
    console.log('✅ SQL executed successfully\n');

    console.log('=== CHECKING CREATED FUNCTIONS ===\n');
    const funcs = await sql`
      SELECT routine_name, routine_type
      FROM information_schema.routines
      WHERE routine_schema = 'public'
      AND routine_name LIKE '%users%'
      ORDER BY routine_name
    `;

    console.log('Functions created:', funcs.length);
    funcs.forEach(f => console.log('  -', f.routine_name));

    if (funcs.length > 0) {
      console.log('\n=== TESTING save_users FUNCTION ===\n');
      const testData = {
        name: 'Test User',
        email: 'test@example.com',
        password_hash: 'dummy_hash'
      };

      console.log('Calling: save_users(1, testData)');
      const result = await sql`
        SELECT save_users(1, ${sql.json(testData)}) as result
      `;
      console.log('Result:', result[0].result);
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.position) console.error('   Position:', err.position);
    if (err.where) console.error('   Where:', err.where);
  }
}

await sql.end();
