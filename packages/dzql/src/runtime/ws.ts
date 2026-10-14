import { ServerWebSocket } from "bun";
import { handleRequest } from "./server.js";
import { verifyToken, signToken } from "./auth.js";
import { Database } from "./db.js";
import { wsLogger, authLogger, logWsAccess } from "./logger.js";
import { getManifest } from "./manifest_loader.js";
import {
  registerSubscription,
  removeConnectionSubscriptions,
  unregisterSubscriptionByParams,
  cacheSubscribableMetadata
} from "./subscriptions.js";

const WS_MAX_MESSAGE_SIZE = parseInt(process.env.WS_MAX_MESSAGE_SIZE || "1048576", 10);

interface WSContext {
  id?: string;
  userId?: number;
  lastPing?: number;
  token?: string;
}

export class WebSocketServer {
  private connections = new Map<string, ServerWebSocket<WSContext>>();
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  get websocket() {
    return {
      perMessageDeflate: true,
      maxPayloadLength: WS_MAX_MESSAGE_SIZE,
      idleTimeout: 0,
      open: (ws: ServerWebSocket<WSContext>) => this.handleOpen(ws),
      message: (ws: ServerWebSocket<WSContext>, message: string) => this.handleMessage(ws, message),
      close: (ws: ServerWebSocket<WSContext>) => this.handleClose(ws),
      drain: () => {}
    };
  }

  get handlers() {
    return this.websocket;
  }

  private async handleOpen(ws: ServerWebSocket<WSContext>) {
    const id = Math.random().toString(36).slice(2);
    const token = ws.data?.token;

    ws.data = {
      id,
      lastPing: Date.now()
    };
    this.connections.set(id, ws);
    wsLogger.info(`Client ${id} connected`);

    let user: any = null;
    if (token) {
      try {
        const session = await verifyToken(token);
        ws.data.userId = session.userId;
        authLogger.info(`Client ${id} authenticated via token as user ${session.userId}`);

        try {
          const profile = await handleRequest(this.db, 'get_users', { id: session.userId }, session.userId);
          if (profile) {
            const { password_hash, ...safeProfile } = profile;
            user = safeProfile;
          }
        } catch (e: any) {
          authLogger.error(`Failed to fetch profile for user ${session.userId}:`, e.message);
          user = { id: session.userId };
        }
      } catch (e: any) {
        authLogger.debug(`Client ${id} token verification failed:`, e.message);
      }
    }

    ws.send(JSON.stringify({
      jsonrpc: "2.0",
      method: "connection:ready",
      params: { user }
    }));
  }

  private async handleMessage(ws: ServerWebSocket<WSContext>, message: string) {
    ws.data.lastPing = Date.now();
    const start = Date.now();
    let method = "unknown";

    try {
      const req = JSON.parse(message);
      method = req.method || "unknown";

      if (req.method === 'ping') {
        ws.send(JSON.stringify({ id: req.id, result: 'pong' }));
        return;
      }

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

      const userId = ws.data.userId || null;
      const connectionId = ws.data.id!;

      if (req.method) {
        if (req.method.startsWith("subscribe_")) {
          const subscribableName = req.method.replace("subscribe_", "");
          const getFnName = `get_${subscribableName}`;

          try {
            const snapshot = await handleRequest(this.db, getFnName, req.params, userId);

            // Get metadata from manifest and cache it
            const manifest = getManifest();
            const subscribable = manifest.subscribables[subscribableName];
            if (subscribable) {
              cacheSubscribableMetadata(subscribableName, {
                scopeTables: subscribable.scopeTables || [],
                pathMapping: {}, // TODO: build from includes
                rootEntity: subscribable.root?.entity || null
              });
            }

            // Register subscription in central registry
            const subscriptionId = registerSubscription(
              subscribableName,
              userId,
              connectionId,
              req.params || {}
            );

            ws.send(JSON.stringify({
              id: req.id,
              result: {
                subscription_id: subscriptionId,
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
        } else if (req.method.startsWith("unsubscribe_")) {
          const subscribableName = req.method.replace("unsubscribe_", "");
          const removed = unregisterSubscriptionByParams(subscribableName, connectionId, req.params || {});
          ws.send(JSON.stringify({ id: req.id, result: { success: removed } }));
          logWsAccess("UNSUB", req.method, Date.now() - start, userId);
        } else {
          try {
            const result = await handleRequest(this.db, req.method, req.params, userId);

            if (req.method === 'login_user' || req.method === 'register_user') {
              const token = await signToken({ user_id: result.user_id, role: 'user' });
              ws.data.userId = result.user_id;
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
      try {
        const reqId = JSON.parse(message).id;
        ws.send(JSON.stringify({ id: reqId, error: { code: 'INTERNAL_ERROR', message: e.message } }));
      } catch (ignore) {}
    }
  }

  private handleClose(ws: ServerWebSocket<WSContext>) {
    const connectionId = ws.data.id;
    if (connectionId) {
      this.connections.delete(connectionId);
      removeConnectionSubscriptions(connectionId);
    }
    wsLogger.info(`Client ${connectionId} disconnected`);
  }

  /**
   * Send message to a specific connection
   */
  public toConnection(connectionId: string, message: string): boolean {
    const ws = this.connections.get(connectionId);
    if (ws && ws.readyState === 1) { // WebSocket.OPEN
      ws.send(message);
      return true;
    }
    return false;
  }

  /**
   * Get all connection IDs for a specific user
   */
  public getConnectionsByUserId(userId: number): string[] {
    const connectionIds: string[] = [];
    for (const [id, ws] of this.connections.entries()) {
      if (ws.data?.userId === userId) {
        connectionIds.push(id);
      }
    }
    return connectionIds;
  }

  /**
   * Broadcast to all connections (for backwards compatibility)
   */
  public broadcast(message: string): void {
    for (const ws of this.connections.values()) {
      ws.send(message);
    }
  }
}
