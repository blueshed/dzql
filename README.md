<p align="center"><img src="./logo.png" alt="Logo" width="120"></p>

# Paintbrush

A Bun website where people share documents. **Documents are how people communicate**: a document is what you need in front of you to take an action. It is a conversation, not a poster on the wall. Open one and you're subscribed, so every change anyone makes reaches you as it happens. Change it, and everyone holding it sees it at once.

[Bun](https://bun.sh) is the runtime, the bundler, the test runner and the server. [delta](https://github.com/blueshed/delta) keeps the documents, [railroad](https://github.com/blueshed/railroad) draws the page, and [Railway](https://railway.com) deploys it. What grows is where the documents are kept. A shared JSON document does a lot on its own; SQLite earns its place when documents share the same rows, or when you want undo and history; Postgres comes in when servers share the data, or people should see only their own. The page and its documents stay the same as the storage grows.

Requires Bun 1.4.3 or later.

```sh
bun create blueshed/paintbrush myapp
cd myapp
bun dev
```

Open `http://localhost:3000` in two windows. You get a message, a shared document: a save in one window shows in the other. There's a line saying whether your data survives a deploy, and tests for all of it.

## Bun does the work

- **Routes** are `Bun.serve()` routes, all written out in `src/server.ts`: the page, `GET /api/status`, `/ws` and `/health`.
- **The page** is an imported `index.html`. Bun bundles the TypeScript, JSX and CSS it references, so there is no build step in development.
- **Documents** ride one WebSocket, a route like any other. delta keeps each one (the message is a JSON file in the data folder) and tells every page holding it of every change.
- **Tests** are `bun test`. Routes are tested with `fetch`, a document with a client in the test, and the page in a real browser with `Bun.WebView`. The run fails below 100% coverage.

## Routes, resources and documents

- **Server routes** are in `src/server.ts`. HTTP routes serve what isn't communication: the health check, files, the server's status. Everything people share is a document on `/ws`.
- **Client routes** are railroad's hash router, in `src/app.tsx`. A route draws a resource's view.
- **A resource** is a folder with three files:

| File | Role |
|------|------|
| `<name>-api.ts` | The server side: the document it registers, or the handlers that return a `Response`; and the type both sides share |
| `<name>.ts` | The client: the document it opens, or what it fetches |
| `<name>-view.tsx` | The view: a function component, reactive through signals |

Every route and document is visible in the code. An AI, or a person, can read `server.ts` and `app.tsx` and know exactly what the app does.

## How it grows

Think in documents, not entities: ask what someone needs in front of them to do something, and the tables follow. To place an order you need the catalogue and your order, two documents on one page; the kitchen needs every open order, another document over the same rows. The `evolve` skill shows each, and where to keep them as the app grows (a JSON file, SQLite, then Postgres on dzql), with code and tests: migrations, sign-in by link, routes and a build among them.

## What's in the box

```
stories.md           what the app was asked to make true, a sentence each
src/server.ts        Bun.serve(): the routes, and the documents on one WebSocket
src/main.ts          the entry point: a pid file, so a server started in the background can be stopped
src/app.tsx          the socket every document rides, and railroad's routes
src/index.html       the page; Bun bundles the TypeScript and CSS it references
src/styles.css       the design, with its rules at the top
src/resources/       message/ and status/, three files each, a toast, and an Icon for lucide icons
tests/               routes with fetch, documents with a client, the page in a real browser (Bun.WebView), the entry point
.railway/            the deploy, as code, with a volume for the data
```

`bun dev` serves with hot reload, and `bun run start` serves the same source in production, with nothing to build. `bun test` runs everything. `.railway/railway.ts` deploys it: `railway config plan` shows what would change, and nothing is applied until you say so.

## Made to be worked on with Claude

Ask for something, and Claude writes it into `stories.md` as stories, then makes them true with tests named for them. `CLAUDE.md` says what is here and the rules; the `evolve` skill is how the app grows; `CHANGELOG.md` and `todo.jsonl` are the project's memory between sessions, and `/release` turns one into a version. On GitHub, CI runs the tests in the runner's Chrome on every push.

## Starting from it

`bun create` runs `create/setup.ts` after installing. Your app gets its own name, a fresh ledger and changelog, railroad's and delta's skills, and a first commit. What is about the template stays behind: its logo, ledger and changelog, the setup script, its own tests and the skill's evaluations. The app's changelog starts by naming the paintbrush version it came from: to bring an app up to date, read this changelog from that version on, and carry across what applies.

MIT
