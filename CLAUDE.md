# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- Params include: `{table, op, pk, before, after, user_id, at}`
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
