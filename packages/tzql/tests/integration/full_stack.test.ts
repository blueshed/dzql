import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { spawn, spawnSync } from "bun";
import { V2TestDatabase } from "./setup.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";

// Tests may run from repo root or packages/tzql directory
// Use import.meta to get the correct path relative to this file
const TEST_DIR = dirname(new URL(import.meta.url).pathname);
const PACKAGE_ROOT = resolve(TEST_DIR, "../..");
const DIST_ROOT = resolve(PACKAGE_ROOT, "dist");

// Compile the venues example before tests run
function compileVenuesExample() {
  const examplePath = resolve(PACKAGE_ROOT, "examples/venues.ts");
  const compilerPath = resolve(PACKAGE_ROOT, "src/cli/index.ts");

  console.log("[Test] Compiling venues example...");
  const result = spawnSync({
    cmd: ["bun", "run", compilerPath, "compile", examplePath, "-o", DIST_ROOT],
    cwd: PACKAGE_ROOT,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe"
  });

  if (result.exitCode !== 0) {
    console.error("[Test] Compile failed:", new TextDecoder().decode(result.stderr));
    return false;
  }
  console.log("[Test] Compile output:", new TextDecoder().decode(result.stdout));
  return true;
}

// Pre-process the generated client to fix the import path for testing
function patchGeneratedClient() {
  const clientPath = resolve(DIST_ROOT, "client/ws.ts");
  if (!existsSync(clientPath)) return;

  const content = readFileSync(clientPath, "utf8");
  if (content.includes("from 'tzql/client'")) {
    const tzqlClientPath = resolve(PACKAGE_ROOT, "src/client/index.ts");
    const patched = content.replace(
      "from 'tzql/client'",
      `from '${tzqlClientPath}'`
    );
    writeFileSync(clientPath, patched);
  }
}

// Compile and check if dist exists
const COMPILE_SUCCESS = compileVenuesExample();
const DIST_EXISTS = COMPILE_SUCCESS && existsSync(resolve(DIST_ROOT, "runtime/manifest.json"));

if (DIST_EXISTS) {
  patchGeneratedClient();
}

