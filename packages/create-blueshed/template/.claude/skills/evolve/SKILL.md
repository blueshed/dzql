---
name: evolve
description: "Grows this app from its stories: a new shared document, two documents on one page, documents over the same rows and undo, keeping documents in SQLite or Postgres, a schema change on a database that holds data (a migration), sign-in by link with no passwords, HTTP routes for what isn't communication (health, status, files in S3), a production build, and the page drawn on the server (dzql's thin client). Use when the user asks for something people share, see or act on, for storage beyond a JSON file, for undo or history, for a change to a schema in use, for people signing in, for files, for a build, or for the page drawn on the server."
---

# Growing the app

**Documents are how people communicate.** A document is what someone needs in front of them to take an action: to place an order, the catalogue and their order (two documents on one page); for the kitchen, every open order (another document over the same rows). Open one and you're subscribed: every change anyone makes reaches you. Change it with add, replace or remove on a path, and everyone holding it sees it at once.

**Think in documents, not entities.** Ask "what does someone need in front of them to do this?", not "what are the tables?" The tables follow from the documents.

**Three stores, one page.** A JSON file, SQLite or Postgres keep the same documents, and the page stays the same on each. Every document is a schema and a `defineDoc` from the start, so moving changes the import, never the definitions. The only reason to move is ease or performance: the JSON file is the easiest, and holds documents over the same rows, undo and history; SQLite when the file is too much to rewrite after every change, or the schema must change on data in use; Postgres when servers share the data, or people should see only their own.

**This is the light client, for prototyping**: the browser draws the page with railroad, as a bento, in the same look as the thin client's. The thin one, for performance, is dzql's (`bun create dzql`), where the server draws it and the documents are compiled to Postgres; an applet (a railroad component) works in either. It is one path: a prototype grows into performance, its documents unchanged: this skill takes their storage there, then the page ([references/thin-client.md](references/thin-client.md)).

## Order of work

Asked to build, build now, however much is asked: the stories go straight into `stories.ts` (the model's page and the `modelling` skill are for someone there telling them). Never stop to wait for an answer: put the question in `todo.jsonl` with the reading you took, and go on.

```
- [ ] Write what the user asked into stories.ts as stories (`story("...")`): sentences someone could call true or false; each under a key of its own; each test that makes one true is named from it (`stories.stories.<key>.name`)
- [ ] Ask what someone needs in front of them to make each true: those are the documents
- [ ] Copy the closest reference below (each says when it is the one), or message / status in src/resources/
- [ ] A test named for each story: what a person sees and clicks (a refused change included), and every route and method
- [ ] bun test (100% coverage) and bun run typecheck
- [ ] CHANGELOG.md under [Unreleased]; in todo.jsonl the item settled marked fixed, or one for what is left open
```

## Invariants

- Anything people share is a document from the start, as `message` is. HTTP routes serve only what isn't communication: health, files, `status`.
- A resource is `src/resources/<name>/`: `<name>-api.ts` (server side, and the type both sides share), `<name>.ts` (the document it opens, or what it fetches), `<name>-view.tsx`. Wire the server side in `src/routes.ts`, the view into the page in `src/app.tsx`: its cell in `cells`, a deed of the page's in `actions`, its drawer in `drawerOf`, its new-or-delete in `modalOf`.
- The page is the bento's (`src/resources/bento.tsx`): a box of cells; a thing is changed in a drawer, made or removed in a modal, each opened by where you are (`go`), so Back closes it; a list is `rowsOf`. It is the HTML the thin client's server draws (dzql's `bento.ts`), in the same stylesheet, so a page keeps its look as it moves to the server, each handler turned into a write ([references/thin-client.md](references/thin-client.md), which says what else is rewritten). Say the look in `styles.css`'s tokens, never a rule over the bento's.
- A document is never set in the page: `send` the change, and the change that comes back draws it, in this window too.
- A row is addressed by its id, never its position.
- The schema is the contract: a database may hold more than it declares, never less. Its tables are made by its migrations, from empty: every change to the schema is the next migration, written by `bunx @blueshed/delta migrations make`; one that has run is never edited.
- The client imports a shared type with `import type`, so no server code reaches the browser.
- Coverage stays at 100%: write the missing test, never lower the threshold.

## The types

delta's are in `node_modules/@blueshed/delta/src/`: `server/json.ts` (the JSON file), `server/server.ts` (`createWs`), `client/client.ts` (`openDoc`, `connectWs`), `core.ts` (`DeltaOp`), `schema.ts`, `server/changes.ts` (a migration's changes), `server/migrate.ts` (`Migration`), `server/auth-link.ts`, and a file per backend under `server/`. The app's: `startServer` in `src/routes.ts`, the page helpers in `tests/browser.ts` (railroad's `@blueshed/railroad/webview`, and `refuseWrites`). The `delta-doc` skill is delta's manual; `railroad` is the page's.

## References

Each leads with its example: code and tests, proven by applying them to a new app and running its tests.

- [references/document.md](references/document.md): a new shared document (notes: add and remove)
- [references/testing.md](references/testing.md): the document in the browser: two windows, a refusal
- [references/two-documents.md](references/two-documents.md): the catalogue and an order on one page
- [references/sqlite.md](references/sqlite.md): the move to SQLite, with the kitchen (documents over the same rows) and undo
- [references/migrations.md](references/migrations.md): a schema that changes on a database holding data
- [references/postgres.md](references/postgres.md): servers that share data; people who see only their own (dzql, delta's Postgres)
- [references/thin-client.md](references/thin-client.md): the page drawn on the server, the order app on dzql's thin client (after postgres.md)
- [references/auth.md](references/auth.md): sign-in with no passwords: a link is someone; in development, pick who you are
- [references/http.md](references/http.md): HTTP routes, and files in S3
- [references/build.md](references/build.md): a production build (optional)

A block's first line names its file: `// src/x.ts` is the whole file; `// src/x.ts: after <text>` (or `before`, `in place of`) goes at the first line holding that text, at its indent; `// CLAUDE.md: under its heading` is the whole file but its first line, the heading that names the app. A block that holds a fence of its own is fenced by four backticks. A `sh` block's `bun add` and `rm` lines are run.
