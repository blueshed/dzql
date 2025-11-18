import { SignJWT, jwtVerify } from "jose";
import {
  callAuthFunction,
  callUserFunction,
  getUserProfile,
  db,
} from "./db.js";
import { wsLogger, authLogger } from "./logger.js";
import {
  registerSubscription,
  unregisterSubscription,
  unregisterSubscriptionByParams,
  removeConnectionSubscriptions
} from "./subscriptions.js";

// Environment configuration
const JWT_SECRET_STRING = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

// WebSocket ping/pong configuration (important for Heroku and other platforms)
// Heroku terminates WebSocket connections after 55 seconds of inactivity (H15 error)
// Default 30s interval keeps connections alive well within that limit
const WS_PING_INTERVAL = parseInt(process.env.WS_PING_INTERVAL || "30000", 10); // 30 seconds default
const WS_PING_TIMEOUT = parseInt(process.env.WS_PING_TIMEOUT || "5000", 10);    // 5 seconds default
const WS_MAX_MESSAGE_SIZE = parseInt(process.env.WS_MAX_MESSAGE_SIZE || "1048576", 10); // 1MB default

// Validate JWT_SECRET in production
if (process.env.NODE_ENV === "production" && !JWT_SECRET_STRING) {
  throw new Error(
    "JWT_SECRET environment variable is required in production. Generate one with: openssl rand -base64 32"
  );
}

// Warn if using default secret in development
if (!JWT_SECRET_STRING && process.env.NODE_ENV !== "test") {
  console.warn(
    "⚠️  WARNING: Using default JWT secret. Set JWT_SECRET environment variable for security."
  );
}

const JWT_SECRET = new TextEncoder().encode(
  JWT_SECRET_STRING || "dev-secret-at-least-32-chars-long!!"
);

