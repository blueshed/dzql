# Release Notes - v0.2.0

## 🎉 Major Feature: Live Query Subscriptions

This release introduces **Pattern 1: Live Query Subscriptions** - a PostgreSQL-first architecture for real-time, denormalized document updates.

### What's New

Clients can now subscribe to complex, denormalized documents and receive automatic updates when underlying data changes - all without writing server code!

```javascript
// Client subscribes to a venue with all related data
const { data, unsubscribe } = await ws.api.subscribe_venue_detail(
  { venue_id: 123 },
  (updatedVenue) => {
    // Automatically called when venue, org, or sites change
    console.log('Updated:', updatedVenue);
  }
);
```

### Key Features

#### 1. PostgreSQL-First Architecture
- All change detection logic compiled to PostgreSQL functions
- Server stays "dumb" - just routes messages
- Zero runtime interpretation
- Production-ready performance

#### 2. Declarative Subscribable Definition
Define subscribables in SQL with permissions, parameters, and relations:

```sql
SELECT dzql.register_subscribable(
  'venue_detail',
  '{"subscribe": ["@org_id->acts_for[org_id=$]{active}.user_id"]}'::jsonb,
  '{"venue_id": "int"}'::jsonb,
  'venues',
  '{"org": "organisations", "sites": {"entity": "sites", "filter": "venue_id=$venue_id"}}'::jsonb
);
```

#### 3. Automatic Code Generation
Compiler generates three PostgreSQL functions per subscribable:
- `<name>_can_subscribe(user_id, params)` - Access control
- `get_<name>(params, user_id)` - Document builder
- `<name>_affected_documents(table, op, old, new)` - Change detection

#### 4. Zero Server Configuration
Adding new subscribables requires **zero server code changes**:
- Pattern matching on method names (`subscribe_*`, `unsubscribe_*`)
- Automatic permission checking
- Automatic cleanup on disconnect
- Generic event routing

#### 5. Efficient In-Memory Registry
- Active subscriptions stored in-memory for fast lookups
- Connection-scoped (no shared state between servers)
- Automatic cleanup when WebSocket closes
- Statistics and debugging support

### Components Added

#### Compiler
- `src/compiler/parser/subscribable-parser.js` - Parse subscribable definitions
- `src/compiler/codegen/subscribable-codegen.js` - Generate PostgreSQL functions
- `compile-subscribable.js` - CLI tool for compilation

#### Database
- `src/database/migrations/009_subscriptions.sql` - Subscribables registry table
- `dzql.subscribables` table for metadata
- Helper functions: `register_subscribable()`, `get_subscribables()`, etc.

#### Server
- `src/server/subscriptions.js` - In-memory subscription management
- `src/server/ws.js` - Enhanced with `subscribe_*` / `unsubscribe_*` handlers
- `src/server/index.js` - Event listener integration

#### Client
- `src/client/ws.js` - Enhanced with subscription support
- API proxy intercepts `subscribe_*` / `unsubscribe_*` methods
- Automatic callback invocation on updates
- Cleanup utilities

#### Documentation
- `docs/LIVE_QUERY_SUBSCRIPTIONS.md` - Comprehensive guide
- `docs/SUBSCRIPTIONS_QUICK_START.md` - 5-minute quick start
- `tests/test-subscription-e2e.js` - End-to-end integration test

### Examples

#### Simple Subscription
```javascript
// Subscribe to user settings
const { data } = await ws.api.subscribe_user_settings(
  { user_id: 1 },
  (settings) => updateUI(settings)
);
```

#### With Relations
```javascript
// Subscribe to booking with venue and customer data
const { data } = await ws.api.subscribe_booking_detail(
  { booking_id: 456 },
  (booking) => {
    console.log('Booking:', booking);
    console.log('Venue:', booking.venue);
    console.log('Customer:', booking.customer);
    console.log('Items:', booking.items);
  }
);
```

#### Cleanup
```javascript
const { unsubscribe } = await ws.api.subscribe_venue_detail(...);

// Later
await unsubscribe();  // Clean up subscription
```

### Architecture Highlights

#### Change Propagation Flow

1. **Database Change**: `UPDATE venues SET name = 'New Name' WHERE id = 123`
2. **NOTIFY Trigger**: PostgreSQL sends notification via existing event system
3. **Server Receives**: Event listener gets notification
4. **PostgreSQL Matching**: Server calls `venue_detail_affected_documents('venues', 'update', old, new)`
5. **PostgreSQL Returns**: `[{"venue_id": 123}]` (affected subscription keys)
6. **Match Active Subscriptions**: Server finds all subscriptions with `{venue_id: 123}`
7. **Re-Query**: For each match, call `get_venue_detail({"venue_id": 123}, user_id)`
8. **Send Update**: Server sends fresh data to each subscribed client

**Key Point**: All matching logic happens in PostgreSQL, not JavaScript!

#### Permission Enforcement

