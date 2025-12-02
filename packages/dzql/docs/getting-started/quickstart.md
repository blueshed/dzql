# DZQL Quick Start (5 minutes)

The simplest way to get started with DZQL. Uses **compiled mode** which requires only ~70 lines of SQL.

## Prerequisites

- PostgreSQL (local or Docker)
- Bun 1.0+ or Node.js 18+

## 1. Install

```bash
mkdir my-app && cd my-app
bun init
bun add dzql
```

## 2. Start PostgreSQL

```bash
# Using Docker
docker run -d --name dzql-db \
  -e POSTGRES_USER=dzql \
  -e POSTGRES_PASSWORD=dzql \
  -e POSTGRES_DB=dzql \
  -p 5432:5432 \
  postgres:latest

# Set connection string
export DATABASE_URL="postgresql://dzql:dzql@localhost:5432/dzql"
```

## 3. Initialize Database

```bash
bunx dzql db:init
```

That's it - DZQL core is now installed (~70 lines of SQL).

## 4. Define Your Entities

Create `entities.sql`:

```sql
-- Schema
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE todos (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  completed BOOLEAN DEFAULT false,
  user_id INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- DZQL Entity Registrations
SELECT dzql.register_entity(
  'users',                         -- table name
  'name',                          -- label field (for lookups)
  ARRAY['name', 'email'],          -- searchable fields
  '{}'::jsonb,                     -- FK includes
  false,                           -- soft delete
  '{}'::jsonb,                     -- temporal fields
  '{}'::jsonb,                     -- notification paths
  jsonb_build_object(              -- permission paths
    'view', ARRAY['*'],            -- everyone can view
    'update', ARRAY['@id']         -- only owner can update
  )
);

SELECT dzql.register_entity(
  'todos',
  'title',
  ARRAY['title'],
  jsonb_build_object('user', 'users'),  -- Include user details
  false,
  '{}'::jsonb,
  jsonb_build_object('owner', ARRAY['user_id']),  -- Notify owner
  jsonb_build_object(
    'view', ARRAY['@user_id'],
    'create', ARRAY['*'],
    'update', ARRAY['@user_id'],
    'delete', ARRAY['@user_id']
  )
);
```

## 5. Compile

```bash
bunx dzql compile entities.sql -o init_db/
```

This generates:
- `init_db/000_dzql_core.sql` - DZQL infrastructure
- `init_db/001_schema.sql` - Your tables
- `init_db/users.sql` - User CRUD functions
- `init_db/todos.sql` - Todo CRUD functions

## 6. Apply to Database

```bash
psql $DATABASE_URL -f init_db/000_dzql_core.sql
psql $DATABASE_URL -f init_db/001_schema.sql
psql $DATABASE_URL -f init_db/users.sql
psql $DATABASE_URL -f init_db/todos.sql
```

## 7. Create Server

Create `index.js`:

```javascript
import { createServer } from 'dzql/server';

const server = createServer({
  port: 3000,
  staticDir: './public'
});

console.log('Server running at http://localhost:3000');
```

## 8. Use the API

```javascript
import { WebSocketManager } from 'dzql/client';

const ws = new WebSocketManager();
await ws.connect();

// Register user
const user = await ws.api.register_user({
  email: 'alice@example.com',
  password: 'secret123'
});

// Login
const session = await ws.api.login_user({
  email: 'alice@example.com',
  password: 'secret123'
});

// CRUD operations (auto-generated)
const todo = await ws.api.save.todos({ title: 'Buy milk' });
const todos = await ws.api.search.todos({});
await ws.api.save.todos({ id: todo.id, completed: true });
await ws.api.delete.todos({ id: todo.id });

// Real-time updates
ws.onBroadcast((method, params) => {
  console.log('Change:', method, params);
});
```

## What You Get

For each entity, DZQL generates these functions:
- `get_todos(user_id, id)` - Get by ID
- `save_todos(user_id, data)` - Create or update
- `delete_todos(user_id, id)` - Delete
- `search_todos(user_id, filters, search, sort, page, limit)` - Search
- `lookup_todos(user_id, term)` - Autocomplete

Plus:
- **Real-time updates** via PostgreSQL NOTIFY/LISTEN
- **Permission checks** enforced in SQL
- **Audit trail** in `dzql.events` table

## Comparison: Compiled vs Interpreter Mode

| Aspect | Compiled (recommended) | Interpreter |
|--------|----------------------|-------------|
| Setup | ~70 lines SQL | ~4,300 lines SQL |
| Performance | 2-4ms/operation | 8-12ms/operation |
| Debugging | Readable SQL functions | Dynamic SQL in generic_exec |
| Changes | Recompile + apply | Instant (re-register entity) |

**Compiled mode** is recommended for production and is easier to understand.

## Next Steps

- [Full Tutorial](./tutorial.md) - Complete walkthrough with working app
- [API Reference](../reference/api.md) - All available operations
- [Subscriptions](./subscriptions-quick-start.md) - Real-time denormalized documents
- [Compiler Guide](../compiler/README.md) - Advanced compilation options
