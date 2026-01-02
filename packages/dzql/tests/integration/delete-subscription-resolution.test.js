/**
 * Integration test for DELETE subscription resolution
 *
 * This tests the complete flow:
 * 1. Create a subscribable with relations
 * 2. Deploy compiled functions
 * 3. DELETE a related record via generic_delete
 * 4. Verify the event contains the deleted record's data
 * 5. Verify _affected_documents returns the correct subscription params
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

describe("DELETE Subscription Resolution", () => {
  const testVenueId = 100;
  const testRoomId = 200;
  const testUserId = 1;

  beforeAll(async () => {
    // Create test tables
    await sql`
      CREATE TABLE IF NOT EXISTS test_venues (
        id INT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_id INT NOT NULL
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS test_rooms (
        id INT PRIMARY KEY,
        name TEXT NOT NULL,
        venue_id INT NOT NULL REFERENCES test_venues(id)
      )
    `;

    // Insert test data
    await sql`
      INSERT INTO test_venues (id, name, owner_id)
      VALUES (${testVenueId}, 'Test Venue', ${testUserId})
      ON CONFLICT (id) DO NOTHING
    `;

    await sql`
      INSERT INTO test_rooms (id, name, venue_id)
      VALUES (${testRoomId}, 'Test Room', ${testVenueId})
      ON CONFLICT (id) DO NOTHING
    `;

    // Register entities with DZQL
    await sql`
      SELECT dzql.register_entity(
        'test_venues',
        'name',
        array['name'],
        '{}'::jsonb,
        false
      )
    `;

    await sql`
      SELECT dzql.register_entity(
        'test_rooms',
        'name',
        array['name'],
        '{"venue": "test_venues"}'::jsonb,
        false
      )
    `;

    // Compile and deploy subscribable
    const subscribable = {
      name: "test_venue_detail",
      permissionPaths: { subscribe: ["@owner_id"] },
      paramSchema: { venue_id: "int" },
      rootEntity: "test_venues",
      relations: {
        rooms: {
          entity: "test_rooms",
          foreignKey: "venue_id"
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
    await sql`DROP FUNCTION IF EXISTS test_venue_detail_can_subscribe(int, jsonb)`;
    await sql`DROP FUNCTION IF EXISTS get_test_venue_detail(jsonb, int)`;
    await sql`DROP FUNCTION IF EXISTS test_venue_detail_affected_documents(text, text, jsonb)`;
    await sql`DROP TABLE IF EXISTS test_rooms`;
    await sql`DROP TABLE IF EXISTS test_venues`;
    await sql`DELETE FROM dzql.entities WHERE table_name IN ('test_venues', 'test_rooms')`;
  });

  test("_affected_documents receives correct data for DELETE", async () => {
    // First verify the function signature is correct (3 params, not 4)
    const funcInfo = await sql`
      SELECT pronargs, proargtypes::regtype[] as argtypes
      FROM pg_proc
      WHERE proname = 'test_venue_detail_affected_documents'
    `;

    expect(funcInfo.length).toBe(1);
    expect(funcInfo[0].pronargs).toBe(3); // Should be 3 params: table, op, data
  });

  test("_affected_documents returns correct venue_id when room is deleted", async () => {
    // Simulate a DELETE event - pass the room data including venue_id
    const roomData = {
      id: testRoomId,
      name: "Test Room",
      venue_id: testVenueId
    };

    const result = await sql`
      SELECT test_venue_detail_affected_documents(
        'test_rooms',
        'DELETE',
        ${sql.json(roomData)}
      ) as affected
    `;

    expect(result[0].affected).toHaveLength(1);
    expect(result[0].affected[0].venue_id).toBe(testVenueId);
  });

  test("generic_delete creates event with full record data", async () => {
    // Clear events
    await sql`DELETE FROM dzql.events WHERE table_name = 'test_rooms'`;

    // Insert a room to delete
    const roomToDelete = 201;
    await sql`
      INSERT INTO test_rooms (id, name, venue_id)
      VALUES (${roomToDelete}, 'Room To Delete', ${testVenueId})
      ON CONFLICT (id) DO UPDATE SET name = 'Room To Delete'
    `;

    // Delete via generic_delete
    await sql`
      SELECT dzql.generic_delete('test_rooms', ${sql.json({ id: roomToDelete })}, ${testUserId})
    `;

    // Get the delete event
    const events = await sql`
      SELECT * FROM dzql.events
      WHERE table_name = 'test_rooms'
      AND op = 'delete'
      ORDER BY event_id DESC
      LIMIT 1
    `;

    expect(events.length).toBe(1);
    expect(events[0].op).toBe("delete");

    // The key assertion: DELETE event must include the full record data
    expect(events[0].data).not.toBeNull();
    expect(events[0].data.id).toBe(roomToDelete);
    expect(events[0].data.venue_id).toBe(testVenueId);
  });

  test("full DELETE flow: delete room and resolve affected venue subscription", async () => {
    // Clear events
    await sql`DELETE FROM dzql.events WHERE table_name = 'test_rooms'`;

    // Insert a room to delete
    const roomToDelete = 202;
    await sql`
      INSERT INTO test_rooms (id, name, venue_id)
      VALUES (${roomToDelete}, 'Another Room To Delete', ${testVenueId})
      ON CONFLICT (id) DO UPDATE SET name = 'Another Room To Delete'
    `;

    // Delete via generic_delete
    await sql`
      SELECT dzql.generic_delete('test_rooms', ${sql.json({ id: roomToDelete })}, ${testUserId})
    `;

    // Get the delete event
    const events = await sql`
      SELECT * FROM dzql.events
      WHERE table_name = 'test_rooms'
      AND op = 'delete'
      ORDER BY event_id DESC
      LIMIT 1
    `;

    expect(events.length).toBe(1);
    const event = events[0];

    // Now use the event data to call _affected_documents - this is what the server does
    const affected = await sql`
      SELECT test_venue_detail_affected_documents(
        ${event.table_name},
        ${event.op},
        ${sql.json(event.data)}
      ) as affected
    `;

    // This should return the venue_id that has a subscription affected
    expect(affected[0].affected).toHaveLength(1);
    expect(affected[0].affected[0].venue_id).toBe(testVenueId);
  });
});
