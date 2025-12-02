/**
 * Test that compiled DELETE operations include full record data in events
 *
 * This is critical for subscription resolution - the event data must contain
 * the FK fields so _affected_documents can determine which subscriptions to update.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { TestDatabase } from "../setup/TestDatabase.js";
import { DZQLCompiler } from "../../packages/dzql/src/compiler/compiler.js";

let db;
let sql;

beforeAll(async () => {
  db = new TestDatabase();
  sql = await db.setup();
});

afterAll(async () => {
  await db.teardown();
});

describe("Compiled DELETE Event Data", () => {
  const testUserId = 1;

  beforeAll(async () => {
    // Create test tables
    await sql`
      CREATE TABLE IF NOT EXISTS test_orgs_compiled (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS test_products_compiled (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        organisation_id INT NOT NULL REFERENCES test_orgs_compiled(id),
        price DECIMAL(10,2) DEFAULT 0
      )
    `;

    // Insert test org
    await sql`
      INSERT INTO test_orgs_compiled (id, name) VALUES (1, 'Test Org')
      ON CONFLICT (id) DO NOTHING
    `;

    // Compile and deploy entity
    const compiler = new DZQLCompiler();
    const entity = {
      name: "test_products_compiled",
      tableName: "test_products_compiled",
      labelField: "name",
      searchableFields: ["name"],
      fkIncludes: { organisation: "test_orgs_compiled" },
      permissionPaths: {},
      notificationPaths: {},
      graphRules: {},
      softDelete: false,
      fieldDefaults: {},
    };

    const result = compiler.compile(entity);

    // Deploy compiled functions
    await sql.unsafe(result.sql);
  });

  afterAll(async () => {
    await sql`DROP FUNCTION IF EXISTS save_test_products_compiled(int, jsonb)`;
    await sql`DROP FUNCTION IF EXISTS get_test_products_compiled(int, int, timestamptz)`;
    await sql`DROP FUNCTION IF EXISTS delete_test_products_compiled(int, int)`;
    await sql`DROP FUNCTION IF EXISTS search_test_products_compiled(int, text, jsonb, int, int, timestamptz)`;
    await sql`DROP FUNCTION IF EXISTS lookup_test_products_compiled(int, text, int)`;
    await sql`DROP TABLE IF EXISTS test_products_compiled`;
    await sql`DROP TABLE IF EXISTS test_orgs_compiled`;
  });

  test("DELETE event contains full record data with FK fields", async () => {
    // Clear events
    await sql`DELETE FROM dzql.events WHERE table_name = 'test_products_compiled'`;

    // Create a product
    const created = await sql`
      SELECT save_test_products_compiled(
        ${testUserId},
        ${sql.json({ name: "Product To Delete", organisation_id: 1, price: 99.99 })}
      ) as product
    `;
    const productId = created[0].product.id;

    // Delete the product using compiled function
    await sql`
      SELECT delete_test_products_compiled(${testUserId}, ${productId})
    `;

    // Get the delete event
    const events = await sql`
      SELECT * FROM dzql.events
      WHERE table_name = 'test_products_compiled'
      AND op = 'delete'
      ORDER BY event_id DESC
      LIMIT 1
    `;

    expect(events.length).toBe(1);
    const event = events[0];

    // The critical assertion: DELETE event must include full record data
    expect(event.data).not.toBeNull();
    expect(event.data.id).toBe(productId);
    expect(event.data.name).toBe("Product To Delete");

    // Most importantly: the FK field must be present for subscription resolution
    expect(event.data.organisation_id).toBe(1);
  });

  test("DELETE event data can be used to resolve affected subscriptions", async () => {
    // Clear events
    await sql`DELETE FROM dzql.events WHERE table_name = 'test_products_compiled'`;

    // Create a product
    const created = await sql`
      SELECT save_test_products_compiled(
        ${testUserId},
        ${sql.json({ name: "Another Product", organisation_id: 1, price: 50.0 })}
      ) as product
    `;
    const productId = created[0].product.id;

    // Delete it
    await sql`
      SELECT delete_test_products_compiled(${testUserId}, ${productId})
    `;

    // Get the delete event
    const events = await sql`
      SELECT * FROM dzql.events
      WHERE table_name = 'test_products_compiled'
      AND op = 'delete'
      ORDER BY event_id DESC
      LIMIT 1
    `;

    const event = events[0];

    // Simulate what the server does: use event data to find affected subscriptions
    // In a real subscribable, _affected_documents would use event.data.organisation_id
    // to find which organisation's subscription needs updating
    expect(event.data.organisation_id).toBe(1);

    // This is what _affected_documents needs to work with
    const affectedOrgId = event.data.organisation_id;
    expect(affectedOrgId).toBeDefined();
    expect(typeof affectedOrgId).toBe("number");
  });
});
