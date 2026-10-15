# Changelog

How dzql got here. Newest first. Versions are those of the `dzql` package on npm;
`create-dzql` shares the version number from 0.6.

## The short story

1. **September 2025: an idea.** Database-first CRUD, permissions, notifications and graph
   rules as PostgreSQL functions, driven by a small server.
2. **November 2025: the interpreter (0.1 to 0.5).** Published as `dzql`. Generic SQL
   functions read entity metadata at runtime. Live-query subscriptions arrived in 0.2.
   A first compiler appeared beside it in 0.1.4 and slowly reached parity.
3. **December 2025: the rewrite (0.6.0).** A TypeScript compiler, developed as `tzql`,
   turns a `domain.ts` into static SQL, a runtime manifest, a typed client and stores.
   From 0.6.2 it was published as `dzql` and the interpreter became `dzql-legacy`.
4. **January 2026: hardening the compiler (0.6.x).** The `create-dzql` template,
   trusted publishing from GitHub Actions, list subscriptions, temporal entities.
5. **October 2026: review and consolidation (unreleased).** A security review, a
   rewritten permission path compiler proved against a real model, and one package:
   the interpreter and the `tzql` name are gone.

---

## [Unreleased]

October 2026. Merged to `main`, not yet published. Pull requests #8 to #13.

### Breaking

- **An empty or missing rule list denies everyone**: `view`, `create`, `update`,
  `delete` and `canSubscribe`. Before, an empty list allowed everyone (including
  anonymous users), though the docs said both "deny all" and "logged-in users only".
  Write `['TRUE']` for public and the new `['AUTHENTICATED']` for any signed-in user.
- **A path the compiler can't compile is a build error**, naming the entity, the
  action and the rule. That covers bad syntax, unknown tables and columns, and start
  fields that aren't integer keys. Before, such rules compiled to `FALSE` with a
  warning, and an unparseable `canSubscribe` fell back to "any signed-in user".
- **`@field` in `canSubscribe` means the root row's field equals the user**, as it
  does everywhere else. It used to mean membership through a hard-coded `acts_for`.
- **A list subscription's `canSubscribe` may only be `TRUE`, `FALSE` or
  `AUTHENTICATED`**: a list has no root row for a path to start from.
- **An update must pass its rule on the stored row and on the row after the
  change.** An owner can no longer hand a row to someone else through `save`, and a
  member can't move a row into an org they don't belong to.
- **Pushes for a subscription reach only subscribers who may see the row.** The
  runtime calls a new generated `<name>_can_receive` before every push.

### Security

