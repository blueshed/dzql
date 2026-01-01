# DZQL Guide for AI Assistants

This document defines the patterns and conventions for generating valid DZQL domain definitions. Use this guide when asked to "Create a DZQL app" or "Add an entity".

## Quick Start

The fastest way to create a new DZQL app:

```bash
bun create dzql my-app
cd my-app
bun install
bun run db:rebuild
bun run dev
```

## Core Concept: The Domain Definition

A DZQL application is defined by a single TypeScript/JavaScript module exporting `entities` and `subscribables`.

### 1. Entity Definition Pattern

Each key in `entities` maps to a database table.

```javascript
export const entities = {
  // Key = Table Name (snake_case recommended)
  [entity_name]: {
    
    // 1. Schema: Standard PostgreSQL types
    // Format: 'type constraints'
    schema: {
      id: 'serial PRIMARY KEY',
      name: 'text NOT NULL',
      org_id: 'int REFERENCES organisations(id) ON DELETE CASCADE', // Always define FK constraints
      created_at: 'timestamptz DEFAULT now()'
    },

    // 2. Configuration
    label: 'name', // Field used for autocomplete/display
    searchable: ['name', 'description'], // Fields indexed for search

    // 3. Permissions: Row-Level Security DSL
    // Rules are OR-ed together. If any rule passes, access is granted.
    // Empty array [] = Deny All (Default for strictness)
    // ['TRUE'] = Public Access
    permissions: {
      view: ['@org_id->acts_for[org_id=$]{active}.user_id'], // Complex traversal
      create: ['@author_id == @user_id'], // Simple check
      update: ['@id'], // Implies "User ID matches Record ID" (Owner)
      delete: []
    },

    // 4. Graph Rules: Side Effects & Cascades
    graphRules: {
      // Triggered AFTER successful INSERT
      on_create: {
        action_name: {
          actions: [
            // Database Side Effect
            { 
              type: 'create', 
              entity: 'notifications', 
              data: { user_id: '@user_id', message: 'Welcome' } 
            },
            // Async Reactor (External Side Effect via Runtime)
            { 
              type: 'reactor', 
              name: 'send_email', 
              params: { email: '@email' } 
            }
          ]
        }
      },
      // Triggered BEFORE DELETE
      on_delete: {
        cascade_cleanup: {
          actions: [
            // Explicit Cascade (if not handled by DB FK)
            { type: 'delete', target: 'comments', params: { post_id: '@id' } }
          ]
        }
      }
    }
  }
};
```

### 2. Permission DSL Guide

Permissions are compiled to SQL `EXISTS` clauses.

*   **Variables:**
    *   `@user_id`: The authenticated user's ID.
    *   `@id`: The Record's ID (or value of `id` column).
    *   `@field`: The value of a field in the record (or input data).

*   **Patterns:**
    *   **Self-Ownership:** `'@user_id == @owner_id'` (or just `'@owner_id'` shorthand).
    *   **Traversal:** `'@org_id->acts_for[org_id=$]{active}.user_id'`
        *   `@org_id`: Start from this field on the current entity.
        *   `->acts_for`: Join to `acts_for` table.
        *   `[org_id=$]`: Join condition (`acts_for.org_id = current.org_id`).
        *   `{active}`: Filter condition (`acts_for.active = true` or temporal check).
        *   `.user_id`: Final check (`acts_for.user_id = @user_id`).

### 3. Subscribable Definition Pattern (The "Smart Store")

Subscribables define the *shape* of the data the client needs. They are more than just queries; they define the **Graph Patching Strategy**.

```javascript
export const subscribables = {
  // Key = Subscription Name
  venue_detail: {
    // 1. Parameters (Inputs)
    params: { venue_id: 'int' },

    // 2. Root Entity
    root: {
      entity: 'venues',
      key: 'venue_id' // Maps param 'venue_id' to entity PK
    },

    // 3. Graph Structure (Nested Includes)
    includes: {
      // Simple relation
      org: { relation: 'org', entity: 'organisations' },
      
      // Nested relation
      sites: {
        relation: 'sites',
        entity: 'sites',
        // Recursive nesting
        includes: {
          allocations: { relation: 'allocations', entity: 'allocations' }
        }
      }
    },

    // 4. Scope Tables (Crucial for Realtime)
    // List ALL tables that appear in this graph.
    // The Runtime uses this to route events.
    scopeTables: ['venues', 'organisations', 'sites', 'allocations'],

    // 5. Subscription Permission
    // Who is allowed to listen to this feed?
    canSubscribe: ['@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id']
  }
};
```

