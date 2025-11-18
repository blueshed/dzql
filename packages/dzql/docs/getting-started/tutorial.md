# Getting Started with DZQL - Practical Guide

DZQL is a PostgreSQL framework that gives you **atomic real-time updates** via WebSocket. Every database change broadcasts instantly to all connected clients. Zero boilerplate.

> **See also:** [API Reference](../reference/api.md) for complete API documentation | [Claude Guide](../for-ai/claude-guide.md) for AI development guide

## The Core Pattern

1. **Schema = API**: Define a table → DZQL auto-creates CRUD endpoints
2. **Atomic Updates**: Every change is one transaction, broadcasts to all clients
3. **Real-time Sync**: Listen to broadcasts, update local state, re-render
4. **No Polling**: Changes propagate instantly, no stale data

```javascript
// Listen to broadcasts
ws.onBroadcast((method, params) => {
  if (method === "todos:insert") state.todos.push(params.data)
  else if (method === "todos:update") {
    const idx = state.todos.findIndex(t => t.id === params.data.id)
    if (idx !== -1) state.todos[idx] = params.data
  }
  else if (method === "todos:delete") {
    state.todos = state.todos.filter(t => t.id !== params.data.id)
  }
  render()  // One render function, called on every change
})
```

That's the entire pattern. All clients stay in sync automatically.

## Prerequisites

- **Bun** 1.0+ (Node.js not required)
- **Docker** and **Docker Compose**
- A code editor

## Quick Start (10 minutes)

### 1. Create Project

```bash
mkdir my-dzql-app
cd my-dzql-app
bun init
bun add dzql

# Create directories
mkdir -p public init_db
```

### 2. Project Structure

```
my-dzql-app/
├── index.js                    # DZQL server
├── public/
│   ├── index.html             # HTML markup
│   ├── index.css              # Styles
│   └── app.js                 # JavaScript
├── init_db/
│   └── 001_domain.sql         # Your schema
├── compose.yml                # PostgreSQL config
├── package.json
└── app.test.ts                # Tests (optional)
```

### 3. Docker Setup

Create `compose.yml`:

```yaml
services:
  postgres:
    image: postgres:latest
    environment:
      POSTGRES_USER: dzql
      POSTGRES_PASSWORD: dzql
      POSTGRES_DB: dzql
    volumes:
      - ./node_modules/dzql/src/database/migrations/001_schema.sql:/docker-entrypoint-initdb.d/001_schema.sql:ro
      - ./node_modules/dzql/src/database/migrations/002_functions.sql:/docker-entrypoint-initdb.d/002_functions.sql:ro
      - ./node_modules/dzql/src/database/migrations/003_operations.sql:/docker-entrypoint-initdb.d/003_operations.sql:ro
      - ./node_modules/dzql/src/database/migrations/004_search.sql:/docker-entrypoint-initdb.d/004_search.sql:ro
      - ./node_modules/dzql/src/database/migrations/005_entities.sql:/docker-entrypoint-initdb.d/005_entities.sql:ro
      - ./node_modules/dzql/src/database/migrations/006_auth.sql:/docker-entrypoint-initdb.d/006_auth.sql:ro
      - ./node_modules/dzql/src/database/migrations/007_events.sql:/docker-entrypoint-initdb.d/007_events.sql:ro
      - ./node_modules/dzql/src/database/migrations/008_hello.sql:/docker-entrypoint-initdb.d/008_hello.sql:ro
      - ./node_modules/dzql/src/database/migrations/008a_meta.sql:/docker-entrypoint-initdb.d/008a_meta.sql:ro
      - ./init_db/001_domain.sql:/docker-entrypoint-initdb.d/010_domain.sql:ro
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dzql"]
      interval: 10s
      timeout: 5s
      retries: 5
```

**For monorepo projects** (like the venues example), use relative paths:
```yaml
volumes:
  - ../../dzql/src/database/migrations/001_schema.sql:/docker-entrypoint-initdb.d/001_schema.sql:ro
  # ... etc
```

Start PostgreSQL:
```bash
docker compose up -d
```

### 4. Database Schema

Create `init_db/001_domain.sql`:

```sql
CREATE TABLE IF NOT EXISTS todos (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  completed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);

SELECT dzql.register_entity(
  p_table_name := 'todos',
  p_label_field := 'title',
  p_searchable_fields := array['title', 'description']
);
```

### 5. Server

Create `index.js`:

