import postgres from "postgres";
import { dbLogger, notifyLogger } from "./logger.js";

// Environment configuration
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://dzql:dzql@localhost:5432/dzql";

const DB_MAX_CONNECTIONS = parseInt(process.env.DB_MAX_CONNECTIONS || "10", 10);
const DB_IDLE_TIMEOUT = parseInt(process.env.DB_IDLE_TIMEOUT || "20", 10);
const DB_CONNECT_TIMEOUT = parseInt(process.env.DB_CONNECT_TIMEOUT || "10", 10);

// Main PostgreSQL connection for queries
export const sql = postgres(DATABASE_URL, {
  max: DB_MAX_CONNECTIONS,
  idle_timeout: DB_IDLE_TIMEOUT,
  connect_timeout: DB_CONNECT_TIMEOUT,
  // Suppress NOTICE messages in test environment
  onnotice: process.env.NODE_ENV === 'test' ? () => {} : undefined,
});

// Separate PostgreSQL connection for NOTIFY/LISTEN
export const listen_sql = postgres(DATABASE_URL, {
  max: 1,
  idle_timeout: 0,
  connect_timeout: DB_CONNECT_TIMEOUT,
  // Suppress NOTICE messages in test environment
  onnotice: process.env.NODE_ENV === 'test' ? () => {} : undefined,
});

dbLogger.info(`Database connected: ${DATABASE_URL.replace(/\/\/.*@/, '//***@')}`);

// Cache for function parameter metadata
const functionParamCache = new Map();

// Cache helpers
export async function getCache(key, ttlHours) {
  const result = await sql`SELECT app._get_cache(${key}, ${ttlHours}) as data`;
  return result[0]?.data ? JSON.parse(result[0].data) : null;
}

export async function setCache(key, data) {
  await sql`SELECT app._set_cache(${key}, ${JSON.stringify(data)})`;
}

// Auth helpers
export async function callAuthFunction(method, email, password) {
  const result = await sql`
    SELECT ${sql(method)}(${email}, ${password}) as result
  `;
  return result[0].result;
}

// Get function parameter metadata
async function getFunctionParams(functionName) {
  if (functionParamCache.has(functionName)) {
    return functionParamCache.get(functionName);
  }

  const result = await sql`
    SELECT
      p.parameter_name,
      p.parameter_default,
      p.data_type,
      p.ordinal_position
    FROM information_schema.parameters p
    WHERE p.specific_name IN (
      SELECT r.specific_name
      FROM information_schema.routines r
      WHERE r.routine_name = ${functionName}
      AND r.routine_type = 'FUNCTION'
    )
    AND (p.parameter_mode = 'IN' OR p.parameter_mode IS NULL)
    ORDER BY p.ordinal_position
  `;

  const params = result.map((row) => ({
    name: row.parameter_name,
    type: row.data_type,
    position: row.ordinal_position,
    hasDefault: row.parameter_default !== null,
  }));

  functionParamCache.set(functionName, params);
  return params;
}

// Generic stored function call with user_id
export async function callUserFunction(method, userId, params) {
  // Validate function name format (only alphanumeric and underscore, no special chars)
  // This prevents SQL injection via function names like "foo(); DROP TABLE users--"
  if (!/^[a-z_][a-z0-9_]*$/i.test(method)) {
    throw new Error(`Invalid function name: ${method}`);
  }

  const functionParams = await getFunctionParams(method);

  if (functionParams.length === 0) {
    throw new Error(`Function ${method} not found`);
  }

  // Build ordered parameter array
  const orderedParams = [];

  for (const param of functionParams) {
    if (param.position === 1) {
      // First parameter is always user_id
      orderedParams.push(userId);
    } else {
      // Strip p_ prefix from parameter name for client API matching
      const clientParamName = param.name.startsWith("p_")
        ? param.name.substring(2)
        : param.name;

      if (params && params[clientParamName] !== undefined) {
        // Parameter exists in the params object
        orderedParams.push(params[clientParamName]);
      } else if (param.hasDefault) {
        // Parameter has a default value, skip it
        break;
      } else {
        // Required parameter missing
        throw new Error(`Missing required parameter: ${clientParamName}`);
      }
    }
  }

  // Try table format first - works for both single and multiple results
  const query = `SELECT * FROM ${method}(${orderedParams.map((_, i) => `$${i + 1}`).join(", ")})`;
  const result = await sql.unsafe(query, orderedParams);

  // If single row with single column, return just the value
  if (result.length === 1 && Object.keys(result[0]).length === 1) {
    return Object.values(result[0])[0];
  }

  // Otherwise return the full result set
  return result;
}

// Get user profile
export async function getUserProfile(userId) {
  const result = await sql`
    SELECT _profile(${userId}::integer) as profile
  `;
  return result[0].profile;
}

// Setup NOTIFY listeners
export async function setupListeners(callback) {
  try {
    // Listen to single dzql channel for all events
    await listen_sql.listen("dzql", (payload) => {
      const event = JSON.parse(payload);
      notifyLogger.debug(`Received NOTIFY event:`, event.table, event.op);
      callback(event);
    });
    notifyLogger.info("NOTIFY listener established on 'dzql' channel");
    return true;
  } catch (error) {
    notifyLogger.error("Failed to setup listeners:", error.message);
    return false;
  }
}