describe.skipIf(!DIST_EXISTS)("Full Stack V2 Integration (Runtime + Client + Pinia)", () => {
  let db: V2TestDatabase;
  let sql: any;
  let serverProcess: any;
  let useVenueDetailStore: any;
  let ws: any;

  beforeAll(async () => {
    // Dynamic imports for optional dependencies
    const { createPinia, setActivePinia } = await import("pinia");
    const clientPath = resolve(DIST_ROOT, "client/ws.ts");
    ws = (await import(clientPath)).ws;

    // 1. Setup DB
    db = new V2TestDatabase();
    sql = await db.setup();

    // Apply Schema (Core + Venues)
    const fs = require('fs');
    const path = require('path');
    const distPath = resolve(DIST_ROOT, 'db/migrations');
    const coreSql = fs.readFileSync(path.join(distPath, '000_core.sql'), 'utf8');
    const schemaFiles = fs.readdirSync(distPath)
        .filter((f: string) => f.includes('_schema.sql'))
        .sort().reverse();
    const subscribableFiles = fs.readdirSync(distPath)
        .filter((f: string) => f.includes('_subscribables.sql'))
        .sort().reverse();
    console.log(`[Test] Loading schema file: ${schemaFiles[0]}`);
    const entitySql = fs.readFileSync(path.join(distPath, schemaFiles[0]), 'utf8');

    await db.applySQL(coreSql);
    await db.applySQL(entitySql);

    // Load subscribable SQL functions
    if (subscribableFiles.length > 0) {
      console.log(`[Test] Loading subscribables file: ${subscribableFiles[0]}`);
      const subscribableSql = fs.readFileSync(path.join(distPath, subscribableFiles[0]), 'utf8');
      await db.applySQL(subscribableSql);
    }

    // 2. Start Runtime Server
    const runtimePath = new URL("../../src/runtime/index.ts", import.meta.url).pathname;
    const manifestPath = resolve(DIST_ROOT, 'runtime/manifest.json');

    const testDbUrl = db.baseUrl.replace(/\/[^/]*$/, `/${db.dbName}`);
    console.log("[Test] Server DATABASE_URL:", testDbUrl);
    console.log("[Test] MANIFEST_PATH:", manifestPath);
    serverProcess = spawn({
      cmd: ["bun", "run", runtimePath],
      env: {
        ...process.env,
        PORT: "3001", // Test port
        DATABASE_URL: testDbUrl,
        MANIFEST_PATH: manifestPath,
        JWT_SECRET: "test-secret",
        NODE_ENV: "development", // Override test environment so logger outputs INFO level
        LOG_CATEGORIES: "server:info,runtime:info" // Ensure server startup message is visible
      },
      stdout: "pipe",
      stderr: "pipe"
    });

    // Pipe stderr to console for debugging
    const stderrReader = serverProcess.stderr.getReader();
    (async () => {
        while (true) {
            const { done, value } = await stderrReader.read();
            if (done) break;
            console.error("[Server ERR]", new TextDecoder().decode(value));
        }
    })();

    // Pipe stdout to console (keep reading in background)
    let serverReady = false;
    const serverReadyPromise = new Promise<void>((resolve) => {
      const stdoutReader = serverProcess.stdout.getReader();
      (async () => {
          while (true) {
              const { done, value } = await stdoutReader.read();
              if (done) break;
              const text = new TextDecoder().decode(value);
              console.log("[Server]", text.trim());
              if ((text.includes("Server listening") || text.includes("listening on port")) && !serverReady) {
                serverReady = true;
                resolve();
              }
          }
      })();
    });

    // Wait for server to be ready
    await serverReadyPromise;

    // 3. Setup Pinia
    setActivePinia(createPinia());

    // Import generated store
    const storePath = resolve(DIST_ROOT, "client/stores/useVenueDetailStore.ts");
    const mod = await import(storePath);
    useVenueDetailStore = mod.useVenueDetailStore;
  });

  afterAll(async () => {
    if (serverProcess) serverProcess.kill();
    await db.teardown();
  });

  test("should receive connection:ready on connect (anonymous)", async () => {
    // Connect Client without token
    await ws.connect("ws://localhost:3001/ws");

    // Wait briefly for connection:ready message
    await new Promise(r => setTimeout(r, 100));

    // Should be ready but no user
    expect(ws.ready).toBe(true);
    expect(ws.user).toBe(null);
  });

  test("should register and login", async () => {
    // Register
    const reg = await ws.register({ email: "tester@example.com", password: "password123" });
    expect(reg.user_id).toBeDefined();

    // Login
    const login = await ws.login({ email: "tester@example.com", password: "password123" });
    expect(login.token).toBeDefined();
  });

  test("should receive connection:ready with user profile on reconnect with token", async () => {
    // Login to get a token
    const login = await ws.login({ email: "tester@example.com", password: "password123" });
    const token = login.token;
    expect(token).toBeDefined();

    // Close current connection
    ws.ws?.close();
    await new Promise(r => setTimeout(r, 100));

    // Reconnect with token in URL (simulating what browser does with localStorage)
    await ws.connect(`ws://localhost:3001/ws?token=${encodeURIComponent(token)}`);

    // Wait for connection:ready message
    await new Promise(r => setTimeout(r, 200));

    // Should be ready with user profile
    expect(ws.ready).toBe(true);
    expect(ws.user).not.toBe(null);
    expect(ws.user.email).toBe("tester@example.com");
    // Password hash should be stripped
    expect(ws.user.password_hash).toBeUndefined();
  });

  test("should sync data via Pinia store", async () => {
    const store = useVenueDetailStore();

    // 1. Create Data (via SDK)
    // We need an Org first because Venue requires it
    const org = await ws.api.save_organisations({ name: "Test Org" });

    // VERIFY GRAPH RULE: Check acts_for
    const memberships = await sql`SELECT * FROM acts_for WHERE org_id = ${org.id}`;
    console.log("[Test] Memberships:", memberships);
    if (memberships.length === 0) {
        console.error("[Test] Graph Rule Failed: No acts_for created!");
    } else {
        console.log("[Test] Active:", memberships[0].active);
    }

    // Create Venue
    const venue = await ws.api.save_venues({ name: "Live Sync Venue", org_id: org.id, address: "123 Web St" });

    // 2. Bind Store (async - waits for first data)
    const doc = await store.bind({ venue_id: venue.id });

    // Vue reactivity auto-unwraps refs when accessed from a reactive object
    // So doc.loading is already the value (boolean), not the ref
    expect(doc.loading).toBe(false);
    // Verify subscription received data with correct structure
    expect(doc.data?.venues?.name).toBe("Live Sync Venue");
    expect(doc.data?.venues?.org_id).toBe(org.id);
    expect(doc.data?.org?.name).toBe("Test Org");
    expect(doc.data?.sites).toEqual([]);

    // 3. Update Data (via SDK) -> Should trigger Realtime Update
    // Note: org_id needed for permission check on update
    const updated = await ws.api.save_venues({ id: venue.id, org_id: org.id, name: "Updated via WebSocket" });
    expect(updated.name).toBe("Updated via WebSocket");

    // Check if events were written to the database
    const events = await sql`SELECT * FROM dzql_v2.events ORDER BY id DESC LIMIT 5`;
    console.log("[Test] Events in DB:", events.length, events.map((e: any) => ({ table: e.table_name, op: e.op, data_name: e.data?.name })));

    // Manually trigger a NOTIFY to test if listener works
    console.log("[Test] Manually triggering pg_notify...");
    await sql`SELECT pg_notify('dzql_v2', '{"commit_id": 999}')`;

    // Wait for event propagation
    await new Promise(r => setTimeout(r, 500));

    // 4. Verify Store Update via Realtime
    console.log("[Test] After realtime wait - doc.data?.venues?.name:", doc.data?.venues?.name);
    expect(doc.data?.venues?.name).toBe("Updated via WebSocket");
  });
});
