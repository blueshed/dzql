import { test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { sql, db } from "dzql";

// Unique prefix for this test run
const PREFIX = `M2M_${Date.now()}`;
let testUserId;
let testOrgId;

beforeAll(async () => {
  // Create test user
  const testEmail = `${PREFIX.toLowerCase()}_user@test.local`;
  await sql`DELETE FROM users WHERE email = ${testEmail}`;

  const userResult = await sql`
    SELECT register_user(${testEmail}, 'password123') as user_data
  `;
  testUserId = userResult[0].user_data.user_id;

  // Create test organisation
  const orgResult = await db.api.save.organisations(
    {
      name: `${PREFIX}_TestOrg`,
      description: "Test org for M2M testing"
    },
    testUserId
  );
  testOrgId = orgResult.id;

  // Make user act for this org
  await sql`
    INSERT INTO acts_for (user_id, org_id, valid_from)
    VALUES (${testUserId}, ${testOrgId}, CURRENT_DATE)
    ON CONFLICT DO NOTHING
  `;
});

beforeEach(async () => {
  // Clean up test brands and tags
  await sql`DELETE FROM brand_tags WHERE brand_id IN (SELECT id FROM brands WHERE name LIKE ${PREFIX + '%'})`;
  await sql`DELETE FROM brands WHERE name LIKE ${PREFIX + '%'}`;
  await sql`DELETE FROM tags WHERE name LIKE ${PREFIX + '%'}`;
});

afterAll(async () => {
  // Final cleanup
  await sql`DELETE FROM brand_tags WHERE brand_id IN (SELECT id FROM brands WHERE org_id = ${testOrgId})`;
  await sql`DELETE FROM brands WHERE org_id = ${testOrgId}`;
  await sql`DELETE FROM tags WHERE name LIKE ${PREFIX + '%'}`;
  await sql`DELETE FROM acts_for WHERE user_id = ${testUserId}`;
  await sql`DELETE FROM organisations WHERE id = ${testOrgId}`;
  await sql`DELETE FROM users WHERE id = ${testUserId}`;
});

test("Create brand without tags", async () => {
  const brandData = {
    org_id: testOrgId,
    name: `${PREFIX}_Brand1`,
    description: "Test brand without tags"
  };

  const result = await db.api.save.brands(brandData, testUserId);

  expect(result).toBeDefined();
  expect(result.id).toBeDefined();
  expect(result.name).toBe(`${PREFIX}_Brand1`);
  expect(result.org_id).toBe(testOrgId);
});

test("Create tags using DZQL API", async () => {
  const tag1 = await db.api.save.tags(
    { name: `${PREFIX}_TestTag1`, color: '#FF0000', description: 'Test tag 1' },
    testUserId
  );

  expect(tag1).toBeDefined();
  expect(tag1.id).toBeDefined();
  expect(tag1.name).toBe(`${PREFIX}_TestTag1`);
  expect(tag1.color).toBe('#FF0000');

  const tag2 = await db.api.save.tags(
    { name: `${PREFIX}_TestTag2`, color: '#00FF00', description: 'Test tag 2' },
    testUserId
  );

  expect(tag2).toBeDefined();
  expect(tag2.id).toBeDefined();
});

test("Create brand with tags (M2M) - single atomic save", async () => {
  // First create some tags
  const tag1 = await db.api.save.tags(
    { name: `${PREFIX}_Tag1`, color: '#FF0000' },
    testUserId
  );
  const tag2 = await db.api.save.tags(
    { name: `${PREFIX}_Tag2`, color: '#00FF00' },
    testUserId
  );
  const tag3 = await db.api.save.tags(
    { name: `${PREFIX}_Tag3`, color: '#0000FF' },
    testUserId
  );

  // Create brand with tags in single call
  const brandData = {
    org_id: testOrgId,
    name: `${PREFIX}_BrandWithTags`,
    description: "Brand with M2M tags",
    tag_ids: [tag1.id, tag2.id, tag3.id]
  };

  const result = await db.api.save.brands(brandData, testUserId);

  expect(result).toBeDefined();
  expect(result.id).toBeDefined();
  expect(result.name).toBe(`${PREFIX}_BrandWithTags`);

  // Check that tag_ids array is returned
  expect(result.tag_ids).toBeDefined();
  expect(Array.isArray(result.tag_ids)).toBe(true);
  expect(result.tag_ids.length).toBe(3);
  expect(result.tag_ids).toContain(tag1.id);
  expect(result.tag_ids).toContain(tag2.id);
  expect(result.tag_ids).toContain(tag3.id);
});

test("Get brand includes tag_ids array", async () => {
  // Create tags
  const tag1 = await db.api.save.tags({ name: `${PREFIX}_GetTag1` }, testUserId);
  const tag2 = await db.api.save.tags({ name: `${PREFIX}_GetTag2` }, testUserId);

  // Create brand with tags
  const brand = await db.api.save.brands(
    {
      org_id: testOrgId,
      name: `${PREFIX}_GetBrand`,
      tag_ids: [tag1.id, tag2.id]
    },
    testUserId
  );

  // Get brand and verify tag_ids are included
  const retrieved = await db.api.get.brands({ id: brand.id }, testUserId);

  expect(retrieved).toBeDefined();
  expect(retrieved.tag_ids).toBeDefined();
  expect(Array.isArray(retrieved.tag_ids)).toBe(true);
  expect(retrieved.tag_ids.length).toBe(2);
  expect(retrieved.tag_ids).toContain(tag1.id);
  expect(retrieved.tag_ids).toContain(tag2.id);
});

test("Update brand tags - add and remove", async () => {
  // Create tags
  const tag1 = await db.api.save.tags({ name: `${PREFIX}_UpdTag1` }, testUserId);
  const tag2 = await db.api.save.tags({ name: `${PREFIX}_UpdTag2` }, testUserId);
  const tag3 = await db.api.save.tags({ name: `${PREFIX}_UpdTag3` }, testUserId);

  // Create brand with tags 1 and 2
  const brand = await db.api.save.brands(
    {
      org_id: testOrgId,
      name: `${PREFIX}_UpdateBrand`,
      tag_ids: [tag1.id, tag2.id]
    },
    testUserId
  );

  expect(brand.tag_ids.length).toBe(2);

  // Update to tags 2 and 3 (remove 1, keep 2, add 3)
  const updated = await db.api.save.brands(
    {
      id: brand.id,
      tag_ids: [tag2.id, tag3.id]
    },
    testUserId
  );

  expect(updated.tag_ids).toBeDefined();
  expect(updated.tag_ids.length).toBe(2);
  expect(updated.tag_ids).not.toContain(tag1.id);
  expect(updated.tag_ids).toContain(tag2.id);
  expect(updated.tag_ids).toContain(tag3.id);
});

test("Update brand tags - remove all with empty array", async () => {
  // Create tags
  const tag1 = await db.api.save.tags({ name: `${PREFIX}_RemTag1` }, testUserId);
  const tag2 = await db.api.save.tags({ name: `${PREFIX}_RemTag2` }, testUserId);

  // Create brand with tags
  const brand = await db.api.save.brands(
    {
      org_id: testOrgId,
      name: `${PREFIX}_RemoveAllBrand`,
      tag_ids: [tag1.id, tag2.id]
    },
    testUserId
  );

  expect(brand.tag_ids.length).toBe(2);

  // Remove all tags with empty array
  const updated = await db.api.save.brands(
    {
      id: brand.id,
      tag_ids: []
    },
    testUserId
  );

  expect(updated.tag_ids).toBeDefined();
  expect(Array.isArray(updated.tag_ids)).toBe(true);
  expect(updated.tag_ids.length).toBe(0);
});

test("Update brand without tag_ids field leaves tags unchanged", async () => {
  // Create tags
  const tag1 = await db.api.save.tags({ name: `${PREFIX}_UnchTag1` }, testUserId);

  // Create brand with tag
  const brand = await db.api.save.brands(
    {
      org_id: testOrgId,
      name: `${PREFIX}_UnchangedBrand`,
      description: "Original description",
      tag_ids: [tag1.id]
    },
    testUserId
  );

  expect(brand.tag_ids.length).toBe(1);

  // Update brand description without touching tag_ids
  const updated = await db.api.save.brands(
    {
      id: brand.id,
      description: "Updated description"
      // tag_ids field omitted
    },
    testUserId
  );

  expect(updated.description).toBe("Updated description");
  expect(updated.tag_ids).toBeDefined();
  expect(updated.tag_ids.length).toBe(1);
  expect(updated.tag_ids).toContain(tag1.id);
});

test("Search brands includes tag_ids in results", async () => {
  // Create tags
  const tag1 = await db.api.save.tags({ name: `${PREFIX}_SearchTag1` }, testUserId);
  const tag2 = await db.api.save.tags({ name: `${PREFIX}_SearchTag2` }, testUserId);

  // Create multiple brands with tags
  await db.api.save.brands(
    {
      org_id: testOrgId,
      name: `${PREFIX}_SearchBrand1`,
      tag_ids: [tag1.id]
    },
    testUserId
  );

  await db.api.save.brands(
    {
      org_id: testOrgId,
      name: `${PREFIX}_SearchBrand2`,
      tag_ids: [tag1.id, tag2.id]
    },
    testUserId
  );

  // Search brands
  const searchResult = await db.api.search.brands(
    { p_filters: { name: { ilike: `${PREFIX}_SearchBrand%` } } },
    testUserId
  );

  expect(searchResult).toBeDefined();
  expect(searchResult.data).toBeDefined();
  expect(Array.isArray(searchResult.data)).toBe(true);
  expect(searchResult.data.length).toBeGreaterThanOrEqual(2);

  // Check that each result has tag_ids
  for (const brand of searchResult.data) {
    expect(brand.tag_ids).toBeDefined();
    expect(Array.isArray(brand.tag_ids)).toBe(true);
  }

  // Check specific brands
  const brand1 = searchResult.data.find(b => b.name === `${PREFIX}_SearchBrand1`);
  expect(brand1.tag_ids.length).toBe(1);

  const brand2 = searchResult.data.find(b => b.name === `${PREFIX}_SearchBrand2`);
  expect(brand2.tag_ids.length).toBe(2);
});

test("Junction table is properly synced", async () => {
  // Create tags
  const tag1 = await db.api.save.tags({ name: `${PREFIX}_JuncTag1` }, testUserId);
  const tag2 = await db.api.save.tags({ name: `${PREFIX}_JuncTag2` }, testUserId);

  // Create brand with tags
  const brand = await db.api.save.brands(
    {
      org_id: testOrgId,
      name: `${PREFIX}_JunctionBrand`,
      tag_ids: [tag1.id, tag2.id]
    },
    testUserId
  );

  // Query junction table directly to verify
  const junctionRows = await sql`
    SELECT * FROM brand_tags
    WHERE brand_id = ${brand.id}
    ORDER BY tag_id
  `;

  expect(junctionRows.length).toBe(2);
  expect(junctionRows[0].tag_id).toBe(tag1.id);
  expect(junctionRows[1].tag_id).toBe(tag2.id);

  // Update to single tag
  await db.api.save.brands(
    {
      id: brand.id,
      tag_ids: [tag2.id]
    },
    testUserId
  );

  // Verify junction table updated
  const updatedRows = await sql`
    SELECT * FROM brand_tags
    WHERE brand_id = ${brand.id}
  `;

  expect(updatedRows.length).toBe(1);
  expect(updatedRows[0].tag_id).toBe(tag2.id);
});

test("Deleting brand cascades to junction table", async () => {
  // Create tag
  const tag = await db.api.save.tags({ name: `${PREFIX}_CascadeTag` }, testUserId);

  // Create brand with tag
  const brand = await db.api.save.brands(
    {
      org_id: testOrgId,
      name: `${PREFIX}_CascadeBrand`,
      tag_ids: [tag.id]
    },
    testUserId
  );

  // Verify junction entry exists
  const beforeDelete = await sql`
    SELECT * FROM brand_tags WHERE brand_id = ${brand.id}
  `;
  expect(beforeDelete.length).toBe(1);

  // Delete brand
  await db.api.delete.brands({ id: brand.id }, testUserId);

  // Verify junction entry was cascade deleted
  const afterDelete = await sql`
    SELECT * FROM brand_tags WHERE brand_id = ${brand.id}
  `;
  expect(afterDelete.length).toBe(0);
});
