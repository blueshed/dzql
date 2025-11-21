# DZQL Test Contract

This document defines the features DZQL promises to users and the tests that prove they work.

## Feature Contract Checklist

### 1. Core CRUD Operations (Generic/Interpreted)

**Promise:** Register an entity and get 5 automatic operations that work immediately.

- [ ] **GET** - Retrieve single record by ID
  - [ ] Returns record when it exists
  - [ ] Throws "record not found" when missing
  - [ ] Expands foreign keys when configured
  - [ ] Filters sensitive fields (password_hash)
  - [ ] Respects view permissions

- [ ] **SAVE** - Create or update records
  - [ ] INSERT when no ID provided
  - [ ] UPDATE when ID provided
  - [ ] Partial updates work (only provided fields change)
  - [ ] Returns complete record after save
  - [ ] Respects create/update permissions
  - [ ] Creates event in dzql.events table
  - [ ] Event includes complete record data

- [ ] **DELETE** - Remove records
  - [ ] Hard delete when soft_delete=false
  - [ ] Soft delete (deleted_at) when soft_delete=true
  - [ ] Respects delete permissions
  - [ ] Creates event in dzql.events table
  - [ ] Returns deleted record

- [ ] **SEARCH** - Find records with filters
  - [ ] Returns paginated results (data, total, page, limit)
  - [ ] Supports text search across searchable_fields
  - [ ] Supports operators: eq, ne, gt, gte, lt, lte, like, ilike
  - [ ] Supports IN arrays
  - [ ] Supports sorting (field, order)
  - [ ] Respects view permissions

- [ ] **LOOKUP** - Autocomplete/dropdown data
  - [ ] Returns array of {value, label} objects
  - [ ] Filters by label field
  - [ ] Orders by label field
  - [ ] Limits results

**Test File:** `tests/integration/generic-crud.test.js`

---

### 2. Compiled Operations

**Promise:** Compile entity to static SQL for 50-100x performance improvement.

- [ ] **Compiler generates valid SQL**
  - [ ] All 5 operations generated (get, save, delete, lookup, search)
  - [ ] Permission functions generated
  - [ ] No syntax errors in generated SQL
  - [ ] PostgreSQL can execute generated functions

- [ ] **Compiled functions have identical behavior**
  - [ ] GET returns same data as generic
  - [ ] SAVE works identically to generic
  - [ ] DELETE works identically to generic
  - [ ] SEARCH returns same results as generic
  - [ ] LOOKUP returns same options as generic

- [ ] **Performance improvement**
  - [ ] No runtime config lookups
  - [ ] No dynamic SQL generation
  - [ ] PostgreSQL can cache execution plans
  - [ ] Faster than generic operations

**Test File:** `tests/integration/compiled-crud.test.js`

---

### 3. Real-Time Events & Notifications

**Promise:** Every database change creates an event and broadcasts to connected clients.

- [ ] **Event Creation**
  - [ ] INSERT creates event with op='insert', after=record, before=null
  - [ ] UPDATE creates event with op='update', before=old, after=new
  - [ ] DELETE creates event with op='delete', before=record, after=null
  - [ ] Event includes table_name, pk, user_id, at timestamp

- [ ] **Event Data Completeness**
  - [ ] Events include FK expansions
  - [ ] Events include M2M fields (tag_ids, tags)
  - [ ] Events include field defaults
  - [ ] Events filter sensitive fields

- [ ] **Notification Targeting**
  - [ ] Empty notification_paths → null notify_users (broadcast all)
  - [ ] Notification paths resolve to user_id array
  - [ ] Only targeted users receive broadcasts

- [ ] **PostgreSQL NOTIFY**
  - [ ] Trigger fires on dzql.events INSERT
  - [ ] NOTIFY sends to 'dzql' channel
  - [ ] Payload includes complete event data

**Test File:** `tests/integration/events-notifications.test.js`

---

### 4. Many-to-Many Relationships

**Promise:** Define M2M in entity config, sync junction tables automatically in single atomic call.

