import { test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "dzql";
import { setupTestServer, teardownTestServer } from "./test-server.js";

// Import the WebSocketManager class to create fresh instances per test
import { WebSocketManager } from "../../dzql/src/client/ws.js";

let server;
let testUser;

beforeAll(async () => {
  // Use a unique email for this test run to avoid conflicts
  const testEmail = `proxy-test-${Date.now()}@example.com`;

  // Clean up any existing test data first
  await sql`DELETE FROM acts_for WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'proxy-test-%@example.com')`;
  await sql`DELETE FROM organisations WHERE name LIKE '%Test%' OR name LIKE '%Event Test%'`;
  await sql`DELETE FROM users WHERE email LIKE 'proxy-test-%@example.com'`;

  // Create test user for websocket tests
  const result = await sql`
    SELECT register_user(${testEmail}, 'password123') as user_data
  `;
  testUser = result[0].user_data;
  testUser.email = testEmail; // Store for use in tests

  // Start the server using test utility
  server = await setupTestServer(3000);
});

afterAll(async () => {
  await teardownTestServer(server);
  // Clean up test user and any test data
  if (testUser) {
    await sql`DELETE FROM acts_for WHERE user_id = ${testUser.user_id}`;
    await sql`DELETE FROM users WHERE id = ${testUser.user_id}`;
  }
  // Also clean up any leftover test data
  await sql`DELETE FROM acts_for WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'proxy-test-%@example.com')`;
  await sql`DELETE FROM organisations WHERE name LIKE '%Test%' OR name LIKE '%Event Test%'`;
  await sql`DELETE FROM users WHERE email LIKE 'proxy-test-%@example.com'`;
});

test("DEBUG: Verify PostgreSQL generic_get raises error for missing record", async () => {
  // Test directly at SQL level to isolate the issue
  try {
    console.log("\n=== POSTGRES DEBUG TEST ===");
    const result = await sql`
      SELECT dzql.generic_get('organisations', '{"id": 999999}'::jsonb, 65) as result
    `;
    console.error("ERROR: PostgreSQL should have raised exception, got:", result);
    throw new Error("PostgreSQL generic_get should raise exception for missing record");
  } catch (error) {
    console.log("PostgreSQL error (expected):", error.message);
    if (error.message.includes("record not found")) {
      console.log("✓ PostgreSQL is correctly raising 'record not found' error");
    } else {
      console.error("✗ PostgreSQL error doesn't mention 'record not found':", error.message);
    }
  }
});

test("DEBUG: Verify generic_exec via SELECT raises error", async () => {
  // Test generic_exec (which is called by the server) to see if it properly raises errors
  try {
    console.log("\n=== GENERIC_EXEC DEBUG TEST ===");
    const result = await sql`
      SELECT dzql.generic_exec('get', 'organisations', '{"id": 999999}'::jsonb, 65) as result
    `;
    console.error("ERROR: generic_exec should have raised exception, got:", result);
    throw new Error("generic_exec should raise exception for missing record");
  } catch (error) {
    console.log("generic_exec error (expected):", error.message);
    if (error.message.includes("record not found")) {
      console.log("✓ generic_exec is correctly raising 'record not found' error");
    } else {
      console.error("✗ generic_exec error doesn't match:", error.message);
    }
  }
});

test("DEBUG: GET non-existent record", async () => {
  const ws = new WebSocketManager();

  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      console.error("\n!!! TIMEOUT: WebSocket GET call never returned !!!");
      console.error("This suggests server is not sending error response back");
      ws.disconnect();
      reject(new Error("GET non-existent record timed out - server not responding"));
    }, 5000);

    try {
      console.log("\n=== DEBUG: GET NON-EXISTENT TEST ===");
      console.log("1. Connecting...");
      await ws.connect();
      console.log("2. Connected!");

      console.log("3. Logging in...");
      await ws.api.login_user({
        email: testUser.email,
        password: "password123",
      });
      console.log("4. Logged in!");

      console.log("5. Attempting GET with invalid ID (999999)...");
      console.log("   (If this hangs, server is not responding to errors)");

      try {
        const result = await ws.api.get.organisations({ id: 999999 });
        console.error("ERROR: Should have thrown but got:", result);
        throw new Error("Should have thrown error for non-existent record");
      } catch (error) {
        console.log("6. Got expected error:", error.message);
        if (!error.message.includes("record not found")) {
          throw new Error(`Wrong error message. Expected "record not found", got: "${error.message}"`);
        }
      }

      clearTimeout(timeout);
      console.log("7. Test passed!");
      ws.cleanDisconnect();
      resolve();
    } catch (error) {
      clearTimeout(timeout);
      console.error("Test failed:", error.message);
      ws.cleanDisconnect();
      reject(error);
    }
  });
});

