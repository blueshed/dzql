# DZQL - Zero-Boilerplate Database Framework

PostgreSQL-powered framework with automatic CRUD operations, real-time WebSocket synchronization, and graph-based permissions. **No migrations. No schema files. No API boilerplate.**

```bash
npm install dzql
# or with Bun (no Node.js required)
bun add dzql
```

## Why DZQL?

### Before DZQL
```javascript
// Traditional approach: Write everything
app.post('/api/users', authenticate, validate, async (req, res) => {
  try {
    const user = await db.query('INSERT INTO users (...) VALUES (...)', [...]);
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// Repeat for GET, PUT, DELETE, SEARCH, LOOKUP... = 50+ lines of boilerplate
```

### With DZQL
```javascript
// That's it. All 5 operations work automatically.
// GET, SAVE, DELETE, LOOKUP, SEARCH
const user = await ws.api.save.users({ name: 'John' });
const results = await ws.api.search.users({ filters: {name: 'john'} });
```

## Features

✅ **Zero Boilerplate** - Register entity, get 5 CRUD operations automatically  
✅ **Real-time WebSocket** - Automatic change notifications to all clients  
✅ **PostgreSQL-native** - Leverage full SQL power when needed  
✅ **Graph Rules** - Cascading operations without joins  
✅ **Permissions & RLS** - Row-level security built-in  
✅ **Full-text Search** - Built-in search with filters & pagination  
✅ **Type-safe** - Uses PostgreSQL as source of truth  
✅ **Framework-agnostic** - Works with any frontend (React, Vue, Svelte, plain JS)  
✅ **Bun Native** - No Node.js required  

## Quick Start

### 1. Install
```bash
bun add dzql
```

### 2. Start PostgreSQL
```bash
docker run -d \
  -e POSTGRES_PASSWORD=dzql \
  -e POSTGRES_DB=dzql \
  -p 5432:5432 \
  postgres:latest
```

### 3. Create Server
```javascript
import { createServer } from 'dzql';

const server = createServer({ port: 3000 });
console.log('🚀 Server on ws://localhost:3000/ws');
```

### 4. Initialize Database
```bash
# Apply DZQL core migrations (included in package)
psql -h localhost -U postgres -d dzql < node_modules/dzql/src/database/migrations/*.sql

# Register your entities
psql -h localhost -U postgres -d dzql << EOF
CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT, email TEXT);

SELECT dzql.register_entity(
  'users',
  'name',
  array['name', 'email']
);
EOF
```

### 5. Use from Client
```javascript
import { WebSocketManager } from 'dzql/client';

const ws = new WebSocketManager();
await ws.connect();

// All 5 operations work automatically
const user = await ws.api.save.users({ name: 'Alice', email: 'alice@example.com' });
const results = await ws.api.search.users({ filters: { name: { ilike: '%alice%' } } });
const deleted = await ws.api.delete.users({ id: user.id });
```

## The 5 Operations

Every registered entity automatically gets these 5 operations:

### GET - Retrieve Single Record
```javascript
const user = await ws.api.get.users({ id: 1 });
// Server: await db.api.get.users({ id: 1 }, userId);
```

### SAVE - Create or Update
```javascript
const user = await ws.api.save.users({
  id: 1,           // Optional - omit for insert
  name: 'Alice',
  email: 'alice@example.com'
});
```

### DELETE - Remove Record
```javascript
const deleted = await ws.api.delete.users({ id: 1 });
```

### LOOKUP - Autocomplete/Label Lookup
```javascript
const options = await ws.api.lookup.users({ p_filter: 'ali' });
// Returns: [{ label: 'Alice', value: 1 }]
```

### SEARCH - Advanced Search with Pagination
```javascript
const results = await ws.api.search.users({
  filters: {
    name: { ilike: '%alice%' },
    email: 'alice@example.com',
    created_at: { gte: '2025-01-01' }
  },
  sort: { field: 'name', order: 'asc' },
  page: 1,
  limit: 25
});
// Returns: { data: [...], total: 42, page: 1, limit: 25 }
```

## Entity Registration

Before DZQL works with a table, register it:

