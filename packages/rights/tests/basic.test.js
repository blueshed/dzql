import { describe, test, beforeAll, afterAll, expect } from "bun:test";
import { sql, listen_sql, setupListeners, db } from "../../dzql/src/server/db.js";
import { $ } from "bun";

describe("Rights End-to-End Test", () => {
  let userId;
  let orgId;
  let venueId;
  let siteId;
  let occasionId;
  let eventId;
  let gatesOpenMomentId;
  let gatesCloseMomentId;
  let packageId;
  let allocationId;
  let events = [];

  beforeAll(async () => {
    // NOTE: Run `bun rights:db` before running this test to ensure database is running
    // The test assumes the database is already up and ready

    // Setup event listener
    await setupListeners((event) => {
      events.push(event);
    });

    // Set correct search path to include dzql schema
    await sql`SET search_path = public, dzql`;

    // Create test user (migration no longer creates test users)
    const userResult = await db.api.register_user({
      email: 'test@example.com',
      password: 'password123'
    });
    userId = userResult.user_id;
  });

  afterAll(async () => {
    // Connections are managed by dzql/db.js
  });

  test("complete rights workflow", async () => {
    // ===============================================
    // Step 1: Create Organisation
    // ===============================================
    events.length = 0;

    const org = await db.api.save.organisations({
      name: "Test Rights Org",
      description: "Organisation for testing rights"
    }, userId);

    expect(org.id).toBeDefined();
    expect(org.name).toBe("Test Rights Org");
    orgId = org.id;

    // Wait for graph rules to establish ownership
    await new Promise(resolve => setTimeout(resolve, 200));

    // Verify ownership was established
    const actsForResult = await sql`
      SELECT * FROM acts_for WHERE user_id = ${userId} AND org_id = ${orgId}
    `;
    expect(actsForResult.length).toBe(1);

    // ===============================================
    // Step 2: Create Venue
    // ===============================================
    events.length = 0;

    const venue = await db.api.save.venues({
      name: "Test Rights Venue",
      address: "123 Rights Street",
      org_id: orgId
    }, userId);

    expect(venue.id).toBeDefined();
    expect(venue.name).toBe("Test Rights Venue");
    expect(venue.org_id).toBe(orgId);
    venueId = venue.id;

    // ===============================================
    // Step 3: Create Site
    // ===============================================
    events.length = 0;

    const site = await db.api.save.sites({
      name: "Main Site",
      venue_id: venueId,
      description: "Primary site for testing"
    }, userId);

    expect(site.id).toBeDefined();
    expect(site.name).toBe("Main Site");
    expect(site.venue_id).toBe(venueId);
    siteId = site.id;

    // ===============================================
    // Step 4: Create Product
    // ===============================================
    events.length = 0;

    const product = await db.api.save.products({
      name: "Test Product",
      description: "Product for rights testing",
      owner_org_id: orgId,
      dimensions: {
        width: 100,
        height: 200,
        unit: "cm"
      }
    }, userId);

    expect(product.id).toBeDefined();
    expect(product.name).toBe("Test Product");
    expect(product.owner_org_id).toBe(orgId);
    expect(product.dimensions.width).toBe(100);

    // ===============================================
    // Step 5: Test CRUD Operations
    // ===============================================

    // Test GET with FK includes
    const retrievedProduct = await db.api.get.products({id: product.id}, userId);
    expect(retrievedProduct.name).toBe("Test Product");
    expect(retrievedProduct.owner_org.name).toBe("Test Rights Org"); // FK dereferencing

    // Test SEARCH
    const searchResults = await db.api.search.products({
      filters: {
        name: {ilike: "%Test%"}
      }
    }, userId);
    expect(searchResults.data.length).toBe(1);
    expect(searchResults.data[0].name).toBe("Test Product");

    // Test LOOKUP
    const lookupResults = await db.api.lookup.products({}, userId);
    expect(lookupResults.length).toBe(1);
    expect(lookupResults[0].label).toBe("Test Product");
    expect(lookupResults[0].value).toBe(product.id);

    // Test UPDATE
    const updatedProduct = await db.api.save.products({
      id: product.id,
      name: "Updated Test Product",
      description: "Updated description"
    }, userId);
    expect(updatedProduct.name).toBe("Updated Test Product");
    expect(updatedProduct.description).toBe("Updated description");

    // ===============================================
    // Step 6: Link Product to Site (DZQL)
    // ===============================================
    events.length = 0;

    // Create site_product relationship using DZQL composite key support
    const siteProduct = await db.api.save.site_products({
      site_id: siteId,
      product_id: product.id
    }, userId);

    expect(siteProduct.site_id).toBe(siteId);
    expect(siteProduct.product_id).toBe(product.id);

    // Test GET with composite key and FK dereferencing
    // Test GET for site_products (using compound keys)
    const retrievedSiteProduct = await db.api.get.site_products({
      site_id: siteId,
      product_id: product.id
    }, userId);

    expect(retrievedSiteProduct.site_id).toBe(siteId);
    expect(retrievedSiteProduct.product_id).toBe(product.id);
    expect(retrievedSiteProduct.site).toBe("Main Site"); // FK dereferenced label
    expect(retrievedSiteProduct.product).toBe("Updated Test Product"); // FK dereferenced label

    // Test SEARCH to find products at this site
    const siteProductsSearch = await db.api.search.site_products({
      filters: {
        site_id: siteId
      }
    }, userId);
    expect(siteProductsSearch.data.length).toBe(1);
    expect(siteProductsSearch.data[0].site_id).toBe(siteId);
    expect(siteProductsSearch.data[0].product.name).toBe("Updated Test Product");

    // Test LOOKUP for site_products
    const siteProductsLookup = await db.api.lookup.site_products({}, userId);
    expect(siteProductsLookup.length).toBe(1);
    expect(siteProductsLookup[0].label.site).toBe("Main Site");
    expect(siteProductsLookup[0].label.product).toBe("Updated Test Product");
    expect(siteProductsLookup[0].value).toBe("1-1"); // composite key value

    // ===============================================
    // Step 7: Test Real-time Events
    // ===============================================

    // Wait for all events to be processed
    await new Promise(resolve => setTimeout(resolve, 200));

    // Should have received events for site_products linking
    const siteProductEvents = events.filter(e => e.table === 'site_products');
    expect(siteProductEvents.length).toBeGreaterThanOrEqual(1); // create

    // Verify event structure for composite key
    const linkEvent = siteProductEvents.find(e => e.op === 'insert');

    expect(linkEvent.notify_users).toContain(userId);
    expect(linkEvent.pk.site_id).toBe(siteId.toString()); // Composite PK structure (string values)
    expect(linkEvent.pk.product_id).toBe(product.id.toString()); // Composite PK structure (string values)
    expect(linkEvent.after.site_id).toBe(siteId);
    expect(linkEvent.after.product_id).toBe(product.id);

    // ===============================================
    // Step 8: Create Occasion at Venue
    // ===============================================
    events.length = 0;

    const occasion = await db.api.save.occasions({
      venue_id: venueId,
      name: "Summer Music Festival 2024",
      from_date: "2024-07-01",
      to_date: "2024-07-03"
    }, userId);

    expect(occasion.id).toBeDefined();
    expect(occasion.name).toBe("Summer Music Festival 2024");
    expect(occasion.venue_id).toBe(venueId);
    occasionId = occasion.id;

    // Test GET with FK dereferencing
    const retrievedOccasion = await db.api.get.occasions({id: occasionId}, userId);
    expect(retrievedOccasion.venue.name).toBe("Test Rights Venue");

    // ===============================================
    // Step 9: Create Event during Occasion
    // ===============================================
    events.length = 0;

    const event = await db.api.save.events({
      occasion_id: occasionId,
      name: "Main Concert",
      from_datetime: "2024-07-02T19:00:00",
      to_datetime: "2024-07-02T23:00:00"
    }, userId);

    expect(event.id).toBeDefined();
    expect(event.name).toBe("Main Concert");
    expect(event.occasion_id).toBe(occasionId);
    eventId = event.id;

    // Test GET with FK dereferencing
    const retrievedEvent = await db.api.get.events({id: eventId}, userId);
    expect(retrievedEvent.occasion.name).toBe("Summer Music Festival 2024");

    // ===============================================
    // Step 10: Create Moments - Gates Open and Close
    // ===============================================
    events.length = 0;

    const gatesOpenMoment = await db.api.save.moments({
      occasion_id: occasionId,
      name: "Gates Open",
      at_datetime: "2024-07-02T17:00:00"
    }, userId);

    expect(gatesOpenMoment.id).toBeDefined();
    expect(gatesOpenMoment.name).toBe("Gates Open");
    expect(gatesOpenMoment.occasion_id).toBe(occasionId);
    gatesOpenMomentId = gatesOpenMoment.id;

    const gatesCloseMoment = await db.api.save.moments({
      occasion_id: occasionId,
      name: "Gates Close",
      at_datetime: "2024-07-03T01:00:00"
    }, userId);

    expect(gatesCloseMoment.id).toBeDefined();
    expect(gatesCloseMoment.name).toBe("Gates Close");
    expect(gatesCloseMoment.occasion_id).toBe(occasionId);
    gatesCloseMomentId = gatesCloseMoment.id;

    // ===============================================
    // Step 11: Test SEARCH and LOOKUP for new entities
    // ===============================================

    // Test occasion search
    const occasionSearch = await db.api.search.occasions({
      filters: {
        venue_id: venueId
      }
    }, userId);
    expect(occasionSearch.data.length).toBe(1);
    expect(occasionSearch.data[0].name).toBe("Summer Music Festival 2024");

    // Test event search
    const eventSearch = await db.api.search.events({
      filters: {
        occasion_id: occasionId
      }
    }, userId);
    expect(eventSearch.data.length).toBe(1);
    expect(eventSearch.data[0].name).toBe("Main Concert");

    // Test moments search
    const momentsSearch = await db.api.search.moments({
      filters: {
        occasion_id: occasionId
      },
      sort: {field: 'at_datetime', order: 'asc'}
    }, userId);
    expect(momentsSearch.data.length).toBe(2);
    expect(momentsSearch.data[0].name).toBe("Gates Open");
    expect(momentsSearch.data[1].name).toBe("Gates Close");

    // Test lookups
    const occasionLookup = await db.api.lookup.occasions({}, userId);
    expect(occasionLookup.length).toBe(1);
    expect(occasionLookup[0].label).toBe("Summer Music Festival 2024");

    const eventLookup = await db.api.lookup.events({}, userId);
    expect(eventLookup.length).toBe(1);
    expect(eventLookup[0].label).toBe("Main Concert");

    const momentsLookup = await db.api.lookup.moments({}, userId);
    expect(momentsLookup.length).toBe(2);

    // ===============================================
    // Step 12: Create Package for the Occasion
    // ===============================================
    events.length = 0;

    const packageData = await db.api.save.packages({
      occasion_id: occasionId,
      owner_id: orgId,
      name: "Festival Sponsorship Package",
      is_public: true
    }, userId);

    expect(packageData.id).toBeDefined();
    expect(packageData.name).toBe("Festival Sponsorship Package");
    expect(packageData.occasion_id).toBe(occasionId);
    expect(packageData.owner_id).toBe(orgId);
    packageId = packageData.id;

    // Test GET with FK dereferencing
    const retrievedPackage = await db.api.get.packages({id: packageId}, userId);
    expect(retrievedPackage.occasion.name).toBe("Summer Music Festival 2024");
    expect(retrievedPackage.owner.name).toBe("Test Rights Org");

    // ===============================================
    // Step 13: Allocate Site to Package with Occasion Date Range
    // ===============================================
    events.length = 0;

    // Create allocation using occasion's date range
    const allocation = await db.api.save.allocations({
      package_id: packageId,
      site_id: siteId,
      from_datetime: "2024-07-01T00:00:00", // occasion from_date
      to_datetime: "2024-07-03T23:59:59"    // occasion to_date
    }, userId);

    expect(allocation.id).toBeDefined();
    expect(allocation.package_id).toBe(packageId);
    expect(allocation.site_id).toBe(siteId);
    allocationId = allocation.id;

    // Test GET with FK dereferencing
    const retrievedAllocation = await db.api.get.allocations({id: allocationId}, userId);
    expect(retrievedAllocation.package.name).toBe("Festival Sponsorship Package");
    expect(retrievedAllocation.site.name).toBe("Main Site");

    // ===============================================
    // Step 14: Test Package and Allocation Search/Lookup
    // ===============================================

    // Test package search
    const packageSearch = await db.api.search.packages({
      filters: {
        occasion_id: occasionId
      }
    }, userId);
    expect(packageSearch.data.length).toBe(1);
    expect(packageSearch.data[0].name).toBe("Festival Sponsorship Package");

    // Test allocation search
    const allocationSearch = await db.api.search.allocations({
      filters: {
        package_id: packageId
      }
    }, userId);
    expect(allocationSearch.data.length).toBe(1);
    expect(allocationSearch.data[0].site_id).toBe(siteId);

    // Test lookups
    const packageLookup = await db.api.lookup.packages({}, userId);
    expect(packageLookup.length).toBe(1);
    expect(packageLookup[0].label).toBe("Festival Sponsorship Package");

    const allocationLookup = await db.api.lookup.allocations({}, userId);
    expect(allocationLookup.length).toBe(1);

    // ===============================================
    // Final Summary
    // ===============================================
    console.log(`✅ Rights End-to-End Test Complete:`);
    console.log(`   Organisation: "${org.name}" (ID: ${orgId})`);
    console.log(`   Venue: "${venue.name}" (ID: ${venueId})`);
    console.log(`   Site: "${site.name}" (ID: ${siteId})`);
    console.log(`   Occasion: "${occasion.name}" (ID: ${occasionId})`);
    console.log(`   Event: "${event.name}" (ID: ${eventId})`);
    console.log(`   Moments: Gates Open (ID: ${gatesOpenMomentId}), Gates Close (ID: ${gatesCloseMomentId})`);
    console.log(`   Package: "${packageData.name}" (ID: ${packageId})`);
    console.log(`   Allocation: Site "${site.name}" → Package "${packageData.name}" (ID: ${allocationId})`);
    console.log(`   All DZQL operations including packages & allocations working perfectly! 🎉`);
  }, { timeout: 60000 });

  test("contractor_rights temporal grants work correctly", async () => {
    // This test demonstrates the temporal behavior of contractor_rights
    // With proper composite PK (contractor_org_id, venue_id, valid_from),
    // we can track multiple grants over time for the same contractor/venue pair

    // Create a contractor organisation
    const contractorOrg = await db.api.save.organisations({
      name: "Contractor LLC",
      description: "Contractor for testing temporal rights"
    }, userId);

    expect(contractorOrg.id).toBeDefined();
    const contractorOrgId = contractorOrg.id;

    // Wait for graph rules to establish ownership
    await new Promise(resolve => setTimeout(resolve, 200));

    // Create a venue owner organisation
    const ownerOrg = await db.api.save.organisations({
      name: "Venue Owner Corp",
      description: "Owner for testing temporal rights"
    }, userId);

    expect(ownerOrg.id).toBeDefined();
    const ownerOrgId = ownerOrg.id;

    // Wait for graph rules
    await new Promise(resolve => setTimeout(resolve, 200));

    // Create a venue owned by the owner org
    const testVenue = await db.api.save.venues({
      name: "Temporal Test Venue",
      address: "456 Temporal St",
      org_id: ownerOrgId
    }, userId);

    expect(testVenue.id).toBeDefined();
    const testVenueId = testVenue.id;

    // ===============================================
    // Grant 1: Currently active rights (2025-2026)
    // ===============================================
    const rights1 = await db.api.save.contractor_rights({
      contractor_org_id: contractorOrgId,
      venue_id: testVenueId,
      granted_by_id: ownerOrgId,
      granted_by_type: 'owner',
      valid_from: "2025-01-01",
      valid_to: "2026-12-31"
    }, userId);

    expect(rights1.contractor_org_id).toBe(contractorOrgId);
    expect(rights1.venue_id).toBe(testVenueId);
    expect(rights1.valid_from).toBeDefined();
    expect(rights1.valid_to).toBeDefined();

    // ===============================================
    // Grant 2: Future rights (2027-2028)
    // With composite PK (contractor_org_id, venue_id, valid_from),
    // this should create a NEW record, not update the existing one
    // ===============================================
    const rights2 = await db.api.save.contractor_rights({
      contractor_org_id: contractorOrgId,  // Same contractor
      venue_id: testVenueId,                // Same venue
      granted_by_id: ownerOrgId,
      granted_by_type: 'owner',
      valid_from: "2027-01-01",             // Different valid_from
      valid_to: "2028-12-31"
    }, userId);

    expect(rights2.contractor_org_id).toBe(contractorOrgId);
    expect(rights2.venue_id).toBe(testVenueId);
    expect(rights2.valid_from).toBeDefined();

    // ===============================================
    // Verify: Default search shows only currently active record
    // ===============================================
    const currentRights = await db.api.search.contractor_rights({
      filters: {
        contractor_org_id: contractorOrgId,
        venue_id: testVenueId
      }
    }, userId);

    // Default temporal filter shows only active records (Grant 1)
    expect(currentRights.data.length).toBe(1);
    expect(currentRights.data[0].valid_from).toContain("2025-01-01");

    // ===============================================
    // Test temporal queries: Query all records using SQL
    // ===============================================
    // Verify both records exist in database
    const allRecords = await sql`
      SELECT * FROM contractor_rights
      WHERE contractor_org_id = ${contractorOrgId}
      AND venue_id = ${testVenueId}
      ORDER BY valid_from
    `;

    // THIS IS THE KEY ASSERTION: With proper composite PK, we have 2 distinct records
    expect(allRecords.length).toBe(2);
    expect(allRecords[0].valid_from.toISOString()).toContain("2025-01-01");
    expect(allRecords[1].valid_from.toISOString()).toContain("2027-01-01");

    console.log(`✅ Contractor Rights Temporal Test Complete:`);
    console.log(`   Contractor: "${contractorOrg.name}" (ID: ${contractorOrgId})`);
    console.log(`   Venue: "${testVenue.name}" (ID: ${testVenueId})`);
    console.log(`   Grant 1: 2025-2026 (currently active)`);
    console.log(`   Grant 2: 2027-2028 (future)`);
    console.log(`   Composite PK allows multiple temporal grants! 🎉`);
  }, { timeout: 60000 });
});
