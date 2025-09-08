import { test, expect, beforeAll, afterAll } from "bun:test";
import { sql, db } from "zeroql";

beforeAll(async () => {
  // Clean up test data
  await sql`DELETE FROM allocations WHERE id > 200`;
  await sql`DELETE FROM packages WHERE id > 200`;
  await sql`DELETE FROM sites WHERE id > 200`;
  await sql`DELETE FROM venues WHERE id > 200`;
  await sql`DELETE FROM acts_for WHERE user_id > 200`;
  await sql`DELETE FROM organisations WHERE id > 200`;
  await sql`DELETE FROM users WHERE id > 200`;

  // Create test users
  await sql`
    INSERT INTO users (id, email, name, password_hash) VALUES
    (201, 'owner@test.com', 'Owner User', 'hash'),
    (202, 'member@test.com', 'Member User', 'hash'),
    (203, 'outsider@test.com', 'Outsider User', 'hash'),
    (204, 'sponsor@test.com', 'Sponsor User', 'hash')
  `;

  // Create test organizations
  await sql`
    INSERT INTO organisations (id, name, description) VALUES
    (201, 'Venue Owner Org', 'Owns venues'),
    (202, 'Sponsor Org', 'Sponsors packages'),
    (203, 'Unrelated Org', 'No access')
  `;

  // Set up acts_for relationships
  await sql`
    INSERT INTO acts_for (user_id, org_id, valid_from) VALUES
    (201, 201, CURRENT_DATE),  -- Owner acts for venue org
    (202, 201, CURRENT_DATE),  -- Member also acts for venue org
    (203, 203, CURRENT_DATE),  -- Outsider acts for unrelated org
    (204, 202, CURRENT_DATE)   -- Sponsor acts for sponsor org
  `;

  // Create test venue
  await sql`
    INSERT INTO venues (id, org_id, name, address, description) VALUES
    (201, 201, 'Test Arena', '456 Test Ave', 'Permission test venue')
  `;

  // Create test site
  await sql`
    INSERT INTO sites (id, venue_id, name, description) VALUES
    (201, 201, 'Main Floor', 'Primary site for testing')
  `;

  // Create test package
  await sql`
    INSERT INTO packages (id, owner_org_id, sponsor_org_id, name, price, status) VALUES
    (201, 201, 202, 'Test Package', 50000, 'sold')
  `;
});

afterAll(async () => {
  // Clean up test data
  await sql`DELETE FROM allocations WHERE id > 200`;
  await sql`DELETE FROM packages WHERE id > 200`;
  await sql`DELETE FROM sites WHERE id > 200`;
  await sql`DELETE FROM venues WHERE id > 200`;
  await sql`DELETE FROM acts_for WHERE user_id > 200`;
  await sql`DELETE FROM organisations WHERE id > 200`;
  await sql`DELETE FROM users WHERE id > 200`;
});

// === VIEW PERMISSIONS ===

test("View permissions - public access when empty array", async () => {
  // Venues have empty array for view = public access
  const canView = await sql`
    SELECT zeroql.check_permission(
      203,  -- Outsider user
      'view',
      'venues',
      '{"id": 201, "org_id": 201}'::jsonb
    ) as allowed
  `;

  expect(canView[0].allowed).toBe(true);
});

test("View permissions - restricted when paths specified", async () => {
  // Packages have specific paths for view permission
  const ownerCanView = await sql`
    SELECT zeroql.check_permission(
      201,  -- Owner user (acts for org 201)
      'view',
      'packages',
      '{"id": 201, "owner_org_id": 201, "sponsor_org_id": 202}'::jsonb
    ) as allowed
  `;

  const sponsorCanView = await sql`
    SELECT zeroql.check_permission(
      204,  -- Sponsor user (acts for org 202)
      'view',
      'packages',
      '{"id": 201, "owner_org_id": 201, "sponsor_org_id": 202}'::jsonb
    ) as allowed
  `;

  const outsiderCanView = await sql`
    SELECT zeroql.check_permission(
      203,  -- Outsider user
      'view',
      'packages',
      '{"id": 201, "owner_org_id": 201, "sponsor_org_id": 202}'::jsonb
    ) as allowed
  `;

  expect(ownerCanView[0].allowed).toBe(true);
  expect(sponsorCanView[0].allowed).toBe(true);
  expect(outsiderCanView[0].allowed).toBe(false);
});

// === CREATE PERMISSIONS ===

