import { sql, db } from "./db.js";
import { serverLogger } from "./logger.js";
import { verify_jwt_token, create_jwt, createSIDPromise, resolveSID, rejectSID } from "./ws.js";
import { callAuthFunction } from "./db.js";

/**
 * MCP (Model Context Protocol) Server using JSON-RPC 2.0
 *
 * Provides database tools for Claude to interact with the system.
 * Tools are auto-generated from database function metadata.
 *
 * Implements MCP specification: https://modelcontextprotocol.io/specification/2025-03-26
 */

// Server info
const SERVER_INFO = {
  name: "dzql-mcp-server",
  version: "1.0.0",
};

const PROTOCOL_VERSION = "2025-03-26";

/**
 * Discover available entities from dzql.entities table
 */
async function discoverEntities() {
  const result = await sql`
    SELECT table_name, label_field, searchable_fields
    FROM dzql.entities
    ORDER BY table_name
  `;

  // Build entities object with descriptions
  const entities = {};
  for (const row of result) {
    const searchFields = row.searchable_fields?.join(', ') || 'none';
    entities[row.table_name] = `DZQL entity: ${row.table_name} (label: ${row.label_field}, searchable: ${searchFields})`;
  }

  return { entities };
}

/**
 * Generate static tool list (action-based pattern)
 */
