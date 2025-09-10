import { test, expect, beforeAll, afterAll } from "bun:test";
import { sql, db } from "dzql";

// Unique prefix for this test run
const PREFIX = `PERM_${Date.now()}`;
let testUsers = {};
let testOrgs = {};
let testVenue;
let testSite;
let testPackage;

beforeAll(async () => {
  // Create test users with unique emails
  const ownerEmail = `${PREFIX.toLowerCase()}_owner@test.local`;
  const memberEmail = `${PREFIX.toLowerCase()}_member@test.local`;
  const outsiderEmail = `${PREFIX.toLowerCase()}_outsider@test.local`;
  const sponsorEmail = `${PREFIX.toLowerCase()}_sponsor@test.local`;

  // Register users and store their IDs
  const owner = await sql`SELECT register_user(${ownerEmail}, 'password123') as data`;
  testUsers.owner = owner[0].data.user_id;

  const member = await sql`SELECT register_user(${memberEmail}, 'password123') as data`;
  testUsers.member = member[0].data.user_id;

  const outsider = await sql`SELECT register_user(${outsiderEmail}, 'password123') as data`;
  testUsers.outsider = outsider[0].data.user_id;

  const sponsor = await sql`SELECT register_user(${sponsorEmail}, 'password123') as data`;
  testUsers.sponsor = sponsor[0].data.user_id;

  // Create test organizations
  const org1 = await sql`
    INSERT INTO organisations (name, description)
    VALUES (${PREFIX + '_VenueOwnerOrg'}, 'Owns venues')
    RETURNING id
  `;
  testOrgs.venueOwner = org1[0].id;

  const org2 = await sql`
    INSERT INTO organisations (name, description)
    VALUES (${PREFIX + '_SponsorOrg'}, 'Sponsors packages')
    RETURNING id
  `;
  testOrgs.sponsor = org2[0].id;

  const org3 = await sql`
    INSERT INTO organisations (name, description)
    VALUES (${PREFIX + '_UnrelatedOrg'}, 'No access')
    RETURNING id
  `;
  testOrgs.unrelated = org3[0].id;

  // Set up acts_for relationships
  await sql`
    INSERT INTO acts_for (user_id, org_id, valid_from) VALUES
    (${testUsers.owner}, ${testOrgs.venueOwner}, CURRENT_DATE),
    (${testUsers.member}, ${testOrgs.venueOwner}, CURRENT_DATE),
    (${testUsers.outsider}, ${testOrgs.unrelated}, CURRENT_DATE),
    (${testUsers.sponsor}, ${testOrgs.sponsor}, CURRENT_DATE)
  `;

  // Create test venue
  const venue = await sql`
    INSERT INTO venues (org_id, name, address, description)
    VALUES (${testOrgs.venueOwner}, ${PREFIX + '_TestArena'}, '456 Test Ave', 'Permission test venue')
    RETURNING id
  `;
  testVenue = venue[0].id;

  // Create test site
  const site = await sql`
    INSERT INTO sites (venue_id, name, description)
    VALUES (${testVenue}, ${PREFIX + '_MainFloor'}, 'Primary site for testing')
    RETURNING id
  `;
  testSite = site[0].id;

  // Create test package
  const pkg = await sql`
    INSERT INTO packages (owner_org_id, sponsor_org_id, name, price, status)
    VALUES (${testOrgs.venueOwner}, ${testOrgs.sponsor}, ${PREFIX + '_TestPackage'}, 50000, 'sold')
    RETURNING id
  `;
  testPackage = pkg[0].id;
});

