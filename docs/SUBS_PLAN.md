# Implementation Plan: Atomic Updates for Subscribables

## Overview

This plan implements atomic updates for subscribables, transitioning from full document re-queries to efficient event forwarding. Instead of sending the entire document on every change, the server will forward atomic events (insert/update/delete) and the client will apply patches locally.

## Current State Analysis

### Current Flow (Full Re-query)
1. Database change triggers NOTIFY event
2. Server receives event via `setupListeners()` in `src/server/index.js`
3. `processSubscriptionUpdates()` calls `{name}_affected_documents()` to find affected subscriptions
4. For each affected subscription, server calls `get_{name}()` to re-query the **full document**
5. Server sends `subscription:update` message with **complete data**
6. Client replaces entire local state with new data

### Problems
- **Network inefficiency**: Sends full document for single-field changes
- **Database load**: Re-executes complex queries on every tiny change
- **Client state loss**: Replaces entire state (loses scroll position, expanded rows, etc.)

### Proposed Flow (Atomic Updates)
1. Database change triggers NOTIFY event (unchanged)
2. Server receives event (unchanged)
3. `processSubscriptionUpdates()` calls `{name}_affected_documents()` (unchanged)
4. **NEW**: For affected subscriptions, server forwards the raw event instead of re-querying
5. **NEW**: Server sends `subscription:event` message with atomic change data
6. **NEW**: Client applies patch to local document, preserving state

---

## Implementation Phases

### Phase 1: Database Schema - Add Scope Tables Metadata

**Goal**: Store which tables are "in scope" for each subscribable so the server knows which events to consider.

**Files to modify**:
- `packages/dzql/src/database/migrations/009_subscriptions.sql`

**Changes**:
1. Add `scope_tables TEXT[]` column to `dzql.subscribables` table
2. Update `dzql.register_subscribable()` to extract scope tables from relations

```sql
-- Add to dzql.subscribables
ALTER TABLE dzql.subscribables 
  ADD COLUMN IF NOT EXISTS scope_tables TEXT[] NOT NULL DEFAULT '{}';

-- Update register function to compute scope_tables from root_entity + relations
```

**Scope table extraction logic**:
- Start with `root_entity`
- Recursively extract `entity` values from `relations` JSONB
- Store as array: `['products', 'product_faces', 'product_parts', 'product_task_templates']`

**Files to modify**:
- `packages/dzql/src/compiler/codegen/subscribable-codegen.js` - Add method to extract scope tables

---

### Phase 2: Server - Forward Atomic Events

**Goal**: Modify `processSubscriptionUpdates()` to forward events instead of re-querying.

**Files to modify**:
- `packages/dzql/src/server/index.js`
- `packages/dzql/src/server/subscriptions.js` (add scope table caching)

**Changes to `processSubscriptionUpdates()`**:

```javascript
async function processSubscriptionUpdates(event, broadcast) {
  const { table, op, pk, before, after } = event;

  const subscriptionsByName = getSubscriptionsBySubscribable();
  if (subscriptionsByName.size === 0) return;

  for (const [subscribableName, subs] of subscriptionsByName.entries()) {
    try {
      // NEW: Check if this table is in scope for this subscribable
      const scopeTables = await getSubscribableScopeTables(subscribableName);
      if (!scopeTables.includes(table)) continue;

      // Ask PostgreSQL which subscription instances are affected (unchanged)
      const result = await sql.unsafe(
        `SELECT ${subscribableName}_affected_documents($1, $2, $3, $4) as affected`,
        [table, op, before, after]
      );

      const affectedParamSets = result[0]?.affected;
      if (!affectedParamSets || affectedParamSets.length === 0) continue;

      for (const affectedParams of affectedParamSets) {
        for (const sub of subs) {
          if (paramsMatch(sub.params, affectedParams)) {
            // NEW: Forward atomic event instead of re-querying
            const message = JSON.stringify({
              jsonrpc: "2.0",
              method: "subscription:event",  // NEW message type
              params: {
                subscription_id: sub.subscriptionId,
                subscribable: subscribableName,
                event: { table, op, pk, data: after, before }
              }
            });

            broadcast.toConnection(sub.connection_id, message);
          }
        }
      }
    } catch (error) {
      // Error handling unchanged
    }
  }
}
```

**Add to `subscriptions.js`**:

```javascript
// Cache for subscribable scope tables
const scopeTablesCache = new Map();

export async function getSubscribableScopeTables(subscribableName) {
  if (scopeTablesCache.has(subscribableName)) {
    return scopeTablesCache.get(subscribableName);
  }
  
  const result = await sql`
    SELECT scope_tables FROM dzql.subscribables WHERE name = ${subscribableName}
  `;
  
  const tables = result[0]?.scope_tables || [];
  scopeTablesCache.set(subscribableName, tables);
  return tables;
}

export function clearScopeTablesCache() {
  scopeTablesCache.clear();
}
```

