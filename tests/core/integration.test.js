import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { setupTests } from '../setup/test-helpers.js';
import { DZQLCompiler } from '../../packages/dzql/src/compiler/compiler.js';

const { sql } = setupTests();

describe('Subscription System Integration', () => {
  let compiledSQL;

  beforeAll(async () => {
    // Create test table first
    await sql`
      CREATE TABLE IF NOT EXISTS test_entity (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        owner_id INT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`TRUNCATE test_entity RESTART IDENTITY`;
    await sql`
      INSERT INTO test_entity (id, name, owner_id)
      VALUES (1, 'Test Item', 100)
    `;

    // Register entity with DZQL
    await sql`
      SELECT dzql.register_entity(
        'test_entity',
        'name',
        array['name'],
        '{}'::jsonb,
        false
      )
    `;

    // Register subscribable
    await sql`
      SELECT dzql.register_subscribable(
        'test_simple',
        '{"subscribe": ["@owner_id"]}'::jsonb,
        '{"id": "int"}'::jsonb,
        'test_entity',
        '{}'::jsonb
      )
    `;

    // Compile subscribable
    const compiler = new DZQLCompiler();
    const subscribable = {
      name: 'test_simple',
      permissionPaths: { subscribe: ['@owner_id'] },
      paramSchema: { id: 'int' },
      rootEntity: 'test_entity',
      relations: {}
    };

    const result = compiler.compileSubscribable(subscribable);
    compiledSQL = result.sql;

    // Deploy compiled functions
    await sql.unsafe(compiledSQL);
  });

  afterAll(async () => {
    // Cleanup
    await sql`DROP TABLE IF EXISTS test_entity`;
    await sql`DELETE FROM dzql.subscribables WHERE name = 'test_simple'`;
    await sql`DROP FUNCTION IF EXISTS test_simple_can_subscribe`;
    await sql`DROP FUNCTION IF EXISTS get_test_simple`;
    await sql`DROP FUNCTION IF EXISTS test_simple_affected_documents`;
  });

  test('subscribable is registered', async () => {
    const result = await sql`
      SELECT * FROM dzql.get_subscribables() WHERE name = 'test_simple'
    `;

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('test_simple');
    expect(result[0].root_entity).toBe('test_entity');
  });

  test('compiler generates SQL successfully', () => {
    expect(compiledSQL).toBeDefined();
    expect(compiledSQL).toContain('test_simple_can_subscribe');
    expect(compiledSQL).toContain('get_test_simple');
    expect(compiledSQL).toContain('test_simple_affected_documents');
  });

  describe('Permission Checking', () => {
    test('owner can subscribe', async () => {
      const result = await sql`
        SELECT test_simple_can_subscribe(100, '{"id": 1}'::jsonb) as can_subscribe
      `;

      expect(result[0].can_subscribe).toBe(true);
    });

    test('non-owner cannot subscribe', async () => {
      const result = await sql`
        SELECT test_simple_can_subscribe(999, '{"id": 1}'::jsonb) as can_subscribe
      `;

      expect(result[0].can_subscribe).toBe(false);
    });
  });

  describe('Query Function', () => {
    test('returns document for authorized user', async () => {
      const result = await sql`
        SELECT get_test_simple('{"id": 1}'::jsonb, 100) as data
      `;

      const data = result[0].data;
      expect(data).toBeDefined();
      expect(data.test_entity).toBeDefined();
      expect(data.test_entity.id).toBe(1);
      expect(data.test_entity.name).toBe('Test Item');
      expect(data.test_entity.owner_id).toBe(100);
    });
  });

  describe('Change Detection', () => {
    test('identifies affected subscriptions for updates', async () => {
      const result = await sql`
        SELECT test_simple_affected_documents(
          'test_entity',
          'update',
          '{"id": 1, "name": "Old"}'::jsonb,
          '{"id": 1, "name": "New"}'::jsonb
        ) as affected
      `;

      const affected = result[0].affected;
      expect(affected).toHaveLength(1);
      expect(affected[0].id).toBe(1);
    });

    test('returns empty for other tables', async () => {
      const result = await sql`
        SELECT test_simple_affected_documents(
          'other_table',
          'update',
          '{"id": 1}'::jsonb,
          '{"id": 1}'::jsonb
        ) as affected
      `;

      expect(result[0].affected).toHaveLength(0);
    });
  });
});