- [ ] **Configuration**
  - [ ] Parser extracts many_to_many from graph_rules
  - [ ] Compiler generates M2M sync code
  - [ ] Runtime (generic) interprets M2M config

- [ ] **Junction Table Sync (Generic)**
  - [ ] Create with tag_ids syncs junction table
  - [ ] Update tag_ids adds new relationships
  - [ ] Update tag_ids removes old relationships
  - [ ] Empty array [] removes all relationships
  - [ ] Omitting field leaves relationships unchanged
  - [ ] Sync is atomic (transaction)

- [ ] **Junction Table Sync (Compiled)**
  - [ ] Same behavior as generic mode
  - [ ] No runtime loops in generated SQL
  - [ ] All table/column names are literals
  - [ ] Static code blocks per relationship

- [ ] **Output Expansion**
  - [ ] GET returns tag_ids array
  - [ ] SAVE returns tag_ids array
  - [ ] SEARCH returns tag_ids for each result
  - [ ] expand=true includes full objects
  - [ ] expand=false only includes IDs

- [ ] **Events Include M2M**
  - [ ] Event.after includes tag_ids
  - [ ] Event.after includes expanded objects if configured
  - [ ] Broadcasts send complete M2M state

**Test File:** `tests/integration/many-to-many.test.js`

---

### 5. Field Defaults

**Promise:** Auto-populate fields on INSERT with variables or literals.

- [ ] **Variable Resolution**
  - [ ] @user_id → current user's ID
  - [ ] @now → current timestamp
  - [ ] @today → current date
  - [ ] Literal values inserted as-is

- [ ] **Behavior**
  - [ ] Applied only on INSERT (not UPDATE)
  - [ ] Explicit values override defaults
  - [ ] Works in generic mode
  - [ ] Works in compiled mode

- [ ] **Common Use Cases**
  - [ ] owner_id = @user_id (ownership)
  - [ ] created_by = @user_id (audit)
  - [ ] created_at = @now (timestamp)
  - [ ] status = "draft" (state machine)

**Test File:** `tests/integration/field-defaults.test.js`

---

### 6. Graph Rules

**Promise:** Automatic relationship management on create/update/delete.

- [ ] **Action Types**
  - [ ] create - INSERT related record
  - [ ] update - UPDATE related records
  - [ ] delete - DELETE related records
  - [ ] validate - Block operation if validation fails
  - [ ] execute - Fire-and-forget function call

- [ ] **Conditional Execution**
  - [ ] condition with @before.field
  - [ ] condition with @after.field
  - [ ] SQL expressions (=, !=, AND, OR)

- [ ] **Transaction Behavior**
  - [ ] All actions in same transaction
  - [ ] Rollback on any failure
  - [ ] validate rollbacks entire operation
  - [ ] execute errors logged but don't rollback

- [ ] **Variable Resolution**
  - [ ] @user_id, @id, @field_name
  - [ ] @now, @today
  - [ ] Works in generic mode
  - [ ] Works in compiled mode

**Test File:** `tests/integration/graph-rules.test.js`

---

### 7. Permissions (Row-Level Security)

**Promise:** Path-based access control for all CRUD operations.

- [ ] **Permission Types**
  - [ ] view - Controls who can read
  - [ ] create - Controls who can create
  - [ ] update - Controls who can modify
  - [ ] delete - Controls who can remove

- [ ] **Path Resolution**
  - [ ] Direct field: @owner_id
  - [ ] Via FK: @org_id->acts_for[org_id=$]{active}.user_id
  - [ ] Nested paths work
  - [ ] Temporal filtering: {active}

- [ ] **Enforcement**
  - [ ] Empty array [] = allow all
  - [ ] Missing permission = deny all
  - [ ] User not in path = "Permission denied" error
  - [ ] Checked before operation executes

- [ ] **Security**
  - [ ] Cannot bypass with SQL injection
  - [ ] Works in generic mode
  - [ ] Works in compiled mode

**Test File:** `tests/integration/permissions.test.js`

