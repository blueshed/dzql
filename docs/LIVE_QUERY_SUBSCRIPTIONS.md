# Live Query Subscriptions

Live Query Subscriptions (Pattern 1 from vision.md) enable clients to subscribe to denormalized documents and receive real-time updates when the underlying data changes.

## Overview

### Architecture Principles

- **PostgreSQL-First**: All matching logic is compiled to PostgreSQL functions, not JavaScript
- **In-Memory Registry**: Server holds active subscriptions in memory for performance
- **Zero Runtime Interpretation**: All logic pre-compiled during deployment
- **Denormalized Documents**: Subscribables combine data from multiple tables into client-friendly views

### How It Works

1. **Define Subscribable**: Register a subscribable with permissions, parameters, and relations
2. **Compile**: Generate three PostgreSQL functions:
   - `<name>_can_subscribe(user_id, params)` - Permission check
   - `get_<name>(params, user_id)` - Query function
   - `<name>_affected_documents(table, op, old, new)` - Change detection
3. **Subscribe**: Client calls `ws.api.subscribe_<name>(params, callback)`
4. **Update**: Database changes trigger NOTIFY → server asks PostgreSQL which subscriptions are affected → server re-queries and sends updates

## Quick Start

### 1. Define a Subscribable

Create a SQL file with your subscribable definition:

```sql
-- examples/subscribables/venue_detail.sql
SELECT dzql.register_subscribable(
  'venue_detail',
  '{"subscribe": ["@org_id->acts_for[org_id=$]{active}.user_id"]}'::jsonb,
  '{"venue_id": "int"}'::jsonb,
  'venues',
  '{
    "org": "organisations",
    "sites": {
      "entity": "sites",
      "filter": "venue_id=$venue_id"
    }
  }'::jsonb
);
```

**Parameters:**
- `name`: Identifier used in API calls (e.g., `venue_detail`)
- `permission_paths`: Access control using path DSL
- `param_schema`: Parameters required to subscribe (subscription key)
- `root_entity`: Primary table
- `relations`: Related entities to include in the document

### 2. Compile and Deploy

```bash
# Compile subscribable to SQL functions
node packages/dzql/compile-subscribable.js \
  examples/subscribables/venue_detail.sql \
  > /tmp/venue_detail.sql

# Deploy to database
psql $DATABASE_URL < /tmp/venue_detail.sql
```

This generates three functions:
- `venue_detail_can_subscribe(user_id, params)`
- `get_venue_detail(params, user_id)`
- `venue_detail_affected_documents(table, op, old, new)`

### 3. Client Usage

```javascript
import { WebSocketManager } from '@dzql/client';

const ws = new WebSocketManager('ws://localhost:3000/ws');
await ws.connect();

// Subscribe to venue updates
const { data, subscription_id, unsubscribe } = await ws.api.subscribe_venue_detail(
  { venue_id: 123 },
  (updatedData) => {
    console.log('Venue updated:', updatedData);
    // updatedData = { id: 123, name: 'Venue Name', org: {...}, sites: [...] }
  }
);

// Initial data is returned immediately
console.log('Initial venue data:', data);

// Later: unsubscribe when done
await unsubscribe();
```

## Subscribable Definition

### Permission Paths

Control who can subscribe using the path DSL:

```javascript
{
  "subscribe": [
    "@org_id->acts_for[org_id=$]{active}.user_id"
  ]
}
```

This allows users who:
- Have an active `acts_for` relationship
- Where `org_id` matches the venue's `org_id`

Multiple paths can be provided for OR logic:

```javascript
{
  "subscribe": [
    "@owner_id",                                    // Direct owner
    "@org_id->acts_for[org_id=$]{active}.user_id"  // OR org member
  ]
}
```

### Parameter Schema

Define the subscription key (what makes each subscription unique):

```javascript
{
  "venue_id": "int"
}
```

Clients must provide these parameters when subscribing.

### Relations

Include related data in the denormalized document:

```javascript
{
  // Simple relation - include entire related record
  "org": "organisations",

  // Filtered relation - include sites filtered by venue_id
  "sites": {
    "entity": "sites",
    "filter": "venue_id=$venue_id"
  },

  // Nested relations
  "org": {
    "entity": "organisations",
    "relations": {
      "users": {
        "entity": "acts_for",
        "filter": "org_id=$org_id AND valid_to IS NULL"
      }
    }
  }
}
```

