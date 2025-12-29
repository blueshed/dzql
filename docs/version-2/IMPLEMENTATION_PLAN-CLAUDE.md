# TZQL v2 Implementation Plan

## Current Status

**35/36 tests pass** (1 skipped pending feature implementation)

### Completed Features
- [x] Entity CRUD codegen (`save_*`, `delete_*`, `get_*`, `search_*`)
- [x] Permission compiler (simple fields, `@field == @user_id`, 1-level graph traversal)
- [x] Graph rules (reactors, delete cascades)
- [x] Manifest generation and routing
- [x] Error categorization (`PERMISSION_DENIED`, `NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT`)
- [x] Auth functions (`register_user`, `login_user`)
- [x] JWT auth (`verifyToken`, `signToken`)
- [x] WebSocket server (Bun native)
- [x] WebSocket client with reconnect
- [x] `pg_notify` commit batching
- [x] Events table with `data`/`old_data`
- [x] Pinia entity stores
- [x] Pinia subscribable stores (template)
- [x] `_affected_keys` function codegen

---

## Missing Features

### Phase 1: Subscribable Core

#### 1.1 `lookup_*` Function
Generate `dzql_v2.lookup_<entity>()` for secondary index lookups.

**File:** `src/cli/codegen/sql.ts`

```typescript
export function generateLookupFunction(name: string, entityIR: any) {
  // Similar to search but with specific field filters
  // lookup_venues({ org_id: 5 }) → SELECT * FROM venues WHERE org_id = 5
}
```

#### 1.2 `get_<subscribable>` Snapshot Function
Generate the snapshot function that returns the full document.

**File:** `src/cli/codegen/subscribable_sql.ts` (new)

```typescript
export function generateSubscribableGetFunction(name: string, subIR: any) {
  // Builds the JOIN query based on includes graph
  // Returns root entity + nested includes as JSONB
}
```

#### 1.3 `_can_subscribe` Predicate
Generate permission check for subscription access.

**File:** `src/cli/codegen/subscribable_sql.ts`

```typescript
export function generateCanSubscribeFunction(name: string, subIR: any) {
  // dzql_v2.venue_detail_can_subscribe(p_user_id, p_params)
  // Returns TRUE if user can subscribe to this document
}
```

#### 1.4 `subscribe_*` in Manifest + Client
Add subscribable operations to manifest and generate client methods.

**Files:**
- `src/cli/codegen/manifest.ts` - Add subscribables to manifest
- `src/cli/codegen/client.ts` - Generate `subscribe_*` methods

---

### Phase 2: Permission Paths

#### 2.1 Multi-Level Graph Traversal
Support permission paths like `@org_id->organisations->acts_for[org_id=$].user_id`

**File:** `src/cli/compiler/permissions.ts`

```typescript
// Current: 1-level only
// Target: Recursive traversal with proper JOIN generation
```

#### 2.2 Condition Operators
Support more condition operators beyond `=`:
- `{active}` → `active = TRUE`
- `{role IN ('admin', 'owner')}` → `role IN (...)`
- `{deleted_at IS NULL}` → soft delete support

---

### Phase 3: Runtime Subscriptions

#### 3.1 Subscription Registry
Track active subscriptions in runtime memory.

**File:** `src/runtime/subscriptions.ts` (new)

```typescript
interface Subscription {
  id: string;
  subscribable: string;
  params: any;
  userId: number;
  connectionId: string;
}

class SubscriptionRegistry {
  subscribe(ws, subscribable, params): string;
  unsubscribe(subId): void;
  getAffected(table, op, data): Subscription[];
}
```

#### 3.2 Fanout Logic
When commit arrives, determine which subscriptions are affected and broadcast.

**File:** `src/runtime/ws.ts`

```typescript
// On pg_notify:
// 1. Fetch events by commit_id
// 2. For each event, call <sub>_affected_keys()
// 3. Match keys to active subscriptions
// 4. Send event to those connections
```

---

### Phase 4: Advanced Features

#### 4.1 `reset` Signal
Emit `reset` when permission boundary changes.

#### 4.2 `revoke` Signal
Emit `revoke` when user loses subscription access.

#### 4.3 Temporal Support
Support `ON DATE` queries for point-in-time data.

---

## Implementation Order

1. **`lookup_*` codegen** - Simple addition to sql.ts
2. **`subscribe_*` in manifest** - Enable client subscription calls
3. **`get_<subscribable>`** - Document snapshot queries
4. **`_can_subscribe`** - Access control for subscriptions
5. **Subscription registry** - Runtime tracking
6. **Fanout logic** - Real-time delivery
7. **Multi-level permissions** - Complex access paths
8. **reset/revoke signals** - Permission boundary changes

---

## Test Requirements

Each feature must have:
1. Unit test for codegen output
2. Integration test against real Postgres
3. End-to-end test if runtime-dependent

The skipped test `should sync data via Pinia store` will be unskipped once `subscribe_*` codegen is complete.
