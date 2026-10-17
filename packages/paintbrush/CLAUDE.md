# Paintbrush

<!-- template -->
> **This is the paintbrush template.** `bun create blueshed/paintbrush my-app` copies it, runs `bun install`, then runs `create/setup.ts` (the template's postinstall). Setup gives the app a fresh `todo.jsonl` and `CHANGELOG.md`, puts its name in place of "Paintbrush" in the files listed in `NAMED`, copies railroad's `railroad` and delta's `delta-doc` skills into `.claude/skills`, and deletes what is about the template: `create/`, `tests/setup.test.ts`, `tests/evolve.ts` (the evolve skill's test, with its `test:evolve` script and its CI step), `logo.png`, `evals/` (the evolve skill's evaluations). A test fails if the word "paintbrush" appears in a file `NAMED` does not list. This repo's own `todo.jsonl` and `CHANGELOG.md` are about the template.
>
> `bun create` runs each `bun-create` postinstall entry as `bun run <entry>`, so the entry in `package.json` is `create/setup.ts`; writing `bun run create/setup.ts` runs `bun run bun run ...`, which does nothing and says nothing. bun create's own git step also races the script (its `git add` can hit a file the script has just deleted and give up), so `setup()` ends by committing or amending, and a new app is always one commit with a clean tree. After changing `create/`, test the whole flow, more than once, since a race shows only some of the time: put a copy of this repo in a folder, then `BUN_CREATE_DIR=<that folder> bun create <the copy's name> <a new folder>`, and run `bun test` in the new folder.
>
> After changing the `evolve` skill's references, run `bun run test:evolve`: it applies each file in `references/` to a new app and runs that app's tests (CI does too). A new reference file goes in its `SECTIONS`, or the test fails.
>
> `setup()` refuses to run in a clone of this repo (its `origin` is the template's), because it deletes things.
<!-- /template -->

A Bun website where people share documents. **Documents are how people communicate**: a document is what you need in front of you to take an action. Open one and you're subscribed: every change anyone makes reaches you as it happens, with nothing to poll, fetch or refresh. Change it with add, replace or remove on a path, and everyone holding it sees it at once. delta keeps the documents, railroad draws the page, Bun serves it and Railway deploys it. Every route and document is written out, so `src/server.ts` and `src/app.tsx` say what the app does. The approach is settled: build on it.

**How it grows.** Anything people share is a document from the start: think in documents, not entities, and ask "what does someone need in front of them to do this?" rather than "what are the tables?" The tables follow from the documents. What grows is where they're kept: a shared JSON document does a lot on its own; SQLite earns its place when documents share the same rows, or for undo and history; Postgres when servers share the data, or people should see only their own. The page and its documents stay the same as the storage grows. HTTP routes serve what isn't communication: the health check, files, the server's status. The app is what is listed below; add what the user asks for, with its tests, and coverage stays at 100%. The `evolve` skill has each step, with code and tests.

**What it is for.** `stories.md` holds the stories the app was asked to make true, each a sentence someone using it could call true or false. When the user asks for something, write it there as stories first (theirs, in their words), then make them true, with tests named for them. Earlier stories stay true; a story that changes is changed there, never dropped quietly.

**Where the project is.** `CHANGELOG.md` and `todo.jsonl` are the project's memory between sessions, and they work as a pair: the changelog is where the project has been, the ledger is what is open now. Read both before starting: the open items, and what `## [Unreleased]` holds that no release has yet. As you work they move together, as it happens and not at the end. What you find or leave open goes into `todo.jsonl`. What lands goes under `## [Unreleased]`, breaking changes first, and the item it settles becomes `fixed` with a dated `note` saying so. A change with no entry, or an item marked fixed with no entry behind it, means the record is wrong. `/release` closes the pair: `[Unreleased]` becomes a version, and the settled items leave `todo.jsonl`. Write both with the file tools, never inside a quoted shell argument.

`todo.jsonl` has one JSON object per line: `n`, `status` (open / fixed / not fixed), `severity`, `area`, `file`, `summary`, `detail`, plus a dated `note` once an item is worked on.

## What is here

```
stories.md             what the app was asked to make true
src/
  server.ts            Bun.serve(): the routes, the documents on one WebSocket, and startServer() for tests
  main.ts              the entry point: a pid file and signals, then startServer()
  index.html           the page; Bun bundles what it references, no build step in development
  app.tsx              the socket every document rides, and railroad's routes: each draws a resource's view
  styles.css           the design, with its rules at the top
  resources/           a folder per resource (<name>-api.ts, <name>.ts, <name>-view.tsx), toast.ts, icon.tsx
tests/
  site.test.ts         the status, the page's shell and the entry point; the Bun.WebView rules are at its top
  message.test.ts      the message document: refused changes, and in the browser, saving and following
  browser.ts           a Bun.WebView at the page, and the helpers page tests share
  icon-page.*          a small page with both kinds of <Icon>, for site.test.ts
.railway/railway.ts    the deploy; its rules are at its top
```

- `message` is a document: delta keeps it as `message.json` in the data folder (`DATA_PATH`, else `data/`, git-ignored). The page opens it and changes it with `send`, so every open page follows; a change that is not a replace of `/text` with a string is refused (400), and an empty one writes nothing.
- `status` is an HTTP route, since it isn't communication: whether `DATA_PATH` is set, never where the folder is.

## Rules

- **Use Bun.** Before adding a package, check what Bun has: its docs are in `node_modules/bun-types/docs/`. Server, WebSocket, SQLite, S3, files, hashing, `.env` and a test browser (`Bun.WebView`) are all built in.
- **The page is railroad, not React.** Read the `railroad` skill before writing JSX: `onclick` and `class`, never `.get()` in JSX children, `list()` for an array that changes length.
- **Documents are delta's.** Read the `delta-doc` skill before changing one. A document is never set in the page: `send` the change, and it comes back to every window holding it, this one included, which draws it.
- **Icons are lucide.** Import the icon by name and draw it with `<Icon>`: `<Icon icon={Save} />` beside a label, `<Icon icon={X} label="Close" />` on its own. Never another icon set or inline SVG.
- **Tests.** `bun test` fails below 100% coverage. Never lower the threshold; write the missing test. The client and `main.ts` aren't in the coverage table, so the browser and spawn tests are what cover them. `bun run typecheck` is Bun's own `bun check` (TypeScript 7) and checks everything.
- **The server.** `main.ts` keeps `.server.pid` so a server started in the background can be stopped with `bun run stop`. `startServer()` answers a `stop()` that stops serving, then closes what a resource opened (one that opens a database pushes its close onto `closing` in `server.ts`); `main.ts` calls it on SIGTERM and SIGINT, and closes before `bun --hot` runs it again. Tests read the `Listening on <url>` line: keep it, and keep it last.
- **Assets.** Images (and a favicon) go in `src/` beside the HTML, referenced by a path relative to it, never `/static/...`.
- **Deploying.** There is no build: `bun run start` runs from source with hot reload off. `/health`, and `.railway/railway.ts` with a volume for the data. A build is optional (the `evolve` skill's references). **Always run `railway config plan` and show the user the result. Never run `railway config apply` without the user's explicit go-ahead, and never pass `--yes` or `--confirm-destructive`.**
- **Claude Code on the web.** The sandbox's Bun is too old and it has no browser. `.claude/hooks/session-start.sh` is there to install both (a test proves only that it does nothing anywhere else; the install itself is untested); its header says how to run it by hand. On GitHub, CI gets Bun from setup-bun and sets up the runner's Chrome for Bun.WebView.
