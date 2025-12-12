# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference Card

```
DZQL QUICK REFERENCE
====================

5 Operations:     get, save, delete, lookup, search
2 Modes:          Interpreter (runtime) | Compiler (static SQL)
Client API:       ws.api.{operation}.{entity}(params)
Server API:       db.api.{operation}.{entity}(params, userId)

Entity Registration:
  dzql.register_entity(
    table_name,           -- 'todos'
    label_field,          -- 'title' (for lookups)
    searchable_fields,    -- ARRAY['title', 'description']
    fk_includes,          -- '{"org": "organisations"}'
    soft_delete,          -- false
    temporal_fields,      -- '{}'
    notification_paths,   -- '{"ownership": ["@org_id->acts_for..."]}'
    permission_paths,     -- '{"view": [], "create": [...]}'
    graph_rules,          -- '{"on_create": {...}, "many_to_many": {...}, "primary_key": [...]}'
    field_defaults        -- '{"owner_id": "@user_id"}'
  )

Composite Primary Keys:
  graph_rules: '{"primary_key": ["entity_type", "entity_id"]}'
  - GET/DELETE accept JSONB: get_table(user_id, '{"col1": "val", "col2": 123}')
  - SAVE detects insert/update by checking if all PK fields exist
  - Columns ending with _id are cast to ::int, others stay text

M2M id_field naming:  tag_ids (singular + _ids), NOT tags_ids
Permission [] = public, omitted = denied
Path syntax: @field->table[filter]{temporal}.target_field

Compile: dzql compile entities.sql -o compiled/
```

## Project Overview

DZQL is a PostgreSQL-powered framework that eliminates CRUD boilerplate by providing automatic database operations, real-time WebSocket synchronization, and graph-based relationship management. The core concept: register an entity in PostgreSQL and instantly get 5 standard operations (get, save, delete, lookup, search) plus real-time notifications with zero code.

## Architecture

### Three-Layer Stack

```
Client (Browser)          Server (Bun)              Database (PostgreSQL)
WebSocketManager    <->   WebSocket Handler   <->   Generic Operations
  Proxy API               JSON-RPC Router           Stored Procedures
  Real-time Events        NOTIFY/LISTEN             Graph Rules Engine
```

### Key Architectural Patterns

1. **Nested Proxy API**: Both client (`ws.api.save.venues()`) and server (`db.api.save.venues()`) use identical proxy-based APIs that dynamically route to the correct operation
2. **Generic Operations**: All CRUD operations flow through `dzql.generic_exec()` which handles permissions, graph rules, and event generation
3. **Single Channel NOTIFY**: All real-time events flow through one PostgreSQL NOTIFY channel ('dzql') with intelligent user targeting
4. **Graph Rules**: Entity relationships are managed declaratively through JSON configuration that executes automatically on data changes

### Database-Centric Design

The framework treats PostgreSQL as the source of truth for:
- **Entity Configuration**: `dzql.entities` table stores metadata (searchable fields, permissions, temporal config)
- **Event Log**: `dzql.events` table provides complete audit trail with targeted notification data
- **Permission Paths**: JSON path expressions resolve which users can perform operations
- **Notification Paths**: JSON path expressions determine who receives real-time updates
- **Graph Rules**: Declarative relationship management executed within transactions

## Development Commands

### Venues Example (Primary Development)
```bash
bun venues:db    # Start PostgreSQL in Docker (clean slate every time)
bun venues       # Start Bun server with hot reload
bun venues:test  # Run full test suite
bun venues:logs  # View PostgreSQL logs
```

### Logging Configuration

DZQL uses a category-based logging system with configurable log levels. Configure via environment variables:

```bash
# Set overall log level (ERROR, WARN, INFO, DEBUG, TRACE)
LOG_LEVEL=DEBUG bun venues

# Set per-category levels
LOG_CATEGORIES="ws:debug,db:trace,auth:info,server:info,notify:debug" bun venues

# Or set all categories to same level
LOG_CATEGORIES="*:trace" bun venues

# Disable colors
NO_COLOR=1 bun venues
```

**Available categories:**
- `ws` - WebSocket connections and RPC calls (green)
- `db` - Database operations and queries (magenta)
- `auth` - Authentication events (yellow)
- `server` - Server startup and shutdown (blue)
- `notify` - Real-time NOTIFY events (magenta)

**Log levels (lowest to highest):**
- `ERROR` - Errors only
- `WARN` - Warnings and errors
- `INFO` - Informational messages (default in development)
- `DEBUG` - Debug information including request/response
- `TRACE` - Very detailed tracing

**Default behavior:**
- Development: `INFO` level for all categories
- Production: `WARN` level for all categories
- Test: `ERROR` level (suppresses most output)

