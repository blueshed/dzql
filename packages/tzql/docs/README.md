# DZQL: The Compile-Only Realtime Database Framework

DZQL ("Database Zero Query Language") is a PostgreSQL-native framework for building realtime, reactive applications without the runtime overhead or complexity of traditional ORMs or BaaS solutions.

## Quick Start

The fastest way to get started is with `bun create`:

```bash
bun create dzql my-app
cd my-app
bun install
bun run db:rebuild
bun run dev
```

This creates a full-stack app with Vue/Vite frontend, DZQL server, and PostgreSQL database.

## The Problem

Building realtime apps is hard. You typically have to:
1.  **Sync State:** Manually keep your frontend Pinia/Redux store in sync with your backend database.
2.  **Manage Permissions:** Re-implement row-level security in your API layer (and hope it matches your DB).
3.  **Handle Atomicity:** Ensure that complex operations (e.g., "Create Order + Reserve Inventory + Notify User") happen in a single transaction.
4.  **Optimistic Updates:** Write complex client-side logic to "guess" the server's response, often leading to data divergence.

## The DZQL Solution

DZQL takes a radically different approach: **Compilation**.

Instead of a heavy runtime framework, you define your **Domain Schema** (Entities, Relationships, Permissions) in a simple TypeScript configuration. DZQL compiles this definition into:

1.  **Optimized SQL:** Specialized PostgreSQL functions (`save_order`, `get_product`) with *inlined* permission checks and *atomic* graph operations.
2.  **Type-Safe Client SDK:** A generated TypeScript client that knows your exact API surface.
3.  **Smart Pinia Stores:** Generated Vue stores that automatically handle realtime synchronization using atomic "Patch Events" from the database.

### Key Features

*   **Zero Runtime Interpretation:** No slow ORM query builders. Everything is compiled to native PL/pgSQL.
*   **Security by Construction:** The runtime is a "dumb" gateway that routes requests by OID allowlist. It *cannot* execute arbitrary SQL.
*   **Atomic Everything:** Complex graph operations (cascading creates/deletes) happen in a single database transaction.
*   **Realtime by Default:** Every database write emits an atomic event batch. The client SDK automatically patches your local state. No "refetching" required.
*   **JavaScript/TypeScript Native:** Define your schema in code you understand, get full type safety end-to-end.

## Manual Setup

If you prefer to set up manually instead of using `bun create dzql`:

### 1. Define your Domain (`domain.ts`)

```typescript
export const entities = {
  posts: {
    schema: { id: 'serial PRIMARY KEY', title: 'text', author_id: 'int' },
    permissions: { create: ['@author_id == @user_id'] } // Inlined SQL security
  }
};

export const subscribables = {
  post_feed: {
    root: { entity: 'posts' },
    scopeTables: ['posts']
  }
};
```

### 2. Compile

```bash
bunx dzql domain.ts -o generated
```

### 3. Use in Client

```typescript
import { usePostFeedStore } from '@generated/client/stores';

const feed = usePostFeedStore();
// Automatically fetches data AND subscribes to realtime updates
// bind() is async - awaits until first data arrives
const { data, loading } = await feed.bind({ user_id: 1 }); 
// data.value is now populated
```

## Architecture

*   **Compiler:** CLI tool that analyzes your domain and generates artifacts.
*   **Runtime:** A lightweight Bun/Node server that handles Auth (JWT) and WebSocket connection pooling.
*   **Client:** A robust WebSocket SDK that manages reconnection and dispatches atomic patches to stores.
*   **Namespace:** Direct database access for CLI tools like `invokej`.

## Package Exports

```typescript
import { ... } from 'dzql';           // Runtime server
import { ... } from 'dzql/client';    // WebSocket client SDK  
import { ... } from 'dzql/compiler';  // CLI compiler
import { DzqlNamespace } from 'dzql/namespace';  // CLI/invokej integration
```

## Client Connection & Authentication

When a client connects to the WebSocket server, it immediately receives a `connection:ready` message containing the authenticated user profile (or `null` if not authenticated).

### Connection Flow

1. Client connects with optional `?token=...` in URL
2. Server validates token (if present) and fetches user profile
3. Server sends: `{"method": "connection:ready", "params": {"user": {...} | null}}`
4. Client knows auth state immediately

### Client API

```typescript
import { WebSocketManager } from 'dzql/client';

const ws = new WebSocketManager();
await ws.connect('ws://localhost:3000/ws');

// Check connection state
console.log(ws.ready);  // true after connection:ready received
console.log(ws.user);   // user profile object or null

// Register callback for ready state
ws.onReady((user) => {
  if (user) {
    console.log('Authenticated as:', user.email);
  } else {
    console.log('Anonymous connection');
  }
});

// Authentication methods
await ws.login({ email: '...', password: '...' });  // Stores token in localStorage
await ws.logout();  // Clears token and user state
```

### Vue/Pinia Usage Pattern

```vue
<template>
  <div v-if="!ws.ready">Loading...</div>
  <LoginModal v-else-if="!ws.user" />
  <RouterView v-else />
</template>
```

## Generated Pinia Subscribable Stores

DZQL generates Pinia stores for each subscribable that handle:
- Initial data fetch via WebSocket subscription
- Automatic realtime patching when related data changes
- Deduplication of subscriptions by parameter key

### Store Structure

Each generated store exports:

```typescript
const store = useVenueDetailStore();

// Main API
store.bind(params)    // Async - subscribes and returns { data, loading, ready }
store.unbind(params)  // Unsubscribes and removes document from store
store.documents       // Ref containing all bound documents keyed by JSON.stringify(params)
```

### Basic Usage