afterAll(async () => {
  // Clean up in correct FK dependency order
  await sql`DELETE FROM allocations WHERE package_id = ${testPackage}`;
  await sql`DELETE FROM contractor_rights WHERE package_id = ${testPackage}`;
  await sql`DELETE FROM packages WHERE id = ${testPackage}`;
  await sql`DELETE FROM sites WHERE id = ${testSite}`;
  await sql`DELETE FROM venues WHERE id = ${testVenue}`;
  await sql`DELETE FROM acts_for WHERE
    user_id IN (${testUsers.owner}, ${testUsers.member}, ${testUsers.outsider}, ${testUsers.sponsor})`;
  await sql`DELETE FROM organisations WHERE
    id IN (${testOrgs.venueOwner}, ${testOrgs.sponsor}, ${testOrgs.unrelated})`;
  await sql`DELETE FROM users WHERE
    id IN (${testUsers.owner}, ${testUsers.member}, ${testUsers.outsider}, ${testUsers.sponsor})`;
});

// === VIEW PERMISSIONS ===

test("View permissions - public access when empty array", async () => {
  // Venues have empty array for view = public access
  const result = await db.api.get.venues({ id: testVenue }, testUsers.outsider);
  expect(result).toBeDefined();
  expect(result.id).toBe(testVenue);
});

test("View permissions - restricted when paths specified", async () => {
  // Packages have specific paths for view permission
  // Owner can view
  const ownerView = await db.api.get.packages({ id: testPackage }, testUsers.owner);
  expect(ownerView).toBeDefined();
  expect(ownerView.id).toBe(testPackage);

  // Sponsor can view
  const sponsorView = await db.api.get.packages({ id: testPackage }, testUsers.sponsor);
  expect(sponsorView).toBeDefined();
  expect(sponsorView.id).toBe(testPackage);

  // Outsider cannot view
  try {
    await db.api.get.packages({ id: testPackage }, testUsers.outsider);
    expect(true).toBe(false); // Should not reach here
  } catch (error) {
    expect(error.message).toContain('Permission denied');
  }
});

// === CREATE PERMISSIONS ===

test("Create permissions - must act for assigned org", async () => {
  // Owner can create venue for their org
  const venueByOwner = await db.api.save.venues({
    name: `${PREFIX}_OwnerVenue`,
    org_id: testOrgs.venueOwner,
    address: '123 Owner St',
    description: 'Created by owner'
  }, testUsers.owner);
  expect(venueByOwner.id).toBeDefined();

  // Outsider cannot create venue for that org
  try {
    await db.api.save.venues({
      name: `${PREFIX}_UnauthorizedVenue`,
      org_id: testOrgs.venueOwner,
      address: '123 Bad St',
      description: 'Should fail'
    }, testUsers.outsider);
    expect(true).toBe(false); // Should not reach here
  } catch (error) {
    expect(error.message).toContain('Permission denied');
  }

  // Clean up
  await sql`DELETE FROM venues WHERE id = ${venueByOwner.id}`;
});

test("Create permissions - parent-based for sites", async () => {
  // Owner of venue (via org) can create site
  const siteByOwner = await db.api.save.sites({
    name: `${PREFIX}_OwnerSite`,
    venue_id: testVenue,
    description: 'Created by venue owner'
  }, testUsers.owner);
  expect(siteByOwner.id).toBeDefined();

  // Outsider cannot create site for that venue
  try {
    await db.api.save.sites({
      name: `${PREFIX}_UnauthorizedSite`,
      venue_id: testVenue,
      description: 'Should fail'
    }, testUsers.outsider);
    expect(true).toBe(false); // Should not reach here
  } catch (error) {
    expect(error.message).toContain('Permission denied');
  }

  // Clean up
  await sql`DELETE FROM sites WHERE id = ${siteByOwner.id}`;
});

// === UPDATE PERMISSIONS ===

test("Update permissions - check existing record", async () => {
  // Owner can update
  const ownerUpdate = await db.api.save.venues({
    id: testVenue,
    description: 'Updated by owner'
  }, testUsers.owner);
  expect(ownerUpdate.description).toBe('Updated by owner');

  // Member can update (also acts for org)
  const memberUpdate = await db.api.save.venues({
    id: testVenue,
    description: 'Updated by member'
  }, testUsers.member);
  expect(memberUpdate.description).toBe('Updated by member');

  // Outsider cannot update
  try {
    await db.api.save.venues({
      id: testVenue,
      description: 'Should fail'
    }, testUsers.outsider);
    expect(true).toBe(false); // Should not reach here
  } catch (error) {
    expect(error.message).toContain('Permission denied');
  }
});

