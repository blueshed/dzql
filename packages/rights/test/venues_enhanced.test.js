import { test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { sql, db } from "dzql";

let testUserId;

beforeAll(async () => {
  const userResult = await sql`
    SELECT register_user('venues-enhanced-test@example.com', 'password123') as user_data
  `;
  testUserId = userResult[0].user_data.user_id;
});

beforeEach(async () => {
  await sql`DELETE FROM site_products WHERE site_id IN (SELECT id FROM sites WHERE venue_id IN (SELECT id FROM venues WHERE name LIKE '%Enhanced Venues Test%'))`;
  await sql`DELETE FROM sites WHERE venue_id IN (SELECT id FROM venues WHERE name LIKE '%Enhanced Venues Test%')`;
  await sql`DELETE FROM areas WHERE venue_id IN (SELECT id FROM venues WHERE name LIKE '%Enhanced Venues Test%')`;
  await sql`DELETE FROM venues WHERE name LIKE '%Enhanced Venues Test%'`;
  await sql`DELETE FROM products WHERE name LIKE '%Enhanced Venues Test%'`;
  await sql`DELETE FROM acts_for WHERE org_id IN (SELECT id FROM organisations WHERE name LIKE '%Enhanced Venues Test%')`;
  await sql`DELETE FROM organisations WHERE name LIKE '%Enhanced Venues Test%'`;
});

afterAll(async () => {
  await sql`DELETE FROM site_products WHERE site_id IN (SELECT id FROM sites WHERE venue_id IN (SELECT id FROM venues WHERE name LIKE '%Enhanced Venues Test%'))`;
  await sql`DELETE FROM sites WHERE venue_id IN (SELECT id FROM venues WHERE name LIKE '%Enhanced Venues Test%')`;
  await sql`DELETE FROM areas WHERE venue_id IN (SELECT id FROM venues WHERE name LIKE '%Enhanced Venues Test%')`;
  await sql`DELETE FROM venues WHERE name LIKE '%Enhanced Venues Test%'`;
  await sql`DELETE FROM products WHERE name LIKE '%Enhanced Venues Test%'`;
  await sql`DELETE FROM acts_for WHERE org_id IN (SELECT id FROM organisations WHERE name LIKE '%Enhanced Venues Test%') OR user_id = ${testUserId}`;
  await sql`DELETE FROM organisations WHERE name LIKE '%Enhanced Venues Test%'`;
  await sql`DELETE FROM users WHERE id = ${testUserId}`;
});

test("Enhanced venues get - includes areas, sites, and site product_ids", async () => {
  // Create test organization
  const org = await db.api.save.organisations({
    name: "Enhanced Venues Test MSG Entertainment",
    description: "Test org for enhanced venues"
  }, testUserId);

  await sql`
    INSERT INTO acts_for (user_id, org_id, valid_from)
    VALUES (${testUserId}, ${org.id}, CURRENT_DATE)
    ON CONFLICT DO NOTHING
  `;

  // Create test venue
  const venue = await db.api.save.venues({
    name: "Enhanced Venues Test Madison Square Garden",
    address: "4 Pennsylvania Plaza, New York, NY 10001",
    org_id: org.id
  }, testUserId);

  // Create test areas
  const orchestraArea = await sql`
    INSERT INTO areas (name, venue_id) VALUES ('Enhanced Test Orchestra', ${venue.id}) RETURNING *
  `;
  const balconyArea = await sql`
    INSERT INTO areas (name, venue_id) VALUES ('Enhanced Test Balcony', ${venue.id}) RETURNING *
  `;

  // Create test sites
  const site1 = await sql`
    INSERT INTO sites (name, venue_id, area_id) VALUES ('Enhanced Test Site A1', ${venue.id}, ${orchestraArea[0].id}) RETURNING *
  `;
  const site2 = await sql`
    INSERT INTO sites (name, venue_id, area_id) VALUES ('Enhanced Test Site A2', ${venue.id}, ${orchestraArea[0].id}) RETURNING *
  `;
  const site3 = await sql`
    INSERT INTO sites (name, venue_id, area_id) VALUES ('Enhanced Test Site B1', ${venue.id}, ${balconyArea[0].id}) RETURNING *
  `;

  // Create test products
  const product1 = await sql`
    INSERT INTO products (name, description, owner_org_id) VALUES ('Enhanced Venues Test Product 1', 'First test product', ${org.id}) RETURNING *
  `;
  const product2 = await sql`
    INSERT INTO products (name, description, owner_org_id) VALUES ('Enhanced Venues Test Product 2', 'Second test product', ${org.id}) RETURNING *
  `;
  const product3 = await sql`
    INSERT INTO products (name, description, owner_org_id) VALUES ('Enhanced Venues Test Product 3', 'Third test product', ${org.id}) RETURNING *
  `;

  // Create site-product relationships
  await sql`
    INSERT INTO site_products (site_id, product_id) VALUES
    (${site1[0].id}, ${product1[0].id}),
    (${site1[0].id}, ${product2[0].id}),
    (${site2[0].id}, ${product2[0].id}),
    (${site2[0].id}, ${product3[0].id}),
    (${site3[0].id}, ${product1[0].id})
  `;

  // Test enhanced get operation on venue
  const result = await db.api.get.venues({ id: venue.id }, testUserId);

  // Verify basic venue info
  expect(result.id).toBe(venue.id);
  expect(result.name).toBe("Enhanced Venues Test Madison Square Garden");

  // Verify org dereferencing (existing behavior)
  expect(result.org_id).toBe(org.id);
  expect(result.org).toBe("Enhanced Venues Test MSG Entertainment");

  // Verify areas collection
  expect(result.areas).toBeDefined();
  expect(Array.isArray(result.areas)).toBe(true);
  expect(result.areas.length).toBe(2);

  const orchestraFound = result.areas.find(a => a.name === 'Enhanced Test Orchestra');
  const balconyFound = result.areas.find(a => a.name === 'Enhanced Test Balcony');
  expect(orchestraFound).toBeDefined();
  expect(balconyFound).toBeDefined();

  // Verify sites collection with product_ids
  expect(result.sites).toBeDefined();
  expect(Array.isArray(result.sites)).toBe(true);
  expect(result.sites.length).toBe(3);

  // Find each site and verify its product_ids
  const testSiteA1 = result.sites.find(s => s.name === 'Enhanced Test Site A1');
  const testSiteA2 = result.sites.find(s => s.name === 'Enhanced Test Site A2');
  const testSiteB1 = result.sites.find(s => s.name === 'Enhanced Test Site B1');

  expect(testSiteA1).toBeDefined();
  expect(testSiteA1.product_ids).toBeDefined();
  expect(Array.isArray(testSiteA1.product_ids)).toBe(true);
  expect(testSiteA1.product_ids.length).toBe(2);
  expect(testSiteA1.product_ids).toContain(product1[0].id);
  expect(testSiteA1.product_ids).toContain(product2[0].id);

  expect(testSiteA2).toBeDefined();
  expect(testSiteA2.product_ids).toBeDefined();
  expect(Array.isArray(testSiteA2.product_ids)).toBe(true);
  expect(testSiteA2.product_ids.length).toBe(2);
  expect(testSiteA2.product_ids).toContain(product2[0].id);
  expect(testSiteA2.product_ids).toContain(product3[0].id);

  expect(testSiteB1).toBeDefined();
  expect(testSiteB1.product_ids).toBeDefined();
  expect(Array.isArray(testSiteB1.product_ids)).toBe(true);
  expect(testSiteB1.product_ids.length).toBe(1);
  expect(testSiteB1.product_ids).toContain(product1[0].id);

  console.log("Enhanced venue structure:", JSON.stringify(result, null, 2));
});
