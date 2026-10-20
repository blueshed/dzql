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
5. **October 2026: review and consolidation (0.7.0).** A security review, a
   rewritten permission path compiler proved against a real model, and one package:
   the interpreter and the `tzql` name are gone.

---

## [Unreleased]

### Breaking

- **Undo and Redo are drawn only when the page asks for them** (20 October, root #126). dzql's
  `bento({ icon, session, undo, leave })` draws the page's tools it is given, as railroad's
  `bento({ undo, redo, leave })` always has: `undo: true` draws Undo and Redo (writes to the
  ledger), `leave` the way out, and with neither, `pageTools()` is `""` and a box has no tools
  beside its trail. So a page keeps its tools as it moves from the light client to the thin one.
  To move across: an app whose documents are on the ledger says `undo: true` in its `surfaces.ts`.
  The five examples do, and their stories pass at the same counts.

- **Where data lives is the data folder, one way in both starters** (20 October, root #129).
  `openStore`'s `open({ dataDir })` keeps PGlite in the folder's `pg/` (`DATABASE_URL` a server
  in its place, `database` whatever the folder; none, or `:memory:`, in memory), and `appOf(app, {
  dataDir })` opens it there; `PGLITE_DIR` is no longer read. An app's `startServer` takes
  `dataDir = process.env.DATA_PATH ?? <app>/data` (a Railway volume when `DATA_PATH` is set),
  as paintbrush's always has, and a test gives a scratch folder, or says `DATA_PATH=:memory:` in its
  `.env.test`. Opened by a second server on another folder, a store open on one refuses. To move
  across: `PGLITE_DIR=data/pg` goes from `dev` and `start`; `startServer` takes `dataDir` and
  passes it to `appOf`; `.env.test` says `DATA_PATH=:memory:` in place of `PGLITE_DIR=`. The cafe,
  create-dzql's template and dzql's own `.env.test` follow.

- **A server opens the app's store as it starts and closes it as it stops** (20 October, root
  #119). `openStore` (`dzql/postgres`) says the store and opens nothing: the database is opened,
  migrated and its documents compiled and served at `open()`, closed at `close()`, and opened again
  after. `appOf` and `createServer` (`dzql/rendering/server`) are async: `await appOf(app)` opens
  `Example.store` when it opens (Postgres's) and the app's `close` closes it once the server has
  stopped; `createServer`'s `stop` waits for that. Two servers of one app at once hold one store,
  closed by the second close. So a test runs servers one after another in one process, and under
  `bun --hot` the last store is closed before the app, run again, opens the next: the ids carry on
  (1, 2), where a folder opened twice was recovered as after a crash (1, 34;
  `tests/rendering/store.test.ts`). A listener ended answers nothing, so a store's next listener
  serves on the same `delta`; a kernel's copy of the documents is let go with its last server. To
  move across: `serve(appOf(app))` becomes `serve(await appOf(app))`, `createServer(...)` becomes
  `await createServer(...)` (a test's `beforeAll` async, its server typed
  `Awaited<ReturnType<typeof createServer>>`), and `run(() => serve(...))` becomes `run(async () =>
  ...)`; in `store.ts`, `export const store = openStore({ ..., prepare })` (no `await`), where
  `prepare(pool)` is what `open(prepare)` was (the seed), and `export const { pool, delta, register }
  = store`; the app gives `store` (not `stories`) as its `Example.store`; the top-level `await
  open()` goes; a guard goes on `delta` as the module loads, before any listener. `store.pool` is
  the open store's pool, and rejects while it is closed.

- **The stories are keyed, one form in both starters** (`dzql/modelling/stories`, 20 October,
  root #118). `Stories.stories` is a record, each story under a key of its own, in the order told:
  one with a body the harness tells, one with none yet (`story(name)`) a test of the app tells,
  named from its key. `Stories.unproven` is gone, and `untold(stories, sources)` takes the
  `Stories` and checks only the stories with no body. So a paintbrush app's stories.ts is the file
  the harness reads, and a story gaining its body is the same line, under the same key: no test is
  renamed. `toldOf(stories)` and `unprovenOf(stories)` give the two kinds as lists; `hasBody`
  tells one from the other. The harness's counts are unchanged (`bun run stories:all`: 24, 14, 25,
  17, 22 and 14). To move across: `stories: [ story(...), ... ]` becomes `stories: { key:
  story(...), ... }`, and the file ends `} satisfies Stories;` so a test's `stories.stories.<key>`
  is checked; each `unproven` entry goes among the rest, under its key; `untold(record, sources)`
  becomes `untold(stories, sources)`; a list read from `stories.stories` is `toldOf(stories)`.
  Every example, the model's page and create-dzql's template follow.

- **The starter is create-dzql's template now, not `examples/starter`** (20 October, Peter's
  decision: the two starters follow one pattern). `packages/dzql/examples/starter` is gone; the
  starter and create-dzql's skeleton are one app, `packages/create-dzql/template/`, laid out as a
  new app is: `stories.ts` at its root, `src/` (`routes.ts`, `store.ts`, `page.ts`, `icons.ts`,
  `index.html`, `main.ts`, `styles.css`), `tests/routes.test.ts`, beside its package.json
  (`dzql-starter`, a workspace), tsconfig, README and CLAUDE.md. Its styles import
  `dzql/rendering/bento-plain.css` by name, as an app's do. `ETA_EXAMPLE=starter` names nothing
  now: the starter's stories run in create-dzql's tests (the template's own `bun test`, and a new
  app's), not in `bun run stories:all`, and its tests leave `bun run test:coverage`. To move
  across: read the starter at its new path; `bun create dzql` makes the same app as before. The
  dzql-app skill's `where-an-app-lives.md`, `CLAUDE.md` and `tests/readme/exports.test.ts` (which
  now reads both starters, their templates too) follow it.

- **Each tab has its own screen, and a page has a real URL** (20 October, #53, #57, Peter's yes):
  where you are is the tab's, not the session's. `Example.render(sessionId)` is
  `render(sessionId, address)`: the address of the tab being drawn (`list?request=3`, "" for the
  page alone), so two tabs of one session stand on two screens, and a write in one still reaches
  the other wherever it is. `Example.address` (`{ doc: "session", path: "/page" }`) is still the
  write that moves a tab, and `go()`, `site()`, `data-page-write`, the client's history and the
  stories' `goTo` are unchanged: the session's resource permits and shapes it as before (where this
  session may stand), then the kernel takes that op off the write and moves the tab that sent it,
  never writing it; a write that only moved its tab is answered by an echo of nothing, and no
  `afterWrite` follows it. A GET of a page's path is that tab's first page: the socket names the
  address (`/ws?at=`), and the tab -- not the session -- is put there before it is drawn, so a
  link, a bookmark or a reload opens on its screen and leaves the session's other tabs where they
  are; a refused one stands at the page alone. New, `dzql/rendering/tabs`: `addressOf(ws)` (where a
  tab stands) and `moveTab(ws, address)` (what follows a write: a modal answered put away, a made
  request's drawer opened), and `Tab`. What is per tab and what per session is in the dzql-app
  skill's `reference/bento.md`: what a page reads follows its tab's address; `resolveDoc`, who you
  are and what is yours (a draft, a watchlist, how you read a list, what you were last told) are
  the session's. The wire carries the same messages (`WIRE` stays 4).
  To move an app across: give `render` the address and draw from it, never from the session (`site(
  address, ...)`); drop `page` from the session's document and its table (an existing database may
  keep the column, unused, or drop it with a migration of its own); pass the tab's address to the
  session's `shape` where it compares with where you are (`{ ...read(id), page: addressOf(ws) }`);
  and where `afterWrite` or `afterWalk` wrote the session's `/page` with `serverWrite`, call
  `moveTab(ws, address)`. Every example, the model's page and the starter have moved; the kernel's
  `Assembled.page` and `draw` take the address too.

- **`loadDocAt` is gone from `dzql/postgres`** (20 October, root #37): it read `delta_open_at` with
  no identity, beside the listener's `open_at`, which asks `owns` and reads as the person. To move:
  `open_at` on the socket (`{ action: "open_at", doc, at }`, or `local.call("open_at", { doc, at })`),
  or a type's `openAt` (`docTypeFromDef(def, pool).openAt({}, name, at)`), or in SQL
  `delta_open_at_as(user, name, at)`.
- **Framework SQL older than 0.11.0 is no longer read around** (root #37): the listener read the
  log with `delta_fetch_ops` where `_delta_fetch_log` was missing, and walked with 0.10.0's
  five-argument `delta_walk`; neither is reachable since 0.11.0 bade every database re-apply
  `001*` (and `generateSql` now calls 001b's `_delta_govern`). Re-apply the framework, then
  `generateSql`, after upgrading, as `docs/postgres/postgres.md` says.
- **`generateSql` no longer writes rows into `_delta_docs`** (root #37): nothing has read them since
  0.11.0 (`_delta_find_doc` is compiled); the table stays, for its row type. A query of your own
  that read it: ask `_delta_find_doc(name)`.

- **Row-level security, derived from the documents' paths, is the backstop beneath them** (20
  October, #19). `generateSql` gives each table every document holding it says by a path (`owns`
  as a string) RLS enabled and forced, and one policy, `dzql_owns`, whose `dzql_may__<collection>`
  asks whether the person (`app.user_id`) may have a document that holds the row; the compiled
  reads and writes run as the caller beneath it, so a bug in one of them leaks nothing the paths do
  not give. What reads past it is the owner's and answers only yes, no or a name: the policies'
  lookups, `dzql_owns__<doc>` (now `SECURITY DEFINER`) and the fan-out, `_delta_holders`, which
  still finds who holds a row the writer may not read and tells them, worked out as the writer from
  the rows the write itself touched. They raise `dzql.definer`, which each policy lets past for the
  table's owner alone. **What an app on such a table must now do, unless its pool is a superuser
  or `BYPASSRLS`** (PGlite's, the compose database's: nothing changes there): re-apply the
  framework before `generateSql` (it calls 001b's new `_delta_govern`), as the role that owns the
  tables; give `auth` an `asSqlArg`, so every document call binds `app.user_id`; and bind it
  (`withAppAuth`) in a custom document's `query` or `recompute`, and in any query of its own on
  such a table, which otherwise reads as empty. `exportTables`, `importTables` (one transaction
  each now) and `migrate` act as the owner, past the policies. A table some document holds with
  no path is left as the app set it. `docs/postgres/rls.md`; `tests/compile/policies.test.ts`,
  `tests/delta-pg/rls-backstop-pglite.test.ts` (a compiled check made wrong on purpose, refused),
  and delta's permission cases as a role RLS holds.

- **The model's page signs in by link alone** (20 October, #62): the email and password form, its
  `/login` route, the `mdl_logins` table and `MODEL_PASSWORD` are gone. Each keeper's link is
  printed as `dzql model` starts; the CLI signs in with it (`bun run cli login <link>`).

- **Every app is `routes.ts` exporting `app`** (20 October): the examples (chat, leave, ticker,
  wedding) and the model's page moved from `index.ts` exporting `example`, as the cafe, the starter
  and every `bun create dzql` app already were; each serves itself (`bun examples/<name>/routes.ts`).
  `appIn` reads `routes.ts` alone and `src/rendering/start.ts` is gone. To move an app of the older
  shape: rename `index.ts` to `routes.ts` and its `example` to `app`.

- **Exports nothing imported are gone** (19 October): `dzql/modelling/definitions`, `dzql/rendering/cli`
  (importing it ran it), and dzql/postgres's re-export of delta's auth (`DeltaAuth`, `wireAuth`,
  `upgradeWithAuth`, `isAuthError`...): take those from `@blueshed/delta/auth`.
- **`generateSql`'s options are `{ from }`**, the module the definitions came from (`header` and
  `regenerate` are gone); the compiled file carries no date, so the same definitions make the same file.
- **A document's reads are its compiled functions**: one `generateSql` did not compile is not read
  through `delta_open` (which could only refuse); its read fails on the missing function, by name.

- **An island is an applet** (19 October, Peter: "we agreed on applet"): `dzql/rendering/island` is
  `dzql/rendering/applet`, and `island(render, reduce?)` is `applet(render, reduce?)`, an applet
  drawn by railroad. To move: `import { applet } from "dzql/rendering/applet"`. railroad is still
  needed by that module alone.

### Changed

- **The cafe's staff hold only what is open** (20 October, dzql #81): scope.md's rule, shown
  working. The floor held every table with every invoice and order the cafe ever took, the manager's
  and the cook's both. Now the model's `floor` is the tables alone (the manager's), and a new
  `kitchen`, a list of the orders, is scoped by the app as it registers it to what is not yet
  placed (`kitchen:placed`, `{ status: "!=:id" }`): the cook's orders and the manager's ready to
  take. Placing an order at its table takes it out, and every page that read it is told; paying
  for it changes nothing there. A table's invoices are its own document's (`table:1`), which the
  manager now holds too, to seat it and to place an order there; an order names its table
  (`table: door:/tables`, `table_id`, migration `003-orders`), as a kitchen ticket does, so the
  kitchen says where each goes by the door's names. Driven by the story "Ann pays her invoice
  before her Soup comes, and Mo sees Table 1 free; Kit, still cooking it, is not told", which
  failed while Kit held the floor; "Mo takes Ann's Soup ... and it leaves the kitchen" says the
  rest. Still 24 stories, all done by hand too. `scope.md`'s `Working:` names it.

- **An app with no applets and no tools has no `main.ts`** (20 October, root #37). Its
  `index.html` loads the kernel's client itself, `<script type="module"
  src="dzql/rendering/client/app"></script>` (Bun bundles a package's entry named there, in
  development and in a build alike); a `main.ts` is kept only to register an app's applets or opt
  into tools, the client imported last. The cafe's and create-dzql's template's `main.ts` are gone,
  and the README's rendering app is two files; chat (tools), leave, ticker, wedding and the
  model's page (applets) keep theirs. The dzql-app skill says it (`applets.md`, `example.md`,
  `where-an-app-lives.md`). Nothing breaks: an app's `main.ts` that only imports the client may go
  the same way, or stay.
- **dzql's browser tests are on one kit, its own** (20 October, root #37): the README's browser
  test moves from railroad's `browser()` to `dzql/rendering/webview` (Chrome, a host per window, a
  press as a mouse makes one), as every other browser test of dzql's and its examples' is. railroad
  stays a dev dependency, for `dzql/rendering/applet` alone, and no package needs another.

- **Typing not yet sent is kept after the caret leaves it** (20 October, root #125). The morph
  kept what a field held only while someone was in it, so a save from another window drew over
  words typed and left in a box. Now a field (an input, a textarea) that differs from what was last
  drawn into it keeps what it holds, in it or not, until it is sent and drawn, or typed back to
  what was drawn; one that holds what was drawn follows the page, as before. The light page's
  drawer always did (`tests/rendering/client/app.test.ts`). Nothing to move across.

- **A write the store refuses says why, whatever refused it** (20 October, root #123). The kernel
  told a store's 403 and 401 and refused the rest without a word, so a value the schema does not
  take (400) was handed back with nothing beside the control. Now any 4xx is a refusal with words,
  drawn by `toldAt` like any other: the guards' (403, 401) as before; any other in the resource's
  own, `refused` on the `Resource` (`refused: "Not saved"`), else delta's ("text must be a
  string"). The wire is unchanged (`WIRE` stays 4): a `refused` answer carries a reason more
  often. Nothing to move across; a page that draws `toldAt` beside its control shows the words.

- **A schema's refusal is worded as delta's SQLite words it** (20 October, root #132): the op's
  path, then why, in delta's case. Postgres said `text must be a string`, `invalid op: remove
  /messages/1/text`, `Unknown field: other (not a column of messages)`, `unknown collection:
  other`, `op collection "x" is not part of doc ...`, `a row value for x must be an object`, and a
  null into a column that takes none was the database's `violates not-null constraint`; it now says
  `/messages/1/text: text must be a string`, `/messages/1/text: Invalid op: remove
  /messages/1/text`, `/messages/1/other: Unknown field: other`, `/other: Unknown collection:
  other`, `/x/-: Add value must be an object`, `/messages/1/text: text cannot be null`, and an
  empty path, a whole collection and an add of a single document's root are refused as SQLite
  refuses them (`Empty path`, `Whole-collection ops are not supported: ...`, `Root supports replace
  only`); a field of a row's value after the field's path, several of one kind joined by `; `. The
  codes are as they were (400). The checks take the op's path (`_delta_assert_fields`,
  `_delta_assert_fields_declared`, `_delta_whole` and `_delta_row_id` gain it; their first forms
  are dropped as the framework is applied), and `compileColumns` writes the compiled checks in the
  same words (snapshot updated). delta's `refusalCases` asks each, on PGlite and the server
  (`tests/delta/writes.test.ts`); the tests that matched part of the old words match the whole
  sentence. `validateOps` (`dzql/postgres`) says a row's id as a field, a row id past 2^53 - 1 and
  a parent key that is no id as `delta_apply` now does.

- **A document's refusals, and an op wrong in several ways, are worded as delta's SQLite words
  them** (20 October, root #134). A row the document does not hold was `row not found:
  case_messages/404` (and `root row not found: case_rooms` for a single document's root gone
  mid-walk); it is `Row not found: case_messages/404`, `Row not found: case_rooms/1`, and the
  same for a parent not there or not the document's and for a row the write would take out of its
  document (`Row not found: ... -- the write would take it out of ...`). An add of another root
  row through a single document was `invalid op: add /case_rooms/- -- document case-room:1 holds
  one case_rooms, its root: add it through a document that lists them`; it is `case-room:1 holds
  case_rooms 1 alone: add another case_rooms row through a document that lists them`, asked after
  the value, as SQLite asks it. `id already taken: ...` and `document not found: ...` are `Id
  already taken: ...` and `Document not found: ...`. An op wrong in several ways was told the
  refusals of the first kind met (unknown fields, else the values, else what it left out, which an
  add asked only after its parent); it is told every one, joined by `; `, in delta's order: the
  fields there are not, then each value not as it may be written, then each required field left
  out, each kind by name (`COLLATE "C"`). So the checks take what a value leaves out:
  `_delta_assert_fields` and `_delta_assert_fields_declared` gain `p_missing` (from the new
  `_delta_missing`), `_delta_whole(p_columns)` only blanks a row, and their earlier forms are
  dropped as the framework is applied; `compileColumns` writes the compiled checks so (snapshot
  updated). The codes are as they were. delta's `errorCodeCases` and `writeScopeCases` now ask the
  whole sentence, and `refusals` an op wrong in several ways, on PGlite and the server.
  `validateOps` (`dzql/postgres`) keeps in step: every refusal of a value in that order (a whole
  row's type after the field's path), an add asked its id past 2^53 - 1, its value, then whether
  it is another root (in delta's words, naming the document), then an id that is no number;
  `tests/delta-pg/path-pglite.test.ts` asks that its sentence is `delta_apply`'s for each.

- **The ticker's city picker takes its row apart** (20 October, railroad's #6): a keyed `list()`
  row is its fields now, so `examples/ticker/applets/city-picker-applet.tsx` reads `({ tz, label },
  i$)` in place of `z$.peek().tz` and `z$.map((z) => z.label)`.
- **Each reference page of dzql-app and modelling says where its rules are shown working** (20
  October, root #114): a line starting `Working:`, linking an example on GitHub (cafe, chat, leave,
  ticker, wedding, create-dzql's template). `scope.md` shows only part of its rule working and
  names #81 for the rest.
- **Every app is routes and resources** (20 October, Peter's decision): the examples on SQLite are
  laid out as the cafe is, as `bun create dzql` lays an app out. Chat first: `delta.ts` is
  `store.ts` (the tables, said once, the database, `delta`, `migrating`, a `register` for each
  resource's documents, and the sessions, with the `visit:` a cookie finds its session by); each
  document a folder, `resources/<name>/` (`session`, `room`, `here`, `lobby`), holding its
  `<name>-api.ts` (its document registered, `read`), its resource and its `<name>-view.ts`; `page.ts`
  composes the views, `surfaces.ts` makes the bento once. `presence.ts` stays at the root: it keeps
  two memory documents from the sessions and the connections, and is no one resource's. The tables,
  the prefixes and the migrations folder are as they were; its 14 stories pass as before. The
  dzql-app skill's documents, resource, page, controls and assistants pages quote the new files.
  The ticker next: `resources/desk/`, `ticker/` (the market, its seed beside it), `quote/`,
  `watchlist/` and `clock/`; `views/page.ts` is `page.ts`, composing the board (the watchlist's
  view), the market (the ticker's) and the clock (the clock's); the default city is said with the
  tables in `store.ts`, a column's default. Its 17 stories pass, with the same 5 warnings.
  Then the wedding: `resources/session/`, `household/`, `board/`, `wedding/`, `welcome/` and
  `everyone/` (the memory document; `everyone.ts`, which keeps it, stays at the root, as chat's
  `presence.ts` does); `views/<thing>.ts` are each resource's `<name>-view.ts`, and `page.ts`
  composes them; what both pages draw (`shared.ts`, `photo.ts`, `html.ts`, `surfaces.ts`,
  `icons.ts`) and `values.ts` sit at the root; the pictures, no document, are kept by `http.ts`,
  which serves them; the seed, the one-claim trigger and the pictures' table stay in `store.ts`.
  Its 22 stories pass, with the same 3 warnings. The model's loader (`extract`) now reads a
  resource's api for code that touches a table with its own SQL, as it read `documents/<thing>.ts`
  (the wedding's couples, looked up by `whose()`, are read there).
  Then leave: `resources/team/` and `resources/session/`, `documents.ts` split between their
  apis and `resources.ts` between their resources; `page.ts` composes the team's view (the
  calendar and the list, a request's drawer) and the session's (the door, the draft's drawer);
  `calendar.ts`, the drawing the server and the applets share, and `signin.ts`, no document's,
  stay at the root. Its tables stay `temporal: false`, the reason beside them, and
  `upgrade.test.ts` still upgrades a database leave's older version left; its 25 stories pass.
  Last the model's page (`src/modelling/page/`): `resources/model/` and `resources/session/`;
  `store.ts`'s `register` keeps a document in the app's model file when it says `inFile` (the model,
  beside an app), the sessions always in memory or the database as before; `heart.ts`,
  `closure.ts`, `site.ts`, `cli.ts`, `signin.ts` and `loader/` stay where they were, no document's.
  `MODEL`, the one model's id, is said beside `Raw` in `heart.ts`, so the loader reading a page
  opens no store. Its 14 stories pass, with the same 2 warnings. The dzql-app skill no longer
  calls the examples older: SKILL.md says they are laid out as the cafe is, on SQLite; dzql's
  CLAUDE.md says the layout in its Project Structure.
- **A ref keeps its surrogate** (20 October, #79, on Peter's design): a row that names a row a story
  can remove keeps, beside the key, what it shows of it, copied as it is written (`dish_name`,
  `dish_price` beside `dish`); the page shows the named row while it stands, and the copy once it
  is gone. The model's check advises it (`ref-surrogate`) in place of a time on the row
  (`undated-ref`, gone); the modelling and dzql-app skills say it. The cafe does it: its orders
  name their dish, migration 002 renames the copy they kept to the surrogate, the manager holds the
  menu (and model story 14 says the manager cannot change it), and two stories more. The model's
  read-back compares a ref by its column (`dish_id`).
- **A story may open a tab** (20 October, #53, #57): `opensTab: "<address>"`, the fourth kind of
  story, as a link, a bookmark or a reload: another tab of the author's session opens at that URL
  and must be drawn standing there, while the tab they had (`from`) stays where it was; by hand, a
  browser opens the URL and must stand there. Leave's two: Ann opens November in a second tab and
  her first stays on October; Mo follows a link to Bo's request and his new tab opens on its
  drawer. The harness holds each member's own socket (one session may have several), the tap names
  each socket apart (`X-Tap`), a post's redirect opens its tab where the route sends it, and by hand
  an applet's declared write is sent from the browser's own tab, the harness's tab of the author
  following where the browser goes. The model's loader counts `opensTab` stories.

- **The stories say the client's rules for a control once each** (20 October, #60, the review):
  the harness walks a page's controls once for what each offers (`controlsOn`) and what each is
  drawn sending (`writesOn`), a select's options read once for both, each rule beside the
  `form-value.ts` function it follows. What a person can press is `pressable` in
  `src/rendering/client/form-value.ts`, which an assistant's tools import and the stories by hand
  run: their page script takes form-value.ts whole from its source, so a press is parsed and a
  control refused by the client's own code, and only the reason is the script's. The rule's prose
  is the dzql-app skill's `reference/stories.md`; `docs/stories.md` and `assistants.md` link to it.
  `harness.ts` is split by job: `harness/controls.ts` (the page's controls), `harness/applets.ts`
  (what its applets hold and what their props cost) and `harness/paths.ts` (a document's paths),
  1,715 lines to 1,306; `dzql/modelling/harness` exports every name it did.

- **The examples keep their tables' history** (20 October, #52): chat, the wedding and the ticker
  no longer turn it off; what is no history says so beside it (a session or a visit, a login or a
  token, the ticker's quotes). Hand-written SQL reads the standing rows, `current_<table>` (the
  wedding's one-claim trigger too), and the model's page reads `current_<table>` as the table.
  Leave keeps its tables as its migrations made them. The dzql-app skill's documents and scope
  pages quote chat as it is. The cafe's orders naming their dish is #79.

- **The compiler says each case once** (19 October, the review): one `caseOf` and one
  `prefixDispatch` for every dispatcher it writes, so a case with no branches is never written to be
  repaired after (`noEmptyCases` is gone); the serial, the standing view and the name-clash check
  said once. The compiled SQL is the same, to the byte.
- **The model's page is in `src/modelling/page/`, out of `examples/`** (19 October, the monorepo's
  one shape): `dzql model` serves it to every app, so it is shipped code, not an example. Its tests
  are in `tests/modelling/page/`; `files` no longer ships `examples/modeling` (the cafe still ships,
  the worked example the skills point at). An app's `model:check` and `model:load` run
  `node_modules/dzql/src/modelling/page/loader/` (create-dzql's template says so). `ETA_EXAMPLE` takes
  a whole path, which is how `dzql model` names the page; the stories run it beside the examples'.
  Like an example, its lines are said, not held to the kernel's 100%.
- **`model:check` keeps only the hjeli it uses** (19 October, the review): `--against` (comparing
  with another model of the same domain), and with it hjeli's migrations and document-first
  lowering, are gone, and so is what nothing called (`runAll`, `subscriptionClosure`,
  `identityScopedDocs`, the RLS compilation): `examples/modeling/loader/model/` is 1,212 lines, from
  1,656. Swapping its four predicates for the model page's `closureOf` is not mechanical (they read
  a model made from stories, not the page's), and stays open (todo #64).
- **The tests are in `tests/`, out of `src/`** (19 October, the monorepo's one shape, `docs/plan.md`):
  `src/` is what ships. `tests/modelling`, `tests/rendering` and `tests/readme` (the README's,
  once `readme/`) beside the Postgres ones (`tests/compile`, `tests/delta`, `tests/delta-pg`).
  `scripts/tests.ts` runs them, once for the fast tier (`--fast`: no browser, no coverage gate) and
  once whole (`bun run test:coverage`, held to 100%), replacing `scripts/eta.ts` and
  `scripts/fast-eta.ts`, which built one folder list twice; `test:eta` is `test:coverage`, and
  `test:pg` runs only the Postgres folders.
- **Every table the model makes keeps its history** (19 October, Peter: "developers have done the
  least possible because they could not spend the time doing the right thing"). `dzql model` made
  every table `temporal: false`, throwing away delta's default; it makes them temporal now. A row
  removed is closed, never gone, so a ref never dangles: the guards read a row's open version
  (`rowsIn` and `rowsInPostgres` ask `valid_to IS NULL` of a temporal table), so nothing new can
  name a removed row, and what named it still reads it as it stood with delta's `open_at`. A table
  an app's committed migrations made already keeps what they made it (`definitionsOf`, `typesOf`
  and `sourceOf` take the history's state, `Made`), so an app from 0.14 gets no step to finish by
  hand. The cafe's migration is made again from empty (an example, no data). The checks advise a
  time on a row that names another and says none (`undated-ref`). The proof compares a time as the
  instant it names, and a time no story says is a time (`valueOf`, `says`).

### Added

- **`openStore` takes several schemas** (20 October, root #130): `openStore({ schema: [order.schema,
  message.schema] })`, each resource's own, kept as one, where an app spread their `.tables` into
  one; a table two of them declare is refused as the store is said
  (`tests/delta-pg/app-store-pglite.test.ts`). One schema is taken as before.
- **create-dzql's CLAUDE.md and README say what is true of any app in its shape** (20 October, root
  #130): "An app in the shape `bun create dzql` makes", "a new one begins as nothing but its
  page", a test's data in a scratch folder or in memory, the schema one or each resource's. The
  evolve skill's thin-client step carries both word for word, and `scripts/docs.ts` holds the two
  equal.

- **Cmd+Enter or Ctrl+Enter in a textarea sends its form** (20 October, root #124): the client
  submits a `data-write` form from a textarea on either, as a field of one line submits on Enter;
  Enter alone is a new line, and an editing form's textarea (`data-write-on`, its fields writing)
  is left to the browser. The light page's message did it with a handler of its own; now a page
  the server draws does it with none (`tests/rendering/client/app.test.ts`).

- **A test holds an app's documents the same way for either page** (`dzql/rendering/test-socket`,
  20 October, root #121): `documentsOf(from)` is a test's client of an app's documents, as its
  page reads them -- over delta's socket at a server's `/ws` (the light page's: give it the
  server) or over the app's documents in this process (the thin client's: give it the store's
  `delta`). `open(doc)` holds one (`value()`, kept current from what it is told; `send(ops)`,
  answered as delta answers and resolved once its change is told back; `onOps`), `undo()` walks
  the client's last write back, `close()` lets go. A test of a document written against it stays
  as it is when the app moves its page to the server; the page itself is tested in a browser,
  where both pages are the bento's HTML (`tests/rendering/documents-of.test.ts` runs one test both
  ways). `openStore`'s `prepare` is given the data folder the store opens on, where a new database
  finds the rows the app kept before.

- **`registerDocs` on Postgres, one call as on SQLite** (`dzql/postgres`, 20 October, root #37):
  `await registerDocs(ws, pool, schema, docs, customDocs, options)` takes what delta's SQLite
  `registerDocs(ws, db, schema, docs, customDocs, options)` takes (`ledger`, `who`, `auth`, `owns`,
  `shared`; and `namespace`), compiles the documents into the database (`generateSql`) and serves
  them with one listener, refusing as SQLite does, by its name. An app moving from SQLite changes
  its import, in place of `applySql(generateSql(…))` and a `docTypeFromDef` for each document in a
  `createDocListener`, which stay, as its steps. `openStore` serves its documents through it.
  `tests/delta-pg/register-docs-pglite.test.ts`: delta's permission cases through it.

- **Several apps on one Postgres database, a schema each** (20 October, #29): `namespace` on
  `openStore`, `openDatabase` (`dzql/pglite`), `applyFramework`, `applySql` and
  `createDocListener` keeps an app's tables, ledger and compiled functions in a Postgres schema of
  its own, made when it is not there, and its changes are told on a channel of its own,
  `delta:<schema>` (001c's `_delta_channel`; `public` keeps `delta_changes`), so each listener
  hears its own app alone. A listener's lock is keyed by its schema too. On PGlite each query is
  given its pool's path, so several apps share one PGlite. Without `namespace`, nothing changes.
  `tests/delta-pg/namespaces.test.ts`: two apps of one table and one document name, each writing
  and undoing, each told only its own; `docs/postgres/postgres.md`, *Several apps on one database*.

- **`openStore` is the one way to start a store on Postgres** (`dzql/postgres`, 20 October, root
  #108): it takes `database` (a URL or a PGlite folder; else `DATABASE_URL`, then `PGLITE_DIR`),
  `migrations` as a folder (`dir`) or a `list`, and `ws`, the socket to serve the documents on
  (without one, they are served in the process, as before); and it gives `close()`, the listener
  then the pool. The README's server, `docs/postgres/postgres.md`, delta-doc's and the evolve
  skill's Postgres pages teach it in place of the five calls it makes.

- **`openTables`** (`dzql/rendering/db`, 20 October, #62): an app's tables as delta makes them at
  start-up, in one call: its migrations, then a missing table, then a missing column. The examples'
  `delta.ts` and the model's page use it.

- **`cookieOf(req)` and `seeOther(to, cookie?)`** (`dzql/rendering/server`, 19 October): this app's
  session cookie on a request, and the 303 back to a page after a form (setting the cookie when a
  session starts), where each example wrote its own. `walked(way)` (`dzql/rendering/json-patch`) is
  the ledger's walk, one statement for the client, the CLI, the stories and the bento.
- **`storiesIn(dir)`** (`dzql/rendering/names`): an app's stories, beside its code (an example's
  folder) or at its project's root, beside `src/`, as a paintbrush app keeps them; `bun run stories`,
  `model:check` and `model:load` read them by it (19 October).
- **A ref: a field that names a row of a list document, by its path** (19 October). Said
  `holds orders orders dish:menu:/items`: the order's `dish` is a row of the menu's `items`, its id
  the path's last step, kept as `dish_id` (`refOf`, `columnOf`, `fieldOf` in `dzql/modelling/reading`).
  A ref includes nothing, so the checks ask that whoever holds it holds the document it names into
  (`unseen-ref`), that the document is there, holds what it names and is a list (`unknown-ref`), and
  that some story adds the row it names (`unestablished-ref`). A story may presuppose the row a ref
  names (`requires items.on=true` on an order): the guards climb to it along the ref's column, as
  they climb to a parent. The guards say a story that changes a ref of its column, where the write
  lands. `fixtures/orders.json` holds the whole path in the conformance test, and the definitions
  test holds a ref on delta's JSON file, SQLite and dzql's compiled Postgres. The modelling CLI read
  a field's type up to its second colon; it reads all after the first now (`fieldOf`, one place
  for the CLI and the model's page).

### Fixed

- **A story that times out fails alone** (20 October, #78): the stories' SQLite store rolls back a
  transaction a cut-off story left open before it begins the next, so one slow story under load
  no longer fails every story after it with "cannot start a transaction within a transaction".

- **By hand, a refusal whose value no field can send is not tried** (20 October, root #128). A
  `cannot` story whose write a field on the page offers, with a value that field cannot send (a
  number to a date field or to words, words to a number field), was tried with what the field
  sends, which landed, and failed (`the page sent replace /requests/2/starts ""`). By hand now asks
  the field first, by the client's own rule (`sends`): one that cannot send the value is nobody's
  way to it, so the refusal is the wire's, as the story says, not done by hand and never failed,
  as a select without that choice already was; neither is counted as done by hand, but for the
  way to it walked from its `from`. So a value of the wrong type is a `cannot` story again:
  leave's "Ann cannot move her day in November to a number: a day is a date" (26 stories, from
  25). `docs/stories.md` step 7 says it.

- **A tab moved through a resource that keeps no document is answered, not refused** (20 October,
  found re-walking the evolve skill's thin-client step): a session with no row (the cookie is the
  session) that says where a tab may stand moved the tab, then failed reading the version of a
  document it does not have, so the write was answered `refused` and logged as failed. The echo
  of nothing now reads the version as held, loaded first: none, 0 (`tests/rendering/server.test.ts`).

- **On Postgres a write that is no list of ops, or holds one that is no op, is 400 in delta's
  words** (20 October, found re-walking the thin-client step): `ops: "not ops"` was 500 ("ops must
  be a JSON array") and `[null]` a pointer's error; they are "ops must be an array" and "An op is
  an object: { op, path, value }", asked before anything else, as SQLite asks them.

- **The stories resolve a path as delta does** (20 October, root #127): delta takes a single
  document's root row by its id (`/messages/1/text`, through `message:1`) and as the document
  holds it (`/messages/text`); the harness held a control to the second alone, and warned a page
  that wrote the first ("message holds nothing at /messages/1/text to replace"), which the light
  page writes. `asHeld(doc, path)` (`dzql/modelling/harness`) gives a path as the document holds
  it, and the check of what a control writes and the search for a hidden verb read each path so.
  So the light page's path carries to the thin client unchanged. A story still says the path its
  page's control sends (the dzql-app skill's `controls.md`).

- **An implied document not made yet is read as it stood as `open` reads it** (20 October, root
  #120): the compiled `dzql_open_at__<doc>` answers its id and its columns' defaults, each included
  collection empty, where it answered null, as delta's SQLite now does (delta's
  `src/cases/path/implied.ts`, asked of dzql in `tests/delta`). So the stories' fresh render, which
  reads storage (`open_at`), draws the page a server draws: a page reads `read(doc).<root>` with no
  `?.` and no default said again in code (`tests/modelling/harness.test.ts`, the note not made
  yet). The compiled text's snapshots change with it (`RETURN NULL` becomes the implied root in
  `open_at`). Chat's session reads its row so (`session-api.ts`).

- **A duplicate is refused in delta's words on Postgres** (19 October, the Shed's run 3): a write
  that breaks a unique constraint the schema says answered 409 with Postgres's message; it says
  `Already there: another row has the same <table>.<column> (a unique constraint)`, as SQLite does.
- **Importing `dzql/modelling` (or `dzql/rendering/test-socket`) made a `db.sqlite` in the folder**
  (19 October, the DRY/YAGNI/KISS review): the harness imported `dzql/rendering/db`, which opens the
  database as it loads. The harness opens the app's SQLite only when a run asks for it, and `hear`,
  `Heard` and applying a render op are rendering's (`src/rendering/resources/render.ts`, `HeardOp`),
  so rendering no longer imports modelling; `dzql/modelling/harness` still exports `hear` and `Heard`.
  `stories-run.ts`'s import-order workaround goes.
- **`dzql serve` is gone**: it imported an app's `index.ts`, so it failed in every app `bun create dzql`
  makes (`routes.ts`), and nothing ran it. An app serves itself (`bun dev`, its `routes.ts`); the
  model's page beside it is `modelRoute()`.
- **The fast tier is whole**: `test:fast:eta` and `test:fast:pg` are gone, with the root's
  `bun run affected` choosing between them by path; the split sent `src/cli/` to the Postgres half,
  which never ran its tests, and a change to `src/postgres/` never ran the cafe or the starter.
  `test:fast` type-checks once.
- **Two `cannot` stories on one write each refuse in their own words** (19 October, the Shed's
  feedback: a member borrowing a broken tool was refused as "a tool someone else has out"). The
  guards refuse in the words of the `cannot` whose requirements hold; with none holding, why the
  `does` story did not let it, else the first `cannot`.
- **Two adds of one entity in one story are one new row, starting with both values** (the Shed's
  feedback: `add tools.out=false add tools.broken=false` made two tools in the proof, one with
  `broken` null). A story's writes are the kinds of change it makes, not a count; the modelling
  reference says so. The Shed's model is a conformance fixture (`src/modelling/fixtures/shed.json`),
  and fails without either fix.

## [0.14.0] - 2026-10-19

- `@blueshed/railroad` 0.17.0: the dev dependency is `^0.17.0`, and the optional peer takes it (`^0.16.2 || ^0.17.0`). `create-dzql` 0.14.0 with it: its template asks for `dzql` `^0.14.0`.

### Breaking

- **dzql's public API is named**: `package.json`'s `exports` lists each module an app imports (41,
  among them `dzql/rendering/server`, `dzql/rendering/documents`, `dzql/modelling/stories`); the
  wildcards `dzql/rendering/*` and `dzql/modelling/*` are gone. Eleven modules are dzql's own and
  no longer importable: `modelling/by-hand`, `modelling/costs-clock`, `modelling/stories-run`,
  `rendering/client-coverage`, `rendering/connection`, `rendering/failed`, `rendering/reading`,
  `rendering/resources/ledger`, `rendering/resources/render`, `rendering/start` (scripts run by
  path still run). `readme/exports.test.ts` holds the list to what the examples, skills and docs use.
- **The `eta-app` skill is `dzql-app`**: `bunx delta install-skills` installs it under its new name;
  delete `.claude/skills/eta-app` from an app that has it.

### Changed

- **The bento has two looks** (19 October, Peter: "the colors and style of paintbrush was clean and
  simple - bento made beige monsters"). `bento.css` is the frame, and every look decision in it is
  a token, its default today's look (the tray: padded, rounded, shadows, small capitals), so an app
  that imports it is drawn as before, element for element. `dzql/rendering/bento-plain.css` is the
  other, Paintbrush's (`docs/bento/paintbrush/`): white cells split by a hairline, black ink, 4px,
  no shadows, plain words, a field's label above it; it imports the frame and is only tokens
  (`bento.test.ts` holds it so). The starter, and so `bun create dzql`, is drawn in it.
- **The bento draws what Paintbrush's design has** (19 October): a box's heading
  (`boxPage(..., heading)`: the place's name large under the trail, the logo, the page's own deeds
  and its tools beside it); a run, the heading of a group of rows (`run()`); a row with a deed of
  its own (`row({ act })`: its name the button that opens it, the deed at the end, never a button
  in a button) and a total (`row({ total })`); a pin (`pin()`), in a cell's head (`cell({ pins })`)
  or on a line; a cell two rows tall (`cell({ rows })`). Each is an addition: a page that does not
  ask for one is drawn as it was. At the root, a heading stands alone: a trail of one crumb would
  say the name twice. The dzql-app skill's `reference/bento.md` names them, and the looks; its rule
  that no row carries a button is now that a row carries at most one deed of its own, the one the
  line is for (Add, on a menu), as the design draws it.

- **What cafe-e found, built by a blank Claude from the skills alone** (18 October,
  `cafe-e/feedback.md`: it built the whole cafe, 18 stories at 100%, and played it in Chrome). The
  generated proof's setup makes and sets, never removes (a story that adds and removes tables took
  the row a later story stood on). `bun create dzql` ships `.env.test` (`DB_PATH=:memory:`, so
  `bun test` never runs on `bun dev`'s database) and ignores `db.sqlite*`. A cast the app will not
  sign in fails every story with that sentence, instead of a stack trace. The starter asks `active`
  as the kernel does (`settled`), so its test holds once `active` reads the session.
  `--against-page` compares holders as the roles the cast plays (from the stories matched by
  number) and finds the own document by its root under the app's own name. Subscription closure
  advises where another person's document holds what a story writes and does not serve it ("are
  they told?": the customer seeing their table seated). Precondition closure's hint says an add may
  start a state; the verbs say `add <entity>.<field>=<value>`; the reference says what to do when
  the own document is called `visit` (`sessionRows`' lookup), and refusal.md that a guards'
  refusal with no control on the author's page carries no `told`.

- **`bun create dzql` makes an app as routes and resources** (18 October, Peter: "the paintbrush
  organisation made more sense", and yes to the proof). The starter (`examples/starter`, and so a
  new project's `src/`) is laid out as paintbrush's: `routes.ts` is the server -- the app (its
  page, socket and resources, `appOf`) composed with its HTTP routes and, in development, the
  model's page (`modelRoute()`, now exported as `dzql/model`) on delta's one server, `run` around
  it -- and each document will be a resource of its own folder, `resources/<name>/`: `<name>-api.ts`
  (its schema and document), `<name>.ts` (its `Resource`) and `<name>-view.ts` (its part of the
  page). `bun dev` is `bun --hot src/routes.ts --model`, `bun start` `bun src/routes.ts`; no
  `index.ts`, `delta.ts` or `client/`. The stories, the model's loader and `model:check` find an
  app in `routes.ts` (`appIn`), and read its documents from each resource's `-api.ts`. The README's
  first file is `routes.ts`, run by `bun routes.ts`. The eta-app skill says the layout, and maps it
  to the examples' earlier places.

- **What cafe-d found, built by Gemini from the skills alone** (18 October, `cafe-d/feedback.md`).
  A write the store refuses with 401 (the guards know nobody) is refused on the page with its
  reason, as a 403 is, not "delta applied nothing"; the store failing (5xx) is reported. The guards
  answer `may` without writing, and the stories harness asks it before it calls a write no story
  tells a hidden verb, so a `permit` narrowed to what the page sends and guards that say who no
  longer warn. The CLI's refusal names its server (a quoted `${server}` was printed as it is).
  `model:check --against-page` reads a `defineDoc`'s options in any order and the definitions a
  `delta.ts` passes from the model's `types.ts`, and lets each person's own document keep
  fields beside the told ones (the session's). The modelling reference says how `Example.who`
  and `actorOf` fit. Not done: cells behind an open window keep their bodies, since dropping them
  would unmount the live applets there (the ticker's clock).

- **cafe-c's second round** (18 October, `cafe-c/feedback.md`). `bun run stories` really runs on a
  throwaway database: the harness is imported after `DB_PATH` is set (a hoisted import opened the
  app's own `db.sqlite`). The generated proof sets up a state with the one story that presupposes
  least (a table added free, not one paid and freed), so its premise never needs what it sets up.
  The guards check a requirement only on the writes of its story that reach it, and precondition
  closure says when none does (`unchecked-precondition`). `teller <n> <actor>` and `root <doc>
  <entity>` change who tells a story and what a document is about, their numbers kept. The
  starter's `bun test` fails below 100% coverage and leaves a linked dzql out. The modelling skill
  decides the obvious and asks what could go either way (Peter: yes); a read is the "who sees it"
  of a write story; a rule across rows is a field on the row it is about; read `model/types.ts` and
  `bun check` before building. The reference says how the guards decide. eta-app: stories before
  the first render; a page never reads the database; `""` in a `seen` record is the page with no
  address.

- **What a blank session building cafe-c found** (18 October, `cafe-c/feedback.md`, from a session
  with only the skills). A box with a cell open always has its way back: `boxPage` gives the box's
  last crumb a `back` and names the cell after it when the caller's trail has none, and bento.md
  says which example to copy for a box (ticker) and which for a collection (leave). A number field
  takes 2.80 (`step="any"`). A document's name must be one word (it is a wire prefix and a type's
  name): a space or hyphen is a referential gap with the rename to say, and making `model/` that
  fails says so ("Nothing made: ... failed") instead of leaving it stale. Coverage flags a
  `cannot` that the same teller's `does` already lets through, presupposing nothing
  (`shadowed-cannot`). The guards let the server's own writes by, leave each person's own
  document to the app's session, and ship `rowsIn(db, schema)`, a SQLite `rowOf` with booleans
  read as booleans. Whose-copy advice goes quiet once the person's own document holds a field
  naming the document's root or a row it hangs under. The model's page counts "8 of 20" stories
  when some are hidden. The modelling reference says how `types.ts` meets another store, what an
  own document becomes, and which schema the model's migrations run with.

- **Made usable before a third cafe: what three reviews and a fresh app found** (18 October,
  Peter: "please make this a usable library ... perhaps run a review?"). The model is served beside
  an app only when asked: `dzql serve <app> --model` (the starter's `bun dev` passes it; `start`
  never does), not on `NODE_ENV`. Two apps composed onto one path are refused, naming it. Each app
  under a path has its own cookie (`session_id_model` under `/model`), its own pending writes and
  undo handles, and its sockets are closed for a reload to reconnect, so the model and the app
  never take each other's session. The CLI signed in by a link talks to that server from then on
  (`.eta-session.url`), `show`, `model:load` and `model:check` too, so `bun dev`'s model at
  `:3000/model` needs no `ETA_URL`. A story told as anything but does or cannot is refused. The
  checks: a story no document serves is a reachability gap; a gap's hint names the document by its
  number; a teller with nothing in front of them is a gap even before any document is made; a
  document's root row is made by its first write, as the visit makes an own document's; a cannot
  with no field refuses every field; an own document counts as in front of its teller. What the
  model makes: a step that drops a column or table waits for `dzql model check --drops`; a file
  already as it would be is not written again (no reload for nothing); `By hand:` lines an earlier
  step owes are not repeated; the guards address a document's root row as delta does
  (`/<root>/<field>`); `model.test.ts` type-checks in the app (the starter's `tsconfig` includes
  `model/`). The skills and README say what the tools now do.

- **What the model makes stays in its own folder, and the app's stories are the app's** (18
  October, `cafe-two/feedback.md` parts two and three). `dzql model` writes into `model/` (never the
  app's `src/`, so nothing of the app's is overwritten and the app does not reload for it):
  `types.ts` (now exporting `tables`, so the app keeps its own beside them and runs its own
  migrations after the model's), `guards.ts` (stood in front of the store with `guardWrites`),
  the migrations and `model.test.ts`. It no longer writes `stories.ts`: generated stories had roles
  for a cast and made-up ids, so the app writes its own, each naming its model story. The proof
  passes on the stories it is made from: a write that adds, changes and removes is checked by what
  is left; a replace with no value said sets one of its field's type; a row is added on the page of
  rows, not its own. Actor closure's advice asks whose copy a role's document is when its root is
  one of many. `bun run stories` runs on a throwaway database unless `DB_PATH` says one.

- **The model's page as a second cafe found it** (18 October, `cafe-two/feedback.md`): signed in by
  a link each keeper gets as `dzql model` or `dzql serve` starts (`login <link>` for the CLI), and
  kept signed in across `bun --hot` (the sessions and links on globalThis, not a fresh `:memory:`);
  a write to a story or document the model has not got says they go by number; the checks never
  show closed over a model with little said (a silent story, a document holding no field, a teller
  with nothing in front of them; no story at all is "not asked").

- **A store's refusal says why on the page** (18 October, todo #32): a write the store answers 403
  -- the model's guards, a document's permission -- is refused as a resource's `refuse` is, its
  message the reason beside the control that sent it.
- **The starter starts the new way** (18 October, todo #34): a `bun create dzql` app's `dev` and
  `start` are `dzql serve ./src`, the model at `/model` in development and never in production;
  `model` and `cli:model` are `dzql model`; its `icons.ts` is lucide's, as the bento asks; and its
  page points at the bento. paintbrush's model scripts the same.

- **A server is routes to resources: dzql's rendering composes, and owns no server** (18 October,
  Peter: "we have already said that the server is a composition of different routes and
  resources - so why does dzql have servers?"). `appOf(example)` is an app as delta's `serve` takes
  it -- its page, screens, routes and socket, under `Example.at` when it says a path -- and its
  state (resources, documents, open sockets, page, cookie) is its own scope
  (`src/rendering/scope.ts`), not the process's: `read`, `serverWrite` and who sees what read the
  app a call is in. `compose(...apps)` puts several on one server, delta's own socket among them
  (its actions registered with `on`, JSON-RPC style, and its publish), each socket given to the
  app that opened it. `createServer` is `serve(appOf(example))`. The browser opens its socket under
  the app's path (`<meta name="dzql-at">`), and an app under a path keeps its session cookie there.
- **The model is a route, registered only in development** (18 October, Peter: "if the model is a
  route that production can drop - that would make it completely independent"). The model's page
  is at `/model`; `dzql serve <app>` mounts it beside the app unless `NODE_ENV` is production,
  keeps the model in `model.json` (sessions in memory, nothing in the app's database), and after
  every change writes what the checks let it make into the app's folder. `dzql model` serves it
  alone, `/` sending you to `/model`. `site`, `guards` and `mcp` read `model.json`; `check` takes
  the place of `audit` and `export` (MCP's `model_check`).

### Changed

- **The skills are one path, through the cafe** (19 October, Peter: "make it so"): eta-app's order
  is the worked example's files in turn -- the story, the store, a document's folder, the session,
  the page, the routes, the tests -- each introducing its words where they are first needed, with
  what the cafe has no need of (a memory document, an applet, a CLI, uploads, passwords) one line
  on to the older examples. The modelling reference's move to an app is the same walk from the
  model's side.

### Added

- **The thin client on Postgres** (19 October, Peter: "create dzql is performance: thin client with
  applets using compiled postgres for storage"). `bun create dzql`'s starter and the cafe keep their
  documents in Postgres: PGlite in the process (`data/pg` for `bun dev`, in memory for `bun test`),
  or a server at `DATABASE_URL`. `openStore({ schema, migrations })` (`dzql/postgres`) is an app's
  store: the model's migrations, the framework, `register` for each resource's documents, `open()`
  to compile them and open one listener, and `stories` for the harness. What it needed: the
  listener keeps the ledger per document (`ledger: { except }`), and leaves a document it does not
  know to the socket's other handlers, whichever registers first; `Example.store` (`StoryStore`),
  so the stories begin and end on any store, SQLite's transaction the default and
  `storyStore(pool, schema)` Postgres's; the guards read rows on Postgres (`rowsInPostgres`), and
  `actorOf` may be async; an app with no documents yet compiles (a `CASE` with no `WHEN` is its
  fallback alone); `openPglite` makes its folder; and the read-back reads an app's `register(...)`.

- **The worked example: the cafe, from its model** (`examples/cafe/`, Peter's ask after cafe-e: "the
  learning was large up front"). The model told (13 stories, five documents: the floor and the
  menu lists, a table, the door, each person's visit), made by `dzql model` into `model/`, and
  built as `bun create dzql` lays an app out: `store.ts` (the model's migrations, the app's own
  tables, the guards first), a folder per document under `resources/` (`-api`, resource, `-view`),
  the page, staff signed in by a link and customers by their table's code, and 22 stories, each
  naming its model story. Its README walks the path; `bun run dev:cafe` serves it. It is a
  conformance fixture, and the read-back finds no gap. It ships in the package, and the eta-app
  and modelling skills and the template point at it.
- **The read-back reads an app laid out as routes and resources**: the model's `types` imported
  from a resource's api, the schema in a `store.ts`, a `registerDocs` that takes some of the
  model's documents (`docs.filter(...)`), and a document's `columns`. It no longer asks who holds
  each person's own document (everyone holds theirs), nor where a story that posts a form is
  served; an app story that is the app's own says `model: false` and is not asked about.
- **A document holds only the fields the model names for it**: where it names fewer of an
  entity's fields than another document gives it, its definition says them (delta's `columns`):
  the door shows a table's name, not whether it is seated.
- **The tools agree: one reading of a model, and a test that holds them to it** (18 October, Peter
  on cafe-e's report: "How do the tools disagree with each other?"). `dzql/modelling/reading`
  works a model out once -- its entities and where each hangs, which roots are there before a row
  (an implied document's), what the stories add, where a person may write, a word as its field's
  type has it -- and the checks, the heart, the definitions, the proof, the guards and the
  read-back all take it. The proof `dzql model` writes (`model.test.ts`) now makes every write
  through the guards as its story's teller, and expects each `cannot` story refused in its own
  words; `src/modelling/conformance.test.ts` runs `make` and that proof over fixture models
  (leave's, cafe-e's, a menu) in the fast tier: closed, then proved, then guarded. It found four
  disagreements, each fixed: the guards refused a write to an implied document's root row delta
  makes on its first write; the proof made a story's writes as one write, which the guards
  checked against the rows before it (each is now its own write, as a page makes them); the proof
  pre-made row 1 of a root a story adds, so a premise's row was row 2; and a refusal carried its
  story's number. A document that says nothing of what it holds now holds its root, as the
  definitions always had it.
- **A document can list every row of its root** (Peter's decision after the cafe runs, cafe-d's
  items 2 and 7): `list <doc>` on the page, the CLI and the MCP tools (`mdl_documents.list`), for
  `menu:` -- the whole menu, the same for everyone who holds it -- beside one row (`menu:1`). The
  proof adds and changes rows on it, the types give its root by id, the guards and the checks do
  not treat its root as there before a row, and whose-copy advice is never asked of it.

### Changed

- **A guard's refusal is the story's words alone** (Peter's decision, cafe-e's item 4): the page
  draws the `cannot` story's text; its number rides beside it as the store's `error.story`
  (`Verdict.story`), for logs and the proof.
- **While modelling, the newest migration is rewritten in place until it is committed** (Peter's
  decision: cafe-e piled up six in one afternoon): `dzql model` rewrites the newest step while git
  says it is not committed, and removes it when the model returns to the committed steps; a
  committed step is history, and the next change is the next step. Outside a repository every
  step is its own, as before.

- **Sign-in by link, for any app's people** (18 October, Peter's decision after the cafe runs:
  cafe-e's doorway page). `dzql/rendering/links`' `signInLinks(key, sessions, people, at)` makes a
  link per person as the server starts: `say(origin)` prints them, `ways()` is each person's name
  and path for a page that offers a way in per person, and `route` is the app's `"/in/:token"`,
  starting a fresh session as that person. The model's page signs its keepers in through it, and
  its stories sign the cast in by their links (the link route answers the harness's post). The
  eta-app skill's `signin.md` leads with links, the bento's `leave` the way out, and passwords only
  when a story asks; first-app.md, stories.md, the starter's `routes.ts` and the template's
  `CLAUDE.md` say the same.

- **The model is a file, and it makes the app's types, migrations and tests, checked first** (18
  October, Peter: "I want a migration, types and tests generated from stories ... and you should run
  your checks before you generate"; then "yes" to one file, one command). The model is `model.json`,
  delta's JSON file, which the page edits (`MODEL_FILE`; sessions stay in memory) and a person can
  read. `dzql model` serves the page and, after every change to the file, runs the checks; while
  none is open it writes the app's (`--out`, default `app`) `types.ts` (delta's definitions, a row
  type per table and each document's shape: the snapshot), `stories.ts` (each story with its write,
  its premise and who sees it, for the app's pages), `model.test.ts` (the proof on SQLite: the
  migrations from empty are the types, and each story's write lands in every holder's document) and,
  when the schema says more than the migrations there, the next one (the trajectory, by delta's
  `diff` and `writeMigration`). `dzql model check` does it once, exit 1 while a check is open; it
  replaces `audit` and `export`. `src/modelling/definitions.ts`: `typesOf`, `nextMigrationOf`,
  `storiesOf`, `testsOf`; a document's root no longer sets its entity's parent to nothing over the
  parent another document gives it (the cafe's kitchen showed no orders).
- **Easy's coverage and rights' playability join hjeli's six** (18 October, Peter: "extend dzql to
  have all of simple's, hjeli's and eta's checks"). On the page, in `show`, `audit` and the export's
  gate: *coverage* (Easy: every write decided for everyone who holds what it changes, by a story
  that makes it or a `cannot` story that is refused it); *playability* (derive-ux: a turn its taker
  cannot see, a wait its maker cannot see; one way on, an end and a field no story changes as advice
  that does not block). hjeli's registers gain four the cafe showed only a schema would catch: an
  entity held and never written, a row added under a parent no story adds, one table under two
  parents, and a type the model does not know (no longer guessed as text); and a write to a field no
  document holds.
- dzql: hjeli's three that `dzql model` lacked, each over the model's file, proven on leave's model
  told through the MCP server to a running page. `dzql model guards` writes the guarded write layer
  (`dzql/modelling/guards`: who, what, the document, the row, and what a story `requires`, checked in
  front of any of delta's stores by `guardWrites`; a `cannot` story is the refusal's reason), and only
  once the six registers are closed. `dzql model site` writes the model as one static page a customer
  reads. `dzql model mcp` serves every model verb as an MCP tool over stdio. Paused here, on Peter's
  word of 18 October (one thread at a time), to resume on top of the Mac session's `dzql model`.
- **hjeli's six registers run on the model as it is told** (18 October, Peter: "dzql should be a
  superset of hjeli"). `examples/modeling/closure.ts` asks reachability, subscription, actor,
  precondition, referential and authorization closure of the page's model after every change: a
  part across the top of the page, the foot of `show`, and `dzql model audit [model.sqlite]`, which
  exits 1 while one is open (hjeli's `audit`). A register the model cannot answer says "not asked",
  never "closed". Off since eta's 3b60ade (12 October), which dropped reachability and subscription
  closure because they passed by construction over invented per-actor documents; these run over the
  documents as told.
- **A story says what it writes and presupposes, as hjeli had it**: `writes` (add, replace a field
  to a value, remove) and `requires` on the page's stories (`bun run cli writes`, `requires`), so
  precondition closure's row and state tiers are asked. `touches` stays.
- **model:check reads hjeli's reachability and dead actor over the real documents**: each table of
  the app's schema no document holds, and each person who held and wrote nothing. A row of the
  visitor's own document (`session`) is made by the visit, so precondition closure no longer reports
  chat's eight session writes as gaps.
- The modelling skill keeps hjeli's loop: say what a story writes, read the six registers after every
  change, propose the change that closes a gap, close a red register by adding, never removing.

### Fixed

- **A session's id is kept off the wire again where the cookie is the session** (an example with no
  `Example.session`, as the starter and `dzql serve` apps are). 7707774 removed the guard with
  numbered sessions: a document keyed by another live session, not `perSession`, is refused by name
  again, and a session's own document has every value equal to its id taken out (2ac7100 narrowed it
  to the row's `id`, right only for numbered rows).
- **A person numbered past 2^31 signs in on Postgres** (`dzql/auth-link`): their id was cast to an
  int and overflowed; it is read whole from its `BIGINT`.
- **A session's own echo keeps a value equal to its id** (`wireOps`): only the row's `id` is taken
  out, so session 3 joining room "3" is told the room.

### Changed

- **The story harness's `run()` is a sequence of named steps** in `harness.ts`, and builds JSON
  Pointers (and `goTo`, and chat's presence) with delta's `splitPath`, `joinPath` and
  `escapeSegment`: a key with `/` or `~` is escaped where it made a wrong path before.
- **delta's schema-contract and migrate tests are asked of PGlite through delta's cases**
  (`schemaContractCases`, `upgradeCases`), not kept as copies here; the copies' SQLite re-runs (delta
  runs them) and an unused test helper go.

### Changed

- **A `bun create dzql` app has its skills and the model's page.** `bun install` runs
  `delta install-skills` (`prepare`; `claudeSkills: ["dzql"]`): eta-app, modelling, delta-doc and
  railroad. `bun run model` (port 3001, `MODEL_PORT`), `cli:model`, `model:load` and `model:check` run the model's page
  from dzql's `examples/modeling`, now in the package. A `CLAUDE.md` says which skill for which
  step. The eta-app and modelling skills describe this project, not the retired
  `bun create blueshed/eta` one with its `eta/` folder; eta-app's stories say what a story with no
  body is.

### Added

- **Three things to say, each standing alone, at the top of the README** (17 October, Peter: "I
  should be able to say install dzql and use rendering... install dzql and use modelling for json,
  sqlite or postgres... install dzql and we can compile a postgres server"). Each is a file and the
  commands that run it, and `readme/readme.test.ts` runs them as written in an app of its own
  (`readme/browser.test.ts` types into the rendering page in a real browser): a page the server
  draws over one message kept in delta's JSON file (`readme/rendering/`); the model told on the
  model's page and exported (`readme/model.ts`); and the same definitions compiled to Postgres on
  PGlite (`readme/server.ts`).
- **The model as delta's definitions** (`dzql/modelling/definitions`): `definitionsOf(model)` makes
  the model's documents into a `defineSchema` of their entities and a `defineDoc` each, and
  `sourceOf(model)` writes them as a file. The same definitions open, take a write and read back
  alike on delta's JSON file, SQLite and dzql's compiled Postgres (`definitions.test.ts`). A
  document that is each person's own is marked in a comment: whose it is (`owns`) is not in the model.
- **`dzql serve [<dir>]`**, the app in a folder with its page drawn by the server; **`dzql model`**,
  the model's page for any project (port 3001 or `MODEL_PORT`, kept in `model.sqlite`, empty and
  named for the project, not seeded with leave's); **`dzql model <verb>`**, its CLI; and
  **`dzql model export [--out <file>]`**, the definitions above from the model the page keeps.

- **delta's unique constraints on Postgres**: `generateSql` (`tableSql`) makes each of a table's
  `unique` as a unique index, among a temporal table's current rows; a row that would share one is
  23505, 409, as on SQLite. `migrate` makes `addUnique` and drops `dropUnique`. An `up` is given
  `nextId` (the table's `seq_<table>`, moved past any id it holds), so a migration never writes a
  sequence itself. delta's `uniqueCases` and `migrationCases` pass on PGlite here; on a Postgres
  server they want Peter's Mac (Docker).
- `tests/delta-pg/replace-in-place-pglite.test.ts` pins that a replace, of a row and of a field, is
  an UPDATE an app's trigger sees, never a DELETE and INSERT (the Shed's run 2, stage 5).

### Changed

- **A session is a numbered row, and its cookie a random token** (eta, todo #11 at the root). A
  visit's first socket inserts its session's row, so delta's serial names it (one row per visit;
  delta's id rule is unchanged); the row keeps the cookie's SHA-256 in a `cookie` column, never the
  cookie, and is found again through a `visit:` list document scoped by it
  (`dzql/rendering/sessions`: `sessionRows(delta, collection)`, `of(cookie)`, `start(value)` for
  a sign-in). An example gives `Example.session(cookie)`; without it the cookie is the session, as
  before. The session's own document leaves `cookie` out (`columns`), so the hash is never drawn
  or told. `wireName` no longer refuses a document keyed like a session: a session's own goes by its
  type alone, any other by its whole name.
- **Every example names its rows by number.** Chat keeps no rooms table: a room is a name its
  messages carry (`room:` is scoped by it), and a room's name may not hold a colon. Ticker's quotes
  are numbered and keep their symbol (`quote:<n>`); its watchlist and clock are columns of one desk
  row a visit makes (`watchlist:`, `clock:`, `desk:` are column cuts of it). Leave's and modeling's
  logins keep the email, and leave's tokens the hash, as columns; `person_id` and `answered_by`
  are integers (leave's `004-numbered` upgrade moves an existing database). Wedding's claims are
  rows added at `/claims/-` and given back by their number; `gift_id` and an ask's `guest_id` are
  integers. Modeling's documents name the stories they serve by number. The modeling loader reads
  a document scoped by a column, and leaves out the `visit:` lookup.
- The story harness tells a new session nothing at first (each story is rolled back, so a session's
  number comes round again, and what a session is told is kept in memory), and `anyOne` reads a list
  document's one table as a table, not a row (`/messages/*/text`, not `/*`).
- Not changed: wedding's `newId()` (a clock-based number for a row the same write refers to)
  stays until delta lets a write refer to a row it makes at `-`.
- Not yet run here: the browser tier and Postgres (a cloud container); leave's "drag across days"
  browser test fails on this container's Chromium before and after (its date format), not on the
  change.

- **`pg`, `@electric-sql/pglite` and `jose` are optional peers**, no longer dependencies: an app
  that models or renders pulls none of them. At the Postgres step, add them: `bun add pg` for a
  server, `@electric-sql/pglite` for `dzql/pglite`, `jose` for `dzql/auth-jwt`.
- **A story may be a sentence alone**: `story(name)` (no body), kept in `Stories.unproven`, which
  the harness reports unproven, never failed; `untold(stories, sources)` names the stories no test
  source names as `.<key>`, for an app whose tests tell its stories.
- **A compartment is a resource**: `Compartment` → `Resource` (`dzql/rendering/resources/resource`,
  `dzql/rendering/resources/index`), an example's `compartments` → `resources`; the model grammar's
  `resource` flag → `reach`. An app renames its imports and the word.

### Added

- **eta comes in: `dzql/modelling` and `dzql/rendering`**, with eta's history. Modelling is the
  stories, the harness that tells them against an app, by hand in a browser, and what a page costs
  on the wire (`src/modelling/`); rendering is eta's kernel, pages the server draws and morphs into
  the browser (`src/rendering/`). Each module is also its own entry (`dzql/rendering/server`,
  `dzql/modelling/harness`). `@blueshed/railroad` is an optional peer: only an island
  (`dzql/rendering/island`) needs it. eta's examples (chat, leave, modeling, starter, ticker,
  wedding) are in `examples/` and import dzql as an app does; its skills (modelling, eta-app) in
  `.claude/skills/`; its docs, changelog and ledger in `docs/eta/`. eta's own `bun create` and
  `eta:update`, which copied the kernel into an app, retire: an app installs dzql.
- **Pages are served by delta's one server**: `createServer` gives its routes and socket to
  `@blueshed/delta/serve`, and `src/rendering/start.ts` is `run`: a pid file, so `bun run start`
  and `bun run stop` (`delta stop`) start and stop it, and the signals.
- Two test configurations: `bunfig.toml` is eta's (`bun run test:eta`, 100% coverage, the client's
  read from Chrome), and dzql's Postgres tests run with `tests/bunfig.toml` (`bun run test`). CI's
  `dzql.yml` has an eta job (the tests, `stories:all`, `costs --check`), which replaces railroad's
  job that ran eta's island test against a checkout of eta.

### Changed

- **The repository holds railroad and delta too** (`packages/railroad`, `packages/delta`, each
  with its history), as Bun workspaces: dzql runs against delta's source, so a delta change that
  breaks dzql's cases is red in the same commit. dzql's CLAUDE.md, CHANGELOG.md, todo.jsonl,
  philo.md and `/publish` moved from the root into `packages/dzql`; the root has the monorepo's own,
  and `/publish` releases a round of packages together. CI is the root's `dzql.yml`, run when dzql,
  create-dzql, delta or railroad changes.
- **A replace on a table that keeps no versions updates the row in place** (`_delta_row_put`), its
  declared columns and parent key set from the row; it had deleted and inserted it again, which
  re-indexed every index and would fire a foreign key's or a trigger's delete. A column the database
  holds beyond the schema keeps its value.
- **Nothing reads `_delta_docs` when a write is told**: the fan-out's "the longest prefix owns the
  name" is written from the definitions, and an implied document's empty root is inlined, as an
  open inlines it.
- **A compiled function's name fits Postgres**: a name past 60 bytes, or a prefix with no letter or
  digit, ends in a hash of the whole, so two never meet in the 63 bytes Postgres keeps.
- **`dzql/compile` is no longer exported**: it exposed one pass of thirteen; `generateSql` is the
  compiler's entry.
- The generated SQL's header and two messages say `bunx dzql`, not `bunx delta`.
- **The documents say what is built**: the compiler's headers describe each pass, not the retired
  run-time framework; closed ledger items are no longer cited in the code; `philo.md`, CLAUDE.md
  and `docs/delta` are revised (`owns` is delta's path language, compiled here; derived row-level
  security is still to do); the old stack's env samples and the superuser bench results go.
  From Gemini's review (`feedback.md`).

## [0.13.0] - 2026-10-16

### Breaking

- **The whole-stack dzql is retired** (Workshop's docs/postgres-split-plan.md, step 5). The
  `domain.ts` compiler, its runtime server, the client, the namespace, the Pinia stores and the
  manifest generators are gone, with their tests, examples and docs, and the exports `dzql`,
  `dzql/client`, `dzql/compiler` and `dzql/namespace`. dzql is delta's Postgres step and only
  that: `dzql/postgres`, `dzql/pglite`, `dzql/auth-jwt`, `dzql/auth-link`, `dzql/compile`, and the
  `dzql` command (sql, init, migrate, link). The dependencies `postgres` and `dotenv` go with it.
  An app on the old stack stays on dzql 0.12; a new one starts from delta, or `bun create dzql`.
  Ledger items about the retired code are closed (#12-#18, #20, #23, #24).

### Added

- **A document's `owns` as a path, compiled** (Workshop's docs/postgres-split-plan.md, step 3).
  delta's `defineDoc(..., { owns: "<path>" })`, the path language that moved to delta
  (`@blueshed/delta/paths`), is compiled into each document's own function,
  `dzql_owns__<slug>(name, person)`: the name read as its scope reads it, the path lowered by
  delta's `pathSql`, the same SQL SQLite runs. `docTypeFromDef` asks it wherever `owns` is asked,
  and a document with a path needs no `owns` or `shared` beside it.
  - **A row is never handed away**: `delta_apply` asks `_delta_keeps_reach` once a write's ops are
    applied, and a write that would leave the path not reaching the writer is refused (403,
    SQLSTATE 42501). The framework SQL calls it, so apply this version's `generateSql` with it.
  - delta's `permissionCases` pass on PGlite (`tests/delta/permissions-pglite.test.ts`), and every
    one of modeling-dzql's 204 rules parses and checks with delta's `checkPath`
    (`tests/compile/paths-model.test.ts`).
  - A path is asked on the connection a walk holds (`DocType.owns` takes it), so a walk on PGlite
    does not wait on itself.
- **Migrations as a history from empty, on Postgres** (delta's todo #82, the Django way). delta's
  `migrate` now takes migrations that are lists of changes (`@blueshed/delta/migrations`), and
  dzql's Postgres store makes each one:
  - a table made, or a column added, as `generateSql` makes a table (`tableSql`, now its own
    function). Every statement in it is idempotent, so a database adopting the history is left as
    it is, and a temporal table's view takes a column added after it;
  - a rename or drop by the helpers that keep delta's scaffolding in step (`renameColumn`,
    `dropColumn`, `renameTable`), and a dropped table's view, serial and metadata dropped with it.

  dzql answers delta's `migrationCases` on PGlite and on a Postgres server, each case on a database
  of its own (`tests/delta-pg/migrations-from-empty.test.ts`). `dzql migrate` runs these lists as it
  ran the older ones. Needs the delta that ships them.

## [0.12.0] - 2026-10-16

### Added

- **Link sign-in on Postgres: `dzql/auth-link`.** delta 1.1.0's `auth-link` signs people in with no
  passwords: a link is someone, its tap a session cookie, and the socket is signed in by it.
  - `postgresLinkStore(pool)` keeps its links and sessions in Postgres, in `_auth_links` and
    `_auth_sessions` (made if not there): hashes, the person's id, times. A link is used in one
    statement, so two taps at once make one session, on one server or several.
  - It answers delta's `linkStoreCases`, on PGlite and on a Postgres server
    (`tests/delta-pg/auth-link.test.ts`).
  - `dzql link <database> <person> [--origin] [--opens]` prints the first person's link (a
    `postgres://` URL or a PGlite folder; a SQLite file is `delta link`'s).
  - dzql now needs delta ^1.1.0.

### Fixed

- **Two writes to one row at once: the second no longer finds it "not there".** A write locks the
  row first (`_delta_row_lock`, `SELECT … FOR UPDATE`). One that waited on another's lock woke to
  find the row stored again: a non-temporal row deleted and inserted, a temporal one's version
  closed for a new one. So Postgres skipped it, and the second write answered 404, "row not found".
  CI caught it once (review-findings, "Finding #1").
  - Now a lock that finds no row asks afresh whether one stands. Each statement sees what has
    committed since, so a standing row is locked in its turn, and only a row really gone is not
    there.
  - `tests/delta-pg/row-race.test.ts` makes the race certain on the Postgres server, for both kinds
    of row: one write holds the lock, the other waits, the first commits.

### Changed

- **`bun create dzql` signs people in by link**, in place of `auth-jwt`'s email and password (Peter,
  16 October: "it would make development a pleasure and not a desperate memory of email and
  password").
  - The app has a `people` collection, and `people:` is everyone, for everyone signed in: anyone adds
    someone new, and makes anyone's link to send them.
  - `bun run link <name>` gives the first person their link, making them if they are new: on the
    developer's machine, or on the server.
  - In development the page asks "Who are you?" and lists everyone, so one click is anyone and two
    windows are two people. Production lists nobody.
  - The app's tables and documents are made in one place, `src/db.ts`: one schema, one
    `generateSql`.
  - Its tests pick who they are in two browsers. Then: post, see it arrive, edit, delete, the other
    person unable to change it; and a link made for someone new in one window signs them in in the
    other, keeps them through a reload, and is used once.

## [0.11.0] - 2026-10-16

### Breaking

- **The framework that read the definitions at run time is gone (todo #26).** Every document and
  collection is now compiled by `generateSql`, and nothing interprets `_delta_docs` or
  `_delta_collections` to work out what a document means.
  - **Re-apply `generateSql` once** after upgrading, as an app does after `applyFramework` anyway.
    The `001*` files drop the old `_framework` functions from a database that has them.
  - **A document is what its definition compiles to.** A row put into `_delta_docs` by hand is not
    read. A name no compiled document holds is refused: `no doc def for: <name>`, as before.
  - **One app per database.** A `generateSql` writes one app's documents and collections in place
    of the last. Two apps on one Postgres server each have a database (`CREATE DATABASE`); a schema
    each is todo #29.
  - The framework SQL before `generateSql` knows no document. Its dispatchers refuse a name, and
    a collection there is not has no row, nothing to take and no definition.
  - What stays generic is over the columns given, not a definition: a write's fields checked by a
    set the compiler never saw (another version's, a walk's), `_delta_assert_fields_declared`; and a
    row stored by the columns it gives, `_delta_row_add_given`.

  The compiled pieces answer what the framework answered. Its answers were recorded while the two
  were held equal (`tests/compile/` snapshots: every path-case name, the seed and after writes) and
  stay the measure. The row SQL and cascades, whose answers carry the write's own time, are held by
  delta's cases. 001b and 001c are a third of their size. The bench now runs delta's write compiled
  only: 0.55 ms p50 under RLS, 2.8x a raw `UPDATE`, and the fan-out flat to 100,000 names ever opened.

### Changed

- **`bun create dzql` makes a paintbrush app on dzql**, in place of the whole-stack Vue app (Peter,
  16 October: "remove vue and vite - replace with a proper paintbrush app that exercises the same
  steps").
  - People register and sign in with dzql's `auth-jwt`, and share posts.
  - Posts are two documents: `posts:`, everyone's, read-only; and `mine:<id>`, one person's own,
    through which every post is written, changed and deleted. A post's author comes from the
    document's name, never the value.
  - It's paintbrush's shape: `Bun.serve()` routes, railroad, resources of three files, and an edit
    in a sheet over the list. It keeps its data in a Postgres server (compose.yml).
  - Its own tests are the release's end-to-end check, in two real browsers with Postgres in memory:
    - register, publish, see the post arrive in the other window, edit it, delete it;
    - the other person sees it with no Edit or Delete;
    - a write to everyone's posts is refused (403), and another's posts are not there (404);
    - a reload keeps you signed in, and you can sign in again by email.
  - `/publish` runs these tests in place of clicking through the old app by hand.
- **`openPglite` gives PGlite pgcrypto**, so dzql's `auth-jwt` (bcrypt through pgcrypto) works on
  Postgres in the process too. PGlite has an extension only when it is given one at start; the
  extension loads when a database creates it.
- **A document type that refuses a write with a wire code of its own is answered with it.** A
  numeric 4xx `code` on its error is passed to the client, as a read-only document's 403; any
  other refusal is still a 500. Until now only Postgres's error codes passed through, and a 403
  became a 500.

- **The document a name is of is a compiled lookup** (`_delta_find_doc`). Each document's prefix
  and row are written in, the longest prefix tried first. Held equal to the framework's on every
  path name and probes (case, spaces, partial prefixes, LIKE wildcards), recorded; four mutations
  each fail it.

- **A collection's definition, a table's serial and a document as it stood are compiled lookups**
  (2c, the step before the framework retires).
  - `_delta_collection(key)` gives a collection's definition (its table, parent, columns,
    validity and what cascades on it). `generateSql` writes each collection in, with any other
    key going to `_delta_collection_framework`.
  - The write (`delta_apply`'s root and each op), an implied root and its first write,
    `_delta_show` and `_delta_show_ops` now ask it. No function that survives the framework reads
    `_delta_collections` itself.
  - `_delta_serial_new` and `_delta_serial_past` name each table's sequence. They stay definer
    functions, with the same privilege checks and search path.
  - `delta_open_at` sends each compiled document to its own read as it stood
    (`dzql_open_at__<prefix>`).
  - Each has a `_framework` version for anything not compiled, as the earlier pieces do.

  Held equal (`tests/compile/lookups.test.ts`):
  - every collection's row, and one that doesn't exist;
  - every table's serial at ids around its sequence and past 2^53, set back between (a sequence
    does not roll back), and for a caller without the table's privilege;
  - every path-case name read as it stood at five times, on the seed and after writes.

  Six mutations each fail it. A write is unchanged (0.588 ms p50 compiled): what this slice buys
  is the framework's retirement.

- **delta's Postgres tests open only documents an app could define.** Every table and document
  the tests in `tests/delta-pg` use is a definition, applied once with `generateSql`. Nothing is
  registered by hand any more, and the SQL fixtures (items, sites, customers) are gone. A
  definition the compiler refuses (a root that is no collection, a scope key that is no column, a
  junk scope operator) is tested as refused when the SQL is written. This is the step before the
  framework retires: no test leans on it to read a document it never compiled.

### Fixed

- **A custom document is told writes in the order they were made.** It hears writes made through
  every document, but each document's notifications were drained on their own. So a slow read of
  one document's ops told the custom document a later write, made through another, first, and its
  copy broke delta's law. The full suite showed it once under load. The custom documents are now
  told in their own queue, one notification after another, in the order Postgres delivers them
  (commit order), each reading the one entry its notification announces. Each document still
  drains to its own subscribers on its own: none waits on another's. A test holds one document's
  reads back and makes the order certain.

## [0.10.0] - 2026-10-15

### Changed

- **The READMEs lead with what dzql is now.** They opened with "define your domain in TypeScript,
  compile to SQL, get a full-stack app", which is the whole-stack dzql that step 5 retires. Both now
  open with delta's compiled Postgres step, and put `domain.ts`, the Quick Start and `bun create
  dzql` under "The whole-stack dzql (retiring)". The npm description follows: "delta's compiled
  Postgres step: an app's delta definitions compiled to SQL" (published with the next release).

- **The docs say what is compiled.** `docs/delta/postgres.md` has a "Compiled SQL" section:
  - a table of each piece, its compiled functions and the framework's it falls back to;
  - the rule that `generateSql` is applied after the framework every time, because
    `applyFramework` puts the framework's dispatchers back (checked on PGlite: writes then go to
    the framework, while the compiled opens stay);
  - what happens to documents dzql did not compile.

  The READMEs, `sql.md` and `rls.md` (the fan-out is still SECURITY DEFINER when compiled) say
  the same.
- **Who holds a row is compiled** (2c, the writes' first piece). Every write asks each open
  document whether it holds each row it changed (`_delta_holders`, the fan-out). `generateSql` now
  writes `dzql_holds__<prefix>(name, collection, row)` for each document -- which collections it
  holds, its name's conditions tested on the row's own values, a temporal row and a time past, an
  included row's parents up to the root as written lookups -- and `_delta_doc_holds`, which sends
  each compiled document to its own and any other to the framework (`_delta_doc_holds_framework`,
  as it was). `tests/compile/holds.test.ts` holds each equal to the framework for every name the
  path cases open, every collection and every row (made-up ones too), on the seed and after writes;
  breaking the parent chain on purpose fails 25 of them. Re-apply the framework SQL
  (`applyFramework`, or `dzql init --upgrade`) and then `generateSql`.
- **A write's scope is compiled** (2c, piece 2): "you may write what you may read", asked of every
  row an op names (`_delta_row_in_scope`). `generateSql` writes `dzql_in_scope__<prefix>(name,
  collection, id)`: a list holds its included collections whole and its root rows by the name's
  conditions; a single document a row whose parents, walked up as written lookups, reach its root,
  which meets the rest of its name's scope. `_delta_row_in_scope` sends each compiled document to
  its own, any other to `_delta_row_in_scope_framework`. Equal to the framework for every name,
  collection and id (`tests/compile/scope.test.ts`); dropping the root's other conditions on purpose
  fails `fo-guest:1:z@x`, and a list's root holding everything fails 55.
- **What a document is told of a write is compiled** (2c, piece 3). `_delta_tell`'s answer for
  one document is now its own function, `_delta_told(def, name, rows)` (the framework's,
  `_delta_told_framework`, as it was). `generateSql` writes `dzql_told__<prefix>(name, rows)` for
  each document: whether the name makes it one row, its root, the columns it shows (`columns`, with
  the id and parent key), the empty root an implied one opens with. `_delta_told` sends each
  compiled document to its own, any other to the framework. Equal to the framework for every name
  over a write touching every row in every way (arrives, stays with all, one or no field changed,
  carried, leaves, no concern of anyone's), on the seed and after writes
  (`tests/compile/told.test.ts`). Showing every row whole, not skipping a carried row, telling an
  implied root's leaving as null, or dropping the parent key each fail. A write: 0.745 ms p50
  compiled against 1.000 ms framework (26% less, from 22%).
- **The fan-out is compiled** (2c, piece 4): which open documents hold a row a write touched
  (`_delta_holders`). `generateSql` writes `_delta_holders` itself: for the row's collection, each
  document that holds it in turn -- its prefix's lock, its open names (by the root the row hangs
  from, the chain written as lookups, or every open name of its prefix), the writer's, each name
  its prefix owns whose document holds the row (`dzql_holds__<prefix>`). A document not compiled
  is asked by the framework's, now `_delta_holders_framework(collection, row, writer, skip)`, told
  the prefixes asked already. Still SECURITY DEFINER with pg_temp last, compiled or not. Equal to
  the framework for every collection, row and writer (`tests/compile/holders.test.ts`): on the
  seed, with only the writer open, after writes, and with documents registered by hand beside the
  compiled ones, one a longer prefix taking a compiled one's names. Dropping the longest-prefix
  rule, the fallback, the writer, the chain, or finding a scoped document by its root each fail. A
  write: 0.706 ms p50 compiled against 1.049 ms framework (33% less); the fan-out with 10 open,
  0.88 to 0.79 ms.
- **A name is read by its document's scope, compiled** (2c, `delta_apply`'s first slice). Every
  write, the framework's reads and the ops log read a document's name by its scope
  (`_delta_resolve_scope`: the conditions as SQL text, the equality values, single or list, a time).
  `generateSql` writes `dzql_scope__<prefix>(name, refuse)` for each document, giving the
  framework's JSON exactly, its `where` in the framework's words, a value refused with the same
  message (raised, or answered as the scope that holds nothing). `_delta_resolve_scope` sends each
  compiled document to its own, any other to `_delta_resolve_scope_framework`. Equal for 1,228
  names, both ways (`tests/compile/resolve.test.ts`): the path cases' and names made to probe each
  check (signs, spaces, zeros, past 2^53, not whole, text for an id, dates not in the calendar,
  empty values). Dropping a `like`'s `%`, the values, the `at`, the refusal's reason, single mode,
  the framework's `AND`, or reading a text id as a number each fail. The resolver's share of a
  write fell from 0.071 to 0.012 ms; a write: 0.657 ms p50 compiled against 1.059 ms framework
  (38% less).
- **A one-row document's root check is compiled** (2c, `delta_apply`'s second slice). Before each
  op, a write through a one-row document asks whether its root is there and meets the whole of its
  name's scope. The framework ran the resolver's conditions as text (`EXECUTE`); `delta_apply` now
  asks `_delta_root_there`. `generateSql` writes `dzql_root_there__<prefix>(name, id)`: the name's
  values checked as the resolver checks them, and the root's current rows asked with typed
  conditions. Documents not compiled go to `_delta_root_there_framework`, which runs the same
  `EXECUTE` as before. It is equal to the framework for 745 names (the path cases' names, plus
  probes) and every root id, each version, ids not there and none, on the seed and after writes that
  close and remove roots (`tests/compile/root.test.ts`). Dropping the scope's conditions, reading
  every version, ignoring an unscoped name's id, or not checking the values each fail.
  - The bench's `bench:` is a list, which never runs this check. Measured ad hoc through a one-row
    document (`bench-item:<id>`, one replace of its root as the app role): 0.651 to 0.636 ms p50
    compiled, about 15 µs a write (framework 0.855 ms), and more per op on longer writes.
- **A write's columns and their checks are compiled** (2c, `delta_apply`'s third slice). The columns
  stay the writing process's (`delta.declared`, else the database's: two versions on one database
  each write by their own), read at run time as before. What follows from the definitions is
  compiled:
  - `dzql_columns__<prefix>(collection, columns_def)` gives the columns a document writes, with
    its own `columns` list written in. `_delta_write_columns` sends each compiled document to its
    own, any other to `_delta_write_columns_framework`.
  - `_delta_assert_fields` checks each set of columns the definitions give a collection (all of
    them, and each document's own) by written statements, with the framework's messages, still
    ordered by SQL's `ORDER BY` so the collation orders both alike. Any other set (a walk's,
    another version's) goes to `_delta_assert_fields_framework`.

  Held equal (`tests/compile/columns.test.ts`) for every document and collection with nothing, the
  app's own or another version's columns declared, and for every collection, set of columns (the
  compiled ones and sets it never saw) and parent key, over values probing each check. A test with
  the framework's checks made to raise shows the compiled sets never reach them. The test caught a
  precedence bug before it landed (`p_value->'n'::text::numeric`). An unknown field's message,
  the parent key, a whole number, the messages' order, the time's pattern, a document's own columns
  and the object check, each broken on purpose, fail. A write: 0.624 ms p50 compiled against
  1.063 ms framework (41% less); through a one-row document, 0.636 to 0.60 ms. The codegen test
  that a plain table has no `valid_from` now asks of the table's DDL: the checks name it, as a
  write's value may carry it.
- **A write's row SQL is written out per collection** (2c, `delta_apply`'s fourth slice). The
  statements a write runs on a row were built from the table's name and planned again on every
  call (`EXECUTE format(...)`). They are now functions that `generateSql` writes for each
  collection, as statements whose plans the database keeps:
  - `_delta_row_lock`: the row as it stands, locked;
  - `_delta_row_put`: a replace's row stored, a temporal one as a new version;
  - `_delta_next_id`: an add's id;
  - `_delta_row_clear_moment`: a version this write made and took back;
  - `_delta_row_there`: is it there now.

  Any other collection goes to each one's `_framework`. Held equal (`tests/compile/rows.test.ts`)
  for every collection and every id (each version, absent, none), on the seed and after writes.
  Each pair runs in one transaction, rolled back to the same savepoint between, so both see one
  `now()`, and the table left behind is compared too. The replaces cover the row again, changed,
  twice in one write, and missing what it must have. Seven mutations each fail it. An add's own
  INSERT stays the framework's: it names the columns the row gives, so one it leaves out takes its
  database default. A write: 0.595 ms p50 compiled against 1.068 ms framework (44% less; 3.25x a
  raw `UPDATE`, from 5.8x); through a one-row document, 0.60 to 0.567 ms; the fan-out with 10
  open, 0.76 to 0.69 ms.
- **Cascades, hanging rows, an add's row and an implied root's first write are compiled** (2c,
  todo #27). They are what a write still built from text after the row SQL.
  - What a remove takes, and what a moved row carries: the framework walked `_delta_collections` at
    run time for a collection's children and the collections that cascade on it. `generateSql` now
    writes `dzql_cascade_remove__<coll>`, `dzql_cascade_rows__<coll>` and
    `dzql_hanging_rows__<coll>` for each collection. Each has the schema's children and `cascadeOn`
    written in, in the framework's order (child collections, then the collections that cascade on
    it, each by `COLLATE "C"`, rows by id). `_delta_cascade_remove`, `_delta_cascade_rows` and
    `_delta_hanging_rows` send each collection to its own, any other to `_framework`, whose own
    recursion goes through the same names. Two collection keys that would share a function name
    are refused when compiling.
  - An add's row: the framework's INSERT names the columns the row gives, so one it leaves out
    takes its database default. Where the row gives exactly every column the schema declares, that
    INSERT is one statement, written per collection (`_delta_row_add`); any other key set is the
    framework's. `_delta_row_read` reads a row as it stands.
  - An implied root's first write asks `_delta_row_there`, `_delta_row_read` and `_delta_row_add`.

  Held equal (`tests/compile/cascades.test.ts`) for every collection and every id (each version,
  absent, none), on the seed and after writes. It covers what a remove would take, the remove,
  a second remove, what is left, the hanging rows, the read, and adds of every column, fewer, a
  taken id and the same id twice. Each pair runs in one transaction from the same savepoint, the
  framework's dispatchers pointed back at it so its recursion stays its own, and every table left
  behind is compared too. A row giving every declared column is stored with the framework made to
  raise. Eight mutations each fail it. Measured ad hoc through `bench:1` as the app role: an add,
  0.59 to 0.56 ms compiled (framework 0.90); a remove, 0.58 to 0.52 ms (framework 0.82). Replaces,
  which the bench times, are unchanged at 0.593 ms.
- **The ledger's reads are compiled** (2c, the ledger walk). An entry's inverse and a walk's guard
  read the document whole, every column whatever it names (`_delta_open(name, TRUE)`). That was
  the framework's interpreting read, beside the compiled opens.
  - `generateSql` writes `dzql_open_whole__<prefix>(name)` for each document: its open with every
    column. `_delta_open` sends each compiled document to its own open, shown or whole, and any
    other to `_delta_open_framework`.
  - `_delta_same` (a field the same in two values, a time by its instant) has each collection's
    time fields written in. It still takes the writing process's declared type
    (`delta.declared`) first.
  - The rows a walk guards beyond the document are read by `_delta_row_standing`, per collection.
  - `_delta_open_held` asks `_delta_row_there`.

  Held equal (`tests/compile/ledger.test.ts`): every path-case name and one no document holds, read
  whole and shown, on the seed and after writes; every collection and field (and ones there are
  not) over pairs of values, with nothing, the app's own and another version's columns declared;
  every collection's rows beyond, and a collection there is not. Seven mutations each fail it.
  Measured ad hoc as the app role, from an empty ledger: a logged write through one row 0.815 to
  0.78 ms compiled (framework 1.12), through a list of 100 1.09 to 1.056 ms (framework 1.63); an
  undo about as before (1.45 and 2.34 ms; framework 2.0 and 3.5): its cost is the walk's own plan,
  not these reads. An undo slows as its cursor's ledger grows (todo #28).
- **The compiler names its functions by one rule** (`named` in `src/compile/opens.ts`), and writes a table's standing rows one way (`standingRows`, `currentOnly`): a simplicity pass before 0.10.0, the SQL it writes unchanged byte for byte (every compile snapshot as it was).
- **Doc comments name dzql's subpaths.** Nine comments in `src/postgres/` and `auth-jwt.sql`
  still said `@blueshed/delta/postgres` and `@blueshed/delta/auth-jwt`, which delta 1.0 no longer
  has; they now say `dzql/postgres` and `dzql/auth-jwt`.

### Fixed

- **An undo no longer slows as its cursor's ledger grows** (todo #28). Each undo and redo found its
  entry by walking every chain the cursor had ever begun (a recursive query over its whole
  history), so one cursor's undo went from about 2 ms to about 15 ms over a few thousand entries.
  `_delta_ledger_tip` now looks newest first among the cursor's own entries, a step at a time on a
  new `(cursor, id)` index. It stops at the first tip that goes the way asked: depth along its
  chain, up to the write that began it, is found by following `undoes`. A redo stops at the
  cursor's last write. It relies on every entry of a chain carrying its write's cursor, as
  `delta_walk` records it.
  - `tests/delta-pg/ledger-tip.test.ts` keeps the old walk as the reference. Over five seeded
    runs of 150 steps (three cursors writing, removing, adding, writing facts, undoing, redoing,
    walking a change by name, conflicts as they come), both take the same entry for every cursor,
    both ways, after every step. Four mutations each fail it.
  - On a cursor with 1,500 write-and-undo pairs, finding an undo's entry reads 1 row of the ledger
    (the old walk read 1,503), counted by the transaction's own table and index counters. Against
    the old function that test fails.
  - Measured ad hoc as the app role, the ledger growing run to run: an undo stays at 1.07 ms
    through one row and 1.6 ms through a list of 100, compiled (it was 1.45 and 2.34 ms from an
    empty ledger, and grew).

  delta's SQLite ledger (`src/server/ledger.ts`) finds the tip by the same recursive walk.
- **A late telling no longer reddens the path cases on a server.** The listener fetches what a
  NOTIFY announced after the write has answered, so under CI's load a write's telling could land
  after the case opened its documents again and cleared what was heard, and `expectSilent` counted
  it (`an add names a new id, past the serial`, on blueshed/dzql#25). The harness
  (`tests/delta-pg/postgres-path.test.ts`) now waits, before each open, until every open document
  has heard up to the version the database has for it. Delta's case is unchanged. With every
  telling delayed 200 ms, that case fails without this and passes with it.
- **The bench measures row-level security (todo #25).** Every timed write runs as `bench_app`
  (NOSUPERUSER NOBYPASSRLS); the bench refuses to run as a role that bypasses RLS; the policy reads
  `NULLIF(current_setting('app.user_id', true), '')`, so a pooled connection's `''` no longer breaks
  it. It times delta's write with the framework's reads and checks and with them compiled, against
  a raw `UPDATE`: 1.078 ms, 0.839 ms (22% less) and 0.184 ms p50 (`bench/results-2026-10-15.md`).
  The 0.3.0 results are labelled as taken with RLS bypassed.

## [0.9.0] - 2026-10-15

### Added

- **dzql holds everything Postgres that delta held** (step 4 of the split, dzql's side), so delta
  can drop it: delta's Postgres tests (`tests/delta-pg/`: the listener, RLS, the ledger, custom
  documents, isolation, the pointer and walk vectors in SQL, migrations and the schema contract,
  `auth-jwt`, the 0.10.0 ledger SQL, the review findings), its Postgres examples
  (`examples/delta/todos-vs-rls`, `examples/delta/sites-bbox`), its bench (`bench/`, `bun run
  bench`) and its todo #77 (now #25), and its Postgres commands: `dzql sql`, `dzql init` and
  `dzql migrate` (a postgres:// URL or a PGlite folder; a SQLite file stays `delta migrate`).
  `dzql init` stamps what it vendors `@blueshed/dzql`, and upgrades a file `delta init` stamped.
  delta's Postgres skill pages are `docs/delta/` (postgres, rls, sql), and the cases that left delta's
  CLI and client tests run here against dzql's Postgres (`tests/delta-pg/cli-and-client.test.ts`).

### Changed

- **`@blueshed/delta` is a peer, `^1.0.0`**: an app installs delta and dzql side by side, and they
  share the one delta (its server, its client, its definitions). delta 1.0.0 is delta without
  Postgres; dzql is its Postgres.
- **A document registered by hand opens through the framework.** `docTypeFromDef` reads through a
  document's compiled functions when `generateSql` made them, and through `delta_open` /
  `delta_open_at` for a document whose SQL was written by hand.
- **A compiled read gives the row as stored** (minus a temporal row's validity), narrowed only by
  a document's held columns, as `delta_open` does: two versions on one database each show their
  own schema's columns (the schema is the contract), where a read compiled for one version's
  columns hid a column the other declares.

### Changed

- **The listener opens documents through compiled SQL** (step 2c, its first piece). `generateSql`
  now writes each document's reads compiled from its definitions -- `dzql_open__<prefix>(name)` and
  `dzql_open_at__<prefix>(name, at)`, each with its `_as` -- and `docTypeFromDef`'s `open` and
  `openAt` call them in place of `delta_open` and `delta_open_at`. Nothing changes for an app that
  applies `generateSql` as before. delta's cases pass through them unchanged (the path, `owns`, the
  law, the writes), and `tests/compile/` holds each equal to the framework's read for every name
  the path cases open, now and at three times, on the seed and after writes. The `dzql_open`
  dispatcher is gone: each registration calls its own document's function, and a dispatcher one
  `generateSql` wrote would lose another's documents. Writes, the ledger and a name's scope still
  run on the framework SQL.
- **A document's name is read by compiled SQL too** (2c, scope). Each document's open reads its
  name's values by position, checks each as its column takes it with the framework's own messages
  (an integer, a number, a date read as midnight UTC, an id past 2^53 - 1), and writes its
  conditions as typed SQL. The opens no longer call `_delta_resolve_scope` or build a query from
  text (`EXECUTE`); a document that cannot be one row has no single branch. Equal to the framework
  for every name, errors included; dropping one check on purpose fails its names.

### Docs

- **`philo.md` says what dzql is for now**: delta's compiled Postgres step. Stories, then
  documents, then entities; delta's definitions as the input and its wire as the contract; Claude
  writes the compiler and is never it; delta's cases as the proof; permissions a document's,
  migrations delta's. The patterns (Workflow, Activity Stream) stay the vision, over documents.
- **CLAUDE.md** names the new parts (`src/postgres`, `src/sql`, `src/compile`, `tests/delta`,
  `tests/compile`) and their rules; `docs/for_ai.md`, `project-setup.md` and `docs/README.md` open
  with a note that they describe the whole-stack dzql, which step 5 retires.

### Added

- **Compiled opens: `dzql/compile`'s `compileOpens(schema, docs)`** (step 2b of the Postgres split).
  From an app's delta definitions (`defineSchema`, `defineDoc`) it writes one function per
  document, `dzql_open__<prefix>(name)`, and `dzql_open(name)`, which finds a name's document by
  its longest prefix as `delta_open` does. Each query is written out from the definitions --
  which table, the columns a document shows (its held columns too), how an included collection
  hangs from the root (a join up its parent chain; none where the chain ends short of it), a
  temporal row standing now or at a time in the name, an implied root's defaults -- where the
  framework reads its tables of definitions at run time. A name's scope and the version stay the
  framework's until 2c. A pure function: the same definitions give the same text, pinned by a
  snapshot; a document over a collection the schema lacks, or two whose functions would share a
  name, is refused. `tests/compile/opens.test.ts` opens every name delta's path cases open, both
  ways on PGlite, on the seed and after writes of every kind: 82 names, equal, errors included.

## [0.8.0] - 2026-10-15

### Added

- **dzql is delta's Postgres step: `dzql/postgres`, `dzql/pglite` and `dzql/auth-jwt`** (step 2a
  of the Postgres split, `docs/postgres-split-plan.md` in Workshop). delta's Postgres backend --
  the listener, the registry, codegen, carry, migrations, bootstrap, PGlite, the JWT reference and
  the framework SQL (`src/sql/001a`-`001g`, `auth-jwt.sql`) -- is copied in as it is at delta
  0.15.0 (`711186e`), importing only delta's public subpaths and `@blueshed/delta/backend`
  (`@blueshed/delta` ^0.16.0 is a dependency, with `pg` and `@electric-sql/pglite`). A delta
  app moves its `@blueshed/delta/postgres` and `/pglite` imports to `dzql/postgres` and
  `dzql/pglite`, the same names; nothing else changes. dzql's tests run delta's published cases
  unchanged (`@blueshed/delta/testing`): the path, `owns` and the law over generated writes on
  PGlite, with no Docker, and the write cases on PGlite and the test database
  (`tests/delta/`). The compiled SQL replaces the copied framework SQL in later releases.

### Changed

- **jose ^6** (was ^5), as delta's JWT reference takes it; the runtime's `SignJWT` and `jwtVerify`
  are the same.

## [0.7.0] - 2026-10-15

October 2026. Pull requests #8 to #16. The last release of dzql as a whole stack:
next it becomes the compiled Postgres step for delta projects.

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

### Fixed

- **The client reconnects to where it connected.** A dropped socket reconnected with no URL,
  so outside a browser it went to `ws://localhost:3000/ws` whatever `connect(url)` had
  named, and a failed attempt was an unhandled rejection. It now goes back to the last URL
  given; a failed attempt only schedules the next. `disconnect()` stays disconnected (its
  socket's close no longer reconnects), and a socket replaced by a later `connect()` does
  not reconnect beside it (`tests/ws_reconnect.test.ts`). Found when CI ran again.

### Repository

- **`/publish patch|minor|major`** (`.claude/commands/publish.md`), the release procedure
  railroad, delta and eta share, for dzql's two packages and their tags.
- `bun run test` fails when its database does not start, or a test fails: it answered
  with the teardown's exit code, so a setup that could not bind its port passed.
- CI runs again, on every push to `main` and every pull request: Bun pinned at 1.4.3, a
  type check, then the suite against a Postgres service. It had run only by hand since a
  Bun download problem.
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
