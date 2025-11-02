# DZQL

> ⚠️ **ALPHA SOFTWARE** - DZQL is in early alpha (v0.1.0-alpha.1). The API may change. Not recommended for production use yet. Feedback and contributions welcome!

A PostgreSQL-powered framework that automatically provides 5 standard database operations per entity with real-time WebSocket synchronization and zero boilerplate.

## Overview

DZQL eliminates CRUD boilerplate by providing a nested proxy API pattern where registering an entity in PostgreSQL instantly gives you:
- 5 standard operations (get, save, delete, lookup, search)
- Graph rules for automatic relationship management
- Real-time change notifications via WebSocket
- Temporal relationship handling
- JWT authentication
- Foreign key dereferencing

## Architecture

```
Browser                 Bun Server              PostgreSQL
ws.api.save.venues() -> db.api.save.venues() -> dzql.generic_save()
                        WebSocket broadcast  <-- NOTIFY 'dzql' channel
```

- **Protocol**: JSON-RPC 2.0 over WebSocket
- **Server**: Bun runtime with WebSocket support
- **Database**: PostgreSQL with stored procedures
- **Real-time**: PostgreSQL NOTIFY/LISTEN on single 'dzql' channel

## Quick Start

### 1. Configure Environment

Copy the example environment file and configure:

```bash
cp .env.example .env
```

**Required for production:**
- `JWT_SECRET` - Secret key for JWT tokens (generate with `openssl rand -base64 32`)

**Optional configuration:**
- `DATABASE_URL` - PostgreSQL connection string (default: `postgresql://dzql:dzql@localhost:5432/dzql`)
- `PORT` - Server port (default: 3000)
- `JWT_EXPIRES_IN` - Token expiration (default: 7d)
- `DB_MAX_CONNECTIONS` - Connection pool size (default: 10)
- `LOG_LEVEL` - Logging level: ERROR, WARN, INFO, DEBUG, TRACE (default: INFO)
- `LOG_CATEGORIES` - Per-category levels (e.g., `ws:debug,db:info`)

See [`.env.example`](.env.example) for all available options.

### 2. Start PostgreSQL
```bash
bun venues:db        # Starts PostgreSQL via Docker Compose (clean slate)
```

### 3. Register an Entity
```sql
SELECT dzql.register_entity(
  'venues',                              -- table name
  'name',                                -- label field for lookups
  array['name', 'address', 'description'], -- searchable fields
  '{"org": "organisations"}',            -- foreign keys to dereference
  false,                                 -- soft delete
  '{}',                                  -- temporal fields
  '{                                     -- notification paths
    "ownership": ["@org_id->acts_for[org_id=$]{active}.user_id"]
  }',
  '{                                     -- permission paths
    "create": ["@org_id->acts_for[org_id=$]{active}.user_id"],
    "update": ["@org_id->acts_for[org_id=$]{active}.user_id"],
    "delete": ["@org_id->acts_for[org_id=$]{active}.user_id"],
    "view": []
  }',
  '{                                     -- graph rules
    "on_create": {
      "establish_site": {
        "description": "Create default site when venue is created",
        "actions": [{
          "type": "create",
          "entity": "sites",
          "data": {
            "name": "Main Site",
            "venue_id": "@id",
            "created_by": "@user_id"
          }
        }]
      }
    }
  }'
);
```

This single call:
- Configures the entity in `dzql.entities` table
- Creates database trigger for real-time events
- Enables all 5 standard operations
- Sets up notification paths for targeted real-time updates
- Configures permission paths for row-level security
- Installs graph rules for automatic relationship management

### 3. Start the Server
```bash
bun venues           # Starts venues example server with hot reload
```

### 4. Use the API
```javascript
import WebSocketManager from './packages/client/ws.js';

const ws = new WebSocketManager();
await ws.connect();

// Authenticate
const auth = await ws.api.login_user({
  email: 'user@example.com',
  password: 'password'
});

// Use the 5 standard operations via nested proxy
const venue = await ws.api.get.venues({id: 1});
const venues = await ws.api.lookup.venues({p_filter: 'madison'});
const results = await ws.api.search.venues({filters: {city: 'NYC'}});
const saved = await ws.api.save.venues({name: 'New Venue', address: '123 Main'});
const deleted = await ws.api.delete.venues({id: 1});
```