// DZQL Generic Operations
export async function callDZQLOperation(operation, entity, args, userId) {
  dbLogger.trace(`DZQL ${operation}.${entity} for user ${userId}`);
  const result = await sql`
    SELECT dzql.generic_exec(${operation}, ${entity}, ${args}, ${userId}) as result
  `;
  return result[0].result;
}

// DZQL nested proxy factory
function createEntityProxy(operation) {
  return new Proxy(
    {},
    {
      get(target, entityName) {
        return async (args = {}, userId) => {
          // userId is required for DZQL operations
          if (!userId) {
            throw new Error("userId is required for DZQL operations");
          }
          return callDZQLOperation(operation, entityName, args, userId);
        };
      },
    },
  );
}

/**
 * DZQL database API
 *
 * Provides server-side access to DZQL operations and custom PostgreSQL functions.
 * All operations require explicit userId parameter (unlike client API which auto-injects).
 *
 * @namespace db.api
 *
 * @property {Object} get - Get single record by primary key
 * @property {Object} save - Create or update record (upsert)
 * @property {Object} delete - Delete record by primary key
 * @property {Object} lookup - Autocomplete lookup by label field
 * @property {Object} search - Advanced search with filters, pagination, sorting
 *
 * @example
 * // Get a single venue
 * const venue = await db.api.get.venues({ id: 1 }, userId);
 *
 * @example
 * // Create a new venue
 * const venue = await db.api.save.venues({
 *   name: 'Madison Square Garden',
 *   org_id: 3,
 *   address: '4 Pennsylvania Plaza, New York'
 * }, userId);
 *
 * @example
 * // Update existing venue
 * const updated = await db.api.save.venues({
 *   id: 1,
 *   name: 'Updated Name'
 * }, userId);
 *
 * @example
 * // Delete venue
 * await db.api.delete.venues({ id: 1 }, userId);
 *
 * @example
 * // Lookup for autocomplete
 * const results = await db.api.lookup.venues({
 *   p_filter: 'garden'  // Searches label field
 * }, userId);
 * // Returns: [{ value: 1, label: 'Madison Square Garden' }, ...]
 *
 * @example
 * // Advanced search with filters
 * const results = await db.api.search.venues({
 *   p_filters: {
 *     city: 'New York',
 *     capacity: { gte: 1000 },
 *     _search: 'garden'  // Full-text search
 *   },
 *   p_sort: { field: 'name', order: 'asc' },
 *   p_page: 1,
 *   p_limit: 25
 * }, userId);
 * // Returns: { data: [...], total: 100, page: 1, limit: 25 }
 *
 * @example
 * // Call custom PostgreSQL function
 * const stats = await db.api.myCustomFunction({ param1: 'value' }, userId);
 *
 * @example
 * // Call auth functions (no userId required)
 * const user = await db.api.register_user({
 *   email: 'user@example.com',
 *   password: 'secure123'
 * });
 * const session = await db.api.login_user({
 *   email: 'user@example.com',
 *   password: 'secure123'
 * });
 */
// DZQL database API proxy with custom function support
export const db = {
  api: new Proxy(
    {
      get: createEntityProxy("get"),
      save: createEntityProxy("save"),
      delete: createEntityProxy("delete"),
      lookup: createEntityProxy("lookup"),
      search: createEntityProxy("search"),
      exec: async (functionName, args, userId) => {
        if (!userId) {
          throw new Error("userId is required for function calls");
        }
        return callUserFunction(functionName, userId, args);
      },
      // Permission and path resolution utilities
      checkPermission: async (userId, operation, entity, record) => {
        const result = await sql`
          SELECT dzql.check_permission(${userId}, ${operation}, ${entity}, ${JSON.stringify(record)}) as allowed
        `;
        return result[0].allowed;
      },
      resolveNotificationPath: async (tableName, record, path) => {
        const result = await sql`
          SELECT dzql.resolve_notification_path(${tableName}, ${JSON.stringify(record)}, ${path}) as user_ids
        `;
        return result[0].user_ids;
      },
      resolveNotificationPaths: async (tableName, record) => {
        const result = await sql`
          SELECT dzql.resolve_notification_paths(${tableName}, ${JSON.stringify(record)}) as user_ids
        `;
        return result[0].user_ids;
      },
    },
    {
      get(target, prop) {
        // Return existing DZQL operations
        if (target[prop]) {
          return target[prop];
        }

        // Handle custom functions
        return async (userIdOrArgs, args = {}) => {
          // Special handling for auth functions that don't require userId
          if (prop === 'register_user' || prop === 'login_user') {
            // For auth functions, first param is the args object
            return callAuthFunction(prop, userIdOrArgs.email, userIdOrArgs.password);
          }

          // For other functions, userId is required as first parameter
          if (!userIdOrArgs) {
            throw new Error(`userId is required for function ${prop}`);
          }

          return callUserFunction(prop, userIdOrArgs, args);
        };
      },
    }
  ),
};

// Graceful shutdown
export async function closeConnections() {
  dbLogger.info("Closing database connections...");
  await sql.end();
  await listen_sql.end();
  dbLogger.info("Database connections closed");
}
