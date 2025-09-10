import { createWebSocketHandlers, verify_jwt_token } from "./ws.js";
import { closeConnections, setupListeners } from "./db.js";
import * as defaultApi from "./api.js";

// Logging utility
const IS_TEST = process.env.NODE_ENV === "test";
function log(...args) {
  if (!IS_TEST) console.log(...args);
}

export default function createServer(options = {}) {
  const {
    port = process.env.PORT || 3000,
    customApi = {},
    routes = {},
    staticPath = null  // No default static path - applications should specify
  } = options;

  // Merge default API with custom API
  const api = { ...defaultApi, ...customApi };

  // Create WebSocket event handlers
  const { broadcast, ...websocketHandlers } = createWebSocketHandlers({
    customHandlers: api,
  });

  // Setup NOTIFY listeners for real-time events
  setupListeners((event) => {
    // Handle single dzql event with filtering
    const { notify_users, ...eventData } = event;

    // Create JSON-RPC notification
    const message = JSON.stringify({
      jsonrpc: "2.0",
      method: `${event.table}:${event.op}`, // e.g., "venues:update"
      params: eventData,
    });

    // Filter based on notify_users (null = broadcast to all)
    if (notify_users && notify_users.length > 0) {
      // Send to specific users only
      broadcast(message, notify_users);
    } else {
      // Send to all connected users
      broadcast(message);
    }
  });

  routes['/health'] = () => new Response("OK", { status: 200 });

  // Create and start the Bun server
  const server = Bun.serve({
    port,
    routes,
    async fetch(req, server) {
      const url = new URL(req.url);

      // WebSocket upgrade path
      if (url.pathname === "/ws") {
        // Extract token from Authorization header or query param
        const auth_header = req.headers.get("Authorization");
        const token =
          auth_header?.replace("Bearer ", "") || url.searchParams.get("token");

        let user_data = null;

        // Verify JWT if provided
        if (token) {
          const payload = await verify_jwt_token(token);
          if (payload) {
            user_data = {
              user_id: payload.user_id,
              email: payload.email,
            };
          }
        }

        // Upgrade to WebSocket (allow anonymous for login/register)
        const success = server.upgrade(req, {
          data: user_data || {},
        });

        if (success) return undefined;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Static file serving (only if staticPath is configured)
      if (staticPath) {
        let filePath = url.pathname;

        // Default to index.html for root or directory requests
        if (!filePath || filePath === "/") {
          filePath = "/index.html";
        }

        const file = Bun.file(`${staticPath}${filePath}`);
        if (await file.exists()) {
          return new Response(file);
        }
      }

      return new Response("Not Found", { status: 404 });
    },

    websocket: websocketHandlers,
  });

  log(`🚀 DZQL server: http://localhost:${port}`);
  log(`   WebSocket endpoint: ws://localhost:${port}/ws`);
  log(`   Environment: ${process.env.NODE_ENV || "development"}`);

  // Add graceful shutdown handling
  const shutdown = async () => {
    console.log("\nShutting down DZQL server...");
    await closeConnections();
  };

  // Return server instance with utilities
  return {
    port,
    server,
    shutdown,
    broadcast
  };
}

// If this file is run directly (not imported), start the server
if (import.meta.main) {
  const server = createServer();

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await server.shutdown();
    process.exit(0);
  });
}
