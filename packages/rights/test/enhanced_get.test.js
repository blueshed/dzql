import { test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { sql, db } from "zeroql";

let testUserId;

beforeAll(async () => {
  // Create test user for enhanced get tests
  const userResult = await sql`
    SELECT register_user('enhanced-get-test@example.com', 'password123') as user_data
  `;
  testUserId = userResult[0].user_data.user_id;
});

// Clean up test data before each test
beforeEach(async () => {
  await sql`DELETE FROM site_products WHERE site_id IN (SELECT id FROM sites WHERE name LIKE '%Test%')`;
  await sql`DELETE FROM sites WHERE name LIKE '%Test%'`;
  await sql`DELETE FROM areas WHERE name LIKE '%Test%'`;
  await sql`DELETE FROM venues WHERE name LIKE '%Test%'`;
  await sql`DELETE FROM products WHERE name LIKE '%Test%'`;
  await sql`DELETE FROM acts_for WHERE org_id IN (SELECT id FROM organisations WHERE name LIKE '%Enhanced Test%')`;
  await sql`DELETE FROM organisations WHERE name LIKE '%Enhanced Test%'`;
});

afterAll(async () => {
  // Final cleanup after all tests
  await sql`DELETE FROM site_products WHERE site_id IN (SELECT id FROM sites WHERE name LIKE '%Test%')`;
  await sql`DELETE FROM sites WHERE name LIKE '%Test%'`;
  await sql`DELETE FROM areas WHERE name LIKE '%Test%'`;
  await sql`DELETE FROM venues WHERE name LIKE '%Test%'`;
  await sql`DELETE FROM products WHERE name LIKE '%Test%'`;
  await sql`DELETE FROM acts_for WHERE org_id IN (SELECT id FROM organisations WHERE name LIKE '%Enhanced Test%') OR user_id = ${testUserId}`;
  await sql`DELETE FROM organisations WHERE name LIKE '%Enhanced Test%'`;
  // Clean up test user
  await sql`DELETE FROM users WHERE id = ${testUserId}`;
});

test("Enhanced get - venues with areas and sites collections", async () => {
  // Create test organization
  const orgData = {
    name: "Enhanced Test MSG Entertainment",
    description: "Test org for enhanced get"
  };
  const org = await db.api.save.organisations(orgData, testUserId);

  // Ensure test user can act for this org
  await sql`
    INSERT INTO acts_for (user_id, org_id, valid_from)
    VALUES (${testUserId}, ${org.id}, CURRENT_DATE)
    ON CONFLICT DO NOTHING
  `;

  // Create test venue
  const venueData = {
    name: "Enhanced Test Madison Square Garden",
    address: "4 Pennsylvania Plaza, New York, NY 10001",
    org_id: org.id
  };
  const venue = await db.api.save.venues(venueData, testUserId);

  // Create test areas
  const orchestraArea = await sql`
    INSERT INTO areas (name, venue_id) VALUES ('Test Orchestra', ${venue.id}) RETURNING *
  `;
  const balconyArea = await sql`
    INSERT INTO areas (name, venue_id) VALUES ('Test Balcony', ${venue.id}) RETURNING *
  `;

  // Create test sites
  const site1 = await sql`
    INSERT INTO sites (name, venue_id, area_id) VALUES ('Test Front Row A1', ${venue.id}, ${orchestraArea[0].id}) RETURNING *
  `;
  const site2 = await sql`
    INSERT INTO sites (name, venue_id, area_id) VALUES ('Test Front Row A2', ${venue.id}, ${orchestraArea[0].id}) RETURNING *
  `;
  const site3 = await sql`
    INSERT INTO sites (name, venue_id, area_id) VALUES ('Test Balcony B1', ${venue.id}, ${balconyArea[0].id}) RETURNING *
  `;

  // Register venue entity with enhanced fk_includes
  await sql`
    INSERT INTO zeroql.entities (table_name, label_field, searchable_fields, fk_includes)
    VALUES ('venues', 'name', ARRAY['name', 'address'], '{
      "org": "organisations",
      "areas": "areas.venue_id",
      "sites": "sites.venue_id"
    }'::jsonb)
    ON CONFLICT (table_name) DO UPDATE SET
      fk_includes = EXCLUDED.fk_includes
  `;

  // Test enhanced get operation
  const result = await db.api.get.venues({ id: venue.id }, testUserId);

  expect(result).toBeDefined();
  expect(result.id).toBe(venue.id);
  expect(result.name).toBe("Enhanced Test Madison Square Garden");

  // Verify org dereferencing (existing behavior)
  expect(result.org_id).toBe(org.id);
  expect(result.org).toBe("Enhanced Test MSG Entertainment");

  // Verify areas collection
  expect(result.areas).toBeDefined();
  expect(Array.isArray(result.areas)).toBe(true);
  expect(result.areas.length).toBe(2);

  const orchestraFound = result.areas.find(a => a.name === 'Test Orchestra');
  const balconyFound = result.areas.find(a => a.name === 'Test Balcony');
  expect(orchestraFound).toBeDefined();
  expect(balconyFound).toBeDefined();
  expect(orchestraFound.venue_id).toBe(venue.id);
  expect(balconyFound.venue_id).toBe(venue.id);

  // Verify sites collection
  expect(result.sites).toBeDefined();
  expect(Array.isArray(result.sites)).toBe(true);
  expect(result.sites.length).toBe(3);

  const sitesNames = result.sites.map(s => s.name);
  expect(sitesNames).toContain('Test Front Row A1');
  expect(sitesNames).toContain('Test Front Row A2');
  expect(sitesNames).toContain('Test Balcony B1');

  // Verify all sites have correct venue_id
  result.sites.forEach(site => {
    expect(site.venue_id).toBe(venue.id);
  });
});

test("Enhanced get - sites with product_ids junction field array", async () => {
  // Create test organization and venue
  const orgData = {
    name: "Enhanced Test Product Org",
    description: "Test org for junction table testing"
  };
  const org = await db.api.save.organisations(orgData, testUserId);

  await sql`
    INSERT INTO acts_for (user_id, org_id, valid_from)
    VALUES (${testUserId}, ${org.id}, CURRENT_DATE)
    ON CONFLICT DO NOTHING
  `;

  const venueData = {
    name: "Enhanced Test Product Venue",
    address: "123 Product Plaza",
    org_id: org.id
  };
  const venue = await db.api.save.venues(venueData, testUserId);

  // Create test area and site
  const area = await sql`
    INSERT INTO areas (name, venue_id) VALUES ('Test Product Area', ${venue.id}) RETURNING *
  `;

  const site = await sql`
    INSERT INTO sites (name, venue_id, area_id) VALUES ('Test Product Site', ${venue.id}, ${area[0].id}) RETURNING *
  `;

  // Create test products
  const product1 = await sql`
    INSERT INTO products (name, description, owner_org_id) VALUES ('Test Premium Ticket', 'Premium access ticket', ${org.id}) RETURNING *
  `;
  const product2 = await sql`
    INSERT INTO products (name, description, owner_org_id) VALUES ('Test VIP Experience', 'VIP experience package', ${org.id}) RETURNING *
  `;
  const product3 = await sql`
    INSERT INTO products (name, description, owner_org_id) VALUES ('Test Parking Pass', 'Venue parking access', ${org.id}) RETURNING *
  `;

  // Create site-product relationships
  await sql`
    INSERT INTO site_products (site_id, product_id) VALUES
    (${site[0].id}, ${product1[0].id}),
    (${site[0].id}, ${product2[0].id})
  `;

  // Register sites entity with junction field array
  await sql`
    INSERT INTO zeroql.entities (table_name, label_field, searchable_fields, fk_includes)
    VALUES ('sites', 'name', ARRAY['name'], '{
      "venue": "venues",
      "area": "areas",
      "product_ids": "site_products.product_id"
    }'::jsonb)
    ON CONFLICT (table_name) DO UPDATE SET
      fk_includes = EXCLUDED.fk_includes
  `;

  // Test enhanced get operation with junction field array
  const result = await db.api.get.sites({ id: site[0].id }, testUserId);

  expect(result).toBeDefined();
  expect(result.id).toBe(site[0].id);
  expect(result.name).toBe("Test Product Site");

  // Verify junction field array
  expect(result.product_ids).toBeDefined();
  expect(Array.isArray(result.product_ids)).toBe(true);
  expect(result.product_ids.length).toBe(2);
  expect(result.product_ids).toContain(product1[0].id);
  expect(result.product_ids).toContain(product2[0].id);
  expect(result.product_ids).not.toContain(product3[0].id);
});

test("Enhanced get - venues with sites containing product_ids", async () => {
  // Create test organization and venue
  const orgData = {
    name: "Enhanced Test Full Org",
    description: "Test org for full enhanced get"
  };
  const org = await db.api.save.organisations(orgData, testUserId);

  await sql`
    INSERT INTO acts_for (user_id, org_id, valid_from)
    VALUES (${testUserId}, ${org.id}, CURRENT_DATE)
    ON CONFLICT DO NOTHING
  `;

  const venueData = {
    name: "Enhanced Test Full Venue",
    address: "456 Full Test Ave",
    org_id: org.id
  };
  const venue = await db.api.save.venues(venueData, testUserId);

  // Create test area and sites
  const area = await sql`
    INSERT INTO areas (name, venue_id) VALUES ('Test Full Area', ${venue.id}) RETURNING *
  `;

  const site1 = await sql`
    INSERT INTO sites (name, venue_id, area_id) VALUES ('Test Full Site 1', ${venue.id}, ${area[0].id}) RETURNING *
  `;

  const site2 = await sql`
    INSERT INTO sites (name, venue_id, area_id) VALUES ('Test Full Site 2', ${venue.id}, ${area[0].id}) RETURNING *
  `;

  // Create test products
  const product1 = await sql`
    INSERT INTO products (name, description, owner_org_id) VALUES ('Test Product One', 'First test product', ${org.id}) RETURNING *
  `;
  const product2 = await sql`
    INSERT INTO products (name, description, owner_org_id) VALUES ('Test Product Two', 'Second test product', ${org.id}) RETURNING *
  `;
  const product3 = await sql`
    INSERT INTO products (name, description, owner_org_id) VALUES ('Test Product Three', 'Third test product', ${org.id}) RETURNING *
  `;

  // Create site-product relationships
  await sql`
    INSERT INTO site_products (site_id, product_id) VALUES
    (${site1[0].id}, ${product1[0].id}),
    (${site1[0].id}, ${product2[0].id}),
    (${site2[0].id}, ${product2[0].id}),
    (${site2[0].id}, ${product3[0].id})
  `;

  // Register venue entity with enhanced fk_includes including nested junction fields
  await sql`
    INSERT INTO zeroql.entities (table_name, label_field, searchable_fields, fk_includes)
    VALUES ('venues', 'name', ARRAY['name', 'address'], '{
      "org": "organisations",
      "areas": "areas.venue_id",
      "sites": "sites.venue_id",
      "sites.product_ids": "site_products.product_id"
    }'::jsonb)
    ON CONFLICT (table_name) DO UPDATE SET
      fk_includes = EXCLUDED.fk_includes
  `;

  // Test enhanced get operation with nested junction field arrays
  const result = await db.api.get.venues({ id: venue.id }, testUserId);

  expect(result).toBeDefined();
  expect(result.id).toBe(venue.id);
  expect(result.name).toBe("Enhanced Test Full Venue");

  // Verify org dereferencing
  expect(result.org).toBe("Enhanced Test Full Org");

  // Verify areas collection
  expect(result.areas).toBeDefined();
  expect(Array.isArray(result.areas)).toBe(true);
  expect(result.areas.length).toBe(1);
  expect(result.areas[0].name).toBe('Test Full Area');

  // Verify sites collection with product_ids
  expect(result.sites).toBeDefined();
  expect(Array.isArray(result.sites)).toBe(true);
  expect(result.sites.length).toBe(2);

  // Find each site and verify its product_ids
  const testSite1 = result.sites.find(s => s.name === 'Test Full Site 1');
  const testSite2 = result.sites.find(s => s.name === 'Test Full Site 2');

  expect(testSite1).toBeDefined();
  expect(testSite1.product_ids).toBeDefined();
  expect(Array.isArray(testSite1.product_ids)).toBe(true);
  expect(testSite1.product_ids.length).toBe(2);
  expect(testSite1.product_ids).toContain(product1[0].id);
  expect(testSite1.product_ids).toContain(product2[0].id);

  expect(testSite2).toBeDefined();
  expect(testSite2.product_ids).toBeDefined();
  expect(Array.isArray(testSite2.product_ids)).toBe(true);
  expect(testSite2.product_ids.length).toBe(2);
  expect(testSite2.product_ids).toContain(product2[0].id);
  expect(testSite2.product_ids).toContain(product3[0].id);
});

test("Enhanced get - backward compatibility with existing FK dereferencing", async () => {
  // Test that existing FK dereferencing still works alongside new features
  const orgData = {
    name: "Enhanced Test Compat Org",
    description: "Test org for backward compatibility"
  };
  const org = await db.api.save.organisations(orgData, testUserId);

  await sql`
    INSERT INTO acts_for (user_id, org_id, valid_from)
    VALUES (${testUserId}, ${org.id}, CURRENT_DATE)
    ON CONFLICT DO NOTHING
  `;

  const venueData = {
    name: "Enhanced Test Compat Venue",
    address: "789 Compat Blvd",
    org_id: org.id
  };
  const venue = await db.api.save.venues(venueData, testUserId);

  // Register with mixed old and new syntax
  await sql`
    INSERT INTO zeroql.entities (table_name, label_field, searchable_fields, fk_includes)
    VALUES ('venues', 'name', ARRAY['name', 'address'], '{
      "org": "organisations",
      "sites": "sites.venue_id"
    }'::jsonb)
    ON CONFLICT (table_name) DO UPDATE SET
      fk_includes = EXCLUDED.fk_includes
  `;

  const result = await db.api.get.venues({ id: venue.id }, testUserId);

  expect(result).toBeDefined();
  expect(result.id).toBe(venue.id);

  // Verify old-style FK dereferencing still works
  expect(result.org_id).toBe(org.id);
  expect(result.org).toBe("Enhanced Test Compat Org");

  // Verify new-style collection inclusion works
  expect(result.sites).toBeDefined();
  expect(Array.isArray(result.sites)).toBe(true);
});