// JWT helpers
export async function create_jwt(payload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
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

// SID (Session ID) Promise Management for bidirectional client-server communication
// Used for async operations where server requests data from client
const sidPromises = new Map();

/**
 * Create a promise with a unique SID that can be resolved/rejected later
 * @param {number} timeout - Timeout in milliseconds (default: 30000)
 * @returns {Object} - { sid, promise }
 */
export function createSIDPromise(timeout = 30000) {
  const sid = crypto.randomUUID();

  const promise = new Promise((resolve, reject) => {
    // Store resolve/reject functions
    sidPromises.set(sid, { resolve, reject });

    // Set timeout
    const timer = setTimeout(() => {
      if (sidPromises.has(sid)) {
        sidPromises.delete(sid);
        reject(new Error(`SID request timeout after ${timeout}ms`));
      }
    }, timeout);

    // Store timer so it can be cleared on resolution
    const entry = sidPromises.get(sid);
    if (entry) {
      entry.timer = timer;
    }
  });

  return { sid, promise };
}

/**
 * Resolve a pending SID promise with a result
 * @param {string} sid - The session ID
 * @param {any} result - The result to resolve with
 * @returns {boolean} - True if SID was found and resolved
 */
export function resolveSID(sid, result) {
  const entry = sidPromises.get(sid);
  if (!entry) {
    wsLogger.warn(`Attempted to resolve unknown SID: ${sid}`);
    return false;
  }

  clearTimeout(entry.timer);
  sidPromises.delete(sid);
  entry.resolve(result);
  wsLogger.debug(`SID resolved: ${sid}`);
  return true;
}

/**
 * Reject a pending SID promise with an error
 * @param {string} sid - The session ID
 * @param {Error|string} error - The error to reject with
 * @returns {boolean} - True if SID was found and rejected
 */
export function rejectSID(sid, error) {
  const entry = sidPromises.get(sid);
  if (!entry) {
    wsLogger.warn(`Attempted to reject unknown SID: ${sid}`);
    return false;
  }

  clearTimeout(entry.timer);
  sidPromises.delete(sid);
  entry.reject(typeof error === 'string' ? new Error(error) : error);
  wsLogger.debug(`SID rejected: ${sid}`);
  return true;
}

// Create RPC handler function
export function createRPCHandler(customHandlers = {}) {
  return async function handle_rpc(ws, message) {
    let id = null;
    let method = null;
    const startTime = Date.now();

    try {
      const parsed = JSON.parse(message);
      method = parsed.method;
      const params = parsed.params;
      id = parsed.id;

      // Log incoming request
      wsLogger.request(method, params);

      // Handle SID responses from client (special internal method)
      if (method === "_sid_response") {
        const { sid, result, error } = params || {};
        if (!sid) {
          return create_rpc_error(id, -32602, "Missing sid parameter");
        }

        if (error) {
          rejectSID(sid, error);
        } else {
          resolveSID(sid, result);
        }

        return create_rpc_response(id, { success: true });
      }

      // Validate method doesn't start with underscore (private)
      if (method.startsWith("_")) {
        wsLogger.warn(`Blocked private function call: ${method}`);
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

        wsLogger.debug(`DZQL: Calling ${operation}.${entity} with params:`, JSON.stringify(params));
        const result = await db.api[operation][entity](
          params || {},
          ws.data.user_id,
        );
        wsLogger.debug(`DZQL: ${operation}.${entity} returned successfully`);
        return create_rpc_response(id, result);
      }

      // Local API functions that don't require auth
      if (method === "login_user") {
        authLogger.debug(`Login attempt for: ${params.email}`);
        const data = await callAuthFunction(
          "login_user",
          params.email,
          params.password,
        );

        // On successful auth, set user_id on WebSocket connection
        if (data && data.user_id) {
          ws.data.user_id = data.user_id;
          authLogger.info(`User logged in: ${params.email} (id: ${data.user_id})`);

          // Create JWT token for client storage
          const token = await create_jwt({
            user_id: data.user_id,
            email: data.email,
          });

          // Get full profile
          const profile = await getUserProfile(data.user_id);

          const result = {
            user_id: data.user_id,
            email: data.email,
            token,
            profile,
          };
          wsLogger.response(method, result, Date.now() - startTime);
          return create_rpc_response(id, result);
        }

        authLogger.warn(`Login failed for: ${params.email}`);
        wsLogger.response(method, data, Date.now() - startTime);
        return create_rpc_response(id, data);
      }

      if (method === "register_user") {
        authLogger.debug(`Registration attempt for: ${params.email}`);
        const data = await callAuthFunction(
          "register_user",
          params.email,
          params.password,
        );

        // On successful registration, set user_id on WebSocket connection
        if (data && data.user_id) {
          ws.data.user_id = data.user_id;
          authLogger.info(`User registered: ${params.email} (id: ${data.user_id})`);

          // Create JWT token for client storage
          const token = await create_jwt({
            user_id: data.user_id,
            email: data.email,
          });

          const result = {
            user_id: data.user_id,
            email: data.email,
            token,
            profile: data,
          };
          wsLogger.response(method, result, Date.now() - startTime);
          return create_rpc_response(id, result);
        }

        authLogger.warn(`Registration failed for: ${params.email}`);
        wsLogger.response(method, data, Date.now() - startTime);
        return create_rpc_response(id, data);
      }

      // Everything else requires authentication
      if (!ws.data.user_id) {
        wsLogger.warn(`Unauthenticated request to: ${method}`);
        return create_rpc_error(id, -32603, "Not authenticated");
      }

      // Authenticated-only local functions
      if (method === "logout") {
        authLogger.info(`User logged out (id: ${ws.data.user_id})`);
        ws.data.user_id = null;
        const result = { success: true };
        wsLogger.response(method, result, Date.now() - startTime);
        return create_rpc_response(id, result);
      }

      // SUBSCRIPTION HANDLERS - Pattern match on method name
      if (method.startsWith("subscribe_")) {
        const subscribableName = method.replace("subscribe_", "");
        wsLogger.debug(`Subscribe request: ${subscribableName}`, params);

        try {
          // Execute initial query (this also checks permissions)
          const queryResult = await db.query(
            `SELECT get_${subscribableName}($1, $2) as data`,
            [params, ws.data.user_id]
          );

          const data = queryResult.rows[0]?.data;

          // Register subscription in memory
          const subscriptionId = registerSubscription(
            subscribableName,
            ws.data.user_id,
            ws.data.connection_id,
            params
          );

          const result = {
            subscription_id: subscriptionId,
            data
          };

          wsLogger.response(method, result, Date.now() - startTime);
          return create_rpc_response(id, result);
        } catch (error) {
          wsLogger.error(`Subscribe failed for ${subscribableName}:`, error.message);
          return create_rpc_error(id, -32603, error.message);
        }
      }

      if (method.startsWith("unsubscribe_")) {
        const subscribableName = method.replace("unsubscribe_", "");
        wsLogger.debug(`Unsubscribe request: ${subscribableName}`, params);

        // Remove subscription by params
        const removed = unregisterSubscriptionByParams(
          subscribableName,
          ws.data.connection_id,
          params
        );

        const result = { success: removed };
        wsLogger.response(method, result, Date.now() - startTime);
        return create_rpc_response(id, result);
      }

      // Check for custom handlers
      if (customHandlers[method]) {
        wsLogger.debug(`Calling custom handler: ${method}`);
        const result = await customHandlers[method](ws.data.user_id, params);
        wsLogger.response(method, result, Date.now() - startTime);
        return create_rpc_response(id, result);
      }

      // Call stored function with user_id as first parameter
      wsLogger.debug(`Calling database function: ${method}`);
      const result = await callUserFunction(method, ws.data.user_id, params);
      wsLogger.response(method, result, Date.now() - startTime);
      return create_rpc_response(id, result);
    } catch (error) {
      wsLogger.error(`RPC error in ${method}:`, error.message);
      wsLogger.debug(`RPC error stack:`, error.stack);

      // PostgreSQL error codes
      if (error.code) {
        wsLogger.debug(`Returning PostgreSQL error for id=${id}`);
        return create_rpc_error(id, -32603, String(error), {
          code: error.code,
        });
      }

      // Generic error
      wsLogger.debug(`Returning generic error for id=${id}: ${error.message}`);
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

    // WebSocket configuration for Bun.serve
    // These properties are required for proper ping/pong support (especially on Heroku)
    perMessageDeflate: true,
    maxPayloadLength: WS_MAX_MESSAGE_SIZE,
    idleTimeout: WS_PING_INTERVAL / 1000, // Convert to seconds for Bun
    closeOnBackpressureLimit: true, // Close connection if backpressure limit exceeded

    // Connection opened
    async open(ws) {
      const id = crypto.randomUUID();
      ws.data.connection_id = id;
      connections.set(id, ws);

      wsLogger.info(
        `Connection opened: ${id.slice(0, 8)}...`,
        ws.data.user_id ? `(user: ${ws.data.user_id})` : "(anonymous)",
      );

      // Get full profile if authenticated
      let profile = null;
      if (ws.data.user_id) {
        try {
          profile = await getUserProfile(ws.data.user_id);
        } catch (error) {
          wsLogger.error("Failed to load profile:", error.message);
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

      // Clean up all subscriptions for this connection
      const removedCount = removeConnectionSubscriptions(id);
      if (removedCount > 0) {
        wsLogger.info(`Connection closed: ${id?.slice(0, 8)}... (${removedCount} subscriptions removed)`);
      } else {
        wsLogger.info(`Connection closed: ${id?.slice(0, 8)}...`);
      }

      // Call custom disconnection handler
      if (onDisconnection) {
        onDisconnection(ws, id);
      }
    },

    // Error occurred
    error(ws, error) {
      wsLogger.error(`WebSocket error for ${ws.data.connection_id?.slice(0, 8)}...:`, error.message);
    },
  };
}

// Broadcast message to all authenticated connections or specific client_ids
export function createBroadcaster(connections) {
  const broadcastToConnections = function(message, client_ids = null) {
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

  // Add helper function to send to a specific connection
  broadcastToConnections.toConnection = function(connectionId, message) {
    const ws = connections.get(connectionId);
    if (ws && ws.readyState === 1) { // 1 = OPEN
      ws.send(message);
      return true;
    }
    return false;
  };

  return broadcastToConnections;
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
