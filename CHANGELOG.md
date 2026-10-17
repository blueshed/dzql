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
  signals, closing what the resources opened); `delta stop` stops it. paintbrush, eta's `createServer` (`bun run start`/`stop` in dzql), delta's
  examples, the recipe and the skills are on it; no package writes a `Bun.serve` of its own. The
  create-dzql template is left as it is, as `bun create dzql` is to make eta's starter instead.

- **paintbrush is in, at `packages/paintbrush`**, with its history: the starting website, run and
  tested where it lives (`bun run test:paintbrush`). **`bun create blueshed my-app`** makes one:
  `packages/create-blueshed` is the small command (create-blueshed on npm, until now published from
  blueshed/invoket, where it ran `bun create blueshed/paintbrush`); publishing it copies paintbrush in.
  paintbrush keeps its ignores as `gitignore`, which setup dots, since npm drops a `.gitignore`. The
  READMEs say `bun create blueshed my-app`. blueshed/paintbrush and blueshed/invoket on GitHub are
  untouched, and `bun create blueshed/paintbrush` works until Peter archives it.
- Root scripts test each package from the top: `bun run test:railroad`, `test:delta`, `test:dzql`,
  `test:paintbrush` (the fast tier), and `:slow` beside each that has one; `bun run test` is every
  package's fast tier.

- **paintbrush is on delta's one server**: `src/server.ts` and `src/main.ts` became `src/routes.ts`,
  the app's routes and documents (`startServer` gives them to `serve`; run as the entry, `run` is the
  process). `bun run stop` is `delta stop`. The evolve skill's references and their test follow;
  in its home the evolve test installs the delta beside it, packed, since paintbrush needs what npm's
  delta does not have yet: **delta is released before create-blueshed**.
- **Bun 1.4.3 and `bun check`**: every package.json says `engines.bun >=1.4.3` (railroad keeps its
  1.3.14 floor, which its CI proves), `@types/bun ^1.4.3`, the root `packageManager: bun@1.4.3`; the
  root's override of `@types/node` and railroad's `typescript` dev dependency are gone, and no
  script runs `tsc` (railroad's consumer check is `bun check` alone). `@types/node` stays only as
  what `bun-types` and `@types/pg` themselves depend on.
- **One `tsconfig.json` at the root**: what every package compiles with (strict, ESNext, bundler
  resolution, Bun's types); railroad's, delta's and dzql's extend it with only their JSX and files.
  paintbrush and create-dzql's template stand alone, since a new app leaves the repository. No
  shared `bunfig.toml`: Bun reads only the one where a command runs, and each package's differs
  (dzql's and paintbrush's coverage gates, railroad's happy-dom; delta has none).
- **One `docs/` at the root**, by package: `docs/railroad/` (why-railroad), `docs/dzql/` (philo.md;
  `modelling/stories.md`; `rendering/`, eta's docs and the bento; `postgres/`, delta on Postgres;
  `eta-history/`, eta's changelog and ledger), and across them `monorepo-plan.md` (moved in from
  Workshop/docs, a pointer left there) and `stories-as-code.md`. Each package's README, CHANGELOG,
  CLAUDE.md and skills stay where npm and `install-skills` find them; dzql no longer publishes
  `docs/delta`, and its README links to the docs on GitHub. `docs/README.md` is the index. From
  Workshop/docs, copied (the originals stay): the postgres split plan, the stories plan, the link
  sign-in and pears plans, eta's language, CSS review and modeller, document proofs, and the history.
- **CI runs less for a change** (a designer's review, applied): dzql's workflow is two,
  `dzql-postgres.yml` (the compiler and backend against Postgres) and `dzql-eta.yml` (modelling and
  rendering in a browser), each run only when its half, or what it stands on, changes; a railroad
  change runs `delta-railroad.yml`, only delta's five test files that load railroad, not all of
  delta; railroad's browser suite runs once, not twice; and railroad's oldest-Bun check (1.3.14)
  moved to the release workflow. (The TypeScript 5.9 check had already gone with `tsc`. The 27 SVG
  tag tests to collapse were not found in railroad's suite: its SVG tests are each a different case.)

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
