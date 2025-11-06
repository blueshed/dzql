import { createWebSocketHandlers, verify_jwt_token } from "./ws.js";
import { closeConnections, setupListeners, sql, db } from "./db.js";
import * as defaultApi from "./api.js";
import { serverLogger, notifyLogger } from "./logger.js";

// Re-export commonly used utilities
export { sql, db } from "./db.js";
export { metaRoute } from "./meta-route.js";
export { createMCPRoute } from "./mcp.js";

/**
 * Create a DZQL server with WebSocket support, real-time updates, and automatic CRUD operations
 *
 * Sets up a Bun server with:
 * - WebSocket endpoint at /ws for real-time communication
 * - JSON-RPC 2.0 protocol for API calls
 * - PostgreSQL NOTIFY/LISTEN for real-time broadcasts
 * - Automatic JWT authentication
 * - Health check endpoint at /health
 *
 * @param {Object} [options={}] - Server configuration options
 * @param {number} [options.port=3000] - Port number to listen on (or process.env.PORT)
 * @param {Object} [options.customApi={}] - Custom Bun functions to expose via WebSocket API
 *   Each function receives (userId, params) and can return any JSON-serializable value
 * @param {Object} [options.routes={}] - Additional HTTP routes as { path: handlerFunction }
 * @param {string|null} [options.staticPath=null] - Path to static files directory for serving
 * @param {Function} [options.onReady=null] - Callback invoked after server initialization
 *   Receives { broadcast, routes } to allow dynamic route setup
 *
 * @returns {Object} Server instance with the following properties:
 * @returns {number} .port - The port number the server is listening on
 * @returns {Object} .server - The underlying Bun.Server instance
 * @returns {Function} .shutdown - Async function to gracefully shutdown server and close DB connections
 * @returns {Function} .broadcast - Function to send messages to connected WebSocket clients
 *   Signature: broadcast(message: string, userIds?: number[])
 *   If userIds provided, sends only to those users; otherwise broadcasts to all authenticated users
 *
 * @example
 * // Basic server
 * import { createServer } from 'dzql';
 *
 * const server = createServer({ port: 3000 });
 *
 * @example
 * // Server with custom API functions
 * import { createServer, db } from 'dzql';
 *
 * const server = createServer({
 *   port: 3000,
 *   customApi: {
 *     async getVenueStats(userId, params) {
 *       const { venueId } = params;
 *       return db.api.get.venues({ id: venueId }, userId);
 *     }
 *   }
 * });
 *
 * // Client can call: await ws.api.getVenueStats({ venueId: 1 })
 *
 * @example
 * // Server with static files and custom routes
 * const server = createServer({
 *   port: 3000,
 *   staticPath: './public',
 *   routes: {
 *     '/api/health': () => new Response(JSON.stringify({ status: 'ok' }))
 *   }
 * });
 *
 * @example
 * // Server with onReady callback for dynamic setup
 * const server = createServer({
 *   onReady: ({ broadcast, routes }) => {
 *     // Add routes dynamically
 *     routes['/api/notify'] = (req) => {
 *       broadcast(JSON.stringify({ method: 'alert', params: { msg: 'Hello!' } }));
 *       return new Response('Sent');
 *     };
 *   }
 * });
 */
export function createServer(options = {}) {
  const {
    port = process.env.PORT || 3000,
    customApi = {},
    routes = {},
    staticPath = null,  // No default static path - applications should specify
    onReady = null      // Optional callback that receives { broadcast, server } after initialization
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
      notifyLogger.debug(`Broadcasting ${event.table}:${event.op} to ${notify_users.length} users`);
      broadcast(message, notify_users);
    } else {
      // Send to all connected users
      notifyLogger.debug(`Broadcasting ${event.table}:${event.op} to all users`);
      broadcast(message);
    }
  });

  routes['/health'] = () => new Response("OK", { status: 200 });

  // Call onReady callback if provided to allow dynamic route setup
  if (onReady && typeof onReady === 'function') {
    const additionalRoutes = onReady({ broadcast, routes });
    if (additionalRoutes && typeof additionalRoutes === 'object') {
      Object.assign(routes, additionalRoutes);
    }
  }

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

  serverLogger.info(`🚀 DZQL server started`);
  serverLogger.info(`   HTTP: http://localhost:${port}`);
  serverLogger.info(`   WebSocket: ws://localhost:${port}/ws`);
  serverLogger.info(`   Environment: ${process.env.NODE_ENV || "development"}`);
  serverLogger.info(`   WS Ping Interval: ${process.env.WS_PING_INTERVAL || 30000}ms (Heroku safe: <55s)`);

  // Add graceful shutdown handling
  const shutdown = async () => {
    serverLogger.info("Shutting down DZQL server...");
    await closeConnections();
    serverLogger.info("Server shutdown complete");
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
