import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { TestDatabase } from '../setup/TestDatabase.js';

let db;
let sql;

beforeAll(async () => {
  db = new TestDatabase();
  sql = await db.setup();
});

afterAll(async () => {
  await db.teardown();
});

describe('Subscribable Functions', () => {
  beforeAll(async () => {
    // Create test table
    await sql`
      CREATE TABLE IF NOT EXISTS test_items (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        value INT DEFAULT 0
      )
    `;
    await sql`TRUNCATE test_items RESTART IDENTITY`;
    await sql`INSERT INTO test_items (id, name, value) VALUES (1, 'Item One', 100)`;

    // Create subscribable functions manually
    await sql.unsafe(`
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
  });

  afterAll(async () => {
    // Cleanup
    await sql`DROP TABLE IF EXISTS test_items CASCADE`;
    await sql`DROP FUNCTION IF EXISTS item_can_subscribe`;
    await sql`DROP FUNCTION IF EXISTS get_item`;
    await sql`DROP FUNCTION IF EXISTS item_affected_documents`;
    await sql`DELETE FROM dzql.subscribables WHERE name = 'item'`;
  });

  test('permission check function works', async () => {
    const result = await sql`
      SELECT item_can_subscribe(1, '{"id": 1}'::jsonb) as result
    `;

    expect(result[0].result).toBe(true);
  });

  test('query function returns correct data', async () => {
    const result = await sql`
      SELECT get_item('{"id": 1}'::jsonb, 1) as data
    `;

    const data = result[0].data;
    expect(data).toBeDefined();
    expect(data.id).toBe(1);
    expect(data.name).toBe('Item One');
    expect(data.value).toBe(100);
  });

  test('affected documents function identifies changes', async () => {
    const result = await sql`
      SELECT item_affected_documents(
        'test_items',
        'update',
        '{"id": 1, "name": "Old", "value": 100}'::jsonb,
        '{"id": 1, "name": "New", "value": 200}'::jsonb
      ) as result
    `;

    const affected = result[0].result;
    expect(affected).toHaveLength(1);
    expect(affected[0].id).toBe(1);
  });

  test('affected documents returns empty for other tables', async () => {
    const result = await sql`
      SELECT item_affected_documents(
        'other_table',
        'update',
        '{"id": 1}'::jsonb,
        '{"id": 1}'::jsonb
      ) as result
    `;

    expect(result[0].result).toHaveLength(0);
  });
});

describe('Subscribable Registration', () => {
  afterAll(async () => {
    // Cleanup
    await sql`DELETE FROM dzql.subscribables WHERE name = 'item'`;
  });

  test('can register a subscribable', async () => {
    const result = await sql`
      SELECT dzql.register_subscribable(
        'item',
        '{"subscribe": []}'::jsonb,
        '{"id": "int"}'::jsonb,
        'test_items',
        '{}'::jsonb
      )
    `;

    expect(result).toBeDefined();
  });

  test('registered subscribable appears in list', async () => {
    const result = await sql`
      SELECT * FROM dzql.get_subscribables() WHERE name = 'item'
    `;

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('item');
    expect(result[0].root_entity).toBe('test_items');
  });

  test('registered subscribable has correct metadata', async () => {
    const result = await sql`
      SELECT * FROM dzql.subscribables WHERE name = 'item'
    `;

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('item');
    expect(result[0].root_entity).toBe('test_items');
    expect(result[0].param_schema).toEqual({ id: 'int' });
  });
});