## Generated Functions

### 1. Permission Check: `<name>_can_subscribe`

```sql
CREATE FUNCTION venue_detail_can_subscribe(
  p_user_id INT,
  p_params JSONB
) RETURNS BOOLEAN;
```

Returns `true` if the user can subscribe with the given parameters.

Called automatically when client subscribes.

### 2. Query Function: `get_<name>`

```sql
CREATE FUNCTION get_venue_detail(
  p_params JSONB,
  p_user_id INT
) RETURNS JSONB;
```

Builds the denormalized document from the database.

Called:
- Initially when client subscribes (returns first data)
- After each change that affects the subscription (returns updated data)

### 3. Change Detection: `<name>_affected_documents`

```sql
CREATE FUNCTION venue_detail_affected_documents(
  p_table TEXT,
  p_op TEXT,
  p_old JSONB,
  p_new JSONB
) RETURNS JSONB[];
```

Determines which subscription instances are affected by a database change.

Returns array of parameter sets (subscription keys) that need updates.

Example:
```sql
-- When venue 123 is updated
SELECT venue_detail_affected_documents(
  'venues',
  'update',
  '{"id": 123, "name": "Old"}'::jsonb,
  '{"id": 123, "name": "New"}'::jsonb
);
-- Returns: [{"venue_id": 123}]
```

## Server Integration

The server automatically:
1. Handles `subscribe_<name>` and `unsubscribe_<name>` RPC calls
2. Maintains in-memory subscription registry
3. Listens to database NOTIFY events
4. Calls `_affected_documents()` to find affected subscriptions
5. Re-executes `get_<name>()` to get fresh data
6. Sends updates to subscribed clients

No server code changes needed when adding new subscribables!

## WebSocket Protocol

### Subscribe

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "subscribe_venue_detail",
  "params": {
    "venue_id": 123
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "subscription_id": "550e8400-e29b-41d4-a716-446655440000",
    "data": {
      "id": 123,
      "name": "Venue Name",
      "org": { "id": 1, "name": "Organization" },
      "sites": [...]
    }
  }
}
```

### Updates

When data changes, server sends:

```json
{
  "jsonrpc": "2.0",
  "method": "subscription:update",
  "params": {
    "subscription_id": "550e8400-e29b-41d4-a716-446655440000",
    "subscribable": "venue_detail",
    "data": {
      "id": 123,
      "name": "Updated Venue Name",
      "org": { "id": 1, "name": "Organization" },
      "sites": [...]
    }
  }
}
```

Client's callback is invoked automatically with the new data.

### Unsubscribe

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "unsubscribe_venue_detail",
  "params": {
    "venue_id": 123
  }
}
```

Or call the returned `unsubscribe()` function:

```javascript
const { unsubscribe } = await ws.api.subscribe_venue_detail(...);
await unsubscribe();
```

## Advanced Examples

### User Profile with Nested Relations

```sql
SELECT dzql.register_subscribable(
  'user_profile',
  '{"subscribe": ["@id"]}'::jsonb,
  '{"user_id": "int"}'::jsonb,
  'users',
  '{
    "organisations": {
      "entity": "acts_for",
      "filter": "user_id=$user_id AND valid_to IS NULL",
      "relations": {
        "org": "organisations"
      }
    },
    "permissions": {
      "entity": "user_permissions",
      "filter": "user_id=$user_id"
    }
  }'::jsonb
);
```

### Multi-Parameter Subscription

```sql
SELECT dzql.register_subscribable(
  'booking_detail',
  '{"subscribe": ["@user_id", "@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id"]}'::jsonb,
  '{"booking_id": "int", "venue_id": "int"}'::jsonb,
  'bookings',
  '{
    "venue": "venues",
    "customer": "users",
    "items": {
      "entity": "booking_items",
      "filter": "booking_id=$booking_id"
    }
  }'::jsonb
);
```

## Performance Considerations

### In-Memory Registry

Active subscriptions are stored in-memory on the server:
- Fast lookup without database queries
- Automatically cleaned up when WebSocket closes
- Scale by adding more server instances (subscriptions are connection-local)

### Change Detection

The `_affected_documents()` function runs for every database change:
- Keep logic simple and indexed
- Return only truly affected subscriptions
- Use early returns for unrelated tables

Example optimization:

