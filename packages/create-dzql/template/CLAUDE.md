# Starter

An app on dzql: stories first, then the documents a person needs in front of them to act, then
the page the server draws from them. The skills say how, and `bun install` puts them in
`.claude/skills` (`delta install-skills`):

- **modelling**: while someone tells you the stories, there to answer: the model's page
  (`bun dev` serves it at `localhost:3000/model` beside the app, and prints a sign-in link for
  each keeper; `bun run model login <link>`, then `bun run model <verb>`).
- **dzql-app**: building or changing the app in `src/`: stories, documents, resources, the page.
  `node_modules/dzql/examples/cafe/` is an app built from its model, laid out as this one is: its
  README walks the path from the model to the app.
- **delta-doc**: the documents themselves: schema, storage, the ledger. **railroad**: an applet drawn with it.

## The shape

An app is routes and resources on both sides of the socket, joined by documents; entities (the
collections of delta's `defineSchema`) are behind them, on the server. Here the server draws every
page, so the routes and resources are the server's:

- `src/routes.ts` is the server: the app (its page, its socket, its resources) composed with any
  HTTP route and, in development, the model's page at `/model`, on delta's one server (`serve`,
  `run`). `bun dev` and `bun start` run it; never a `Bun.serve` of the app's own.
- `src/store.ts` is where the documents are kept: Postgres, through dzql's `openStore` -- a server
  at `DATABASE_URL`, else PGlite in the process, in the data folder's `pg/` (`DATA_PATH`, else
  `data/`; for a test, a scratch folder of its own, or memory: `DATA_PATH=:memory:` in
  `.env.test`). PGlite is for development and the tests; production sets `DATABASE_URL`. The server opens it as it starts and closes it as it stops (`appOf(app, {
  dataDir })`). Its schema (one, or each resource's: `openStore({ schema: [...] })`) takes the
  model's `tables` once `dzql model` has made `model/`, and the app's own beside them.
- `src/resources/<name>/` is one document: `<name>-api.ts` its document, registered with the store
  (`register`); `<name>.ts` its resource (who may write it, what a write becomes), listed in the app's
  `resources`; `<name>-view.ts` its part of the page, drawn by `src/page.ts`.
- An applet is the only client resource.
- People sign in by a link each, printed as the server starts (`signInLinks`, from
  `dzql/rendering/links`), and sign out by the bento's `leave`: no email and no password unless a
  story asks for them.

## Working here

- Start every feature with its story in `stories.ts`, watch `bun run stories` fail, build the
  least that makes it pass. A story with no body yet (`story(name)`) is unproven until it has one.
- Asked to build or change something, build it; never stop to wait for an answer. `CHANGELOG.md`
  and `todo.jsonl` are the project's memory between sessions: read both first. What lands goes
  under `## [Unreleased]`; a question, or what you leave open, goes into `todo.jsonl` (one JSON
  object a line: `n`, `status`, `summary`, `detail`, and a dated `note`) with the reading you took.
- The gate before a commit: `bun check`, `bun test`, `bun run stories`.
- Never edit dzql or delta in `node_modules`; move to a later one by bumping it in `package.json`.