```javascript
import { createServer } from "dzql";
import index from "./public/index.html";

const server = createServer({
  port: process.env.PORT || 3000,
  routes: {
    "/": index,
  },
});

console.log(`🚀 DZQL Server running on http://localhost:${server.port}`);
```

### 6. HTML

Create `public/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DZQL Todo App</title>
    <link rel="stylesheet" href="./index.css" />
  </head>
  <body>
    <div class="container">
      <h1>✓ Todo App</h1>
      <div id="status" class="status disconnected">Connecting...</div>
      <div id="error" class="error hidden"></div>

      <div id="authSection" class="section">
        <h2>Login or Register</h2>
        <form id="authForm" onsubmit="handleLoginSubmit(event)">
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="email" placeholder="user@example.com" required />
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="password" placeholder="••••••••" required />
          </div>
          <div class="btn-group">
            <button type="submit" class="btn-primary">Login</button>
            <button type="button" class="btn-secondary" onclick="handleRegister()">Register</button>
          </div>
        </form>
      </div>

      <div id="appSection" class="section hidden">
        <button class="btn-secondary" style="width: 100%; margin-bottom: 20px" onclick="handleLogout()">
          Logout
        </button>

        <div class="section">
          <h2>Create Todo</h2>
          <form id="todoForm" onsubmit="event.preventDefault(); handleAddTodo()">
            <div class="form-group">
              <label>Title</label>
              <input type="text" id="todoTitle" placeholder="What needs to be done?" required />
            </div>
            <div class="form-group">
              <label>Description</label>
              <textarea id="todoDescription" placeholder="Add details..." rows="2"></textarea>
            </div>
            <button type="submit" class="btn-primary" style="width: 100%">Add Todo</button>
          </form>
        </div>

        <div class="section">
          <h2>Todos</h2>
          <div id="todoList" class="todo-list"></div>
          <div id="emptyState" class="empty-state">No todos yet</div>
        </div>
      </div>
    </div>

    <script type="module" src="./app.js"></script>
  </body>
</html>
```

### 7. CSS

Create `public/index.css`:

```css
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #f5f5f5;
  padding: 20px;
}