test("Update permissions - multiple stakeholders", async () => {
  // Owner can update package
  const ownerUpdate = await db.api.save.packages({
    id: testPackage,
    price: 60000
  }, testUsers.owner);
  expect(ownerUpdate.price).toBe(60000);

  // Sponsor can update package
  const sponsorUpdate = await db.api.save.packages({
    id: testPackage,
    price: 70000
  }, testUsers.sponsor);
  expect(sponsorUpdate.price).toBe(70000);

  // Outsider cannot update
  try {
    await db.api.save.packages({
      id: testPackage,
      price: 80000
    }, testUsers.outsider);
    expect(true).toBe(false); // Should not reach here
  } catch (error) {
    expect(error.message).toContain('Permission denied');
  }
});

// === DELETE PERMISSIONS ===

test("Delete permissions - owner only", async () => {
  // Create test venues to delete
  const venue1 = await db.api.save.venues({
    name: `${PREFIX}_DeleteTest1`,
    org_id: testOrgs.venueOwner,
    address: '111 Delete St',
    description: 'Will be deleted by owner'
  }, testUsers.owner);

  const venue2 = await db.api.save.venues({
    name: `${PREFIX}_DeleteTest2`,
    org_id: testOrgs.venueOwner,
    address: '222 Delete St',
    description: 'Will be deleted by member'
  }, testUsers.owner);

  const venue3 = await db.api.save.venues({
    name: `${PREFIX}_DeleteTest3`,
    org_id: testOrgs.venueOwner,
    address: '333 Delete St',
    description: 'Cannot be deleted by outsider'
  }, testUsers.owner);

  // Owner can delete
  const ownerDelete = await db.api.delete.venues({ id: venue1.id }, testUsers.owner);
  expect(ownerDelete.id).toBe(venue1.id);

  // Member can delete (acts for same org)
  const memberDelete = await db.api.delete.venues({ id: venue2.id }, testUsers.member);
  expect(memberDelete.id).toBe(venue2.id);

  // Outsider cannot delete
  try {
    await db.api.delete.venues({ id: venue3.id }, testUsers.outsider);
    expect(true).toBe(false); // Should not reach here
  } catch (error) {
    expect(error.message).toContain('Permission denied');
  }

  // Clean up remaining venue
  await sql`DELETE FROM venues WHERE id = ${venue3.id}`;
});

// === INTEGRATION WITH GENERIC OPERATIONS ===

test("generic_save enforces create permissions", async () => {
  // Try to create a venue as outsider using generic_save directly
  try {
    await sql`
      SELECT generic_save(
        'venues',
        ${{
          name: `${PREFIX}_UnauthorizedGeneric`,
          org_id: testOrgs.venueOwner,
          address: '456 Bad St'
        }}::jsonb,
        ${testUsers.outsider}
      )
    `;
    expect(true).toBe(false); // Should not reach here
  } catch (error) {
    expect(error.message).toContain('Permission denied');
  }
});

test("generic_save enforces update permissions", async () => {
  // Try to update a venue as outsider using generic_save directly
  try {
    await sql`
      SELECT generic_save(
        'venues',
        ${{
          id: testVenue,
          name: `${PREFIX}_HackedName`
        }}::jsonb,
        ${testUsers.outsider}
      )
    `;
    expect(true).toBe(false); // Should not reach here
  } catch (error) {
    expect(error.message).toContain('Permission denied');
  }
});

test("generic_delete enforces permissions", async () => {
  // Create a venue to try deleting
  const venue = await db.api.save.venues({
    name: `${PREFIX}_GenericDeleteTest`,
    org_id: testOrgs.venueOwner,
    address: '789 Delete St',
    description: 'For generic delete test'
  }, testUsers.owner);

  // Try to delete as outsider using generic_delete directly
  try {
    await sql`
      SELECT generic_delete(
        'venues',
        ${{ id: venue.id }}::jsonb,
        ${testUsers.outsider}
      )
    `;
    expect(true).toBe(false); // Should not reach here
  } catch (error) {
    expect(error.message).toContain('Permission denied');
  }

  // Clean up
  await sql`DELETE FROM venues WHERE id = ${venue.id}`;
});

