# Getting Started with DZQL

DZQL is a PostgreSQL-powered framework that provides automatic CRUD operations via WebSocket RPC with zero boilerplate. This guide walks you through setting up your first DZQL project.

## Prerequisites

- **Bun** 1.0+ (Node.js not required!)
- **Docker** and **Docker Compose** (for PostgreSQL)
- A code editor

## Quick Start (5 minutes)

### 1. Create a New Project

```bash
mkdir my-dzql-app
cd my-dzql-app
bun init
```

### 2. Install DZQL

```bash
bun add dzql
```

### 3. Set Up PostgreSQL with Docker

Create a `docker-compose.yml`:

**For standalone projects (using npm/bun):**
```yaml
services:
  postgres:
    image: postgres:latest
    environment:
      POSTGRES_USER: dzql
      POSTGRES_PASSWORD: dzql
      POSTGRES_DB: dzql
    volumes:
      # DZQL Core System migrations
      - node_modules/dzql/src/database/migrations/001_schema.sql:/docker-entrypoint-initdb.d/001_schema.sql:ro
      - node_modules/dzql/src/database/migrations/002_functions.sql:/docker-entrypoint-initdb.d/002_functions.sql:ro
      - node_modules/dzql/src/database/migrations/003_operations.sql:/docker-entrypoint-initdb.d/003_operations.sql:ro
      - node_modules/dzql/src/database/migrations/004_search.sql:/docker-entrypoint-initdb.d/004_search.sql:ro
      - node_modules/dzql/src/database/migrations/005_entities.sql:/docker-entrypoint-initdb.d/005_entities.sql:ro
      - node_modules/dzql/src/database/migrations/006_auth.sql:/docker-entrypoint-initdb.d/006_auth.sql:ro
      - node_modules/dzql/src/database/migrations/007_events.sql:/docker-entrypoint-initdb.d/007_events.sql:ro
      - node_modules/dzql/src/database/migrations/008_hello.sql:/docker-entrypoint-initdb.d/008_hello.sql:ro
      - node_modules/dzql/src/database/migrations/008a_meta.sql:/docker-entrypoint-initdb.d/008a_meta.sql:ro
      # Your domain-specific migrations
      - ./init_db:/docker-entrypoint-initdb.d/init_db:ro
    ports:
      - "5432:5432"
```

**For monorepo projects (like the venues example):**
```yaml
services:
  postgres:
    image: postgres:latest
    environment:
      POSTGRES_USER: dzql
      POSTGRES_PASSWORD: dzql
      POSTGRES_DB: dzql
    volumes:
      # DZQL Core System migrations (relative path from monorepo root)
      - ../../dzql/src/database/migrations/001_schema.sql:/docker-entrypoint-initdb.d/001_schema.sql:ro
      - ../../dzql/src/database/migrations/002_functions.sql:/docker-entrypoint-initdb.d/002_functions.sql:ro
      - ../../dzql/src/database/migrations/003_operations.sql:/docker-entrypoint-initdb.d/003_operations.sql:ro
      - ../../dzql/src/database/migrations/004_search.sql:/docker-entrypoint-initdb.d/004_search.sql:ro
      - ../../dzql/src/database/migrations/005_entities.sql:/docker-entrypoint-initdb.d/005_entities.sql:ro
      - ../../dzql/src/database/migrations/006_auth.sql:/docker-entrypoint-initdb.d/006_auth.sql:ro
      - ../../dzql/src/database/migrations/007_events.sql:/docker-entrypoint-initdb.d/007_events.sql:ro
      - ../../dzql/src/database/migrations/008_hello.sql:/docker-entrypoint-initdb.d/008_hello.sql:ro
      - ../../dzql/src/database/migrations/008a_meta.sql:/docker-entrypoint-initdb.d/008a_meta.sql:ro
      # Your domain-specific migrations
      - ./init_db:/docker-entrypoint-initdb.d/init_db:ro
    ports:
      - "5432:5432"
```

Start PostgreSQL:

```bash
docker compose up -d
```

### 4. Initialize Database

The docker-compose.yml automatically runs DZQL core migrations from `node_modules/dzql/src/database/migrations/`.

Create your domain-specific migrations in `database/init_db/001_domain.sql`:

```sql
-- Create your tables (after DZQL core is set up)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Register your entities with DZQL
SELECT dzql.register_entity(
  p_table_name := 'users',
  p_label_field := 'name',
  p_searchable_fields := array['name', 'email'],
  p_fk_includes := '{}'::jsonb
);
```

**Important:** Your migrations run AFTER the DZQL core migrations, so entity registration functions are available.

Start PostgreSQL:

```bash
docker compose up -d
```

The Docker Compose file will automatically run all DZQL core migrations first, then your domain migrations.

### 5. Create Your Server

Create `server/index.js`:

