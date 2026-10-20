# create-dzql

```sh
bun create dzql my-app
cd my-app
bun install
bun dev            # http://localhost:3000
```

An app on [dzql](https://github.com/blueshed/dzql/tree/main/packages/dzql), for performance: the
server draws the pages, with applets where a page holds state, and the documents are compiled to
Postgres. To prototype, `bun create blueshed` is the lighter start. It begins from the starter,
[`template/`](template): a page the server draws, no stories yet and no documents yet, kept in
Postgres -- PGlite in the process until `DATABASE_URL` names a server. The starter is a whole
working app, laid out as a new one is and tested where it lives; a new app is a copy of it. Its stories come first
(`stories.ts`), and the app is built from them, the least that makes each pass. delta keeps
the documents and serves the app on its one server (`@blueshed/delta/serve`): the app is routes and
resources, never a `Bun.serve` of its own. `bun test` checks that the page is served and drawn and
that every story passes.
