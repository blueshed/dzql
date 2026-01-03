# DZQL Project Setup Guide

Complete guide for setting up a Vue/Pinia client project with DZQL.

## Quick Start

The fastest way to get started is with `bun create`:

```bash
bun create dzql my-app
cd my-app
bun install
bun run db:rebuild
bun run dev
```

This creates a full-stack app with the structure described below.

## Manual Setup

If you prefer to set up manually:

## Project Structure

```
my-app/
├── package.json          # Workspaces root
├── bun.lock              # Single lockfile
├── domain.js             # DZQL domain definition
├── .env                  # Environment variables
├── compose.yml           # PostgreSQL for development
├── generated/            # DO NOT EDIT - compiled output
│   ├── client/           # WebSocket client, Pinia stores, types
│   ├── db/migrations/    # PostgreSQL schema
│   └── runtime/          # Server manifest
├── src/                  # Vue client workspace
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.app.json
│   └── src/
│       ├── main.ts
│       ├── App.vue
│       ├── composables/
│       ├── components/
│       └── views/
└── server/               # DZQL server workspace
    ├── package.json
    └── index.ts
```

## 1. Bun Workspaces

Root `package.json`:

```json
{
  "name": "my-app",
  "private": true,
  "workspaces": ["src", "server"],
  "scripts": {
    "compile": "bunx dzql domain.js -o generated",
    "db": "docker compose down -v && docker compose up -d",
    "logs": "docker compose logs -f",
    "dev": "concurrently -n server,client -c blue,green \"bun run --filter @my-app/server dev\" \"bun run --filter @my-app/client dev\""
  },
  "devDependencies": {
    "concurrently": "^9.2.1",
    "dzql": "^0.6.0"
  }
}
```

Client `src/package.json`:

```json
{
  "name": "@my-app/client",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "pinia": "^3.0.4",
    "vue": "^3.5.25",
    "vue-router": "^4.6.3"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^6.0.2",
    "vite": "^7.2.4",
    "typescript": "~5.9.0"
  }
}
```

Server `server/package.json`:

```json
{
  "name": "@my-app/server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "cd .. && bun run server/index.ts"
  },
  "dependencies": {
    "dzql": "^0.6.0"
  }
}
```

**Important:** The server script uses `cd ..` to run from the project root so that:
- `.env` is found (dotenv loads from `process.cwd()`)
- `MANIFEST_PATH=./generated/runtime/manifest.json` resolves correctly

Server `server/index.ts`:

```typescript
import { createServer } from "dzql";

const server = createServer({
  port: process.env.PORT || 3000,
});

console.log(`DZQL Server running on port ${server.port}`);
```

## 2. Docker Compose for PostgreSQL

`compose.yml`:

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: myapp
      POSTGRES_DB: myapp
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./generated/db/migrations:/docker-entrypoint-initdb.d:ro

volumes:
  pgdata:
```

**Key:** Mount `generated/db/migrations` to `/docker-entrypoint-initdb.d` for automatic schema initialization on first run.

## 3. Environment Variables

`.env`:

```
# Database
DATABASE_URL=postgres://myapp:myapp@localhost:5432/myapp

# Server
PORT=3000
MANIFEST_PATH=./generated/runtime/manifest.json
JWT_SECRET=dev-secret-change-in-production

# Client (Vite)
VITE_DZQL_TOKEN_NAME=myapp_token
```

## 4. Vite Configuration

`src/vite.config.ts`:

```typescript
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@generated': fileURLToPath(new URL('../generated', import.meta.url)),
    },
  },
  server: {
    // Allow external access (for Docker-based tools like Playwright MCP)
    host: '0.0.0.0',
    allowedHosts: ['host.docker.internal'],
    
    // Proxy WebSocket to DZQL server
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
})
```

**Configuration explained:**

- `host: '0.0.0.0'` - Binds to all interfaces, required for Docker access
- `allowedHosts: ['host.docker.internal']` - Allows Playwright MCP (running in Docker) to connect
- `proxy: { '/ws': ... }` - Client connects to `/ws` on Vite's port, proxied to DZQL server on port 3000

**For Playwright MCP testing:** Navigate to `http://host.docker.internal:5173`

## 5. TypeScript Path Aliases

`src/tsconfig.app.json`:

```json
{
  "extends": "@vue/tsconfig/tsconfig.dom.json",
  "include": ["env.d.ts", "src/**/*", "src/**/*.vue"],
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "@generated/*": ["../generated/*"]
    }
  }
}
```

## 6. Authentication Composable

`src/src/composables/useDzql.ts`:

