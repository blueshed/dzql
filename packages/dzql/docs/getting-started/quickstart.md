# DZQL Quick Start

Get a real-time API with automatic CRUD in 5 minutes.

## Prerequisites

- PostgreSQL (local or Docker)
- Bun or Node.js 18+

## 1. Install

```bash
mkdir my-app && cd my-app
bun init -y
bun add dzql
```

## 2. Start PostgreSQL

```bash
docker run -d --name dzql-db \
  -e POSTGRES_USER=dzql \
  -e POSTGRES_PASSWORD=dzql \
  -e POSTGRES_DB=dzql \
  -p 5432:5432 \
  postgres:latest

export DATABASE_URL="postgresql://dzql:dzql@localhost:5432/dzql"
```

## 3. Initialize Database

```bash
bunx dzql db:init
```

## 4. Define Entities

Create `entities.sql`:

```sql
-- Schema
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE todos (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  completed BOOLEAN DEFAULT false,
  user_id INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Register with DZQL
SELECT dzql.register_entity('users', 'name', ARRAY['name', 'email']);
SELECT dzql.register_entity('todos', 'title', ARRAY['title']);
```

## 5. Compile

```bash
bunx dzql compile entities.sql -o init_db/
```

## 6. Apply

```bash
psql $DATABASE_URL -f init_db/001_schema.sql
psql $DATABASE_URL -f init_db/users.sql
psql $DATABASE_URL -f init_db/todos.sql
```

## 7. Create Server

Create `index.js`:

```javascript
import { createServer } from 'dzql/server';

createServer({ port: 3000 });
console.log('Server running at http://localhost:3000');
```

## 8. Use

```javascript
import { WebSocketManager } from 'dzql/client';

const ws = new WebSocketManager();
await ws.connect();

// Auto-generated CRUD
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

For each entity:
- `get_<entity>(user_id, id)` - Get by ID
- `save_<entity>(user_id, data)` - Create or update
- `delete_<entity>(user_id, id)` - Delete
- `search_<entity>(user_id, filters, search, sort, page, limit)` - Search

Plus:
- Real-time updates via WebSocket
- Permission checks in SQL
- Audit trail in `dzql.events`

## Next Steps

- [Full Tutorial](./tutorial.md) - Complete walkthrough
- [Subscriptions](./subscriptions-quick-start.md) - Real-time denormalized documents
- [API Reference](../reference/api.md) - All operations
