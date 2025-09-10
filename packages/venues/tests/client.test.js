import { test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "dzql";
import { setupTestServer, teardownTestServer } from "./test-server.js";

// Import the actual WebSocket manager from client
import { useWs } from "../../dzql/src/client/ws.js";

let server;
let testUser;

beforeAll(async () => {
  // Reset WebSocket manager singleton to ensure clean state
  const ws = useWs();
  ws.reset();

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

test("Client proxy API - end-to-end with real WebSocket", async () => {
  const ws = useWs();
  ws.reset(); // Reset state before test

  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.disconnect();
      reject(new Error("Test timeout - WebSocket operations failed"));
    }, 10000);

    try {
      // Connect to WebSocket
      await ws.connect();

      // Login first
      const loginResult = await ws.api.login_user({
        email: testUser.email,
        password: "password123",
      });

      expect(loginResult.token).toBeDefined();
      expect(loginResult.profile.user_id).toBe(testUser.user_id);

      // Test NEW nested proxy API - get operation
      const orgResult = await ws.api.get.organisations({ id: 1 });
      expect(orgResult).toBeDefined();
      expect(orgResult.id).toBe(1);
      expect(orgResult.name).toBeDefined();

      // Test NEW nested proxy API - lookup operation
      const lookupResult = await ws.api.lookup.organisations({
        p_filter: "Event",
      });
      expect(Array.isArray(lookupResult)).toBe(true);
      expect(lookupResult.length).toBeGreaterThan(0);
      expect(lookupResult[0].label).toContain("Event");

      // Test NEW nested proxy API - search operation
      const searchResult = await ws.api.search.venues({
        p_filters: {},
      });
      expect(searchResult.data).toBeDefined();
      expect(Array.isArray(searchResult.data)).toBe(true);
      expect(searchResult.total).toBeDefined();

      // Test NEW nested proxy API - save operation (create new org)
      const testOrgName = `Proxy Test Org ${Date.now()}`;
      const saveResult = await ws.api.save.organisations({
        name: testOrgName,
        description: "Created via proxy API test",
      });
      expect(saveResult.id).toBeDefined();
      expect(saveResult.name).toBe(testOrgName);

      // Test NEW nested proxy API - get the created org
      const getResult = await ws.api.get.organisations({
        id: saveResult.id,
      });
      expect(getResult.id).toBe(saveResult.id);
      expect(getResult.name).toBe(testOrgName);
      expect(getResult.description).toBe("Created via proxy API test");

      // Test NEW nested proxy API - delete operation
      const deleteResult = await ws.api.delete.organisations({
        id: saveResult.id,
      });
      expect(deleteResult.id).toBe(saveResult.id);

      // Verify deletion worked - should throw error for non-existent record
      try {
        await ws.api.get.organisations({
          id: saveResult.id,
        });
        throw new Error("Should have thrown an error for deleted record");
      } catch (error) {
        expect(error.message).toContain("record not found");
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

test("Client proxy API vs legacy API comparison", async () => {
  const ws = useWs();

  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.disconnect();
      reject(new Error("Test timeout"));
    }, 5000);

    try {
      ws.reset(); // Clean state
      ws.connect();

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
  const ws = useWs();

  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.disconnect();
      reject(new Error("Test timeout"));
    }, 8000);

    try {
      ws.reset(); // Clean state
      ws.connect();

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
  const ws = useWs();

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
  const ws = useWs();

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
  const ws = useWs();

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
  const ws = useWs();

  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.disconnect();
      reject(new Error("Test timeout - real-time events"));
    }, 5000);

    const receivedEvents = [];

    try {
      ws.reset(); // Clean state
      ws.connect();

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
