# DZQL

**Live apps for a few people at once, built from their stories.** You tell what each person does
and who then sees it; dzql works out the documents each needs in front of them, checks the model,
and makes the app's types, guards and migrations. The server draws every page from those
documents, and redraws only what changed for everyone holding one. The data lives in a JSON file,
SQLite or Postgres, and the app is the same on each.

Choose it for performance: the server draws the pages, with applets where a page holds state of
its own, and the documents are compiled to Postgres. To prototype, start lighter with
[paintbrush](https://github.com/blueshed/dzql/tree/main/packages/paintbrush) (`bun create
blueshed`): railroad and delta, the page drawn in the browser.
Each example below is run as written by `tests/readme/readme.test.ts`.

### Install dzql and use rendering: the server draws the page

A page is drawn on the server from the documents it reads, and redrawn on every page that holds a
document when anyone changes it; the browser only morphs what it is sent. One file, `routes.ts`:

```ts
import { run, serve } from "@blueshed/delta/serve";
import { createLocal } from "@blueshed/delta/local";
import { defineDoc, defineSchema, registerDocs } from "@blueshed/delta/json";
import type { Example } from "dzql/rendering/example";
import { read } from "dzql/rendering/documents";
import { esc, write } from "dzql/rendering/html";
import { appOf } from "dzql/rendering/server";
import index from "./index.html";

// One shared message, kept in a JSON file: the app's routes and its one resource. The server draws
// the page, redraws every page that holds the message when anyone saves, and Undo comes with the ledger.
const schema = defineSchema({ messages: { columns: { text: { type: "text", default: "Hello" } }, temporal: false } });
const delta = createLocal();
registerDocs(delta.server, `${process.env.DATA_PATH ?? "data"}/message.json`, schema, [
  defineDoc("message:", { root: "messages", include: [], implied: true }),
], [], { ledger: true });

const text = () => read<{ messages: { text: string } }>("message:1").messages.text;

export const app: Example = {
  name: "message",
  resources: [{ docType: "message", resolveDoc: () => "1", permit: (_ws, op) => op.op === "replace" && op.path === "/messages/1/text" }],
  render: () => `<h1>${esc(text())}</h1><form${write("message", "replace", "/messages/1/text")}><input name="text" aria-label="Message"><button>Save</button></form>`,
  active: () => true,
  index,
  delta,
};

// delta's one server: the page at "/", its socket at "/ws", /health; `bun routes.ts`
if (import.meta.main) await run(() => serve(appOf(app)));
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
bun routes.ts
```

Two windows on http://localhost:3000 show the same message; a save in one shows in both, and it is
kept in `data/message.json`.

### Install dzql and use modelling, for a JSON file, SQLite or Postgres

The stories are told on the model's page, live, while Claude writes them down (the `modelling`
skill). After every change the model is checked, and while nothing is open it makes the app's
types, guards, migrations and a proof:

```sh
bun add dzql @blueshed/delta
bunx dzql model
```

The page is http://localhost:3001/model, signed in by the link each keeper is given as it starts.
[examples/cafe](examples/cafe) is an app told this way and built from what it made.

### Install dzql and compile a Postgres server, for scale and performance

The same definitions compiled to SQL: every document's reads and writes are stored functions, and
every server on the database hears every change. `server.ts`, over the `types.ts` the model made:

```ts
import { createWs } from "@blueshed/delta/server";
import { run, serve } from "@blueshed/delta/serve";
import { openStore } from "dzql/postgres";
import { docs, schema } from "./types";

// The same definitions, compiled to Postgres: every write is a stored function, and every server
// on the database hears every change. PGlite runs Postgres in this process (in PGLITE_DIR, else in
// memory); DATABASE_URL names a Postgres server in its place.
const ws = createWs();
const store = await openStore({ schema, ws });
store.register(docs);
await store.open();
await run(() => serve({ ws, routes: {}, close: [store.close] }));
```

```sh
bun add dzql @blueshed/delta @electric-sql/pglite
bunx dzql sql types.ts
bun server.ts
```

`dzql sql` prints the SQL it compiles. A client talks to it exactly as to delta's JSON file or
SQLite, and `exportTables` / `importTables` carry the rows across.

## The parts

- **`dzql/modelling`**: the stories, the model's checks, and what it makes.
- **`dzql/rendering`**: pages the server draws from the documents they read.
- **`dzql/postgres`**, **`dzql/pglite`**: the same documents compiled to Postgres. Its database
  packages are optional: `bun add pg` for a server, `@electric-sql/pglite` for `dzql/pglite`, `jose`
  for `dzql/auth-jwt`.

Documents and their storage are [@blueshed/delta](https://github.com/blueshed/dzql/tree/main/packages/delta)'s.
How an app is made, from stories to storage: [bluetools](https://github.com/blueshed/dzql#how-an-app-is-made).

## Start

`bun create dzql my-app` makes the starter: an app whose stories come first, its pages drawn by
the server, its documents delta's, served by delta's one server. It begins with no stories and no
documents; the first story says which document comes first.

```bash
bun create dzql my-app
cd my-app
bun install
bun test
bun dev
```

## With Claude

dzql is made to be built with by Claude. The manual is its skills: `dzql-app` (building an app),
`modelling` (taking the stories down) and delta's `delta-doc` (documents). A project made with `bun
create dzql` installs them, and `bunx delta install-skills` copies them into any other. Working on
dzql itself starts at its [CLAUDE.md](CLAUDE.md).

## License

MIT
