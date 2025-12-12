/**
 * Integration test for Dashboard Collection feature
 *
 * Tests the filter: "TRUE" behavior for relations that should:
 * 1. Fetch ALL rows (no FK filtering to root)
 * 2. Notify ALL subscribers when any record changes (return '{}'::jsonb)
 *
 * Use case: A venue subscription that includes ALL events system-wide,
 * not just events for that specific venue.
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

describe("Dashboard Collection (filter: TRUE)", () => {
  const testVenueId = 300;
  const testUserId = 1;

  beforeAll(async () => {
    // Create test tables
    await sql`
      CREATE TABLE IF NOT EXISTS dash_venues (
        id INT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_id INT NOT NULL
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS dash_rooms (
        id INT PRIMARY KEY,
        name TEXT NOT NULL,
        venue_id INT NOT NULL REFERENCES dash_venues(id)
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS dash_events (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        venue_id INT REFERENCES dash_venues(id)
      )
    `;

    // Insert test data
    await sql`
      INSERT INTO dash_venues (id, name, owner_id)
      VALUES (${testVenueId}, 'Dashboard Venue', ${testUserId})
      ON CONFLICT (id) DO NOTHING
    `;

    await sql`
      INSERT INTO dash_venues (id, name, owner_id)
      VALUES (${testVenueId + 1}, 'Other Venue', ${testUserId})
      ON CONFLICT (id) DO NOTHING
    `;

    await sql`
      INSERT INTO dash_rooms (id, name, venue_id)
      VALUES (301, 'Room A', ${testVenueId}),
             (302, 'Room B', ${testVenueId})
      ON CONFLICT (id) DO NOTHING
    `;

    // Events for different venues
    await sql`
      INSERT INTO dash_events (id, name, venue_id)
      VALUES (401, 'Event at Venue 300', ${testVenueId}),
             (402, 'Event at Venue 301', ${testVenueId + 1}),
             (403, 'Event at Venue 300 again', ${testVenueId})
      ON CONFLICT (id) DO NOTHING
    `;

    // Register entities with DZQL
    await sql`
      SELECT dzql.register_entity(
        'dash_venues',
        'name',
        array['name'],
        '{}'::jsonb,
        false
      )
    `;

    await sql`
      SELECT dzql.register_entity(
        'dash_rooms',
        'name',
        array['name'],
        '{"venue": "dash_venues"}'::jsonb,
        false
      )
    `;

    await sql`
      SELECT dzql.register_entity(
        'dash_events',
        'name',
        array['name'],
        '{"venue": "dash_venues"}'::jsonb,
        false
      )
    `;

    // Compile and deploy subscribable with dashboard collection
    const subscribable = {
      name: "venue_dashboard",
      permissionPaths: { subscribe: ["@owner_id"] },
      paramSchema: { venue_id: "int" },
      rootEntity: "dash_venues",
      relations: {
        // Normal relation: filtered by venue FK
        rooms: {
          entity: "dash_rooms",
          foreignKey: "venue_id"
        },
        // Dashboard collection: ALL events, not filtered by venue
        all_events: {
          entity: "dash_events",
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
    await sql`DROP FUNCTION IF EXISTS venue_dashboard_can_subscribe(int, jsonb)`;
    await sql`DROP FUNCTION IF EXISTS get_venue_dashboard(jsonb, int)`;
    await sql`DROP FUNCTION IF EXISTS venue_dashboard_affected_documents(text, text, jsonb)`;
    await sql`DROP TABLE IF EXISTS dash_events`;
    await sql`DROP TABLE IF EXISTS dash_rooms`;
    await sql`DROP TABLE IF EXISTS dash_venues`;
    await sql`DELETE FROM dzql.entities WHERE table_name IN ('dash_venues', 'dash_rooms', 'dash_events')`;
  });

  test("query returns ALL events regardless of venue (filter: TRUE)", async () => {
    // Get venue 300's dashboard
    const result = await sql`
      SELECT get_venue_dashboard(
        ${sql.json({ venue_id: testVenueId })},
        ${testUserId}
      ) as doc
    `;

    const doc = result[0].doc;
    expect(doc.data).toBeDefined();

    // Root venue should be venue 300
    expect(doc.data.dash_venues.id).toBe(testVenueId);

    // Rooms should be filtered to venue 300 only
    expect(doc.data.rooms).toHaveLength(2);
    doc.data.rooms.forEach((room) => {
      expect(room.venue_id).toBe(testVenueId);
    });

    // all_events should include ALL events (not filtered by venue)
    expect(doc.data.all_events).toHaveLength(3);
    // Verify we have events from different venues
    const venueIds = doc.data.all_events.map((e) => e.venue_id);
    expect(venueIds).toContain(testVenueId);
    expect(venueIds).toContain(testVenueId + 1);
  });

  test("_affected_documents returns empty params for dashboard collection entity", async () => {
    // When any dash_events record changes, ALL subscribers should be notified
    const eventData = {
      id: 999,
      name: "New Event",
      venue_id: testVenueId + 1 // Different venue
    };

    const result = await sql`
      SELECT venue_dashboard_affected_documents(
        'dash_events',
        'INSERT',
        ${sql.json(eventData)}
      ) as affected
    `;

    // Should return empty params object to notify ALL subscribers
    expect(result[0].affected).toHaveLength(1);
    expect(result[0].affected[0]).toEqual({});
  });

  test("_affected_documents returns specific params for normal relation", async () => {
    // When a room changes, only the specific venue subscriber should be notified
    const roomData = {
      id: 999,
      name: "New Room",
      venue_id: testVenueId
    };

    const result = await sql`
      SELECT venue_dashboard_affected_documents(
        'dash_rooms',
        'INSERT',
        ${sql.json(roomData)}
      ) as affected
    `;

    // Should return the venue_id to target specific subscriber
    expect(result[0].affected).toHaveLength(1);
    expect(result[0].affected[0].venue_id).toBe(testVenueId);
  });

  test("_affected_documents returns specific params for root entity", async () => {
    // When the root venue changes, its subscriber should be notified
    const venueData = {
      id: testVenueId,
      name: "Updated Venue",
      owner_id: testUserId
    };

    const result = await sql`
      SELECT venue_dashboard_affected_documents(
        'dash_venues',
        'UPDATE',
        ${sql.json(venueData)}
      ) as affected
    `;

    // Should return the venue_id from the root entity's id
    expect(result[0].affected).toHaveLength(1);
    expect(result[0].affected[0].venue_id).toBe(testVenueId);
  });
});
