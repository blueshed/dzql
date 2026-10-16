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

Its tests run delta's own cases (`@blueshed/delta/testing`) against it. `generateSql` writes the
SQL for each of your documents and collections, compiled from their definitions (opening a
document, reading its name, who holds a row, a write's scope and rows, what each document is told,
the fan-out, the ledger's reads): nothing interprets a definition at run time. Apply it after the
framework, every time, one app per database (`docs/delta/postgres.md`, "Compiled SQL"). The plan
is in Workshop's `docs/postgres-split-plan.md`.

## Start

`bun create dzql my-app` makes a paintbrush app on dzql: link sign-in, posts as two documents,
and tests in two real browsers, on PGlite with no database server. `DATABASE_URL` names a
Postgres server for production.

```bash
bun create dzql my-app
cd my-app
bun test
bun run dev
```

From 0.13 dzql is only this step. The framework it was before delta (a `domain.ts` compiled to SQL,
a typed client, Pinia stores) is retired; its story is in the [changelog](https://github.com/blueshed/dzql/blob/main/CHANGELOG.md).

## Documentation

- [delta on Postgres](packages/dzql/docs/delta/postgres.md): setting up, and what is compiled
- [Stored functions](packages/dzql/docs/delta/sql.md) and [row-level security](packages/dzql/docs/delta/rls.md)
- `owns` as a path, and every other definition: delta's `delta-doc` skill

## License

MIT
