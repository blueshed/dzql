/**
 * Interpreted mode CRUD tests
 * Tests the core CRUD operations using interpreted entities (register_entity + generated functions)
 * Migrated from packages/venues/tests/
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { setupTests, createTestUser, testEmail, testName } from '../setup/test-helpers.js';

const { sql } = setupTests();

describe('Interpreted Mode - CRUD Operations', () => {
  let testUserId;

  beforeAll(async () => {
    // Create test schema for venues-style entities
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id serial PRIMARY KEY,
        name text NOT NULL,
        email text UNIQUE NOT NULL,
        password_hash text NOT NULL,
        created_at timestamptz DEFAULT now()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS organisations (
        id serial PRIMARY KEY,
        name text NOT NULL,
        created_at timestamptz DEFAULT now()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS venues (
        id serial PRIMARY KEY,
        name text NOT NULL,
        address text,
        description text,
        org_id int REFERENCES organisations(id),
        created_at timestamptz DEFAULT now(),
        deleted_at timestamptz
      )
    `;

    // Register venues entity
    await sql`
      SELECT dzql.register_entity(
        'venues',
        'name',
        array['name', 'address', 'description'],
        '{"org": "organisations"}',
        true,
        '{}',
        '{}',
        jsonb_build_object(
          'view', array[]::text[],
          'create', array[]::text[],
          'update', array[]::text[],
          'delete', array[]::text[]
        )
      )
    `;

    // Create test user
    const user = await createTestUser(sql);
    testUserId = user.user_id;
  });

  test('get_venues retrieves a venue by ID', async () => {
    // First create a venue directly
    const insertResult = await sql`
      INSERT INTO venues (name, address, description)
      VALUES ('Test Venue', '123 Test St', 'A test venue')
      RETURNING id
    `;
    const venueId = insertResult[0].id;

    // Use generated get function - note: dzql.get_venues(p_args jsonb, p_user_id integer)
    const result = await sql`
      SELECT dzql.get_venues(${sql.json({id: venueId})}, ${testUserId}) as venue
    `;

    expect(result[0].venue).toBeDefined();
    expect(result[0].venue.id).toBe(venueId);
    expect(result[0].venue.name).toBe('Test Venue');
    expect(result[0].venue.address).toBe('123 Test St');
  });

  test('save_venues creates a new venue', async () => {
    const venueData = {
      name: testName('Venue'),
      address: '456 New St',
      description: 'A newly created venue'
    };

    const result = await sql`
      SELECT dzql.save_venues(
        ${sql.json(venueData)},
        ${testUserId}
      ) as venue
    `;

    expect(result[0].venue).toBeDefined();
    expect(result[0].venue.id).toBeDefined();
    expect(result[0].venue.name).toBe(venueData.name);
    expect(result[0].venue.address).toBe(venueData.address);
  });

  test('save_venues updates an existing venue', async () => {
    // Create venue
    const insertResult = await sql`
      INSERT INTO venues (name, address)
      VALUES ('Original Name', 'Original Address')
      RETURNING id
    `;
    const venueId = insertResult[0].id;

    // Update it
    const updateData = {
      id: venueId,
      name: 'Updated Name',
      address: 'Updated Address'
    };

    const result = await sql`
      SELECT dzql.save_venues(
        ${sql.json(updateData)},
        ${testUserId}
      ) as venue
    `;

    expect(result[0].venue.id).toBe(venueId);
    expect(result[0].venue.name).toBe('Updated Name');
    expect(result[0].venue.address).toBe('Updated Address');
  });

  test('search_venues returns paginated results', async () => {
    // Create several venues
    for (let i = 0; i < 5; i++) {
      await sql`
        INSERT INTO venues (name, address)
        VALUES (${`Search Venue ${i}`}, ${`Address ${i}`})
      `;
    }

    // Search with pagination
    const result = await sql`
      SELECT dzql.search_venues(
        ${sql.json({limit: 3, offset: 0})},
        ${testUserId}
      ) as result
    `;

    expect(result[0].result).toBeDefined();
    expect(result[0].result.data).toBeArray();
    expect(result[0].result.data.length).toBeLessThanOrEqual(3);
    expect(result[0].result.total).toBeGreaterThanOrEqual(5);
  });

  test('search_venues supports filter parameter', async () => {
    const uniqueName = testName('Searchable');
    await sql`
      INSERT INTO venues (name, address)
      VALUES (${uniqueName}, 'Findable Address')
    `;

    const result = await sql`
      SELECT dzql.search_venues(
        ${sql.json({filters: {_search: uniqueName}})},
        ${testUserId}
      ) as result
    `;

    expect(result[0].result.data).toBeArray();
    expect(result[0].result.data.length).toBeGreaterThan(0);
    expect(result[0].result.data[0].name).toContain(uniqueName);
  });

  test('lookup_venues returns value/label pairs', async () => {
    const venueName = testName('Lookup');
    await sql`
      INSERT INTO venues (name, address)
      VALUES (${venueName}, 'Lookup Address')
    `;

    const result = await sql`
      SELECT dzql.lookup_venues(
        ${sql.json({filter: venueName})},
        ${testUserId}
      ) as results
    `;

    expect(result[0].results).toBeArray();
    expect(result[0].results.length).toBeGreaterThan(0);
    expect(result[0].results[0]).toHaveProperty('value');
    expect(result[0].results[0]).toHaveProperty('label');
  });

  test('delete_venues soft deletes a venue', async () => {
    // Create venue
    const insertResult = await sql`
      INSERT INTO venues (name, address)
      VALUES ('To Delete', 'Delete Address')
      RETURNING id
    `;
    const venueId = insertResult[0].id;

    // Delete it
    const result = await sql`
      SELECT dzql.delete_venues(${sql.json({id: venueId})}, ${testUserId}) as venue
    `;

    expect(result[0].venue).toBeDefined();
    expect(result[0].venue.id).toBe(venueId);

    // Verify it was soft deleted by checking the database directly
    const checkResult = await sql`
      SELECT deleted_at FROM venues WHERE id = ${venueId}
    `;
    expect(checkResult[0].deleted_at).not.toBeNull();

    // Verify it's not in regular search results
    const searchResult = await sql`
      SELECT * FROM venues WHERE id = ${venueId} AND deleted_at IS NULL
    `;
    expect(searchResult).toHaveLength(0);
  });

  test('FK expansion includes related entity', async () => {
    // Create organisation
    const orgResult = await sql`
      INSERT INTO organisations (name)
      VALUES ('Test Organisation')
      RETURNING id
    `;
    const orgId = orgResult[0].id;

    // Create venue with org
    const venueResult = await sql`
      INSERT INTO venues (name, address, org_id)
      VALUES ('Venue with Org', '123 Org St', ${orgId})
      RETURNING id
    `;
    const venueId = venueResult[0].id;

    // Get venue (should expand org)
    const result = await sql`
      SELECT dzql.get_venues(${sql.json({id: venueId})}, ${testUserId}) as venue
    `;

    expect(result[0].venue.org).toBeDefined();
    expect(result[0].venue.org.id).toBe(orgId);
    expect(result[0].venue.org.name).toBe('Test Organisation');
  });
});
