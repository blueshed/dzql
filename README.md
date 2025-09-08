# ZeroQL

A PostgreSQL-powered framework that automatically provides 5 standard database operations per entity with real-time WebSocket synchronization and zero boilerplate.

## Overview

ZeroQL eliminates CRUD boilerplate by providing a nested proxy API pattern where registering an entity in PostgreSQL instantly gives you:
- 5 standard operations (get, save, delete, lookup, search)
- Real-time change notifications via WebSocket
- Temporal relationship handling
- JWT authentication
- Foreign key dereferencing

## Architecture

```
Browser                Bun Server              PostgreSQL
ws.api.get.venue() --> db.api.get.venues() --> zeroql.generic_get()
                       WebSocket broadcast  <-- NOTIFY 'zeroql' channel
```

- **Protocol**: JSON-RPC 2.0 over WebSocket
- **Server**: Bun runtime with WebSocket support
- **Database**: PostgreSQL with stored procedures
- **Real-time**: PostgreSQL NOTIFY/LISTEN on single 'zeroql' channel

## Quick Start

### 1. Start PostgreSQL
```bash
npm run db:up        # Starts PostgreSQL via Docker Compose
```

### 2. Register an Entity
```sql
SELECT zeroql.register_entity(
  'venues',                              -- table name
  'name',                                -- label field for lookups
  array['name', 'address', 'description'], -- searchable fields
  '{"org": "organisations"}',            -- foreign keys to dereference
  '{"read": ["user"], "write": ["owner"]}', -- permissions
  false,                                 -- soft delete
  '{}'                                   -- temporal fields
);
```

This single call:
- Configures the entity in `zeroql.entities` table
- Creates database trigger for real-time events
- Enables all 5 standard operations

### 3. Start the Server
```bash
npm run dev          # Starts Bun server with hot reload
```

### 4. Use the API
```javascript
import WebSocketManager from './client/ws.js';

const ws = new WebSocketManager();
await ws.connect();

// Authenticate
const auth = await ws.call('login_user', {
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

All database changes trigger WebSocket events:

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
2. Event logged to `zeroql.events` table with `notify_users` array
3. PostgreSQL NOTIFY on 'zeroql' channel
4. Bun server filters by `notify_users` (null = broadcast to all)
5. WebSocket message sent as `{table}:{op}` method

## Authentication

JWT-based authentication with automatic user_id injection:

```javascript
// Login
const result = await ws.call('login_user', {
  email: 'user@example.com',
  password: 'password'
});
// Returns: {user_id, email, token, profile}

// Register
const newUser = await ws.call('register_user', {
  email: 'newuser@example.com',
  password: 'password'
});

// All subsequent operations include user_id automatically
```

## Temporal Relationships

Handle time-based relationships with `valid_from`/`valid_to` fields:

```sql
-- Configure temporal entity
SELECT zeroql.register_entity(
  'contractor_rights',
  'contractor_name',
  array['contractor_name'],
  '{"contractor_org": "organisations", "venue": "venues"}',
  '{"read": ["owner","contractor"]}',
  false,
  '{"valid_from": "valid_from", "valid_to": "valid_to"}'
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

## Custom Functions

Add business logic beyond standard operations:

```javascript
// Call custom PostgreSQL functions (must be in zeroql.registry)
const result = await ws.call('complex_business_operation', {
  param1: 'value1',
  param2: 'value2'
});
```

## Project Structure

```
zeroql/
├── server/
│   ├── index.js     # Bun WebSocket server
│   ├── ws.js        # WebSocket handlers & JSON-RPC
│   └── db.js        # PostgreSQL connection & ZeroQL proxy
├── database/
│   ├── compose.yml  # PostgreSQL Docker setup
│   └── init_db/
│       ├── 001_zeroql.sql     # Core ZeroQL functions
│       ├── 002_search.sql     # Advanced search implementation
│       ├── 010_auth.sql       # Authentication functions
│       └── 011_simple_domain.sql  # Example domain & entities
├── client/
│   ├── ws.js        # WebSocket client with nested proxy API
│   └── index.html   # Example web interface
└── tests/
    └── *.test.js    # Bun test suite
```

## Database Tables

### Core ZeroQL Tables
- `zeroql.entities` - Entity configuration (label fields, searchable fields, permissions)
- `zeroql.registry` - Allowed custom functions
- `zeroql.events` - Event log with audit trail and real-time notification data

### Event Structure
```sql
zeroql.events {
  event_id: bigserial,
  context_id: text,       -- for catchup queries
  table_name: text,
  op: 'insert'|'update'|'delete',
  pk: jsonb,             -- primary key
  before: jsonb,         -- old values
  after: jsonb,          -- new values
  user_id: int,          -- who made the change
  notify_users: int[],   -- who to notify (null = everyone)
  at: timestamptz
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
# Database
npm run db:up        # Start PostgreSQL
npm run db:down      # Stop and remove volumes
npm run db:logs      # View PostgreSQL logs

# Server
npm run dev          # Start Bun server with hot reload

# Tests
bun test            # Run test suite
```

## Why ZeroQL?

Traditional approaches require:
- Writing CRUD endpoints for every entity
- GraphQL schemas and resolvers
- ORM configuration and migrations
- Separate real-time infrastructure
- Manual permission checking

ZeroQL provides all of this automatically through a single `register_entity()` call, letting you focus on your domain model instead of boilerplate.

## License

MIT