# DZQL

**Stories to documents to pages, and delta's compiled Postgres step.**

- **`dzql/modelling`**: the stories an app is for, each saying who does what and who then sees it,
  told against the app by a harness, and by hand in a phone-sized browser.
- **`dzql/rendering`**: pages the server draws as HTML from the documents they read, each sent only
  the parts a write changed. An applet is the piece of a page that holds state of its own; one
  written with railroad is an island (`dzql/rendering/island`), the one thing that needs the
  optional `@blueshed/railroad`. Six apps show it in [examples/](examples).
- **`dzql/postgres`**, **`dzql/pglite`**: the compiled Postgres step, below.

How an app is made, from its stories to its storage: [bluetools](https://github.com/blueshed/dzql#how-an-app-is-made).

An app built on [@blueshed/delta](https://github.com/blueshed/dzql/tree/main/packages/delta) keeps its definitions
(`defineSchema`, `defineDoc`), its client and its wire. On Postgres, dzql keeps its documents and
compiles those definitions to SQL, each piece held equal to delta's own cases.

## delta's Postgres step

dzql is the Postgres step for apps built on [@blueshed/delta](https://github.com/blueshed/dzql/tree/main/packages/delta):
a delta app grows from a JSON file to SQLite to Postgres, and on Postgres its documents are kept by
dzql. Since 0.8.0 dzql carries delta's Postgres backend, with the same names, so moving is an
import change. Its database packages are optional peers, so an app that only models or renders
pulls none of them: `bun add pg` for a Postgres server, `@electric-sql/pglite` for `dzql/pglite`,
`jose` for `dzql/auth-jwt`.

```ts
import { applyFramework, applySql, createDocListener, docTypeFromDef, generateSql } from "dzql/postgres";
import { openPglite } from "dzql/pglite";   // Postgres in this process
import { jwtAuth } from "dzql/auth-jwt";
```

Its tests run delta's own cases (`@blueshed/delta/testing`) against it. `generateSql` writes the
SQL for each of your documents and collections, compiled from their definitions (opening a
document, reading its name, who holds a row, a write's scope and rows, what each document is told,
the fan-out, the ledger's reads): nothing interprets a definition at run time. Apply it after the
framework, every time, one app per database (`docs/dzql/postgres/postgres.md` in blueshed/dzql, "Compiled SQL"). The plan
is `docs/dzql/postgres-split-plan.md` in blueshed/dzql.

## Start

`bun create dzql my-app` makes eta's starter: an app whose stories come first, its pages drawn by
the server, its documents delta's, served by delta's one server. It begins with no stories and no
documents; the first story says which document comes first.

```bash
bun create dzql my-app
cd my-app
bun install
bun test
bun dev
```

From 0.13 dzql is only this step. The framework it was before delta (a `domain.ts` compiled to SQL,
a typed client, Pinia stores) is retired; its story is in the [changelog](https://github.com/blueshed/dzql/blob/main/CHANGELOG.md).

## Documentation

- [delta on Postgres](https://github.com/blueshed/dzql/blob/main/docs/dzql/postgres/postgres.md): setting up, and what is compiled
- [Stored functions](https://github.com/blueshed/dzql/blob/main/docs/dzql/postgres/sql.md) and [row-level security](https://github.com/blueshed/dzql/blob/main/docs/dzql/postgres/rls.md)
- `owns` as a path, and every other definition: delta's `delta-doc` skill

## License

MIT