.container {
  max-width: 600px;
  margin: 0 auto;
  background: white;
  padding: 30px;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

h1 {
  margin-bottom: 20px;
  color: #333;
}

.status {
  padding: 10px;
  border-radius: 4px;
  margin-bottom: 20px;
  font-weight: 500;
}

.status.connected {
  background: #d4edda;
  color: #155724;
}

.status.disconnected {
  background: #f8d7da;
  color: #721c24;
}

.error {
  padding: 10px;
  background: #f8d7da;
  color: #721c24;
  border-radius: 4px;
  margin-bottom: 20px;
}

.hidden {
  display: none;
}

.section {
  margin-bottom: 30px;
}

.form-group {
  margin-bottom: 15px;
}

.form-group label {
  display: block;
  margin-bottom: 5px;
  font-weight: 500;
  color: #333;
}

.form-group input,
.form-group textarea {
  width: 100%;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.btn-group {
  display: flex;
  gap: 10px;
}

button {
  padding: 10px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-primary {
  background: #007bff;
  color: white;
  flex: 1;
}

.btn-primary:hover {
  background: #0056b3;
}

.btn-secondary {
  background: #6c757d;
  color: white;
  flex: 1;
}

.btn-secondary:hover {
  background: #545b62;
}

.btn-danger {
  background: #dc3545;
  color: white;
  padding: 5px 10px;
  font-size: 12px;
}

.btn-danger:hover {
  background: #c82333;
}

.todo-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.todo-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 15px;
  background: #f8f9fa;
  border-radius: 4px;
  border: 1px solid #e9ecef;
}

.todo-item.completed {
  opacity: 0.6;
}

.todo-item.completed .todo-title {
  text-decoration: line-through;
}

.todo-checkbox {
  width: 20px;
  height: 20px;
  cursor: pointer;
}

.todo-content {
  flex: 1;
}

.todo-title {
  font-weight: 500;
  margin-bottom: 5px;
}

.todo-description {
  font-size: 14px;
  color: #666;
}

.empty-state {
  text-align: center;
  color: #999;
  padding: 40px;
  font-style: italic;
}
```

### 8. JavaScript

Create `public/app.js`:

```javascript
import { WebSocketManager } from "dzql/client";

let ws = null;
let state = {
  connected: false,
  loggedIn: false,
  userId: null,
  todos: [],
};

function query(selector) {
  return document.getElementById(selector);
}

function render() {
  const status = query("status");
  status.textContent = state.connected
    ? state.loggedIn
      ? "✓ Connected"
      : "✓ Connected (not logged in)"
    : "✗ Disconnected";
  status.className = `status ${state.connected ? "connected" : "disconnected"}`;

  query("authSection").classList.toggle("hidden", state.loggedIn);
  query("appSection").classList.toggle("hidden", !state.loggedIn);

  if (state.loggedIn) {
    const list = query("todoList");
    const empty = query("emptyState");

    if (state.todos.length === 0) {
      list.innerHTML = "";
      empty.classList.remove("hidden");
    } else {
      empty.classList.add("hidden");
      list.innerHTML = state.todos
        .map(
          (todo) => `
        <div class="todo-item ${todo.completed ? "completed" : ""}">
          <input type="checkbox" class="todo-checkbox" ${todo.completed ? "checked" : ""}
            onchange="handleToggleTodo(${todo.id})">
          <div class="todo-content">
            <div class="todo-title">${escapeHtml(todo.title)}</div>
            ${todo.description ? `<div class="todo-description">${escapeHtml(todo.description)}</div>` : ""}
          </div>
          <button class="btn-danger" onclick="handleDeleteTodo(${todo.id})">Delete</button>
        </div>
      `,
        )
        .join("");
    }
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function error(msg) {
  const el = query("error");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 5000);
}

async function auth(type) {
  const email = query("email").value;
  const password = query("password").value;

  if (!email || !password) {
    error("Email and password required");
    return;
  }

  try {
    const result = await ws.api[type]({ email, password });
    if (result.token) {
      localStorage.setItem("dzql_token", result.token);
      state.loggedIn = true;
      state.userId = result.user_id;
      await loadTodos();
      render();
    }
  } catch (err) {
    error(err.message || `${type} failed`);
  }
}

async function loadTodos() {
  try {
    const result = await ws.api.search.todos({
      filters: { user_id: state.userId },
      limit: 100,
    });
    state.todos = result.data || [];
  } catch (err) {
    error("Failed to load todos");
    throw err;
  }
}

async function handleAddTodo() {
  const title = query("todoTitle").value.trim();
  const description = query("todoDescription").value.trim();

  if (!title) {
    error("Title required");
    return;
  }

  try {
    await ws.api.save.todos({
      user_id: state.userId,
      title,
      description,
      completed: false,
    });
    query("todoTitle").value = "";
    query("todoDescription").value = "";
  } catch (err) {
    error("Failed to create todo");
  }
}

async function handleToggleTodo(id) {
  try {
    const todo = state.todos.find((t) => t.id === id);
    if (todo) {
      await ws.api.save.todos({
        id,
        user_id: state.userId,
        completed: !todo.completed,
      });
    }
  } catch (err) {
    error("Failed to update todo");
  }
}

async function handleDeleteTodo(id) {
  if (!confirm("Delete this todo?")) return;
  try {
    await ws.api.delete.todos({ id });
  } catch (err) {
    error("Failed to delete todo");
  }
}

async function init() {
  try {
    ws = new WebSocketManager();
    await ws.connect();
    state.connected = true;

    ws.onBroadcast((method, params) => {
      if (!state.loggedIn) return;

      const data = params.data;
      if (method === "todos:insert") {
        state.todos.push(data);
      } else if (method === "todos:update") {
        const idx = state.todos.findIndex((t) => t.id === data.id);
        if (idx !== -1) state.todos[idx] = data;
      } else if (method === "todos:delete") {
        state.todos = state.todos.filter((t) => t.id !== data.id);
      }
      render();
    });

    const token = localStorage.getItem("dzql_token");
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        state.userId = payload.user_id;
        await loadTodos();
        state.loggedIn = true;
      } catch (err) {
        localStorage.removeItem("dzql_token");
        state.loggedIn = false;
        state.userId = null;
      }
    }

    render();
  } catch (err) {
    state.connected = false;
    error("Failed to connect");
    render();
  }
}

window.handleAddTodo = handleAddTodo;
window.handleToggleTodo = handleToggleTodo;
window.handleDeleteTodo = handleDeleteTodo;
window.handleLoginSubmit = (e) => {
  e.preventDefault();
  auth("login_user");
};
window.handleRegister = () => auth("register_user");
window.handleLogout = async () => {
  try {
    await ws.api.logout();
    localStorage.removeItem("dzql_token");
    state.loggedIn = false;
    state.userId = null;
    state.todos = [];
    render();
  } catch (err) {
    error("Logout failed");
  }
};

init();
```

### 9. Package.json

```json
{
  "name": "dzql-todo-app",
  "module": "index.js",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "bun --hot index.js",
    "start": "bun index.js",
    "db:up": "docker compose up -d",
    "db:down": "docker compose down",
    "test": "playwright test"
  },
  "dependencies": {
    "dzql": "latest"
  },
  "devDependencies": {
    "@playwright/test": "^1.56.1",
    "@types/bun": "latest"
  }
}
```

## Run

```bash
# Start database
bun run db:up

