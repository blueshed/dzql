import { test, expect, beforeAll, afterAll, describe } from "bun:test";
import { sql } from "../server/db.js";
import { setupTestServer, teardownTestServer } from "./test-server.js";
import { WebSocketManager } from "../client/ws.js";

describe("ZeroQL Real-time Events", () => {
  let server;
  let client;
  let testOrg;
  let testUser;
  const uniqueId = Date.now();
  const testUserData = {
    email: `events-test-${uniqueId}@example.com`,
    password: "password123",
  };

  beforeAll(async () => {
    // Clean up any existing test data first
    await sql`DELETE FROM users WHERE email LIKE 'events-test-%@example.com'`;
    await sql`DELETE FROM organisations WHERE name LIKE 'Test Event Org%'`;

    // Create a test user directly in the DB
    const userResult =
      await sql`SELECT register_user(${testUserData.email}, ${testUserData.password}) as user_data`;
    testUser = userResult[0].user_data;

    // Start the actual server process
    server = await setupTestServer(3001);

    // Create a client instance and connect
    client = new WebSocketManager();
    await client.connect(server.getWebSocketUrl());

    // Authenticate the client by performing a login
    const loginResult = await client.call("login_user", testUserData);
    expect(loginResult.token).toBeDefined();

    // Create a prerequisite organisation for products to belong to
    testOrg = await client.api.save.organisations({
      name: `Test Event Org ${uniqueId}`,
    });
    expect(testOrg.id).toBeDefined();

    // Ensure the test user can act for this org
    await sql`
      INSERT INTO acts_for (user_id, org_id, valid_from)
      VALUES (${testUser.user_id}, ${testOrg.id}, CURRENT_DATE)
      ON CONFLICT (user_id, org_id, valid_from) DO NOTHING
    `;
  }, 30000);

  afterAll(async () => {
    // Clean up in reverse order to avoid foreign key constraints
    if (testOrg) {
      try {
        await sql`DELETE FROM products WHERE org_id = ${testOrg.id}`;
        await sql`DELETE FROM acts_for WHERE org_id = ${testOrg.id}`;
        await sql`DELETE FROM organisations WHERE id = ${testOrg.id}`;
      } catch (error) {
        console.warn("Cleanup warning:", error.message);
      }
    }

    if (client) {
      client.disconnect();
    }

    await teardownTestServer(server);

    // Clean up test user
    if (testUser) {
      await sql`DELETE FROM acts_for WHERE user_id = ${testUser.user_id}`;
      await sql`DELETE FROM users WHERE id = ${testUser.user_id}`;
    }
  });

  test("save (insert) operation triggers a 'products:insert' event", async () => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.offBroadcast(listener);
        reject(new Error("Test timed out - no products:insert event received"));
      }, 10000);

      const productName = `Test Insert Widget ${Date.now()}`;

      // LISTEN: Set up the event listener before acting
      const listener = (method, params) => {
        // We only care about the specific event for this test
        if (method === "products:insert" && params.data?.name === productName) {
          try {
            // ASSERT: Check the event payload - use correct structure from client.test.js
            expect(params.op).toBe("insert");
            expect(params.table).toBe("products");
            expect(params.data.id).toBeDefined();
            expect(params.data.price).toBe(10.5); // number, not string
            expect(params.data.org_id).toBe(testOrg.id);

            // Clean up and finish the test
            client.offBroadcast(listener);
            clearTimeout(timeout);
            resolve();
          } catch (error) {
            client.offBroadcast(listener);
            clearTimeout(timeout);
            reject(error);
          }
        }
      };
      client.onBroadcast(listener);

      // ACT: Perform the action that should trigger the event
      client.api.save
        .products({
          name: productName,
          price: 10.5,
          org_id: testOrg.id,
        })
        .catch((error) => {
          client.offBroadcast(listener);
          clearTimeout(timeout);
          reject(error);
        });
    });
  });

  test("save (update) operation triggers a 'products:update' event", async () => {
    // Setup for the update test: create a product first
    const originalName = `Product To Be Updated ${Date.now()}`;
    const updatedName = `Product Was Updated ${Date.now()}`;

    const productToUpdate = await client.api.save.products({
      name: originalName,
      price: 20.0,
      org_id: testOrg.id,
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.offBroadcast(listener);
        reject(new Error("Test timed out - no products:update event received"));
      }, 10000);

      // LISTEN: Set up the event listener
      const listener = (method, params) => {
        if (
          method === "products:update" &&
          params.data?.id === productToUpdate.id &&
          params.data?.name === updatedName
        ) {
          try {
            // ASSERT: Check the event payload - use correct structure
            expect(params.op).toBe("update");
            expect(params.table).toBe("products");
            expect(params.data.name).toBe(updatedName);
            expect(params.data.price).toBe(25.75); // number, not string
            expect(params.data.org_id).toBe(testOrg.id);

            client.offBroadcast(listener);
            clearTimeout(timeout);
            resolve();
          } catch (error) {
            client.offBroadcast(listener);
            clearTimeout(timeout);
            reject(error);
          }
        }
      };
      client.onBroadcast(listener);

      // ACT: Perform the update
      client.api.save
        .products({
          id: productToUpdate.id,
          name: updatedName,
          price: 25.75,
        })
        .catch((error) => {
          client.offBroadcast(listener);
          clearTimeout(timeout);
          reject(error);
        });
    });
  });

  test("delete operation triggers a 'products:delete' event", async () => {
    // Setup for the delete test: create a product first
    const productName = `Product To Be Deleted ${Date.now()}`;

    const productToDelete = await client.api.save.products({
      name: productName,
      price: 99.0,
      org_id: testOrg.id,
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.offBroadcast(listener);
        reject(new Error("Test timed out - no products:delete event received"));
      }, 10000);

      // LISTEN: Set up the event listener
      const listener = (method, params) => {
        // For DELETE events, check method and event metadata since data might be null
        if (
          method === "products:delete" &&
          params.table === "products" &&
          params.op === "delete"
        ) {
          try {
            // ASSERT: Check the event payload
            expect(params.op).toBe("delete");
            expect(params.table).toBe("products");
            expect(params.event_id).toBeDefined();

            // Verify deleted record data is included
            expect(params.data).toBeDefined();
            expect(params.data.id).toBe(productToDelete.id);
            expect(params.data.name).toBe(productName);
            expect(params.data.price).toBe(99.0);
            expect(params.data.org_id).toBe(testOrg.id);

            client.offBroadcast(listener);
            clearTimeout(timeout);
            resolve();
          } catch (error) {
            client.offBroadcast(listener);
            clearTimeout(timeout);
            reject(error);
          }
        }
      };
      client.onBroadcast(listener);

      // ACT: Perform the delete
      client.api.delete
        .products({
          id: productToDelete.id,
        })
        .catch((error) => {
          client.offBroadcast(listener);
          clearTimeout(timeout);
          reject(error);
        });
    });
  });
});
