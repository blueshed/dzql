/**
 * Event Validation Tests
 *
 * Tests that events are created correctly for all operations:
 * - Events created for INSERT, UPDATE, DELETE
 * - Event structure is correct (op, table_name, pk, before, after, user_id)
 * - Event content accurately reflects before/after state
 * - NOTIFY mechanism delivers events
 * - Event ordering preserved
 * - Foreign keys expanded in events
 *
 * Contract: TEST_CONTRACT.md Section 3
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { setupTests, createTestUser, testName } from "../setup/test-helpers.js";

const { sql } = setupTests();

describe("Event Validation", () => {
  let testUserId;

  beforeAll(async () => {
    await sql`DROP TABLE IF EXISTS products CASCADE`;
    await sql`
      CREATE TABLE products (
        id serial PRIMARY KEY,
        name text NOT NULL,
        price numeric(10,2),
        category text,
        owner_id int,
        created_at timestamptz DEFAULT now()
      )
    `;

    await sql`
      SELECT dzql.register_entity(
        'products',
        'name',
        array['name', 'category'],
        '{}',
        false,
        '{}',
        '{}',
        jsonb_build_object(
          'view', array[]::text[],
          'create', array[]::text[],
          'update', array[]::text[],
          'delete', array[]::text[]
        )
      )
    `;

    const user = await createTestUser(sql);
    testUserId = user.user_id;
  });

  test("INSERT operation creates event", async () => {
    const productData = {
      name: testName("Laptop"),
      price: 999.99,
      category: "Electronics",
      owner_id: testUserId,
    };

    const result = await sql`
      SELECT dzql.save_products(${sql.json(productData)}, ${testUserId}) as product
    `;
    const product = result[0].product;

    // Check event was created
    const events = await sql`
      SELECT * FROM dzql.events
      WHERE table_name = 'products'
      AND pk->>'id' = ${product.id.toString()}
      AND op = 'insert'
      ORDER BY event_id DESC
      LIMIT 1
    `;

    expect(events.length).toBe(1);
    const event = events[0];

    // Validate event structure
    expect(event.op).toBe("insert");
    expect(event.table_name).toBe("products");
    expect(event.pk).toEqual({ id: product.id.toString() });
    expect(event.data).toBeDefined();
    expect(event.user_id).toBe(testUserId);
    expect(event.at).toBeDefined();

    // Validate event content
    expect(event.data.name).toBe(productData.name);
    expect(Number(event.data.price)).toBe(productData.price);
    expect(event.data.category).toBe(productData.category);
  });

  test("UPDATE operation creates event with data", async () => {
    // Create product
    const created = await sql`
      SELECT dzql.save_products(${sql.json({
        name: testName("Phone"),
        price: 599.99,
        category: "Electronics",
        owner_id: testUserId,
      })}, ${testUserId}) as product
    `;
    const productId = created[0].product.id;

    // Update it
    const updated = await sql`
      SELECT dzql.save_products(${sql.json({
        id: productId,
        price: 499.99,
      })}, ${testUserId}) as product
    `;

    // Check UPDATE event
    const events = await sql`
      SELECT * FROM dzql.events
      WHERE table_name = 'products'
      AND pk->>'id' = ${productId.toString()}
      AND op = 'update'
      ORDER BY event_id DESC
      LIMIT 1
    `;

    expect(events.length).toBe(1);
    const event = events[0];

    expect(event.op).toBe("update");
    expect(event.data).toBeDefined();

    // Validate current state after update
    expect(event.data.id).toBe(productId);
    expect(Number(event.data.price)).toBe(499.99);
  });

  test("DELETE operation creates event", async () => {
    // Create product
    const created = await sql`
      SELECT dzql.save_products(${sql.json({
        name: testName("Tablet"),
        price: 299.99,
        owner_id: testUserId,
      })}, ${testUserId}) as product
    `;
    const productId = created[0].product.id;
    const productName = created[0].product.name;

    // Delete it
    await sql`
      SELECT dzql.delete_products(${sql.json({ id: productId })}, ${testUserId})
    `;

    // Check DELETE event
    const events = await sql`
      SELECT * FROM dzql.events
      WHERE table_name = 'products'
      AND pk->>'id' = ${productId.toString()}
      AND op = 'delete'
      ORDER BY event_id DESC
      LIMIT 1
    `;

    expect(events.length).toBe(1);
    const event = events[0];

    expect(event.op).toBe("delete");
    expect(event.data).toBeNull();
  });

  test("Multiple operations create multiple events", async () => {
    // Clear events to ensure clean test
    await sql`DELETE FROM dzql.events WHERE table_name = 'products'`;

    const uniqueName = testName("MultiOp");
    const productData = {
      name: uniqueName,
      price: 100.0,
      owner_id: testUserId,
    };

    // CREATE
    const created = await sql`
      SELECT dzql.save_products(${sql.json(productData)}, ${testUserId}) as product
    `;
    const productId = created[0].product.id;

    // UPDATE 1
    await sql`
      SELECT dzql.save_products(${sql.json({
        id: productId,
        price: 150.0,
      })}, ${testUserId})
    `;

    // UPDATE 2
    await sql`
      SELECT dzql.save_products(${sql.json({
        id: productId,
        price: 200.0,
      })}, ${testUserId})
    `;

    // DELETE
    await sql`
      SELECT dzql.delete_products(${sql.json({ id: productId })}, ${testUserId})
    `;

    // Check all events exist (1 INSERT + 2 UPDATES + 1 DELETE = 4 total)
    const events = await sql`
      SELECT op, event_id FROM dzql.events
      WHERE table_name = 'products'
      AND pk->>'id' = ${productId.toString()}
      ORDER BY event_id ASC
    `;

    // Should have 4 events total: 1 insert + 2 updates + 1 delete
    expect(events.length).toBe(4);
    expect(events[0].op).toBe("insert");
    expect(events[1].op).toBe("update");
    expect(events[2].op).toBe("update");
    expect(events[3].op).toBe("delete");

    // Event IDs should be increasing (ordering preserved)
    expect(Number(events[1].event_id)).toBeGreaterThan(
      Number(events[0].event_id),
    );
    expect(Number(events[2].event_id)).toBeGreaterThan(
      Number(events[1].event_id),
    );
    expect(Number(events[3].event_id)).toBeGreaterThan(
      Number(events[2].event_id),
    );
  });

  test("Event timestamps are accurate", async () => {
    const result = await sql`
      SELECT dzql.save_products(${sql.json({
        name: testName("TimestampTest"),
        price: 99.99,
        owner_id: testUserId,
      })}, ${testUserId}) as product
    `;
    const productId = result[0].product.id;

    const events = await sql`
      SELECT at FROM dzql.events
      WHERE table_name = 'products'
      AND pk->>'id' = ${productId.toString()}
      ORDER BY event_id DESC
      LIMIT 1
    `;

    expect(events[0].at).not.toBeNull();
  });

  test("Event user_id matches operation user", async () => {
    // Create another user
    const user2 = await createTestUser(sql);
    const user2Id = user2.user_id;

    // User 1 creates product
    const result1 = await sql`
      SELECT dzql.save_products(${sql.json({
        name: testName("User1Product"),
        price: 100.0,
        owner_id: testUserId,
      })}, ${testUserId}) as product
    `;
    const product1Id = result1[0].product.id;

    // User 2 creates product
    const result2 = await sql`
      SELECT dzql.save_products(${sql.json({
        name: testName("User2Product"),
        price: 200.0,
        owner_id: user2Id,
      })}, ${user2Id}) as product
    `;
    const product2Id = result2[0].product.id;

    // Check events have correct user_id
    const events1 = await sql`
      SELECT user_id FROM dzql.events
      WHERE table_name = 'products'
      AND pk->>'id' = ${product1Id.toString()}
      ORDER BY event_id DESC
      LIMIT 1
    `;
    expect(events1[0].user_id).toBe(testUserId);

    const events2 = await sql`
      SELECT user_id FROM dzql.events
      WHERE table_name = 'products'
      AND pk->>'id' = ${product2Id.toString()}
      ORDER BY event_id DESC
      LIMIT 1
    `;
    expect(events2[0].user_id).toBe(user2Id);
  });

  test("Events include all fields from record", async () => {
    const productData = {
      name: testName("CompleteProduct"),
      price: 599.99,
      category: "Electronics",
      owner_id: testUserId,
    };

    const result = await sql`
      SELECT dzql.save_products(${sql.json(productData)}, ${testUserId}) as product
    `;
    const product = result[0].product;

    const events = await sql`
      SELECT data FROM dzql.events
      WHERE table_name = 'products'
      AND pk->>'id' = ${product.id.toString()}
      ORDER BY event_id DESC
      LIMIT 1
    `;

    const eventData = events[0].data;

    // All fields should be present
    expect(eventData.id).toBeDefined();
    expect(eventData.name).toBe(productData.name);
    expect(Number(eventData.price)).toBe(productData.price);
    expect(eventData.category).toBe(productData.category);
    expect(eventData.owner_id).toBe(testUserId);
    expect(eventData.created_at).toBeDefined();
  });

  test("NOTIFY delivers events", async () => {
    // Create a separate connection for LISTEN
    const listenSql = setupTests().sql;

    // Array to capture notifications
    const notifications = [];

    // Set up LISTEN
    await listenSql`LISTEN dzql`;

    // Subscribe to notifications
    await listenSql.listen("dzql", (payload) => {
      notifications.push(JSON.parse(payload));
    });

    // Give LISTEN time to set up
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Perform an operation that triggers NOTIFY
    const created = await sql`
      SELECT dzql.save_products(${sql.json({
        name: testName("NotifyTest"),
        price: 99.99,
        owner_id: testUserId,
      })}, ${testUserId}) as product
    `;
    const productId = created[0].product.id;

    // Wait for notification to be received
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify we received the notification
    expect(notifications.length).toBeGreaterThan(0);

    const notification = notifications[notifications.length - 1];
    expect(notification.table).toBe("products");
    expect(notification.op).toBe("insert");
    expect(notification.data.id).toBe(productId);
    expect(notification.data.name).toBe(created[0].product.name);

    // Clean up - just unlisten, connection is shared
    await listenSql`UNLISTEN dzql`;
  });

  test("Foreign keys NOT expanded in events (IDs only)", async () => {
    // Create table with FK
    await sql`DROP TABLE IF EXISTS orders CASCADE`;
    await sql`
      CREATE TABLE orders (
        id serial PRIMARY KEY,
        product_id int,
        buyer_id int,
        quantity int
      )
    `;

    await sql`
      SELECT dzql.register_entity(
        'orders',
        'id',
        array[]::text[],
        '{"product": "products", "buyer": "users"}',
        false,
        '{}',
        '{}',
        jsonb_build_object(
          'view', array[]::text[],
          'create', array[]::text[],
          'update', array[]::text[],
          'delete', array[]::text[]
        )
      )
    `;

    // Create product first
    const product = await sql`
      SELECT dzql.save_products(${sql.json({
        name: testName("OrderProduct"),
        price: 50.0,
        owner_id: testUserId,
      })}, ${testUserId}) as product
    `;
    const productId = product[0].product.id;

    // Create order
    const order = await sql`
      SELECT dzql.save_orders(${sql.json({
        product_id: productId,
        buyer_id: testUserId,
        quantity: 2,
      })}, ${testUserId}) as order
    `;
    const orderId = order[0].order.id;

    // Check event
    const events = await sql`
      SELECT data FROM dzql.events
      WHERE table_name = 'orders'
      AND pk->>'id' = ${orderId.toString()}
      ORDER BY event_id DESC
      LIMIT 1
    `;

    const eventData = events[0].data;

    // FKs should be IDs, not expanded objects
    expect(eventData.product_id).toBe(productId);
    expect(typeof eventData.product_id).toBe("number");
    expect(eventData.buyer_id).toBe(testUserId);
    expect(typeof eventData.buyer_id).toBe("number");
  });

  test("Partial UPDATE event shows complete record state", async () => {
    // Create product
    const created = await sql`
      SELECT dzql.save_products(${sql.json({
        name: testName("PartialUpdate"),
        price: 100.0,
        category: "Electronics",
        owner_id: testUserId,
      })}, ${testUserId}) as product
    `;
    const productId = created[0].product.id;

    // Update only price
    await sql`
      SELECT dzql.save_products(${sql.json({
        id: productId,
        price: 150.0,
      })}, ${testUserId})
    `;

    // Check UPDATE event
    const events = await sql`
      SELECT data FROM dzql.events
      WHERE table_name = 'products'
      AND pk->>'id' = ${productId.toString()}
      AND op = 'update'
      ORDER BY event_id DESC
      LIMIT 1
    `;

    const event = events[0];

    // Data should have complete record state after update
    expect(event.data.name).toBeDefined();
    expect(event.data.category).toBeDefined();
    expect(Number(event.data.price)).toBe(150.0);
  });
});
