/**
 * Integration test for Null-Root Dashboard Subscribable
 *
 * Tests subscribables with no root entity - pure collection mode where:
 * 1. rootEntity is NULL
 * 2. All relations use filter: "TRUE" to fetch ALL rows
 * 3. _affected_documents returns '{}' to notify ALL subscribers
 *
 * Use case: A global dashboard showing all events, venues, etc. system-wide
 * without being anchored to any specific root entity.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestDatabase } from "../setup/TestDatabase.js";
import { DZQLCompiler } from "../../packages/dzql/src/compiler/compiler.js";

let db;
let sql;

beforeAll(async () => {
  db = new TestDatabase();
  sql = await db.setup();
});

afterAll(async () => {
  await db.teardown();
});

describe("Null-Root Dashboard (rootEntity: null)", () => {
  const testUserId = 1;

  beforeAll(async () => {
    // Create test tables
    await sql`
      CREATE TABLE IF NOT EXISTS global_events (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        venue_name TEXT
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS global_venues (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        city TEXT
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS global_users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT
      )
    `;

    // Insert test data
    await sql`
      INSERT INTO global_events (id, name, venue_name)
      VALUES (1, 'Concert A', 'Stadium'),
             (2, 'Concert B', 'Arena'),
             (3, 'Conference', 'Convention Center')
      ON CONFLICT (id) DO NOTHING
    `;

    await sql`
      INSERT INTO global_venues (id, name, city)
      VALUES (1, 'Stadium', 'New York'),
             (2, 'Arena', 'Los Angeles'),
             (3, 'Convention Center', 'Chicago')
      ON CONFLICT (id) DO NOTHING
    `;

    await sql`
      INSERT INTO global_users (id, name, email)
      VALUES (1, 'Alice', 'alice@example.com'),
             (2, 'Bob', 'bob@example.com')
      ON CONFLICT (id) DO NOTHING
    `;

    // Register entities with DZQL
    await sql`
      SELECT dzql.register_entity(
        'global_events',
        'name',
        array['name'],
        '{}'::jsonb,
        false
      )
    `;

    await sql`
      SELECT dzql.register_entity(
        'global_venues',
        'name',
        array['name'],
        '{}'::jsonb,
        false
      )
    `;

    await sql`
      SELECT dzql.register_entity(
        'global_users',
        'name',
        array['name'],
        '{}'::jsonb,
        false
      )
    `;

    // Compile and deploy subscribable with NULL root
    const subscribable = {
      name: "global_dashboard",
      permissionPaths: { subscribe: [] }, // public access
      paramSchema: {},                     // no params
      rootEntity: null,                    // NULL root - pure collection mode
      relations: {
        events: {
          entity: "global_events",
          filter: "TRUE"
        },
        venues: {
          entity: "global_venues",
          filter: "TRUE"
        },
        users: {
          entity: "global_users",
          filter: "TRUE"
        }
      }
    };

    const compiler = new DZQLCompiler();
    const result = compiler.compileSubscribable(subscribable);

    // Deploy the compiled functions
    await sql.unsafe(result.sql);
  });

  afterAll(async () => {
    // Cleanup
    await sql`DROP FUNCTION IF EXISTS global_dashboard_can_subscribe(int, jsonb)`;
    await sql`DROP FUNCTION IF EXISTS get_global_dashboard(jsonb, int)`;
    await sql`DROP FUNCTION IF EXISTS global_dashboard_affected_documents(text, text, jsonb)`;
    await sql`DROP TABLE IF EXISTS global_events`;
    await sql`DROP TABLE IF EXISTS global_venues`;
    await sql`DROP TABLE IF EXISTS global_users`;
    await sql`DELETE FROM dzql.entities WHERE table_name IN ('global_events', 'global_venues', 'global_users')`;
  });

  test("query returns all collections without root entity", async () => {
    const result = await sql`
      SELECT get_global_dashboard(
        '{}'::jsonb,
        ${testUserId}
      ) as doc
    `;

    const doc = result[0].doc;
    expect(doc.data).toBeDefined();

    // Should have all three collections
    expect(doc.data.events).toBeDefined();
    expect(doc.data.venues).toBeDefined();
    expect(doc.data.users).toBeDefined();

    // All events should be present
    expect(doc.data.events).toHaveLength(3);
    expect(doc.data.events.map(e => e.name)).toContain('Concert A');
    expect(doc.data.events.map(e => e.name)).toContain('Concert B');
    expect(doc.data.events.map(e => e.name)).toContain('Conference');

    // All venues should be present
    expect(doc.data.venues).toHaveLength(3);

    // All users should be present
    expect(doc.data.users).toHaveLength(2);
  });

  test("schema contains path mapping for all collections", async () => {
    const result = await sql`
      SELECT get_global_dashboard(
        '{}'::jsonb,
        ${testUserId}
      ) as doc
    `;

    const doc = result[0].doc;
    expect(doc.schema).toBeDefined();
    expect(doc.schema.paths).toBeDefined();

    // Each collection should have a path mapping
    expect(doc.schema.paths.global_events).toBe('events');
    expect(doc.schema.paths.global_venues).toBe('venues');
    expect(doc.schema.paths.global_users).toBe('users');

    // No root path since rootEntity is null
    expect(doc.schema.root).toBeFalsy();
  });

  test("_affected_documents returns empty params for all collections (notify all)", async () => {
    // When any global_events record changes, ALL subscribers should be notified
    const eventData = { id: 999, name: "New Event", venue_name: "Test" };

    const eventResult = await sql`
      SELECT global_dashboard_affected_documents(
        'global_events',
        'INSERT',
        ${sql.json(eventData)}
      ) as affected
    `;

    expect(eventResult[0].affected).toHaveLength(1);
    expect(eventResult[0].affected[0]).toEqual({});

    // Same for venues
    const venueData = { id: 999, name: "New Venue", city: "Test City" };

    const venueResult = await sql`
      SELECT global_dashboard_affected_documents(
        'global_venues',
        'INSERT',
        ${sql.json(venueData)}
      ) as affected
    `;

    expect(venueResult[0].affected).toHaveLength(1);
    expect(venueResult[0].affected[0]).toEqual({});

    // Same for users
    const userData = { id: 999, name: "New User", email: "test@example.com" };

    const userResult = await sql`
      SELECT global_dashboard_affected_documents(
        'global_users',
        'INSERT',
        ${sql.json(userData)}
      ) as affected
    `;

    expect(userResult[0].affected).toHaveLength(1);
    expect(userResult[0].affected[0]).toEqual({});
  });

  test("can_subscribe returns true for public dashboard", async () => {
    const result = await sql`
      SELECT global_dashboard_can_subscribe(${testUserId}, '{}'::jsonb) as allowed
    `;

    expect(result[0].allowed).toBe(true);
  });
});

describe("Null-Root Dashboard via register_subscribable SQL", () => {
  const testUserId = 1;

  beforeAll(async () => {
    // Create test tables
    await sql`
      CREATE TABLE IF NOT EXISTS sql_events (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS sql_venues (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL
      )
    `;

    // Insert test data
    await sql`
      INSERT INTO sql_events (id, name) VALUES (1, 'Event 1'), (2, 'Event 2')
      ON CONFLICT (id) DO NOTHING
    `;

    await sql`
      INSERT INTO sql_venues (id, name) VALUES (1, 'Venue 1'), (2, 'Venue 2')
      ON CONFLICT (id) DO NOTHING
    `;

    // Register entities
    await sql`SELECT dzql.register_entity('sql_events', 'name', array['name'], '{}'::jsonb, false)`;
    await sql`SELECT dzql.register_entity('sql_venues', 'name', array['name'], '{}'::jsonb, false)`;

    // Register subscribable with NULL root via SQL (as it would be in entities.sql)
    await sql`
      SELECT dzql.register_subscribable(
        'sql_dashboard',
        '{}'::jsonb,
        '{}'::jsonb,
        NULL,
        '{"events": {"entity": "sql_events", "filter": "TRUE"}, "venues": {"entity": "sql_venues", "filter": "TRUE"}}'::jsonb
      )
    `;

    // Compile using the CLI pattern (fetch from dzql.subscribables and compile)
    const subscribables = await sql`SELECT * FROM dzql.subscribables WHERE name = 'sql_dashboard'`;
    const sub = subscribables[0];

    const compiler = new DZQLCompiler();
    const result = compiler.compileSubscribable({
      name: sub.name,
      permissionPaths: sub.permission_paths,
      paramSchema: sub.param_schema,
      rootEntity: sub.root_entity,  // This will be null from the DB
      relations: sub.relations
    });

    await sql.unsafe(result.sql);
  });

  afterAll(async () => {
    await sql`DROP FUNCTION IF EXISTS sql_dashboard_can_subscribe(int, jsonb)`;
    await sql`DROP FUNCTION IF EXISTS get_sql_dashboard(jsonb, int)`;
    await sql`DROP FUNCTION IF EXISTS sql_dashboard_affected_documents(text, text, jsonb)`;
    await sql`DELETE FROM dzql.subscribables WHERE name = 'sql_dashboard'`;
    await sql`DROP TABLE IF EXISTS sql_events`;
    await sql`DROP TABLE IF EXISTS sql_venues`;
    await sql`DELETE FROM dzql.entities WHERE table_name IN ('sql_events', 'sql_venues')`;
  });

  test("subscribable registered via SQL with NULL root works correctly", async () => {
    const result = await sql`
      SELECT get_sql_dashboard('{}'::jsonb, ${testUserId}) as doc
    `;

    const doc = result[0].doc;
    expect(doc.data).toBeDefined();

    // Should have both collections
    expect(doc.data.events).toHaveLength(2);
    expect(doc.data.venues).toHaveLength(2);
  });

  test("_affected_documents returns empty params for SQL-registered dashboard", async () => {
    const result = await sql`
      SELECT sql_dashboard_affected_documents(
        'sql_events',
        'INSERT',
        '{"id": 999, "name": "Test"}'::jsonb
      ) as affected
    `;

    expect(result[0].affected).toHaveLength(1);
    expect(result[0].affected[0]).toEqual({});
  });
});
