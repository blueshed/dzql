# DZQL: Realtime Apps Without the Boilerplate

DZQL compiles your data model into a complete realtime backend. Define entities and permissions in TypeScript, get a PostgreSQL database with CRUD operations, WebSocket sync, and type-safe client SDK - all generated.

## Why DZQL?

Building realtime apps typically means:
- Writing CRUD endpoints for every entity
- Implementing row-level security in your API layer
- Keeping frontend state in sync with the database
- Managing WebSocket subscriptions manually

**DZQL eliminates this.** You define *what* your data looks like. DZQL generates *how* it works.

## 30-Second Start

```bash
bun create dzql my-app
cd my-app
bun install
bun run db:rebuild
bun run dev
```

Open http://localhost:5173 - you have a working realtime app.

## How It Works

**1. Define your domain** (`domain.ts`):

```typescript
export const entities = {
  posts: {
    schema: {
      id: 'serial PRIMARY KEY',
      title: 'text NOT NULL',
      author_id: 'int REFERENCES users(id)'
    },
    permissions: {
      view: [],                // Anyone can view
      update: ['@author_id']   // Only author can edit
    }
  }
};
```

**2. Compile:**

```bash
bunx dzql domain.ts
```

This generates:
- SQL migrations with CRUD functions and permission checks
- TypeScript client SDK with full type safety
- Pinia stores with automatic realtime sync

**3. Use in your app:**

```typescript
// Type-safe API
const post = await ws.api.save_posts({ title: 'Hello World' });

// Realtime subscriptions
const store = usePostFeedStore();
const { data } = await store.bind({ author_id: 1 });
// data updates automatically when posts change - no refetching
```

## Key Concepts

| Concept | What it does |
|---------|--------------|
| **Entities** | Database tables with CRUD operations (get, save, delete, search, lookup) |
| **Get = Rich Document** | `get` returns FK expansions and M2M relationships - a complete document |
| **Subscribables** | For complex queries with realtime sync (one-to-many, nested includes) |
| **Permissions** | Row-level security compiled to SQL |
| **Graph Rules** | Side effects on create/update/delete |

**Progression:** Start with `get` for simple documents. Move to subscribables when you need one-to-many relationships or realtime updates across multiple tables.

## What Gets Generated

```
generated/
├── db/migrations/     # SQL schema + functions
├── runtime/manifest.json  # API allowlist
└── client/
    ├── ws.ts          # Type-safe WebSocket client
    └── stores/        # Pinia stores with realtime sync
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│   Runtime   │────▶│  PostgreSQL │
│  Vue + SDK  │◀────│  WebSocket  │◀────│   + Notify  │
└─────────────┘     └─────────────┘     └─────────────┘
     Pinia              Allowlist           Compiled
     Stores             Gateway              SQL
```

- **Compiler**: Generates SQL and TypeScript at build time
- **Runtime**: Lightweight WebSocket gateway (no query building)
- **Client**: Type-safe SDK with automatic state sync

## Learn More

- [Domain Modeling Guide](./for_ai.md) - Entity and permission patterns
- [Project Setup](./project-setup.md) - Manual setup and configuration
- [Architecture Roadmap](./futures.md) - Performance and scaling plan
- [Feature Requests](./feature-requests/) - Roadmap and proposals

## Package Exports

```typescript
import { startServer } from 'dzql';           // Runtime server
import { WebSocketManager } from 'dzql/client'; // Client SDK
import { DzqlNamespace } from 'dzql/namespace'; // CLI/scripting
```