---

### 8. Authentication

**Promise:** Built-in user registration and login with JWT.

- [ ] **User Registration**
  - [ ] register_user(email, password) creates user
  - [ ] Password hashed with bcrypt
  - [ ] Returns user_id, email, name
  - [ ] Never exposes password_hash
  - [ ] Rejects duplicate emails

- [ ] **User Login**
  - [ ] login_user(email, password) validates credentials
  - [ ] Returns JWT token
  - [ ] Returns user profile
  - [ ] Rejects invalid credentials
  - [ ] Rejects non-existent users

- [ ] **Profile Function**
  - [ ] _profile(user_id) returns user data
  - [ ] Returns user_id (not id)
  - [ ] Returns all fields except sensitive ones
  - [ ] Works with any users table schema
  - [ ] Returns null for non-existent user

**Test File:** `tests/integration/auth.test.js` ✅ (7/7 passing)

---

### 9. Foreign Key Expansion

**Promise:** Automatically dereference FKs and include related data in GET operations.

- [ ] **Direct FK (Single Object)**
  - [ ] "org": "organisations" dereferences org_id
  - [ ] Returns full nested object
  - [ ] NULL FK returns null

- [ ] **Reverse FK (Child Array)**
  - [ ] "sites": "sites" includes child array
  - [ ] Auto-detects FK relationship
  - [ ] Returns empty array if no children

- [ ] **Multiple FKs**
  - [ ] Can expand multiple relationships
  - [ ] Works in GET operation
  - [ ] Works in generic mode
  - [ ] Works in compiled mode

**Test File:** `tests/integration/fk-expansion.test.js`

---

### 10. Temporal Relationships

**Promise:** Handle time-based relationships with valid_from/valid_to.

- [ ] **Configuration**
  - [ ] temporal_fields config maps column names
  - [ ] {active} filter in paths

- [ ] **Behavior**
  - [ ] GET with on_date parameter
  - [ ] Returns records valid on that date
  - [ ] Permission paths with {active}
  - [ ] Notification paths with {active}

**Test File:** `tests/integration/temporal.test.js`

---

### 11. Live Query Subscriptions

**Promise:** Subscribe to denormalized documents, get automatic updates when data changes.

- [ ] **Subscribable Definition**
  - [ ] register_subscribable creates functions
  - [ ] Permission check function generated
  - [ ] Query function generated
  - [ ] Affected documents function generated

- [ ] **Subscription Lifecycle**
  - [ ] subscribe_<name> checks permissions
  - [ ] Returns initial data
  - [ ] Detects affected subscriptions on changes
  - [ ] Calls callback with updated data
  - [ ] unsubscribe_<name> cleans up

- [ ] **Change Detection**
  - [ ] Root table changes trigger update
  - [ ] Related table changes trigger update
  - [ ] Unrelated changes don't trigger

**Test File:** `tests/integration/subscriptions.test.js`

---

### 12. Soft Delete

**Promise:** Set deleted_at instead of hard delete when configured.

- [ ] **Configuration**
  - [ ] soft_delete=true in register_entity

- [ ] **Behavior**
  - [ ] DELETE sets deleted_at timestamp
  - [ ] Record remains in table
  - [ ] SEARCH excludes soft-deleted by default
  - [ ] GET can still retrieve by ID
  - [ ] Works in generic mode
  - [ ] Works in compiled mode

**Test File:** `tests/integration/soft-delete.test.js`

---

### 13. WebSocket Client/Server

**Promise:** Real-time bidirectional communication with automatic reconnection.

- [ ] **Connection**
  - [ ] Client connects to server
  - [ ] JWT authentication works
  - [ ] Automatic reconnection on disconnect
  - [ ] Ping/pong keep-alive

- [ ] **RPC API**
  - [ ] ws.api.operation.entity() calls work
  - [ ] Proxy pattern routes correctly
  - [ ] Errors propagate to client
  - [ ] Custom functions callable

