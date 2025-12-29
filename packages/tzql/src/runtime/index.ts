import { serve } from "bun";
import { config } from "dotenv";
import { Database } from "./db.js";
import { WebSocketServer } from "./ws.js";
import { loadManifest } from "./manifest_loader.js";
import { readFileSync } from "fs";
import { resolve } from "path";

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
  console.log(`[Runtime] Loaded Manifest v${manifest.version}`);
} catch (e) {
  console.warn(`[Runtime] Warning: Could not load manifest from ${MANIFEST_PATH}. Ensure you have compiled the project.`);
}

// 3. Initialize WebSocket Server
const wsServer = new WebSocketServer(db);

// 4. Start Commit Listener (Realtime)
async function startListener() {
  console.log("[Runtime] Setting up LISTEN on dzql_v2 channel...");
  await db.listen("dzql_v2", async (payload) => {
    console.log(`[Runtime] RAW NOTIFY received:`, payload);
    try {
      const { commit_id } = JSON.parse(payload);
      console.log(`[Runtime] Received Commit: ${commit_id}`);

      // Fetch events
      const events = await db.query(`
        SELECT * FROM dzql_v2.events
        WHERE commit_id = $1
        ORDER BY id ASC
      `, [commit_id]);

      for (const event of events) {
        // Broadcast
        const message = JSON.stringify({
          jsonrpc: "2.0",
          method: "subscription:event",
          params: {
            event: {
              table: event.table_name,
              op: event.op,
              pk: event.pk,
              data: event.data,
              // old_data is filtered out
              user_id: event.user_id
            }
          }
        });
        wsServer.broadcast(message);
      }
    } catch (e) {
      console.error("[Runtime] Listener Error:", e);
    }
  });
  console.log("[Runtime] Listening for DB Events...");
}

// Wait for listener to be ready before starting server
await startListener();

// 5. Start Web Server
const server = serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    // Extract token from query params for WebSocket connections
    const token = url.searchParams.get("token");

    if (server.upgrade(req, { data: { token } })) {
        return;
    }
    return new Response("TZQL Runtime Active", { status: 200 });
  },
  websocket: wsServer.handlers
});

console.log(`[Runtime] Server listening on port ${PORT}`);
