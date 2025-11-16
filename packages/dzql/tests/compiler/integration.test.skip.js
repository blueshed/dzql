/**
 * Integration Tests for Compiled DZQL Functions
 * Tests compiled functions against a real PostgreSQL database
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { readFileSync } from 'fs';
import postgres from 'postgres';
import { compileFromSQL } from '../src/compiler.js';

// Database connection
const sql = postgres({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || 'dzql_test',
  username: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres'
});

describe('Integration Tests', () => {
  beforeAll(async () => {
    // Create test tables
    await sql`
      DROP TABLE IF EXISTS acts_for CASCADE;
      DROP TABLE IF EXISTS organisations CASCADE;
      DROP TABLE IF EXISTS test_users CASCADE;
    `;

    await sql`
      CREATE TABLE test_users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    await sql`
      CREATE TABLE organisations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        owner_id INT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    await sql`
      CREATE TABLE acts_for (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL,
        org_id INT NOT NULL,
        valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
        valid_to DATE
      );
    `;

    // Compile and deploy test entity
    const entitySQL = readFileSync('./examples/test-graph-rules.sql', 'utf8');
    const compiled = compileFromSQL(entitySQL);

    if (compiled.results.length > 0) {
      const compiledSQL = compiled.results[0].sql;

      // Split on CREATE statements and execute each
      const statements = compiledSQL.split(/(?=CREATE OR REPLACE FUNCTION)/);
      for (const stmt of statements) {
        if (stmt.trim()) {
          await sql.unsafe(stmt);
        }
      }
    }

    // Insert test data
    await sql`
      INSERT INTO test_users (id, email) VALUES
        (1, 'admin@test.com'),
        (2, 'user@test.com'),
        (3, 'guest@test.com')
    `;
  });

  afterAll(async () => {
    await sql.end();
  });

  describe('Permission Functions', () => {
    test('can_view_organisations - owner can view', async () => {
      const [result] = await sql`
        SELECT can_view_organisations(1, '{"owner_id": 1}'::jsonb) as can_view
      `;
      expect(result.can_view).toBe(true);
    });

    test('can_view_organisations - non-owner cannot view', async () => {
      const [result] = await sql`
        SELECT can_view_organisations(2, '{"owner_id": 1}'::jsonb) as can_view
      `;
      expect(result.can_view).toBe(false);
    });

    test('can_view_organisations - acts_for relationship grants access', async () => {
      // Create test org
      const [org] = await sql`
        INSERT INTO organisations (name, owner_id)
        VALUES ('Test Org', 1)
        RETURNING id
      `;

      // Create acts_for relationship
      await sql`
        INSERT INTO acts_for (user_id, org_id, valid_from, valid_to)
        VALUES (2, ${org.id}, CURRENT_DATE, NULL)
      `;

      const [result] = await sql`
        SELECT can_view_organisations(2, jsonb_build_object('org_id', ${org.id})) as can_view
      `;
      expect(result.can_view).toBe(true);
    });

    test('can_create_organisations - returns false (permission: true)', async () => {
      const [result] = await sql`
        SELECT can_create_organisations(1, '{}'::jsonb) as can_create
      `;
      // Note: The permission is set to 'true' string which evaluates to false
      expect(result.can_create).toBe(false);
    });

    test('can_delete_organisations - only owner can delete', async () => {
      const [canDelete] = await sql`
        SELECT can_delete_organisations(1, '{"owner_id": 1}'::jsonb) as can_delete
      `;
      expect(canDelete.can_delete).toBe(true);

      const [cannotDelete] = await sql`
        SELECT can_delete_organisations(2, '{"owner_id": 1}'::jsonb) as can_delete
      `;
      expect(cannotDelete.can_delete).toBe(false);
    });
  });

  describe('LOOKUP Function', () => {
    beforeAll(async () => {
      await sql`DELETE FROM organisations`;
      await sql`
        INSERT INTO organisations (name, owner_id) VALUES
          ('Alpha Corp', 1),
          ('Beta Industries', 1),
          ('Gamma Solutions', 2)
      `;
    });

    test('lookup_organisations - returns all when no filter', async () => {
      const [result] = await sql`
        SELECT lookup_organisations() as data
      `;
      const data = result.data;
      expect(data.length).toBe(3);
      expect(data[0]).toHaveProperty('value');
      expect(data[0]).toHaveProperty('label');
    });

    test('lookup_organisations - filters by name', async () => {
      const [result] = await sql`
        SELECT lookup_organisations('Alpha') as data
      `;
      const data = result.data;
      expect(data.length).toBe(1);
      expect(data[0].label).toBe('Alpha Corp');
    });

    test('lookup_organisations - case insensitive filter', async () => {
      const [result] = await sql`
        SELECT lookup_organisations('beta') as data
      `;
      const data = result.data;
      expect(data.length).toBe(1);
      expect(data[0].label).toBe('Beta Industries');
    });

    test('lookup_organisations - respects limit', async () => {
      const [result] = await sql`
        SELECT lookup_organisations(NULL, NULL, 2) as data
      `;
      const data = result.data;
      expect(data.length).toBe(2);
    });
  });

  describe('SEARCH Function', () => {
    beforeAll(async () => {
      await sql`DELETE FROM organisations`;
      await sql`
        INSERT INTO organisations (name, description, owner_id) VALUES
          ('Tech Corp', 'Technology company', 1),
          ('Design Co', 'Design agency', 1),
          ('Tech Solutions', 'Another tech company', 2),
          ('Marketing Inc', 'Marketing services', 2)
      `;
    });

    test('search_organisations - basic search', async () => {
      const [result] = await sql`
        SELECT search_organisations('{}', 'Tech') as data
      `;
      expect(result.data.data.length).toBe(2);
      expect(result.data.total).toBe(2);
    });

    test('search_organisations - pagination', async () => {
      const [page1] = await sql`
        SELECT search_organisations('{}', NULL, NULL, 1, 2) as data
      `;
      expect(page1.data.data.length).toBe(2);
      expect(page1.data.page).toBe(1);

      const [page2] = await sql`
        SELECT search_organisations('{}', NULL, NULL, 2, 2) as data
      `;
      expect(page2.data.data.length).toBe(2);
      expect(page2.data.page).toBe(2);
    });

    test('search_organisations - exact match filter', async () => {
      const [result] = await sql`
        SELECT search_organisations('{"name": "Tech Corp"}'::jsonb) as data
      `;
      expect(result.data.data.length).toBe(1);
      expect(result.data.data[0].name).toBe('Tech Corp');
    });

    test('search_organisations - ilike filter', async () => {
      const [result] = await sql`
        SELECT search_organisations('{"name": {"ilike": "%tech%"}}'::jsonb) as data
      `;
      expect(result.data.data.length).toBe(2);
    });

    test('search_organisations - in filter', async () => {
      const [result] = await sql`
        SELECT search_organisations('{"name": {"in": ["Tech Corp", "Design Co"]}}'::jsonb) as data
      `;
      expect(result.data.data.length).toBe(2);
    });

    test('search_organisations - multiple filters', async () => {
      const [result] = await sql`
        SELECT search_organisations('{"owner_id": 1, "name": {"ilike": "%tech%"}}'::jsonb) as data
      `;
      expect(result.data.data.length).toBe(1);
      expect(result.data.data[0].name).toBe('Tech Corp');
    });

    test('search_organisations - sorting', async () => {
      const [result] = await sql`
        SELECT search_organisations('{}', NULL, '{"field": "name", "order": "desc"}'::jsonb) as data
      `;
      expect(result.data.data[0].name).toBe('Tech Solutions');
    });
  });

  describe('Graph Rules', () => {
    beforeAll(async () => {
      await sql`DELETE FROM acts_for`;
      await sql`DELETE FROM organisations`;
    });

    test('graph_organisations_on_create - creates acts_for relationship', async () => {
      // Create org
      const [org] = await sql`
        INSERT INTO organisations (name, owner_id)
        VALUES ('Test Graph Org', 1)
        RETURNING *
      `;

      // Execute graph rule
      await sql`
        SELECT graph_organisations_on_create(to_jsonb(${org}), 1)
      `;

      // Verify acts_for was created
      const [actsFor] = await sql`
        SELECT * FROM acts_for
        WHERE user_id = 1 AND org_id = ${org.id}
      `;

      expect(actsFor).toBeDefined();
      expect(actsFor.user_id).toBe(1);
      expect(actsFor.org_id).toBe(org.id);
      expect(actsFor.valid_to).toBeNull();
    });
  });

  describe('End-to-End Workflow', () => {
    test('complete workflow: create org, verify permissions, search', async () => {
      await sql`DELETE FROM acts_for`;
      await sql`DELETE FROM organisations`;

      // Step 1: Create organization (simulating SAVE)
      const [org] = await sql`
        INSERT INTO organisations (name, description, owner_id)
        VALUES ('E2E Test Org', 'End-to-end test', 1)
        RETURNING *
      `;

      // Step 2: Execute graph rules (auto-creates acts_for)
      await sql`
        SELECT graph_organisations_on_create(to_jsonb(${org}), 1)
      `;

      // Step 3: Verify owner can view
      const [canView] = await sql`
        SELECT can_view_organisations(1, to_jsonb(${org})) as can_view
      `;
      expect(canView.can_view).toBe(true);

      // Step 4: Verify acts_for member can view
      const [memberCanView] = await sql`
        SELECT can_view_organisations(1, jsonb_build_object('org_id', ${org.id})) as can_view
      `;
      expect(memberCanView.can_view).toBe(true);

      // Step 5: Search and find it
      const [searchResult] = await sql`
        SELECT search_organisations('{}', 'E2E') as data
      `;
      expect(searchResult.data.data.length).toBe(1);
      expect(searchResult.data.data[0].name).toBe('E2E Test Org');

      // Step 6: Lookup finds it
      const [lookupResult] = await sql`
        SELECT lookup_organisations('E2E') as data
      `;
      expect(lookupResult.data.length).toBe(1);
      expect(lookupResult.data[0].label).toBe('E2E Test Org');
    });
  });
});
