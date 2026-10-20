---
name: delta-doc
metadata:
  version: 1.3.0
description: "Use in a project that uses @blueshed/delta (it is in package.json): documents, their three op verbs, storage in a JSON file or SQLite (Postgres: dzql), migrations, sign-in by link, who may open what, the ledger and undo, createLocal(), and the wire a client speaks."
---

# delta-doc

**A document is what someone needs in front of them to act.** To place an order: the catalogue
and your order, two documents over shared rows. Open one and you are subscribed; change it with
`add`, `replace` or `remove` on a JSON Pointer path, and everyone holding it sees it. What grows
is where they are kept (a JSON file, SQLite, Postgres on dzql); the client stays the same.

**The shape**: an app is routes and resources on both sides of the socket, joined by documents:
delta's `serve` (the one server) serves the server's, railroad's `routes()` draw the client's.
Entities (`defineSchema`'s collections) are behind the documents. Think in documents; the tables
follow.

## Order of work

1. **Name the documents**: for each thing a person does, what must be in front of them.
2. **Declare them**: `defineSchema` (tables, `parent` chains) and `defineDoc` (prefix, root,
   include, scope), imported by server and client (in a paintbrush app, each resource's `<name>-api.ts`).
3. **Keep them in the smallest backend that fits** (the JSON file first), on `createWs()` served
   by `serve` / `run` (`reference/server.md`), or on `createLocal()` (in-process).
4. **Client**: `connectWs`, `openDoc`, one keyed render path, `doc.send(ops)`. The echo renders.
5. **Test it**: a test of the documents, two people on a real server (`reference/recipe.md`,
   *Its test*). Done is `bun test` passing.
6. **Grow when a story needs it**: `{ ledger: true }` for undo, `auth` and `owns` for who sees
   what, a migration per change to the tables, dzql when servers share the data.

## Invariants

- Three verbs only, on `/<coll>/<id>[/<field>]`. A replace of a row is
  the whole row (left-out fields take defaults); to change fields, replace each field.
- A batch applies whole or not at all.
- New rows are `add /<coll>/-`; the server names the id. Address rows by id, never position.
- Never update optimistically, never reload: `doc.send` echoes back through `doc.data`, and a
  reconnect re-opens every document itself.
- One render path, keyed: railroad's `list()`, never a rebuild from `doc.data` in an `effect`. A
  told replace may be one field: never assume a whole row.
- Undo is the ledger's (`{ ledger: true }`), never a hand-rolled stack.
- A line is a row under its parent, never JSON of ids; a fact from other rows is a recompute
  document, never a stored copy; "one at a time" is `unique` (`schema.md`).
- The schema is the contract: delta sends and writes only declared columns. An app's tables are
  made by its migrations: change the schema, `delta migrations make` writes the next, `migrate`
  runs it. `createTables` is for a database thrown away (`:memory:` in a test).
- With `auth`, every document says who may have it: `owns`, a path from its row to the person,
  or `shared: true`. A name is its broadcast channel.
- Tokens never in the socket URL (`connectWs(url, { onConnect })`). No Redux, REST, `fetch` of
  state or React patterns: `doc.data` is a signal.

## The types are the contract

In the package (`node_modules/@blueshed/delta/`): `src/` (`core.ts`, `schema.ts`, `client/`,
`server/`, `paths.ts`), and the exports map in `package.json`.

## Which reference for which job

- First app: `reference/recipe.md`. Storage: `reference/backends.md`, `reference/sqlite.md`,
  `reference/postgres.md`; upgrading, data kept: `reference/migrations.md`.
- JSON Pointer paths, ids, error codes: `reference/paths.md`. Tables: `reference/schema.md`.
- Document shapes: `reference/documents.md`; names and filters: `reference/scope.md`.
- What a write may do: `reference/writes.md`; who is told: `reference/fanout.md`.
- Derived views: `reference/custom-docs.md`. Other kinds: `reference/kinds.md`.
- The page: `reference/rendering.md`, `reference/write-loop.md`. The server: `reference/server.md`.
- Sign-in: `reference/auth.md`. Who opens what: `reference/ownership.md`.
- Undo and history: `reference/ledger.md`. In-process: `reference/local.md`.
- The wire: `reference/wire.md`. CLI: `reference/cli.md`. Tests and scripts: `reference/testing.md`.