```typescript
import { ref } from 'vue'
import { ws } from '@generated/client/ws'

const ready = ref(false)
const user = ref<any>(null)
const connectionError = ref<string | null>(null)

export function useDzql() {
  async function connect(url?: string) {
    try {
      connectionError.value = null
      ready.value = false

      await ws.connect(url || '/ws')
      ready.value = true
    } catch (e: any) {
      connectionError.value = e.message
      throw e
    }
  }

  async function login(email: string, password: string) {
    const result = await ws.api.login_user({ email, password }) as any
    if (result?.user_id) {
      user.value = result
      if (result.token) {
        localStorage.setItem('dzql_token', result.token)
      }
    }
    return result
  }

  async function register(name: string, email: string, password: string) {
    const result = await ws.api.register_user({ name, email, password }) as any
    if (result?.user_id) {
      user.value = result
      if (result.token) {
        localStorage.setItem('dzql_token', result.token)
      }
    }
    return result
  }

  async function logout() {
    localStorage.removeItem('dzql_token')
    user.value = null
    ws.disconnect()
    await connect()
  }

  return { ws, ready, user, connectionError, connect, login, register, logout }
}
```

## 7. App Entry Point

`src/src/main.ts`:

```typescript
import './assets/main.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useDzql } from './composables/useDzql'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

// Connect to DZQL server
const { connect } = useDzql()
connect()
```

## 8. App Component Pattern

`src/src/App.vue`:

```vue
<script setup lang="ts">
import { useDzql } from '@/composables/useDzql'
import LoginModal from '@/components/LoginModal.vue'

const { ready, user, logout } = useDzql()
</script>

<template>
  <div v-if="!ready" class="loading">Connecting...</div>
  <LoginModal v-else-if="!user" />
  <template v-else>
    <header>
      <nav>
        <RouterLink to="/">Home</RouterLink>
        <span>{{ user.name }}</span>
        <button @click="logout">Logout</button>
      </nav>
    </header>
    <main>
      <RouterView />
    </main>
  </template>
</template>
```

**Key points:**
- No router guards needed - WebSocket `connection:ready` is the source of truth
- Shows loading until connection established
- Shows login if no user, app content if authenticated
- Login/logout reactively update UI - no page reload needed

## 9. Using Generated Stores

```vue
<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { useDzql } from '@/composables/useDzql'
import { useVenueDetailStore } from '@generated/client/stores/useVenueDetailStore.js'

const route = useRoute()
const { ws } = useDzql()
const store = useVenueDetailStore()

const venueId = computed(() => Number(route.params.id))
const docKey = computed(() => JSON.stringify({ venue_id: venueId.value }))

// Bind to subscription when venueId changes
watchEffect(() => {
  if (venueId.value) {
    store.bind({ venue_id: venueId.value })
  }
})

// Reactive data from store
const doc = computed(() => store.documents[docKey.value])
const loading = computed(() => !doc.value || doc.value.loading.value)
const venue = computed(() => doc.value?.data.value)
const sites = computed(() => doc.value?.data.value?.sites ?? [])

// CRUD operations
async function createSite(name: string) {
  await ws.api.save_sites({ venue_id: venueId.value, name })
  // No refetch needed - patch arrives via WebSocket
}

async function updateSite(id: number, name: string) {
  await ws.api.save_sites({ id, venue_id: venueId.value, name })
}

async function deleteSite(id: number) {
  await ws.api.delete_sites({ id })
}
</script>
```

**How realtime works:** Stores self-register with the WebSocket client on creation. When the server broadcasts `{table}:{op}` messages (e.g., `sites:insert`), each store's `table_changed` handler automatically applies the update to local data. No manual dispatcher setup required - just use the store and it works.

## 10. CLI Database Access with invj

Create `tasks.js` in the project root to enable CLI database operations:

```javascript
import { DzqlNamespace } from "dzql/namespace";

export class Tasks {
  constructor() {
    this.dzql = new DzqlNamespace();
  }
}
```

This integrates with `invj` to provide direct database access:

```bash
# List available commands
invj -l

# Available dzql commands:
#   dzql:entities              - List all entities
#   dzql:subscribables         - List all subscribables
#   dzql:functions             - List all functions
#   dzql:search <entity> [json] - Search records
#   dzql:get <entity> [json]    - Get single record
#   dzql:save <entity> [json]   - Create/update record
#   dzql:delete <entity> [json] - Delete record
#   dzql:lookup <entity> [json] - Autocomplete lookup
#   dzql:call <func> [json]     - Call custom function
#   dzql:subscribe <name> [json] - Get subscribable data

# Examples
invj dzql:entities
invj dzql:search venues
invj dzql:search venues '{"org_id": 1}'
invj dzql:get venues '{"id": 1}'
invj dzql:save venues '{"org_id": 1, "name": "New Venue", "address": "123 Main St"}'
invj dzql:delete venues '{"id": 1}'
```

## Development Workflow

```bash
# 1. Start PostgreSQL
bun run db

# 2. Compile domain (after any domain.js changes)
bun run compile

# 3. Start dev servers
bun run dev
```

After `bun run db`, the database initializes with migrations automatically. After domain changes, run `bun run compile` then restart the server.

## Linking DZQL for Local Development

If developing DZQL locally:

```bash
cd /path/to/dzql
bun link

cd /path/to/my-app
# dzql is already in package.json as "link:dzql"
bun install
```
