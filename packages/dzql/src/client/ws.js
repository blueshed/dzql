// Pure WebSocket manager class (no React dependencies)
class WebSocketManager {
  constructor(options = {}) {
    this.ws = null;
    this.messageId = 0;
    this.pendingRequests = new Map();
    this.broadcastCallbacks = new Set();
    this.sidRequestHandlers = new Set();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.isShuttingDown = false;

    // Ad

    // DZQL nested proxy API - matches server-side db.api pattern
    // Proxy handles both DZQL operations and custom functions
    const dzqlOps = {
      get: this.createEntityProxy("get"),
      save: this.createEntityProxy("save"),
      delete: this.createEntityProxy("delete"),
      lookup: this.createEntityProxy("lookup"),
      search: this.createEntityProxy("search"),
    };

    this.api = new Proxy(dzqlOps, {
      get: (target, prop) => {
        // Return cached DZQL operation if it exists
        if (prop in target) {
          return target[prop];
        }
        // All other properties are treated as custom function calls
        return (params = {}) => {
          return this.call(prop, params);
        };
      },
    });
  }

  /**
   * Create entity proxy for DZQL operations
   *
   * @param {string} operation - The operation type (get, save, delete, lookup, search)
   * @returns {Proxy} A proxy that creates entity-specific methods
   *
   * @example
   * // For search operations with advanced filtering:
   * const venues = await ws.api.search.venues({
   *   filters: {
   *     city: "New York",                    // Exact match
   *     capacity: { gte: 1000, lt: 5000 },   // Range operators
   *     name: { ilike: "%garden%" },         // Pattern matching
   *     categories: ["sports", "concert"],   // IN array
   *     description: { not_null: true },     // Not null check
   *     _search: "madison"                   // Text search across searchable fields
   *   },
   *   sort: { field: "name", order: "asc" },
   *   page: 1,
   *   limit: 25,
   *   on_date: "2024-01-15"  // Optional temporal filter
   * });
   *
   * Filter operators supported:
   * - Exact match: {field: "value"}
   * - Greater than: {field: {gt: 100}}
   * - Greater or equal: {field: {gte: 100}}
   * - Less than: {field: {lt: 100}}
   * - Less or equal: {field: {lte: 100}}
   * - Not equal: {field: {neq: "value"}}
   * - Between: {field: {between: [10, 100]}}
   * - Pattern match: {field: {like: "%pattern%"}}
   * - Case-insensitive: {field: {ilike: "%pattern%"}}
   * - IN array: {field: ["value1", "value2"]}
   * - NOT IN: {field: {not_in: ["value1", "value2"]}}
   * - IS NULL: {field: null}
   * - IS NOT NULL: {field: {not_null: true}}
   * - Text search: {_search: "search terms"}
   *
   * Response format:
   * {
   *   data: [...],   // Array of results
   *   total: 100,    // Total count before pagination
   *   page: 1,       // Current page number
   *   limit: 50      // Results per page
   * }
   *
   * Error handling:
   * Invalid column names will throw an error with message:
   * "Column {column_name} does not exist in table {table_name}"
   *
   * Invalid operators are silently ignored (no error).
   */
  createEntityProxy(operation) {
    return new Proxy(
      {},
      {
        get: (target, entityName) => {
          return (params = {}) => {
            return this.call(`dzql.${operation}.${entityName}`, params);
          };
        },
      },
    );
  }