# Start server (with hot reload)
bun run dev

# In another terminal, run tests (optional)
bun run test
```

Access at `http://localhost:3000`

## Testing with Playwright

Install Playwright:
```bash
bun add -d @playwright/test
bunx playwright install
```

Create `app.test.ts`:
```typescript
import { test, expect } from "@playwright/test";

test("register and create todo", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.waitForLoadState("networkidle");
  
  // Register
  await page.locator("#email").fill(`test-${Date.now()}@example.com`);
  await page.locator("#password").fill("testpass123");
  await page.locator("button:has-text('Register')").click();
  await page.waitForLoadState("networkidle");
  
  // Create todo
  await page.locator("#todoTitle").fill("Buy milk");
  await page.locator("button:has-text('Add Todo')").click();
  await expect(page.locator(".todo-title:has-text('Buy milk')")).toBeVisible();
});
```

Run tests:
```bash
bunx playwright test --headed  # see browser
bunx playwright test           # headless
```

**Testing Tips:**
- Use unique emails per test: `test-${Date.now()}@example.com`
- Wait for network: `await page.waitForLoadState("networkidle")`
- Find elements by id, class, or text: `locator("#id")`, `locator(".class")`, `locator("button:has-text('text')")`

## Key Architecture

### Atomic Updates & Real-time Sync

When user A saves a todo, it:
1. Updates database atomically
2. Broadcasts to all connected clients instantly
3. All users see the change immediately

```javascript
ws.onBroadcast((method, params) => {
  const data = params.data;
  if (method === "todos:insert") {
    state.todos.push(data);     // Add new
  } else if (method === "todos:update") {
    const idx = state.todos.findIndex(t => t.id === data.id);
    if (idx !== -1) state.todos[idx] = data;  // Replace
  } else if (method === "todos:delete") {
    state.todos = state.todos.filter(t => t.id !== data.id);  // Remove
  }
  render();  // Re-render UI with new state
});
```

That's it. Every user creating/updating/deleting a todo sees it **instantly** on all other clients. No polling, no re-fetching, no race conditions.

### State Management
- `state.connected` - WebSocket status
- `state.loggedIn` - Authentication status
- `state.userId` - Current user (from JWT on reload)
- `state.todos` - User's todos array

### Authentication Flow
1. User registers/logs in
2. Server returns token + user_id
3. Token stored in localStorage
4. On page reload, JWT decoded to get user_id
5. Todos loaded with user filter

### Single Render Function
- `render()` handles ALL UI updates
- Called after every state change
- Also called on every broadcast update
- No separate update functions needed

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

Before DZQL can work with a table, you must register it with `dzql.register_entity()`.

**Important:** This function is provided by DZQL's core migrations, which run automatically when PostgreSQL starts via compose.yml.

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

Add custom functions that work alongside DZQL operations.

### PostgreSQL Functions

Create stored procedures that execute server-side:

```sql
CREATE OR REPLACE FUNCTION my_function(
  p_user_id INT,
  p_name TEXT DEFAULT 'World'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Your logic here
  RETURN jsonb_build_object('message', 'Hello, ' || p_name);
END;
$$;
```

Call from client:
```javascript
const result = await ws.api.my_function({ name: 'World' });
// Returns: { message: 'Hello, World' }
```

### Bun Functions

Create JavaScript functions that run in the Bun server:

```javascript
// server/api.js
export async function myBunFunction(userId, params = {}) {
  const { name = 'World' } = params;
  
  // Can use db.api for database access
  // const user = await db.api.get.users({ id: userId }, userId);
  
  return {
    message: `Hello, ${name}!`,
    user_id: userId
  };
}
```

Pass to server:
```javascript
import { createServer } from 'dzql';
import * as customApi from './server/api.js';

const server = createServer({
  port: 3000,
  customApi
});
```

Call from client:
```javascript
const result = await ws.api.myBunFunction({ name: 'World' });
```

**Both types:**
- First parameter is always `user_id` (auto-injected on client)
- Require authentication
- Use same proxy API syntax
- Return JSON-serializable data

