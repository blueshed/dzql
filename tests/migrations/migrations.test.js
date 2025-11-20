/**
 * Tests for database migrations
 * Ensures all migrations run successfully and create expected schema
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { createTestConnection, runMigrations, resetDatabase } from '../setup/db-setup.js';

describe('Database Migrations', () => {
  let sql;

  beforeAll(async () => {
    sql = createTestConnection();
    await resetDatabase(sql);
    await runMigrations(sql);
  });

  test('creates dzql schema', async () => {
    const result = await sql`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name = 'dzql'
    `;

    expect(result).toHaveLength(1);
    expect(result[0].schema_name).toBe('dzql');
  });

  test('creates dzql.meta table with version', async () => {
    const result = await sql`
      SELECT version FROM dzql.meta LIMIT 1
    `;

    expect(result).toHaveLength(1);
    expect(result[0].version).toBeDefined();
  });

  test('creates dzql.entities table', async () => {
    const result = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'dzql' AND table_name = 'entities'
    `;

    expect(result).toHaveLength(1);
  });

  test('creates dzql.registry table', async () => {
    const result = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'dzql' AND table_name = 'registry'
    `;

    expect(result).toHaveLength(1);
  });

  test('creates dzql.events table for audit trail', async () => {
    const result = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'dzql' AND table_name = 'events'
    `;

    expect(result).toHaveLength(1);
  });

  test('creates required indexes on dzql.events', async () => {
    const result = await sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'dzql' AND tablename = 'events'
    `;

    const indexNames = result.map(r => r.indexname);
    expect(indexNames).toContain('dzql_events_table_pk_idx');
    expect(indexNames).toContain('dzql_events_user_idx');
    expect(indexNames).toContain('dzql_events_event_id_idx');
  });

  test('creates register_entity function', async () => {
    const result = await sql`
      SELECT proname
      FROM pg_proc
      WHERE pronamespace = 'dzql'::regnamespace
        AND proname = 'register_entity'
    `;

    expect(result).toHaveLength(1);
  });

  test('creates call function for secure RPC', async () => {
    const result = await sql`
      SELECT proname
      FROM pg_proc
      WHERE pronamespace = 'dzql'::regnamespace
        AND proname = 'call'
    `;

    expect(result).toHaveLength(1);
  });

  test('creates register_user and login_user functions', async () => {
    const result = await sql`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_name IN ('register_user', 'login_user', '_profile')
    `;

    const functionNames = result.map(r => r.routine_name);
    expect(functionNames).toContain('register_user');
    expect(functionNames).toContain('login_user');
    expect(functionNames).toContain('_profile');
  });

  test('creates subscription management functions', async () => {
    const result = await sql`
      SELECT proname
      FROM pg_proc
      WHERE pronamespace = 'dzql'::regnamespace
        AND proname LIKE 'subscription%'
    `;

    expect(result.length).toBeGreaterThan(0);
  });

  test('creates pgcrypto extension for password hashing', async () => {
    const result = await sql`
      SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'
    `;

    expect(result).toHaveLength(1);
  });

  test('entities table has all required columns', async () => {
    const result = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'dzql' AND table_name = 'entities'
      ORDER BY column_name
    `;

    const columns = result.map(r => r.column_name);
    expect(columns).toContain('table_name');
    expect(columns).toContain('label_field');
    expect(columns).toContain('searchable_fields');
    expect(columns).toContain('fk_includes');
    expect(columns).toContain('soft_delete');
    expect(columns).toContain('temporal_fields');
    expect(columns).toContain('notification_paths');
    expect(columns).toContain('permission_paths');
    expect(columns).toContain('graph_rules');
    expect(columns).toContain('field_defaults');
    expect(columns).toContain('many_to_many');
  });

  test('can register a test entity', async () => {
    await sql`
      SELECT dzql.register_entity(
        'test_items',
        'name',
        array['name', 'description'],
        '{}',
        false
      )
    `;

    const result = await sql`
      SELECT table_name FROM dzql.entities WHERE table_name = 'test_items'
    `;

    expect(result).toHaveLength(1);
    expect(result[0].table_name).toBe('test_items');
  });

  test('migrations are idempotent (can run multiple times)', async () => {
    // Run migrations again - should not error
    await expect(runMigrations(sql)).resolves.not.toThrow();

    // Verify meta table still has correct data
    const result = await sql`
      SELECT COUNT(*) as count FROM dzql.meta
    `;

    expect(parseInt(result[0].count)).toBeGreaterThan(0);
  });
});
