# bluetools

**Documents are how people communicate.** A document is what someone needs in front of them to
act. To place an order you need the catalogue and your order: two documents on one page. The
kitchen needs every open order, another document over the same rows. Open a document and you're
subscribed: every change anyone makes reaches you as it happens, with nothing to poll, fetch or
refresh. Change it with add, replace or remove on a path, and everyone holding it sees it at once.

These are the packages for building live apps for a few people at once on that idea: two
clients and three stores, and nothing else to choose. They live in one repository
([blueshed/dzql](https://github.com/blueshed/dzql)) as Bun workspaces. This page is the one
statement of how an app is made; each package's README says only its own part.

## How an app is made

- **Stories first.** An app is a set of stories, each a sentence someone using it could call true
  or false: who does what, and who then sees it. Each is code, `story(name)` from `dzql/modelling`,
  proven by a test named from it; on the thin client it can carry a body that the harness checks
  against every page, including the ones that must not hear of a change. Build nothing no story
  needs.
- **Documents, not entities.** Ask "what does someone need in front of them to do this?" rather
  than "what are the tables?" The tables follow from the documents.
- **Three ways to keep documents: a JSON file, SQLite or Postgres.** The same documents, the same
  writes, the same page on each. A document may instead be kept in `memory`, read from a `source`,
  or `static`: one set of names everywhere. The only reason to pick one store over another is ease
  or performance: a JSON file is the easiest; SQLite when documents share rows, or for undo and
  history; Postgres when servers share the data, or people should see only their own.
- **Routes and resources on both sides of the socket, joined by documents.** On the server, the
  routes given to delta's one server (`@blueshed/delta/serve`) serve resources: a document
  registered on the socket, or an HTTP endpoint for what isn't communication (health, status,
  files). On the client, railroad's `routes()` draw resources: a handle that opens the document,
  and its view. **Entities**, the collections of delta's `defineSchema`, are behind the documents
  on the server.

  | | Server | Client |
  |---|---|---|
  | Routes | Bun routes, given to delta's `serve` | railroad `routes()` |
  | Resources | a registered document, or an HTTP endpoint | an `openDoc` handle and its view |
  | Joined by | the document, on the socket | |
  | Behind it | entities (`defineSchema`) | |

- **Two clients: thick or thin, with applets in either.** Thick, the browser draws the page with
  railroad (paintbrush). Thin, the server draws every page from its URL (eta, `dzql/rendering`), so
  its routes and resources are the server's. An applet is the piece of a page that holds state of
  its own (a drag, a calendar): on the thin client it is written by hand or with railroad (an
  island); on the thick client it is a railroad component like the rest of the page. Again, the
  only reason to pick one is ease or performance.
- **Small enough for an AI to hold.** One way to do each thing, and the whole of a package readable
  before a line is written. Postgres is compiled from delta's definitions by a deterministic
  compiler, held to delta's own cases: Claude writes the compiler; Claude is never the compiler.

## The packages

| Package | npm | What it is |
|---|---|---|
| [`packages/railroad`](packages/railroad) | `@blueshed/railroad` | Signals, JSX and routes for Bun's fullstack runtime; `/webview`, a page in a real browser for tests |
| [`packages/delta`](packages/delta) | `@blueshed/delta` | Documents: open one and you're subscribed. JSON file and SQLite, the wire, the client, and the one server (`/serve`) |
| [`packages/dzql`](packages/dzql) | `dzql` | Stories to documents to pages: `dzql/modelling`, `dzql/rendering` (eta), and the compiled Postgres step |
| [`packages/paintbrush`](packages/paintbrush) | (private) | The starting website: routes and resources, a railroad page, delta documents |
| [`packages/create-blueshed`](packages/create-blueshed) | `create-blueshed` | `bun create blueshed my-app`: a paintbrush app |
| [`packages/create-dzql`](packages/create-dzql) | `create-dzql` | `bun create dzql my-app`: eta's starter, on dzql |

Each package keeps its npm name, its version and its CHANGELOG. In the workspace each uses its
siblings' source, not npm's. `/publish` releases what has changed in one round, a tag per package
(`railroad@x.y.z`, `delta@x.y.z`, `dzql@x.y.z`).

```sh
bun install              # at the root: every package, one bun.lock
bun run affected         # the gate: each package a change touches, and those that depend on it
bun run test:delta       # one package's fast tier; test:<package>:slow for its browsers and Postgres
```

- What changed across the packages: [CHANGELOG.md](CHANGELOG.md); what is open: [todo.jsonl](todo.jsonl).
- The documents, by package: [docs/](docs/README.md).
- How to work here: [CLAUDE.md](CLAUDE.md).

MIT licensed (`LICENSE`).