test("DEBUG: Simple WebSocket connection test", async () => {
  const ws = new WebSocketManager();

  return new Promise(async (resolve, reject) => {
    try {
      console.log("\n=== DEBUG TEST START ===");
      console.log("1. Creating fresh WebSocketManager instance");

      console.log("2. Attempting to connect...");
      await ws.connect();
      console.log("3. Connected successfully!");
      console.log("4. WebSocket state:", ws.getStatus());

      console.log("5. Attempting login...");
      const loginResult = await ws.api.login_user({
        email: testUser.email,
        password: "password123",
      });
      console.log("6. Login successful!");
      console.log("7. Got token:", loginResult.token ? "YES" : "NO");
      console.log("8. User ID:", loginResult.profile.user_id);

      console.log("9. Attempting simple GET...");
      const orgResult = await ws.api.get.organisations({ id: 1 });
      console.log("10. GET successful!");
      console.log("11. Org ID:", orgResult.id);
      console.log("12. Org name:", orgResult.name);

      console.log("13. Cleaning up...");
      ws.cleanDisconnect();
      console.log("14. Disconnected");
      console.log("=== DEBUG TEST END ===\n");

      resolve();
    } catch (error) {
      console.error("\n!!! ERROR in debug test !!!");
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
      console.error("WebSocket status:", ws.getStatus());
      console.error("!!!!!!!!!!!!!!!!!!!!!!\n");
      ws.cleanDisconnect();
      reject(error);
    }
  });
});

test("Client proxy API - end-to-end with real WebSocket", async () => {
  const ws = new WebSocketManager(); // Fresh instance per test

  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      console.error("TIMEOUT: Test did not complete in 10s");
      console.error("WebSocket status:", ws.getStatus());
      ws.disconnect();
      reject(new Error("Test timeout - WebSocket operations failed"));
    }, 10000);

    try {
      // Connect to WebSocket
      console.log("E2E: Connecting...");
      await ws.connect();
      console.log("E2E: Connected!");

      // Login first
      console.log("E2E: Logging in...");
      const loginResult = await ws.api.login_user({
        email: testUser.email,
        password: "password123",
      });
      console.log("E2E: Login successful!");

      expect(loginResult.token).toBeDefined();
      expect(loginResult.profile.user_id).toBe(testUser.user_id);

      // Test NEW nested proxy API - get operation
      console.log("E2E: Testing GET...");
      const orgResult = await ws.api.get.organisations({ id: 1 });
      console.log("E2E: GET successful!");
      expect(orgResult).toBeDefined();
      expect(orgResult.id).toBe(1);
      expect(orgResult.name).toBeDefined();

      // Test NEW nested proxy API - lookup operation
      console.log("E2E: Testing LOOKUP...");
      const lookupResult = await ws.api.lookup.organisations({
        p_filter: "Event",
      });
      console.log("E2E: LOOKUP successful!");
      expect(Array.isArray(lookupResult)).toBe(true);
      expect(lookupResult.length).toBeGreaterThan(0);
      expect(lookupResult[0].label).toContain("Event");

      // Test NEW nested proxy API - search operation
      console.log("E2E: Testing SEARCH...");
      const searchResult = await ws.api.search.venues({
        p_filters: {},
      });
      console.log("E2E: SEARCH successful!");
      expect(searchResult.data).toBeDefined();
      expect(Array.isArray(searchResult.data)).toBe(true);
      expect(searchResult.total).toBeDefined();

      // Test NEW nested proxy API - save operation (create new org)
      console.log("E2E: Testing SAVE (create)...");
      const testOrgName = `Proxy Test Org ${Date.now()}`;
      const saveResult = await ws.api.save.organisations({
        name: testOrgName,
        description: "Created via proxy API test",
      });
      console.log("E2E: SAVE successful! ID:", saveResult.id);
      expect(saveResult.id).toBeDefined();
      expect(saveResult.name).toBe(testOrgName);

      // Test NEW nested proxy API - get the created org
      console.log("E2E: Testing GET created org...");
      const getResult = await ws.api.get.organisations({
        id: saveResult.id,
      });
      console.log("E2E: GET created org successful!");
      expect(getResult.id).toBe(saveResult.id);
      expect(getResult.name).toBe(testOrgName);
      expect(getResult.description).toBe("Created via proxy API test");

      // Test NEW nested proxy API - delete operation
      console.log("E2E: Testing DELETE...");
      const deleteResult = await ws.api.delete.organisations({
        id: saveResult.id,
      });
      console.log("E2E: DELETE successful!");
      expect(deleteResult.id).toBe(saveResult.id);

      // Verify deletion worked - should throw error for non-existent record
      console.log("E2E: Verifying deletion...");
      try {
        const deletionVerifyPromise = ws.api.get.organisations({
          id: saveResult.id,
        });

        // Add a timeout to the deletion verification
        const deletionTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Deletion verification timeout")), 3000)
        );

        await Promise.race([deletionVerifyPromise, deletionTimeout]);
        throw new Error("Should have thrown an error for deleted record");
      } catch (error) {
        console.log("E2E: Got expected error:", error.message);
        expect(error.message).toContain("record not found");
      }
      console.log("E2E: Deletion verified!");

      clearTimeout(timeout);
      console.log("E2E: Test complete, disconnecting...");
      ws.cleanDisconnect();
      console.log("E2E: Disconnected");
      resolve();
    } catch (error) {
      clearTimeout(timeout);
      console.error("E2E ERROR:", error.message);
      console.error("WebSocket status:", ws.getStatus());
      ws.cleanDisconnect();
      reject(error);
    }
  });
});