### Advanced Server Setup

For routes that need real-time broadcasting:

```javascript
import { createServer } from 'dzql';

const server = createServer({
  port: 3000,
  
  // Static routes (don't need broadcast)
  routes: {
    '/health': () => new Response('OK'),
    '/': () => new Response('Hello')
  },
  
  // Routes that need broadcasting
  onReady: async (broadcast) => {
    // broadcast(method, params) - send to all clients
    
    return {
      '/custom': async (req) => {
        // Your logic
        broadcast('custom:event', { data: 'something' });
        return new Response('Done');
      }
    };
  }
});
```

## Real-time Events

DZQL broadcasts changes in real-time via WebSocket:

```javascript
// Listen for all events
const unsubscribe = ws.onBroadcast((method, params) => {
  console.log(`Event: ${method}`, params);
  // method: "users:insert", "users:update", "users:delete"
  // params: { table, op, pk, before, after, user_id, at }
});

// Stop listening
unsubscribe();
```

Event format:
- `method`: `"{table}:{operation}"` (e.g., "todos:insert")
- `params.data`: The affected record
- `params.user_id`: User who made the change
- `params.at`: Timestamp

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

## Server-Side API Usage

For backend/Bun scripts:

```javascript
import { db, sql } from 'dzql';

// Direct SQL queries
const users = await sql`SELECT * FROM users`;

// DZQL operations (require explicit userId)
const user = await db.api.get.users({ id: 1 }, userId);
const saved = await db.api.save.users({ name: 'John' }, userId);
const results = await db.api.search.users({ filters: {} }, userId);
```

**Key difference:** Server-side requires explicit `userId` as second parameter; client-side auto-injects from JWT.

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

## Troubleshooting

### Database won't connect
```bash
# Check if PostgreSQL is running
docker ps

# Check logs
docker compose logs postgres

# Restart database (fresh start)
docker compose down -v && docker compose up -d
```

### WebSocket connection fails
- Ensure server is running: `http://localhost:3000`
- Check firewall for port 3000
- Check browser console for errors
- Verify WebSocket URL in client code

### Entity not found errors
- Verify table is created in database
- Verify entity is registered with `dzql.register_entity()`
- Check `p_table_name` matches table name exactly
- Check migrations ran: `docker compose logs postgres`

### Permission denied errors
- Implement permission rules in your entity registration
- Check user authentication status
- Verify user_id is being passed correctly
- See venues example for permission path syntax

### Migrations not running
- Check volume mounts in compose.yml
- Ensure migration files exist in node_modules/dzql/
- Check PostgreSQL logs: `docker compose logs postgres`
- Try fresh start: `docker compose down -v && docker compose up -d`

### Real-time updates not working
- Verify `onBroadcast` handler is set up
- Check WebSocket connection status
- Check browser console for errors
- Verify entity is registered (triggers events)

## DRY Principles Used

- **Single `auth()` function** handles both login and register
- **Single `render()` function** handles all UI updates
- **`query()` helper** replaces repeated `getElementById()`
- **Broadcast handler** calls `render()` once instead of separate functions
- **Combined error handling** with reusable `error()` function

## Key Takeaways for Claude

When building with DZQL:
1. **Schema first** - Table definition automatically gives you API
2. **Broadcasts = Real-time** - Listen to `entity:insert/update/delete` events
3. **One render function** - Update state, call render(), DOM updates
4. **User ID filtering** - Always pass `user_id` in queries and mutations
5. **Token from JWT** - Decode on init: `JSON.parse(atob(token.split(".")[1]))`
6. **DRY helpers** - Use `query()` for DOM, combine auth logic, single error handler
7. **Index pattern** - `const idx = state.todos.findIndex(t => t.id === data.id)` for updates

The app should feel simple. If it feels complex, something is wrong.

## Next Steps

1. **Read the full documentation**: Check the framework's README and CLAUDE.md
2. **Explore graph rules**: Add automation with `p_graph_rules`
3. **Implement permissions**: Use path-based access control
4. **Add notifications**: Set up `p_notification_path` for real-time updates
5. **Build your UI**: Connect to any frontend framework (React, Vue, Svelte, etc.)
6. **Study the venues example**: See a complete multi-entity application

## Support

- **GitHub**: https://github.com/blueshed/dzql
- **Issues**: https://github.com/blueshed/dzql/issues
- **Documentation**: See README.md and CLAUDE.md in the package

Happy building! 🚀