## The 5 Standard Operations

### 1. GET - Retrieve single entity with foreign keys
```javascript
const venue = await ws.api.get.venues({id: 1});
// Returns venue with dereferenced org and nested sites

// With temporal filtering
const historicalVenue = await ws.api.get.venues({id: 1, on_date: '2023-01-01'});
```

### 2. SAVE - Smart upsert
```javascript
// Insert (no id)
const newVenue = await ws.api.save.venues({
  name: 'Madison Square Garden',
  address: 'NYC',
  org_id: 1
});

// Update (with id)
const updated = await ws.api.save.venues({
  id: 1,
  name: 'Updated Name'
});
```

### 3. DELETE - Remove entity
```javascript
const result = await ws.api.delete.venues({id: 1});
```

### 4. LOOKUP - Autocomplete/typeahead data
```javascript
const options = await ws.api.lookup.venues({p_filter: 'madison'});
// Returns: [{label: "Madison Square Garden", value: 1}, ...]
```

### 5. SEARCH - Filterable, paginated results
```javascript
const results = await ws.api.search.venues({
  filters: {
    city: 'New York',
    capacity: {gte: 1000, lt: 5000},
    name: {ilike: '%garden%'},
    _search: 'madison'  // Text search across searchable fields
  },
  sort: {field: 'name', order: 'asc'},
  page: 1,
  limit: 25
});
// Returns: {data: [...], total: 100, page: 1, limit: 25}
```

## Real-time Events

All database changes trigger WebSocket events with intelligent user targeting:

```javascript
// Listen for specific table events
ws.onBroadcast((method, params) => {
  if (method === 'venues:update') {
    console.log('Venue updated:', params);
    // params: {table, op, pk, before, after, user_id, at}
  }
});
```

Events flow:
1. Database trigger fires on INSERT/UPDATE/DELETE
2. Notification paths resolve affected users based on entity relationships
3. Event logged to `dzql.events` table with `notify_users` array
4. PostgreSQL NOTIFY on 'dzql' channel
5. Bun server filters by `notify_users` (null = broadcast to all)
6. WebSocket message sent as `{table}:{op}` method to affected users only

### Notification Paths

Notification paths determine which users receive real-time updates for an entity. They use a path syntax to traverse relationships that result in sets of user_ids:

```sql
-- Path syntax: @field->table[filter]{temporal}.target_field
-- Examples:
'@org_id->acts_for[org_id=$]{active}.user_id'     -- Users who act for the org
'@user_id'                                         -- Direct user reference
'@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'  -- Via venue
```

Path components:
- `@field` - Start from a field in the current record
- `->table` - Navigate to related table
- `[filter]` - Filter condition (`$` = current field value)
- `{temporal}` - Apply temporal filtering (`{active}` = current valid)
- `.field` - Target field to extract

Configure notification paths when registering an entity:

```sql
SELECT dzql.register_entity(
  'packages',
  'name',
  array['name'],
  '{"owner_org": "organisations", "sponsor_org": "organisations"}',
  false,
  '{}',
  '{
    "ownership": ["@owner_org_id->acts_for[org_id=$]{active}.user_id"],
    "sponsorship": ["@sponsor_org_id->acts_for[org_id=$]{active}.user_id"]
  }'::jsonb
);
```

## Permissions

DZQL provides row-level security through permission paths:

### Permission Paths

Permission paths determine who can perform operations on each record by checking to see if the user_id is in the set of user_ids returned by the paths:

```sql
-- Configure permissions when registering entity
SELECT dzql.register_entity(
  'venues', 'name', array['name'], '{}', false, '{}',
  '{}',  -- notification paths
  '{
    "create": ["@org_id->acts_for[org_id=$]{active}.user_id"],
    "update": ["@org_id->acts_for[org_id=$]{active}.user_id"],
    "delete": ["@org_id->acts_for[org_id=$]{active}.user_id"],
    "view": []  -- Empty = public read access
  }'::jsonb
);
```

