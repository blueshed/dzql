# Paintbrush

<!-- template -->
> **This is the paintbrush template.** `bun create blueshed/paintbrush my-app` copies it, runs `bun install`, then runs `create/setup.ts` (the template's postinstall). Setup gives the app a fresh `todo.jsonl` and `CHANGELOG.md`, puts its name in place of "Paintbrush" in the files listed in `NAMED`, copies railroad's skill into `.claude/skills`, and deletes what is about the template: `create/`, `tests/setup.test.ts`, `logo.png`, `evals/` (the evolve skill's evaluations). A test fails if the word "paintbrush" appears in a file `NAMED` does not list. This repo's own `todo.jsonl` and `CHANGELOG.md` are about the template.
>
> `bun create` runs each `bun-create` postinstall entry as `bun run <entry>`, so the entry in `package.json` is `create/setup.ts`; writing `bun run create/setup.ts` runs `bun run bun run ...`, which does nothing and says nothing (checked on Bun 1.4.2). bun create's own git step also races the script (its `git add` can hit a file the script has just deleted and give up), so `setup()` ends by committing or amending, and a new app is always one commit with a clean tree. After changing `create/`, test the whole flow, more than once, since a race shows only some of the time: put a copy of this repo in a folder, then `BUN_CREATE_DIR=<that folder> bun create <the copy's name> <a new folder>`, and run `bun test` in the new folder.
>
> `setup()` refuses to run in a clone of this repo (its `origin` is the template's), because it deletes things. Write ledger and changelog text with the file tools, never inside a quoted shell argument.
<!-- /template -->

A Bun website of **routes and resources**. Bun is the server, the bundler and the test runner, with a WebSocket, SQLite and S3 built in; railroad draws the page and Railway deploys it. Every route and handler is written out, so `src/server.ts` and `src/app.tsx` say what the app does. The approach is settled: build on it.

**Start small.** The app is what is listed below and nothing else. Add something only when the user asks for what it provides. Its code and its tests go in together, and coverage stays at 100%.

**To add a resource or change one** (a new route, a live push, SQLite, S3, a shared delta document), use the `evolve` skill.

**Where the project is.** `CHANGELOG.md` and `todo.jsonl` are the project's memory between sessions, and they work as a pair: the changelog is where the project has been, the ledger is what is open now. Read both before starting: the open items, and what `## [Unreleased]` holds that no release has yet. As you work they move together, as it happens and not at the end. What you find or leave open goes into `todo.jsonl`. What lands goes under `## [Unreleased]`, breaking changes first, and the item it settles becomes `fixed` with a dated `note` saying so. A change with no entry, or an item marked fixed with no entry behind it, means the record is wrong. `/release` closes the pair: `[Unreleased]` becomes a version, and the settled items leave `todo.jsonl`.

`todo.jsonl` has one JSON object per line: `n`, `status` (open / fixed / not fixed), `severity`, `area`, `file`, `summary`, `detail`, plus a dated `note` once an item is worked on.

## What is here

```
src/
  server.ts          Bun.serve(): every route, the WebSocket, and startServer() for tests
  main.ts            the entry point: a pid file and signals, then startServer()
  index.html         the page; Bun bundles what it references, no build step in development
  app.tsx            railroad's routes: each draws a resource's view
  styles.css         the design, with its rules at the top
  resources/         a folder per resource (<name>-api.ts, <name>.ts, <name>-view.tsx), toast.ts, icon.tsx
tests/site.test.ts   routes, page and entry point; the browser-test rules are at its top
.railway/railway.ts  the deploy; its rules are at its top
```

- `message` is editable, kept as `message.json` in the data folder (`DATA_PATH`, else `data/`, git-ignored). A save is published on `/ws`, so every open page follows.
- `status` is read-only: whether `DATA_PATH` is set, never where the folder is.

## Rules

- **Use Bun.** Before adding a package, check what Bun has: its docs are in `node_modules/bun-types/docs/`. Server, WebSocket, SQLite, S3, files, hashing, `.env` and a test browser (`Bun.WebView`) are all built in.
- **The page is railroad, not React.** Read the `railroad` skill before writing JSX: `onclick` and `class`, never `.get()` in JSX children, `list()` for an array that changes length.
- **Icons are lucide.** Import the icon by name and draw it with `<Icon>`: `<Icon icon={Save} />` beside a label, `<Icon icon={X} label="Close" />` on its own. Never another icon set or inline SVG.
- **Tests.** `bun test` fails below 100% coverage. Never lower the threshold; write the missing test. The client and `main.ts` aren't in the coverage table, so the browser and spawn tests are what cover them. `bun run typecheck` is Bun's own `bun check` (TypeScript 7) and checks everything.
- **The server.** `main.ts` keeps `.server.pid` so a server started in the background can be stopped with `bun run stop`. Tests read the `Listening on <url>` line: keep it, and keep it last.
- **Assets.** Images (and a favicon) go in `src/` beside the HTML, referenced by a path relative to it, never `/static/...`.
- **Deploying.** There is no build: `bun run start` runs from source with hot reload off. `/health`, and `.railway/railway.ts` with a volume for the data. A build is optional (the `evolve` skill's references). **Always run `railway config plan` and show the user the result. Never run `railway config apply` without the user's explicit go-ahead, and never pass `--yes` or `--confirm-destructive`.**
- **Claude Code on the web.** The sandbox's Bun is too old and it has no browser. `.claude/hooks/session-start.sh` installs both there and does nothing anywhere else; its header says how to run it by hand. CI does the same on GitHub.
