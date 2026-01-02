import { ServerWebSocket } from "bun";
import { handleRequest } from "./server.js"; // The secure router
import { verifyToken, signToken } from "./auth.js";
import { Database } from "./db.js";
import { wsLogger, authLogger, logWsAccess } from "./logger.js";

// WebSocket configuration
const WS_MAX_MESSAGE_SIZE = parseInt(process.env.WS_MAX_MESSAGE_SIZE || "1048576", 10); // 1MB default

interface WSContext {
  id?: string;  // Set in handleOpen
  userId?: number;
  subscriptions?: Set<string>; // Set of subscription IDs, set in handleOpen
  lastPing?: number;  // Set in handleOpen
  token?: string; // Token passed from URL query params during upgrade
}

export class WebSocketServer {
  private connections = new Map<string, ServerWebSocket<WSContext>>();
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  // Bun.serve websocket configuration object
  get websocket() {
    return {
      // WebSocket options for Bun
      perMessageDeflate: true,
      maxPayloadLength: WS_MAX_MESSAGE_SIZE,
      idleTimeout: 0, // No idle timeout - realtime connections stay open indefinitely

      // Handler hooks
      open: (ws: ServerWebSocket<WSContext>) => this.handleOpen(ws),
      message: (ws: ServerWebSocket<WSContext>, message: string) => this.handleMessage(ws, message),
      close: (ws: ServerWebSocket<WSContext>) => this.handleClose(ws),
      drain: (ws: ServerWebSocket<WSContext>) => {}
    };
  }

  // Legacy alias for backwards compatibility
  get handlers() {
    return this.websocket;
  }

  private async handleOpen(ws: ServerWebSocket<WSContext>) {
    const id = Math.random().toString(36).slice(2);
    const token = ws.data?.token;

    ws.data = {
      id,
      subscriptions: new Set(),
      lastPing: Date.now()
    };
    this.connections.set(id, ws);
    wsLogger.info(`Client ${id} connected`);

    // Subscribe to global broadcast channel initially
    ws.subscribe("broadcast");

    // If token was provided in URL, verify and authenticate
    let user: any = null;
    if (token) {
      try {
        const session = await verifyToken(token);
        ws.data.userId = session.userId;
        authLogger.info(`Client ${id} authenticated via token as user ${session.userId}`);

        // Fetch user profile using get_users
        try {
          const profile = await handleRequest(this.db, 'get_users', { id: session.userId }, session.userId);
          if (profile) {
            // Remove sensitive data
            const { password_hash, ...safeProfile } = profile;
            user = safeProfile;
          }
        } catch (e: any) {
          authLogger.error(`Failed to fetch profile for user ${session.userId}:`, e.message);
          // Still authenticated, just no profile
          user = { id: session.userId };
        }
      } catch (e: any) {
        authLogger.debug(`Client ${id} token verification failed:`, e.message);
        // Token invalid, user remains null (anonymous connection)
      }
    }

    // Send connection:ready message
    ws.send(JSON.stringify({
      jsonrpc: "2.0",
      method: "connection:ready",
      params: { user }
    }));
  }

  private async handleMessage(ws: ServerWebSocket<WSContext>, message: string) {
    ws.data.lastPing = Date.now(); // Update activity
    const start = Date.now();
    let method = "unknown";

    try {
      const req = JSON.parse(message);
      method = req.method || "unknown";

      // Handle Ping (Client-side heartbeat)
      if (req.method === 'ping') {
        ws.send(JSON.stringify({ id: req.id, result: 'pong' }));
        wsLogger.trace(`Client ${ws.data.id} ping`);
        return;
      }

      // Handle Auth Handshake
      if (req.method === 'auth') {
        try {
          const session = await verifyToken(req.params.token);
          ws.data.userId = session.userId;
          ws.send(JSON.stringify({ id: req.id, result: { success: true, userId: session.userId } }));
          authLogger.info(`Client ${ws.data.id} authenticated as user ${session.userId}`);
          logWsAccess("CALL", "auth", Date.now() - start, session.userId);
        } catch (e: any) {
          ws.send(JSON.stringify({ id: req.id, error: { code: 'UNAUTHORIZED', message: e.message } }));
          logWsAccess("CALL", "auth", Date.now() - start, null, e.message);
        }
        return;
      }

      // Require Auth for other methods?
      // V2 spec says `p_user_id` is passed to functions.
      // If not auth'd, we can pass null or throw.
      const userId = ws.data.userId || null;

      // Handle RPC
      if (req.method) {
        if (req.method.startsWith("subscribe_")) {
          // Handle Subscription Registration
          const subscribableName = req.method.replace("subscribe_", "");
          const getFnName = `get_${subscribableName}`;

          try {
            // Call the get_ function to fetch initial data
            const snapshot = await handleRequest(this.db, getFnName, req.params, userId);

            // Register subscription
            const subId = `${subscribableName}:${JSON.stringify(req.params)}`;
            ws.data.subscriptions?.add(subId);

            // Return snapshot with subscription_id and schema
            ws.send(JSON.stringify({
              id: req.id,
              result: {
                subscription_id: subId,
                data: snapshot.data,
                schema: snapshot.schema
              }
            }));

            logWsAccess("SUB", req.method, Date.now() - start, userId);
          } catch (e: any) {
            ws.send(JSON.stringify({
              id: req.id,
              error: { code: e.code || 'INTERNAL_ERROR', message: e.message }
            }));
            logWsAccess("SUB", req.method, Date.now() - start, userId, e.message);
          }
        } else {
          // Normal Function Call
          try {
            const result = await handleRequest(this.db, req.method, req.params, userId);

            // Auto-generate token for auth methods
            if (req.method === 'login_user' || req.method === 'register_user') {
              const token = await signToken({ user_id: result.user_id, role: 'user' });
              // Update connection's userId for subsequent calls
              ws.data.userId = result.user_id;
              // Return profile + token
              ws.send(JSON.stringify({ id: req.id, result: { ...result, token } }));
              logWsAccess("CALL", req.method, Date.now() - start, result.user_id);
            } else {
              ws.send(JSON.stringify({ id: req.id, result }));
              logWsAccess("CALL", req.method, Date.now() - start, userId);
            }
          } catch (e: any) {
            ws.send(JSON.stringify({
              id: req.id,
              error: { code: e.code || 'INTERNAL_ERROR', message: e.message }
            }));
            logWsAccess("CALL", req.method, Date.now() - start, userId, e.message);
          }
        }
      }

    } catch (e: any) {
      wsLogger.error(`Error processing message from ${ws.data.id}:`, e.message);
      logWsAccess("CALL", method, Date.now() - start, ws.data.userId, e.message);
      // Try to send error back if JSON parse didn't fail
      try {
        const reqId = JSON.parse(message).id;
        ws.send(JSON.stringify({ id: reqId, error: { code: 'INTERNAL_ERROR', message: e.message } }));
      } catch (ignore) {}
    }
  }

  private handleClose(ws: ServerWebSocket<WSContext>) {
    if (ws.data.id) {
      this.connections.delete(ws.data.id);
    }
    wsLogger.info(`Client ${ws.data.id} disconnected`);
  }

  public broadcast(message: string) {
    // Use Bun's native publish for efficiency
    // 'broadcast' topic is subscribed by all on connect
    // In V2, we might have specific topics per subscription key
    // server.publish("broadcast", message);
    // Since this class doesn't hold the 'server' instance directly,
    // we iterate or need to pass server in.
    // For now, iteration is fine for prototype.
    for (const ws of this.connections.values()) {
      ws.send(message);
    }
  }
}