test("Create permissions - must act for assigned org", async () => {
  // User must act for the org they're assigning
  const canCreate = await sql`
    SELECT zeroql.check_permission(
      201,  -- Owner user (acts for org 201)
      'create',
      'venues',
      '{"name": "New Venue", "org_id": 201}'::jsonb
    ) as allowed
  `;

  const cannotCreate = await sql`
    SELECT zeroql.check_permission(
      203,  -- Outsider user (doesn't act for org 201)
      'create',
      'venues',
      '{"name": "New Venue", "org_id": 201}'::jsonb
    ) as allowed
  `;

  expect(canCreate[0].allowed).toBe(true);
  expect(cannotCreate[0].allowed).toBe(false);
});

test("Create permissions - parent-based for sites", async () => {
  // Sites require permission through parent venue
  const canCreate = await sql`
    SELECT zeroql.check_permission(
      201,  -- Owner of venue (via org)
      'create',
      'sites',
      '{"name": "New Site", "venue_id": 201}'::jsonb
    ) as allowed
  `;

  const cannotCreate = await sql`
    SELECT zeroql.check_permission(
      203,  -- Not owner of venue
      'create',
      'sites',
      '{"name": "New Site", "venue_id": 201}'::jsonb
    ) as allowed
  `;

  expect(canCreate[0].allowed).toBe(true);
  expect(cannotCreate[0].allowed).toBe(false);
});

// === UPDATE PERMISSIONS ===

test("Update permissions - check existing record", async () => {
  // Update checks the existing record, not new values
  const ownerCanUpdate = await sql`
    SELECT zeroql.check_permission(
      201,  -- Owner user
      'update',
      'venues',
      '{"id": 201, "org_id": 201, "name": "Test Arena"}'::jsonb
    ) as allowed
  `;

  const memberCanUpdate = await sql`
    SELECT zeroql.check_permission(
      202,  -- Member user (also acts for org 201)
      'update',
      'venues',
      '{"id": 201, "org_id": 201, "name": "Test Arena"}'::jsonb
    ) as allowed
  `;

  const outsiderCannotUpdate = await sql`
    SELECT zeroql.check_permission(
      203,  -- Outsider user
      'update',
      'venues',
      '{"id": 201, "org_id": 201, "name": "Test Arena"}'::jsonb
    ) as allowed
  `;

  expect(ownerCanUpdate[0].allowed).toBe(true);
  expect(memberCanUpdate[0].allowed).toBe(true);
  expect(outsiderCannotUpdate[0].allowed).toBe(false);
});

test("Update permissions - multiple stakeholders", async () => {
  // Packages can be updated by owner or sponsor
  const ownerCanUpdate = await sql`
    SELECT zeroql.check_permission(
      201,  -- Owner org user
      'update',
      'packages',
      '{"id": 201, "owner_org_id": 201, "sponsor_org_id": 202}'::jsonb
    ) as allowed
  `;

  const sponsorCanUpdate = await sql`
    SELECT zeroql.check_permission(
      204,  -- Sponsor org user
      'update',
      'packages',
      '{"id": 201, "owner_org_id": 201, "sponsor_org_id": 202}'::jsonb
    ) as allowed
  `;

  const outsiderCannotUpdate = await sql`
    SELECT zeroql.check_permission(
      203,  -- Outsider
      'update',
      'packages',
      '{"id": 201, "owner_org_id": 201, "sponsor_org_id": 202}'::jsonb
    ) as allowed
  `;

  expect(ownerCanUpdate[0].allowed).toBe(true);
  expect(sponsorCanUpdate[0].allowed).toBe(true);
  expect(outsiderCannotUpdate[0].allowed).toBe(false);
});

// === DELETE PERMISSIONS ===

test("Delete permissions - owner only", async () => {
  // Only owner can delete venues
  const ownerCanDelete = await sql`
    SELECT zeroql.check_permission(
      201,  -- Owner user
      'delete',
      'venues',
      '{"id": 201, "org_id": 201}'::jsonb
    ) as allowed
  `;

  const memberCanDelete = await sql`
    SELECT zeroql.check_permission(
      202,  -- Member user (acts for same org)
      'delete',
      'venues',
      '{"id": 201, "org_id": 201}'::jsonb
    ) as allowed
  `;

  const outsiderCannotDelete = await sql`
    SELECT zeroql.check_permission(
      203,  -- Outsider
      'delete',
      'venues',
      '{"id": 201, "org_id": 201}'::jsonb
    ) as allowed
  `;

  expect(ownerCanDelete[0].allowed).toBe(true);
  expect(memberCanDelete[0].allowed).toBe(true); // Members of org can also delete
  expect(outsiderCannotDelete[0].allowed).toBe(false);
});

// === INTEGRATION WITH GENERIC OPERATIONS ===

