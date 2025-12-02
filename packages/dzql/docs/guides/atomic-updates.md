# Atomic Updates for Subscribables

Atomic updates enable efficient real-time synchronization by sending only the changes (insert/update/delete) to subscribed clients, instead of re-querying and sending the entire document on every change.

## Overview

### Problem Solved

Previously, when any data changed that affected a subscription, the server would:
1. Re-query the entire document using `get_<subscribable>()`
2. Send the complete document to the client
3. Client replaces its entire local state

This approach has several problems:
- **Network inefficiency**: Sends full product catalogue when one task template duration changes
- **Database load**: Re-executes complex queries on every tiny change
- **Client state loss**: Replaces entire local state, losing UI state (scroll position, expanded rows, etc.)

### Solution: Atomic Updates

With atomic updates, the server:
1. Forwards the raw event (table, operation, primary key, data) directly to clients
2. Client applies the patch to their local copy of the document
3. Only changed data traverses the network

Benefits:
- **Efficient**: O(change size) instead of O(document size) per update
- **Preserved state**: Client UI state remains intact
- **Reduced database load**: No re-querying on every change

## How It Works

### 1. Subscribe: Initial Data + Schema

When a client subscribes, they receive:
- The full initial document (unchanged)
- A **schema** that maps table names to document paths

```javascript
const { data, schema, unsubscribe } = await ws.api.subscribe_venue_detail(
  { venue_id: 1 },
  (updated) => console.log('Updated:', updated)
);

// schema = {
//   root: 'venues',
//   paths: {
//     'venues': '.',           // Root entity
//     'organisations': 'org',  // FK expansion
//     'sites': 'sites',        // Child collection
//     'packages': 'packages'   // Child collection
//   }
// }
```

### 2. On Changes: Atomic Events

When data changes, instead of re-querying, the server sends a `subscription:event` message:

```json
{
  "jsonrpc": "2.0",
  "method": "subscription:event",
  "params": {
    "subscription_id": "550e8400-e29b-41d4-a716-446655440000",
    "subscribable": "venue_detail",
    "event": {
      "table": "sites",
      "op": "update",
      "pk": { "id": 5 },
      "data": { "id": 5, "name": "Updated Site Name", "venue_id": 1 },
      "before": { "id": 5, "name": "Old Name", "venue_id": 1 }
    }
  }
}
```

### 3. Client: Apply Patch

The client uses the schema to locate where the change belongs in the document and applies it:

- **insert**: Adds new item to the appropriate array
- **update**: Finds item by primary key and merges changes
- **delete**: Finds item by primary key and removes it

The callback receives the updated local document, preserving any UI state.

## Scope Tables

Each subscribable tracks which tables are "in scope" - tables that can affect the document:

```sql
SELECT scope_tables FROM dzql.subscribables WHERE name = 'venue_detail';
-- Returns: ['venues', 'organisations', 'sites', 'packages']
```

This enables an optimization: events from tables not in scope are immediately skipped, avoiding unnecessary `_affected_documents()` calls.

### Automatic Extraction

Scope tables are automatically extracted when registering a subscribable:

```sql
SELECT dzql.register_subscribable(
  'venue_detail',
  '{"subscribe": [...]}'::jsonb,
  '{"venue_id": "int"}'::jsonb,
  'venues',                          -- root_entity -> scope includes 'venues'
  '{
    "org": "organisations",          -- scope includes 'organisations'
    "sites": {"entity": "sites", ...} -- scope includes 'sites'
  }'::jsonb
);

-- scope_tables automatically set to: ['venues', 'organisations', 'sites']
```

## Path Mapping

The path mapping tells the client where each table's data lives in the document structure:

| Table | Path | Meaning |
|-------|------|---------|
| `venues` | `.` | Root level |
| `organisations` | `org` | `document.org` |
| `sites` | `sites` | `document.sites[]` |
| `allocations` | `packages.allocations` | `document.packages[].allocations[]` |

### Nested Relations

For nested relations, paths are dot-separated:

```javascript
relations = {
  packages: {
    entity: 'packages',
    filter: 'venue_id=$venue_id',
    include: {
      allocations: 'allocations'
    }
  }
}

// Results in paths:
// 'packages' -> 'packages'
// 'allocations' -> 'packages.allocations'
```

## Client-Side Patching

The `WebSocketManager` automatically handles `subscription:event` messages:

```javascript
// Internally, when subscription:event is received:
applyAtomicUpdate(sub, event) {
  const { table, op, pk, data } = event;
  const path = sub.schema.paths[table];
  
  if (path === '.') {
    // Root entity update
    Object.assign(sub.localData[sub.schema.root], data);
  } else {
    // Relation update
    const arr = getArrayAtPath(sub.localData, path);
    if (op === 'insert') arr.push(data);
    if (op === 'update') {
      const idx = arr.findIndex(item => pkMatch(item, pk));
      if (idx !== -1) Object.assign(arr[idx], data);
    }
    if (op === 'delete') {
      const idx = arr.findIndex(item => pkMatch(item, pk));
      if (idx !== -1) arr.splice(idx, 1);
    }
  }
  
  // Trigger callback with patched document
  sub.callback(sub.localData);
}
```

## Composite Primary Keys

Atomic updates support composite primary keys:

```json
{
  "pk": { "product_id": 1, "part_id": 2 }
}
```

The client matches all key fields when finding items to update or delete.

## Migration from Full Re-queries

If you have existing subscribables, atomic updates are enabled automatically when:
1. The `scope_tables` column is populated (happens on `register_subscribable`)
2. The client receives the `schema` in the subscribe response

No code changes required - the system is backward compatible.

## Debugging

### Check Scope Tables

```sql
SELECT name, scope_tables 
FROM dzql.subscribables 
WHERE name = 'your_subscribable';
```

### Verify Path Mapping

Subscribe and log the schema:

```javascript
const { schema } = await ws.api.subscribe_venue_detail(
  { venue_id: 1 },
  () => {}
);
console.log('Path mapping:', schema.paths);
```

### Server Logs

Enable debug logging to see atomic events:

```
Sent atomic event to subscription abc123... (sites:update)
```

## Limitations

1. **Deeply nested updates**: For very deep nesting (3+ levels), paths become complex. Consider flattening your subscribable structure.

2. **Cascading deletes**: When a parent is deleted, the client may receive the parent delete before child deletes. The client handles missing parents gracefully.

3. **Permission changes**: If a user loses access mid-subscription, they may receive one final event before the subscription is terminated.

## See Also

- [Subscriptions Guide](./subscriptions.md) - Full subscribable documentation
- [Getting Started with Subscriptions](../getting-started/subscriptions-quick-start.md)