```typescript
import { useVenueDetailStore } from '@/generated/client/stores';

const store = useVenueDetailStore();

// bind() is async - returns when first data arrives
const { data, loading, ready } = await store.bind({ venue_id: 1 });

// data is reactive and contains the document
console.log(data); // { id: 1, name: 'My Venue', sites: [...], org: {...} }

// loading is false after first data
console.log(loading); // false

// Subsequent calls with same params return cached subscription
const same = await store.bind({ venue_id: 1 }); // Returns immediately, no new subscription
```

### Vue Component Patterns

**Pattern 1: Top-level await (recommended with `<Suspense>`)**

```vue
<script setup>
import { useVenueDetailStore } from '@/generated/client/stores';

const props = defineProps(['venueId']);
const store = useVenueDetailStore();

// Await at top level - component suspends until data arrives
const { data } = await store.bind({ venue_id: props.venueId });
</script>

<template>
  <!-- data is guaranteed to be populated -->
  <h1>{{ data.name }}</h1>
  <p>Organization: {{ data.org.name }}</p>
  <ul>
    <li v-for="site in data.sites" :key="site.id">
      {{ site.name }} ({{ site.allocations.length }} allocations)
    </li>
  </ul>
</template>
```

**Pattern 2: Reactive binding with loading state**

```vue
<script setup>
import { useVenueDetailStore } from '@/generated/client/stores';
import { ref, onMounted, watch } from 'vue';

const props = defineProps(['venueId']);
const store = useVenueDetailStore();
const docState = ref({ data: null, loading: true });

onMounted(async () => {
  docState.value = await store.bind({ venue_id: props.venueId });
});

// Re-bind when venueId changes
watch(() => props.venueId, async (newId) => {
  docState.value = await store.bind({ venue_id: newId });
});
</script>

<template>
  <div v-if="docState.loading">Loading...</div>
  <div v-else>
    <h1>{{ docState.data.name }}</h1>
  </div>
</template>
```

**Pattern 3: Multiple subscriptions**

```vue
<script setup>
import { useVenueDetailStore } from '@/generated/client/stores';

const store = useVenueDetailStore();

// Bind multiple venues - each gets its own cached subscription
const venues = await Promise.all([
  store.bind({ venue_id: 1 }),
  store.bind({ venue_id: 2 }),
  store.bind({ venue_id: 3 }),
]);
</script>
```

### Accessing All Documents

The store's `documents` ref contains all bound subscriptions:

```typescript
const store = useVenueDetailStore();

await store.bind({ venue_id: 1 });
await store.bind({ venue_id: 2 });

// Access all documents
console.log(store.documents);
// {
//   '{"venue_id":1}': { data: {...}, loading: false, ready: Promise },
//   '{"venue_id":2}': { data: {...}, loading: false, ready: Promise }
// }
```

### How Realtime Works

DZQL uses a simple, unified broadcast pattern for all stores:

1. **Database events:** PostgreSQL triggers emit events to `dzql_v2.events`
2. **Server broadcasts:** Runtime sends `{table}:{op}` messages (e.g., `venues:update`) to clients based on:
   - **Subscriptions:** Connections with matching `affected_keys`
   - **Notifications:** Users in `notify_users` (from entity notification paths)
3. **Auto-dispatch:** The WebSocket client routes broadcasts to registered store handlers
4. **Store updates:** Each store's `table_changed` method applies updates to local data
5. **Vue reactivity:** UI updates automatically

**No refetching required** - changes are applied incrementally.

### The `table_changed` Pattern

Every generated store implements `table_changed` and self-registers with the WebSocket client:

```typescript
// Generated store (simplified)
export const useVenuesStore = defineStore('venues-store', () => {
  const records = ref([]);

  function table_changed(table: string, op: string, pk: Record<string, unknown>, data: unknown) {
    if (table !== 'venues') return;
    // Update records based on op (insert/update/delete)
  }

  // Self-register - no manual setup needed!
  ws.registerStore(table_changed);

  return { records, get, save, search, table_changed };
});
```

**User code - just works:**
```typescript
const venuesStore = useVenuesStore();  // Auto-registers for broadcasts
await venuesStore.search({ org_id: 1 });
// records update automatically when broadcasts arrive - no setup needed!
```

### Broadcast Message Format

```typescript
{
  "jsonrpc": "2.0",
  "method": "venues:update",  // {table}:{op}
  "params": {
    "pk": { "id": 123 },
    "data": { "id": 123, "name": "Updated Venue", ... }
  }
}
```

### Entity Notifications

Entities can define `notifications` paths to specify who receives broadcasts:

```typescript
export const entities = {
  venues: {
    schema: { id: 'serial PRIMARY KEY', org_id: 'int', name: 'text' },
    notifications: {
      members: ['@org_id->acts_for[org_id=$]{active}.user_id']
    }
  }
};
```

When a venue is created/updated/deleted, all active members of that org receive the broadcast.

## Why "Compile-Only"?

By moving complexity to build-time, we get:
*   **Performance:** The database does the heavy lifting.
*   **Correctness:** If it compiles, your permissions and relationships are valid.
*   **Simplicity:** The runtime is tiny and easy to audit.

## Entity Options

| Option | Type | Description |
|--------|------|-------------|
| `schema` | object | Column definitions with PostgreSQL types |
| `primaryKey` | string[] | Composite primary key fields (default: `['id']`) |
| `label` | string | Field used for display/autocomplete |
| `softDelete` | boolean | Use `deleted_at` instead of hard delete |
| `managed` | boolean | Set to `false` to skip CRUD generation (for junction tables) |
| `permissions` | object | Row-level security rules |
| `graphRules` | object | Side effects on create/update/delete |
| `manyToMany` | object | M2M relationship definitions |
| `fieldDefaults` | object | Default values for fields on INSERT |