Permission types:
- **create**: Who can create records (checked against new record)
- **update**: Who can modify records (checked against existing record)
- **delete**: Who can remove records (checked against existing record)
- **view**: Who can read records (empty array = public access)

The permission system automatically:
- Checks permissions before any operation
- Uses the same path syntax as notifications
- Resolves permissions based on current relationships
- Respects temporal filtering for time-based access

## Authentication

JWT-based authentication with automatic user_id injection:

```javascript
// Login
const result = await ws.api.login_user({
  email: 'user@example.com',
  password: 'password'
});
// Returns: {user_id, email, token, profile}

// Register
const newUser = await ws.api.register_user({
  email: 'newuser@example.com',
  password: 'password'
});

// All subsequent operations include user_id automatically
```

## Temporal Relationships

Handle time-based relationships with `valid_from`/`valid_to` fields:

```sql
-- Configure temporal entity
SELECT dzql.register_entity(
  'contractor_rights',
  'contractor_name',
  array['contractor_name'],
  '{"contractor_org": "organisations", "venue": "venues"}',
  false,
  '{"valid_from": "valid_from", "valid_to": "valid_to"}',
  '{}',  -- notification paths
  '{}'   -- permission paths
);
```

```javascript
// Get current relationships (default)
const rights = await ws.api.get.contractor_rights({id: 1});

// Get historical relationships
const pastRights = await ws.api.get.contractor_rights({
  id: 1,
  on_date: '2023-01-01'
});
```

## Graph Rules

Graph rules automatically manage entity relationships when data changes. They eliminate boilerplate for common patterns like "creator becomes owner" or "cascade deletes".

### Configuring Graph Rules

Graph rules are configured when registering an entity:

```sql
SELECT dzql.register_entity(
  'organisations',
  'name',
  array['name', 'description'],
  '{}',
  false,
  '{}',
  '{}',  -- notification paths
  '{}',  -- permission paths
  jsonb_build_object(
    'on_create', jsonb_build_object(
      'establish_ownership', jsonb_build_object(
        'description', 'Creator becomes member of organisation',
        'actions', jsonb_build_array(
          jsonb_build_object(
            'type', 'create',
            'entity', 'acts_for',
            'data', jsonb_build_object(
              'user_id', '@user_id',
              'org_id', '@id',
              'valid_from', '@today'
            )
          )
        )
      )
    ),
    'on_delete', jsonb_build_object(
      'cascade_venues', jsonb_build_object(
        'description', 'Delete all venues when org is deleted',
        'actions', jsonb_build_array(
          jsonb_build_object(
            'type', 'delete',
            'entity', 'venues',
            'match', jsonb_build_object('org_id', '@id')
          )
        )
      )
    )
  )
);
```

### Graph Rule Structure

```jsonb
{
  "on_create": {
    "rule_name": {
      "description": "Human-readable description",
      "actions": [
        {
          "type": "create|update|delete",
          "entity": "target_table",
          "data": {"field": "@variable"},      // for create/update
          "match": {"field": "@variable"}      // for update/delete
        }
      ]
    }
  },
  "on_update": { /* similar structure */ },
  "on_delete": { /* similar structure */ }
}
```

### Variable System

Graph rules use variables to reference data from the triggering operation:

**Built-in Variables:**
- `@user_id` - Current authenticated user
- `@id` - Primary key of the record
- `@field_name` - Any field from the record
- `@now` - Current timestamp
- `@today` - Current date

**Examples:**
```jsonb
{
  "data": {
    "user_id": "@user_id",     // Current user becomes owner
    "org_id": "@id",           // Reference to created org
    "valid_from": "@today"     // Today's date
  }
}
```

### Common Graph Rule Patterns

#### 1. Creator Becomes Owner
When a user creates an organisation, they automatically become a member:

```jsonb
{
  "on_create": {
    "establish_ownership": {
      "description": "Creator becomes member of organisation",
      "actions": [{
        "type": "create",
        "entity": "acts_for",
        "data": {
          "user_id": "@user_id",
          "org_id": "@id",
          "valid_from": "@today"
        }
      }]
    }
  }
}
```

