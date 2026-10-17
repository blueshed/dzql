# Changelog

What changed across the repository: where the packages came from and how they are worked on
together. Each package's own `CHANGELOG.md` has its detail; `todo.jsonl` beside this file is
what is open across them. Newest first.

## [Unreleased]

### Changed

- **One repository: railroad, delta and dzql** (17 October). railroad and delta moved in as Bun
  workspaces with their history (`packages/railroad`, `packages/delta`); dzql and create-dzql moved
  to `packages/dzql` and `packages/create-dzql`. The repository keeps the name **blueshed/dzql**
  (not renamed to bluetools: npm's trusted publishing names this repository at the next release);
  every package's repository field, homepage and README links point here. One `bun.lock`, one CI
  workflow per package (`.github/workflows/<package>.yml`, run when it or a sibling it depends on
  changes), one `/publish`. Gates passed on Peter's Mac with Docker and Chrome: railroad 293,
  delta 1013, dzql 4558.
- **eta is in dzql: `dzql/modelling` and `dzql/rendering`** (17 October), with eta's history.
  Modelling is the stories, the harness that tells them, by hand in a browser, and the costs;
  rendering is pages the server draws (eta's kernel). One package, each part its own entry;
  railroad is an optional peer, needed only by an island. eta's examples are in
  `packages/dzql/examples/`, its skills in `packages/dzql/.claude/skills/`, its docs, changelog and
  ledger in `packages/dzql/docs/eta/`. eta's own `bun create` and `eta:update` retired: an app
  installs dzql. (packages/dzql/CHANGELOG.md)
- **Two test configurations in dzql**: `bunfig.toml` is eta's (100% coverage, the client's read
  from Chrome), and dzql's Postgres tests run with `tests/bunfig.toml`. CI's `dzql.yml` has an eta
  job; railroad's job that checked out eta's repository is gone.
- **The gate is `bun run affected`**: each package a change touches, and each that depends on one,
  runs its fast tier (a type check, the tests with no browser and no Postgres server): railroad
  1.4 s, delta 18 s, dzql 26 s, about 46 s for all three. The slow tier (browsers, Postgres, eta's
  stories and costs) is CI's and a release's (`--slow`). CI's eta job runs two workers with a
  longer wait, as a runner is slower than a Mac.
- **One server, in delta** (`@blueshed/delta/serve`): `serve()` serves an app's routes with delta's
  socket, `/health` and a 404; `run()` is the process around it (the pid file, `bun --hot`, the
  signals, closing what the resources opened); `delta stop` stops it. The apps move onto it next.

### Removed

- `feedback.md`, on Peter's word: its findings are fixed and its tensions are in `todo.jsonl`.
- The empty `.agents/` and `.gemini/` folders on the Mac (made by a tool outside the repos on
  16 October), and `.gitignore` keeps them out.

### Reviewed

- `feedback.md` (a code review of dzql, 16 October): its five findings are fixed in dzql's
  `[Unreleased]` (no `_delta_docs` read when a write is told; a replace updates in place; no
  `./compile` export; names that fit Postgres; `bunx dzql` in the messages). Its three tensions
  stay open as design notes: fan-out cost inside the write, RLS derived from `owns` (dzql #19), and
  unbounded collections.