```javascript
import { createServer } from 'dzql';

const server = createServer({
  port: process.env.PORT || 3000,
  
  // Optional: static routes (don't need broadcast function)
  routes: {
    '/health': () => new Response('OK')
  },
  
  // Optional: custom API functions
  customApi: {},
  
  // Optional: routes that need real-time broadcasting
  onReady: async (broadcast) => {
    // The onReady callback receives the broadcast function
    // Use it to set up routes that need to broadcast to clients
    return {
      // Example: add your advanced routes here
      '/custom': (req) => new Response('Custom handler')
    };
  }
});

console.log(`🚀 Server running on port ${server.port}`);
```

### 6. Start Your Server

```bash
bun server/index.js
```

Your DZQL server is now running at `ws://localhost:3000/ws`!

## Project Setup: Standalone vs Monorepo

### Standalone Project (Recommended for Most Users)
Use `node_modules/dzql/src/database/migrations/` paths in your docker-compose.yml

```
my-app/
├── database/
│   ├── docker-compose.yml    # Uses node_modules paths
│   └── init_db/
│       └── 001_domain.sql
├── server/
├── client/
└── package.json
```

### Monorepo Project (Like the Venues Example)
Use relative paths `../../dzql/src/database/migrations/` in docker-compose.yml

```
monorepo/
├── packages/
│   ├── dzql/                 # Framework package
│   │   └── src/database/migrations/  # Core migrations
│   └── my-app/               # Your app
│       ├── database/
│       │   └── docker-compose.yml   # References ../../dzql/...
│       ├── server/
│       └── package.json
```

## Using DZQL in Your Client

### Browser/Frontend

```javascript
import { useWs, WebSocketManager } from 'dzql/client';

// Create a fresh WebSocket connection
const ws = new WebSocketManager();

// Connect to server
await ws.connect();

// Login
const result = await ws.api.login_user({
  email: 'user@example.com',
  password: 'password123'
});

// Use DZQL operations - all 5 operations work the same way:
// GET, SAVE, DELETE, LOOKUP, SEARCH

// GET - Retrieve a single record
const user = await ws.api.get.users({ id: 1 });

// SAVE - Create or update (upsert)
const newUser = await ws.api.save.users({
  name: 'John Doe',
  email: 'john@example.com'
});

// LOOKUP - Autocomplete/suggestions
const suggestions = await ws.api.lookup.users({
  p_filter: 'john'
});

// SEARCH - Full search with filters and pagination
const results = await ws.api.search.users({
  filters: {
    name: { ilike: '%john%' },
    email: 'john@example.com'
  },
  page: 1,
  limit: 10
});

// DELETE - Remove a record
const deleted = await ws.api.delete.users({ id: 1 });

// When done
ws.cleanDisconnect();
```

### Bun/Backend

```javascript
import { db, sql } from 'dzql';

// Direct database queries
const users = await sql`SELECT * FROM users`;

// DZQL operations (require userId)
const user = await db.api.get.users({ id: 1 }, userId);
const saved = await db.api.save.users({ name: 'John' }, userId);
const searched = await db.api.search.users({ filters: {} }, userId);
```

## Project Structure

A typical DZQL project looks like:

```
my-dzql-app/
├── server/
│   ├── index.js           # Server entry point
│   └── api.js             # Custom API functions (optional)
├── database/
│   └── init_db/
│       ├── 001_domain.sql # Your schema & entity registration
│       └── 002_seed.sql   # Sample data (optional)
├── public/                # Static files (optional)
│   └── index.html
├── docker-compose.yml
├── bunfig.toml            # Bun config (optional)
└── package.json
```

## The 5 DZQL Operations

Every registered entity automatically gets these 5 operations:

### 1. GET - Single Record
```javascript
const record = await ws.api.get.tableName({ id: 1 });
// Throws "record not found" error if not exists
```

### 2. SAVE - Upsert
```javascript
const record = await ws.api.save.tableName({
  id: 1,              // Optional - omit for insert
  name: 'Updated'
});
```

### 3. DELETE - Remove Record
```javascript
const deleted = await ws.api.delete.tableName({ id: 1 });
```

### 4. LOOKUP - Autocomplete
```javascript
const options = await ws.api.lookup.tableName({
  p_filter: 'search term'
});
// Returns: [{ label: 'Display Name', value: 1 }, ...]
```

### 5. SEARCH - Advanced Search
```javascript
const results = await ws.api.search.tableName({
  filters: {
    name: { ilike: '%john%' },
    age: { gte: 18 },
    city: ['NYC', 'LA'],
    active: true
  },
  sort: { field: 'name', order: 'asc' },
  page: 1,
  limit: 25
});
// Returns: { data: [...], total: 100, page: 1, limit: 25 }
```

## Entity Registration

Before DZQL can work with a table, you must register it with the `dzql.register_entity()` function.

**Important:** This function is provided by DZQL's core migrations, which run automatically when PostgreSQL starts via docker-compose.

```sql
SELECT dzql.register_entity(
  p_table_name := 'venues',                        -- Your table name
  p_label_field := 'name',                         -- Used by LOOKUP
  p_searchable_fields := array['name', 'address'], -- Used by SEARCH
  p_fk_includes := '{"org": "organisations"}'::jsonb, -- Dereference FKs
  p_graph_rules := '{}'::jsonb                     -- Optional: automation
);
```

