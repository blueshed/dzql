import { test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { sql, db } from "dzql";

beforeAll(async () => {
  // Domain tables and sample data are created by init_db scripts
  // Verify we can connect and have data
  const result = await sql`SELECT 1 as test`;
  expect(result[0].test).toBe(1);

  // Ensure user 1 has acts_for relationships for test organizations
  // First, check if user 1 exists, if not create it
  await sql`
    INSERT INTO users (id, email, password_hash)
    VALUES (1, 'test@test.com', 'hash')
    ON CONFLICT (id) DO NOTHING
  `;
});

// Clean up test data before each test to avoid conflicts
beforeEach(async () => {
  await sql`DELETE FROM products WHERE name LIKE '%SearchTest%'`;
  await sql`DELETE FROM venues WHERE name LIKE '%SearchTest%'`;
  await sql`DELETE FROM acts_for WHERE org_id IN (SELECT id FROM organisations WHERE name LIKE '%SearchTest%')`;
  await sql`DELETE FROM organisations WHERE name LIKE '%SearchTest%'`;
});

afterAll(async () => {
  // Final cleanup after all tests
  await sql`DELETE FROM products WHERE name LIKE '%SearchTest%'`;
  await sql`DELETE FROM venues WHERE name LIKE '%SearchTest%'`;
  await sql`DELETE FROM acts_for WHERE org_id IN (SELECT id FROM organisations WHERE name LIKE '%SearchTest%')`;
  await sql`DELETE FROM organisations WHERE name LIKE '%SearchTest%'`;
  // Clean up the test user created in beforeAll
  await sql`DELETE FROM users WHERE email = 'test@test.com'`;
});

// ============================================================================
// BASIC FILTERS
// ============================================================================

test("Search with exact match filter", async () => {
  // Use existing data - Madison Square Garden
  const result = await db.api.search.venues(
    {
      filters: { name: "Madison Square Garden" },
    },
    1,
  );

  expect(result).toBeDefined();
  expect(result.data).toBeArray();
  expect(result.data.length).toBe(1);
  expect(result.data[0].name).toBe("Madison Square Garden");
});

test("Search with multiple filters (AND logic)", async () => {
  // Get venues owned by specific org
  const venues = await db.api.search.venues(
    {
      filters: { org_id: 3 },
    },
    1,
  );

  expect(venues.data.length).toBeGreaterThan(0);

  // Now filter further by address
  const result = await db.api.search.venues(
    {
      filters: {
        org_id: 3,
        address: venues.data[0].address,
      },
    },
    1,
  );

  expect(result.data.length).toBe(1);
  expect(result.data[0].org_id).toBe(3);
});

test("Search with null value filter", async () => {
  // Create test venue without description
  const org = await db.api.save.organisations(
    {
      name: "SearchTest Org 1",
    },
    1,
  );

  // Ensure user 1 can act for this org
  await sql`
    INSERT INTO acts_for (user_id, org_id, valid_from)
    VALUES (1, ${org.id}, CURRENT_DATE)
    ON CONFLICT (user_id, org_id, valid_from) DO NOTHING
  `;

  await db.api.save.venues(
    {
      org_id: org.id,
      name: "SearchTest Venue No Desc",
      address: "123 Test St",
    },
    1,
  );

  const result = await db.api.search.venues(
    {
      filters: { description: null },
    },
    1,
  );

  expect(result.data).toBeArray();
  expect(result.data.some((v) => v.name === "SearchTest Venue No Desc")).toBe(
    true,
  );
  expect(result.data.some((v) => v.description === null)).toBe(true);
});

test("Search with not null filter", async () => {
  const result = await db.api.search.venues(
    {
      filters: {
        description: { not_null: true },
      },
    },
    1,
  );

  expect(result.data).toBeArray();
  expect(result.data.every((v) => v.description !== null)).toBe(true);
});

// ============================================================================
// OPERATOR FILTERS
// ============================================================================

test("Search with greater than filter", async () => {
  const result = await db.api.search.products(
    {
      filters: { price: { gt: 2000 } },
    },
    1,
  );

  expect(result.data).toBeArray();
  expect(result.data.every((p) => Number(p.price) > 2000)).toBe(true);
});

test("Search with range filter (gte and lt)", async () => {
  const result = await db.api.search.products(
    {
      filters: {
        price: {
          gte: 500,
          lt: 2000,
        },
      },
    },
    1,
  );

  expect(result.data).toBeArray();
  result.data.forEach((p) => {
    const price = Number(p.price);
    expect(price).toBeGreaterThanOrEqual(500);
    expect(price).toBeLessThan(2000);
  });
});

test("Search with between filter", async () => {
  const result = await db.api.search.products(
    {
      filters: { price: { between: [1000, 3000] } },
    },
    1,
  );

  expect(result.data).toBeArray();
  result.data.forEach((p) => {
    const price = Number(p.price);
    expect(price).toBeGreaterThanOrEqual(1000);
    expect(price).toBeLessThanOrEqual(3000);
  });
});

test("Search with IN array filter", async () => {
  // Get first 2 venue IDs
  const allVenues = await db.api.search.venues({}, 1);
  const targetIds = allVenues.data.slice(0, 2).map((v) => v.id);

  const result = await db.api.search.venues(
    {
      filters: { id: targetIds },
    },
    1,
  );

  expect(result.data.length).toBe(2);
  expect(result.data.every((v) => targetIds.includes(v.id))).toBe(true);
});

test("Search with NOT IN filter", async () => {
  // Get first venue ID
  const allVenues = await db.api.search.venues({}, 1);
  const excludeId = allVenues.data[0].id;

  const result = await db.api.search.venues(
    {
      filters: {
        id: { not_in: [excludeId] },
      },
    },
    1,
  );

  expect(result.data.every((v) => v.id !== excludeId)).toBe(true);
});

// ============================================================================
// TEXT SEARCH
// ============================================================================

test("Text search across searchable fields", async () => {
  const result = await db.api.search.venues(
    {
      filters: { _search: "Madison" },
    },
    1,
  );

  expect(result.data.length).toBeGreaterThan(0);
  // Should find Madison Square Garden
  expect(result.data.some((v) => v.name.includes("Madison"))).toBe(true);
});

test("Case-insensitive text search", async () => {
  const result = await db.api.search.venues(
    {
      filters: { _search: "brooklyn" },
    },
    1,
  );

  expect(result.data.length).toBeGreaterThan(0);
  // Should find Barclays Center in Brooklyn
  expect(
    result.data.some((v) => v.address.toLowerCase().includes("brooklyn")),
  ).toBe(true);
});

test("ILIKE pattern filter", async () => {
  const result = await db.api.search.venues(
    {
      filters: {
        name: { ilike: "%center%" },
      },
    },
    1,
  );

  expect(result.data.length).toBeGreaterThan(0);
  expect(result.data[0].name).toBe("Barclays Center");
});

// ============================================================================
// SORTING
// ============================================================================

test("Sort ascending", async () => {
  const result = await db.api.search.products(
    {
      sort: { field: "price", order: "asc" },
    },
    1,
  );

  const prices = result.data.map((p) => Number(p.price));
  const sortedPrices = [...prices].sort((a, b) => a - b);
  expect(prices).toEqual(sortedPrices);
});

test("Sort descending", async () => {
  const result = await db.api.search.products(
    {
      sort: { field: "price", order: "desc" },
    },
    1,
  );

  const prices = result.data.map((p) => Number(p.price));
  const sortedPrices = [...prices].sort((a, b) => b - a);
  expect(prices).toEqual(sortedPrices);
});

test("Default sort by id when not specified", async () => {
  const result = await db.api.search.venues(
    {
      filters: {},
    },
    1,
  );

  const ids = result.data.map((v) => v.id);
  const sortedIds = [...ids].sort((a, b) => a - b);
  expect(ids).toEqual(sortedIds);
});

// ============================================================================
// PAGINATION
// ============================================================================

test("Pagination with custom limit", async () => {
  const result = await db.api.search.venues(
    {
      page: 1,
      limit: 2,
    },
    1,
  );

  expect(result.page).toBe(1);
  expect(result.limit).toBe(2);
  expect(result.data.length).toBeLessThanOrEqual(2);
  expect(result.total).toBeGreaterThan(0);
});

test("Second page of results", async () => {
  // Get page 1
  const page1 = await db.api.search.products(
    {
      page: 1,
      limit: 2,
    },
    1,
  );

  // Get page 2
  const page2 = await db.api.search.products(
    {
      page: 2,
      limit: 2,
    },
    1,
  );

  expect(page2.page).toBe(2);
  // Ensure different data
  if (page1.data.length > 0 && page2.data.length > 0) {
    expect(page1.data[0].id).not.toBe(page2.data[0].id);
  }
});

test("Pagination with filters", async () => {
  const result = await db.api.search.products(
    {
      filters: { price: { gte: 100 } },
      page: 1,
      limit: 2,
    },
    1,
  );

  expect(result.data.length).toBeLessThanOrEqual(2);
  expect(result.data.every((p) => Number(p.price) >= 100)).toBe(true);
  expect(result.page).toBe(1);
  expect(result.limit).toBe(2);
});

// ============================================================================
// COMPLEX QUERIES
// ============================================================================

test("Multiple filters with text search and sorting", async () => {
  // Create specific test data
  const org = await db.api.save.organisations(
    {
      name: "SearchTest LED Corp",
    },
    1,
  );

  // Ensure user 1 can act for this org
  await sql`
    INSERT INTO acts_for (user_id, org_id, valid_from)
    VALUES (1, ${org.id}, CURRENT_DATE)
    ON CONFLICT (user_id, org_id, valid_from) DO NOTHING
  `;

  await db.api.save.products(
    {
      org_id: org.id,
      name: "SearchTest LED Banner",
      price: 1500,
    },
    1,
  );

  await db.api.save.products(
    {
      org_id: org.id,
      name: "SearchTest LED Display",
      price: 800,
    },
    1,
  );

  const result = await db.api.search.products(
    {
      filters: {
        price: { gte: 100, lt: 3000 },
        _search: "SearchTest LED",
      },
      sort: { field: "price", order: "asc" },
      page: 1,
      limit: 10,
    },
    1,
  );

  expect(result.data).toBeArray();
  expect(result.data.length).toBeGreaterThan(0);

  // Check filters applied
  result.data.forEach((p) => {
    const price = Number(p.price);
    expect(price).toBeGreaterThanOrEqual(100);
    expect(price).toBeLessThan(3000);
    expect(p.name).toContain("SearchTest LED");
  });

  // Check sorting
  const prices = result.data.map((p) => Number(p.price));
  const sortedPrices = [...prices].sort((a, b) => a - b);
  expect(prices).toEqual(sortedPrices);
});

test("All filter types combined", async () => {
  // Use existing data
  const result = await db.api.search.products(
    {
      filters: {
        price: { between: [100, 2000] },
        description: { not_null: true },
      },
      sort: { field: "name", order: "asc" },
      page: 1,
      limit: 20,
    },
    1,
  );

  expect(result.data).toBeArray();

  // Check all filters applied
  result.data.forEach((p) => {
    const price = Number(p.price);
    expect(price).toBeGreaterThanOrEqual(100);
    expect(price).toBeLessThanOrEqual(2000);
    expect(p.description).not.toBeNull();
  });

  // Check sorting by name
  const names = result.data.map((p) => p.name);
  const sortedNames = [...names].sort();
  expect(names).toEqual(sortedNames);
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

test("Invalid column name in filter throws error", async () => {
  // Current behavior: invalid columns throw an error (which is good!)
  try {
    await db.api.search.venues(
      {
        filters: {
          invalid_column: "test",
          name: "Madison Square Garden",
        },
      },
      1,
    );
    // Should not reach here
    expect(true).toBe(false);
  } catch (error) {
    expect(error.message).toContain("Column invalid_column does not exist");
  }
});

test("Invalid operator silently ignored", async () => {
  // Invalid operators within valid columns are still silently ignored
  // (they just don't generate a clause)
  const result = await db.api.search.products(
    {
      filters: {
        price: { invalid_op: 100 },
      },
    },
    1,
  );

  // Should ignore invalid operator and return all results
  expect(result.data).toBeArray();
  expect(result.total).toBeGreaterThan(0);
});

test("Invalid sort field falls back to default", async () => {
  const result = await db.api.search.venues(
    {
      sort: { field: "invalid_field", order: "asc" },
    },
    1,
  );

  // Should fall back to default sort by id
  expect(result.data).toBeArray();
  const ids = result.data.map((v) => v.id);
  const sortedIds = [...ids].sort((a, b) => a - b);
  expect(ids).toEqual(sortedIds);
});

// ============================================================================
// EDGE CASES
// ============================================================================

test("Empty filters returns all records", async () => {
  const result = await db.api.search.organisations(
    {
      filters: {},
    },
    1,
  );

  expect(result.data).toBeArray();
  expect(result.total).toBeGreaterThan(0);
  expect(result.page).toBe(1);
});

test("Search with no matching results", async () => {
  const result = await db.api.search.venues(
    {
      filters: { name: "NonExistentVenue123456789" },
    },
    1,
  );

  expect(result.data).toBeArray();
  expect(result.data.length).toBe(0);
  expect(result.total).toBe(0);
});

test("Mixed valid and invalid filters throws exception", async () => {
  // Should throw exception when any column is invalid
  let error = null;
  try {
    await db.api.search.products(
      {
        filters: {
          price: { gte: 500 }, // Valid
          invalid_field: "test", // Invalid - should throw
        },
      },
      1,
    );
  } catch (e) {
    error = e;
  }

  expect(error).not.toBeNull();
  expect(error.message).toContain("Column invalid_field does not exist");
});

test("Valid filters work correctly", async () => {
  // Test that valid filters still work when no invalid columns present
  const result = await db.api.search.products(
    {
      filters: {
        price: { gte: 500 },
      },
    },
    1,
  );

  expect(result.data).toBeArray();
  expect(result.data.every((p) => Number(p.price) >= 500)).toBe(true);
});
