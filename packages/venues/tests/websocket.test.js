import { test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "zeroql";
import { setupTestServer, teardownTestServer } from "./test-server.js";

let server;

beforeAll(async () => {
  // Create test user for websocket tests
  await sql`
    SELECT register_user('websocket-test@example.com', 'password123')
  `;

  // Start the server using test utility
  server = await setupTestServer(3000);
});

afterAll(async () => {
  await teardownTestServer(server);
  // Clean up test user
  await sql`DELETE FROM users WHERE email = 'websocket-test@example.com'`;
});

test("WebSocket login and basic functionality", async () => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Test timeout - WebSocket connection failed"));
    }, 3000);

    const ws = new WebSocket("ws://localhost:3000/ws");
    let messageId = 0;

    ws.onopen = () => {
      // First login
      const loginMessage = {
        jsonrpc: "2.0",
        method: "login_user",
        params: {
          email: "websocket-test@example.com",
          password: "password123",
        },
        id: ++messageId,
      };
      ws.send(JSON.stringify(loginMessage));
    };

    ws.onmessage = (event) => {
      const response = JSON.parse(event.data);

      // Handle initial 'connected' message (now a JSON-RPC method call)
      if (response.method === "connected") {
        return;
      }

      if (response.id === 1) {
        if (response.result) {
          // Login successful, verify response structure
          expect(response.result.token).toBeDefined();
          expect(response.result.profile).toBeDefined();
          expect(response.result.profile.user_id).toBeDefined();
          expect(response.result.profile.email).toBe(
            "websocket-test@example.com",
          );
          expect(response.result.profile.name).toBe("websocket-test");
          expect(response.result.profile.created_at).toBeDefined();

          // Test a simple authenticated function call
          const profileMessage = {
            jsonrpc: "2.0",
            method: "_profile",
            params: {},
            id: ++messageId,
          };
          ws.send(JSON.stringify(profileMessage));
        } else {
          // Login failed - user doesn't exist
          clearTimeout(timeout);
          reject(
            new Error(
              "Login failed - websocket-test@example.com user does not exist",
            ),
          );
        }
      } else if (response.id === 2) {
        // Profile function response (should fail since _profile is private)
        expect(response.error).toBeDefined();
        expect(response.error.code).toBe(-32601);
        expect(response.error.message).toContain(
          "Cannot call private functions",
        );

        clearTimeout(timeout);
        ws.close();
        resolve();
      } else if (response.error) {
        clearTimeout(timeout);
        reject(new Error(response.error.message));
      }
    };

    ws.onerror = (error) => {
      clearTimeout(timeout);
      reject(error);
    };
  });
});
