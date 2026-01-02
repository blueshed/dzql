# DZQL

**Database-first, real-time framework for PostgreSQL.**

Define your domain in TypeScript, compile to SQL, get a full-stack app with real-time WebSocket sync.

## Quick Start

```bash
bun create dzql my-app
cd my-app
bun install
bun run db:rebuild
bun run dev
```

Open http://localhost:5173 - you have a working app with auth, real-time updates, and typed stores.

## How It Works

1. **Define your domain** in TypeScript:

```typescript
// domain.ts
export const entities = {
  posts: {
    schema: {
      id: "serial primary key",
      title: "text not null",
      content: "text",
      author_id: "int references users(id)",
    },
    label: "title",
    searchable: ["title", "content"],
    includes: { author: "users" },
    permissions: {
      view: [],
      update: ["@author_id"],
    },
  },
};
```

2. **Compile** to SQL and TypeScript:

```bash
bunx dzql domain.ts -o generated
```

This generates:
- `generated/db/migrations/*.sql` - Database schema and functions
- `generated/client/*.ts` - Typed client SDK
- `generated/stores/*.ts` - Pinia stores for Vue

3. **Use** the generated client:

```typescript
import { ws } from '@generated/client/ws'

// Full CRUD with types
const post = await ws.api.save_posts({ title: 'Hello', content: '...' })
const posts = await ws.api.search_posts({ filters: { author_id: 1 } })

// Real-time subscriptions
const { unsubscribe } = await ws.api.get_posts_feed(
  { user_id: 1 },
  (data) => console.log('Feed updated:', data)
)
```

## Features

- **TypeScript-first** - Define domain in TS, get typed client and stores
- **Real-time** - WebSocket sync out of the box
- **Permissions** - Row-level security with path expressions
- **Graph rules** - Automatic side effects (counters, cascades, notifications)
- **Subscriptions** - Live queries that update when underlying data changes

## Packages

| Package | Description |
|---------|-------------|
| `dzql` | Runtime - server, client, database migrations |
| `dzql` (CLI) | Compiler - generates SQL and TypeScript from domain |
| `create-dzql` | Starter template for `bun create dzql` |

## Documentation

- [Project Setup](packages/tzql/docs/project-setup.md) - Full setup guide
- [AI Guide](packages/dzql/docs/for-ai/claude-guide.md) - For AI-assisted development

## License

MIT