Permissions are checked at **subscribe time** via `<name>_can_subscribe()`:
- Compiled from path DSL during deployment
- Enforced at database level
- No runtime permission checks needed for updates

### Breaking Changes

None - this release is fully backward compatible.

### Migration Guide

No migration needed for existing code. To start using subscriptions:

1. **Run Database Migration**
   ```bash
   psql $DATABASE_URL < packages/dzql/src/database/migrations/009_subscriptions.sql
   ```

2. **Create a Subscribable**
   ```sql
   SELECT dzql.register_subscribable(...);
   ```

3. **Compile and Deploy**
   ```bash
   node packages/dzql/compile-subscribable.js my_subscribable.sql | psql $DATABASE_URL
   ```

4. **Use in Client**
   ```javascript
   await ws.api.subscribe_my_name(params, callback);
   ```

### Performance Characteristics

#### Subscription Registration
- O(1) - In-memory Map operations
- No database queries after initial `get_<name>()` call

#### Change Detection
- Runs on every database change
- Optimized via:
  - Early returns for unrelated tables
  - Indexed field access
  - Compiled logic (no interpretation)

#### Update Delivery
- One `get_<name>()` query per affected subscription
- Batching opportunities for future optimization
- WebSocket framing overhead minimal

#### Memory Footprint
- ~200 bytes per subscription (subscription_id, params, metadata)
- Cleared automatically on disconnect
- No persistent storage (database-free design)

### Testing

New test coverage includes:
- `tests/test-subscription-e2e.js` - Full integration test
- `test-subscribable-parse.js` - Parser validation
- `test-subscribable-compile.js` - Code generation validation
- `test-simple-subscribable.js` - End-to-end compilation
- `test-phase2-db.sh` - Database schema validation

Run tests:
```bash
# Unit tests
bun test

# E2E test (requires PostgreSQL)
bun packages/dzql/tests/test-subscription-e2e.js
```

### Known Limitations

1. **Reconnection Handling**: Client must re-subscribe after reconnect
   - Future: Automatic re-subscription on reconnect
   - Workaround: Track active subscriptions in client state

2. **Subscription Batching**: Updates sent individually
   - Future: Batch multiple updates in single message
   - Impact: Minor - WebSocket framing is efficient

3. **Cross-Server Subscriptions**: Subscriptions are connection-local
   - Future: Shared subscription registry (Redis/PostgreSQL)
   - Impact: Load balancers must use sticky sessions or clients must handle reconnect

4. **Circular Relations**: Not supported in compiler
   - Workaround: Limit relation depth to 2-3 levels

### Upgrading

From 0.1.x to 0.2.0:

```bash
# Update package
npm install dzql@0.2.0  # or bun add dzql@0.2.0

# Run migration
psql $DATABASE_URL < node_modules/dzql/src/database/migrations/009_subscriptions.sql

# Start using subscriptions (optional)
# Existing code continues to work unchanged
```

### Future Enhancements

Planned for future releases:
- **Auto-resubscribe**: Client automatically re-subscribes after reconnect
- **Subscription batching**: Batch multiple updates in single message
- **Shared registry**: Cross-server subscription coordination
- **Subscription introspection**: Client can query active subscriptions
- **Subscription lifecycle hooks**: `onSubscribe`, `onUnsubscribe`, `onUpdate`
- **Optimistic updates**: Client-side predictions before server confirmation

### Credits

This implementation follows the vision outlined in `vision.md` for "Pattern 1: Live Query (client-driven subscriptions)".

Architecture principles:
- **PostgreSQL-First**: Inspired by PostgREST and Hasura
- **Zero Configuration**: Rails-like convention over configuration
- **Compiled Logic**: Avoiding runtime interpretation overhead
- **In-Memory Performance**: Following Redis design patterns

### Documentation

- [Live Query Subscriptions Guide](./docs/LIVE_QUERY_SUBSCRIPTIONS.md)
- [Quick Start Guide](./docs/SUBSCRIPTIONS_QUICK_START.md)
- [Vision Document](./vision.md)
- [Path DSL Reference](./docs/PATH_DSL.md)

### Issues Fixed

None - this is a new feature release.

### Acknowledgments

Thanks to the team for feedback on the architecture and testing!

---

## Full Changelog

### Added
- Live query subscription system (Pattern 1)
- Subscribable compiler (parser + code generator)
- Database migration 009_subscriptions.sql
- In-memory subscription registry
- WebSocket subscribe_*/unsubscribe_* handlers
- Client-side subscription API
- Comprehensive documentation
- E2E integration tests
- Example subscribables

### Changed
- Enhanced WebSocketManager with subscription support
- Extended event listener to process subscription updates
- Improved broadcaster with `toConnection()` helper

### Fixed
- PathParser AST handling in code generator

---

**Version**: 0.2.0
**Release Date**: 2025-01-17
**Migration Required**: Yes (database only)
**Breaking Changes**: None
