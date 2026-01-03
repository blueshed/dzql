import { serve } from "bun";
import { config } from "dotenv";
import { Database } from "./db.js";
import { WebSocketServer } from "./ws.js";
import { loadManifest } from "./manifest_loader.js";
import { readFileSync } from "fs";
import { resolve } from "path";
import { runtimeLogger, notifyLogger, serverLogger } from "./logger.js";
import { getSubscriptionsBySubscribable } from "./subscriptions.js";

// Re-export JS function registration API for custom functions
export { registerJsFunction, type JsFunctionHandler, type JsFunctionContext } from "./js_functions.js";

// Load .env file if present
config();

// Configuration
const PORT = process.env.PORT || 3000;
const DB_URL = process.env.DATABASE_URL || "postgres://dzql_test:dzql_test@localhost:5433/dzql_test";
const MANIFEST_PATH = process.env.MANIFEST_PATH || "./dist/runtime/manifest.json";

// 1. Initialize DB
const db = new Database(DB_URL);

// 2. Load Manifest
try {
  const manifestPath = resolve(process.cwd(), MANIFEST_PATH);
  const manifestContent = readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(manifestContent);
  loadManifest(manifest);
  runtimeLogger.info(`Loaded Manifest v${manifest.version}`);
} catch (e) {
  runtimeLogger.warn(`Could not load manifest from ${MANIFEST_PATH}. Ensure you have compiled the project.`);
}

// 3. Initialize WebSocket Server
const wsServer = new WebSocketServer(db);

/**
 * Process event notifications.
 * Sends events to connections based on:
 * 1. Subscriptions matched by affected_keys
 * 2. Users in notify_users (from entity notification paths)
 *
 * Each connection receives the event at most once, even if matched by both.
 */
function processEventNotifications(event: {
  table: string;
  op: string;
  pk: Record<string, unknown>;
  data: Record<string, unknown>;
  user_id: number | null;
  affected_keys: string[];
  notify_users: number[];
}) {
  const { table, op, pk, data, affected_keys, notify_users } = event;

  notifyLogger.debug(`processEventNotifications called for ${table}:${op}`);
  notifyLogger.debug(`affected_keys: ${JSON.stringify(affected_keys)}`);
  notifyLogger.debug(`notify_users: ${JSON.stringify(notify_users)}`);

  // Track which connections we've already notified to avoid duplicates
  const notifiedConnections = new Set<string>();

  // Build the event message for entity broadcasts
  const entityEventMessage = JSON.stringify({
    jsonrpc: "2.0",
    method: `${table}:${op}`,
    params: { table, op, pk, data }
  });

  // 1. Send to users in notify_users list (entity notifications)
  if (notify_users && notify_users.length > 0) {
    for (const userId of notify_users) {
      const connectionIds = wsServer.getConnectionsByUserId(userId);
      for (const connectionId of connectionIds) {
        if (!notifiedConnections.has(connectionId)) {
          const sent = wsServer.toConnection(connectionId, entityEventMessage);
          if (sent) {
            notifiedConnections.add(connectionId);
            notifyLogger.debug(`Sent entity event to user ${userId} connection ${connectionId.slice(0, 8)}...`);
          }
        }
      }
    }
  }

  // 2. Send entity broadcasts to connections with matching subscriptions
  // Connections that have bound to a subscribable whose affected_key matches get the broadcast
  if (affected_keys && affected_keys.length > 0) {
    const subscriptionsByName = getSubscriptionsBySubscribable();

    for (const [subscribableName, subs] of subscriptionsByName.entries()) {
      for (const sub of subs) {
        const paramValues = Object.values(sub.params);
        const subKey = `${subscribableName}:${paramValues.join(':')}`;

        if (affected_keys.includes(subKey)) {
          // Send entity broadcast (not subscription:event) so global dispatcher can route it
          if (!notifiedConnections.has(sub.connection_id)) {
            const sent = wsServer.toConnection(sub.connection_id, entityEventMessage);
            if (sent) {
              notifiedConnections.add(sub.connection_id);
              notifyLogger.debug(`Sent entity broadcast to ${sub.connection_id.slice(0, 8)}... via ${subscribableName} (${table}:${op})`);
            }
          }
        }
      }
    }
  }

  notifyLogger.debug(`Notified ${notifiedConnections.size} connection(s) with entity event`);
}

// 4. Start Commit Listener (Realtime)
async function startListener() {
  runtimeLogger.info("Setting up LISTEN on dzql_v2 channel...");
  await db.listen("dzql_v2", async (payload) => {
    notifyLogger.debug(`RAW NOTIFY received:`, payload);
    try {
      const { commit_id } = JSON.parse(payload);
      notifyLogger.debug(`Received Commit: ${commit_id}`);

      // Fetch events
      const events = await db.query(`
        SELECT * FROM dzql_v2.events
        WHERE commit_id = $1
        ORDER BY id ASC
      `, [commit_id]);

      notifyLogger.debug(`Fetched ${events.length} events for commit ${commit_id}`);
      for (const event of events) {
        notifyLogger.debug(`Processing event: ${event.table_name}:${event.op}`);
        processEventNotifications({
          table: event.table_name,
          op: event.op,
          pk: event.pk,
          data: event.data,
          user_id: event.user_id,
          affected_keys: event.affected_keys || [],
          notify_users: event.notify_users || []
        });
      }
    } catch (e: any) {
      notifyLogger.error("Listener Error:", e.message);
    }
  });
  runtimeLogger.info("Listening for DB Events...");
}

// Wait for listener to be ready before starting server
await startListener();

// 5. Start Web Server
const server = serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") ?? undefined;

    if (server.upgrade(req, { data: { token } })) {
      return;
    }
    return new Response("DZQL Runtime Active", { status: 200 });
  },
  websocket: wsServer.handlers
});

serverLogger.info(`Server listening on port ${PORT}`);