- [ ] **Broadcasts**
  - [ ] onBroadcast receives events
  - [ ] Method format: "table:operation"
  - [ ] Params include before/after/user_id
  - [ ] Filtering by notify_users works

**Test File:** `tests/integration/websocket.test.js`

---

### 14. Compiler - Code Generation Quality

**Promise:** Generate static, optimized PostgreSQL functions with zero runtime interpretation.

- [ ] **No Runtime Interpretation**
  - [ ] No FOR loops over config
  - [ ] No jsonb_each on entity config
  - [ ] No EXECUTE format with %I for M2M tables
  - [ ] All table names are literals
  - [ ] All column names are literals

- [ ] **M2M Code Quality**
  - [ ] Separate static blocks per relationship
  - [ ] v_tag_ids variables declared
  - [ ] Extraction before INSERT/UPDATE
  - [ ] Junction sync after main record
  - [ ] Output expansion before event creation

- [ ] **Field Defaults Code Quality**
  - [ ] Applied in INSERT block
  - [ ] Variable resolution inlined
  - [ ] Not applied in UPDATE

- [ ] **Generated SQL Quality**
  - [ ] No syntax errors
  - [ ] PostgreSQL can prepare statements
  - [ ] Execution plans cacheable
  - [ ] Performs as expected

**Test File:** `tests/core/compiler-quality.test.js`

---

### 15. Parser - SQL to Config Extraction

**Promise:** Parse entity registrations from SQL files, handling all PostgreSQL syntax.

- [ ] **Basic Parsing**
  - [ ] Extracts table_name, label_field, searchable_fields
  - [ ] Handles array['field1', 'field2'] syntax
  - [ ] Handles '{}' and '{...}' JSON syntax
  - [ ] Handles jsonb_build_object() calls

- [ ] **Comment Handling**
  - [ ] Strips SQL comments before parsing
  - [ ] Inline comments don't break JSON
  - [ ] Multi-line comments work

- [ ] **Complex JSON**
  - [ ] Parses nested M2M config
  - [ ] Parses permission paths
  - [ ] Parses graph rules
  - [ ] Parses field defaults

**Test File:** `tests/core/parser.test.js` ✅

---

### 16. End-to-End Integration

**Promise:** All pieces work together in real-world scenarios.