### Testing Individual Test Files
```bash
cd packages/venues
bun test tests/domain.test.js        # Test basic CRUD operations
bun test tests/permissions.test.js   # Test permission system
bun test tests/graph_rules.test.js   # Test relationship management
bun test tests/notifications.test.js # Test real-time events
```

### Alternative Rights Example
```bash
bun db      # Start PostgreSQL for rights example
bun server  # Start rights server
```

### Full Stack Development
```bash
bun dev     # Run both client and server concurrently
bun client  # Client-only development server
```

## Project Structure

```
packages/
├── dzql/                          # Core framework
│   └── src/
│       ├── database/migrations/   # PostgreSQL migrations (numbered)
│       │   ├── 001_schema.sql     # Core tables (entities, events)
│       │   ├── 002_functions.sql  # Path resolution helpers
│       │   ├── 003_operations.sql # Generic CRUD + graph rules
│       │   ├── 004_search.sql     # Advanced search functionality
│       │   ├── 005_entities.sql   # Entity registration
│       │   └── 006_auth.sql       # JWT authentication
│       ├── server/
│       │   ├── db.js              # PostgreSQL connection + proxy API
│       │   ├── ws.js              # WebSocket handlers + JSON-RPC
│       │   └── index.js           # Server factory
│       └── client/
│           └── ws.js              # WebSocket client + proxy API
├── venues/                        # Example application
│   ├── server/
│   │   ├── index.js               # Application entry point
│   │   └── api.js                 # Custom Bun functions
│   ├── database/
│   │   ├── docker-compose.yml     # PostgreSQL setup
│   │   └── init_db/
│   │       └── 009_venues_domain.sql  # Domain entities
│   └── tests/                     # Comprehensive test suite
└── client/                        # Shared client utilities
```

## Core Concepts

### 1. Nested Proxy API Pattern

The same API works on both client and server:

```javascript
// Client (WebSocket)
const venue = await ws.api.get.venues({id: 1});
const saved = await ws.api.save.venues({name: 'New Venue'});

// Server (Direct PostgreSQL)
const venue = await db.api.get.venues({id: 1}, userId);
const saved = await db.api.save.venues({name: 'New Venue'}, userId);
```

Implementation details:
- Operations: `get`, `save`, `delete`, `lookup`, `search`
- Custom functions are accessed directly: `ws.api.customFunction({params})`
- All operations require authentication (except `login_user` and `register_user`)
- Server-side requires explicit `userId` parameter; client-side injects automatically

### 2. Entity Registration

Entities are configured via `dzql.register_entity()` which sets up everything needed:

```sql
SELECT dzql.register_entity(
  'venues',                           -- table name
  'name',                             -- label field for lookups
  array['name', 'address'],           -- searchable fields
  '{"org": "organisations", "sites": "sites"}',  -- foreign keys to dereference + child arrays
  false,                              -- soft delete enabled
  '{}',                               -- temporal fields config
  '{"ownership": ["@org_id->acts_for[org_id=$]{active}.user_id"]}',  -- notification paths
  '{"view": [], "create": [...]}',    -- permission paths
  '{...}'                             -- graph rules
);
```

**FK Includes Syntax:**
- Single object dereference: `"org": "organisations"` - Follows FK to get full org object
- Child array inclusion: `"sites": "sites"` - Includes all child records (auto-detects FK relationship)
- Example result from `get` operation:
  ```json
  {
    "id": 1,
    "name": "Madison Square Garden",
    "org": { "id": 3, "name": "Venue Management", ... },
    "sites": [
      { "id": 1, "name": "Main Entrance", ... },
      { "id": 2, "name": "Concourse Level", ... }
    ]
  }
  ```

### 3. Path Resolution Syntax

Paths are used for both notifications and permissions:

```
@field->table[filter]{temporal}.target_field

Examples:
@org_id->acts_for[org_id=$]{active}.user_id
@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id
```

Components:
- `@field` - Start from record field
- `->table` - Navigate to related table  
- `[filter]` - WHERE clause (`$` = current value)
- `{temporal}` - Apply temporal filtering (`{active}` = valid now)
- `.field` - Extract this field as result

### 4. Graph Rules

Automatic relationship management executed in transactions:

```jsonb
{
  "on_create": {
    "rule_name": {
      "description": "Human-readable description",
      "actions": [{
        "type": "create|update|delete",
        "entity": "target_table",
        "data": {"field": "@variable"},      // for create/update
        "match": {"field": "@variable"}      // for update/delete
      }]
    }
  }
}
```

Variables available: `@user_id`, `@id`, `@field_name`, `@now`, `@today`

**Available Action Types:**