test("generic_get respects view permissions", async () => {
  // Public entity (venues) - everyone can view using generic_get
  const publicView = await sql`
    SELECT generic_get(
      'venues',
      ${{ id: testVenue }}::jsonb,
      ${testUsers.outsider}
    ) as result
  `;
  expect(publicView[0].result).not.toBeNull();
  expect(publicView[0].result.id).toBe(testVenue);

  // Restricted entity (packages) - only stakeholders can view
  try {
    await sql`
      SELECT generic_get(
        'packages',
        ${{ id: testPackage }}::jsonb,
        ${testUsers.outsider}
      ) as result
    `;
    expect(true).toBe(false); // Should not reach here
  } catch (error) {
    expect(error.message).toContain('Permission denied');
  }

  // Stakeholder can view
  const allowedView = await sql`
    SELECT generic_get(
      'packages',
      ${{ id: testPackage }}::jsonb,
      ${testUsers.owner}
    ) as result
  `;
  expect(allowedView[0].result).not.toBeNull();
  expect(allowedView[0].result.id).toBe(testPackage);
});

// === TEMPORAL PERMISSIONS ===

test("Permission paths respect temporal filtering", async () => {
  // Add contractor rights that expire
  await sql`
    INSERT INTO contractor_rights (contractor_org_id, sponsor_org_id, package_id, valid_from, valid_to)
    VALUES (${testOrgs.unrelated}, ${testOrgs.sponsor}, ${testPackage},
            CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE - INTERVAL '1 day')
  `;

  // Create allocation
  const allocation = await sql`
    INSERT INTO allocations (package_id, site_id, from_date, to_date)
    VALUES (${testPackage}, ${testSite}, '2024-07-01', '2024-08-31')
    RETURNING id
  `;
  const allocationId = allocation[0].id;

  // Contractor with expired rights cannot view
  try {
    await db.api.get.allocations({ id: allocationId }, testUsers.outsider);
    expect(true).toBe(false); // Should not reach here
  } catch (error) {
    expect(error.message).toContain('Permission denied');
  }

  // Update to active contractor rights
  await sql`
    UPDATE contractor_rights
    SET valid_from = CURRENT_DATE,
        valid_to = CURRENT_DATE + INTERVAL '30 days'
    WHERE contractor_org_id = ${testOrgs.unrelated} AND package_id = ${testPackage}
  `;

  // Now contractor can view
  const activeView = await db.api.get.allocations({ id: allocationId }, testUsers.outsider);
  expect(activeView).toBeDefined();
  expect(activeView.id).toBe(allocationId);

  // Clean up
  await sql`DELETE FROM allocations WHERE id = ${allocationId}`;
  await sql`DELETE FROM contractor_rights WHERE contractor_org_id = ${testOrgs.unrelated}`;
});

// === NO CONFIG MEANS UNRESTRICTED ===

test("Entity without permission_paths is unrestricted", async () => {
  // organisations has empty permission_paths {} configured - anyone can access
  // Using a completely unrelated user ID that doesn't exist
  const result = await db.api.get.organisations({
    id: testOrgs.venueOwner
  }, 999999); // Non-existent user ID

  expect(result).toBeDefined();
  expect(result.id).toBe(testOrgs.venueOwner);
  expect(result.name).toBe(`${PREFIX}_VenueOwnerOrg`);

  // Also test that create/update/delete work without restrictions
  const newOrg = await db.api.save.organisations({
    name: `${PREFIX}_UnrestrictedOrg`,
    description: 'Created by non-existent user'
  }, 999999);

  expect(newOrg.id).toBeDefined();

  // Clean up
  await sql`DELETE FROM organisations WHERE id = ${newOrg.id}`;
});