**Parameters:**
- `p_table_name`: Your PostgreSQL table name
- `p_label_field`: Which field to use for display (LOOKUP)
- `p_searchable_fields`: Fields searchable by SEARCH
- `p_fk_includes`: Foreign keys to auto-dereference (optional)
- `p_graph_rules`: Graph rules for automation (optional)

See the [venues example](https://github.com/blueshed/dzql/blob/main/packages/venues/database/init_db/009_venues_domain.sql) for a complete schema with multiple entity registrations.

## Custom API Functions

Add custom functions that work alongside DZQL operations:

**PostgreSQL Function:**
```sql
CREATE OR REPLACE FUNCTION my_function(
  p_user_id INT,
  p_name TEXT
) RETURNS TABLE (message TEXT) AS $$
BEGIN
  RETURN QUERY SELECT 'Hello, ' || p_name;
END;
$$ LANGUAGE plpgsql;
```

**Call from Client:**
```javascript
const result = await ws.api.my_function({ name: 'World' });
// Returns: { message: 'Hello, World' }
```

**Bun Function:**
```javascript
// server/api.js
export async function my_function(userId, params = {}) {
  return {
    message: `Hello, ${params.name}!`,
    user_id: userId
  };
}
```

Then pass it to createServer:
```javascript
const customApi = await import('./api.js');
const server = createServer({
  customApi
});
```

## Real-time Events

DZQL broadcasts changes in real-time via WebSocket:

```javascript
// Listen for all events
const unsubscribe = ws.onBroadcast((method, params) => {
  console.log(`Event: ${method}`, params);
  // method: "users:insert", "users:update", "users:delete"
});

// Stop listening
unsubscribe();
```

## Authentication

DZQL provides built-in user authentication:

```javascript
// Register
const result = await ws.api.register_user({
  email: 'user@example.com',
  password: 'secure-password'
});

// Login
const result = await ws.api.login_user({
  email: 'user@example.com',
  password: 'secure-password'
});
// Returns: { token, profile, user_id }

// Logout
await ws.api.logout();

// Save token for auto-login
localStorage.setItem('dzql_token', result.token);

// Auto-connect with token
const ws = new WebSocketManager();
await ws.connect();  // Automatically uses token from localStorage
```

## Error Handling

```javascript
try {
  const user = await ws.api.get.users({ id: 999 });
} catch (error) {
  console.error(error.message);
  // "record not found" - record doesn't exist
  // "Permission denied: view on users" - access denied
  // "Function not found" - custom function doesn't exist
}
```

## Environment Variables

```bash
# Server
PORT=3000
DATABASE_URL=postgresql://dzql:dzql@localhost:5432/dzql
NODE_ENV=development
LOG_LEVEL=INFO

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# WebSocket
WS_PING_INTERVAL=30000
WS_PING_TIMEOUT=5000
```

## Running Tests

```bash
bun test tests/
```

## Troubleshooting

### Database won't connect
```bash
# Check if PostgreSQL is running
docker ps
# Check logs
docker compose logs postgres
# Restart
docker compose down -v && docker compose up -d
```

### WebSocket connection fails
- Ensure server is running: `http://localhost:3000`
- Check firewall for port 3000
- Check browser console for errors

### Entity not found errors
- Verify table is created in database
- Verify entity is registered with `dzql.register_entity()`
- Check `p_table_name` matches exactly

### Permission denied errors
- Implement permission rules in your entity registration
- Check user authentication status
- Verify user_id is being passed correctly

## Next Steps

1. **Read the full documentation**: Check the framework's README
2. **Explore graph rules**: Add automation with `p_graph_rules`
3. **Implement permissions**: Use path-based access control
4. **Add notifications**: Set up `p_notification_path` for real-time updates
5. **Build your UI**: Connect to any frontend framework (React, Vue, Svelte, etc.)

## Example: Complete Todo App

**Database Setup:**
```sql
CREATE TABLE todos (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT dzql.register_entity(
  'todos',
  'title',
  array['title'],
  '{"user": "users"}'::jsonb
);
```

**Server:**
```javascript
import { createServer } from 'dzql';

const server = createServer({
  port: 3000
});
```

**Client:**
```javascript
const ws = new WebSocketManager();
await ws.connect();
await ws.api.login_user({ email: 'user@example.com', password: 'pass' });

// Create todo
const todo = await ws.api.save.todos({
  title: 'Learn DZQL',
  completed: false
});

// Get all todos
const results = await ws.api.search.todos({
  filters: { completed: false },
  limit: 100
});

// Update todo
await ws.api.save.todos({
  id: todo.id,
  completed: true
});

// Delete todo
await ws.api.delete.todos({ id: todo.id });
```

## Support

- **GitHub**: https://github.com/blueshed/dzql
- **Issues**: https://github.com/blueshed/dzql/issues
- **Documentation**: See README.md in the package

Happy building! 🚀