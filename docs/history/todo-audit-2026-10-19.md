# The todo.jsonl audit, 19 October 2026

Every ledger read, every open item checked against the code as it is at the end of the day. The
ledgers are the record; this is the audit's account of them, at that moment.

## What the audit did

- **Sorted.** The root keeps what is open across packages. 36 items that were one package's alone
  moved to that package's ledger (each notes its old root number); two of paintbrush's that were
  not paintbrush's (duckdown's `bun-create` entry, shinko) came up to the root.
- **One shape.** Every item has the same eight fields in order (`n`, `status`, `severity`, `area`,
  `file`, `summary`, `detail`, `note`); severities are low, medium or high; numbers are unique
  and sorted; paths name where the files are now.
- **Settled what is done:** root #16 (branches pruned across the Mac), #17 (CLAUDE.md says which
  package and skill), #54-#57 (the package shape), #71, #72, #105 (one CI workflow, publish.yml's
  gate), #74 (paintbrush's old scaffolding), #79 (one `model` script); dzql #76 (skills stamped by
  /publish); paintbrush #13 (ledger written with the file tools).
- **Closed what is not to be done:** root #19 (an llms.txt no story needs), #111 (shinko: an idea,
  parked), #112 (duckdown's, which duckdown handles); dzql #30 (the model guesses nothing, by design).
- **Decided:** dzql #52, the cafe's orders name the dish (`dish: menu:/items`) and say when, and
  read its price as it stood, on Peter's rule.