| Action | Purpose | Required Fields | Rollback on Error |
|--------|---------|----------------|-------------------|
| `create` | Create related record | `entity`, `data` | ✅ Yes |
| `update` | Update related record | `entity`, `match`, `data` | ✅ Yes |
| `delete` | Delete related record | `entity`, `match` | ✅ Yes |
| `validate` | Block operation if validation fails | `function`, `params`, `error_message` | ✅ Yes |
| `execute` | Fire-and-forget function call | `function`, `params` | ❌ No |

#### Graph Rules: Advanced Features

**Conditional Execution**

Rules can include conditions that determine if they execute:

```jsonb
{
  "on_update": {
    "prevent_modification": {
      "condition": "@before.status = 'posted'",
      "actions": [{
        "type": "validate",
        "function": "always_false",
        "params": {},
        "error_message": "Cannot modify a posted record"
      }]
    }
  }
}
```

**Condition Variables:**
- `@before.field` - Value before update (null for create)
- `@after.field` - Value after update/create (null for delete)
- `@user_id` - Current user ID
- `@id` - Record ID
- Standard SQL expressions: `=`, `!=`, `AND`, `OR`, `>`, `<`, `>=`, `<=`

**Validate Action**

Call validation functions that can block operations:

```jsonb
{
  "on_create": {
    "validate_positive": {
      "description": "Ensure value is positive",
      "actions": [{
        "type": "validate",
        "function": "validate_positive_value",
        "params": {"p_value": "@value"},
        "error_message": "Value must be positive"
      }]
    }
  }
}
```

**Validation function signature:**
```sql
CREATE FUNCTION validate_positive_value(p_value INT)
RETURNS BOOLEAN
LANGUAGE sql AS $$
  SELECT p_value > 0;
$$;
```

Validation functions must:
- Return BOOLEAN (true = pass, false = fail)
- Use named parameters matching the `params` object
- Be deterministic for consistent results

**Execute Action**

Call custom functions as side effects (fire-and-forget):

```jsonb
{
  "on_create": {
    "send_notification": {
      "description": "Notify external system",
      "actions": [{
        "type": "execute",
        "function": "send_email_notification",
        "params": {"p_email": "@email", "p_name": "@name"}
      }]
    }
  }
}
```

Execute functions can return JSONB or void. Errors are logged as warnings but don't block the operation or rollback the transaction.

#### Complex Validation Example: Double-Entry Bookkeeping

**Requirement**: Journal entries must be balanced (debits = credits) before posting

**Validation function that queries related tables:**
```sql
CREATE FUNCTION validate_journal_entry_balanced(p_entry_id INT)
RETURNS BOOLEAN AS $$
DECLARE
  v_total_debits DECIMAL;
  v_total_credits DECIMAL;
BEGIN
  -- Query related journal_lines table
  SELECT
    COALESCE(SUM(debit_amount), 0),
    COALESCE(SUM(credit_amount), 0)
  INTO v_total_debits, v_total_credits
  FROM journal_lines
  WHERE entry_id = p_entry_id;

  -- Check if balanced and non-zero
  RETURN v_total_debits = v_total_credits AND v_total_debits > 0;
END;
$$ LANGUAGE plpgsql;
```

**Entity registration with multiple validation rules:**
```sql
SELECT dzql.register_entity(
  'journal_entries',
  'description',
  ARRAY['description'],
  '{"lines": "journal_lines"}',  -- Include child lines
  false, '{}', '{}', '{}',
  jsonb_build_object(
    'on_update', jsonb_build_object(
      -- Rule 1: Validate balanced entry
      'validate_balanced_on_post', jsonb_build_object(
        'description', 'Ensure entry is balanced before posting',
        'condition', '@after.status = ''posted'' AND @before.status = ''draft''',
        'actions', jsonb_build_array(
          jsonb_build_object(
            'type', 'validate',
            'function', 'validate_journal_entry_balanced',
            'params', jsonb_build_object('p_entry_id', '@id'),
            'error_message', 'Cannot post unbalanced entry - debits must equal credits'
          )
        )
      ),
      -- Rule 2: Check fiscal period is open
      'check_fiscal_period_open', jsonb_build_object(
        'description', 'Prevent posting to closed periods',
        'condition', '@after.status = ''posted''',
        'actions', jsonb_build_array(
          jsonb_build_object(
            'type', 'validate',
            'function', 'is_fiscal_period_open',
            'params', jsonb_build_object('p_period_id', '@fiscal_period_id'),
            'error_message', 'Cannot post to a closed fiscal period'
          )
        )
      ),
      -- Rule 3: Prevent modifying posted entries
      'prevent_modify_posted', jsonb_build_object(
        'description', 'Posted entries are immutable',
        'condition', '@before.status = ''posted''',
        'actions', jsonb_build_array(
          jsonb_build_object(
            'type', 'validate',
            'function', 'always_false',
            'params', jsonb_build_object(),
            'error_message', 'Cannot modify a posted journal entry'
          )
        )
      )
    )
  )
);
```

