# DZQL

**Build database-driven applications at the speed of thought.**

DZQL is a PostgreSQL framework that eliminates the boilerplate between your database and your application. Define your data model in SQL, and instantly get a production-ready API with real-time updates, fine-grained permissions, and zero configuration.

Perfect for AI-assisted development: you define **what** you want, your AI writes **the SQL**, and DZQL provides **the runtime**.

---

## Why DZQL?

Traditional web frameworks force you to write the same code over and over:
- Define schema → Write models → Create routes → Build resolvers → Add validation → Implement permissions → Set up WebSockets...

**DZQL gives you all of that from one function call.**

```sql
-- 1. Define your table
CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  content TEXT,
  author_id INT REFERENCES users(id)
);

-- 2. Register with DZQL
SELECT dzql.register_entity(
  'posts',                              -- table name
  'title',                              -- label field  
  array['title', 'content'],            -- searchable fields
  '{"author": "users"}'::jsonb,         -- FK includes
  true,                                 -- soft delete
  '{}'::jsonb,                          -- temporal tracking
  '{}'::jsonb,                          -- notifications
  jsonb_build_object(
    'view', array['@user_id'],          -- who can view
    'update', array['@author_id']       -- who can edit
  )
);
```

**That's it.** You now have:
- ✅ Full CRUD API: `get`, `save`, `delete`, `lookup`, `search`
- ✅ Real-time WebSocket updates to connected clients
- ✅ Row-level security enforced on every query
- ✅ Atomic transactions (no race conditions)
- ✅ Foreign key expansion (fetch related data automatically)

---

## Quick Start

### 1. Create Your Database Schema

```sql
-- init_db/001_domain.sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255)
);

CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  content TEXT,
  author_id INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Register entities with DZQL
SELECT dzql.register_entity('users', 'name', array['name', 'email'], 
  '{}'::jsonb, false, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb);

SELECT dzql.register_entity('posts', 'title', array['title', 'content'],
  '{"author": "users"}'::jsonb, true, '{}'::jsonb, '{}'::jsonb,
  jsonb_build_object('view', array['@user_id'], 'update', array['@author_id']));
```

### 2. Start Your Database

```yaml
# compose.yml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: myapp
    volumes:
      - ./node_modules/dzql/src/database/migrations:/docker-entrypoint-initdb.d/00-dzql
      - ./init_db:/docker-entrypoint-initdb.d/10-app
    ports:
      - "5432:5432"
```

```bash
docker compose up -d
```

### 3. Connect From Your Client

```javascript
import { DzqlWebSocket } from 'dzql/client';

const ws = new DzqlWebSocket('ws://localhost:8080');
await ws.connect();

// Create a post
const post = await ws.api.save.posts({
  title: 'Hello DZQL',
  content: 'This was easy!',
  author_id: 1
});

// Search posts
const results = await ws.api.search.posts({
  filters: { author_id: 1 },
  limit: 10
});

// Get with foreign key expansion
const postWithAuthor = await ws.api.get.posts({ 
  id: post.id,
  include: { author: true }
});
// Returns: { id, title, content, author: { id, name, email } }
```

**That's it!** No models, no routes, no resolvers. Just SQL and instant APIs.

---

## Core Features

### The 5 Operations

Every registered entity automatically gets:

- **`get`** - Fetch a single record by ID (with FK expansion)
- **`save`** - Create or update records (upsert with partial updates)
- **`delete`** - Remove records (hard or soft delete)
- **`lookup`** - Autocomplete/typeahead search (for dropdowns, tags)
- **`search`** - Advanced filtering, sorting, pagination

### Real-Time by Default

Every database change is automatically broadcast over WebSockets to the correct users:

```javascript
// Client A saves a post
await ws.api.save.posts({ id: 123, title: 'Updated!' });

// Client B (who has permission) receives update automatically
ws.on('posts', (event) => {
  console.log('Post changed:', event.data);
  // Automatically re-render UI
});
```

### Declarative Permissions

Row-level security defined as simple paths:

```sql
-- Only the author can update their posts
'update': array['@author_id']

-- Admins and the author can delete
'delete': array['@author_id', '@user_id->users[role=''admin''].id']

-- Members of the same organization can view
'view': array['@user_id->organizations[id=@org_id].member_ids']
```

Permissions are **enforced in PostgreSQL** on every query - there's no way to bypass them.

### Graph Rules

Automate complex workflows when data changes:

```sql
-- When a comment is created, notify the post author
on_create: {
  notify: ["@post_id->posts.author_id"]
}

-- When a user joins an org, add them to the default team
on_create: {
  create: {
    team_members: {
      team_id: "@org_id->organizations.default_team_id",
      user_id: "@user_id"
    }
  }
}
```

### Live Query Subscriptions (New in v0.2.0)

Subscribe to denormalized views that update automatically:

```sql
-- Define a subscription
SELECT dzql.register_subscription(
  'venue_detail',
  $$ SELECT v.*, 
       json_build_object('name', o.name) as org,
       json_agg(json_build_object('name', s.name)) as sites
     FROM venues v
     LEFT JOIN organizations o ON v.org_id = o.id
     LEFT JOIN sites s ON s.venue_id = v.id
     WHERE v.id = @venue_id
     GROUP BY v.id, o.id $$,
  array['venues', 'organizations', 'sites']  -- triggers
);
```