- **Settled items leave every ledger at a release** (/publish said so of dzql's alone): delta's two,
  shipped in 1.3.0, left.

## The ledgers now

| Ledger | Open | Fixed (until the next release) | Not fixed |
|---|---|---|---|
| root (`todo.jsonl`) | 26 | 47 | 3 |
| dzql (`packages/dzql/todo.jsonl`) | 30 | 3 | 1 |
| delta (`packages/delta/todo.jsonl`) | 6 | 0 | 0 |
| paintbrush (`packages/paintbrush/todo.jsonl`) | 5 | 1 | 0 |
| railroad (`packages/railroad/todo.jsonl`) | 2 | 0 | 1 |
| **all** | **69** | **51** | **5** |

## Every open item

Each was checked against the code on 19 October and is true. High first, then medium, then low.

### root

| # | Severity | Area | What |
|---|---|---|---|
| 30 | medium | docs | Docs review: the skill-page fixes, after Shed 3 |
| 37 | medium | all | Code review: the changes that would alter how a package is used, for Peter |
| 39 | medium | skills | Shed run 4: the due date was worked out in the page, not stored (stage 4's must-not fails) |
| 60 | medium | review: DRY/YAGNI | validateOps is a third copy of delta's write rules, and nothing calls it |
| 62 | medium | review: DRY | dzql copies delta's sites-bbox example, its schema and its test helper (already drifted) |
| 73 | medium | skills | The evolve skill has no step that moves the pages to the server (the thin client): the path from paintbrush to dzql stops at Postgres |
| 97 | medium | review: DRY | Bun 1.4.3 is pinned in about 30 places |
| 98 | medium | review: DRY | The gate commands are written in four kinds of place |
| 100 | medium | review: DRY | delta keeps a copy of railroad's skill, its prepare reimplements install-skills, and railroad's README teaches a third way |
| 101 | medium | review: DRY | Six statements of which skills a new app gets |
| 108 | medium | review: DRY | The Postgres start-up sequence is written six ways; only app-store.ts puts it in code |
| 13 | low | repos | Archive the old railroad, delta, eta, paintbrush and invoket repositories on GitHub, each README pointing here |
| 68 | low | review: DRY | Skills are installed two ways, and the evolve test copies the template another way |
| 69 | low | review: small | The review's small list: one command three names, stale comments, test-only exports, three ways to find an app folder |
| 70 | low | review: YAGNI | Half of docs/plan.md is stale; client-plan.md is finished but for one item |
| 78 | low | release | /publish lists sibling ranges by hand and states each gate differently from the packages' test:slow |
| 86 | low | docs | Root statements the repo no longer bears out |
| 87 | low | toolset | Root package.json scripts and fields nothing uses, and the old compiler's dist |
| 88 | low | docs | Docs that only work on Peter's Mac |
| 94 | low | docs | docs/stories.md restates the harness at length; three statements of what each document is for |
| 95 | low | dzql | defineCustomDoc is the same function in dzql's listener and delta's SQLite backend |
| 99 | low | review: DRY | The session-start hook is in both the root and paintbrush |
| 102 | low | review: DRY | The routes/resources table is written several times |
| 103 | low | review: DRY | The vision text is restated outside the root README |
| 106 | low | review: DRY | The CHANGELOG/todo rules are restated in each package's CLAUDE.md |
| 109 | low | review: DRY | paintbrush's leave-behind list is written four times; the 233 KB logo and evals ship in the tarball only to be deleted |

### dzql

| # | Severity | Area | What |
|---|---|---|---|
| 19 | medium | security, design | Three generated functions are SECURITY DEFINER (_delta_holders, _delta_serial_new, _delta_serial_past), so their generated predicates are the only guard there |
| 52 | medium | examples, skills | The hand-written examples and the dzql-app skill still teach temporal: false; the cafe copies an item's name and price into each order rather than naming the dish |
| 59 | medium | review: DRY | The compiler writes its per-document dispatcher seven times, with three ways of an empty CASE |
| 60 | medium | review: DRY | The stories harness restates the client's rules for controls, three times; harness.ts is 1,744 lines of about ten jobs |
| 61 | medium | review: DRY | The server message typed five ways, the undo write built four ways, the session cookie read four ways |
| 62 | medium | review: DRY | The modelling example keeps a second store and a second sign-in; five examples repeat their SQLite setup |
| 64 | medium | modelling | examples/modeling/loader/model/ is 1,656 lines of vendored hjeli: a second implementation of closure.ts's six checks, shipped to every app |
| 75 | medium | review: DRY | Cookie reading and home() are done five ways in the examples |
| 29 | low | postgres | A schema per app on one database is not supported: the change channel is database-wide |
| 31 | low | postgres | `dzql sql <module>` heads its SQL "GENERATED FROM types.ts" and "Regenerate: bunx dzql sql ./types.ts" whatever the module is called |
| 50 | low | postgres | PGlite RuntimeError: Aborted() on restarting a dev server (the Shed's feedback, unproven) |
| 53 | low | rendering | Open question, in Peter's concept review: should eta's pages get URLs? |
| 54 | low | tests | eta could run delta's case suite (assertDocIsolation) for its documents (eta #125) |
| 55 | low | tests | A by-hand gesture test timed out (60 s) once in a parallel test:eta run on the Mac, taking three after it; it passes alone and on the rerun |
| 56 | low | tests | "a write's id comes back to its writer alone" failed once under the Mac's full parallel run (an id t117 where none was expected, line 763); passes alone and on the rerun |
| 57 | low | eta | A screen's address still lives on the session, so one session's tabs share a screen |
| 58 | low | dzql | Shed run 3: a unique violation on Postgres reaches the page in the database's words |
| 63 | low | review: DRY | Apps come in two shapes (index.ts exporting example, routes.ts exporting app) |
| 65 | low | dzql | Exports nothing imports |
| 66 | low | dzql | GenerateSqlOptions is set only by its own test, and the compiled header's date changes the output daily |
| 67 | low | docs | eta-era paths and names: two skill snippets import paths that no longer exist, and about 90 comments name eta's old layout |
| 68 | low | dzql | A read fallback to delta_open that can only raise |
| 69 | low | tests | The test database URL is written six times under five env names; opening a URL or a PGlite folder is written three times |
| 70 | low | tests | dzql's test configs and scripts overlap |
| 71 | low | dzql | Stale comments and dead settings in dzql |
| 72 | low | dzql | Small repeats in the examples |
| 73 | low | modelling | The model's type has three names, and heart.ts copies reading's types |
| 74 | low | dzql | dzql's CLI builds the same things several ways |
| 77 | low | review: DRY | byId is defined five times |
| 78 | low | tests | A harness test timed out once (30 s) in the fast tier, and every later test in the file failed after it |

### delta

| # | Severity | Area | What |
|---|---|---|---|
| 83 | medium | delta | The JSON file drops columns and tables its schema doesn't declare when it saves |
| 84 | medium | skills | Shed run 4: a group with people outside it fell back to a function-owned recompute document |
| 82 | low | delta | Shed run 3: an admin write (a role, a field) has no delta way in, so the app wrote UPDATE people by hand |
| 85 | low | review: DRY | delta's server header and an eval teach a hand-written Bun.serve; its CLAUDE.md file map has drifted |
| 86 | low | delta | delta small: an exports guard over a folder that is gone, two onSqlite/onJson pairs, two liveness checks, a copied blockAfter, a seven-way peer range |
| 87 | low | delta | delta's shared-state example repeats the recipe |

### paintbrush

| # | Severity | Area | What |
|---|---|---|---|
| 1 | medium | deploy | railway.ts has been type-checked and evaluated locally but `railway config plan` has never run against it |
| 9 | medium | sandbox | The web sandbox hook is railroad's, adapted, and has not been run in a Claude Code web session |
| 12 | medium | skills | Shed run 4: the tools stayed JSON to the end; stage 5 wrote its own JSON-in-Postgres store over delta's internals |
| 11 | low | evolve | A built app cannot find its migrations: every step from sqlite.md loads them from beside its source, and a bundle has none |
| 14 | low | paintbrush | paintbrush: icon.tsx used only by a test, a stale routing claim in the README, and bento.tsx re-declaring dzql's constants |

### railroad

| # | Severity | Area | What |
|---|---|---|---|
| 2 | low | review: DRY | railroad's two browser-testing manuals disagree; its realtime page restates delta's and dzql's and has drifted |
| 3 | low | railroad | railroad housekeeping: build leftovers in a fixture folder, stale todo citations, its Bun floor in five places |

## What is Peter's

Only what the release law reserves, or a product call nothing he has said settles:

- root #13: archive the old GitHub repositories (he is doing it).
- root #37: the changes that would alter how a package is used (island vs applet, the unused exports).
- dzql #53, #57: page URLs, and one screen per tab.
- paintbrush #1, #9: run `railway config plan`, and a Claude Code web session, once.