---

### Phase 3: Server - Include Path Mapping in Subscribe Response

**Goal**: Send table-to-path mapping when client subscribes, so client knows how to apply patches.

**Files to modify**:
- `packages/dzql/src/server/ws.js`

**Changes to subscribe handler**:

```javascript
if (method.startsWith("subscribe_")) {
  const subscribableName = method.replace("subscribe_", "");

  // Execute initial query
  const queryResult = await sql.unsafe(
    `SELECT get_${subscribableName}($1, $2) as data`,
    [params, ws.data.user_id]
  );

  const data = queryResult[0]?.data;

  // NEW: Get subscribable metadata for path mapping
  const metaResult = await sql`
    SELECT root_entity, relations FROM dzql.subscribables 
    WHERE name = ${subscribableName}
  `;
  
  const { root_entity, relations } = metaResult[0] || {};
  const pathMapping = buildPathMapping(root_entity, relations);

  const subscriptionId = registerSubscription(...);

  const result = {
    subscription_id: subscriptionId,
    data,
    // NEW: Include schema for client-side patching
    schema: {
      root: root_entity,
      paths: pathMapping
    }
  };

  return create_rpc_response(id, result);
}
```

**Helper function `buildPathMapping()`**:

```javascript
function buildPathMapping(rootEntity, relations, parentPath = '') {
  const paths = {};
  
  // Root entity maps to top level
  paths[rootEntity] = parentPath || '.';
  
  for (const [relName, relConfig] of Object.entries(relations || {})) {
    const entity = typeof relConfig === 'string' ? relConfig : relConfig.entity;
    const currentPath = parentPath ? `${parentPath}.${relName}` : relName;
    
    paths[entity] = currentPath;
    
    // Handle nested relations
    if (relConfig.include || relConfig.relations) {
      const nested = relConfig.include || relConfig.relations;
      Object.assign(paths, buildPathMapping(null, nested, currentPath));
    }
  }
  
  return paths;
}
```

---

### Phase 4: Client - Apply Atomic Updates

**Goal**: Client applies patches instead of replacing entire document.

**Files to modify**:
- `packages/dzql/src/client/ws.js`

**Changes to `handleMessage()`**:

```javascript
handleMessage(message) {
  // Existing response handling...

  // Handle subscription updates (EXISTING - keep for backwards compatibility)
  if (message.method === "subscription:update") {
    const { subscription_id, data } = message.params;
    const sub = this.subscriptions.get(subscription_id);
    if (sub && sub.callback) {
      sub.callback(data);
    }
    return;
  }

  // NEW: Handle atomic subscription events
  if (message.method === "subscription:event") {
    const { subscription_id, subscribable, event } = message.params;
    const sub = this.subscriptions.get(subscription_id);
    if (sub) {
      this.applyAtomicUpdate(sub, event);
    }
    return;
  }

  // ... rest of existing handling
}
```

**Add `applyAtomicUpdate()` method**:

```javascript
applyAtomicUpdate(sub, event) {
  const { table, op, pk, data, before } = event;
  const { schema, localData, callback } = sub;
  
  if (!schema || !localData) {
    // Fallback: if no schema, treat as full update
    callback(data);
    return;
  }
  
  const path = schema.paths[table];
  if (!path) {
    console.warn(`Unknown table ${table} for subscribable`);
    return;
  }
  
  // Apply the update
  if (path === '.' || path === schema.root) {
    // Root entity changed
    if (op === 'update') {
      Object.assign(localData[schema.root], data);
    } else if (op === 'delete') {
      localData[schema.root] = null;
    }
    // insert at root level is handled by initial subscribe
  } else {
    // Relation changed
    const arr = this.getArrayAtPath(localData, path);
    if (!arr) return;
    
    if (op === 'insert') {
      arr.push(data);
    } else if (op === 'update') {
      const idx = arr.findIndex(item => this.pkMatch(item, pk));
      if (idx !== -1) {
        Object.assign(arr[idx], data);
      }
    } else if (op === 'delete') {
      const idx = arr.findIndex(item => this.pkMatch(item, pk));
      if (idx !== -1) {
        arr.splice(idx, 1);
      }
    }
  }
  
  // Trigger callback with updated document
  callback(localData);
}

getArrayAtPath(obj, path) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (!current) return null;
    current = current[part];
  }
  return Array.isArray(current) ? current : null;
}

pkMatch(item, pk) {
  for (const [key, value] of Object.entries(pk)) {
    if (item[key] !== value) return false;
  }
  return true;
}
```

