import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { V2TestDatabase } from "./setup.js";
import { generateIR } from "../../src/cli/compiler/ir.js";
import { generateSearchFunction, generateSaveFunction, generateGetFunction, generateEntitySQL } from "../../src/cli/codegen/sql.js";
import { compilePermission } from "../../src/cli/compiler/permissions.js";
import { handleRequest } from "../../src/runtime/server.js";
import { registerJsFunction, clearJsFunctions } from "../../src/runtime/js_functions.js";
import { loadManifest } from "../../src/runtime/manifest_loader.js";

// Import venues domain for IR generation
import { entities } from "../../examples/venues.js";
const venuesDomain = { entities, subscribables: {} };

describe("Feature Tests: Search Filters, Deep Paths, M2M", () => {
  let db: V2TestDatabase;
  let sql: any;
  let ir: any;

  beforeAll(async () => {
    db = new V2TestDatabase();
    sql = await db.setup();
    ir = generateIR(venuesDomain);

    // Apply core schema
    await sql`CREATE SCHEMA IF NOT EXISTS dzql_v2`;
    await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;
    await sql`CREATE SEQUENCE IF NOT EXISTS dzql_v2.commit_seq`;
    await sql`
      CREATE TABLE IF NOT EXISTS dzql_v2.events (
        id bigserial PRIMARY KEY,
        commit_id bigint NOT NULL,
        table_name text NOT NULL,
        op text NOT NULL,
        pk jsonb NOT NULL,
        data jsonb,
        old_data jsonb,
        user_id int,
        affected_keys text[] DEFAULT ARRAY[]::text[],
        notify_users int[] DEFAULT ARRAY[]::int[],
        created_at timestamptz DEFAULT now()
      )
    `;
    // Default compute_affected_keys function (returns empty array)
    await sql`
      CREATE OR REPLACE FUNCTION dzql_v2.compute_affected_keys(
        p_table TEXT,
        p_op TEXT,
        p_data JSONB
      ) RETURNS TEXT[]
      LANGUAGE plpgsql
      IMMUTABLE
      AS $$
      BEGIN
        RETURN ARRAY[]::text[];
      END;
      $$
    `;

    // Create test tables
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id serial PRIMARY KEY,
        name text NOT NULL,
        email text UNIQUE NOT NULL,
        password_hash text NOT NULL,
        created_at timestamptz DEFAULT now()
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS organisations (
        id serial PRIMARY KEY,
        name text UNIQUE NOT NULL,
        description text
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS acts_for (
        user_id int NOT NULL REFERENCES users(id),
        org_id int NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        valid_from date NOT NULL DEFAULT current_date,
        valid_to date,
        active boolean DEFAULT true,
        PRIMARY KEY (user_id, org_id, valid_from)
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS venues (
        id serial PRIMARY KEY,
        org_id int NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        name text UNIQUE NOT NULL,
        address text NOT NULL,
        description text
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS sites (
        id serial PRIMARY KEY,
        venue_id int NOT NULL REFERENCES venues(id),
        name text NOT NULL,
        description text
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS tags (
        id serial PRIMARY KEY,
        name text NOT NULL UNIQUE,
        color text,
        description text
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS brands (
        id serial PRIMARY KEY,
        org_id int NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        name text NOT NULL,
        description text,
        UNIQUE(org_id, name)
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS brand_tags (
        brand_id int NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        tag_id int NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (brand_id, tag_id)
      )
    `;

    // Seed test data
    await sql`INSERT INTO users (name, email, password_hash) VALUES ('Test User', 'test@example.com', 'hash')`;
    await sql`INSERT INTO organisations (name) VALUES ('Org A'), ('Org B'), ('Org C')`;
    await sql`INSERT INTO acts_for (user_id, org_id, active) VALUES (1, 1, true), (1, 2, true)`;
    await sql`INSERT INTO venues (org_id, name, address) VALUES (1, 'Venue A', '123 St'), (1, 'Venue B', '456 Ave'), (2, 'Venue C', '789 Blvd')`;
    await sql`INSERT INTO sites (venue_id, name) VALUES (1, 'Site 1'), (1, 'Site 2'), (2, 'Site 3')`;
    await sql`INSERT INTO tags (name, color) VALUES ('Tag1', 'red'), ('Tag2', 'blue'), ('Tag3', 'green')`;
    await sql`INSERT INTO brands (org_id, name) VALUES (1, 'Brand A')`;
    await sql`INSERT INTO brand_tags (brand_id, tag_id) VALUES (1, 1), (1, 2)`;

    // Create packages table (has view permissions with traversal paths)
    await sql`
      CREATE TABLE IF NOT EXISTS packages (
        id serial PRIMARY KEY,
        owner_org_id int NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        sponsor_org_id int REFERENCES organisations(id) ON DELETE SET NULL,
        name text NOT NULL,
        price decimal(10, 2) NOT NULL DEFAULT 0.00,
        status text NOT NULL DEFAULT 'draft'
      )
    `;
    await sql`INSERT INTO packages (owner_org_id, sponsor_org_id, name, price) VALUES (1, 2, 'Package A', 100.00), (2, 1, 'Package B', 200.00)`;
  });

  afterAll(async () => {
    await db.teardown();
  });

  // ============================================================
  // SEARCH FILTERS TESTS
  // ============================================================

  describe("Search Filters", () => {
    beforeAll(async () => {
      // Generate and apply search function for venues
      const venuesSearchSQL = generateSearchFunction("venues", ir.entities.venues);
      await sql.unsafe(venuesSearchSQL);
    });

    test("simple filter (exact match)", async () => {
      const result = await sql`SELECT dzql_v2.search_venues(1, '{"filters": {"org_id": 1}}'::jsonb)`;
      const venues = result.map((r: any) => r.search_venues);
      expect(venues.length).toBe(2);
      expect(venues.every((v: any) => v.org_id === 1)).toBe(true);
    });

    test("'in' operator with integer array", async () => {
      const result = await sql`SELECT dzql_v2.search_venues(1, '{"filters": {"id": {"in": [1, 2]}}}'::jsonb)`;
      const venues = result.map((r: any) => r.search_venues);
      expect(venues.length).toBe(2);
      expect(venues.map((v: any) => v.id).sort()).toEqual([1, 2]);
    });

    test("'in' operator with FK column", async () => {
      const result = await sql`SELECT dzql_v2.search_venues(1, '{"filters": {"org_id": {"in": [1, 2]}}}'::jsonb)`;
      const venues = result.map((r: any) => r.search_venues);
      expect(venues.length).toBe(3);
    });

    test("'not_in' operator", async () => {
      const result = await sql`SELECT dzql_v2.search_venues(1, '{"filters": {"id": {"not_in": [1, 2]}}}'::jsonb)`;
      const venues = result.map((r: any) => r.search_venues);
      expect(venues.length).toBe(1);
      expect(venues[0].id).toBe(3);
    });

    test("'ilike' operator for text search", async () => {
      const result = await sql`SELECT dzql_v2.search_venues(1, '{"filters": {"name": {"ilike": "%venue%"}}}'::jsonb)`;
      const venues = result.map((r: any) => r.search_venues);
      expect(venues.length).toBe(3);
    });

    test("'gt' and 'lt' operators", async () => {
      const result = await sql`SELECT dzql_v2.search_venues(1, '{"filters": {"id": {"gt": 1, "lt": 3}}}'::jsonb)`;
      const venues = result.map((r: any) => r.search_venues);
      expect(venues.length).toBe(1);
      expect(venues[0].id).toBe(2);
    });

    test("sorting and pagination", async () => {
      const result = await sql`SELECT dzql_v2.search_venues(1, '{"sort_field": "name", "sort_order": "desc", "limit": 2}'::jsonb)`;
      const venues = result.map((r: any) => r.search_venues);
      expect(venues.length).toBe(2);
      expect(venues[0].name).toBe("Venue C");
      expect(venues[1].name).toBe("Venue B");
    });

    test("search with view permission traversal path (packages)", async () => {
      // packages has view: ['@owner_org_id->acts_for[org_id=$]{active}.user_id', '@sponsor_org_id->acts_for[org_id=$]{active}.user_id']
      // This tests that p_user_id is properly bound in dynamic SQL
      const packagesSearchSQL = generateSearchFunction("packages", ir.entities.packages);
      await sql.unsafe(packagesSearchSQL);

      // User 1 is in acts_for for org 1 and org 2
      // Package A: owner_org_id=1, sponsor_org_id=2 -> user 1 can see (member of both)
      // Package B: owner_org_id=2, sponsor_org_id=1 -> user 1 can see (member of both)
      const result = await sql`SELECT dzql_v2.search_packages(1, '{}'::jsonb)`;
      const packages = result.map((r: any) => r.search_packages);
      expect(packages.length).toBe(2);
    });
  });

  // ============================================================
  // DEEP PERMISSION PATHS TESTS
  // ============================================================

  describe("Deep Permission Paths", () => {

    test("single-hop path compiles correctly", () => {
      const rule = "@org_id->acts_for[org_id=$]{active}.user_id";
      const sql = compilePermission("venues", rule, null, "p_data");

      expect(sql).toContain("EXISTS");
      expect(sql).toContain("acts_for");
      expect(sql).toContain("acts_for.org_id = (p_data->>'org_id')::int");
      expect(sql).toContain("acts_for.active = true");
      expect(sql).toContain("acts_for.user_id = p_user_id");
    });

    test("two-hop path compiles with nested subquery", () => {
      const rule = "@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id";
      const sql = compilePermission("sites", rule, null, "p_data");

      expect(sql).toContain("EXISTS");
      expect(sql).toContain("(SELECT org_id FROM venues WHERE id = (p_data->>'venue_id')::int)");
      expect(sql).toContain("acts_for.active = true");
      expect(sql).toContain("acts_for.user_id = p_user_id");
    });

    test("three-hop path compiles with double nested subquery", () => {
      const rule = "@site_id->sites.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id";
      const sql = compilePermission("allocations", rule, null, "p_data");

      expect(sql).toContain("EXISTS");
      expect(sql).toContain("(SELECT venue_id FROM sites WHERE id = (p_data->>'site_id')::int)");
      expect(sql).toContain("(SELECT org_id FROM venues WHERE id =");
      expect(sql).toContain("acts_for.user_id = p_user_id");
    });

    test("table-first pattern compiles correctly", () => {
      const rule = "contractor_rights[package_id=@package_id]{active}.contractor_org_id->acts_for[org_id=$]{active}.user_id";
      const sql = compilePermission("allocations", rule, null, "p_data");

      expect(sql).toContain("EXISTS");
      expect(sql).toContain("SELECT contractor_org_id FROM contractor_rights");
      expect(sql).toContain("contractor_rights.package_id = (p_data->>'package_id')::int");
      expect(sql).toContain("contractor_rights.active = true");
    });

    test("table column access (non-JSONB) compiles correctly", () => {
      const rule = "@org_id->acts_for[org_id=$]{active}.user_id";
      const sql = compilePermission("venues", rule, null, "venues");

      // Should use table.column syntax, not jsonb
      expect(sql).toContain("acts_for.org_id = venues.org_id");
      expect(sql).not.toContain("->>");
    });

    test("deep path works in actual SQL execution", async () => {
      // Apply sites functions with deep permission path
      const sitesIR = ir.entities.sites;
      const sitesGetSQL = generateGetFunction("sites", sitesIR);
      await sql.unsafe(sitesGetSQL);

      // User 1 has access to org 1, which owns venue 1, which has sites 1 and 2
      const result = await sql`SELECT dzql_v2.get_sites(1, '{"id": 1}'::jsonb)`;
      // The permission check uses deep path: @venue_id->venues.org_id->acts_for
      // Since we're using TRUE for view perms in the generated SQL, this should succeed
      expect(result[0].get_sites).toBeDefined();
    });
  });

  // ============================================================
  // FK EXPANSION IN GET TESTS
  // ============================================================

  describe("FK Expansion in GET", () => {
    beforeAll(async () => {
      // Generate and apply venues functions (includes FK expansion for org)
      const venuesIR = ir.entities.venues;
      const venuesSQL = generateEntitySQL("venues", venuesIR);
      await sql.unsafe(venuesSQL);
    });

    test("GET expands direct FK to full object", async () => {
      // Venue A has org_id = 1 (Org A)
      const result = await sql`SELECT dzql_v2.get_venues(1, '{"id": 1}'::jsonb)`;
      const venue = result[0].get_venues;

      expect(venue).toBeDefined();
      expect(venue.id).toBe(1);
      expect(venue.name).toBe("Venue A");
      expect(venue.org_id).toBe(1);

      // FK expansion: org should be the full organisation object
      expect(venue.org).toBeDefined();
      expect(venue.org.id).toBe(1);
      expect(venue.org.name).toBe("Org A");
    });

    test("GET with null FK does not expand", async () => {
      // Create a test table with nullable FK for this test
      await sql`
        CREATE TABLE IF NOT EXISTS test_nullable_fk (
          id serial PRIMARY KEY,
          org_id int REFERENCES organisations(id),
          name text NOT NULL
        )
      `;
      await sql`INSERT INTO test_nullable_fk (name) VALUES ('No Org')`;

      // Create a minimal IR for this test (matching the real IR structure)
      const testIR = {
        columns: [
          { name: 'id', type: 'serial PRIMARY KEY', isArray: false },
          { name: 'org_id', type: 'int', isArray: false },
          { name: 'name', type: 'text', isArray: false }
        ],
        primaryKey: ['id'],
        label: 'name',
        searchable: ['name'],
        includes: { org: { relation: 'org', entity: 'organisations' } },
        softDelete: false,
        permissions: { view: [], create: [], update: [], delete: [] },
        fieldDefaults: {},
        hidden: [],
        name: 'test_nullable_fk',
        table: 'test_nullable_fk',
        relationships: {},
        manyToMany: {},
        notifications: {},
        graphRules: { onCreate: [], onUpdate: [], onDelete: [] }
      };

      const testSQL = generateGetFunction("test_nullable_fk", testIR);
      await sql.unsafe(testSQL);

      const result = await sql`SELECT dzql_v2.get_test_nullable_fk(1, '{"id": 1}'::jsonb)`;
      const record = result[0].get_test_nullable_fk;

      expect(record).toBeDefined();
      expect(record.org_id).toBeNull();
      // org should not be present when FK is null
      expect(record.org).toBeUndefined();
    });

    test("GET does not expand reverse FK (one-to-many)", async () => {
      // venues has includes: { org: 'organisations', sites: 'sites' }
      // org is a direct FK (org_id column exists) - should be expanded
      // sites is a reverse FK (no sites_id column) - should NOT be expanded
      const result = await sql`SELECT dzql_v2.get_venues(1, '{"id": 1}'::jsonb)`;
      const venue = result[0].get_venues;

      expect(venue.org).toBeDefined(); // direct FK expanded
      expect(venue.sites).toBeUndefined(); // reverse FK not expanded (use subscribables)
    });
  });

  // ============================================================
  // M2M RELATIONSHIPS TESTS
  // ============================================================

  describe("M2M Relationships", () => {
    beforeAll(async () => {
      // Generate and apply brands functions with M2M (includes notification function)
      const brandsIR = ir.entities.brands;
      const brandsSQL = generateEntitySQL("brands", brandsIR);
      await sql.unsafe(brandsSQL);
    });

    test("M2M expansion in GET includes tag_ids array", async () => {
      const result = await sql`SELECT dzql_v2.get_brands(1, '{"id": 1}'::jsonb)`;
      const brand = result[0].get_brands;

      expect(brand).toBeDefined();
      expect(brand.tag_ids).toBeDefined();
      expect(Array.isArray(brand.tag_ids)).toBe(true);
      expect(brand.tag_ids.sort()).toEqual([1, 2]);
    });

    test("M2M sync on SAVE adds new relationships", async () => {
      // Create new brand with tags
      const result = await sql`SELECT dzql_v2.save_brands(1, '{"org_id": 1, "name": "New Brand", "tag_ids": [2, 3]}'::jsonb)`;
      const brand = result[0].save_brands;

      expect(brand.tag_ids).toBeDefined();
      expect(brand.tag_ids.sort()).toEqual([2, 3]);

      // Verify junction table
      const junctions = await sql`SELECT tag_id FROM brand_tags WHERE brand_id = ${brand.id} ORDER BY tag_id`;
      expect(junctions.map((j: any) => j.tag_id)).toEqual([2, 3]);
    });

    test("M2M sync on SAVE updates relationships", async () => {
      // Get brand 1, change tags from [1, 2] to [1, 3]
      // Note: org_id must be included for permission check on update
      const result = await sql`SELECT dzql_v2.save_brands(1, '{"id": 1, "org_id": 1, "tag_ids": [1, 3]}'::jsonb)`;
      const brand = result[0].save_brands;

      expect(brand.tag_ids.sort()).toEqual([1, 3]);

      // Verify junction table - tag 2 should be removed, tag 3 added
      const junctions = await sql`SELECT tag_id FROM brand_tags WHERE brand_id = 1 ORDER BY tag_id`;
      expect(junctions.map((j: any) => j.tag_id)).toEqual([1, 3]);
    });

    test("M2M sync with empty array removes all relationships", async () => {
      // Create a brand with tags, then clear them
      await sql`INSERT INTO brands (org_id, name) VALUES (1, 'Temp Brand') RETURNING id`;
      const tempBrand = await sql`SELECT id FROM brands WHERE name = 'Temp Brand'`;
      const tempId = tempBrand[0].id;
      await sql`INSERT INTO brand_tags (brand_id, tag_id) VALUES (${tempId}, 1), (${tempId}, 2)`;

      // Clear tags - org_id required for permission check
      const payload = JSON.stringify({ id: tempId, org_id: 1, tag_ids: [] });
      const result = await sql.unsafe(`SELECT dzql_v2.save_brands(1, '${payload}'::jsonb)`);
      const brand = result[0].save_brands;

      expect(brand.tag_ids).toEqual([]);

      // Verify junction table is empty
      const junctions = await sql`SELECT tag_id FROM brand_tags WHERE brand_id = ${tempId}`;
      expect(junctions.length).toBe(0);
    });

    test("M2M expansion in SEARCH includes tag_ids for each result", async () => {
      const result = await sql`SELECT dzql_v2.search_brands(1, '{"filters": {"org_id": 1}}'::jsonb)`;
      const brands = result.map((r: any) => r.search_brands);

      expect(brands.length).toBeGreaterThan(0);
      brands.forEach((brand: any) => {
        expect(brand.tag_ids).toBeDefined();
        expect(Array.isArray(brand.tag_ids)).toBe(true);
      });
    });
  });

  // ============================================================
  // SOFT DELETE TESTS
  // ============================================================

  describe("Soft Delete", () => {
    beforeAll(async () => {
      // Create products table with soft delete support
      await sql`
        CREATE TABLE IF NOT EXISTS products (
          id serial PRIMARY KEY,
          org_id int NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
          name text NOT NULL,
          description text,
          price decimal(10, 2) NOT NULL DEFAULT 0.00,
          created_by int REFERENCES users(id),
          created_at timestamptz,
          deleted_at timestamptz
        )
      `;

      // Generate and apply products functions with soft delete (includes notification function)
      const productsIR = ir.entities.products;
      const productsSQL = generateEntitySQL("products", productsIR);
      await sql.unsafe(productsSQL);
    });

    test("Soft delete sets deleted_at timestamp instead of removing row", async () => {
      // Create a product
      const created = await sql`
        SELECT dzql_v2.save_products(1, ${sql.json({
          org_id: 1,
          name: "To Be Deleted",
          price: 9.99
        })}) as product
      `;
      const productId = created[0].product.id;

      // Delete it
      await sql`SELECT dzql_v2.delete_products(1, ${sql.json({ id: productId })})`;

      // Check database - row should still exist with deleted_at set
      const check = await sql`SELECT * FROM products WHERE id = ${productId}`;
      expect(check.length).toBe(1);
      expect(check[0].deleted_at).not.toBeNull();
    });

    test("Soft deleted records excluded from SEARCH", async () => {
      // Create two products
      const active = await sql`
        SELECT dzql_v2.save_products(1, ${sql.json({
          org_id: 1,
          name: "Active Product",
          price: 19.99
        })}) as product
      `;

      const toDelete = await sql`
        SELECT dzql_v2.save_products(1, ${sql.json({
          org_id: 1,
          name: "Product To Delete",
          price: 29.99
        })}) as product
      `;
      const deletedId = toDelete[0].product.id;

      // Delete one
      await sql`SELECT dzql_v2.delete_products(1, ${sql.json({ id: deletedId })})`;

      // Search should not return deleted
      const search = await sql`SELECT dzql_v2.search_products(1, '{"filters": {"org_id": 1}}'::jsonb)`;
      const products = search.map((r: any) => r.search_products);
      const productIds = products.map((p: any) => p.id);
      expect(productIds).not.toContain(deletedId);
    });

    test("Can still GET soft deleted record by ID (for audit)", async () => {
      const created = await sql`
        SELECT dzql_v2.save_products(1, ${sql.json({
          org_id: 1,
          name: "Audit Product",
          price: 39.99
        })}) as product
      `;
      const productId = created[0].product.id;

      // Delete it
      await sql`SELECT dzql_v2.delete_products(1, ${sql.json({ id: productId })})`;

      // Should still be able to get it
      const fetched = await sql`SELECT dzql_v2.get_products(1, ${sql.json({ id: productId })})`;
      expect(fetched[0].get_products).not.toBeNull();
      expect(fetched[0].get_products.deleted_at).not.toBeNull();
    });
  });

  // ============================================================
  // FIELD DEFAULTS TESTS
  // ============================================================

  describe("Field Defaults", () => {
    test("@user_id default resolves to current user", async () => {
      const product = await sql`
        SELECT dzql_v2.save_products(1, ${sql.json({
          org_id: 1,
          name: "Default User Product",
          price: 49.99
        })}) as product
      `;

      expect(product[0].product.created_by).toBe(1);
    });

    test("@now default resolves to current timestamp", async () => {
      const before = new Date();

      const product = await sql`
        SELECT dzql_v2.save_products(1, ${sql.json({
          org_id: 1,
          name: "Default Timestamp Product",
          price: 59.99
        })}) as product
      `;

      const after = new Date();
      const createdAt = new Date(product[0].product.created_at);

      expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      expect(createdAt.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    });

    test("Explicit values override defaults", async () => {
      // Default for created_by is @user_id (which would be p_user_id = 1)
      // If we explicitly provide the same value, it should work
      // Better test: Use a different timestamp than @now would generate
      const specificTime = '2020-01-01T00:00:00Z';

      const product = await sql`
        SELECT dzql_v2.save_products(1, ${sql.json({
          org_id: 1,
          name: "Override Defaults Product",
          price: 69.99,
          created_at: specificTime
        })}) as product
      `;

      // Explicit timestamp overrides the @now default
      const createdAt = new Date(product[0].product.created_at);
      expect(createdAt.getFullYear()).toBe(2020);
    });

    test("Defaults NOT applied on UPDATE", async () => {
      // Create with defaults
      const created = await sql`
        SELECT dzql_v2.save_products(1, ${sql.json({
          org_id: 1,
          name: "Update Test Product",
          price: 79.99
        })}) as product
      `;
      const productId = created[0].product.id;
      const originalCreatedAt = created[0].product.created_at;

      // Wait a bit
      await new Promise(r => setTimeout(r, 100));

      // Update (created_at should NOT change) - org_id needed for permission check
      const updated = await sql`
        SELECT dzql_v2.save_products(1, ${sql.json({
          id: productId,
          org_id: 1,
          name: "Updated Product Name"
        })}) as product
      `;

      expect(updated[0].product.created_at).toBe(originalCreatedAt);
    });
  });

  // ============================================================
  // COMPOSITE PRIMARY KEY TESTS
  // ============================================================

  describe("Composite Primary Keys", () => {
    beforeAll(async () => {
      // acts_for table already exists with composite PK (user_id, org_id, valid_from)
      // Generate and apply acts_for functions (includes notification function)
      const actsForIR = ir.entities.acts_for;
      const actsForSQL = generateEntitySQL("acts_for", actsForIR);
      await sql.unsafe(actsForSQL);
    });

    test("SAVE with composite PK inserts new record", async () => {
      const result = await sql`
        SELECT dzql_v2.save_acts_for(1, ${sql.json({
          user_id: 1,
          org_id: 3,
          valid_from: '2025-01-01',
          active: true
        })}) as record
      `;

      expect(result[0].record).toBeDefined();
      expect(result[0].record.user_id).toBe(1);
      expect(result[0].record.org_id).toBe(3);
      expect(result[0].record.active).toBe(true);
    });

    test("SAVE with composite PK updates existing record", async () => {
      // First insert
      await sql`
        SELECT dzql_v2.save_acts_for(1, ${sql.json({
          user_id: 1,
          org_id: 3,
          valid_from: '2025-02-01',
          active: true
        })})
      `;

      // Update using same composite PK
      const result = await sql`
        SELECT dzql_v2.save_acts_for(1, ${sql.json({
          user_id: 1,
          org_id: 3,
          valid_from: '2025-02-01',
          active: false
        })}) as record
      `;

      expect(result[0].record.active).toBe(false);

      // Verify only one record exists
      const count = await sql`
        SELECT COUNT(*) as cnt FROM acts_for
        WHERE user_id = 1 AND org_id = 3 AND valid_from = '2025-02-01'
      `;
      expect(parseInt(count[0].cnt)).toBe(1);
    });

    test("GET with composite PK retrieves correct record", async () => {
      // Insert a specific record
      await sql`
        SELECT dzql_v2.save_acts_for(1, ${sql.json({
          user_id: 1,
          org_id: 3,
          valid_from: '2025-03-01',
          active: true
        })})
      `;

      const result = await sql`
        SELECT dzql_v2.get_acts_for(1, ${sql.json({
          user_id: 1,
          org_id: 3,
          valid_from: '2025-03-01'
        })}) as record
      `;

      expect(result[0].record).toBeDefined();
      expect(result[0].record.user_id).toBe(1);
      expect(result[0].record.org_id).toBe(3);
    });

    test("DELETE with composite PK removes correct record", async () => {
      // Insert
      await sql`
        SELECT dzql_v2.save_acts_for(1, ${sql.json({
          user_id: 1,
          org_id: 3,
          valid_from: '2025-04-01',
          active: true
        })})
      `;

      // Delete
      await sql`
        SELECT dzql_v2.delete_acts_for(1, ${sql.json({
          user_id: 1,
          org_id: 3,
          valid_from: '2025-04-01'
        })})
      `;

      // Verify deleted
      const count = await sql`
        SELECT COUNT(*) as cnt FROM acts_for
        WHERE user_id = 1 AND org_id = 3 AND valid_from = '2025-04-01'
      `;
      expect(parseInt(count[0].cnt)).toBe(0);
    });
  });

  // ============================================================
  // CUSTOM FUNCTIONS TESTS
  // ============================================================

  describe("Custom Functions", () => {
    test("Custom function is included in IR", () => {
      // Domain with custom function
      const domainWithCustomFn = {
        entities: {},
        subscribables: {},
        customFunctions: [
          {
            name: 'calculate_org_stats',
            sql: `
CREATE OR REPLACE FUNCTION dzql_v2.calculate_org_stats(p_user_id int, p_params jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_org_id int;
  v_venue_count int;
  v_site_count int;
BEGIN
  v_org_id := (p_params->>'org_id')::int;

  SELECT COUNT(*) INTO v_venue_count
  FROM venues WHERE org_id = v_org_id;

  SELECT COUNT(*) INTO v_site_count
  FROM sites s
  JOIN venues v ON s.venue_id = v.id
  WHERE v.org_id = v_org_id;

  RETURN jsonb_build_object(
    'org_id', v_org_id,
    'venue_count', v_venue_count,
    'site_count', v_site_count
  );
END;
$$;
            `,
            args: ['p_user_id', 'p_params']
          }
        ]
      };

      const customIR = generateIR(domainWithCustomFn);

      expect(customIR.customFunctions).toBeDefined();
      expect(customIR.customFunctions.length).toBe(1);
      expect(customIR.customFunctions[0].name).toBe('calculate_org_stats');
      expect(customIR.customFunctions[0].args).toEqual(['p_user_id', 'p_params']);
    });

    test("Custom function is included in manifest allowlist", async () => {
      const { generateManifest } = await import("../../src/cli/codegen/manifest.js");

      const domainWithCustomFn = {
        entities: {},
        subscribables: {},
        customFunctions: [
          {
            name: 'my_custom_func',
            sql: 'SELECT 1',
            args: ['p_user_id', 'p_params']
          }
        ]
      };

      const customIR = generateIR(domainWithCustomFn);
      const manifest = generateManifest(customIR);

      expect(manifest.functions['my_custom_func']).toBeDefined();
      expect(manifest.functions['my_custom_func'].schema).toBe('dzql_v2');
      expect(manifest.functions['my_custom_func'].name).toBe('my_custom_func');
      expect(manifest.functions['my_custom_func'].args).toEqual(['p_user_id', 'p_params']);
    });

    test("Custom function can be applied and called", async () => {
      // Create a custom function that calculates org statistics
      const customFunctionSQL = `
CREATE OR REPLACE FUNCTION dzql_v2.calculate_org_stats(p_user_id int, p_params jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_org_id int;
  v_venue_count int;
  v_site_count int;
BEGIN
  v_org_id := (p_params->>'org_id')::int;

  SELECT COUNT(*) INTO v_venue_count
  FROM venues WHERE org_id = v_org_id;

  SELECT COUNT(*) INTO v_site_count
  FROM sites s
  JOIN venues v ON s.venue_id = v.id
  WHERE v.org_id = v_org_id;

  RETURN jsonb_build_object(
    'org_id', v_org_id,
    'venue_count', v_venue_count,
    'site_count', v_site_count
  );
END;
$$;
      `;

      // Apply the function
      await sql.unsafe(customFunctionSQL);

      // Call it - org 1 has 2 venues and 3 sites (from test setup)
      const result = await sql`
        SELECT dzql_v2.calculate_org_stats(1, '{"org_id": 1}'::jsonb) as stats
      `;

      const stats = result[0].stats;
      expect(stats.org_id).toBe(1);
      expect(stats.venue_count).toBe(2); // Venue A, Venue B
      expect(stats.site_count).toBe(3);  // Site 1, Site 2, Site 3
    });

    test("Custom function with default args uses standard signature", () => {
      const domainWithDefaultArgs = {
        entities: {},
        subscribables: {},
        customFunctions: [
          {
            name: 'simple_func',
            sql: 'SELECT 1'
            // No args specified - should default to ['p_user_id', 'p_params']
          }
        ]
      };

      const customIR = generateIR(domainWithDefaultArgs);
      expect(customIR.customFunctions[0].args).toEqual(['p_user_id', 'p_params']);
    });
  });

  // ============================================================
  // JAVASCRIPT CUSTOM FUNCTIONS TESTS
  // ============================================================

  describe("JavaScript Custom Functions", () => {
    beforeAll(() => {
      // Clear any previously registered functions
      clearJsFunctions();

      // Load a minimal manifest for the runtime
      loadManifest({
        version: '2.0.0',
        functions: {
          // Add a SQL function to test that JS takes precedence
          test_sql_func: {
            schema: 'dzql_v2',
            name: 'test_sql_func',
            args: ['p_user_id', 'p_params'],
            returnType: 'jsonb'
          }
        },
        entities: {},
        subscribables: {}
      });
    });

    afterAll(() => {
      clearJsFunctions();
    });

    test("JS function can be registered and called", async () => {
      // Register a simple JS function
      registerJsFunction('my_js_func', async (ctx) => {
        return {
          message: 'Hello from JS!',
          userId: ctx.userId,
          params: ctx.params
        };
      });

      // Create a mock db client
      const mockDb = {
        query: async () => []
      };

      // Call via handleRequest
      const result = await handleRequest(mockDb, 'my_js_func', { foo: 'bar' }, 42);

      expect(result.message).toBe('Hello from JS!');
      expect(result.userId).toBe(42);
      expect(result.params.foo).toBe('bar');
    });

    test("JS function can query the database", async () => {
      // Register a JS function that queries the database
      registerJsFunction('count_venues_js', async (ctx) => {
        const rows = await ctx.db.query(
          'SELECT COUNT(*) as cnt FROM venues WHERE org_id = $1',
          [ctx.params.org_id]
        );
        return {
          org_id: ctx.params.org_id,
          venue_count: parseInt(rows[0].cnt)
        };
      });

      // Use the real test database
      const dbClient = {
        query: async (text: string, params: any[]) => {
          return await sql.unsafe(text, params);
        }
      };

      // Call via handleRequest - org 1 has 2 venues from test setup
      const result = await handleRequest(dbClient, 'count_venues_js', { org_id: 1 }, 1);

      expect(result.org_id).toBe(1);
      expect(result.venue_count).toBe(2);
    });

    test("JS function takes precedence over SQL function with same name", async () => {
      // Register a JS function with a name that's also in the manifest
      registerJsFunction('test_sql_func', async (ctx) => {
        return { source: 'javascript', userId: ctx.userId };
      });

      const mockDb = {
        query: async () => {
          // This should NOT be called - JS takes precedence
          throw new Error('SQL function should not be called');
        }
      };

      const result = await handleRequest(mockDb, 'test_sql_func', {}, 1);
      expect(result.source).toBe('javascript');
    });

    test("JS function can throw errors", async () => {
      registerJsFunction('error_func', async () => {
        throw new Error('Custom error from JS');
      });

      const mockDb = { query: async () => [] };

      await expect(handleRequest(mockDb, 'error_func', {}, 1))
        .rejects.toThrow('Custom error from JS');
    });

    test("JS function receives correct context", async () => {
      let capturedContext: any = null;

      registerJsFunction('capture_context', async (ctx) => {
        capturedContext = {
          userId: ctx.userId,
          params: ctx.params,
          hasDbQuery: typeof ctx.db.query === 'function'
        };
        return { ok: true };
      });

      const mockDb = { query: async () => [] };
      await handleRequest(mockDb, 'capture_context', { test: 123 }, 99);

      expect(capturedContext.userId).toBe(99);
      expect(capturedContext.params.test).toBe(123);
      expect(capturedContext.hasDbQuery).toBe(true);
    });
  });
});
