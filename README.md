# DZQL

**delta's compiled Postgres step.**

An app built on [@blueshed/delta](https://github.com/blueshed/delta) keeps its definitions
(`defineSchema`, `defineDoc`), its client and its wire. On Postgres, dzql keeps its documents and
compiles those definitions to SQL, each piece held equal to delta's own cases. Why, and where it
is going: [philo.md](philo.md).

## delta's Postgres step

dzql is the Postgres step for apps built on [@blueshed/delta](https://github.com/blueshed/delta):
a delta app grows from a JSON file to SQLite to Postgres, and on Postgres its documents are kept by
dzql. Since 0.8.0 dzql carries delta's Postgres backend, with the same names, so moving is an
import change:

```ts
import { applyFramework, applySql, createDocListener, docTypeFromDef, generateSql } from "dzql/postgres";
import { openPglite } from "dzql/pglite";   // Postgres in this process
import { jwtAuth } from "dzql/auth-jwt";
```

Its tests run delta's own cases (`@blueshed/delta/testing`) against it. Compiled SQL is replacing
the framework SQL a piece at a time: `generateSql` writes functions for each of your documents
(opening it, reading its name, who holds a row, a write's scope, what each document is told, the
fan-out), each held equal to the framework's; documents it did not compile go to the framework. Apply `generateSql`
after the framework, every time (`docs/delta/postgres.md`, "Compiled SQL"). The plan is in
Workshop's `docs/postgres-split-plan.md`.

## The whole-stack dzql (retiring)

Before delta, dzql was a framework of its own: a `domain.ts` compiled to SQL, a typed client and
Pinia stores, started with `bun create dzql`. It is kept working until step 5 of the plan retires
it (the runtime, the client, the stores and `create-dzql`); nothing new is added to it. A new app
starts from delta and moves to dzql when it moves to Postgres.

### Quick start

```bash
bun create dzql my-app
cd my-app
bun install
bun run db:rebuild
bun run dev
```

Open http://localhost:5173 - you have a working app with auth, real-time updates, and typed stores.

### How it works

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

### Features

- **TypeScript-first** - Define domain in TS, get typed client and stores
- **Real-time** - WebSocket sync out of the box
- **Permissions** - Row-level security with path expressions
- **Graph rules** - Automatic side effects (counters, cascades, notifications)
- **Subscriptions** - Live queries that update when underlying data changes

### Packages

| Package | Description |
|---------|-------------|
| `dzql` | Runtime - server, client, database migrations |
| `dzql` (CLI) | Compiler - generates SQL and TypeScript from domain |
| `create-dzql` | Starter template for `bun create dzql` |

## Documentation

- [delta on Postgres](packages/dzql/docs/delta/postgres.md) - setting up, and what is compiled
- [Stored functions](packages/dzql/docs/delta/sql.md) and [row-level security](packages/dzql/docs/delta/rls.md)
- [Project Setup](packages/dzql/docs/project-setup.md) and [AI Guide](packages/dzql/docs/for_ai.md) - the whole-stack dzql
- [Changelog](CHANGELOG.md) - How dzql got here, version by version

## License

MIT