test("Client proxy API vs legacy API comparison", async () => {
  const ws = new WebSocketManager(); // Fresh instance per test

  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.disconnect();
      reject(new Error("Test timeout"));
    }, 5000);

    try {
      await ws.connect();

      // Wait for connection
      await new Promise((resolve) => {
        const checkConnection = () => {
          if (ws.isConnected()) resolve();
          else setTimeout(checkConnection, 100);
        };
        checkConnection();
      });

      // Login
      await ws.api.login_user({
        email: testUser.email,
        password: "password123",
      });

      // Test both old and new API give same results

      // OLD WAY: Direct WebSocket call
      const legacyResult = await ws.call("dzql.get.organisations", {
        id: 1,
      });

      // NEW WAY: Nested proxy API
      const proxyResult = await ws.api.get.organisations({ id: 1 });

      // Should return identical data
      expect(proxyResult).toEqual(legacyResult);
      expect(proxyResult.id).toBe(1);
      expect(proxyResult.name).toBeDefined();

      // Test lookup comparison
      const legacyLookup = await ws.call("dzql.lookup.organisations", {
        p_filter: "Event",
      });
      const proxyLookup = await ws.api.lookup.organisations({
        p_filter: "Event",
      });

      expect(proxyLookup).toEqual(legacyLookup);
      expect(Array.isArray(proxyLookup)).toBe(true);

      clearTimeout(timeout);
      ws.cleanDisconnect();
      resolve();
    } catch (error) {
      clearTimeout(timeout);
      ws.cleanDisconnect();
      reject(error);
    }
  });
});

test("Client proxy API - all 5 operations work", async () => {
  const ws = new WebSocketManager(); // Fresh instance per test

  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.disconnect();
      reject(new Error("Test timeout"));
    }, 8000);

    try {
      await ws.connect();

      await new Promise((resolve) => {
        const checkConnection = () => {
          if (ws.isConnected()) resolve();
          else setTimeout(checkConnection, 100);
        };
        checkConnection();
      });

      await ws.api.login_user({
        email: testUser.email,
        password: "password123",
      });

      // Test all 5 DZQL operations using NEW proxy API

      // 1. GET
      const getResult = await ws.api.get.organisations({ id: 1 });
      expect(getResult.id).toBe(1);

      // 2. LOOKUP
      const lookupResult = await ws.api.lookup.organisations({
        p_filter: "Event",
      });
      expect(Array.isArray(lookupResult)).toBe(true);

      // 3. SEARCH
      const searchResult = await ws.api.search.venues({
        p_filters: {},
      });
      expect(searchResult.data).toBeDefined();

      // 4. SAVE (create)
      const testName = `All Ops Test ${Date.now()}`;
      const saveResult = await ws.api.save.organisations({
        name: testName,
        description: "Testing all operations",
      });
      expect(saveResult.id).toBeDefined();
      expect(saveResult.name).toBe(testName);

      // 5. DELETE
      const deleteResult = await ws.api.delete.organisations({
        id: saveResult.id,
      });
      expect(deleteResult.id).toBe(saveResult.id);

      clearTimeout(timeout);
      ws.cleanDisconnect();
      resolve();
    } catch (error) {
      clearTimeout(timeout);
      ws.cleanDisconnect();
      reject(error);
    }
  });
});