test("generic_save enforces create permissions", async () => {
  // Try to create a venue as outsider
  try {
    await sql`
      SELECT zeroql.generic_save(
        'venues',
        '{"name": "Unauthorized Venue", "org_id": 201, "address": "123 Bad St"}'::jsonb,
        203  -- Outsider user
      )
    `;
    expect(true).toBe(false); // Should not reach here
  } catch (error) {
    expect(error.message).toContain("Permission denied");
  }
});

test("generic_save enforces update permissions", async () => {
  // Try to update a venue as outsider
  try {
    await sql`
      SELECT zeroql.generic_save(
        'venues',
        '{"id": 201, "name": "Hacked Name"}'::jsonb,
        203  -- Outsider user
      )
    `;
    expect(true).toBe(false); // Should not reach here
  } catch (error) {
    expect(error.message).toContain("Permission denied");
  }
});

test("generic_delete enforces permissions", async () => {
  // Create a test venue to delete
  await sql`
    INSERT INTO venues (id, org_id, name, address) VALUES
    (299, 201, 'Delete Test Venue', '789 Delete St')
  `;

  // Try to delete as outsider
  try {
    await sql`
      SELECT zeroql.generic_delete(
        'venues',
        '{"id": 299}'::jsonb,
        203  -- Outsider user
      )
    `;
    expect(true).toBe(false); // Should not reach here
  } catch (error) {
    expect(error.message).toContain("Permission denied");
  }

  // Clean up
  await sql`DELETE FROM venues WHERE id = 299`;
});

test("generic_get respects view permissions", async () => {
  // Public entity (venues) - everyone can view
  const publicView = await sql`
    SELECT zeroql.generic_get(
      'venues',
      '{"id": 201}'::jsonb,
      203  -- Outsider user
    ) as result
  `;
  expect(publicView[0].result).not.toBeNull();
  expect(publicView[0].result.id).toBe(201);

  // Restricted entity (packages) - only stakeholders can view
  const restrictedView = await sql`
    SELECT zeroql.generic_get(
      'packages',
      '{"id": 201}'::jsonb,
      203  -- Outsider user
    ) as result
  `;
  expect(restrictedView[0].result).toBeNull();

  // Stakeholder can view
  const allowedView = await sql`
    SELECT zeroql.generic_get(
      'packages',
      '{"id": 201}'::jsonb,
      201  -- Owner user
    ) as result
  `;
  expect(allowedView[0].result).not.toBeNull();
  expect(allowedView[0].result.id).toBe(201);
});

// === TEMPORAL PERMISSIONS ===

test("Permission paths respect temporal filtering", async () => {
  // Add contractor rights that expire
  await sql`
    INSERT INTO contractor_rights (contractor_org_id, sponsor_org_id, package_id, valid_from, valid_to) VALUES
    (203, 202, 201, CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE - INTERVAL '1 day')
  `;

  // Create allocation
  await sql`
    INSERT INTO allocations (id, package_id, site_id, from_date, to_date) VALUES
    (201, 201, 201, '2024-07-01', '2024-08-31')
  `;

  // Contractor with expired rights cannot view
  const expiredContractor = await sql`
    SELECT zeroql.check_permission(
      203,  -- User from contractor org
      'view',
      'allocations',
      '{"id": 201, "package_id": 201, "site_id": 201}'::jsonb
    ) as allowed
  `;

  expect(expiredContractor[0].allowed).toBe(false);

  // Update to active contractor rights
  await sql`
    UPDATE contractor_rights
    SET valid_from = CURRENT_DATE,
        valid_to = CURRENT_DATE + INTERVAL '30 days'
    WHERE contractor_org_id = 203 AND package_id = 201
  `;

  // Now contractor can view
  const activeContractor = await sql`
    SELECT zeroql.check_permission(
      203,  -- User from contractor org
      'view',
      'allocations',
      '{"id": 201, "package_id": 201, "site_id": 201}'::jsonb
    ) as allowed
  `;

  expect(activeContractor[0].allowed).toBe(true);

  // Clean up
  await sql`DELETE FROM allocations WHERE id = 201`;
  await sql`DELETE FROM contractor_rights WHERE contractor_org_id = 203`;
});

// === NO CONFIG MEANS UNRESTRICTED ===

test("Entity without permission_paths is unrestricted", async () => {
  // acts_for has no permission_paths configured
  const canView = await sql`
    SELECT zeroql.check_permission(
      999,  -- Non-existent user
      'view',
      'acts_for',
      '{"user_id": 201, "org_id": 201}'::jsonb
    ) as allowed
  `;

  expect(canView[0].allowed).toBe(true);
});
