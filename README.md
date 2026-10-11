<p align="center"><img src="./logo.png" alt="Logo" width="120"></p>

# Paintbrush

A hello world for [Bun](https://bun.sh) as a server of **routes and resources**. Bun is the runtime, the bundler, the test runner and the server, and it has a WebSocket, SQLite and S3 built in, so a website needs very little else. Paintbrush shows how little, then gives you a way on: [railroad](https://github.com/blueshed/railroad) for the page, [Railway](https://railway.com) for the deploy, and a resource that can grow into a [delta](https://github.com/blueshed/delta) document and beyond.

Requires Bun 1.4.3 or later.

```sh
bun create blueshed/paintbrush myapp   # or, from npm: bunx create-blueshed myapp
cd myapp
bun dev
```

Open `http://localhost:3000` in two windows. You get a message you can edit, and a save in one window shows in the other. There's a line saying whether your data survives a deploy, and tests for all of it.

## Bun does the work

- **Routes** are `Bun.serve()` routes, all written out in `src/server.ts`: the page, `GET` and `PUT /api/message`, `GET /api/status`, `/ws` and `/health`.
- **The page** is an imported `index.html`. Bun bundles the TypeScript, JSX and CSS it references, so there is no build step in development.
- **A WebSocket** is a route and a handler. Each save goes out with Bun's built-in pub/sub (`server.publish`), so every open page follows.
- **Files** are `Bun.file` and `Bun.write`: the message is a JSON file in the data folder.
- **Tests** are `bun test`. Routes are tested with `fetch`, and the page in a real browser with `Bun.WebView`. The run fails below 100% coverage.

When a resource needs more than a JSON file, Bun has that too. The `evolve` skill's `references.md` shows how, with the tests:

- **SQLite** with `bun:sqlite`: a database in one file on the data volume.
- **S3** with `Bun.s3`: files in a bucket (AWS, R2, a Railway bucket, MinIO). A `GET` answers a redirect to a presigned URL, so the bytes never pass through your server.

## Routes and resources

- **Server routes** are in `src/server.ts`. A route serves a resource.
- **Client routes** are railroad's hash router, in `src/app.tsx`. A route draws a resource's view.
- **A resource** is a folder with three files:

| File | Role |
|------|------|
| `<name>-api.ts` | Server handlers: plain functions that return a `Response`, and the type both sides share |
| `<name>.ts` | The client store: signals, fetch wrappers, and the socket it listens on |
| `<name>-view.tsx` | The view: a function component, reactive through signals |

Every route and handler is visible in the code. An AI, or a person, can read `server.ts` and `app.tsx` and know exactly what the app does.

## A resource evolves

It starts as HTTP routes, and a WebSocket tells every page what changed. When several people edit the same thing at once, it becomes a document in delta. delta keeps it in a JSON file, then SQLite, then Postgres, and the browser code does not change. Beyond that is eta, and shinko, a realtime shared tree with formulas, is on its way to being a resource too. The client route and the view keep their names; what is under them changes. The `evolve` skill has each step, with its tests.

## What's in the box

```
src/server.ts        Bun.serve(): the routes and the WebSocket
src/main.ts          the entry point: a pid file, so a server started in the background can be stopped
src/app.tsx          railroad's routes
src/index.html       the page; Bun bundles the TypeScript and CSS it references
src/styles.css       the design, with its rules at the top
src/resources/       message/ and status/, three files each, a toast, and an Icon for lucide icons
tests/               routes with fetch, the page in a real browser (Bun.WebView), the entry point
.railway/            the deploy, as code, with a volume for the data
```

`bun dev` serves with hot reload, and `bun run start` serves the same source in production, with nothing to build. `bun test` runs everything. `.railway/railway.ts` deploys it: `railway config plan` shows what would change, and nothing is applied until you say so.

## Made to be worked on with Claude

`CLAUDE.md` says what is here and the rules. The `evolve` skill (`.claude/skills/evolve/`) is how to add or change a resource, and its `references.md` has each step with code and tests. `CHANGELOG.md` and `todo.jsonl` are a pair, the project's memory between sessions: the changelog is where it has been, the ledger what is open now. They move together: when work lands it gets a changelog entry, and the item it settles is marked fixed. `/release` (`.claude/commands/release.md`) checks, tests, turns `[Unreleased]` into a version, takes the settled items out of the ledger, bumps, commits, tags and pushes. The Claude Code web sandbox has an older Bun and no browser, so a SessionStart hook installs both there; CI does the same on GitHub.

## Starting from it

`bun create` runs `create/setup.ts` after installing. Your app gets its own name, a fresh ledger and changelog, railroad's skill, and a first commit. The template's logo, the script and its test are not copied across. The app's changelog starts by naming the paintbrush version it came from: to bring an app up to date, read this changelog from that version on, and carry across what applies.

MIT