#### 2. Cascade Delete
When an organisation is deleted, delete all its venues:

```jsonb
{
  "on_delete": {
    "cascade_venues": {
      "description": "Delete all venues when org is deleted",
      "actions": [{
        "type": "delete",
        "entity": "venues",
        "match": {"org_id": "@id"}
      }]
    }
  }
}
```

#### 3. Temporal Transitions
End previous relationship when creating a new one:

```jsonb
{
  "on_create": {
    "expire_previous": {
      "description": "End previous temporal relationship",
      "actions": [{
        "type": "update",
        "entity": "acts_for",
        "match": {
          "user_id": "@user_id",
          "org_id": "@org_id",
          "valid_to": null
        },
        "data": {
          "valid_to": "@valid_from"
        }
      }]
    }
  }
}
```

### How Graph Rules Work

1. **Trigger**: When you save/delete an entity, graph rules check for configured rules
2. **Variable Resolution**: Variables like `@user_id` and `@id` are replaced with actual values
3. **Action Execution**: Each action (create/update/delete) runs in sequence
4. **Transaction**: All changes are atomic - if any rule fails, everything rolls back
5. **Event Generation**: Graph rule actions generate their own audit events

Graph rules run automatically within the same transaction as the triggering operation, ensuring data consistency.

## Custom Functions

DZQL supports two types of custom functions that extend beyond the 5 standard operations:

### 1. PostgreSQL Functions

Create stored procedures in PostgreSQL and call them via the proxy API:

```sql
-- Create a PostgreSQL function (first parameter must be p_user_id)
CREATE OR REPLACE FUNCTION hello(p_user_id INT, p_name TEXT DEFAULT 'World')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN jsonb_build_object(
    'message', 'Hello, ' || COALESCE(p_name, 'World') || '!',
    'timestamp', now(),
    'from', 'PostgreSQL',
    'user_id', p_user_id
  );
END;
$$;

-- Functions are automatically callable - no registration needed
```

```javascript
// Call PostgreSQL function via proxy API
const result = await ws.api.hello();
// Returns: {message: "Hello, World!", timestamp: "...", from: "PostgreSQL", user_id: 123}

// With parameters
const greeting = await ws.api.hello({name: 'DZQL'});
// Returns: {message: "Hello, DZQL!", timestamp: "...", from: "PostgreSQL", user_id: 123}
```

### 2. Bun Functions

Create JavaScript functions in the server and call them via the same proxy API:

```javascript
// server/api.js - Export functions for auto-discovery
export async function goodbye(userId, params = {}) {
  const { name = "World" } = params;

  return {
    message: `Goodbye, ${name}!`,
    from: "Bun",
    user_id: userId,
  };
}

export async function calculateDiscount(userId, params) {
  const { total, customerType } = params;

  // Business logic here - can use db.api for database access
  const discount = customerType === 'premium' ? 0.15 : 0.05;

  return {
    originalTotal: total,
    discount: discount,
    finalTotal: total * (1 - discount),
    calculatedBy: userId,
  };
}
```

```javascript
// Call Bun functions via the same proxy API
const farewell = await ws.api.goodbye({name: 'DZQL'});
// Returns: {message: "Goodbye, DZQL!", from: "Bun", user_id: 123}

const pricing = await ws.api.calculateDiscount({
  total: 100,
  customerType: 'premium'
});
// Returns: {originalTotal: 100, discount: 0.15, finalTotal: 85, calculatedBy: 123}
```

### Function Conventions

**Both PostgreSQL and Bun functions follow the same pattern:**

1. **First Parameter**: Always receives `user_id` (automatically injected)
2. **Second Parameter**: Request parameters object
3. **Authentication**: All custom functions require user authentication
4. **API Access**: Use the same `ws.api.functionName()` syntax
5. **Return Value**: Can return any JSON-serializable object

**PostgreSQL Functions:**
- First parameter must be named `p_user_id INT`
- Can access full PostgreSQL ecosystem (other tables, functions, etc.)
- Automatically transactional
- Optional registration in `dzql.registry`