**Modify `subscribe()` method to store local data**:

```javascript
async subscribe(method, params = {}, callback) {
  if (!callback || typeof callback !== 'function') {
    throw new Error('Subscribe requires a callback function');
  }

  const result = await this.call(method, params);
  const { subscription_id, data, schema } = result;  // NEW: schema

  const unsubscribeFn = async () => {
    const unsubMethod = method.replace('subscribe_', 'unsubscribe_');
    await this.call(unsubMethod, params);
    this.subscriptions.delete(subscription_id);
  };

  // Store callback AND local data for patching
  this.subscriptions.set(subscription_id, {
    callback,
    unsubscribe: unsubscribeFn,
    schema,          // NEW: store schema
    localData: data  // NEW: store local copy for patching
  });

  return {
    data,
    subscription_id,
    unsubscribe: unsubscribeFn
  };
}
```

---

### Phase 5: Codegen - Extract Scope Tables

**Goal**: Auto-generate scope_tables when compiling subscribables.

**Files to modify**:
- `packages/dzql/src/compiler/codegen/subscribable-codegen.js`

**Add method to extract scope tables**:

```javascript
extractScopeTables() {
  const tables = new Set([this.rootEntity]);
  
  const extractFromRelations = (relations) => {
    for (const [relName, relConfig] of Object.entries(relations || {})) {
      const entity = typeof relConfig === 'string' ? relConfig : relConfig.entity;
      if (entity) tables.add(entity);
      
      // Handle nested relations
      if (relConfig.include) {
        extractFromRelations(relConfig.include);
      }
      if (relConfig.relations) {
        extractFromRelations(relConfig.relations);
      }
    }
  };
  
  extractFromRelations(this.relations);
  return Array.from(tables);
}
```

**Update `generate()` to include scope tables in registration**:

```javascript
generate() {
  const sections = [];
  
  // ... existing sections ...
  
  // Add registration with scope_tables
  const scopeTables = this.extractScopeTables();
  sections.push(this._generateRegistration(scopeTables));
  
  return sections.join('\n\n');
}

_generateRegistration(scopeTables) {
  return `-- Register subscribable with scope tables
UPDATE dzql.subscribables 
SET scope_tables = ARRAY[${scopeTables.map(t => `'${t}'`).join(', ')}]::TEXT[]
WHERE name = '${this.name}';`;
}
```

---

## Testing Plan

### Unit Tests

**File**: `tests/core/atomic-updates.test.js`

```javascript
describe('Atomic Updates', () => {
  describe('Scope Tables Extraction', () => {
    test('extracts root entity', async () => {});
    test('extracts simple relations', async () => {});
    test('extracts nested relations', async () => {});
  });
  
  describe('Path Mapping', () => {
    test('maps root entity to "."', async () => {});
    test('maps relations to their keys', async () => {});
    test('maps nested relations correctly', async () => {});
  });
  
  describe('Client Patching', () => {
    test('insert adds to array', async () => {});
    test('update modifies existing item', async () => {});
    test('delete removes item', async () => {});
    test('root update modifies root object', async () => {});
  });
});
```

### Integration Tests

**File**: `tests/integration/atomic-subscription-updates.test.js`

```javascript
describe('Atomic Subscription Updates - Integration', () => {
  test('subscribe returns schema with paths', async () => {
    const { data, schema } = await ws.api.subscribe_venue_detail(
      { venue_id: 1 },
      () => {}
    );
    
    expect(schema).toBeDefined();
    expect(schema.root).toBe('venues');
    expect(schema.paths).toHaveProperty('sites');
  });
  
  test('atomic update triggers callback with patched data', async () => {
    let updateCount = 0;
    let lastData = null;
    
    const { data } = await ws.api.subscribe_venue_detail(
      { venue_id: 1 },
      (updated) => {
        updateCount++;
        lastData = updated;
      }
    );
    
    // Trigger a change
    await ws.api.save.sites({ id: 1, name: 'Updated Site' });
    
    // Wait for update
    await new Promise(r => setTimeout(r, 100));
    
    expect(updateCount).toBe(1);
    expect(lastData.sites.find(s => s.id === 1).name).toBe('Updated Site');
  });
  
  test('atomic insert adds to collection', async () => {});
  test('atomic delete removes from collection', async () => {});
  test('root entity update modifies document', async () => {});
});
```

### WebSocket Protocol Tests

**File**: `packages/venues/tests/atomic-events.test.js`