- `search_*` validates filter and sort columns against an allow-list. This closes an
  ORDER BY injection and an oracle on hidden columns (#8).
- Update permission is checked against the stored row, not the request body; a
  non-owner could take over any row by putting their own id in the body (#9).
- The JWT secret fails closed in production; `register_user` only sets allowed
  columns; FK and many-to-many expansion and subscriptions no longer leak hidden
  columns; realtime pushes re-check access (#10).
- List subscriptions return only the rows each subscriber may view, in the initial
  fetch and in every push (#11, #12).

### Permission path compiler (#11)

Found by compiling a real model's 204 rules: 31 compiled to `FALSE`, 15 silently
dropped `role=owner`, and create/update/delete enforced only the first rule in a list.

- Filtered middle hops (`->occasion_promoters[occasion_id=$].promoter_id->`) compile
  to nested `EXISTS`, following every matching row.
- `[org_id=$,role=owner]` reads every condition.
- Every rule in a list is enforced: any one of them grants access.
- One compiler serves permissions, `canSubscribe` and notifications.
- A rule that checks its own table no longer shadows the row being checked.
- `search_*` escapes quoted values in its view rule; `lookup_*` compiles its view
  rule against the alias it queries.
- Every path is checked against the domain at build time (`compileDomain`).
- An entity whose only column is its key generates valid save SQL.

### Repository

- One package: the interpreter (`dzql-legacy`, never published under that name) is
  removed and `packages/tzql` moved to `packages/dzql`, so the folder, the npm name
  and the release tags all say dzql (#13).
- The Python version (`blueshed-dzql`) and the `modeling-dzql` app are archived
  off GitHub.
- The full-stack test fails when its example doesn't compile, instead of skipping.
- `.env.sample` names the token variable the client actually reads
  (`DZQL_TOKEN_NAME`).

---

## 0.6: the compiler

### 0.6.32 to 0.6.37 (26 January 2026)

- Path expression improvements and temporal entities.
- Security and performance fixes from a review.
- `search_*` and `lookup_*` return `SETOF jsonb`, for streaming.

### 0.6.25 to 0.6.31 (19 to 20 January 2026)

- Client `disconnect()`; the compiler reports its version from `package.json`.
- `search_*` binds `p_user_id` in its dynamic SQL.
- Entity notifications compile to `<entity>_notify_users` functions.
- Subscribable `root.key` must match a param; list subscriptions (no `root.key`).

### 0.6.17 to 0.6.24 (6 January 2026)

- TypeScript types preserved for auth, subscribables and custom functions.
- Auth follows the `_profile()` pattern with individual params.
- `get_*` expands foreign keys from `includes`.
- Entities are created in foreign-key order; circular foreign keys are added in a
  second phase.
- The permission compiler accepts several filter conditions; graph rules accept string
  params.

### 0.6.10 to 0.6.16 (3 January 2026)

- invoket integration for CLI task automation (`dzql/namespace`).
- `useDzql` syncs user state when the connection is ready.
- The test script manages its Docker database.
- Notifications for list subscriptions without params; save events include FK
  expansions.

### 0.6.2 to 0.6.9 (1 to 2 January 2026)

- Published as `dzql` from GitHub Actions with trusted publishing (OIDC). Tags are
  `dzql@X.Y.Z` and `create-dzql@X.Y.Z`.
- The `create-dzql` template (`bun create dzql`).
- Fixes for list subscriptions, auth user id and WebSocket realtime connections.
- A logger with access logging; TypeScript strict mode.
- The repository pruned of obsolete packages; generated `dist` removed from git.

### 0.6.0 (29 to 30 December 2025)

- The rewrite. A TypeScript compiler, developed as `tzql`, compiles `domain.ts` to
  PostgreSQL functions (CRUD, search, lookup, subscribables, notifications, graph
  rules), a runtime manifest, a typed WebSocket client and stores.

---

## 0.1 to 0.5: the interpreter

The `dzql` package on npm up to 0.5.33. Generic PostgreSQL functions read entity
metadata at runtime; a compiler grew beside them from 0.1.4.

### 0.5 (30 November to 16 December 2025)

- **Breaking:** auth functions take an options parameter; `users.name` removed.
- Composite primary keys in save, get and delete.
- Multi-hop permission paths.
- Atomic updates for subscribables; the schema and scope tables are embedded in the
  compiled subscribable result; "via" relations.
- DELETE events carry the full deleted row, for subscription resolution;
  `_affected_documents(table, op, data)` takes one data parameter.
- `db:init` and a quickstart guide.

### 0.4 (22 to 27 November 2025)

- `DzqlNamespace` exported for use in other projects; the CLI runs in compiled mode.
- The compiler reaches parity with the interpreter: notify actions and conditions in
  graph rules, custom field defaults, temporal filtering.
- Dynamic `_profile`; `register_user` accepts extra fields.

### 0.3 (20 to 21 November 2025)

- Field defaults, custom function pass-through, many-to-many relations (with junction
  sync in compiled operations).
- A migration CLI (`migrate:new`, `migrate:up`, `migrate:status`).
- A PostgreSQL-based test suite.
- Soft-delete filtering in search and lookup; CASCADE, SET NULL and RESTRICT graph
  rules.
- The event model simplified: events carry `pk` and `data`, no `before`/`after`.

### 0.2 (18 to 19 November 2025)

- **Live query subscriptions**: subscribables, compiled to SQL, with server handlers,
  event listening and client integration.
- A metadata-driven Vue admin client ("DZQL Air").
- SSL for Heroku; configurable JWT storage key.

### 0.1 (2 to 17 November 2025)

- First published as `dzql` (0.1.0-alpha.1, 2 November).
- Graph rules with validation and function execution; CI.
- A fix for graph rules running twice and a search permission bypass (0.1.3).
- **The first compiler** (0.1.4, 16 November): entity definitions to PostgreSQL, with
  permission and notification paths, graph rules, search operators and password auth.
- Canonical Pinia stores (0.1.6).

### Before npm (September to October 2025)

- A first pass at the API: permissions and notifications, a monorepo, graph rules,
  composite primary keys. Named dzql on 11 September 2025.