**Key features demonstrated:**
- Multiple validation rules on same trigger
- Conditions control when validations run
- Validation functions query related tables
- Clear error messages for business rules

#### Migration from PostgreSQL Triggers to Graph Rules Validation

**Before (Trigger approach):**
```sql
CREATE TRIGGER journal_entry_validation
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION check_journal_entry_balanced();

CREATE OR REPLACE FUNCTION check_journal_entry_balanced()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'posted' AND OLD.status = 'draft' THEN
    IF NOT validate_journal_entry_balanced(NEW.id) THEN
      RAISE EXCEPTION 'Cannot post unbalanced journal entry';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**After (Graph rules approach):**
```sql
SELECT dzql.register_entity(
  'journal_entries', 'description', ARRAY['description'],
  '{}', false, '{}', '{}', '{}',
  jsonb_build_object(
    'on_update', jsonb_build_object(
      'validate_balanced', jsonb_build_object(
        'condition', '@after.status = ''posted'' AND @before.status = ''draft''',
        'actions', jsonb_build_array(
          jsonb_build_object(
            'type', 'validate',
            'function', 'validate_journal_entry_balanced',
            'params', jsonb_build_object('p_entry_id', '@id'),
            'error_message', 'Cannot post unbalanced journal entry'
          )
        )
      )
    )
  )
);
```

**Advantages:**
- ✅ Visible in entity registration (no separate trigger objects)
- ✅ Declarative and easier to understand
- ✅ Conditional execution built-in
- ✅ Testable (can call validation function directly)
- ✅ All entity config in one place

**When to still use triggers:**
- Complex multi-step validation with loops/cursors
- Need to modify NEW record before saving
- Side effects that must happen in same transaction (use execute action instead for side effects)
- Integration with legacy PostgreSQL systems

### 5. Real-Time Event Flow

1. Database trigger fires on INSERT/UPDATE/DELETE
2. Notification paths resolve affected user_ids
3. Event written to `dzql.events` with `notify_users` array
4. PostgreSQL NOTIFY on 'dzql' channel
5. Bun server filters by `notify_users` (null = all authenticated users)
6. WebSocket sends event as JSON-RPC method: `{table}:{op}`

## Writing Tests

Tests use Bun's built-in test runner with these patterns:

### Test Structure
```javascript
import { test, expect, beforeAll, afterAll } from "bun:test";
import { sql, db } from "dzql";

const PREFIX = `TEST_${Date.now()}`;  // Unique prefix for test isolation
let testUserId;

beforeAll(async () => {
  // Create test user
  const result = await sql`SELECT register_user(...)`;
  testUserId = result[0].user_data.user_id;
});

afterAll(async () => {
  // Clean up test data in dependency order (children first)
  await sql`DELETE FROM child_table WHERE parent_id IN (...)`;
  await sql`DELETE FROM parent_table WHERE name LIKE ${PREFIX + '%'}`;
  await sql`DELETE FROM users WHERE id = ${testUserId}`;
});
```

### Key Testing Patterns
- Use unique PREFIX with timestamp to avoid conflicts
- Clean up in correct FK dependency order (children before parents)
- Use `db.api` for testing DZQL operations (not WebSocket)
- Direct SQL via `sql` tagged template for setup/cleanup
- Server-side API requires explicit `userId` as second parameter

## Adding New Entities

1. **Create table in domain SQL file** (`packages/venues/database/init_db/009_venues_domain.sql`)
2. **Register entity** with `dzql.register_entity()` in same file
3. **Configure permissions** using path syntax
4. **Add graph rules** if needed for relationship management
5. **Write tests** following existing patterns in `packages/venues/tests/`

No TypeScript types, API routes, or resolvers needed - everything is handled by generic operations.

## Adding Custom Functions

### PostgreSQL Functions (Stored Procedures)
```sql
CREATE OR REPLACE FUNCTION my_function(p_user_id INT, p_param TEXT DEFAULT 'default')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Function logic
  RETURN jsonb_build_object('result', p_param);
