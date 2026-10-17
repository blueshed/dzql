---
name: evolve
description: "Grows this app from its stories: a new shared document, two documents on one page, keeping documents in SQLite (rows shared between documents, undo and history) or Postgres, a schema change on a database that holds data (a migration), sign-in by link with no passwords, HTTP routes for what isn't communication (health, status, files in S3), and a production build. Use when the user asks for something people share, see or act on, for storage beyond a JSON file, for undo or history, for a change to a schema in use, for people signing in, for files, or for a build."
---

# Growing the app

**Documents are how people communicate.** A document is what someone needs in front of them to take an action: to place an order, the catalogue and their order (two documents on one page); for the kitchen, every open order (another document over the same rows). Open one and you're subscribed: every change anyone makes reaches you. Change it with add, replace or remove on a path, and everyone holding it sees it at once.

**Think in documents, not entities.** Ask "what does someone need in front of them to do this?", not "what are the tables?" The tables follow from the documents.

**Storage grows; the page does not.** A shared JSON document does a lot on its own. SQLite earns its place when documents share rows, or for undo and history. Postgres when servers share the data, or people should see only their own. The page and its documents stay the same as the storage grows.

## Order of work

```
- [ ] Write what the user asked into stories.md as stories: sentences someone could call true or false
- [ ] Ask what someone needs in front of them to make each true: those are the documents
- [ ] Copy the closest reference below (each says when it is the one), or message / status in src/resources/
- [ ] A test named for each story: what a person sees and clicks (a refused change included), and every route and method
- [ ] bun test (100% coverage) and bun run typecheck
- [ ] CHANGELOG.md under [Unreleased]; in todo.jsonl the item settled marked fixed, or one for what is left open
```

## Invariants

- Anything people share is a document from the start, as `message` is. HTTP routes serve only what isn't communication: health, files, `status`.
- A resource is `src/resources/<name>/`: `<name>-api.ts` (server side, and the type both sides share), `<name>.ts` (the document it opens, or what it fetches), `<name>-view.tsx`. Wire the server side in `src/server.ts`, the view as a route in `src/app.tsx`.
- A document is never set in the page: `send` the change, and the change that comes back draws it, in this window too.
- A row is addressed by its id, never its position.
- The schema is the contract: a database may hold more than it declares, never less. Its tables are made by its migrations, from empty: every change to the schema is the next migration, written by `bunx @blueshed/delta migrations make`; one that has run is never edited.
- The client imports a shared type with `import type`, so no server code reaches the browser.
- Coverage stays at 100%: write the missing test, never lower the threshold.

## The types

delta's are in `node_modules/@blueshed/delta/src/`: `server/server.ts` (`registerDoc`), `client/client.ts` (`openDoc`, `connectWs`), `core.ts` (`DeltaOp`), `schema.ts`, `server/changes.ts` (a migration's changes), `server/migrate.ts` (`Migration`), `server/auth-link.ts`, and a file per backend under `server/`. The app's: `startServer` in `src/server.ts`, the page helpers in `tests/browser.ts`. The `delta-doc` skill is delta's manual; `railroad` is the page's.

## References

Each leads with its example: code and tests, proven by applying them to a new app and running its tests.

- [references/document.md](references/document.md): a new shared document (notes: add and remove)
- [references/testing.md](references/testing.md): the document in the browser: two windows, a refusal
- [references/two-documents.md](references/two-documents.md): the catalogue and an order on one page
- [references/sqlite.md](references/sqlite.md): documents that share rows (the kitchen), undo and history
- [references/migrations.md](references/migrations.md): a schema that changes on a database holding data
- [references/postgres.md](references/postgres.md): servers that share data; people who see only their own (dzql, delta's Postgres)
- [references/auth.md](references/auth.md): sign-in with no passwords: a link is someone; in development, pick who you are
- [references/http.md](references/http.md): HTTP routes, and files in S3
- [references/build.md](references/build.md): a production build (optional)

A block's first line names its file: `// src/x.ts` is the whole file; `// src/x.ts: after <text>` (or `before`, `in place of`) goes at the first line holding that text, at its indent.
