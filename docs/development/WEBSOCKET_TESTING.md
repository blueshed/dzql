# DZQL WebSocket Testing Guide

**Canonical guide for testing DZQL applications from the WebSocket interface**

This document provides patterns for testing DZQL applications through the WebSocket client interface, including server spawning, real-time event handling, and Pinia store testing.

---

## Table of Contents

1. [WebSocket Testing Architecture](#websocket-testing-architecture)
2. [Server Spawning](#server-spawning)
3. [Basic WebSocket Tests](#basic-websocket-tests)
4. [Broadcast and Event Testing](#broadcast-and-event-testing)
5. [Pinia Store Testing with Vitest](#pinia-store-testing-with-vitest)
6. [Complete Examples](#complete-examples)
7. [Best Practices](#best-practices)

---

## WebSocket Testing Architecture

### Why Test Through WebSocket?

Testing through the WebSocket interface provides:
- **End-to-end validation**: Tests the complete stack (client → WebSocket → server → database)
- **Real-time behavior**: Tests broadcasts, notifications, and event handling
- **Client perspective**: Tests what users actually experience
- **Integration testing**: Validates JSON-RPC protocol, authentication, and permissions

### Testing Layers

```
┌─────────────────────────────────┐
│  Bun Test Runner                │
│  ├─ Spawns DZQL Server          │
│  ├─ Creates WebSocket Clients   │
│  └─ Validates Responses         │
└─────────────────────────────────┘
         ↓
┌─────────────────────────────────┐
│  DZQL Server (test mode)        │
│  ├─ WebSocket Handler           │
│  ├─ JSON-RPC Router             │
│  └─ Database Operations         │
└─────────────────────────────────┘
         ↓
┌─────────────────────────────────┐
│  PostgreSQL (test database)     │
│  ├─ Test data                   │
│  └─ Migrations applied          │
└─────────────────────────────────┘
```

---

## Server Spawning

### Server Lifecycle Management

Use the `TestServer` class to spawn and manage servers during tests:

```javascript
import { setupTestServer, teardownTestServer } from "./test-server.js";

let server;

beforeAll(async () => {
  // Spawn server and wait for it to be healthy
  server = await setupTestServer(3000);
});

afterAll(async () => {
  // Clean shutdown
  await teardownTestServer(server);
});
```

### How It Works

The `setupTestServer` function:
1. **Spawns** a new Bun process running your server
2. **Waits** for HTTP health check (`/health` endpoint)
3. **Validates** WebSocket connection is accepting connections
4. **Returns** server instance for test use

**Environment:** Server runs with `NODE_ENV=test` (suppresses logs, uses test database)

### Manual Server Control

For advanced scenarios:

```javascript
import { createTestServer } from "./test-server.js";

test("Custom server lifecycle", async () => {
  const server = createTestServer(3001); // Custom port

  try {
    await server.start();

    // Run tests
    const wsUrl = server.getWebSocketUrl();
    const ws = new WebSocket(wsUrl);
    // ... test logic

  } finally {
    await server.stop(); // Always cleanup
  }
});
```

### Health Check Details

**HTTP Health Check:**
```javascript
// Polls GET /health until 200 OK
const response = await fetch('http://localhost:3000/health');
expect(response.ok).toBe(true);
```

**WebSocket Health Check:**
```javascript
// Attempts WebSocket connection until successful
const ws = new WebSocket('ws://localhost:3000/ws');
await waitForOpen(ws); // Custom promise wrapper
ws.close();
```

---

## Basic WebSocket Tests

### Pattern 1: Raw WebSocket (JSON-RPC)

Test the low-level JSON-RPC protocol:

```javascript
import { test, expect } from "bun:test";

test("WebSocket login and CRUD operation", () => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket("ws://localhost:3000/ws");
    let messageId = 0;

    // Timeout safety
    const timeout = setTimeout(() => {
      reject(new Error("Test timeout"));
    }, 5000);

    ws.onopen = () => {
      // Send login request
      ws.send(JSON.stringify({
        jsonrpc: "2.0",
        method: "login_user",
        params: { email: "test@example.com", password: "password" },
        id: ++messageId
      }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      // Handle initial "connected" broadcast
      if (msg.method === "connected") {
        expect(msg.params.connection_id).toBeDefined();
        return;
      }

      // Handle login response
      if (msg.id === 1) {
        expect(msg.result.token).toBeDefined();
        expect(msg.result.profile.user_id).toBeDefined();

        // Now send a DZQL operation
        ws.send(JSON.stringify({
          jsonrpc: "2.0",
          method: "dzql.get.organisations",
          params: { id: 1 },
          id: ++messageId
        }));
      }

      // Handle DZQL response
      if (msg.id === 2) {
        expect(msg.result.id).toBe(1);
        expect(msg.result.name).toBeDefined();

        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    };

    ws.onerror = (error) => {
      clearTimeout(timeout);
      reject(error);
    };
  });
});
```

**Key Points:**
- Always handle the initial `"connected"` broadcast (sent on connection)
- Use sequential message IDs to correlate requests/responses
- Set timeouts to prevent hanging tests
- Clean up WebSocket connection

### Pattern 2: WebSocketManager (Recommended)

Use the DZQL client library for cleaner tests:

```javascript
import { WebSocketManager } from "dzql/client";

test("WebSocketManager login and operations", async () => {
  const ws = new WebSocketManager();

  try {
    // Connect (auto-detects ws://localhost:3000/ws in test env)
    await ws.connect();

    // Login
    const session = await ws.api.login_user({
      email: "test@example.com",
      password: "password"
    });

    expect(session.token).toBeDefined();
    expect(session.profile.user_id).toBeDefined();

    // CRUD operations
    const org = await ws.api.get.organisations({ id: 1 });
    expect(org.name).toBeDefined();

    const created = await ws.api.save.venues({
      name: "Test Venue",
      org_id: org.id
    });
    expect(created.id).toBeDefined();

    await ws.api.delete.venues({ id: created.id });

  } finally {
    ws.cleanDisconnect(); // Always cleanup
  }
});
```

**Advantages:**
- Automatic message ID handling
- Promise-based API (no manual event handlers)
- Cleaner error handling
- Built-in reconnection (can disable for tests)

---

## Broadcast and Event Testing

### Understanding DZQL Broadcasts

When data changes (INSERT/UPDATE/DELETE), DZQL sends broadcasts:

```javascript
{
  "jsonrpc": "2.0",
  "method": "venues:update",  // Format: {table}:{operation}
  "params": {
    "table": "venues",
    "op": "update",
    "pk": { "id": 1 },
    "before": { "id": 1, "name": "Old Name", ... },
    "after": { "id": 1, "name": "New Name", ... },
    "user_id": 123,
    "at": "2025-01-15T10:30:00Z"
  }
}
```

### Pattern: Testing Broadcasts

Test that changes trigger broadcasts to connected clients:

```javascript
test("Broadcast when record changes", async () => {
  const ws1 = new WebSocketManager(); // Client 1
  const ws2 = new WebSocketManager(); // Client 2

  try {
    // Connect both clients
    await Promise.all([
      ws1.connect(),
      ws2.connect()
    ]);

    // Login both
    await Promise.all([
      ws1.api.login_user({ email: "user1@test.com", password: "pass" }),
      ws2.api.login_user({ email: "user2@test.com", password: "pass" })
    ]);

    // Client 2 listens for broadcasts
    const broadcastReceived = new Promise((resolve) => {
      ws2.onBroadcast((method, params) => {
        if (method === "venues:update") {
          expect(params.after.name).toBe("Updated Name");
          resolve();
        }
      });
    });

    // Client 1 makes a change
    await ws1.api.save.venues({
      id: 1,
      name: "Updated Name"
    });

    // Wait for client 2 to receive broadcast
    await broadcastReceived;

  } finally {
    ws1.cleanDisconnect();
    ws2.cleanDisconnect();
  }
});
```

### Pattern: Waiting for First Message

Common pattern - wait for "connected" message before proceeding:

```javascript
test("Wait for connected message", async () => {
  const ws = new WebSocketManager();

  const connectedPromise = new Promise((resolve) => {
    const cleanup = ws.onBroadcast((method, params) => {
      if (method === "connected") {
        expect(params.connection_id).toBeDefined();
        expect(params.authenticated).toBe(false); // Not logged in yet
        cleanup(); // Remove listener
        resolve();
      }
    });
  });

  await ws.connect();
  await connectedPromise;

  // Now safe to proceed with operations
  await ws.api.login_user({ email: "test@test.com", password: "pass" });

  ws.cleanDisconnect();
});
```

### Pattern: Responding to Table Changes

Test application logic that responds to specific table changes:

```javascript
test("Respond to table change events", async () => {
  const ws = new WebSocketManager();
  await ws.connect();
  await ws.api.login_user({ email: "test@test.com", password: "pass" });

  // Application state
  let venueCache = {};

  // Setup event handler
  ws.onBroadcast((method, params) => {
    if (method === "venues:insert") {
      // Add new venue to cache
      venueCache[params.after.id] = params.after;
    } else if (method === "venues:update") {
      // Update existing venue in cache
      venueCache[params.after.id] = params.after;
    } else if (method === "venues:delete") {
      // Remove from cache
      delete venueCache[params.before.id];
    }
  });

  // Trigger changes
  const venue = await ws.api.save.venues({ name: "New Venue", org_id: 1 });

  // Wait for broadcast to process
  await new Promise(resolve => setTimeout(resolve, 100));

  // Verify cache updated
  expect(venueCache[venue.id]).toBeDefined();
  expect(venueCache[venue.id].name).toBe("New Venue");

  ws.cleanDisconnect();
});
```

---

## Pinia Store Testing with Vitest

### Overview

DZQL applications often use **Pinia** (Vue.js state management) with **Vitest** for testing. This section covers testing Pinia stores that interact with DZQL WebSocket.

### Pinia Store Pattern

Typical DZQL-connected Pinia store:

```javascript
// stores/venues.js
import { defineStore } from 'pinia';
import { ref } from 'vue';

export const useVenuesStore = defineStore('venues', () => {
  const venues = ref([]);
  const loading = ref(false);
  const error = ref(null);

  // Inject WebSocket (provided by app)
  let ws = null;

  function setWebSocket(wsInstance) {
    ws = wsInstance;

    // Listen to broadcasts
    ws.onBroadcast((method, params) => {
      if (method === 'venues:insert') {
        venues.value.push(params.after);
      } else if (method === 'venues:update') {
        const index = venues.value.findIndex(v => v.id === params.after.id);
        if (index !== -1) {
          venues.value[index] = params.after;
        }
      } else if (method === 'venues:delete') {
        venues.value = venues.value.filter(v => v.id !== params.before.id);
      }
    });
  }

  async function loadVenues() {
    loading.value = true;
    error.value = null;

    try {
      const result = await ws.api.search.venues({ filters: {} });
      venues.value = result.data;
    } catch (err) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  }

  async function createVenue(data) {
    const venue = await ws.api.save.venues(data);
    // Broadcast will update venues.value automatically
    return venue;
  }

  return {
    venues,
    loading,
    error,
    setWebSocket,
    loadVenues,
    createVenue
  };
});
```

### Vitest Setup for Pinia

```javascript
// vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom', // For Vue/Pinia
    setupFiles: ['./tests/setup.js']
  }
});
```

```javascript
// tests/setup.js
import { setActivePinia, createPinia } from 'pinia';
import { beforeEach } from 'vitest';

beforeEach(() => {
  // Create fresh Pinia instance for each test
  setActivePinia(createPinia());
});
```

### Full Lifecycle Test

Complete Pinia store test with WebSocket server:

```javascript
// tests/venues.store.test.js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { setupTestServer, teardownTestServer } from './test-server.js';
import { WebSocketManager } from 'dzql/client';
import { useVenuesStore } from '@/stores/venues.js';

describe('Venues Store', () => {
  let server;
  let ws;

  beforeAll(async () => {
    // Spawn DZQL server
    server = await setupTestServer(3000);
  });

  afterAll(async () => {
    await teardownTestServer(server);
  });

  beforeEach(async () => {
    // Fresh Pinia instance
    setActivePinia(createPinia());

    // Fresh WebSocket connection
    ws = new WebSocketManager();
    await ws.connect('ws://localhost:3000/ws');
    await ws.api.login_user({
      email: 'test@example.com',
      password: 'password'
    });
  });

  afterEach(() => {
    ws?.cleanDisconnect();
  });

  it('loads venues from WebSocket', async () => {
    const store = useVenuesStore();
    store.setWebSocket(ws);

    // Initial state
    expect(store.venues).toEqual([]);
    expect(store.loading).toBe(false);

    // Load venues
    await store.loadVenues();

    // Verify state updated
    expect(store.loading).toBe(false);
    expect(store.error).toBe(null);
    expect(store.venues.length).toBeGreaterThan(0);
    expect(store.venues[0].name).toBeDefined();
  });

  it('updates store when broadcast received', async () => {
    const store = useVenuesStore();
    store.setWebSocket(ws);

    // Load initial data
    await store.loadVenues();
    const initialCount = store.venues.length;

    // Create new venue (triggers broadcast)
    await store.createVenue({
      name: 'Test Venue',
      org_id: 1,
      address: '123 Main St'
    });

    // Wait for broadcast to process
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify store updated via broadcast
    expect(store.venues.length).toBe(initialCount + 1);
    expect(store.venues.find(v => v.name === 'Test Venue')).toBeDefined();
  });

  it('updates existing venue in store via broadcast', async () => {
    const store = useVenuesStore();
    store.setWebSocket(ws);

    // Load venues
    await store.loadVenues();
    const venue = store.venues[0];

    // Update via WebSocket (different client could do this)
    await ws.api.save.venues({
      id: venue.id,
      name: 'Updated Name'
    });

    // Wait for broadcast
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify store updated
    const updated = store.venues.find(v => v.id === venue.id);
    expect(updated.name).toBe('Updated Name');
  });

  it('removes deleted venue from store via broadcast', async () => {
    const store = useVenuesStore();
    store.setWebSocket(ws);

    // Create and load
    const created = await store.createVenue({
      name: 'To Delete',
      org_id: 1
    });
    await new Promise(resolve => setTimeout(resolve, 100));

    const beforeCount = store.venues.length;

    // Delete
    await ws.api.delete.venues({ id: created.id });
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify removed from store
    expect(store.venues.length).toBe(beforeCount - 1);
    expect(store.venues.find(v => v.id === created.id)).toBeUndefined();
  });

  it('handles errors gracefully', async () => {
    const store = useVenuesStore();
    store.setWebSocket(ws);

    // Trigger error (invalid operation)
    try {
      await ws.api.save.venues({
        // Missing required fields
      });
    } catch (err) {
      // Expected
    }

    // Store should still be usable
    await store.loadVenues();
    expect(store.error).toBe(null);
    expect(store.venues).toBeDefined();
  });
});
```

### Testing Reactive Updates

Test that Vue reactivity works with Pinia + WebSocket:

```javascript
import { nextTick } from 'vue';

it('triggers Vue reactivity on broadcast', async () => {
  const store = useVenuesStore();
  store.setWebSocket(ws);

  // Setup watcher
  let watchCount = 0;
  const stop = watch(() => store.venues.length, () => {
    watchCount++;
  });

  try {
    // Create venue
    await store.createVenue({ name: 'Test', org_id: 1 });
    await nextTick(); // Wait for Vue reactivity

    // Verify watcher fired
    expect(watchCount).toBeGreaterThan(0);
  } finally {
    stop();
  }
});
```

---

## Complete Examples

### Example 1: Multi-User Scenario

Test that multiple users see each other's changes:

```javascript
test("Multi-user real-time updates", async () => {
  const alice = new WebSocketManager();
  const bob = new WebSocketManager();

  try {
    // Connect both users
    await alice.connect();
    await bob.connect();

    await alice.api.login_user({ email: "alice@test.com", password: "pass" });
    await bob.api.login_user({ email: "bob@test.com", password: "pass" });

    // Bob listens for updates
    const bobGotUpdate = new Promise((resolve) => {
      bob.onBroadcast((method, params) => {
        if (method === "venues:update" && params.after.name === "Alice Updated This") {
          resolve(params);
        }
      });
    });

    // Alice makes a change
    await alice.api.save.venues({
      id: 1,
      name: "Alice Updated This"
    });

    // Verify Bob received broadcast
    const broadcast = await bobGotUpdate;
    expect(broadcast.user_id).not.toBe(await bob.api._profile()); // Alice made the change
    expect(broadcast.after.name).toBe("Alice Updated This");

  } finally {
    alice.cleanDisconnect();
    bob.cleanDisconnect();
  }
});
```

### Example 2: Permission Testing

Test that unauthorized users don't receive broadcasts:

```javascript
test("Broadcasts respect permissions", async () => {
  const userInOrg = new WebSocketManager();
  const userNotInOrg = new WebSocketManager();

  try {
    await userInOrg.connect();
    await userNotInOrg.connect();

    await userInOrg.api.login_user({ email: "insider@test.com", password: "pass" });
    await userNotInOrg.api.login_user({ email: "outsider@test.com", password: "pass" });

    let outsiderGotBroadcast = false;
    let insiderGotBroadcast = false;

    userNotInOrg.onBroadcast((method) => {
      if (method === "private_venues:update") {
        outsiderGotBroadcast = true;
      }
    });

    userInOrg.onBroadcast((method) => {
      if (method === "private_venues:update") {
        insiderGotBroadcast = true;
      }
    });

    // Make change to private resource
    await userInOrg.api.save.private_venues({
      id: 1,
      name: "Secret Change"
    });

    await new Promise(resolve => setTimeout(resolve, 200));

    // Verify only authorized user got broadcast
    expect(insiderGotBroadcast).toBe(true);
    expect(outsiderGotBroadcast).toBe(false);

  } finally {
    userInOrg.cleanDisconnect();
    userNotInOrg.cleanDisconnect();
  }
});
```

### Example 3: Reconnection Testing

Test that client reconnects and resumes:

```javascript
test("Client reconnects after server restart", async () => {
  let server = await setupTestServer(3001);
  const ws = new WebSocketManager({ maxReconnectAttempts: 3 });

  try {
    // Initial connection
    await ws.connect('ws://localhost:3001/ws');
    await ws.api.login_user({ email: "test@test.com", password: "pass" });

    // Verify connected
    const org = await ws.api.get.organisations({ id: 1 });
    expect(org.name).toBeDefined();

    // Simulate server restart
    await teardownTestServer(server);
    await new Promise(resolve => setTimeout(resolve, 500));
    server = await setupTestServer(3001);

    // Wait for reconnection
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify client reconnected (will need to re-auth)
    await ws.api.login_user({ email: "test@test.com", password: "pass" });
    const org2 = await ws.api.get.organisations({ id: 1 });
    expect(org2.name).toBeDefined();

  } finally {
    ws.cleanDisconnect();
    await teardownTestServer(server);
  }
});
```

---

## Best Practices

### 1. Always Clean Up

```javascript
afterEach(() => {
  ws?.cleanDisconnect(); // Prevent connection leaks
});

afterAll(async () => {
  await teardownTestServer(server); // Shutdown server
  await cleanupTestData(); // Remove test data
});
```

### 2. Use Timeouts

```javascript
test("Operation with timeout", async () => {
  const promise = ws.api.save.venues({ name: "Test" });
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Timeout")), 5000)
  );

  await Promise.race([promise, timeout]);
});
```

### 3. Isolate Tests

```javascript
// Use unique prefixes to avoid conflicts
const PREFIX = `TEST_${Date.now()}`;

const venue = await ws.api.save.venues({
  name: `${PREFIX}_Venue_1`,
  org_id: 1
});

// Cleanup
await sql`DELETE FROM venues WHERE name LIKE ${PREFIX + '%'}`;
```

### 4. Test Both Success and Failure

```javascript
test("Handle validation errors", async () => {
  await expect(
    ws.api.save.venues({
      name: "", // Invalid: empty name
      org_id: 1
    })
  ).rejects.toThrow("name cannot be empty");
});
```

### 5. Wait for Broadcasts

```javascript
// Don't assume broadcasts are instant
await ws.api.save.venues({ id: 1, name: "Updated" });

// Wait for broadcast to propagate
await new Promise(resolve => setTimeout(resolve, 100));

// Now check state
expect(store.venues[0].name).toBe("Updated");
```

### 6. Test Edge Cases

- Disconnection during operation
- Concurrent operations from multiple clients
- Permission changes mid-session
- Large payloads
- Rapid sequential operations

---

## Summary

**WebSocket Testing Checklist:**

- ✅ Spawn server with `setupTestServer()`
- ✅ Wait for "connected" message after connecting
- ✅ Use `WebSocketManager` for clean promise-based API
- ✅ Test broadcasts with `onBroadcast()`
- ✅ Clean up connections with `cleanDisconnect()`
- ✅ Test Pinia stores with fresh instances per test
- ✅ Use `nextTick()` for Vue reactivity assertions
- ✅ Always set timeouts to prevent hanging tests
- ✅ Test both success and error paths
- ✅ Clean up test data and server processes

**Key Patterns:**
1. Server spawning → Health check → Connect clients
2. Login → Operations → Verify responses
3. Listen for broadcasts → Trigger changes → Verify broadcasts received
4. Pinia setup → WebSocket injection → Test reactive updates
5. Multi-client scenarios → Permission testing → Concurrent operations

This guide provides the canonical patterns for testing DZQL applications end-to-end through the WebSocket interface.