test("Client proxy API - custom PostgreSQL functions", async () => {
  const ws = new WebSocketManager(); // Fresh instance per test

  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.disconnect();
      reject(new Error("Test timeout - custom function calls failed"));
    }, 5000);

    try {
      await ws.connect();

      // Login first
      await ws.api.login_user({
        email: testUser.email,
        password: "password123",
      });

      // Test calling hello function through proxy
      const helloResult = await ws.api.hello();

      expect(helloResult).toBeObject();
      expect(helloResult.message).toBe("Hello, World!");
      expect(helloResult.from).toBe("PostgreSQL");
      expect(helloResult.user_id).toBe(testUser.user_id);
      expect(helloResult.timestamp).toBeDefined();

      // Test with parameters
      const helloWithName = await ws.api.hello({ name: "DZQL" });

      expect(helloWithName.message).toBe("Hello, DZQL!");
      expect(helloWithName.from).toBe("PostgreSQL");
      expect(helloWithName.user_id).toBe(testUser.user_id);

      // Verify both patterns work
      const directCall = await ws.api.hello({ name: "Direct" });

      expect(directCall.message).toBe("Hello, Direct!");
      expect(directCall.from).toBe("PostgreSQL");

      clearTimeout(timeout);
      ws.cleanDisconnect();
      resolve();
    } catch (error) {
      clearTimeout(timeout);
      ws.cleanDisconnect();
      reject(error);
    }
  });
});

test("Client proxy API - handles non-existent functions", async () => {
  const ws = new WebSocketManager(); // Fresh instance per test

  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.disconnect();
      reject(new Error("Test timeout"));
    }, 5000);

    try {
      await ws.connect();

      // Login first
      await ws.api.login_user({
        email: testUser.email,
        password: "password123",
      });

      // Test calling non-existent function
      try {
        await ws.api.nonExistentFunction();
        reject(new Error("Should have thrown an error"));
      } catch (error) {
        expect(error.message).toContain("Internal error");
      }

      clearTimeout(timeout);
      ws.cleanDisconnect();
      resolve();
    } catch (error) {
      clearTimeout(timeout);
      ws.cleanDisconnect();
      reject(error);
    }
  });
});

test("Client proxy API - Bun function goodbye", async () => {
  const ws = new WebSocketManager(); // Fresh instance per test

  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.disconnect();
      reject(new Error("Test timeout - goodbye function failed"));
    }, 5000);

    try {
      await ws.connect();

      // Login first
      await ws.api.login_user({
        email: testUser.email,
        password: "password123",
      });

      // Test calling goodbye Bun function
      const result = await ws.api.goodbye();

      expect(result).toBeObject();
      expect(result.message).toBe("Goodbye, World!");
      expect(result.from).toBe("Bun");
      expect(result.user_id).toBe(testUser.user_id);

      // Test with parameters
      const withName = await ws.api.goodbye({ name: "DZQL" });

      expect(withName.message).toBe("Goodbye, DZQL!");
      expect(withName.from).toBe("Bun");
      expect(withName.user_id).toBe(testUser.user_id);

      clearTimeout(timeout);
      ws.cleanDisconnect();
      resolve();
    } catch (error) {
      clearTimeout(timeout);
      ws.cleanDisconnect();
      reject(error);
    }
  });
});

test("Client proxy API - real-time events integration", async () => {
  const ws = new WebSocketManager(); // Fresh instance per test

  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.disconnect();
      reject(new Error("Test timeout - real-time events"));
    }, 5000);

    const receivedEvents = [];

    try {
      await ws.connect();

      await new Promise((resolve) => {
        const checkConnection = () => {
          if (ws.isConnected()) resolve();
          else setTimeout(checkConnection, 100);
        };
        checkConnection();
      });

      // Login first
      await ws.api.login_user({
        email: testUser.email,
        password: "password123",
      });

      // Listen for real-time events
      const unsubscribe = ws.onBroadcast((method, params) => {
        receivedEvents.push({ method, params });
      });

      // Create an organisation using NEW proxy API - should trigger event
      const testName = `Event Test Org ${Date.now()}`;
      const saveResult = await ws.api.save.organisations({
        name: testName,
        description: "Should trigger event",
      });

      // Wait a bit for the event to arrive
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have received an insert event
      expect(receivedEvents.length).toBeGreaterThan(0);

      const insertEvent = receivedEvents.find(
        (e) =>
          e.method === "organisations:insert" &&
          e.params.data?.name === testName,
      );

      expect(insertEvent).toBeDefined();
      expect(insertEvent.params.op).toBe("insert");
      expect(insertEvent.params.data.id).toBe(saveResult.id);

      // Clean up
      await ws.api.delete.organisations({ id: saveResult.id });

      unsubscribe();
      clearTimeout(timeout);
      ws.cleanDisconnect();
      resolve();
    } catch (error) {
      clearTimeout(timeout);
      ws.cleanDisconnect();
      reject(error);
    }
  });
});