```sql
SELECT dzql.register_entity(
  p_table_name := 'users',
  p_label_field := 'name',                          -- For LOOKUP display
  p_searchable_fields := array['name', 'email'],    -- For SEARCH
  p_fk_includes := '{"department": "departments"}'::jsonb,  -- Dereference FKs
  p_graph_rules := '{
    "on_delete": {
      "cascade": {
        "actions": [{
          "type": "delete",
          "entity": "posts",
          "condition": "user_id = @id"
        }]
      }
    }
  }'::jsonb
);
```

## Core API

### Server-Side (Bun/Node)

```javascript
import { createServer, db, sql } from 'dzql';

// Direct SQL access
const users = await sql`SELECT * FROM users WHERE active = true`;

// DZQL operations (require userId for permissions)
const user = await db.api.get.users({ id: 1 }, userId);
const saved = await db.api.save.users({ name: 'Bob' }, userId);
const searched = await db.api.search.users(
  { filters: { name: 'bob' } },
  userId
);
const deleted = await db.api.delete.users({ id: 1 }, userId);
const options = await db.api.lookup.users({ p_filter: 'bo' }, userId);

// Custom functions
const result = await db.api.myCustomFunction({ param: 'value' }, userId);

// Start server
const server = createServer({
  port: 3000,
  customApi: {},           // Optional: add custom functions
  staticPath: './public',  // Optional: serve static files
  routes: {                // Optional: standard HTTP routes
    '/health': () => new Response('OK')
  },
  onReady: async (broadcast) => {  // Optional: routes needing broadcast
    return {
      '/mcp': createMCPRoute(broadcast)  // Example: MCP integration
    };
  }
});
```

### Client-Side (Browser/Bun)

```javascript
import { WebSocketManager } from 'dzql/client';

// Create connection
const ws = new WebSocketManager();
await ws.connect();

// Authentication
const auth = await ws.api.login_user({
  email: 'user@example.com',
  password: 'password'
});
// Returns: { token, profile, user_id }

// All DZQL operations
const user = await ws.api.get.users({ id: 1 });
const saved = await ws.api.save.users({ name: 'Charlie' });
const deleted = await ws.api.delete.users({ id: 1 });
const lookup = await ws.api.lookup.users({ p_filter: 'char' });
const search = await ws.api.search.users({ filters: {} });

// Custom functions
const result = await ws.api.myCustomFunction({ foo: 'bar' });

// Real-time events
const unsubscribe = ws.onBroadcast((method, params) => {
  console.log(`${method}:`, params.data);
  // Events: "users:insert", "users:update", "users:delete"
});

// Cleanup
ws.cleanDisconnect();
```

## Custom Functions

Add functions alongside DZQL operations:

### PostgreSQL Function
```sql
CREATE OR REPLACE FUNCTION transfer_amount(
  p_user_id INT,
  p_from_account INT,
  p_to_account INT,
  p_amount DECIMAL
) RETURNS TABLE (success BOOLEAN, message TEXT) AS $$
BEGIN
  -- Your logic here
  RETURN QUERY SELECT true, 'Transfer complete';
END;
$$ LANGUAGE plpgsql;
```

### Bun Function
```javascript
// server/api.js
export async function transfer_amount(userId, params) {
  const { from_account, to_account, amount } = params;
  // Your logic here
  return { success: true, message: 'Transfer complete' };
}

// server/index.js
const customApi = await import('./api.js');
const server = createServer({ customApi });
```

### Usage
```javascript
const result = await ws.api.transfer_amount({
  from_account: 1,
  to_account: 2,
  amount: 100
});
```

## Real-time Events

Listen for database changes in real-time:

```javascript
ws.onBroadcast((method, params) => {
  if (method === 'users:insert') {
    console.log('New user:', params.data);
    // params: { op: 'insert', table: 'users', data: {...}, notify_users: [...] }
  }
  if (method === 'users:update') {
    console.log('User updated:', params.data);
  }
  if (method === 'users:delete') {
    console.log('User deleted:', params.data);
  }
});
```

## Graph Rules - Cascading Operations

Automatically cascade changes through relationships:

```sql
SELECT dzql.register_entity(
  p_table_name := 'organisations',
  p_label_field := 'name',
  p_searchable_fields := array['name'],
  p_graph_rules := '{
    "on_delete": {
      "cascade_to_teams": {
        "actions": [{
          "type": "delete",
          "entity": "teams",
          "condition": "org_id = @id"
        }]
      }
    },
    "on_create": {
      "create_default_team": {
        "actions": [{
          "type": "create",
          "entity": "teams",
          "data": {
            "org_id": "@id",
            "name": "Default Team"
          }
        }]
      }
    }
  }'::jsonb
);
```

