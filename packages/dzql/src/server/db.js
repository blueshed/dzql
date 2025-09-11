import postgres from "postgres";

// Environment configuration
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://dzql:dzql@localhost:5432/dzql";

// Main PostgreSQL connection for queries
export const sql = postgres(DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  // Suppress NOTICE messages in test environment
  onnotice: process.env.NODE_ENV === 'test' ? () => {} : undefined,
});

// Separate PostgreSQL connection for NOTIFY/LISTEN
export const listen_sql = postgres(DATABASE_URL, {
  max: 1,
  idle_timeout: 0,
  connect_timeout: 10,
  // Suppress NOTICE messages in test environment
  onnotice: process.env.NODE_ENV === 'test' ? () => {} : undefined,
});

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
      callback(event);
    });
    return true;
  } catch (error) {
    console.error("Failed to setup listeners:", error);
    return false;
  }
}

// DZQL Generic Operations
export async function callDZQLOperation(operation, entity, args, userId) {
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
  await sql.end();
  await listen_sql.end();
}