- [ ] **Clean Database Initialization**
  - [ ] Compile entities from SQL file
  - [ ] Drop and recreate database
  - [ ] Load all init_db/*.sql files in order
  - [ ] All migrations apply successfully
  - [ ] No SQL errors

- [ ] **M2M Full Workflow**
  - [ ] Create resource with tag_ids
  - [ ] Junction table synced
  - [ ] GET returns tag_ids
  - [ ] Event includes tag_ids
  - [ ] Update tag_ids works
  - [ ] Empty array removes all
  - [ ] Omitted field leaves unchanged

- [ ] **Real-Time Full Cycle**
  - [ ] User A creates record
  - [ ] Event created in dzql.events
  - [ ] NOTIFY triggered
  - [ ] User B receives broadcast (if targeted)
  - [ ] Broadcast includes complete data
  - [ ] Broadcast includes M2M data

- [ ] **Permission Enforcement Full Cycle**
  - [ ] User creates resource (becomes owner)
  - [ ] Other user cannot update (permission denied)
  - [ ] Owner can update
  - [ ] Permission paths resolve correctly

- [ ] **Multi-Entity Relationships**
  - [ ] Create parent entity
  - [ ] Create child entities
  - [ ] FK expansion works
  - [ ] Graph rules execute
  - [ ] Events cascade correctly

**Test File:** `tests/integration/end-to-end.test.js` ⚠️ **CRITICAL - MISSING**

---

### 17. Security

**Promise:** Row-level security prevents unauthorized access.

- [ ] **SQL Injection Prevention**
  - [ ] Cannot inject via search filters
  - [ ] Cannot inject via field values
  - [ ] Cannot inject via permission paths

- [ ] **Permission Bypass Prevention**
  - [ ] Cannot access via direct SQL
  - [ ] Cannot bypass via generic_exec
  - [ ] Cannot spoof user_id

- [ ] **Sensitive Field Protection**
  - [ ] password_hash never in responses
  - [ ] secret fields filtered
  - [ ] token fields filtered

- [ ] **Authentication Required**
  - [ ] Operations require valid user_id
  - [ ] Invalid user_id rejected
  - [ ] Cannot operate as other users

**Test File:** `tests/security/security.test.js` ⚠️ **CRITICAL - MISSING**

---

### 18. Error Handling

**Promise:** Clear, actionable error messages for all failure cases.

- [ ] **Standard Errors**
  - [ ] "record not found" for GET non-existent
  - [ ] "Permission denied: view on entity" for unauthorized
  - [ ] "entity X not configured" for unregistered table
  - [ ] "Unique violation" for duplicate constraint

- [ ] **Validation Errors**
  - [ ] Graph rule validate actions throw custom messages
  - [ ] Foreign key violations clear
  - [ ] Check constraint violations clear

- [ ] **Client Error Handling**
  - [ ] Errors propagate through WebSocket
  - [ ] Error format consistent
  - [ ] Stack traces not exposed (production)

**Test File:** `tests/integration/error-handling.test.js`

---

### 19. Database Migrations (Production)

**Promise:** Evolve schema incrementally without data loss.

- [ ] **Migration Creation**
  - [ ] migrate:new creates numbered template
  - [ ] Template includes all sections
  - [ ] Numbers increment correctly

- [ ] **Migration Application**
  - [ ] migrate:up applies pending migrations
  - [ ] Tracks applied migrations in dzql.migrations
  - [ ] Skips already-applied migrations
  - [ ] Stops on first error
  - [ ] Rollback on failure (if using BEGIN/COMMIT)

- [ ] **Migration Status**
  - [ ] migrate:status shows applied migrations
  - [ ] Shows pending migrations
  - [ ] Shows application timestamps

**Test File:** `tests/migrations/migrations.test.js` ✅ (13/13 passing)

---

### 20. Compiler CLI

**Promise:** Command-line tool for compilation and migration management.

- [ ] **Compile Command**
  - [ ] Parses entity SQL file
  - [ ] Generates 000_dzql_core.sql
  - [ ] Generates 001_schema.sql
  - [ ] Generates 002_auth.sql
  - [ ] Generates entity.sql files
  - [ ] Generates checksums.json
  - [ ] Output directory created if missing

- [ ] **Migration Commands**
  - [ ] migrate:new works
  - [ ] migrate:up works
  - [ ] migrate:status works
  - [ ] Requires DATABASE_URL
  - [ ] Clear error messages

**Test File:** `tests/cli/cli.test.js`

---

## Critical Missing Tests

### ⚠️ HIGH PRIORITY

1. **End-to-End Integration Test** (`tests/integration/end-to-end.test.js`)
   - This would have caught all 5 npm release bugs
   - Must do: compile → drop db → create from init_db → test M2M → verify events

2. **Security Tests** (`tests/security/security.test.js`)
   - Permission enforcement
   - SQL injection prevention
   - Cannot bypass row-level security

3. **Real-Time Events Test** (`tests/integration/events-notifications.test.js`)
   - Verify events created for all operations
   - Verify events include M2M data
   - Verify notification targeting works

### 🟡 MEDIUM PRIORITY

4. **Field Defaults Runtime Test** (`tests/integration/field-defaults.test.js`)
   - Verify defaults actually applied (not just parsed)

5. **FK Expansion Test** (`tests/integration/fk-expansion.test.js`)
   - More thorough than current basic test

6. **Error Handling Test** (`tests/integration/error-handling.test.js`)
   - Verify all error messages

### 🟢 LOW PRIORITY

7. **Performance Benchmarks** (`tests/benchmarks/`)
   - Compiled vs generic speed
   - M2M performance
   - Large dataset handling

---

## Test Coverage Matrix

| Feature | Generic Mode | Compiled Mode | Events | Security |
|---------|-------------|---------------|--------|----------|
| GET | ✅ | ⚠️ | ⚠️ | ❌ |
| SAVE | ✅ | ⚠️ | ⚠️ | ❌ |
| DELETE | ✅ | ⚠️ | ⚠️ | ❌ |
| SEARCH | ✅ | ⚠️ | N/A | ❌ |
| LOOKUP | ✅ | ⚠️ | N/A | ❌ |
| M2M | ❌ | ❌ | ❌ | ❌ |
| Field Defaults | ❌ | ❌ | N/A | ❌ |
| Permissions | ❌ | ❌ | N/A | ❌ |
| Graph Rules | ❌ | ❌ | ⚠️ | ❌ |
| Subscriptions | ⚠️ | N/A | ⚠️ | ❌ |

**Legend:**
- ✅ Fully tested
- ⚠️ Partially tested or shallow
- ❌ Not tested

---

## What Would Have Prevented The npm Disasters

### The One Test That Would Catch Everything

```javascript
test('FULL INTEGRATION: Compile → Deploy → M2M → Events', async () => {
  // 1. Compile entity with M2M
  const compiler = new DZQLCompiler();
  const result = compiler.compileFromSQL(entitySQL);

  // 2. Drop and recreate database
  await sql`DROP DATABASE IF EXISTS test_dzql`;
  await sql`CREATE DATABASE test_dzql`;

  // 3. Load ALL compiled files in order
  for (const file of ['000_dzql_core.sql', '001_schema.sql', '002_auth.sql', 'resources.sql']) {
    await sql.file(file);
  }

  // 4. Create user
  const user = await register_user('test@test.com', 'pass');

  // 5. Create resource with tags using COMPILED save_resources
  const resource = await save_resources({
    title: 'Test',
    tag_ids: [1, 2, 3]
  }, user.user_id);

  // 6. Verify junction table synced
  const junctionRows = await sql`SELECT * FROM resource_tags WHERE resource_id = ${resource.id}`;
  expect(junctionRows.length).toBe(3);

  // 7. Verify M2M in response
  expect(resource.tag_ids).toEqual([1, 2, 3]);

  // 8. Verify event created with M2M data
  const events = await sql`SELECT * FROM dzql.events WHERE table_name = 'resources' ORDER BY event_id DESC LIMIT 1`;
  expect(events[0].after.tag_ids).toEqual([1, 2, 3]);

  // 9. Verify GET returns M2M
  const retrieved = await get_resources({id: resource.id}, user.user_id);
  expect(retrieved.tag_ids).toEqual([1, 2, 3]);

  // 10. Verify field defaults applied
  expect(resource.owner_id).toBe(user.user_id);
});
```

This **ONE** test would have caught:
- ✅ Parser bug (M2M config not extracted)
- ✅ Missing bin directory (compile fails)
- ✅ Missing dzql.registry (SQL error)
- ✅ _profile issues (auth fails)
- ✅ M2M not in events (assertion fails)

---

## Assessment of Current Test Suite

### What It Does Well ✅
- Infrastructure tests (schema exists)
- Auth basic functionality
- Compiler generates valid syntax
- Basic CRUD operations work

### What It Misses ❌
- **Integration** - Pieces work together
- **Security** - Permissions enforced
- **Real-time** - Events/broadcasts
- **M2M runtime** - Junction tables sync
- **Field defaults runtime** - Values applied
- **Clean initialization** - Database builds from compiled output

### Honest Conclusion

**Current tests are 20% of what's needed.**

They validate "code exists" but not "code works correctly in production scenarios."

The 93% pass rate is misleading - we're testing the wrong things.

---

## Recommended Action Plan

1. **Add end-to-end integration test** (CRITICAL)
2. **Add M2M runtime tests** (CRITICAL)
3. **Add event validation tests** (CRITICAL)
4. **Add permission enforcement tests** (HIGH)
5. **Add security tests** (HIGH)
6. **Keep existing shallow tests** (they're still useful for regressions)

This contract should be satisfied before ANY npm publish.
