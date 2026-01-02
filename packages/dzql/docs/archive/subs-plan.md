# Atomic Updates for Subscribables

## Problem

Currently, subscribables re-query and send the **full document** on every change:

```javascript
// Current: processSubscriptionUpdates() in src/server/index.js
const updated = await sql.unsafe(
  `SELECT get_${subscribableName}($1, $2) as data`,
  [sub.params, sub.user_id]
);
// Sends entire document to client
```

This is inefficient:
- **Network**: Sends full product catalogue when one task template duration changes
- **Client**: Replaces entire local state, loses UI state (scroll, expanded rows)
- **Database**: Re-queries complex nested document on every tiny change

## Vision

Subscribables should deliver **atomic updates**:

1. **Initial subscribe** → client gets full document once
2. **On changes** → client receives atomic event (insert/update/delete)
3. **Client applies patch** → maintains document locally

## Required Changes

### 1. Subscribable Definition: Declare Scope

The subscribable must declare which tables are "in scope" for its document. This is already implicit in the `relations` parameter - extract the table list:

```sql
SELECT dzql.register_subscribable(
  'product_catalogue',
  '{"subscribe": ["@organisation_id->acts_for[organisation_id=$].user_id"]}'::jsonb,
  '{"organisation_id": "int"}'::jsonb,
  'products',  -- root table
  '{
    "faces": {"entity": "product_faces", "filter": "product_id=$id", ...},
    "parts": {"entity": "product_parts", "filter": "parent_id=$id", ...},
    "task_templates": {"entity": "product_task_templates", "filter": "product_id=$id", ...}
  }'::jsonb
);
```

**Scope tables**: `products`, `product_faces`, `product_parts`, `product_task_templates`, plus any nested relations.

Store this as metadata when registering the subscribable:
```sql
-- New column or separate table
subscribable_scope_tables: ['products', 'product_faces', 'product_parts', 'product_task_templates', ...]
```

### 2. Affected Documents: Return Subscription Keys Only

The `<name>_affected_documents()` function already exists and returns which subscription instances are affected. Keep this - it determines WHO gets the event.

Current signature (no change needed):
```sql
CREATE FUNCTION product_catalogue_affected_documents(
  p_table TEXT,
  p_op TEXT,
  p_old JSONB,
  p_new JSONB
) RETURNS JSONB[];  -- Array of param sets (subscription keys)
```

### 3. Server: Forward Atomic Events Instead of Re-querying

Change `processSubscriptionUpdates()` in `src/server/index.js`:

```javascript
async function processSubscriptionUpdates(event, broadcast) {
  const { table, op, pk, before, after } = event;

  const subscriptionsByName = getSubscriptionsBySubscribable();
  if (subscriptionsByName.size === 0) return;

  for (const [subscribableName, subs] of subscriptionsByName.entries()) {
    try {
      // Check if this table is in scope for this subscribable
      // (New: need to know subscribable's scope tables)
      const scopeTables = await getSubscribableScopeTables(subscribableName);
      if (!scopeTables.includes(table)) continue;

      // Ask PostgreSQL which subscription instances are affected
      const result = await sql.unsafe(
        `SELECT ${subscribableName}_affected_documents($1, $2, $3, $4) as affected`,
        [table, op, before, after]
      );

      const affectedParamSets = result[0]?.affected;
      if (!affectedParamSets || affectedParamSets.length === 0) continue;

      // Match affected params to active subscriptions
      for (const affectedParams of affectedParamSets) {
        for (const sub of subs) {
          if (paramsMatch(sub.params, affectedParams)) {
            // NEW: Forward atomic event instead of re-querying
            const message = JSON.stringify({
              jsonrpc: "2.0",
              method: "subscription:event",
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
      // ... error handling
    }
  }
}
```

### 4. Client: Apply Atomic Events to Local Document

The client WebSocket handler needs to process `subscription:event` messages:

```javascript
// In client ws.js or subscription handler
ws.onMessage((msg) => {
  const { method, params } = JSON.parse(msg);
  
  if (method === 'subscription:event') {
    const { subscription_id, subscribable, event } = params;
    const { table, op, pk, data, before } = event;
    
    // Get the local document for this subscription
    const localDoc = subscriptions.get(subscription_id);
    if (!localDoc) return;
    
    // Apply atomic update based on table and operation
    applyAtomicUpdate(localDoc, table, op, pk, data, before);
    
    // Trigger callback with updated document
    localDoc.callback(localDoc.data);
  }
});

function applyAtomicUpdate(localDoc, table, op, pk, data, before) {
  // Find where this table lives in the document structure
  // Based on subscribable definition, e.g.:
  // - 'products' -> root level
  // - 'product_faces' -> doc.faces[]
  // - 'product_task_templates' -> doc.task_templates[]
  
  const path = getPathForTable(localDoc.subscribable, table);
  
  if (op === 'insert') {
    // Add to array at path
    getArrayAtPath(localDoc.data, path).push(data);
  } else if (op === 'update') {
    // Find and update item by pk
    const arr = getArrayAtPath(localDoc.data, path);
    const idx = arr.findIndex(item => item.id === pk.id);
    if (idx !== -1) arr[idx] = { ...arr[idx], ...data };
  } else if (op === 'delete') {
    // Remove item by pk
    const arr = getArrayAtPath(localDoc.data, path);
    const idx = arr.findIndex(item => item.id === pk.id);
    if (idx !== -1) arr.splice(idx, 1);
  }
}
```

### 5. Subscribable Metadata: Table-to-Path Mapping

The client needs to know where each table maps in the document structure. Options:

**Option A: Send mapping on subscribe**
```javascript
// Subscribe response includes document structure
{
  subscription_id: "...",
  data: { ... },
  schema: {
    root: "products",
    paths: {
      "product_faces": "faces",
      "product_parts": "parts", 
      "product_task_templates": "task_templates",
      "product_task_template_dependencies": "task_templates[].dependencies"
    }
  }
}
```

**Option B: Derive from subscribable definition**
The client already has the subscribable definition (relations). Parse it to build the mapping.

**Option C: Convention-based**
Table name maps to relation key: `product_faces` → `faces`, `product_task_templates` → `task_templates`.

### 6. Edge Cases

**Nested relations**: When `product_task_template_dependencies` changes, the client needs to find the parent `task_template` first, then update its `dependencies` array.

**Root table changes**: When `products` changes, it's a top-level update to the document (or insert/delete of entire product).

**Cascading scope**: If a product is deleted, the client should also remove its faces, templates, etc. The database handles CASCADE, but the client might receive the product delete event before the cascade events. Options:
- Server sends events in order (delete children first)
- Client handles missing parent gracefully
- Server sends single "cascade" event with all affected records

**Permission changes**: If user loses access to a product mid-subscription, they shouldn't receive further events for it. The `_affected_documents()` function should check permissions (or the server should filter post-query).

## Migration Path

1. **Phase 1**: Add scope metadata to subscribables (backward compatible)
2. **Phase 2**: Add `subscription:event` message type, keep `subscription:update` working
3. **Phase 3**: Client implements atomic update handler
4. **Phase 4**: Deprecate `subscription:update` for subscribables that support atomic updates

## Testing

```javascript
// Test: atomic update arrives correctly
const { data, subscription_id } = await ws.api.subscribe_product_catalogue(
  { organisation_id: 1 },
  (updatedDoc) => {
    // Should be called with patched document, not full re-query
  }
);

// Trigger a change
await ws.api.dzql.save.product_task_templates({
  id: 7,
  duration: '00:10:00'
});

// Verify callback received atomic update, document is correct
```

## Summary

| Component | Current | Proposed |
|-----------|---------|----------|
| Subscribe | Returns full doc | Returns full doc + schema |
| On change | Re-queries full doc | Forwards atomic event |
| Client | Replaces entire state | Applies patch to local state |
| Network | O(doc size) per change | O(change size) per change |
| Server CPU | Query per change | Minimal (just forward) |

The `dzql.events` table already captures all state changes. Subscribables just need to forward those events to the right clients instead of re-querying.