END;
$$;
```

Call from client: `await ws.api.my_function({param: 'value'})`

### Bun Functions (JavaScript)
```javascript
// packages/venues/server/api.js
export async function myBunFunction(userId, params = {}) {
  const { param = 'default' } = params;
  // Can use db.api for database access
  return { result: param };
}
```

Call from client: `await ws.api.myBunFunction({param: 'value'})`

**Both types:**
- First parameter is always `user_id` (auto-injected on client)
- Require authentication
- Use same proxy API syntax
- Return JSON-serializable data

## CLI Access (invokej)

DZQL operations are available via CLI using `invokej` for testing and scripting:

```bash
# List all entities
invokej dzql.entities

# Search entities
invokej dzql.search organisations '{"query": "test"}'

# Get entity by ID (use primary key field, usually "id")
invokej dzql.get venues '{"id": 1}'

# Create/update entity
invokej dzql.save venues '{"name": "New Venue", "org_id": 1, "address": "123 Main St"}'

# Delete entity
invokej dzql.delete venues '{"id": 1}'

# Lookup (autocomplete)
invokej dzql.lookup organisations '{"query": "acme"}'
```

**CLI Notes:**
- All commands use default `user_id=1` for permissions
- Arguments must be valid JSON strings
- Mirrors MCP server functionality exactly
- Defined in `tasks.js` at project root

## Important Conventions

### Database
- Core DZQL tables use `dzql` schema
- Application tables use `public` schema
- Migration files are numbered sequentially (001, 002, etc.)
- Domain-specific SQL files start at 009
- **No `created_at`/`updated_at` columns** - use `dzql.events` table for complete audit trail

### Code Style
- ES modules (type: "module" in package.json)
- Async/await for all database operations
- Tagged templates for SQL queries (`sql` from postgres package)
- Proxy patterns for API routing

### Real-time Events
- Listen using `ws.onBroadcast((method, params) => {})`
- Method format: `{table}:{operation}` (e.g., "venues:update")
- Params include: `{table, op, pk, data, user_id, at}`
- `data` contains: new state for insert/update, `null` for delete
- Target users via notification paths or broadcast to all

### Permissions
- Empty view permission array `[]` = public read access
- Non-empty arrays = restricted to resolved user_ids
- Permissions checked before operations execute
- Use path syntax to traverse relationships

## Common Gotchas

1. **Server vs Client API**: Server `db.api` requires explicit `userId` as second parameter; client `ws.api` auto-injects from JWT
2. **Test Cleanup Order**: Always delete FK children before parents to avoid constraint violations
3. **Temporal Filtering**: Use `{active}` in paths for current relationships; omit for all time
4. **Graph Rule Variables**: Use `@` prefix for all variables (`@user_id`, `@id`, `@field_name`)
5. **Permission Paths**: Empty array means "allow all", missing permission type means "deny all"
6. **NOTIFY Filtering**: `notify_users: null` broadcasts to all authenticated users; array targets specific user_ids

---

## Database Schema Reference

### Core DZQL Tables

#### `dzql.entities`
Stores entity configuration metadata:
```sql
TABLE dzql.entities {
  table_name TEXT PRIMARY KEY,
  label_field TEXT NOT NULL,
  searchable_fields TEXT[] NOT NULL,
  fk_includes JSONB DEFAULT '{}'::jsonb,
  soft_delete BOOLEAN DEFAULT false,
  temporal_fields JSONB DEFAULT '{}'::jsonb,
  notification_paths JSONB DEFAULT '{}'::jsonb,
  permission_paths JSONB DEFAULT '{}'::jsonb,
  graph_rules JSONB DEFAULT '{}'::jsonb
}
```

#### `dzql.events`
Complete audit trail with real-time notification data:
```sql
TABLE dzql.events {
  event_id BIGSERIAL PRIMARY KEY,
  context_id TEXT,           -- For catchup queries
  table_name TEXT NOT NULL,
  op TEXT NOT NULL,          -- 'insert' | 'update' | 'delete'
  pk JSONB NOT NULL,         -- Primary key: {id: 1}
  data JSONB,                -- Record data (new state for insert/update, null for delete)
  user_id INT,               -- Who made the change
  notify_users INT[],        -- Who to notify (null = all)
  at TIMESTAMPTZ DEFAULT NOW()
}
```

#### `dzql.registry`
Allowed custom functions (optional):
```sql
TABLE dzql.registry {
  function_name TEXT PRIMARY KEY,
  description TEXT
}
```

---

## Common Error Messages

### Error Dictionary

| Error Message | Cause | Solution |
|---------------|-------|----------|
| `"record not found"` | GET operation on non-existent ID | Check ID exists, handle 404 case |
| `"Permission denied: view on users"` | User not in permission path result | Verify user has access, check permission paths |
| `"Permission denied: create on venues"` | User can't create records | Add user to create permission path |
| `"entity users not configured"` | Table not registered with DZQL | Call `dzql.register_entity()` |
| `"Column foo does not exist in table users"` | Invalid filter field in SEARCH | Check `searchable_fields` configuration |
| `"Invalid function name: foo"` | Custom function doesn't exist | Create function or check spelling |
| `"Function not found"` | Function not exported or not in DB | Export from api.js or CREATE FUNCTION |
| `"Authentication required"` | Not logged in | Call `login_user()` first |
| `"Invalid token"` | Expired or malformed JWT | Re-authenticate with `login_user()` |
| `"Duplicate key violates unique constraint"` | Inserting duplicate unique value | Check for existing record first |
| `"Foreign key violation"` | Referenced record doesn't exist | Create parent record before child |
| `"Invalid JSON"` | Malformed JSON in request | Validate JSON syntax |

### Error Handling Pattern

```javascript
try {
  const user = await ws.api.get.users({id: userId});
} catch (error) {
  if (error.message === 'record not found') {
    // Handle missing record
  } else if (error.message.includes('Permission denied')) {
    // Handle unauthorized access
  } else {
    // Handle unexpected errors
  }
}
```

---

## Event Structure Reference

### WebSocket Event Format

**Method:** `"{table}:{operation}"`
- Examples: `"venues:insert"`, `"users:update"`, `"sites:delete"`

**Params Structure:**
```javascript
{
  table: 'venues',              // Table name
  op: 'insert',                 // Operation: 'insert' | 'update' | 'delete'
  pk: {id: 1},                  // Primary key object
  data: {                       // Record data (new state for insert/update, null for delete)
    id: 1,
    name: 'New Name',
    address: 'New Address'
  },
  user_id: 123,                 // User who made the change
  at: '2025-01-01T12:00:00Z'   // Timestamp
}
```

**Event data by operation:**
| Operation | `data` field contains |
|-----------|----------------------|
| `insert` | Full new record |
| `update` | Full updated record (new state only) |
| `delete` | `null` |

**Note:** The `notify_users` field is used internally for routing but is stripped from the broadcast message sent to clients.

### Using Event Data

```javascript
ws.onBroadcast((method, params) => {
  const { table, op, pk, data } = params;
  
  // For insert
  if (method === 'venues:insert') {
    const newRecord = data;
  }
  
  // For update
  if (method === 'venues:update') {
    const updatedRecord = data;
    // Note: only new state is available, not the previous state
  }
  
  // For delete
  if (method === 'venues:delete') {
    // data is null for delete, use pk to identify the deleted record
    const deletedId = pk.id;
  }
});
```

---

## Decision Trees

### When to Use Graph Rules vs Manual Operations

**Use Graph Rules When:**
- ✅ Pattern repeats consistently (always create X when Y is created)
- ✅ Relationship is declarative (cascade delete, ownership transfer)
- ✅ Action is atomic with parent operation
- ✅ Business rule applies system-wide
- ✅ Need automatic execution within same transaction

**Use Manual Operations When:**
- ❌ Logic is complex with multiple conditions
- ❌ Requires external API calls
- ❌ Need user confirmation before action
- ❌ Action is optional or contextual
- ❌ Involves asynchronous processing

**Examples:**

✅ **Good for Graph Rules:**
```jsonb
// Creator becomes owner
"on_create": {
  "establish_ownership": {
    "actions": [{
      "type": "create",
      "entity": "acts_for",
      "data": {"user_id": "@user_id", "org_id": "@id"}
    }]
  }
}
```

❌ **Bad for Graph Rules:**
```javascript
// Send welcome email, create Stripe customer, notify Slack
// Too many external dependencies - do manually
export async function createOrganisation(userId, params) {
  const org = await db.api.save.organisations(params, userId);
  await sendWelcomeEmail(org);
  await createStripeCustomer(org);
  await notifySlack(org);
  return org;
}
```

### PostgreSQL Functions vs Bun Functions

**Use PostgreSQL Functions When:**
- ✅ Data-heavy operations (aggregations, complex queries)
- ✅ Need transactional guarantees
- ✅ Performance critical (no network overhead)
- ✅ Pure database logic
- ✅ Reusable across multiple applications

**Use Bun Functions When:**
- ✅ Complex business logic
- ✅ Need external API calls
- ✅ Require npm packages
- ✅ Easier to test/debug in JavaScript
- ✅ Rapid prototyping

**Example Decision:**

✅ **PostgreSQL - Data aggregation:**
```sql
CREATE FUNCTION get_venue_stats(p_user_id INT, p_venue_id INT)
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'total_sites', COUNT(s.id),
    'total_events', COUNT(e.id),
    'revenue', SUM(e.revenue)
  )
  FROM sites s
  LEFT JOIN events e ON e.site_id = s.id
  WHERE s.venue_id = p_venue_id;