```javascript
// Client subscribes
const { data, unsubscribe } = await ws.api.subscribe_venue_detail(
  { venue_id: 123 },
  (updated) => {
    console.log('Venue data changed!', updated);
  }
);

// Any change to venues, orgs, or sites triggers automatic re-query
```

---

## Performance: Runtime vs Compiled

DZQL supports two modes:

### Runtime Mode (Default)

**Best for:** Development, rapid iteration, small-to-medium apps

Your `dzql.register_entity()` calls create wrapper functions that delegate to generic interpreters. Every request parses your entity configuration and builds SQL dynamically.

**Pros:** Zero compilation, immediate feedback  
**Cons:** ~2-3ms overhead per request

### Compiled Mode (Optional)

**Best for:** Production, performance-critical apps, large-scale deployments

The DZQL compiler reads your entity definitions and generates optimized PostgreSQL functions with all logic pre-compiled.

```bash
# Compile your entities
bun dzql compile entities/blog.sql -o init_db/

# Output: users.sql, posts.sql, comments.sql
# Each file contains optimized functions for that entity
```

**Pros:** 2-3x faster, PostgreSQL can optimize queries, debuggable with `EXPLAIN ANALYZE`  
**Cons:** Extra build step

**You can switch between modes without changing your SQL** - they're two deployment options for the same entity definitions.

---

## Project Structure

```
my-app/
├── entities/
│   └── blog.sql              ← Your domain (tables + registrations)
├── init_db/                  ← Generated SQL (if using compiler)
│   ├── 000_dzql_core.sql    ← DZQL migrations (auto-copied)
│   ├── 001_schema.sql       ← Your tables (extracted)
│   ├── users.sql            ← Compiled CRUD functions
│   └── posts.sql            ← Compiled CRUD functions
├── compose.yml              ← PostgreSQL with volume mounts
└── package.json             ← Scripts: compile, up, down
```

**Runtime workflow:**
1. Write SQL with `CREATE TABLE` + `dzql.register_entity()`
2. Mount your SQL in Docker init scripts
3. Start PostgreSQL
4. Use immediately

**Compiled workflow:**
1. Write SQL in `entities/`
2. Run `dzql compile entities/blog.sql -o init_db/`
3. Review generated SQL files
4. Mount `init_db/` in Docker init scripts
5. Start PostgreSQL with optimized functions

---

## Examples & Documentation

### For Humans (Architects)

Start here to understand DZQL concepts:

- **[Getting Started Tutorial](packages/dzql/docs/getting-started/tutorial.md)** - Step-by-step guide
- **[Documentation Hub](packages/dzql/docs/)** - Complete user guides
- **[Subscriptions Guide](packages/dzql/docs/guides/subscriptions.md)** - Real-time live queries
- **Example Apps:**
  - **[Blog](packages/blog/)** - Simple blog with users, posts, comments
  - **[Streaks](packages/streaks/)** - Social habit tracker
  - **[Venues](packages/venues/)** - Venue management system

### For AI Coders

Dense technical references for code generation:

- **[Claude Guide](packages/dzql/docs/for-ai/claude-guide.md)** - AI-assisted development guide
- **[API Reference](packages/dzql/docs/reference/api.md)** - Complete function signatures
- **[Compiler Guide](packages/dzql/docs/compiler/)** - Compilation workflow
- **[Permission DSL Grammar](docs/architecture/PERMISSIONS.md)** - Permission path syntax

---

## When to Use DZQL

### Perfect For:

- **AI-assisted development** - Define requirements, let AI write the SQL
- **CRUD-heavy applications** - Admin panels, dashboards, internal tools
- **Real-time collaboration** - Apps that need live updates
- **Complex permissions** - Row-level security with relationship-based access
- **PostgreSQL shops** - You want database-first architecture

### Not Ideal For:

- **Non-PostgreSQL databases** - DZQL is PostgreSQL-specific
- **Serverless with cold starts** - Needs persistent WebSocket connections
- **GraphQL obsessives** - DZQL has its own query language
- **Microservices architectures** - DZQL assumes a monolithic database

---

## Status & Roadmap

> 🚧 **Pre-1.0 Release** - API is stabilizing but may still change.

**Current Version:** 0.2.1

**Recently Added:**
- ✅ Live query subscriptions
- ✅ Entity compiler with optimized SQL generation
- ✅ Subscription compiler
- ✅ Graph rules improvements

**Coming Soon:**
- 🔄 Full graph rules compilation
- 🔄 Advanced search operators (ranges, arrays, full-text)
- 🔄 Migration tooling
- 🔄 TypeScript client generation

See the [Roadmap](docs/architecture/ROADMAP.md) for details.

---

## License & Contributing

- **License:** [MIT](LICENSE)
- **Issues:** [GitHub Issues](https://github.com/blueshed/dzql/issues)
- **Contributing:** [Contribution Guidelines](CONTRIBUTING.md)
- **Changelog:** [Release History](docs/releases/CHANGELOG.md)

---

**Ready to build?** Start with the [Getting Started Tutorial](packages/dzql/docs/getting-started/tutorial.md) 🚀
