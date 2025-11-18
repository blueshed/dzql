# Live Query Subscriptions - Quick Start

Get up and running with live query subscriptions in 5 minutes.

## Step 1: Create a Subscribable (2 min)

Create `my_subscribable.sql`:

```sql
SELECT dzql.register_subscribable(
  'venue_detail',                                               -- Name (use in API)
  '{"subscribe": ["@org_id->acts_for[org_id=$]{active}.user_id"]}'::jsonb,  -- Who can subscribe
  '{"venue_id": "int"}'::jsonb,                                -- Subscription parameters
  'venues',                                                     -- Root table
  '{"org": "organisations", "sites": {"entity": "sites", "filter": "venue_id=$venue_id"}}'::jsonb  -- Related data
);
```

## Step 2: Compile and Deploy (1 min)

```bash
# Compile to PostgreSQL functions
bun packages/dzql/src/compiler/cli/compile-subscribable.js my_subscribable.sql | psql $DATABASE_URL
```

This creates 3 functions:
- `venue_detail_can_subscribe(user_id, params)` - permission check
- `get_venue_detail(params, user_id)` - query builder
- `venue_detail_affected_documents(table, op, old, new)` - change detector

## Step 3: Subscribe from Client (2 min)

```javascript
import { WebSocketManager } from '@dzql/client';

const ws = new WebSocketManager('ws://localhost:3000/ws');
await ws.connect();

// Subscribe - get initial data + live updates
const { data, unsubscribe } = await ws.api.subscribe_venue_detail(
  { venue_id: 123 },
  (updatedData) => {
    console.log('Venue changed!', updatedData);
  }
);

console.log('Initial data:', data);

// Later: cleanup
await unsubscribe();
```

## That's It!

Your client now receives real-time updates whenever:
- The venue record changes
- Related organisation changes
- Related sites change

All change detection happens in PostgreSQL - zero configuration needed on the server!

## Next Steps

- [Full Documentation](../guides/subscriptions.md)
- [Permission Paths Guide](../../../../docs/architecture/PERMISSIONS.md)
- [API Reference](../reference/api.md)

## Common Patterns

### Simple Document (Single Table)

```sql
SELECT dzql.register_subscribable(
  'user_settings',
  '{"subscribe": ["@user_id"]}'::jsonb,  -- Only owner
  '{"user_id": "int"}'::jsonb,
  'user_settings',
  '{}'::jsonb  -- No relations
);
```

### With One Relation

```sql
SELECT dzql.register_subscribable(
  'booking_summary',
  '{"subscribe": ["@user_id"]}'::jsonb,
  '{"booking_id": "int"}'::jsonb,
  'bookings',
  '{"venue": "venues"}'::jsonb  -- Include venue
);
```

### With Filtered Relations

```sql
SELECT dzql.register_subscribable(
  'organisation_dashboard',
  '{"subscribe": ["@id->acts_for[org_id=$]{active}.user_id"]}'::jsonb,
  '{"org_id": "int"}'::jsonb,
  'organisations',
  '{
    "members": {
      "entity": "acts_for",
      "filter": "org_id=$org_id AND valid_to IS NULL"
    },
    "venues": {
      "entity": "venues",
      "filter": "org_id=$org_id"
    }
  }'::jsonb
);
```

### Multiple Permission Paths (OR logic)

```sql
SELECT dzql.register_subscribable(
  'venue_admin',
  '{
    "subscribe": [
      "@owner_id",                                    -- Direct owner
      "@org_id->acts_for[org_id=$]{active}.user_id"  -- OR org member
    ]
  }'::jsonb,
  '{"venue_id": "int"}'::jsonb,
  'venues',
  '{"sites": {"entity": "sites", "filter": "venue_id=$venue_id"}}'::jsonb
);
```

## Debugging Tips

### Test the functions manually:

```sql
-- Check permission
SELECT venue_detail_can_subscribe(1, '{"venue_id": 123}'::jsonb);

-- Get data
SELECT get_venue_detail('{"venue_id": 123}'::jsonb, 1);

-- Test change detection
SELECT venue_detail_affected_documents(
  'venues',
  'update',
  '{"id": 123}'::jsonb,
  '{"id": 123, "name": "New"}'::jsonb
);
```

### Check active subscriptions:

```javascript
// Client-side
console.log('My subscriptions:', ws.subscriptions.size);
```

## FAQ

**Q: When should I use subscriptions vs. simple queries?**
A: Use subscriptions when data changes frequently and client needs to stay in sync. Use simple queries for one-time lookups.

**Q: What happens when client disconnects?**
A: Server automatically cleans up all subscriptions for that connection.

**Q: Can multiple clients subscribe to the same data?**
A: Yes! Each subscription is independent. All will receive updates.

**Q: How do I update the subscribable definition?**
A: Re-compile and deploy. The `register_subscribable()` call uses `ON CONFLICT UPDATE`, so it's safe to run repeatedly.

**Q: What if the underlying data is deleted?**
A: The `get_<name>()` function returns `null`. Handle this in your callback:
```javascript
(data) => {
  if (!data) {
    console.log('Record was deleted');
    return;
  }
  updateUI(data);
}
```

**Q: How do I subscribe to a list of items?**
A: Create a subscribable with array parameters or use multiple subscriptions. For dashboard-style views, consider a single subscribable that returns an array.

## Performance Tips

1. **Index your joins**: Make sure foreign keys are indexed
2. **Keep _affected_documents() simple**: Early return for unrelated tables
3. **Limit relation depth**: Avoid deeply nested relations (max 2-3 levels)
4. **Use specific subscription keys**: `venue_id` is better than `org_id` (fewer false positives)
5. **Unsubscribe when done**: Always cleanup to free server resources

## Architecture Benefits

- ✅ **PostgreSQL-First**: All logic in database, not application code
- ✅ **Zero Configuration**: No server changes needed for new subscribables
- ✅ **Type Safe**: Compiled functions validated at deploy time
- ✅ **Efficient**: In-memory registry, PostgreSQL does matching
- ✅ **Secure**: Permission paths enforced at database level
- ✅ **Scalable**: Stateless server, can add instances freely
