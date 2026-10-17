# {{name}}

A Bun website where people share posts, made by `bun create dzql`. Nobody types a password: a link
is someone, and tapping it signs them in. Every post is a live document, so a post written in one
window arrives in every other as it is written, and changes and deletions follow it. Each person
changes only their own.

[delta](https://github.com/blueshed/dzql/tree/main/packages/delta) keeps the documents and signs people in by link,
[dzql](https://github.com/blueshed/dzql) keeps them in Postgres, compiled from their definitions, and
[railroad](https://github.com/blueshed/dzql/tree/main/packages/railroad) draws the page. It is a
[paintbrush](https://github.com/blueshed/paintbrush) app at its Postgres step.

```sh
bun install
bun run db:up            # a Postgres server in Docker (compose.yml)
bun run link "Your name" # you, and the link that signs you in
bun dev                  # http://localhost:3000: open the link, or pick your name
bun test                 # pick who you are, post, see it arrive, edit, delete, links: two browsers
```

## Signing in

- **A link is someone:** `<site>/#/in/<token>`, used once, for 7 days. Its tap makes a session
  that lasts a year, and the socket is signed in by it. Sign out ends it.
- **The first person** comes from `bun run link <name>`, on your machine or on the server
  (`railway ssh -- bun run link Sam`): someone new if the name is.
- **Anyone signed in** adds someone new under People, and makes anyone's link to send them.
- **In development** the page asks "Who are you?" and lists everyone: one click to be anyone, two
  windows to be two people. Production lists nobody: it asks you for your link.

## How it is made

- **Routes** are `Bun.serve()` routes in `src/server.ts`: the page, link sign-in's (`/api/in`,
  `/api/out`, and in development `/api/dev/*`), `/ws` and `/health`.
- **Documents** ride the one WebSocket:
  - `people:` is everyone, for everyone signed in;
  - `posts:` is every post, read-only;
  - `mine:<id>` is one person's own posts, and every post is written, changed and deleted through
    it. A post added through it is theirs: its author comes from the document's name, never the value.
- **The tables and documents** are made in `src/db.ts`: one schema and one `generateSql` for the app.
- **A resource** is a folder of three files: `<name>-api.ts` (the server side and the shared
  types), `<name>.ts` (what the page opens) and `<name>-view.tsx` (the view).

Set `DATABASE_URL` (the Postgres server) and, in production, `ORIGIN` (the site's address, which
links name; Railway sets `RAILWAY_PUBLIC_DOMAIN`). `bun run start` serves from source in production,
with nothing to build.
