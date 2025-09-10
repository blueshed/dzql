import { test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { sql, db } from "zeroql";

let testUserId;

beforeAll(async () => {
  // Create test user for graph rules tests
  const userResult = await sql`
    SELECT register_user('graphrules-test@example.com', 'password123') as user_data
  `;
  testUserId = userResult[0].user_data.user_id;

  // Register organisations entity with graph rules
  // This should ideally be in the database init, but for testing we do it here
  await sql`
    SELECT zeroql.register_entity(
      p_table_name := 'organisations',
      p_label_field := 'name',
      p_searchable_fields := array['name', 'description'],
      p_fk_includes := '{}',
      p_soft_delete := false,
      p_temporal_fields := '{}',
      p_notification_paths := '{}',
      p_permission_paths := '{}',
      p_graph_rules := jsonb_build_object(
        'on_create', jsonb_build_object(
          'establish_ownership', jsonb_build_object(
            'description', 'Creator becomes member of organisation',
            'actions', jsonb_build_array(
              jsonb_build_object(
                'type', 'create',
                'entity', 'acts_for',
                'data', jsonb_build_object(
                  'user_id', '@user_id',
                  'org_id', '@id',
                  'valid_from', '@now'
                )
              )
            )
          )
        ),
        'on_delete', jsonb_build_object(
          'cascade_relationships', jsonb_build_object(
            'description', 'Delete all related records when organisation is deleted',
            'actions', jsonb_build_array(
              jsonb_build_object(
                'type', 'delete',
                'entity', 'acts_for',
                'match', jsonb_build_object(
                  'org_id', '@id'
                )
              ),
              jsonb_build_object(
                'type', 'delete',
                'entity', 'venues',
                'match', jsonb_build_object(
                  'org_id', '@id'
                )
              )
            )
          )
        )
      )
    );
  `;

  // Venues entity is already properly registered in domain file
  // No need to re-register it here

  // Register acts_for entity (no graph rules needed)
  await sql`
    SELECT zeroql.register_entity(
      p_table_name := 'acts_for',
      p_label_field := 'user_id',
      p_searchable_fields := array[]::text[],
      p_fk_includes := '{"user": "users", "org": "organisations"}',
      p_soft_delete := false,
      p_temporal_fields := '{"valid_from": "valid_from", "valid_to": "valid_to"}',
      p_notification_paths := '{}',
      p_permission_paths := '{}',
      p_graph_rules := '{}'
    );
  `;
});

// Clean up test data before each test
beforeEach(async () => {
  await sql`DELETE FROM acts_for WHERE user_id = ${testUserId}`;
  await sql`DELETE FROM sites WHERE venue_id IN (SELECT id FROM venues WHERE org_id IN (SELECT id FROM organisations WHERE name LIKE '%Graph Test%'))`;
  await sql`DELETE FROM venues WHERE org_id IN (SELECT id FROM organisations WHERE name LIKE '%Graph Test%')`;
  await sql`DELETE FROM acts_for WHERE org_id IN (SELECT id FROM organisations WHERE name LIKE '%Graph Test%')`;
  await sql`DELETE FROM organisations WHERE name LIKE '%Graph Test%'`;
});

afterAll(async () => {
  // Final cleanup
  await sql`DELETE FROM acts_for WHERE user_id = ${testUserId}`;
  await sql`DELETE FROM sites WHERE venue_id IN (SELECT id FROM venues WHERE org_id IN (SELECT id FROM organisations WHERE name LIKE '%Graph Test%'))`;
  await sql`DELETE FROM venues WHERE org_id IN (SELECT id FROM organisations WHERE name LIKE '%Graph Test%')`;
  await sql`DELETE FROM acts_for WHERE org_id IN (SELECT id FROM organisations WHERE name LIKE '%Graph Test%')`;
  await sql`DELETE FROM organisations WHERE name LIKE '%Graph Test%'`;
  await sql`DELETE FROM users WHERE id = ${testUserId}`;
});

test("Creator becomes owner pattern - organisation creation", async () => {
  // Create organisation - should trigger graph rule
  const org = await db.api.save.organisations({
    name: 'Graph Test Organisation',
    description: 'Testing graph rules'
  }, testUserId);

  expect(org.id).toBeDefined();

  // Check if graph rules were executed
  if (org._graph_rules) {
    expect(org._graph_rules.status).toBe('completed');
    expect(org._graph_rules.trigger).toBe('on_create');
  }

  // Verify acts_for relationship was created by the graph rule
  const actsFor = await sql`
    SELECT * FROM acts_for
    WHERE user_id = ${testUserId}
    AND org_id = ${org.id}
    AND valid_to IS NULL
  `;

  expect(actsFor.length).toBe(1);
  expect(actsFor[0].user_id).toBe(testUserId);
  expect(actsFor[0].org_id).toBe(org.id);
  expect(actsFor[0].valid_from).toBeDefined();
  expect(actsFor[0].valid_to).toBeNull();
});

test("Cascade delete pattern - organisation deletion", async () => {
  // Create an organisation first
  const org = await db.api.save.organisations({
    name: 'Graph Test Cascade Org',
    description: 'Testing cascade delete'
  }, testUserId);

  // Create venues under this organisation
  const venue1 = await db.api.save.venues({
    org_id: org.id,
    name: 'Graph Test Venue 1',
    address: '123 Test St'
  }, testUserId);

  const venue2 = await db.api.save.venues({
    org_id: org.id,
    name: 'Graph Test Venue 2',
    address: '456 Test Ave'
  }, testUserId);

  // Verify venues exist
  let venues = await sql`
    SELECT * FROM venues WHERE org_id = ${org.id}
  `;
  expect(venues.length).toBe(2);

  // Delete the organisation - should trigger cascade delete of venues
  const deleteResult = await db.api.delete.organisations({
    id: org.id
  }, testUserId);

  expect(deleteResult).toBeDefined();
  expect(deleteResult.id).toBe(org.id);

  // Check if graph rules were executed
  if (deleteResult._graph_rules) {
    expect(deleteResult._graph_rules.status).toBe('completed');
    expect(deleteResult._graph_rules.trigger).toBe('on_delete');
  }

  // Verify venues were deleted by the graph rule
  venues = await sql`
    SELECT * FROM venues WHERE org_id = ${org.id}
  `;
  expect(venues.length).toBe(0);

  // Verify organisation was deleted
  const orgs = await sql`
    SELECT * FROM organisations WHERE id = ${org.id}
  `;
  expect(orgs.length).toBe(0);
});

test("No graph rules configured - normal operation", async () => {
  // Create an organization that the test user will own (via graph rules)
  const org = await db.api.save.organisations({
    name: 'Graph Test No Rules Org',
    description: 'Testing no graph rules'
  }, testUserId);

  // Now create venue for the organization the user owns
  const venue = await db.api.save.venues({
    org_id: org.id,
    name: 'Graph Test No Rules Venue',
    address: '789 Test Blvd'
  }, testUserId);

  expect(venue.id).toBeDefined();

  // Graph rules should indicate no rules configured for this entity
  if (venue._graph_rules) {
    expect(venue._graph_rules.status).toBe('no_rules');
  }

  // Clean up
  await sql`DELETE FROM venues WHERE id = ${venue.id}`;
  await sql`DELETE FROM organisations WHERE id = ${org.id}`;
});

test("Graph rules with temporal data", async () => {
  // Create an organisation (will create acts_for with valid_from)
  const org = await db.api.save.organisations({
    name: 'Graph Test Temporal Org',
    description: 'Testing temporal relationships'
  }, testUserId);

  // Get the acts_for record created by graph rule
  const initialActsFor = await sql`
    SELECT * FROM acts_for
    WHERE user_id = ${testUserId}
    AND org_id = ${org.id}
    AND valid_to IS NULL
  `;

  expect(initialActsFor.length).toBe(1);
  const validFrom = initialActsFor[0].valid_from;
  expect(validFrom).toBeDefined();

  // The valid_from should be today
  const today = new Date().toISOString().split('T')[0];
  const recordDate = new Date(validFrom).toISOString().split('T')[0];
  expect(recordDate).toBe(today);
});

test("Graph rules variable resolution", async () => {
  // This tests that @user_id, @id, @now variables are properly resolved
  // The organisation creation rule uses these variables:
  // - @user_id should resolve to the current user
  // - @id should resolve to the new organisation id
  // - @now (or @today) should resolve to current date

  const org = await db.api.save.organisations({
    name: 'Graph Test Variable Resolution',
    description: 'Testing variable resolution in graph rules'
  }, testUserId);

  // Verify the acts_for record has correct values from variable resolution
  const actsFor = await sql`
    SELECT * FROM acts_for
    WHERE user_id = ${testUserId}
    AND org_id = ${org.id}
  `;

  expect(actsFor.length).toBe(1);

  // @user_id resolved correctly
  expect(actsFor[0].user_id).toBe(testUserId);

  // @id resolved to the new org id
  expect(actsFor[0].org_id).toBe(org.id);

  // @now/@today resolved to a date
  expect(actsFor[0].valid_from).toBeDefined();
});
