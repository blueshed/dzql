# Paintbrush

<!-- template -->
> **This is the paintbrush template.** `bun create blueshed my-app` (create-blueshed, `packages/create-blueshed` in this repository) copies it, runs `bun install`, then runs `create/setup.ts`. Setup names the app in `package.json` (its own version, and only the app's scripts), gives it a fresh `todo.jsonl` and `CHANGELOG.md`, puts its name in place of "Paintbrush" in the files listed in `NAMED`, and deletes what is about the template that it needed (`DELETED`): `create/`, `tests/setup.test.ts`, `tests/evolve.ts` (the evolve skill's test, with its `test:evolve` script and its CI step). What it never needed, `logo.png` and `evals/` (the evolve skill's evaluations), is never copied (`UNCOPIED`, which create-blueshed reads as it copies and packs). It then runs `delta install-skills --skip bun-route,dzql-app`: the skills the app's packages ship, railroad's `railroad`, delta's `delta-doc` and dzql's `modelling` (named by `claudeSkills` in `package.json`; railroad's `bun-route` and dzql's `dzql-app` are left out: the app grows through `evolve`). A new app's `.claude/skills` holds `evolve`, `modelling`, `railroad` and `delta-doc`, and its README is written by `readme()` in `create/setup.ts`, whose code blocks a test holds to the app's own files. A test fails if the word "paintbrush" appears in a file `NAMED` does not list. This repo's own `todo.jsonl` and `CHANGELOG.md` are about the template.
>
> `setup()` ends by making the app's first commit (create-blueshed runs `git init` first; `--no-git` makes none), so a new app is one commit with a clean tree. After changing `create/`, test the whole flow: `bun ../create-blueshed/cli.ts <a scratch folder>/my-app`, then `bun test` in the new folder.
>
> After changing the `evolve` skill's references, run `bun run test:evolve`: it applies each file in `references/` to a new app and runs that app's tests (CI does too). A new reference file goes in its `SECTIONS`, or the test fails.
>
> `setup()` refuses to run in a clone of this repo (its `origin` is the template's), because it deletes things.
<!-- /template -->

A Bun website where people share documents. **Documents are how people communicate**: a document is what you need in front of you to take an action. Open one and you're subscribed: every change anyone makes reaches you as it happens, with nothing to poll, fetch or refresh. Change it with add, replace or remove on a path, and everyone holding it sees it at once. delta keeps the documents, railroad draws the page as a bento (a box of cells, a drawer to change a thing, a modal for new or delete), Bun serves it and Railway deploys it. Every route and document is written out, so `src/routes.ts` and `src/app.tsx` say what the app does. The approach is settled: build on it.

**How it grows.** Anything people share is a document from the start: think in documents, not entities, and ask "what does someone need in front of them to do this?" rather than "what are the tables?" The tables follow from the documents. What grows is where they're kept. Every document is a schema (`defineSchema`, the rows) and a `defineDoc` (what someone has in front of them) from the start, kept in a JSON file: documents over the same rows, undo and history all work there. SQLite earns its place when the file is too much to rewrite after every change, or the schema must change on data in use (a migration); Postgres when servers share the data, or people should see only their own. Moving changes the import, never the definitions: the page and its documents stay the same as the storage grows. HTTP routes serve what isn't communication: the health check, files, the server's status. The app is what is listed below; add what the user asks for, with its tests, and coverage stays at 100%. The `evolve` skill has each step, with code and tests.

**Where an app starts.** The message is there to show the pattern; an app starts with its own stories, told on the model's page (`bun run model`, http://localhost:3001/model, the model kept in `model.json`; `bun run model <verb>`), with the `modelling` skill: each story as it is told, the documents it needs and what they hold. When the teller calls every story true, write them into `stories.ts` and build them with `evolve`, the least that makes the next one pass. (The modelling skill's last step names `dzql-app`, the page the server draws; here the page is railroad's, and the next step is `evolve`.)

**What it is for.** `stories.ts` holds the stories the app was asked to make true (`story("...")`, from `dzql/modelling`), each a sentence someone using it could call true or false. When the user asks for something, write it there as stories first (theirs, in their words), then make them true, with tests named from them (`test(\`${stories.saves.name} -- ...\`)`): `tests/stories.test.ts` fails a story no test tells. Earlier stories stay true; a story that changes is changed there, never dropped quietly.

**Where the project is.** `CHANGELOG.md` and `todo.jsonl` are the project's memory between sessions, and they work as a pair: the changelog is where the project has been, the ledger is what is open now. Read both before starting: the open items, and what `## [Unreleased]` holds that no release has yet. As you work they move together, as it happens and not at the end. What you find or leave open goes into `todo.jsonl`. What lands goes under `## [Unreleased]`, breaking changes first, and the item it settles becomes `fixed` with a dated `note` saying so. A change with no entry, or an item marked fixed with no entry behind it, means the record is wrong. `/release` closes the pair: `[Unreleased]` becomes a version, and the settled items leave `todo.jsonl`. Write both with the file tools, never inside a quoted shell argument.

`todo.jsonl` has one JSON object per line: `n`, `status` (open / fixed / not fixed), `severity`, `area`, `file`, `summary`, `detail`, plus a dated `note` once an item is worked on.

## Routes, resources and documents

An app is routes and resources, on both sides of the socket. A document joins a server resource to its client resource: what someone needs in front of them to act. Entities, the collections of delta's `defineSchema`, are behind the documents, on the server; the tables follow from the documents.

| | Server | Client |
|---|---|---|
| Routes | Bun routes, given to delta's `serve` in `src/routes.ts` | where you are, the URL: the page and what is open over it, in `src/app.tsx` |
| Resources | `<name>-api.ts`: the document it registers, or HTTP | `<name>.ts`, the handle, and `<name>-view.tsx`: its cell, and its drawer |
| Joined by | the document, on the socket | |
| Behind it | entities (`defineSchema`) | |

Documents are delta's kinds: stored (a JSON file, SQLite or Postgres), memory, source or static.

## What is here

```
stories.ts             what the app was asked to make true, each story told by a test named from it
src/
  routes.ts            the app: its routes and the documents on one WebSocket (startServer, for tests); run, it is the server
  index.html           the page; Bun bundles what it references, no build step in development
  app.tsx              the socket every document rides, and the page: a bento box of each resource's cell, its drawers over it
  styles.css           the design, with its rules at the top: the bento's plain look (dzql's bento-plain.css), then the page
  resources/           a folder per resource (<name>-api.ts, <name>.ts, <name>-view.tsx), bento.tsx, toast.ts
tests/
  site.test.ts         the status, the page's shell and the entry point
  message.test.ts      the message document: refused changes, and in the browser, saving and following
  browser.ts           railroad's browser() (@blueshed/railroad/webview, whose header has the Bun.WebView rules) and refuseWrites
  bento.test.ts        the bento drawn by railroad is the HTML dzql's bento.ts draws (bento-page.*), and what it does when pressed
.railway/railway.ts    the deploy; its rules are at its top
```

- `message` is a document: `message:1`, one row of `messages`, kept by delta in `message.json` in the data folder (`DATA_PATH`, else `data/`, git-ignored). It opens as Hello before anyone has saved, and the first save makes the row. The page shows it as a cell on the box; its ✎ opens its drawer (`#/?message`), where it is changed with `send`, so every open page follows; a write the schema does not take (a field it does not declare, a value that is not text) is refused (400), and an empty one writes nothing.
- `status` is an HTTP route, since it isn't communication: whether `DATA_PATH` is set, never where the folder is.

## Rules

- **Use Bun.** Before adding a package, check what Bun has: its docs are in `node_modules/bun-types/docs/`. Server, WebSocket, SQLite, S3, files, hashing, `.env` and a test browser (`Bun.WebView`) are all built in.
- **The page is railroad, not React.** Read the `railroad` skill before writing JSX: `onclick` and `class`, never `.get()` in JSX children, `list()` for an array that changes length.
- **The page is the bento's.** Draw it with `src/resources/bento.tsx` (its header says how): a page is a box of cells (`boxPage`, `cell`), a thing is changed in a drawer and made or removed in a modal (`layers`), a list is `rows` of `row`s. Where you are is the URL (`here`, `go`), so Back closes a drawer and a link opens one. It draws the same HTML as dzql's `bento.ts`, the page a server draws, and `tests/bento.test.ts` holds it so: change one, change the other. Its look is `bento-plain.css`'s tokens; say the app's own after the import in `styles.css`, never a rule over the bento's.
- **Documents are delta's.** Read the `delta-doc` skill before changing one. A document is never set in the page: `send` the change, and it comes back to every window holding it, this one included, which draws it.
- **Icons are lucide, drawn by the bento.** Give a control its mark by name (`icon:`, as the bento's own marks are), or draw one alone with the bento's `mark(icon, size)`; a mark beside its label is hidden from a screen reader. Never another icon set or inline SVG.
- **Tests.** `bun test` fails below 100% coverage. Never lower the threshold; write the missing test. The client isn't in the coverage table, so the browser tests are what cover it. `bun run typecheck` is Bun's own `bun check` (TypeScript 7) and checks everything.
- **The server is delta's** (`@blueshed/delta/serve`). `src/routes.ts` gives it the routes and the documents; `serve` puts them on Bun.serve with `/health` and a 404, and its `stop()` stops serving, then closes what a resource opened (one that opens a database pushes its close onto `closing`). Run as the entry, `run` keeps `.server.pid` (`bun run stop` is `delta stop`), stops on SIGTERM and SIGINT, and closes before `bun --hot` runs it again. Tests read the `Listening on <url>` line.
- **Assets.** Images (and a favicon) go in `src/` beside the HTML, referenced by a path relative to it, never `/static/...`.
- **Deploying.** There is no build: `bun run start` runs from source with hot reload off. `/health`, and `.railway/railway.ts` with a volume for the data. A build is optional (the `evolve` skill's references). **Always run `railway config plan` and show the user the result. Never run `railway config apply` without the user's explicit go-ahead, and never pass `--yes` or `--confirm-destructive`.**
- **Claude Code on the web.** The sandbox's Bun is too old and it has no browser. `.claude/hooks/session-start.sh` is there to install both (a test proves only that it does nothing anywhere else; the install itself is untested); its header says how to run it by hand. On GitHub, CI gets Bun from setup-bun and sets up the runner's Chrome for Bun.WebView.