  connect(url = null, timeout = 5000) {
    return new Promise((resolve, reject) => {
      let wsUrl;

      if (url) {
        // Direct URL provided (for testing)
        wsUrl = url;
      } else if (typeof window !== "undefined") {
        // Browser environment
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        wsUrl = `${protocol}//${window.location.host}/ws`;
      } else {
        // Node.js environment (default for testing)
        wsUrl = "ws://localhost:3000/ws";
      }

      // Add JWT token as query parameter if available
      if (typeof localStorage !== 'undefined'){
        const storedToken = localStorage.getItem("dzql_token");
        if (storedToken) {
          wsUrl += `?token=${encodeURIComponent(storedToken)}`;
        }
      }

      const connectionTimeout = setTimeout(() => {
        if (this.ws) {
          this.ws.close();
        }
        reject(new Error(`WebSocket connection timed out after ${timeout}ms`));
      }, timeout);

      // When bundled by Bun, this will always use the browser's WebSocket
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log(`WebSocket connected to ${wsUrl}`);
        this.reconnectAttempts = 0;
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          this.handleMessage(message);
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };

      this.ws.onclose = () => {
        console.log(`WebSocket disconnected from ${wsUrl}`);
        if (!this.isShuttingDown) {
          this.attemptReconnect();
        }
      };

      this.ws.onerror = (error) => {
        clearTimeout(connectionTimeout);
        console.error(`WebSocket connection error to ${wsUrl}:`, error);
        reject(error);
      };
    });
  }

  handleMessage(message) {
    // Handle JSON-RPC responses
    if (message.id && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);

      if (message.error) {
        reject(new Error(message.error.message || message.error.code || 'Unknown error'));
      } else {
        resolve(message.result);
      }
    } else {
      // Handle broadcasts and SID requests

      // Check if this is a SID request from server
      if (message.params && message.params.sid) {
        // Call all registered SID handlers
        this.sidRequestHandlers.forEach((handler) => {
          handler(message.method, message.params);
        });
      }

      // Call regular broadcast callbacks
      this.broadcastCallbacks.forEach((callback) => {
        callback(message.method, message.params);
      });
    }
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = 1000 * this.reconnectAttempts;
      setTimeout(() => {
        console.log(
          `Attempting WebSocket reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) to ws://localhost:3000/ws in ${delay}ms`,
        );
        this.connect();
      }, delay);
    } else {
      console.error(
        `WebSocket failed to connect after ${this.maxReconnectAttempts} attempts. Giving up.`,
      );
    }
  }

  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }

      const id = ++this.messageId;
      const message = {
        jsonrpc: "2.0",
        method,
        params,
        id,
      };

      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(message));
    });
  }

  onBroadcast(callback) {
    this.broadcastCallbacks.add(callback);
    return () => this.broadcastCallbacks.delete(callback);
  }

  offBroadcast(callback) {
    this.broadcastCallbacks.delete(callback);
  }

  /**
   * Register a handler for SID requests from server
   * Handler receives (method, params) where params includes { sid, ...otherData }
   * Handler should call respondToSID(sid, result) or respondToSID(sid, null, error)
   *
   * @param {Function} callback - Handler function
   * @returns {Function} - Cleanup function to remove the handler
   */
  onSIDRequest(callback) {
    this.sidRequestHandlers.add(callback);
    return () => this.sidRequestHandlers.delete(callback);
  }

  offSIDRequest(callback) {
    this.sidRequestHandlers.delete(callback);
  }

  /**
   * Respond to a SID request from server
   *
   * @param {string} sid - The session ID from the server request
   * @param {any} result - The result to send back (use null if error)
   * @param {string|Error} error - Optional error if the request failed
   */
  async respondToSID(sid, result = null, error = null) {
    const errorMessage = error ? (typeof error === 'string' ? error : error.message) : null;

    return this.call('_sid_response', {
      sid,
      result,
      error: errorMessage
    });
  }

  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  disconnect() {
    this.isShuttingDown = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.pendingRequests.clear();
    this.reconnectAttempts = 0;
  }

  /**
   * Clean disconnect without reconnection attempts
   * Perfect for test cleanup
   */
  cleanDisconnect() {
    this.isShuttingDown = true;
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent any reconnection

    if (this.ws) {
      this.ws.onclose = null; // Remove close handler to prevent reconnection
      this.ws.close();
      this.ws = null;
    }

    this.pendingRequests.clear();
    this.broadcastCallbacks.clear();
  }

  /**
   * Reset the WebSocket manager to initial state
   * Useful for test isolation
   */
  reset() {
    this.cleanDisconnect();
    this.messageId = 0;
    this.reconnectAttempts = 0;
    this.isShuttingDown = false;
    this.pendingRequests.clear();
    this.broadcastCallbacks.clear();
  }

  /**
   * Check connection status
   */
  getStatus() {
    if (!this.ws) return "disconnected";

    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return "connecting";
      case WebSocket.OPEN:
        return "connected";
      case WebSocket.CLOSING:
        return "closing";
      case WebSocket.CLOSED:
        return "disconnected";
      default:
        return "unknown";
    }
  }
}

const ws = new WebSocketManager();

export const useWs = () => {
  return ws;
};

export { WebSocketManager };