Available actions: `create`, `update`, `delete`, `insert`, `call_function`

## Permissions & Row-Level Security

Implement permissions in your entity registration:

```sql
SELECT dzql.register_entity(
  p_table_name := 'posts',
  p_label_field := 'title',
  p_searchable_fields := array['title', 'content'],
  p_permission_rules := '{
    "view": {
      "public_posts": {
        "condition": "public = true OR author_id = @user_id"
      }
    },
    "edit": {
      "own_posts": {
        "condition": "author_id = @user_id"
      }
    }
  }'::jsonb
);
```

## Search Filter Operators

```javascript
const results = await ws.api.search.venues({
  filters: {
    // Exact match
    name: 'Madison Square Garden',
    
    // Comparison operators
    capacity: { gt: 1000 },         // Greater than
    capacity: { gte: 1000 },        // Greater or equal
    capacity: { lt: 50000 },        // Less than
    capacity: { lte: 50000 },       // Less or equal
    capacity: { neq: 5000 },        // Not equal
    
    // Range
    capacity: { between: [1000, 50000] },
    
    // Pattern matching
    name: { like: '%garden%' },     // Case-sensitive
    name: { ilike: '%GARDEN%' },    // Case-insensitive
    
    // NULL checks
    description: null,               // IS NULL
    description: { not_null: true }, // IS NOT NULL
    
    // Arrays
    categories: ['sports', 'music'],  // IN array
    categories: { not_in: ['adult'] }, // NOT IN array
    
    // Text search (across searchable_fields)
    _search: 'madison garden'
  },
  page: 1,
  limit: 25
});
```

## Project Structure

```
my-app/
├── server/
│   ├── index.js           # Server entry point
│   └── api.js             # Custom API functions (optional)
├── database/
│   ├── docker-compose.yml # PostgreSQL setup
│   ├── init_db/
│   │   ├── 001_schema.sql # Your tables
│   │   └── 002_entities.sql # Entity registration
│   └── seeds/             # Sample data (optional)
├── client/
│   └── index.html         # Frontend (optional)
├── tests/
│   └── app.test.js
├── package.json
└── bunfig.toml            # Bun config (optional)
```

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://dzql:dzql@localhost:5432/dzql

# Server
PORT=3000
NODE_ENV=development

# JWT
JWT_SECRET=your-secret-key-min-32-chars
JWT_EXPIRES_IN=7d

# WebSocket
WS_PING_INTERVAL=30000        # Keep-alive ping (Heroku safe: <55s)
WS_PING_TIMEOUT=5000

# Logging
LOG_LEVEL=INFO                # ERROR, WARN, INFO, DEBUG, TRACE
LOG_CATEGORIES=ws:debug,db:debug
```

## Examples

See the [venues example](https://github.com/blueshed/dzql/tree/main/packages/venues) for a complete working application.

### Todo App
```javascript
// Schema
CREATE TABLE todos (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  title TEXT NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT dzql.register_entity('todos', 'title', array['title']);

// Client
const todo = await ws.api.save.todos({ title: 'Learn DZQL' });
const list = await ws.api.search.todos({
  filters: { completed: false },
  limit: 100
});
await ws.api.save.todos({ id: todo.id, completed: true });
await ws.api.delete.todos({ id: todo.id });
```

## Error Handling

```javascript
try {
  const user = await ws.api.get.users({ id: 999 });
} catch (error) {
  // Common errors:
  // "record not found" - Record doesn't exist
  // "Permission denied: view on users" - Access denied
  // "entity users not configured" - Entity not registered
  // "Column foo does not exist in table users" - Invalid column
  console.error(error.message);
}
```

## Getting Help

- **Documentation**: [GETTING_STARTED.md](./GETTING_STARTED.md)
- **GitHub**: https://github.com/blueshed/dzql
- **Issues**: https://github.com/blueshed/dzql/issues
- **Email**: support@blueshed.com

## License

MIT - See LICENSE file

## Authors

Created by [Blueshed](https://blueshed.com)

---

**Ready to build?** Start with [GETTING_STARTED.md](./GETTING_STARTED.md) 🚀