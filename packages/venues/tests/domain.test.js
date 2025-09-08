import { test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { sql, db } from "zeroql";

let testUserId;

beforeAll(async () => {
  // Create test user for domain tests
  const userResult = await sql`
    SELECT register_user('domain-test@example.com', 'password123') as user_data
  `;
  testUserId = userResult[0].user_data.user_id;
});

// Clean up test data before each test to avoid conflicts
beforeEach(async () => {
  await sql`DELETE FROM sites WHERE name LIKE '%Test%'`;
  await sql`DELETE FROM venues WHERE name LIKE '%Test%'`;
  await sql`DELETE FROM products WHERE name LIKE '%Test%'`;
  await sql`DELETE FROM acts_for WHERE org_id IN (SELECT id FROM organisations WHERE name LIKE '%Test%' OR name LIKE 'Partial Test Org%' OR name LIKE 'Updated Partial Org%' OR name LIKE 'Minimal Org%')`;
  await sql`DELETE FROM organisations WHERE name LIKE '%Test%' OR name LIKE 'Partial Test Org%' OR name LIKE 'Updated Partial Org%' OR name LIKE 'Minimal Org%'`;
});

afterAll(async () => {
  // Final cleanup after all tests
  await sql`DELETE FROM sites WHERE name LIKE '%Test%'`;
  await sql`DELETE FROM venues WHERE name LIKE '%Test%'`;
  await sql`DELETE FROM products WHERE name LIKE '%Test%'`;
  await sql`DELETE FROM acts_for WHERE org_id IN (SELECT id FROM organisations WHERE name LIKE '%Test%' OR name LIKE 'Partial Test Org%' OR name LIKE 'Updated Partial Org%' OR name LIKE 'Minimal Org%') OR user_id = ${testUserId}`;
  await sql`DELETE FROM organisations WHERE name LIKE '%Test%' OR name LIKE 'Partial Test Org%' OR name LIKE 'Updated Partial Org%' OR name LIKE 'Minimal Org%'`;
  // Clean up test user
  await sql`DELETE FROM users WHERE id = ${testUserId}`;
});

test("Get organisation using ZeroQL API", async () => {
  const result = await db.api.get.organisations({ id: 1 }, testUserId);
  expect(result).toBeDefined();
  expect(result.id).toBe(1);
  expect(result.name).toBeDefined();
});

test("Lookup organisations using ZeroQL API", async () => {
  const result = await db.api.lookup.organisations(
    { p_filter: "Event" },
    testUserId,
  );
  expect(result).toBeDefined();
  expect(Array.isArray(result)).toBe(true);
  expect(result.length).toBeGreaterThan(0);
  expect(result[0].label).toContain("Event");
  expect(result[0].value).toBeDefined();
});

test("Search venues using ZeroQL API", async () => {
  const result = await db.api.search.venues({ p_filters: {} }, testUserId);
  expect(result).toBeDefined();
  expect(result.data).toBeDefined();
  expect(Array.isArray(result.data)).toBe(true);
  expect(Number(result.total)).toBeGreaterThan(0);
  expect(result.page).toBe(1);
});

test("Save new organisation using ZeroQL API", async () => {
  const orgData = {
    name: "Test Org Domain",
    description: "Test organization for domain testing",
  };
  const result = await db.api.save.organisations(orgData, testUserId);
  expect(result).toBeDefined();
  expect(result.id).toBeDefined();
  expect(result.name).toBe("Test Org Domain");
  expect(result.description).toBe("Test organization for domain testing");
});

test("Save new venue using ZeroQL API", async () => {
  // First create a test org using ZeroQL API
  const orgData = {
    name: `Test Venue Owner ${Date.now()}`,
    description: "Owner for test venue",
  };
  const orgResult = await db.api.save.organisations(orgData, testUserId);
  const orgId = orgResult.id;

  // Ensure user 1 can act for this org
  await sql`
    INSERT INTO acts_for (user_id, org_id, valid_from)
    VALUES (${testUserId}, ${orgId}, CURRENT_DATE)
    ON CONFLICT DO NOTHING
  `;

  const venueData = {
    org_id: orgId,
    name: "Test Venue Domain",
    address: "123 Test Street, Test City",
    description: "Test venue for domain testing",
  };
  const result = await db.api.save.venues(venueData, testUserId);
  expect(result).toBeDefined();
  expect(result.id).toBeDefined();
  expect(result.name).toBe("Test Venue Domain");
  expect(result.org_id).toBe(orgId);
});

test("Get venue using ZeroQL API", async () => {
  // Get first venue - ZeroQL should include related sites automatically
  // First ensure we have a venue with proper permissions
  const testOrg = await db.api.save.organisations(
    {
      name: `Test Get Venue Org ${Date.now()}`,
      description: "Org for get venue test",
    },
    testUserId,
  );

  // Ensure test user can act for this org
  await sql`
    INSERT INTO acts_for (user_id, org_id, valid_from)
    VALUES (${testUserId}, ${testOrg.id}, CURRENT_DATE)
    ON CONFLICT DO NOTHING
  `;

  const testVenue = await db.api.save.venues(
    {
      org_id: testOrg.id,
      name: `Test Get Venue ${Date.now()}`,
      address: "789 Test Blvd",
      description: "Venue for get test",
    },
    testUserId,
  );

  const firstVenueId = testVenue.id;
  const result = await db.api.get.venues({ id: firstVenueId }, testUserId);

  expect(result).toBeDefined();
  expect(result.id).toBeDefined();
  expect(result.name).toBeDefined();
  expect(result.address).toBeDefined();

  // Verify org_id remains as integer, but org field is added with the label
  expect(result.org_id).toBeDefined();
  expect(typeof result.org_id).toBe("number");
  expect(result.org_id).toBe(testOrg.id);

  // The dereferenced org field should contain the label
  expect(result.org).toBeDefined();
  expect(typeof result.org).toBe("string");
  expect(result.org).toBe(testOrg.name);

  // Verify sites are included as an array
  expect(result.sites).toBeDefined();
  expect(Array.isArray(result.sites)).toBe(true);

  // If there are sites, verify their structure
  if (result.sites.length > 0) {
    const firstSite = result.sites[0];
    expect(firstSite.id).toBeDefined();
    expect(firstSite.name).toBeDefined();
    expect(firstSite.venue_id).toBe(firstVenueId);
  }
});

test("Delete organisation using ZeroQL API", async () => {
  // Create a test org to delete using ZeroQL API
  const orgData = {
    name: `Test Delete Org ${Date.now()}`,
    description: "Will be deleted",
  };
  const createResult = await db.api.save.organisations(orgData, testUserId);
  const orgId = createResult.id;

  // Delete it using ZeroQL API
  const deleteResult = await db.api.delete.organisations(
    { id: orgId },
    testUserId,
  );
  expect(deleteResult).toBeDefined();
  expect(deleteResult.id).toBe(orgId);

  // Verify it's gone by trying to get it
  const getResult = await db.api.get.organisations({ id: orgId }, testUserId);
  // Should return empty object when record doesn't exist
  expect(getResult).toEqual({});
});

test("Sample data exists", async () => {
  // Verify sample organizations exist
  const orgs = await sql`SELECT count(*) as count FROM organisations`;
  expect(Number(orgs[0].count)).toBeGreaterThan(0);

  // Verify sample venues exist
  const venues = await sql`SELECT count(*) as count FROM venues`;
  expect(Number(venues[0].count)).toBeGreaterThan(0);

  // Verify sample sites exist
  const sites = await sql`SELECT count(*) as count FROM sites`;
  expect(Number(sites[0].count)).toBeGreaterThan(0);

  // Verify sample products exist
  const products = await sql`SELECT count(*) as count FROM products`;
  expect(Number(products[0].count)).toBeGreaterThan(0);
});

test("Foreign key relationships work", async () => {
  // Get a venue and verify it references an organisation
  const venue = await sql`
    SELECT v.*, o.name as org_name
    FROM venues v
    JOIN organisations o ON v.org_id = o.id
    LIMIT 1
  `;
  expect(venue[0]).toBeDefined();
  expect(venue[0].org_name).toBeDefined();

  // Get sites for this venue
  const sites = await sql`
    SELECT s.*
    FROM sites s
    WHERE s.venue_id = ${venue[0].id}
  `;
  expect(sites.length).toBeGreaterThan(0);
});

test("ZeroQL save - partial update coalescing", async () => {
  // Create a test organisation with full data using ZeroQL API
  const timestamp = Date.now();
  const createData = {
    name: `Partial Test Org ${timestamp}`,
    description: "Original description",
  };
  const createResult = await db.api.save.organisations(createData, testUserId);
  const orgId = createResult.id;
  expect(createResult.name).toBe(`Partial Test Org ${timestamp}`);
  expect(createResult.description).toBe("Original description");

  // Partial update - only change the name using ZeroQL API
  const updateData = { id: orgId, name: `Updated Partial Org ${timestamp}` };
  const updateResult = await db.api.save.organisations(updateData, testUserId);

  // Should keep existing description, update name
  expect(updateResult.id).toBe(orgId);
  expect(updateResult.name).toBe(`Updated Partial Org ${timestamp}`);
  expect(updateResult.description).toBe("Original description"); // Should be preserved
});

test("ZeroQL save - insert with defaults", async () => {
  // Insert with minimal data using ZeroQL API (description should be null/default)
  const timestamp = Date.now();
  const insertData = { name: `Minimal Org ${timestamp}` };
  const result = await db.api.save.organisations(insertData, testUserId);

  expect(result.id).toBeDefined();
  expect(result.name).toBe(`Minimal Org ${timestamp}`);
  expect(result.description).toBeNull(); // Should use column default (null)
});

test("ZeroQL save - update non-existent record fails", async () => {
  let threwError = false;
  try {
    const badData = { id: "99999", name: "Does not exist" };
    await db.api.save.organisations(badData, testUserId);
  } catch (error) {
    threwError = true;
    expect(error.message).toContain("record with id 99999 not found");
  }
  expect(threwError).toBe(true);
});
