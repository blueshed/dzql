# DZQL

[![npm version](https://badge.fury.io/js/dzql.svg)](https://www.npmjs.com/package/dzql)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

> **v0.1.1** - PostgreSQL-powered framework that provides 5 automatic CRUD operations per entity with real-time WebSocket synchronization and zero boilerplate.
>
> 🚧 **Pre-1.0 Release** - API is stabilizing but may still change. Test thoroughly before production use.

## What is DZQL?

Register an entity in PostgreSQL → Instantly get:
- **5 operations**: GET, SAVE, DELETE, LOOKUP, SEARCH
- **Real-time sync**: WebSocket broadcasts for all changes
- **Graph rules**: Automatic relationship management
- **Permissions**: Path-based row-level security
- **Zero code**: No API routes, resolvers, or TypeScript types needed

### Before DZQL
```javascript
// Write all this for every entity:
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
const user = await ws.api.save.users({ name: 'John' });
const results = await ws.api.search.users({ filters: {name: 'john'} });
```

## Quick Start

```bash
# 1. Install
bun add dzql

# 2. Start PostgreSQL
docker run -d -e POSTGRES_PASSWORD=dzql -p 5432:5432 postgres

# 3. Register entity
psql dzql << EOF
CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT, email TEXT);
SELECT dzql.register_entity('users', 'name', array['name', 'email']);
EOF

# 4. Start server
cat > server.js << 'EOF'
import { createServer } from 'dzql';
createServer({ port: 3000 });
EOF
bun server.js

# 5. Use API
import { WebSocketManager } from 'dzql/client';
const ws = new WebSocketManager();
await ws.connect();
const user = await ws.api.save.users({ name: 'Alice' });
```

## Architecture

```
Browser                 Bun Server              PostgreSQL
ws.api.save.venues() -> db.api.save.venues() -> dzql.generic_save()
                        WebSocket broadcast  <-- NOTIFY 'dzql' channel
```

**Protocol**: JSON-RPC 2.0 over WebSocket  
**Server**: Bun runtime  
**Database**: PostgreSQL with stored procedures  
**Real-time**: NOTIFY/LISTEN on single 'dzql' channel  

## Features

✅ **Zero Boilerplate** - Register entity, get 5 operations automatically
✅ **Real-time WebSocket** - Automatic change notifications
✅ **PostgreSQL-native** - Leverage full SQL power
✅ **Graph Rules** - Cascading operations without joins
✅ **Validation Actions** - Data integrity checks in graph rules (v0.1.1)
✅ **Function Execution** - Custom logic in graph rules (v0.1.1)
✅ **Permissions & RLS** - Row-level security built-in
✅ **Full-text Search** - Built-in with filters & pagination
✅ **Framework-agnostic** - Works with React, Vue, Svelte, plain JS
✅ **Bun Native** - No Node.js required  

## The 5 Operations

```javascript
// GET - Single record
const user = await ws.api.get.users({ id: 1 });

// SAVE - Create or update
const saved = await ws.api.save.users({ name: 'Alice', email: 'alice@example.com' });

// DELETE - Remove record
await ws.api.delete.users({ id: 1 });

// LOOKUP - Autocomplete
const options = await ws.api.lookup.users({ p_filter: 'ali' });
// Returns: [{ label: 'Alice', value: 1 }]

// SEARCH - Advanced search with pagination
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
```

## Real-Time Events

All database changes broadcast instantly to connected clients:

```javascript
ws.onBroadcast((method, params) => {
  if (method === 'users:insert') {
    console.log('New user:', params.data);
  }
  if (method === 'users:update') {
    console.log('Updated:', params.data);
  }
  if (method === 'users:delete') {
    console.log('Deleted:', params.data);
  }
});
```

## Graph Rules Validation (v0.1.1)

Validate data integrity automatically with graph rules:

```sql
-- Create validation function
CREATE FUNCTION validate_positive_value(p_value INT)
RETURNS BOOLEAN AS $$
  SELECT p_value > 0;
$$ LANGUAGE sql;

-- Register entity with validation
SELECT dzql.register_entity(
  'products',
  'name',
  array['name'],
  '{}', false, '{}', '{}',
  '{
    "view": [],
    "create": [],
    "update": [],
    "delete": []
  }',
  '{
    "on_create": {
      "validate_price": {
        "description": "Ensure price is positive",
        "actions": [{
          "type": "validate",
          "function": "validate_positive_value",
          "params": {"p_value": "@price"},
          "error_message": "Price must be positive"
        }]
      }
    },
    "on_update": {
      "prevent_posted_changes": {
        "description": "Prevent modification of posted records",
        "condition": "@before.status = ''posted''",
        "actions": [{
          "type": "validate",
          "function": "always_false",
          "params": {},
          "error_message": "Cannot modify posted records"
        }]
      }
    }
  }'
);
```

**Condition syntax** supports `@before.field`, `@after.field`, `@user_id`, and complex expressions.

## Development Commands

```bash
# Venues Example (primary)
bun venues:db    # Start PostgreSQL (clean slate)
bun venues       # Start server with hot reload
bun venues:test  # Run test suite

# Full stack
bun dev          # Client + server concurrently
```

## Documentation

- **[GETTING_STARTED.md](packages/dzql/GETTING_STARTED.md)** - Step-by-step tutorial with complete todo app
- **[REFERENCE.md](packages/dzql/REFERENCE.md)** - Complete API documentation
- **[CLAUDE.md](CLAUDE.md)** - AI development guide
- **[Venues Example](packages/venues/)** - Full working application
- **[ROADMAP.md](ROADMAP.md)** - Project roadmap & known issues

## Example: Todo App

**Database:**
```sql
CREATE TABLE todos (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  title TEXT NOT NULL,
  completed BOOLEAN DEFAULT FALSE
);

SELECT dzql.register_entity('todos', 'title', array['title']);
```

**Client:**
```javascript
const todo = await ws.api.save.todos({ title: 'Learn DZQL' });
const list = await ws.api.search.todos({ filters: { completed: false } });
await ws.api.save.todos({ id: todo.id, completed: true });
await ws.api.delete.todos({ id: todo.id });
```

## Why DZQL?

Traditional approaches require:
- Writing CRUD endpoints for every entity
- GraphQL schemas and resolvers
- ORM configuration and migrations
- Separate real-time infrastructure
- Manual permission checking

**DZQL treats your database as a graph that evolves through user actions.**

Graph rules automate relationship management, permissions control how the graph evolves, and real-time notifications keep everyone in sync. Rather than just CRUD operations, DZQL gives you a complete graph evolution platform through simple entity registration.

## Project Structure

```
dzql/
├── packages/
│   ├── dzql/                        # Core framework
│   │   └── src/database/migrations/ # PostgreSQL migrations
│   ├── venues/                      # Example application
│   │   ├── server/                  # Bun server
│   │   ├── database/                # Docker setup
│   │   └── tests/                   # Test suite
│   └── client/                      # Shared utilities
└── package.json
```

## Installation

```bash
# With Bun (recommended)
bun add dzql

# With npm
npm install dzql
```

## Environment Configuration

See [`.env.example`](.env.example) for all configuration options.

**Required for production:**
- `JWT_SECRET` - Generate with `openssl rand -base64 32`

**Optional:**
- `DATABASE_URL` - PostgreSQL connection
- `PORT` - Server port (default: 3000)
- `LOG_LEVEL` - Logging level (INFO, DEBUG, TRACE)

## Support

- **Issues**: https://github.com/blueshed/dzql/issues
- **Examples**: See `packages/venues/` directory
- **Email**: support@blueshed.com

## License

MIT - See [LICENSE](LICENSE) file

---

**Ready to build?** Start with [GETTING_STARTED.md](packages/dzql/GETTING_STARTED.md) 🚀