### When to use what?

*   **Entities:** Always define entities for every physical table.
*   **Subscribables:** Define a subscribable for every **Screen** or **Major Component** in the UI. (e.g., `dashboard`, `profile`, `item_detail`).
    *   *Do not* write manual API fetchers. Use subscribables to generate "Smart Stores" that self-update.

### Using Generated Subscribable Stores

Each subscribable in your domain generates a Pinia store with this structure:

```typescript
// Generated store API
const store = useVenueDetailStore();

store.bind(params)    // Async - subscribe and get { data, loading, ready }
store.unbind(params)  // Unsubscribe and remove document from store
store.documents       // Ref - all bound documents keyed by JSON params
```

**Basic Usage:**

```typescript
import { useVenueDetailStore } from '@/generated/client/stores';

const store = useVenueDetailStore();

// bind() returns a Promise that resolves when first data arrives
const { data, loading, ready } = await store.bind({ venue_id: 1 });

// data is now populated - no need to check loading
console.log(data.name); // 'My Venue'
console.log(data.org.name); // 'My Org' (nested include)
console.log(data.sites); // [{...}, {...}] (array of related records)

// Subsequent calls with same params return cached subscription immediately
const cached = await store.bind({ venue_id: 1 }); // No new subscription created
```

**Vue Component Pattern (with Suspense):**

```vue
<script setup>
import { useVenueDetailStore } from '@/generated/client/stores';

const props = defineProps(['venueId']);
const store = useVenueDetailStore();

// Top-level await - component suspends until data arrives
const { data } = await store.bind({ venue_id: props.venueId });
</script>

<template>
  <h1>{{ data.name }}</h1>
  <p>Org: {{ data.org.name }}</p>
  <ul>
    <li v-for="site in data.sites" :key="site.id">
      {{ site.name }}
    </li>
  </ul>
</template>
```

**Vue Component Pattern (with loading state):**

```vue
<script setup>
import { useVenueDetailStore } from '@/generated/client/stores';
import { ref, onMounted, watch } from 'vue';

const props = defineProps(['venueId']);
const store = useVenueDetailStore();
const doc = ref({ data: null, loading: true });

onMounted(async () => {
  doc.value = await store.bind({ venue_id: props.venueId });
});

// Re-bind when venueId changes
watch(() => props.venueId, async (newId) => {
  doc.value = await store.bind({ venue_id: newId });
});
</script>

<template>
  <div v-if="doc.loading">Loading...</div>
  <template v-else>
    <h1>{{ doc.data.name }}</h1>
  </template>
</template>
```

**Accessing Multiple Subscriptions:**

```typescript
const store = useVenueDetailStore();

// Each unique params set creates a separate subscription
await store.bind({ venue_id: 1 });
await store.bind({ venue_id: 2 });

// Access all documents via store.documents
for (const [key, docState] of Object.entries(store.documents)) {
  console.log(key, docState.data);
}
// '{"venue_id":1}' { id: 1, name: 'Venue 1', ... }
// '{"venue_id":2}' { id: 2, name: 'Venue 2', ... }
```

**Key Points:**
- `bind()` is async and awaits first data before returning
- Same params = same cached subscription (deduplication by JSON key)
- The `ready` Promise is stored for repeat callers to await
- **Stores own their data** - the WebSocket is just transport
- Realtime patches are applied by the store's `applyPatch()` function
- Data is reactive - changes trigger Vue reactivity automatically
- The store routes patch events by table name to the correct location in the document graph

### Common Patterns

**1. The "Owner" Pattern:**
```javascript
create: ['@author_id == @user_id']
```

**2. The "Organization Member" Pattern:**
```javascript
view: ['@org_id->memberships[org_id=$].user_id']
```

**3. The "Creator Side Effect" Pattern:**
Use `graphRules.on_create` to create related records automatically (e.g., creating a default 'Settings' record when a 'User' is created).

**4. The "Reactor" Pattern:**
Use `type: 'reactor'` for anything that requires Node.js (Email, Stripe, AI processing). Do not try to do complex logic in SQL.

---

## Custom Functions

DZQL supports two types of custom functions that can be called via RPC:

### 1. SQL Custom Functions

SQL custom functions are defined in your domain and compiled into the database migrations. They run inside PostgreSQL and are ideal for complex queries, aggregations, or operations that benefit from database-level performance.

**Domain Definition:**

```javascript
// domain.js
export const entities = { /* ... */ };
export const subscribables = { /* ... */ };

// Add custom SQL functions
export const customFunctions = [
  {
    name: 'calculate_org_stats',
    sql: `
