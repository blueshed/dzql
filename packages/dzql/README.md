# DZQL

**Stories to documents to pages, and delta's compiled Postgres step.**

Three things you can say, each standing alone. Each file below is run as written by
`readme/readme.test.ts`.

### Install dzql and use rendering: the server draws the page

A page is drawn on the server from the documents it reads, and redrawn on every page that holds a
document when anyone changes it; the browser only morphs what it is sent. One file, `index.ts`:

```ts
import { createLocal } from "@blueshed/delta/local";
import { defineDoc, defineSchema, registerDocs } from "@blueshed/delta/json";
import type { Example } from "dzql/rendering/example";
import { read } from "dzql/rendering/documents";
import { esc, write } from "dzql/rendering/html";
import index from "./index.html";

// One shared message, kept in a JSON file. The server draws the page, redraws every page that
// holds the message when anyone saves, and Undo comes with the ledger.
const schema = defineSchema({ messages: { columns: { text: { type: "text", default: "Hello" } }, temporal: false } });
const delta = createLocal();
registerDocs(delta.server, `${process.env.DATA_PATH ?? "data"}/message.json`, schema, [
  defineDoc("message:", { root: "messages", include: [], implied: true }),
], [], { ledger: true });

const text = () => read<{ messages: { text: string } }>("message:1").messages.text;

export const example: Example = {
  name: "message",
  resources: [{ docType: "message", resolveDoc: () => "1", permit: (_ws, op) => op.op === "replace" && op.path === "/messages/1/text" }],
  render: () => `<h1>${esc(text())}</h1><form${write("message", "replace", "/messages/1/text")}><input name="text" aria-label="Message"><button>Save</button></form>`,
  active: () => true,
  index,
  delta,
};
```

with the page it is drawn into, `index.html`:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Message</title></head>
  <body>
    <main id="app">Connecting&hellip;</main>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

and its one line of script, `main.ts`, the kernel's client:

```ts
import "dzql/rendering/client/app";
```

```sh
bun add dzql @blueshed/delta
bunx dzql serve .
```

Two windows on http://localhost:3000 show the same message; a save in one shows in both, and it is
kept in `data/message.json`. Growing it: the `eta-app` skill.

### Install dzql and use modelling, for a JSON file, SQLite or Postgres

Modelling records the stories, derives from them the documents each person needs in front of them,
and builds the entities from those. Tell it on the model's page; after every change it is checked
(hjeli's six, Easy's coverage, playability), and while nothing is open it makes the app's types,
migrations and tests. `dzql model check` does the same once:

```sh
bun add dzql @blueshed/delta
bunx dzql model
bunx dzql model login claude@modeling.example claude-password
bunx dzql model story ann does Ann asks for two days off, and Mo sees them waiting
bunx dzql model story mo does Mo approves them, and Ann sees it
bunx dzql model touches 1 requests
bunx dzql model touches 2 requests
bunx dzql model document team teams 1 2
bunx dzql model holds 1 teams name
bunx dzql model holds 1 requests under teams starts:date days:number status
bunx dzql model heldby 1 ann mo
bunx dzql model check
```

The model's page is http://localhost:3001/model, watched live as the stories land; the model is
`model.json`, which the page edits. What it makes goes in `app/`: `types.ts` (below), the
migrations from empty, and the stories as tests. Beside an app, `dzql serve` mounts the model at
`/model` in development, and production never registers it. `app/types.ts`:

```ts
// The model, now: delta's definitions, a row type per table and each document's shape. Written by `dzql model` from the model's page; never edited by hand.
// Every store takes them: change the import to move to SQLite (`@blueshed/delta/sqlite`) or Postgres (`dzql/postgres`).
import { defineDoc, defineSchema } from "@blueshed/delta/json";

export const schema = defineSchema({
  teams: { columns: { name: "text?" }, temporal: false },
  requests: { columns: { starts: "text?", days: "real?", status: "text?" }, temporal: false, parent: "teams" },
});

export const docs = [
  // for: Ann asks for two days off, and Mo sees them waiting
  // for: Mo approves them, and Ann sees it
  defineDoc("team:", { root: "teams", include: ["requests"], implied: true }),
];

export type TeamsRow = { id: number; name: string | null; };
export type RequestsRow = { id: number; teams_id: number; starts: string | null; days: number | null; status: string | null; };

export type TeamDoc = { teams: TeamsRow; requests: Record<string, RequestsRow>; };
```

`registerDocs(ws, "data/app.json", schema, docs)` from `@blueshed/delta/json` keeps it in a file;
the same from `@blueshed/delta/sqlite` with a database; the next section, Postgres. In code,
`definitionsOf(model)` (`dzql/modelling/definitions`) does the same from the model's document.
Telling the stories: the `modelling` skill.

### Install dzql and compile a Postgres server, for scale and performance

The same definitions compiled to SQL: every document's reads and writes are stored functions, and
every server on the database hears every change. `server.ts`:

```ts
import { createWs } from "@blueshed/delta/server";
import { run, serve } from "@blueshed/delta/serve";
import { applyFramework, applySql, createDocListener, docTypeFromDef, generateSql } from "dzql/postgres";
import { openPglite } from "dzql/pglite";
import { docs, schema } from "./types";

// The same definitions, compiled to Postgres: every write is a stored function, and every server
// on the database hears every change. PGlite runs Postgres in this process; on a Postgres server,
// `new Pool({ connectionString })` from `pg` takes its place.
const pool = await openPglite(process.env.PGLITE_DIR);
await applyFramework(pool);
await applySql(pool, generateSql(schema, docs));

const ws = createWs();
const listener = await createDocListener(ws, pool, { types: docs.map((def) => docTypeFromDef(def, pool)) });
await run(() => serve({ ws, routes: {}, close: [() => listener.destroy(), () => pool.end()] }));
```

```sh
bun add dzql @blueshed/delta @electric-sql/pglite
bunx dzql sql types.ts
bun server.ts
```

`dzql sql` prints the SQL it compiles. A client talks to it exactly as to delta's JSON file or
SQLite, and `exportTables` / `importTables` carry the rows across.

## The parts

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