async function generateToolList() {
  serverLogger.info("Generating MCP tool list...");

  const tools = [
    {
      name: "list_entities",
      description: "Discover all available database entities with descriptions. Call this first to see what entities you can work with.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "search",
      description: "Search any entity. Calls search_<entity> with provided parameters. Common params: query (search string).",
      inputSchema: {
        type: "object",
        properties: {
          entity: {
            type: "string",
            description: "Entity name (e.g., 'organisations', 'venues')",
          },
        },
        required: ["entity"],
      },
    },
    {
      name: "get",
      description: "Get entity by ID. Calls get_<entity> with provided parameters. Requires entity-specific ID param (e.g., organisation_id, venue_id).",
      inputSchema: {
        type: "object",
        properties: {
          entity: {
            type: "string",
            description: "Entity name (singular, e.g., 'organisation', 'venue')",
          },
        },
        required: ["entity"],
      },
    },
    {
      name: "save",
      description: "Create or update entity. Calls save_<entity> with provided parameters. Pass entity fields directly (e.g., name, description). Include id to update.",
      inputSchema: {
        type: "object",
        properties: {
          entity: {
            type: "string",
            description: "Entity name (singular, e.g., 'organisation', 'venue')",
          },
        },
        required: ["entity"],
      },
    },
    {
      name: "delete",
      description: "Delete entity by ID. Calls delete_<entity> with provided parameters. Requires entity-specific ID param (e.g., organisation_id, venue_id).",
      inputSchema: {
        type: "object",
        properties: {
          entity: {
            type: "string",
            description: "Entity name (singular, e.g., 'organisation', 'venue')",
          },
        },
        required: ["entity"],
      },
    },
    // Custom tools
    {
      name: "screenshot_map",
      description: "Capture a screenshot of the current map view. Sends a request to the client and waits for the screenshot to be captured and uploaded.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  ];

  serverLogger.info(`Generated ${tools.length} MCP tools (5 CRUD + 1 custom)`);

  return tools;
}

/**
 * Create JSON-RPC 2.0 success response
 */
function createSuccessResponse(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

/**
 * Create JSON-RPC 2.0 error response
 */
function createErrorResponse(id, code, message, data = undefined) {
  const response = {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };

  if (data !== undefined) {
    response.error.data = data;
  }

  return response;
}

/**
 * JSON-RPC error codes
 */
const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
};

// Session management
const sessions = new Map();

function generateSessionId() {
  return crypto.randomUUID();
}

/**
 * Create SSE (Server-Sent Events) response stream
 */
function createSSEStream() {
  const stream = new ReadableStream({
    start(controller) {
      // Store controller for later use
      this.controller = controller;

      // Send initial comment to establish connection
      controller.enqueue(`: MCP SSE stream established\n\n`);
    },
    cancel() {
      // Clean up when client disconnects
    }
  });

  return {
    stream,
    send(data) {
      try {
        const encoder = new TextEncoder();
        const message = `data: ${JSON.stringify(data)}\n\n`;
        stream.controller?.enqueue(encoder.encode(message));
      } catch (error) {
        serverLogger.error("SSE send error:", error.message);
      }
    }
  };
}

/**
 * Create MCP route handler
 * Returns an async function that handles HTTP requests for the /mcp endpoint
 */
export async function createMCPRoute(broadcastFn) {

  /**
   * Handle initialize request
   */
  async function handleInitialize(params) {
    serverLogger.info("MCP initialize request received");

    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: {
          listChanged: true,
        },
      },
      serverInfo: SERVER_INFO,
    };
  }

  /**
   * Handle tools/list request
   */
  async function handleToolsList(params) {
    const tools = await generateToolList();

    return {
      tools,
      // nextCursor is optional - we don't support pagination yet
    };
  }

  /**
   * Handle tools/call request
   */
  async function handleToolsCall(userId, params) {
    const { name: toolName, arguments: toolInput } = params;

    serverLogger.debug(`MCP tool called by user ${userId}: ${toolName}`, toolInput);

    try {
      // Handle list_entities
      if (toolName === "list_entities") {
        const entities = await discoverEntities();
        serverLogger.info(`User ${userId} listed ${Object.keys(entities.entities).length} entities`);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(entities, null, 2),
          }],
          isError: false,
        };
      }

      // Handle CRUD actions (search, get, save, delete, lookup)
      if (["search", "get", "save", "delete", "lookup"].includes(toolName)) {
        const { entity, ...restParams } = toolInput || {};

        if (!entity) {
          return {
            content: [{
              type: "text",
              text: "Missing required parameter: entity",
            }],
            isError: true,
          };
        }

        serverLogger.debug(`Calling DZQL ${toolName} on ${entity}`, restParams);

        // Call DZQL generic operation via db.api
        const result = await db.api[toolName][entity](restParams, userId);

        serverLogger.info(`User ${userId} called ${toolName} on ${entity} successfully`);

        // Format result as MCP content response
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
          isError: false,
        };
      }

      // Special case: screenshot_map - custom tool (not database function)
      if (toolName === "screenshot_map") {
        if (!broadcastFn) {
          return {
            content: [{
              type: "text",
              text: "Screenshot service not available",
            }],
            isError: true,
          };
        }

        const { sid, promise } = createSIDPromise(15000); // 15 second timeout

        // Broadcast take_screenshot request to client
        const message = JSON.stringify({
          jsonrpc: "2.0",
          method: "take_screenshot",
          params: { sid },
        });

        broadcastFn(message, userId);
        serverLogger.debug(`Broadcast take_screenshot to user ${userId} with SID ${sid}`);

        try {
          const result = await promise;
          serverLogger.info(`Screenshot completed for user ${userId}: ${result.file_path}`);

          // Format as MCP content response
          return {
            content: [{
              type: "text",
              text: JSON.stringify(result, null, 2),
            }],
            isError: false,
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: error.message,
            }],
            isError: true,
          };
        }
      }

      // Unknown tool
      return {
        content: [{
          type: "text",
          text: `Unknown tool: ${toolName}`,
        }],
        isError: true,
      };

    } catch (error) {
      serverLogger.error(`Tool call error for ${toolName}:`, error.message);

      // Return error as content with isError flag
      return {
        content: [{
          type: "text",
          text: error.message,
        }],
        isError: true,
      };
    }
  }

  /**
   * Handle auth methods (login/register)
   */
  async function handleAuthMethod(method, params) {
    try {
      const data = await callAuthFunction(method, params.email, params.password);

      if (!data || !data.user_id) {
        return {
          user_id: null,
          error: `${method} failed`,
        };
      }

      // Create JWT token for client storage
      const token = await create_jwt({
        user_id: data.user_id,
        email: data.email,
      });

      serverLogger.info(`User authenticated via MCP: ${data.email} (id: ${data.user_id})`);

      return {
        user_id: data.user_id,
        email: data.email,
        token,
        profile: data.profile,
      };
    } catch (error) {
      serverLogger.error(`MCP ${method} error:`, error.message);
      return { error: error.message };
    }
  }

  /**
   * Authenticate request and extract user_id from JWT token
   */
  async function authenticateRequest(authHeader) {
    if (!authHeader) {
      throw new Error("Missing Authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const payload = await verify_jwt_token(token);

    if (!payload || !payload.user_id) {
      throw new Error("Invalid or expired token");
    }

    return payload.user_id;
  }

  /**
   * Main route handler - processes JSON-RPC 2.0 requests
   * Supports both HTTP POST (with optional SSE) and GET (SSE stream)
   */
  return async (req) => {
    const acceptHeader = req.headers.get("Accept") || "";
    const wantsSSE = acceptHeader.includes("text/event-stream");

    // Handle GET requests - open SSE stream
    if (req.method === "GET") {
      if (!wantsSSE) {
        return new Response("GET requests require Accept: text/event-stream", {
          status: 400
        });
      }

      serverLogger.info("Opening SSE stream for MCP client");

      // Create SSE stream
      const { stream } = createSSEStream();

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // Handle POST requests
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    let requestId = null;

    try {
      // Parse JSON-RPC 2.0 request
      const body = await req.json();
      const { jsonrpc, id, method, params } = body;

      requestId = id;

      // Validate JSON-RPC version
      if (jsonrpc !== "2.0") {
        const errorResponse = createErrorResponse(
          id,
          ErrorCodes.InvalidRequest,
          "Invalid JSON-RPC version. Expected '2.0'"
        );
        return new Response(JSON.stringify(errorResponse), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Validate method is present
      if (!method) {
        const errorResponse = createErrorResponse(
          id,
          ErrorCodes.InvalidRequest,
          "Missing 'method' field"
        );
        return new Response(JSON.stringify(errorResponse), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      let result;
      let sessionId = req.headers.get("Mcp-Session-Id");

      // Route to appropriate handler based on method
      switch (method) {
        case "initialize":
          result = await handleInitialize(params || {});

          // Generate session ID on initialize if not present
          if (!sessionId) {
            sessionId = generateSessionId();
            sessions.set(sessionId, { createdAt: Date.now() });
            serverLogger.info(`Created MCP session: ${sessionId}`);
          }
          break;

        case "notifications/initialized":
          // Client confirms initialization is complete - no response needed
          serverLogger.info("MCP client initialization complete");
          // For notifications (no id), return 204 No Content
          if (id === null || id === undefined) {
            return new Response(null, { status: 204 });
          }
          // If id is present, it's not a proper notification, but acknowledge it
          result = {};
          break;

        case "tools/list":
          // Optional authentication - try to get userId from token, but don't require it
          let listUserId = null;
          const listAuthHeader = req.headers.get("Authorization");
          if (listAuthHeader) {
            try {
              listUserId = await authenticateRequest(listAuthHeader);
            } catch (error) {
              // Ignore auth errors for tools/list - Claude Code doesn't support auth headers
              serverLogger.warn("MCP tools/list: Invalid auth header, continuing without authentication");
            }
          }
          result = await handleToolsList(params || {});
          break;

        case "tools/call":
          // Optional authentication - try to get userId from token, but use default user if not available
          let callUserId = 1; // Default to user 1 for local dev
          const callAuthHeader = req.headers.get("Authorization");
          if (callAuthHeader) {
            try {
              callUserId = await authenticateRequest(callAuthHeader);
            } catch (error) {
              // Use default user ID for Claude Code (which doesn't support auth headers)
              serverLogger.warn("MCP tools/call: Invalid/missing auth header, using default user_id=1");
            }
          }
          result = await handleToolsCall(callUserId, params || {});
          break;

        // Custom auth methods (non-standard MCP extension)
        case "login_user":
        case "register_user":
          result = await handleAuthMethod(method, params || {});
          break;

        default:
          const errorResponse = createErrorResponse(
            id,
            ErrorCodes.MethodNotFound,
            `Unknown method: ${method}`
          );
          return new Response(JSON.stringify(errorResponse), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
      }

      // Build response with session ID if present
      const successResponse = createSuccessResponse(id, result);
      const responseHeaders = { "Content-Type": "application/json" };

      if (sessionId) {
        responseHeaders["Mcp-Session-Id"] = sessionId;
      }

      return new Response(JSON.stringify(successResponse), {
        headers: responseHeaders,
      });

    } catch (error) {
      serverLogger.error("MCP request error:", error.message);

      // Return JSON-RPC error response
      const errorResponse = createErrorResponse(
        requestId,
        ErrorCodes.InternalError,
        error.message
      );
      return new Response(JSON.stringify(errorResponse), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  };
}