$$ LANGUAGE sql;
```

✅ **Bun - External API integration:**
```javascript
export async function sendInvitation(userId, params) {
  const { email, org_id } = params;
  
  // Send via SendGrid
  await sendgrid.send({...});
  
  // Create invitation record
  await db.api.save.invitations({
    email, org_id, sent_by: userId
  }, userId);
  
  return { success: true };
}
```

### Notification Paths vs Broadcast All

**Use Targeted Notification Paths When:**
- ✅ Only specific users should see the change
- ✅ Data is sensitive (private org data)
- ✅ Need to reduce notification noise
- ✅ Clear ownership/membership model

**Use Broadcast All (null) When:**
- ✅ Public data everyone should see
- ✅ No ownership model
- ✅ Simplicity is priority
- ✅ Small user base

**Example:**

✅ **Targeted (private venues):**
```sql
SELECT dzql.register_entity(
  'venues', 'name', array['name'],
  '{}', false, '{}',
  '{
    "ownership": ["@org_id->acts_for[org_id=$]{active}.user_id"]
  }'  -- Only org members notified
);
```

✅ **Broadcast (public events):**
```sql
SELECT dzql.register_entity(
  'public_events', 'name', array['name'],
  '{}', false, '{}',
  '{}'  -- Empty = notify all authenticated users
);
```

---

## Transaction Boundaries

### What Runs Atomically

**Single Transaction Includes:**
1. Primary operation (save/delete)
2. All graph rule actions for that operation
3. Event log writing
4. Trigger execution

**Example Flow:**
```javascript
// User creates organisation
await ws.api.save.organisations({name: 'Acme Corp'});