```javascript
describe('WebSocket Atomic Events', () => {
  test('receives subscription:event message type', async () => {});
  test('event contains table, op, pk, data', async () => {});
  test('backward compatible with subscription:update', async () => {});
});
```

---

## Documentation Updates

### Files to Update

1. **`packages/dzql/docs/guides/subscriptions.md`**
   - Add "Atomic Updates" section
   - Document `subscription:event` message format
   - Add client patching examples
   - Update architecture diagram

2. **`packages/dzql/docs/getting-started/subscriptions-quick-start.md`**
   - Add note about automatic atomic updates
   - Show schema in subscribe response

3. **New file: `packages/dzql/docs/guides/atomic-updates.md`**
   - Detailed explanation of atomic updates
   - Migration guide from full re-queries
   - Performance comparison
   - Edge cases and troubleshooting

### Example Documentation Section

```markdown
## Atomic Updates (v0.6.0+)

Subscribables now support atomic updates, reducing network traffic and 
preserving client-side state.

### How It Works

1. **Initial subscribe** returns full document + schema:
   ```javascript
   const { data, schema } = await ws.api.subscribe_venue_detail({venue_id: 1}, cb);
   // schema = { root: 'venues', paths: { 'sites': 'sites', ... } }
   ```

2. **On changes**, client receives atomic events:
   ```json
   {
     "method": "subscription:event",
     "params": {
       "subscription_id": "...",
       "event": {
         "table": "sites",
         "op": "update",
         "pk": {"id": 5},
         "data": {"name": "Updated Site"},
         "before": {"name": "Old Name"}
       }
     }
   }
   ```

3. **Client applies patch** to local document automatically.
```

---

## Migration Path

### Backward Compatibility

- Keep `subscription:update` message type working
- Server sends `subscription:event` for subscribables with scope_tables
- Server falls back to `subscription:update` (full re-query) for older subscribables
- Client handles both message types

### Phased Rollout

1. **Phase 1**: Deploy database migration, codegen changes (no behavior change)
2. **Phase 2**: Deploy server changes with feature flag
3. **Phase 3**: Update client to handle both message types
4. **Phase 4**: Enable atomic updates for new subscribables
5. **Phase 5**: Migrate existing subscribables, deprecate full re-query

---

## Edge Cases to Handle

### Cascading Deletes

When a parent record is deleted, child records cascade. Options:
1. Server sends delete events in order (children first)
2. Client handles missing parent gracefully
3. Client ignores updates for orphaned children

**Recommendation**: Option 2 - client should handle gracefully.

### Permission Changes

If user loses access mid-subscription:
1. `_affected_documents()` should check permissions
2. Or server filters post-query
3. Client receives "unsubscribed" message

**Recommendation**: Add permission check to affected_documents logic.

### Composite Primary Keys

Events may have composite PKs: `{ "product_id": 1, "part_id": 2 }`.
Client `pkMatch()` function handles this.

### Nested Array Updates

For deeply nested updates (e.g., `task_templates[].dependencies[]`):
1. Path would be `task_templates.dependencies`
2. Client traverses through parent arrays
3. Finds correct parent item by parent's PK

**Implementation**: Add parent context to event or derive from FK relationships.

---

## File Summary

### Files to Create
- `tests/core/atomic-updates.test.js`
- `tests/integration/atomic-subscription-updates.test.js`
- `packages/dzql/docs/guides/atomic-updates.md`

### Files to Modify
- `packages/dzql/src/database/migrations/009_subscriptions.sql` (add scope_tables column)
- `packages/dzql/src/server/index.js` (forward events instead of re-query)
- `packages/dzql/src/server/subscriptions.js` (add scope tables cache)
- `packages/dzql/src/server/ws.js` (include schema in subscribe response)
- `packages/dzql/src/client/ws.js` (handle subscription:event, apply patches)
- `packages/dzql/src/compiler/codegen/subscribable-codegen.js` (extract scope tables)
- `packages/dzql/docs/guides/subscriptions.md` (add atomic updates section)

---

## Implementation Order

1. **Database migration** - Add scope_tables column
2. **Codegen** - Extract and store scope tables
3. **Server subscriptions.js** - Add scope tables cache
4. **Server ws.js** - Include schema in subscribe response  
5. **Server index.js** - Forward atomic events
6. **Client ws.js** - Handle subscription:event and apply patches
7. **Tests** - Unit and integration tests
8. **Documentation** - Update guides

---

## Success Criteria

1. Subscribables with scope_tables send `subscription:event` messages
2. Client correctly applies insert/update/delete patches
3. Client state (scroll, expanded) preserved across updates
4. Network traffic reduced proportionally to change size
5. All existing tests pass
6. New tests cover atomic update scenarios
7. Documentation updated with atomic update guide
