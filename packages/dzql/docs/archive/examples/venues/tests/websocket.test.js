import { test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "dzql";
import { setupTestServer, teardownTestServer } from "./test-server.js";
import { WebSocketManager } from "../../dzql/src/client/ws.js";

let server;
let testUser;

beforeAll(async () => {
  // Create test user for websocket tests
  const result = await sql`
    SELECT register_user('websocket-test@example.com', 'password123') as user_data
  `;
  testUser = result[0].user_data;

  // Start the server using test utility
  server = await setupTestServer(3000);
});

afterAll(async () => {
  await teardownTestServer(server);
  // Clean up test user
  await sql`DELETE FROM users WHERE email = 'websocket-test@example.com'`;
});

test("WebSocket login and basic functionality", async () => {
  const ws = new WebSocketManager();

  try {
    // Connect to WebSocket server
    await ws.connect(server.getWebSocketUrl());

    // Login
    const loginResult = await ws.api.login_user({
      email: "websocket-test@example.com",
      password: "password123",
    });

    // Verify login response structure
    expect(loginResult.token).toBeDefined();
    expect(loginResult.profile).toBeDefined();
    expect(loginResult.profile.user_id).toBeDefined();
    expect(loginResult.profile.email).toBe("websocket-test@example.com");

    // Test DZQL get operation
    const org = await ws.api.get.organisations({ id: 1 });
    expect(org.id).toBe(1);
    expect(org.name).toBe("Event Corp");

    // Clean disconnect
    ws.cleanDisconnect();
  } catch (error) {
    ws.cleanDisconnect();
    throw error;
  }
});
