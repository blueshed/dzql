# DZQL

**delta's compiled Postgres step.**

An app built on [@blueshed/delta](https://github.com/blueshed/delta) keeps its definitions
(`defineSchema`, `defineDoc`), its client and its wire. On Postgres, dzql keeps its documents and
compiles those definitions to SQL, each piece held equal to delta's own cases. Why, and where it
is going: [philo.md](https://github.com/blueshed/dzql/blob/main/philo.md).

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

Its tests run delta's own cases (`@blueshed/delta/testing`) against it. `generateSql` writes the
SQL for each of your documents and collections, compiled from their definitions (opening a
document, reading its name, who holds a row, a write's scope and rows, what each document is told,
the fan-out, the ledger's reads): nothing interprets a definition at run time. Apply it after the
framework, every time, one app per database (`docs/delta/postgres.md`, "Compiled SQL"). The plan
is in Workshop's `docs/postgres-split-plan.md`.

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

## Documentation

See the [full documentation](./docs/README.md) for:

- [Project Setup Guide](./docs/project-setup.md)
- [AI Assistant Guide](./docs/for_ai.md)

## Package Exports

```typescript
import { createServer } from 'dzql';           // Runtime server
import { ws } from 'dzql/client';              // WebSocket client  
import { compile } from 'dzql/compiler';       // CLI compiler
import { DzqlNamespace } from 'dzql/namespace'; // Direct DB access
```

## License

MIT