// PostgreSQL executes in ONE transaction:
// 1. INSERT INTO organisations
// 2. Graph rule: INSERT INTO acts_for (creator becomes owner)
// 3. INSERT INTO dzql.events
// 4. NOTIFY 'dzql'
// Either all succeed or all rollback
```

### Transaction Rollback

If any step fails, **entire transaction rolls back**:

```sql
-- This graph rule will rollback the org creation if site creation fails
"on_create": {
  "create_default_site": {
    "actions": [{
      "type": "create",
      "entity": "sites",
      "data": {
        "venue_id": "@id",
        "invalid_field": "@foo"  -- ERROR: invalid_field doesn't exist
      }
    }]
  }
}
-- Result: Organisation is NOT created, error is thrown
```

### Multiple Operations Are Separate Transactions

```javascript
// These are TWO separate transactions
const org = await ws.api.save.organisations({name: 'Acme'});  // Transaction 1
const venue = await ws.api.save.venues({org_id: org.id});     // Transaction 2

// If venue creation fails, org still exists
```

To make multiple operations atomic, use a PostgreSQL function:

```sql
CREATE FUNCTION create_org_with_venue(p_user_id INT, p_org_name TEXT, p_venue_name TEXT)
RETURNS JSONB AS $$
DECLARE
  v_org RECORD;
  v_venue RECORD;
BEGIN
  INSERT INTO organisations (name) VALUES (p_org_name) RETURNING * INTO v_org;
  INSERT INTO venues (name, org_id) VALUES (p_venue_name, v_org.id) RETURNING * INTO v_venue;
  
  RETURN jsonb_build_object('org', to_jsonb(v_org), 'venue', to_jsonb(v_venue));
