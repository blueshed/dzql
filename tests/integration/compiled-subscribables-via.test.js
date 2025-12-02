import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestDatabase } from "../setup/TestDatabase.js";
import { compileSubscribablesFromSQL } from "../../packages/dzql/src/compiler/compiler.js";

let db;
let sql;

beforeAll(async () => {
  db = new TestDatabase();
  sql = await db.setup();
});

afterAll(async () => {
  await db.teardown();
});

describe("Compiled Subscribables - Via Relations", () => {
  beforeAll(async () => {
    // Create test schema: organisations -> products -> product_faces -> face_products
    await sql`
      CREATE TABLE IF NOT EXISTS test_organisations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS test_products (
        id SERIAL PRIMARY KEY,
        organisation_id INT REFERENCES test_organisations(id),
        name TEXT NOT NULL
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS test_product_faces (
        id SERIAL PRIMARY KEY,
        product_id INT REFERENCES test_products(id),
        name TEXT NOT NULL
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS test_face_products (
        id SERIAL PRIMARY KEY,
        face_id INT REFERENCES test_product_faces(id),
        linked_product_id INT
      )
    `;

    // Insert test data
    await sql`INSERT INTO test_organisations (id, name) VALUES (1, 'Org One'), (2, 'Org Two') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO test_products (id, organisation_id, name) VALUES
      (1, 1, 'Product A'),
      (2, 1, 'Product B'),
      (3, 2, 'Product C') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO test_product_faces (id, product_id, name) VALUES
      (1, 1, 'Face 1'),
      (2, 1, 'Face 2'),
      (3, 2, 'Face 3') ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO test_face_products (id, face_id, linked_product_id) VALUES
      (1, 1, 2),
      (2, 2, 3) ON CONFLICT DO NOTHING`;

    // Compile and install the subscribable
    const subscribableSQL = `
      SELECT dzql.register_subscribable(
        'test_product_catalogue',
        '{}'::jsonb,
        '{"organisation_id": "int"}'::jsonb,
        'test_organisations',
        '{
          "products": {"entity": "test_products", "foreignKey": "organisation_id"},
          "product_faces": {"entity": "test_product_faces", "via": "test_products.id", "foreignKey": "product_id"},
          "face_products": {"entity": "test_face_products", "via": "test_product_faces.id", "foreignKey": "face_id"}
        }'
      );
    `;

    const compiled = compileSubscribablesFromSQL(subscribableSQL);
    expect(compiled.results).toHaveLength(1);
    expect(compiled.results[0].sql).toBeDefined();

    // Install the compiled functions
    await sql.unsafe(compiled.results[0].sql);
  });

  afterAll(async () => {
    await sql`DROP FUNCTION IF EXISTS test_product_catalogue_can_subscribe(INT, JSONB)`;
    await sql`DROP FUNCTION IF EXISTS get_test_product_catalogue(JSONB, INT)`;
    await sql`DROP FUNCTION IF EXISTS test_product_catalogue_affected_documents(TEXT, TEXT, JSONB, JSONB)`;
    await sql`DROP TABLE IF EXISTS test_face_products CASCADE`;
    await sql`DROP TABLE IF EXISTS test_product_faces CASCADE`;
    await sql`DROP TABLE IF EXISTS test_products CASCADE`;
    await sql`DROP TABLE IF EXISTS test_organisations CASCADE`;
  });

  describe("Query Function - get_test_product_catalogue", () => {
    test("returns root entity", async () => {
      const result = await sql`
        SELECT get_test_product_catalogue('{"organisation_id": 1}'::jsonb, 1) as result
      `;

      const data = result[0].result.data;
      expect(data.test_organisations).toBeDefined();
      expect(data.test_organisations.id).toBe(1);
      expect(data.test_organisations.name).toBe("Org One");
    });

    test("returns direct relation (products)", async () => {
      const result = await sql`
        SELECT get_test_product_catalogue('{"organisation_id": 1}'::jsonb, 1) as result
      `;

      const data = result[0].result.data;
      expect(data.products).toBeDefined();
      expect(data.products).toHaveLength(2);
      expect(data.products.map((p) => p.name).sort()).toEqual([
        "Product A",
        "Product B",
      ]);
    });

    test("returns single-hop via relation (product_faces via products)", async () => {
      const result = await sql`
        SELECT get_test_product_catalogue('{"organisation_id": 1}'::jsonb, 1) as result
      `;

      const data = result[0].result.data;
      expect(data.product_faces).toBeDefined();
      expect(data.product_faces).toHaveLength(3);
      expect(data.product_faces.map((f) => f.name).sort()).toEqual([
        "Face 1",
        "Face 2",
        "Face 3",
      ]);
    });

    test("returns multi-hop via relation (face_products via product_faces via products)", async () => {
      const result = await sql`
        SELECT get_test_product_catalogue('{"organisation_id": 1}'::jsonb, 1) as result
      `;

      const data = result[0].result.data;
      expect(data.face_products).toBeDefined();
      expect(data.face_products).toHaveLength(2);
    });

    test("returns embedded schema with scopeTables", async () => {
      const result = await sql`
        SELECT get_test_product_catalogue('{"organisation_id": 1}'::jsonb, 1) as result
      `;

      const schema = result[0].result.schema;
      expect(schema).toBeDefined();
      expect(schema.root).toBe("test_organisations");
      expect(schema.scopeTables).toContain("test_organisations");
      expect(schema.scopeTables).toContain("test_products");
      expect(schema.scopeTables).toContain("test_product_faces");
      expect(schema.scopeTables).toContain("test_face_products");
    });

    test("returns embedded schema with paths mapping", async () => {
      const result = await sql`
        SELECT get_test_product_catalogue('{"organisation_id": 1}'::jsonb, 1) as result
      `;

      const schema = result[0].result.schema;
      expect(schema.paths).toBeDefined();
      expect(schema.paths.test_organisations).toBe(".");
      expect(schema.paths.test_products).toBe("products");
      expect(schema.paths.test_product_faces).toBe("product_faces");
      expect(schema.paths.test_face_products).toBe("face_products");
    });

    test("does not return data from other organisations", async () => {
      const result = await sql`
        SELECT get_test_product_catalogue('{"organisation_id": 2}'::jsonb, 1) as result
      `;

      const data = result[0].result.data;
      expect(data.products).toHaveLength(1);
      expect(data.products[0].name).toBe("Product C");
      // Org 2 has no faces or face_products
      expect(data.product_faces).toBeNull();
      expect(data.face_products).toBeNull();
    });
  });

  describe("Affected Documents - Direct Relations", () => {
    test("root entity change returns correct params", async () => {
      const result = await sql`
        SELECT test_product_catalogue_affected_documents(
          'test_organisations',
          'UPDATE',
          '{"id": 1}'::jsonb,
          '{"id": 1}'::jsonb
        ) as affected
      `;

      expect(result[0].affected).toHaveLength(1);
      expect(result[0].affected[0].organisation_id).toBe(1);
    });

    test("direct relation (products) change returns correct params", async () => {
      const result = await sql`
        SELECT test_product_catalogue_affected_documents(
          'test_products',
          'INSERT',
          '{"id": 4, "organisation_id": 1}'::jsonb,
          '{"id": 4, "organisation_id": 1}'::jsonb
        ) as affected
      `;

      expect(result[0].affected).toHaveLength(1);
      expect(result[0].affected[0].organisation_id).toBe(1);
    });
  });

  describe("Affected Documents - Single-hop Via Relations", () => {
    test("product_faces change traverses via products to find organisation", async () => {
      const result = await sql`
        SELECT test_product_catalogue_affected_documents(
          'test_product_faces',
          'INSERT',
          '{"id": 4, "product_id": 1}'::jsonb,
          '{"id": 4, "product_id": 1}'::jsonb
        ) as affected
      `;

      expect(result[0].affected).toHaveLength(1);
      expect(result[0].affected[0].organisation_id).toBe(1);
    });

    test("product_faces for different org returns correct params", async () => {
      const result = await sql`
        SELECT test_product_catalogue_affected_documents(
          'test_product_faces',
          'INSERT',
          '{"id": 5, "product_id": 3}'::jsonb,
          '{"id": 5, "product_id": 3}'::jsonb
        ) as affected
      `;

      expect(result[0].affected).toHaveLength(1);
      expect(result[0].affected[0].organisation_id).toBe(2);
    });
  });

  describe("Affected Documents - Multi-hop Via Relations", () => {
    test("face_products change traverses via product_faces -> products to find organisation", async () => {
      const result = await sql`
        SELECT test_product_catalogue_affected_documents(
          'test_face_products',
          'INSERT',
          '{"id": 3, "face_id": 1}'::jsonb,
          '{"id": 3, "face_id": 1}'::jsonb
        ) as affected
      `;

      expect(result[0].affected).toHaveLength(1);
      expect(result[0].affected[0].organisation_id).toBe(1);
    });

    test("face_products for face on different product returns correct org", async () => {
      const result = await sql`
        SELECT test_product_catalogue_affected_documents(
          'test_face_products',
          'UPDATE',
          '{"id": 2, "face_id": 3}'::jsonb,
          '{"id": 2, "face_id": 3}'::jsonb
        ) as affected
      `;

      expect(result[0].affected).toHaveLength(1);
      expect(result[0].affected[0].organisation_id).toBe(1);
    });
  });

  describe("Affected Documents - Unrelated Tables", () => {
    test("unrelated table returns empty array", async () => {
      const result = await sql`
        SELECT test_product_catalogue_affected_documents(
          'users',
          'INSERT',
          '{"id": 1}'::jsonb,
          '{"id": 1}'::jsonb
        ) as affected
      `;

      expect(result[0].affected).toHaveLength(0);
    });
  });
});
