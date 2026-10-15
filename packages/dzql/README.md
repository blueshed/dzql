# DZQL

Database-first real-time framework with TypeScript support.

## Quick Start

```bash
bun create dzql my-app
cd my-app
bun install
bun run db:rebuild
bun run dev
```

## delta's Postgres step

dzql is becoming the Postgres step for apps built on [@blueshed/delta](https://github.com/blueshed/delta):
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
fan-out), each held
equal to the framework's; documents it did not compile go to the framework. Apply `generateSql`
after the framework, every time (`docs/delta/postgres.md`, "Compiled SQL"). The plan is in
Workshop's `docs/postgres-split-plan.md`.

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