**Bun Functions:**
- First parameter is `userId` (number)
- Can access database via `db.api.*` proxy
- Can use any npm packages


## Project Structure

```
dzql/
├── packages/
│   ├── dzql/                        # Core DZQL framework
│   │   └── src/database/migrations/
│   │       ├── 001_schema.sql       # Core tables (entities, events, registry)
│   │       ├── 002_functions.sql    # Helper functions, path resolution
│   │       ├── 003_operations.sql   # Generic CRUD operations with graph rules
│   │       ├── 004_search.sql       # Advanced search functionality
│   │       ├── 005_entities.sql     # Entity registration and graph rules
│   │       ├── 006_auth.sql         # Authentication functions
│   │       └── 007_hello.sql        # Example custom function
│   ├── venues/                      # Example application
│   │   ├── server/
│   │   │   ├── index.js             # Bun WebSocket server
│   │   │   ├── ws.js                # WebSocket handlers & JSON-RPC
│   │   │   ├── db.js                # PostgreSQL connection & DZQL proxy
│   │   │   └── api.js               # Custom Bun functions
│   │   ├── database/
│   │   │   ├── docker-compose.yml   # PostgreSQL Docker setup
│   │   │   └── init_db/
│   │   │       └── 008_venues_domain.sql  # Venues domain entities
│   │   ├── client/
│   │   │   ├── ws.js                # WebSocket client with nested proxy API
│   │   │   └── index.html           # Example web interface
│   │   └── tests/
│   │       └── *.test.js            # Bun test suite
│   ├── client/                      # Shared client utilities
│   └── rights/                      # Alternative example application
└── package.json                     # Workspace configuration
```

## Database Tables

### Core DZQL Tables
- `dzql.entities` - Entity configuration (label fields, searchable fields, permissions)
- `dzql.registry` - Allowed custom functions
- `dzql.events` - Event log with audit trail and real-time notification data

### Event Structure
```sql
dzql.events {
  event_id: bigserial,
  context_id: text,       -- for catchup queries
  table_name: text,
  op: 'insert'|'update'|'delete',
  pk: jsonb,             -- primary key
  before: jsonb,         -- old values
  after: jsonb,          -- new values
  user_id: int,          -- who made the change
  notify_users: int[],   -- who to notify (resolved from notification_paths)
  at: timestamptz
}
```

### Entity Configuration
```sql
dzql.entities {
  table_name: text,
  label_field: text,
  searchable_fields: text[],
  fk_includes: jsonb,
  soft_delete: boolean,
  temporal_fields: jsonb,
  notification_paths: jsonb,  -- Named paths for notifications
  permission_paths: jsonb     -- CRUD permission paths
}
```

## Search Operators

The search operation supports advanced filtering:

- **Exact match**: `{field: "value"}`
- **Range**: `{field: {gte: 100, lt: 500}}`
- **Pattern**: `{field: {like: "%pattern%"}}` or `{ilike: "%pattern%"}`
- **IN array**: `{field: ["value1", "value2"]}`
- **NULL checks**: `{field: null}` or `{field: {not_null: true}}`
- **Text search**: `{_search: "search terms"}` (searches across all searchable fields)

## Development

```bash
# Venues Example (Recommended for getting started)
bun venues:db        # Start PostgreSQL (clean slate)
bun venues           # Start Bun server with hot reload
bun venues:test      # Run test suite
bun venues:logs      # View application logs

# Alternative - Rights Example
bun db               # Start PostgreSQL for rights example
bun server           # Start rights server

# Client
bun client           # Start client development server

# Full Development (Client + Server)
bun dev              # Start both client and server concurrently
```

## Why DZQL?

Traditional approaches require:
- Writing CRUD endpoints for every entity
- GraphQL schemas and resolvers
- ORM configuration and migrations
- Separate real-time infrastructure
- Manual permission checking

DZQL treats your database as a graph that grows and changes through user actions. Graph rules automate relationship management, permissions control how the graph can evolve, and real-time notifications keep everyone in sync as it changes. Rather than just providing CRUD operations, DZQL gives you a complete graph evolution platform through simple entity registration.

## License

MIT
