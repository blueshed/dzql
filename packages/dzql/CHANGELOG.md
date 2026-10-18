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

### Changed

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

### Added

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
