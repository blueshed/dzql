import { SignJWT, jwtVerify } from "jose";
import {
  callAuthFunction,
  callUserFunction,
  getUserProfile,
  db,
} from "./db.js";

// Environment configuration
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "dev-secret-at-least-32-chars-long!!",
);

// Logging utility
const IS_TEST = process.env.NODE_ENV === "test";
function log(...args) {
  if (!IS_TEST) console.log(...args);
}
function logError(...args) {
  if (!IS_TEST) console.error(...args);
}

// JWT helpers
export async function create_jwt(payload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(JWT_SECRET);
}

export async function verify_jwt_token(token) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload;
  } catch (error) {
    return null;
  }
}

// JSON-RPC helpers
export function create_rpc_response(id, result) {
  return JSON.stringify({
    jsonrpc: "2.0",
    result,
    id,
  });
}

export function create_rpc_error(id, code, message, data = null) {
  return JSON.stringify({
    jsonrpc: "2.0",
    error: { code, message, data },
    id,
  });
}

// Create RPC handler function
export function createRPCHandler(customHandlers = {}) {
  return async function handle_rpc(ws, message) {
    let id = null;

    try {
      const { method, params, id: request_id } = JSON.parse(message);
      id = request_id;

      // Validate method doesn't start with underscore (private)
      if (method.startsWith("_")) {
        return create_rpc_error(id, -32601, "Cannot call private functions");
      }

      // Handle DZQL operations (require auth, identifiable by signature)
      if (method.startsWith("dzql.")) {
        if (!ws.data.user_id) {
          return create_rpc_error(id, -32603, "Not authenticated");
        }

        const [, operation, entity] = method.split(".");
        if (!operation || !entity) {
          return create_rpc_error(
            id,
            -32602,
            "Invalid DZQL method format. Use: dzql.operation.entity",
          );
        }

        if (
          !["get", "save", "delete", "lookup", "search"].includes(operation)
        ) {
          return create_rpc_error(
            id,
            -32602,
            `Unknown DZQL operation: ${operation}`,
          );
        }

        const result = await db.api[operation][entity](
          params || {},
          ws.data.user_id,
        );
        return create_rpc_response(id, result);
      }

      // Local API functions that don't require auth
      if (method === "login_user") {
        const data = await callAuthFunction(
          "login_user",
          params.email,
          params.password,
        );

        // On successful auth, set user_id on WebSocket connection
        if (data && data.user_id) {
          ws.data.user_id = data.user_id;

          // Create JWT token for client storage
          const token = await create_jwt({
            user_id: data.user_id,
            email: data.email,
          });

          // Get full profile
          const profile = await getUserProfile(data.user_id);

          return create_rpc_response(id, {
            user_id: data.user_id,
            email: data.email,
            token,
            profile,
          });
        }

        return create_rpc_response(id, data);
      }

      if (method === "register_user") {
        const data = await callAuthFunction(
          "register_user",
          params.email,
          params.password,
        );

        // On successful registration, set user_id on WebSocket connection
        if (data && data.user_id) {
          ws.data.user_id = data.user_id;

          // Create JWT token for client storage
          const token = await create_jwt({
            user_id: data.user_id,
            email: data.email,
          });

          return create_rpc_response(id, {
            user_id: data.user_id,
            email: data.email,
            token,
            profile: data,
          });
        }

        return create_rpc_response(id, data);
      }

      // Everything else requires authentication
      if (!ws.data.user_id) {
        return create_rpc_error(id, -32603, "Not authenticated");
      }

      // Authenticated-only local functions
      if (method === "logout") {
        ws.data.user_id = null;
        return create_rpc_response(id, { success: true });
      }

      // Check for custom handlers
      if (customHandlers[method]) {
        const result = await customHandlers[method](ws.data.user_id, params);
        return create_rpc_response(id, result);
      }

      // Call stored function with user_id as first parameter
      const result = await callUserFunction(method, ws.data.user_id, params);
      return create_rpc_response(id, result);
    } catch (error) {
      logError("RPC error:", error);

      // PostgreSQL error codes
      if (error.code) {
        return create_rpc_error(id, -32603, String(error), {
          code: error.code,
        });
      }

      // Generic error
      return create_rpc_error(id, -32603, "Internal error", {
        message: error.message,
      });
    }
  };
}

// Create WebSocket event handlers
export function createWebSocketHandlers(options = {}) {
  const {
    rpcHandler = null,
    customHandlers = {},
    onConnection = null,
    onDisconnection = null,
  } = options;

  // Active WebSocket connections
  const connections = new Map();

  // Create RPC handler if not provided
  const handler = rpcHandler || createRPCHandler(customHandlers);

  // Create broadcaster function
  const broadcast = createBroadcaster(connections);

  return {
    connections,
    broadcast,
    // Connection opened
    async open(ws) {
      const id = crypto.randomUUID();
      ws.data.connection_id = id;
      connections.set(id, ws);

      log(
        `WebSocket connected: ${id}`,
        ws.data.user_id ? `(user: ${ws.data.user_id})` : "(anonymous)",
      );

      // Get full profile if authenticated
      let profile = null;
      if (ws.data.user_id) {
        try {
          profile = await getUserProfile(ws.data.user_id);
        } catch (error) {
          logError("Failed to load profile:", error);
        }
      }

      // Send welcome message as JSON-RPC method call
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "connected",
          params: {
            connection_id: id,
            authenticated: !!ws.data.user_id,
            profile,
          },
        }),
      );

      // Call custom connection handler
      if (onConnection) {
        onConnection(ws, id);
      }
    },

    // Message received
    async message(ws, message) {
      const response = await handler(ws, message);
      ws.send(response);
    },

    // Connection closed
    close(ws) {
      const id = ws.data.connection_id;
      connections.delete(id);
      log(`WebSocket disconnected: ${id}`);

      // Call custom disconnection handler
      if (onDisconnection) {
        onDisconnection(ws, id);
      }
    },

    // Error occurred
    error(ws, error) {
      logError(`WebSocket error for ${ws.data.connection_id}:`, error);
    },
  };
}

// Broadcast message to all authenticated connections or specific client_ids
export function createBroadcaster(connections) {
  return function broadcastToConnections(message, client_ids = null) {
    if (client_ids && Array.isArray(client_ids)) {
      // Send to specific user_ids
      for (const [id, ws] of connections) {
        if (ws.data.user_id && client_ids.includes(ws.data.user_id)) {
          ws.send(message);
        }
      }
    } else {
      // Send to all authenticated connections
      for (const [id, ws] of connections) {
        if (ws.data.user_id) {
          ws.send(message);
        }
      }
    }
  };
}

// Legacy export for backward compatibility
export function broadcastToConnections(connections, message) {
  // Send to all authenticated connections
  for (const [id, ws] of connections) {
    if (ws.data.user_id) {
      ws.send(message);
    }
  }
}