END;
$$ LANGUAGE plpgsql;
```

---

## FK Includes Edge Cases

### Circular References

**Problem:** A→B and B→A causes infinite recursion

```sql
-- organisations.parent_org_id -> organisations
-- organisations.child_orgs <- organisations
SELECT dzql.register_entity(
  'organisations', 'name', array['name'],
  '{"parent": "organisations", "children": "organisations"}'  -- CIRCULAR!
);
```

**Solution:** Only include one direction
```sql
'{"parent": "organisations"}'  -- Parent only, not children
```

### Deeply Nested Includes

**Problem:** Performance degrades with deep nesting

```sql
-- venue -> org -> parent_org -> parent_org -> ...
'{"org": "organisations"}'  -- This only derefs 1 level
```

**Behavior:**
- FK includes dereference **1 level only**
- Nested includes (org.parent_org) are NOT automatically included
- To include nested, configure in each entity separately

### Performance Implications

| FK Includes | Query Complexity | Recommendation |
|-------------|------------------|----------------|
| None | SELECT * FROM table | Fastest |
| 1-2 single objects | 1-2 JOINs | Good |
| 3+ single objects | 3+ JOINs | Consider splitting |
| 1 child array | 1 subquery | Good |
| 2+ child arrays | 2+ subqueries | Slow - avoid |

**Optimization Strategy:**
- Only include FKs you actually need
- Avoid including large child arrays unless necessary
- Consider separate queries for child arrays
- Use pagination for child arrays

---

## Security Checklist

### When Building DZQL Applications

**Authentication:**
- ✅ Always require `login_user()` before operations
- ✅ Store JWT in secure storage (not localStorage for production)
- ✅ Set `JWT_EXPIRES_IN` to reasonable duration (7d default)
- ✅ Regenerate `JWT_SECRET` for production (never use default)
- ✅ Validate token on every operation (automatic in DZQL)

**Permissions:**
- ✅ Configure `permission_paths` for all non-public entities
- ✅ Use empty array `[]` only for truly public data
- ✅ Test permission paths with different user roles
- ✅ Never trust client-side filtering - always enforce server-side
- ✅ Use `{active}` temporal filtering in permission paths

**Graph Rules:**
- ✅ Validate graph rule variables exist
- ✅ Test rollback behavior (ensure atomicity)
- ✅ Avoid complex logic in graph rules (use functions instead)
- ✅ Document cascade delete behavior

**Input Validation:**
- ✅ DZQL validates entity schema automatically
- ✅ Add custom validation in PostgreSQL functions if needed
- ✅ Use CHECK constraints for business rules
- ✅ Never expose raw error messages to client

**Rate Limiting:**
- ⚠️ DZQL doesn't include rate limiting (v0.1.0)
- ✅ Add rate limiting middleware for production
- ✅ Limit login attempts
- ✅ Limit operations per user/minute

**Error Handling:**
- ✅ Catch all errors in client
- ✅ Log errors server-side
- ✅ Never expose stack traces in production
- ✅ Return generic error messages to client

---

## Performance Guidelines

### Index Recommendations

**Always Index:**
- ✅ Primary keys (automatic)
- ✅ Foreign keys used in paths
- ✅ Fields in `searchable_fields`
- ✅ Temporal fields (`valid_from`, `valid_to`)
- ✅ Fields used in permission path filters

```sql
-- Example indexes for venues entity
CREATE INDEX idx_venues_org_id ON venues(org_id);
CREATE INDEX idx_venues_name ON venues(name);  -- searchable field
CREATE INDEX idx_sites_venue_id ON sites(venue_id);  -- for FK includes
```

### Searchable Fields Impact

**Performance Cost:**
- Each searchable field adds to `_search` query cost
- Text search uses `ILIKE` which can be slow without indexes
- Limit to 3-5 truly searchable fields

```sql
-- Good: 3 searchable fields
array['name', 'address', 'city']

-- Bad: Too many fields
array['name', 'address', 'city', 'description', 'notes', 'tags', 'metadata']
```

### FK Includes Cost

| Include Type | Cost | Query |
|--------------|------|-------|
| Single object | 1 JOIN | Fast |
| Child array (small) | 1 subquery | Moderate |
| Child array (large) | 1 subquery + many rows | Slow |
| Multiple arrays | N subqueries | Very slow |

**Optimization:**
```sql
-- Good: One FK dereference
'{"org": "organisations"}'

-- Good: Small child array (<100 records)
'{"sites": "sites"}'

-- Bad: Multiple large child arrays
'{"sites": "sites", "events": "events", "contractors": "contractors"}'
```

### Graph Rules Complexity

**Fast Graph Rules:**
- ✅ Single action per rule
- ✅ Simple match conditions
- ✅ Direct variable references

**Slow Graph Rules:**
- ❌ Multiple chained actions
- ❌ Complex match conditions
- ❌ Nested graph rules triggering other graph rules

```jsonb
// Good: Simple cascade
"on_delete": {
  "cascade": {
    "actions": [{"type": "delete", "entity": "sites", "match": {"venue_id": "@id"}}]
  }
}

// Bad: Complex chain
"on_create": {
  "rule1": {"actions": [...]},  // Triggers more operations
  "rule2": {"actions": [...]},  // Which trigger more operations
  "rule3": {"actions": [...]}   // Slows down creation significantly
}
```

### Query Optimization Tips

1. **Limit searchable fields** to truly searchable content
2. **Index foreign keys** used in joins and paths
3. **Avoid large FK includes** in list operations
4. **Use pagination** (keep `limit` ≤ 100)
5. **Filter before including** FKs when possible
6. **Monitor slow queries** via PostgreSQL logs

---

## Additional Resources

- **API Reference**: See [API Reference](../reference/api.md) for complete API documentation
- **Tutorial**: See [Getting Started Tutorial](../getting-started/tutorial.md) for hands-on guide
- **Examples**: See `packages/venues/` for complete working application
- **Tests**: See `packages/venues/tests/` for comprehensive test patterns