CREATE OR REPLACE FUNCTION dzql_v2.calculate_org_stats(p_user_id int, p_params jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_org_id int;
  v_venue_count int;
  v_total_revenue numeric;
BEGIN
  v_org_id := (p_params->>'org_id')::int;

  -- Permission check (optional but recommended)
  IF NOT EXISTS (
    SELECT 1 FROM acts_for
    WHERE user_id = p_user_id AND org_id = v_org_id AND active = true
  ) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO v_venue_count
  FROM venues WHERE org_id = v_org_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_revenue
  FROM orders WHERE org_id = v_org_id;

  RETURN jsonb_build_object(
    'org_id', v_org_id,
    'venue_count', v_venue_count,
    'total_revenue', v_total_revenue
  );
END;
$$;
    `,
    args: ['p_user_id', 'p_params']  // Optional, defaults to these
  }
];
```

**Calling from Client:**

```typescript
// The function is automatically added to the client SDK
const stats = await ws.api.calculate_org_stats({ org_id: 1 });
console.log(stats.venue_count, stats.total_revenue);
```

**Key Points:**
- Functions must be in the `dzql_v2` schema
- Standard signature: `(p_user_id int, p_params jsonb) RETURNS jsonb`
- Automatically added to the manifest allowlist (security)
- Compiled into the database migrations

### 2. JavaScript Custom Functions

JavaScript custom functions run in the Bun/Node runtime. They are ideal for:
- External API calls (Stripe, SendGrid, etc.)
- Complex business logic that's easier in JS than SQL
- Operations that need access to environment variables or external services

**Registration (in your server startup):**

```typescript
// server.ts or wherever you start your runtime
import { registerJsFunction } from 'dzql/runtime';

// Simple function
registerJsFunction('hello_world', async (ctx) => {
  return {
    message: `Hello, User ${ctx.userId}!`,
    timestamp: new Date().toISOString()
  };
});

// Function with database access
registerJsFunction('get_user_dashboard', async (ctx) => {
  const { userId, params, db } = ctx;

  // Query the database
  const orgs = await db.query(
    'SELECT o.* FROM organisations o JOIN acts_for af ON o.id = af.org_id WHERE af.user_id = $1 AND af.active = true',
    [userId]
  );

  const venues = await db.query(
    'SELECT * FROM venues WHERE org_id = ANY($1)',
    [orgs.map(o => o.id)]
  );

  return {
    organizations: orgs,
    venues: venues,
    total_venues: venues.length
  };
});

// Function calling external API
registerJsFunction('send_notification', async (ctx) => {
  const { userId, params } = ctx;

  // Call external service
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      to: params.email,
      subject: params.subject,
      content: params.message
    })
  });

  return { success: response.ok };
});
```

**Calling from Client:**

```typescript
// JS functions are called the same way as SQL functions
const dashboard = await ws.api.get_user_dashboard({});
const result = await ws.api.send_notification({
  email: 'user@example.com',
  subject: 'Hello',
  message: 'Welcome!'
});
```

**Context Object:**

```typescript
interface JsFunctionContext {
  userId: number;        // Authenticated user's ID
  params: any;           // Parameters passed from client
  db: {
    query(sql: string, params?: any[]): Promise<any[]>;  // Database access
  };
}
```

**Key Points:**
- JS functions take precedence over SQL functions with the same name
- No manifest entry needed - registration is enough
- Full access to Node.js/Bun APIs (fetch, fs, etc.)
- Can query the database via `ctx.db.query()`
- Errors thrown are propagated to the client

### When to Use Which?

| Use Case | SQL | JavaScript |
|----------|-----|------------|
| Complex aggregations | ✅ | |
| Data transformations | ✅ | |
| External API calls | | ✅ |
| Email/SMS notifications | | ✅ |
| File processing | | ✅ |
| Payment processing | | ✅ |
| Performance-critical queries | ✅ | |
| Access to env variables | | ✅ |
| Multi-step transactions | ✅ | |
| Real-time calculations | ✅ | |

---

## Unmanaged Entities (Junction Tables)

For junction tables used in many-to-many relationships, you typically don't want DZQL to generate CRUD functions. These tables are managed via the M2M relationship on the parent entity.

Use `managed: false` to skip CRUD generation:

```javascript
export const entities = {
  brands: {
    schema: {
      id: 'serial PRIMARY KEY',
      name: 'text NOT NULL'
    },
    // M2M relationship manages brand_tags automatically
    manyToMany: {
      tags: {
        junctionTable: 'brand_tags',
        localKey: 'brand_id',
        foreignKey: 'tag_id',
        targetEntity: 'tags',
        idField: 'tag_ids'
      }
    }
  },

  tags: {
    schema: {
      id: 'serial PRIMARY KEY',
      name: 'text NOT NULL'
    }
  },

  // Junction table - no CRUD functions generated
  brand_tags: {
    schema: {
      brand_id: 'int NOT NULL REFERENCES brands(id) ON DELETE CASCADE',
      tag_id: 'int NOT NULL REFERENCES tags(id) ON DELETE CASCADE'
    },
    primaryKey: ['brand_id', 'tag_id'],
    managed: false  // Skip CRUD generation
  }
};
```

**What `managed: false` does:**
- The table schema is still created in the database
- No `get_brand_tags`, `save_brand_tags`, `delete_brand_tags`, etc. functions are generated
- No manifest entries for CRUD operations
- The junction table is managed via the parent entity's M2M operations

---

## Client Connection & Authentication

When a client connects to the WebSocket server, it immediately receives a `connection:ready` message containing the authenticated user profile (or `null` if not authenticated).

### Connection Flow

1. Client connects with optional `?token=...` in URL
2. Server validates token (if present) and fetches user profile
3. Server sends: `{"method": "connection:ready", "params": {"user": {...} | null}}`
4. Client knows auth state immediately, can render accordingly

### WebSocketManager API

```typescript
import { WebSocketManager } from 'dzql/client';

const ws = new WebSocketManager();
await ws.connect('ws://localhost:3000/ws');

// Connection state properties
ws.ready  // boolean - true after connection:ready received
ws.user   // user profile object or null if anonymous

// Register callback for ready state (called immediately if already ready)
const unsubscribe = ws.onReady((user) => {
  if (user) {
    console.log('Authenticated as:', user.email);
  } else {
    console.log('Anonymous connection');
  }
});

// Authentication methods
await ws.login({ email: '...', password: '...' });   // Stores token in localStorage
await ws.register({ email: '...', password: '...' }); // Stores token in localStorage
await ws.logout();  // Clears token, user state, and reconnects
```

### Vue/Pinia Usage Pattern

```vue
<template>
  <div v-if="!ws.ready">Loading...</div>
  <LoginModal v-else-if="!ws.user" />
  <RouterView v-else />
</template>
```

### Why This Matters

- **Single source of truth:** WebSocket connection determines auth state, not localStorage
- **No race conditions:** UI waits for `connection:ready` before rendering
- **Simpler client code:** No need for separate auth check after connect
- **Better UX:** App shows loading state until connection ready, then immediately correct view

---

## CLI Integration with Namespace

DZQL provides a namespace export for CLI tools like `invokej` to interact with the database directly without going through the WebSocket runtime.

### Setup

```typescript
// cli.ts or server-side script
import { DzqlNamespace } from 'dzql/namespace';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL);
const manifest = await import('./dist/runtime/manifest.json');

const dzql = new DzqlNamespace(sql, manifest);
```

### CRUD Operations

```typescript
// Get a record
const venue = await dzql.get('venues', { id: 1 }, userId);

// Save (create or update)
const newVenue = await dzql.save('venues', { name: 'New Venue', org_id: 1 }, userId);

// Delete
const deleted = await dzql.delete('venues', { id: 1 }, userId);

// Search with filters
const venues = await dzql.search('venues', { org_id: 1, limit: 10 }, userId);

// Lookup for autocomplete
const options = await dzql.lookup('venues', { q: 'test' }, userId);
```

### Ad-hoc Function Calls

Call any function in the manifest directly:

```typescript
// Call a custom function
const result = await dzql.call('calculate_org_stats', { org_id: 1 }, userId);

// Call a subscribable getter
const detail = await dzql.call('get_venue_detail', { venue_id: 1 }, userId);
```

### List Available Functions

```typescript
// Get all functions from manifest
const functions = dzql.functions();
// Returns: ['login_user', 'register_user', 'get_venues', 'save_venues', ...]
```

### Use with invokej

The namespace is designed for use with `invokej`, a CLI tool for invoking functions:

```bash
# In your invokej configuration, register the DZQL namespace
invokej dzql:get venues '{"id": 1}'
invokej dzql:save venues '{"name": "Updated Venue", "id": 1}'
invokej dzql:call calculate_org_stats '{"org_id": 1}'
invokej dzql:functions
```

**Key Points:**
- All operations respect the same permissions as the WebSocket runtime
- The `userId` parameter is required for permission checks
- Operations are atomic (single transaction)
- Results are returned as JSON objects
