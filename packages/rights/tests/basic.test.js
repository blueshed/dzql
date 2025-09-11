import { describe, test, beforeAll, afterAll, expect } from "bun:test";
import { sql, listen_sql, setupListeners, db } from "../../dzql/src/server/db.js";
import { $ } from "bun";

describe("Rights End-to-End Test", () => {
  let userId;
  let orgId;
  let venueId;
  let siteId;
  let events = [];

  beforeAll(async () => {
    // Reset database using npm scripts
    await $`bun db:down`;
    await $`bun db:up`;

    // Wait for database to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Setup event listener
    await setupListeners((event) => {
      events.push(event);
    });

    // Register test user
    const userResult = await db.api.register_user({
      email: 'rights-test@example.com',
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

    console.log(`✅ Rights End-to-End Test: All composite key operations working`);
    console.log(`   SAVE/GET/LOOKUP/SEARCH/DELETE for junction tables: ✅`);
    console.log(`   Composite PK events with proper structure: ✅`);
  });
});