```sql
CREATE FUNCTION my_subscribable_affected_documents(...)
RETURNS JSONB[] AS $$
BEGIN
  -- Early return for unrelated tables
  IF p_table NOT IN ('venues', 'sites') THEN
    RETURN ARRAY[]::JSONB[];
  END IF;

  -- Use indexed fields
  IF p_table = 'venues' THEN
    RETURN ARRAY[jsonb_build_object('venue_id', (p_new->>'id')::int)];
  END IF;

  -- ... more logic
END;
$$ LANGUAGE plpgsql STABLE;
```

### Query Efficiency

The `get_<name>()` function runs on every update:
- Use JOINs and indexes appropriately
- Consider materialized views for complex aggregations
- Limit relation depth to avoid N+1 queries

## Debugging

### Check Active Subscriptions

```javascript
// Server-side (in development)
import { getAllSubscriptions, getStats } from './server/subscriptions.js';

console.log('Active subscriptions:', getAllSubscriptions());
console.log('Stats:', getStats());
```

### Test Functions Manually

```sql
-- Test permission check
SELECT venue_detail_can_subscribe(1, '{"venue_id": 123}'::jsonb);

-- Test query
SELECT get_venue_detail('{"venue_id": 123}'::jsonb, 1);

-- Test change detection
SELECT venue_detail_affected_documents(
  'venues',
  'update',
  '{"id": 123}'::jsonb,
  '{"id": 123, "name": "New Name"}'::jsonb
);
```

### Enable Debug Logging

```javascript
// Server logs subscription events
import { wsLogger } from './server/logger.js';

wsLogger.level = 'debug';  // See all subscription operations
```

## Migration Guide

### From Polling

Before:
```javascript
// Poll every 5 seconds
setInterval(async () => {
  const venue = await fetch(`/api/venues/${venueId}`).then(r => r.json());
  updateUI(venue);
}, 5000);
```

After:
```javascript
// Real-time updates
const { data, unsubscribe } = await ws.api.subscribe_venue_detail(
  { venue_id: venueId },
  (venue) => updateUI(venue)
);

updateUI(data); // Initial data
```

### From Pattern 2 (Need to Know)

Pattern 2 notifications tell you "something changed":
```javascript
ws.onBroadcast('venues:updated', (params) => {
  // Manually fetch updated data
  refetchVenue(params.id);
});
```

Pattern 1 subscriptions give you the data:
```javascript
ws.api.subscribe_venue_detail(
  { venue_id: 123 },
  (venue) => {
    // Fresh data automatically provided
    updateUI(venue);
  }
);
```

## Best Practices

1. **One subscribable per use case**: Create focused subscribables for specific UI needs
2. **Minimize relations**: Only include data the client actually needs
3. **Use specific parameters**: Subscription keys should be precise (e.g., `venue_id`, not `org_id`)
4. **Clean up subscriptions**: Always unsubscribe when component unmounts
5. **Handle reconnection**: Client automatically re-authenticates, but may need to re-subscribe
6. **Test permissions thoroughly**: Use path DSL carefully to prevent unauthorized access

## Troubleshooting

### Subscription Not Receiving Updates

1. Check that `_affected_documents()` returns correct parameter sets:
   ```sql
   SELECT my_subscribable_affected_documents('table', 'update', old, new);
   ```

2. Verify subscription is registered:
   ```javascript
   console.log('Subscriptions:', ws.subscriptions.size);
   ```

3. Confirm WebSocket is connected:
   ```javascript
   console.log('Connected:', ws.socket?.readyState === 1);
   ```

### Permission Denied

1. Test permission function directly:
   ```sql
   SELECT my_subscribable_can_subscribe(user_id, params);
   ```

2. Check path DSL syntax in subscribable definition

3. Verify user has required relationships (e.g., `acts_for` records)

### Compilation Errors

1. Validate JSON syntax in subscribable definition
2. Check that all referenced tables exist
3. Ensure parameter names match between schema and filters
4. Test parser separately:
   ```bash
   node packages/dzql/test-subscribable-parse.js
   ```

## See Also

- [Vision Document](../vision.md) - Architecture overview and patterns
- [Path DSL](./PATH_DSL.md) - Permission path syntax
- [WebSocket API](./WEBSOCKET_API.md) - Full WebSocket protocol reference
- [Compiler Reference](./COMPILER.md) - Code generation details
