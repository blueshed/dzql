import { test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { sql, db } from "dzql";

beforeAll(async () => {
  // Ensure we have clean test data
  await sql`DELETE FROM allocations WHERE id > 100`;
  await sql`DELETE FROM contractor_rights WHERE package_id IN (SELECT id FROM packages WHERE name LIKE '%Test%')`;
  await sql`DELETE FROM packages WHERE name LIKE '%Test%'`;
  await sql`DELETE FROM acts_for WHERE user_id > 100`;
  await sql`DELETE FROM users WHERE id > 100`;

  // Create test users
  await sql`
    INSERT INTO users (id, email, name, password_hash) VALUES
    (101, 'venue.owner@test.com', 'Venue Owner', 'hash'),
    (102, 'event.manager@test.com', 'Event Manager', 'hash'),
    (103, 'sponsor@test.com', 'Sponsor User', 'hash'),
    (104, 'contractor@test.com', 'Contractor User', 'hash')
    ON CONFLICT DO NOTHING
  `;

  // Create test organizations if they don't exist
  await sql`
    INSERT INTO organisations (id, name, description) VALUES
    (101, 'Test Venue Org', 'Test venue owner'),
    (102, 'Test Event Org', 'Test event organizer'),
    (103, 'Test Sponsor Org', 'Test sponsor'),
    (104, 'Test Contractor Org', 'Test contractor')
    ON CONFLICT DO NOTHING
  `;

  // Set up acts_for relationships
  await sql`
    INSERT INTO acts_for (user_id, org_id, valid_from) VALUES
    (101, 101, CURRENT_DATE),
    (102, 102, CURRENT_DATE),
    (103, 103, CURRENT_DATE),
    (104, 104, CURRENT_DATE)
    ON CONFLICT DO NOTHING
  `;

  // Create test venue and site
  await sql`
    INSERT INTO venues (id, org_id, name, address, description) VALUES
    (101, 101, 'Test Stadium', '123 Test St', 'Test venue for notifications')
    ON CONFLICT DO NOTHING
  `;

  await sql`
    INSERT INTO sites (id, venue_id, name, description) VALUES
    (101, 101, 'Test Site A', 'Main entrance test site')
    ON CONFLICT DO NOTHING
  `;
});

afterAll(async () => {
  // Clean up test data
  await sql`DELETE FROM allocations WHERE id > 100`;
  await sql`DELETE FROM contractor_rights WHERE package_id > 100`;
  await sql`DELETE FROM packages WHERE id > 100`;
  await sql`DELETE FROM sites WHERE id > 100`;
  await sql`DELETE FROM venues WHERE id > 100`;
  await sql`DELETE FROM acts_for WHERE user_id > 100`;
  await sql`DELETE FROM organisations WHERE id > 100`;
  await sql`DELETE FROM users WHERE id > 100`;
});

test("Notification paths - direct user reference", async () => {
  // Test direct user field reference
  const result = await sql`
    SELECT dzql.resolve_notification_path(
      'venues',
      '{"id": 101, "created_by_user_id": 101, "name": "Test Stadium"}'::jsonb,
      '@created_by_user_id'
    ) as user_ids
  `;

  expect(result[0].user_ids).toEqual([101]);
});

test("Notification paths - org to users via acts_for", async () => {
  // Test explicit path: @org_id->acts_for[org_id=$]{active}.user_id
  const result = await sql`
    SELECT dzql.resolve_notification_path(
      'venues',
      '{"id": 101, "org_id": 101, "name": "Test Stadium"}'::jsonb,
      '@org_id->acts_for[org_id=$]{active}.user_id'
    ) as user_ids
  `;

  // Should resolve org_id 101 -> acts_for -> user_id 101
  expect(result[0].user_ids).toContain(101);
});

test("Notification paths - foreign key traversal with continuation", async () => {
  // Test traversal: site.venue.org_id -> acts_for.user_id
  const result = await sql`
    SELECT dzql.resolve_notification_path(
      'sites',
      '{"id": 101, "venue_id": 101, "name": "Test Site"}'::jsonb,
      'venue_id.org_id->acts_for[org_id=$]{active}.user_id'
    ) as user_ids
  `;

  // Should resolve venue_id -> venues.org_id -> acts_for -> user_ids
  expect(result[0].user_ids).toContain(101); // venue owner user
});

test("Full notification resolution for venue", async () => {
  // Test complete notification path resolution for a venue
  const result = await sql`
    SELECT dzql.resolve_notification_paths(
      'venues',
      '{"id": 101, "org_id": 101, "name": "Test Stadium"}'::jsonb
    ) as notify_users
  `;

  // Should include user 101 (who acts for org 101)
  expect(result[0].notify_users).toContain(101);
});

test("Package notifications - multiple paths", async () => {
  // Create a test package
  await sql`
    INSERT INTO packages (id, owner_org_id, sponsor_org_id, name, price, status) VALUES
    (101, 102, 103, 'Test Package', 10000, 'sold')
    ON CONFLICT DO NOTHING
  `;

  const result = await sql`
    SELECT dzql.resolve_notification_paths(
      'packages',
      '{"id": 101, "owner_org_id": 102, "sponsor_org_id": 103, "name": "Test Package"}'::jsonb
    ) as notify_users
  `;

  // Should include users from both owner and sponsor orgs
  expect(result[0].notify_users).toContain(102); // event.manager@test.com (owner)
  expect(result[0].notify_users).toContain(103); // sponsor@test.com (sponsor)
});

test("Allocation notifications - complex paths", async () => {
  // Create allocation
  await sql`
    INSERT INTO allocations (id, package_id, site_id, from_date, to_date) VALUES
    (101, 101, 101, '2024-07-01', '2024-08-31')
    ON CONFLICT DO NOTHING
  `;

  const result = await sql`
    SELECT dzql.resolve_notification_paths(
      'allocations',
      '{"id": 101, "package_id": 101, "site_id": 101}'::jsonb
    ) as notify_users
  `;

  // Should include users from venue owner, package owner, and sponsor
  expect(result[0].notify_users).toContain(101); // venue owner (via site.venue.org_id)
  expect(result[0].notify_users).toContain(102); // package owner
  expect(result[0].notify_users).toContain(103); // sponsor
});

test("Contractor rights - temporal filtering with explicit user resolution", async () => {
  // Add contractor rights
  await sql`
    INSERT INTO contractor_rights (contractor_org_id, sponsor_org_id, package_id, valid_from, valid_to) VALUES
    (104, 103, 101, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days')
    ON CONFLICT DO NOTHING
  `;

  // Test conditional path with temporal filtering and explicit user resolution
  const result = await sql`
    SELECT dzql.resolve_notification_path(
      'allocations',
      '{"id": 101, "package_id": 101, "site_id": 101}'::jsonb,
      'contractor_rights[package_id=@package_id]{active}.contractor_org_id->acts_for[org_id=$]{active}.user_id'
    ) as user_ids
  `;

  // Should find the active contractor user
  expect(result[0].user_ids).toContain(104);

  // Now test with expired contractor rights
  await sql`
    UPDATE contractor_rights
    SET valid_to = CURRENT_DATE - INTERVAL '1 day'
    WHERE package_id = 101
  `;

  const expiredResult = await sql`
    SELECT dzql.resolve_notification_path(
      'allocations',
      '{"id": 101, "package_id": 101, "site_id": 101}'::jsonb,
      'contractor_rights[package_id=@package_id]{active}.contractor_org_id->acts_for[org_id=$]{active}.user_id'
    ) as user_ids
  `;

  // Should not find expired contractor user
  expect(expiredResult[0].user_ids).not.toContain(104);
});

test("Event creation with notification paths", async () => {
  // Use the API to update a venue - this will create an event
  const updated = await db.api.save.venues({
    id: 101,
    description: 'Updated via API test'
  }, 101);

  // Check that event was created with correct notify_users
  const events = await sql`
    SELECT * FROM dzql.events
    WHERE table_name = 'venues'
    AND pk->>'id' = '101'
    ORDER BY event_id DESC
    LIMIT 1
  `;

  expect(events.length).toBe(1);
  expect(events[0].notify_users).toContain(101); // venue owner should be notified
  expect(events[0].user_id).toBe(101); // correct user_id
});

test("Multiple organization notification paths", async () => {
  // Test that all related organizations get notified
  // Use DZQL API to update allocation - this will create an event
  const updated = await db.api.save.allocations({
    id: 101,
    from_date: '2024-08-01'
  }, 102);

  const events = await sql`
    SELECT * FROM dzql.events
    WHERE table_name = 'allocations'
    AND pk->>'id' = '101'
    ORDER BY event_id DESC
    LIMIT 1
  `;

  expect(events.length).toBe(1);
  // Should notify venue owner, package owner, and sponsor
  expect(events[0].notify_users).toContain(101); // venue owner
  expect(events[0].notify_users).toContain(102); // package owner
  expect(events[0].notify_users).toContain(103); // sponsor
});
