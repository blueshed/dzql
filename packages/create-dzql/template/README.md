# {{name}}

A Bun website where people share posts, made by `bun create dzql`. People register and sign in;
every post is a live document, so a post written in one window arrives in every other as it is
written, and changes and deletions follow it. Each person changes only their own.

[delta](https://github.com/blueshed/delta) keeps the documents, [dzql](https://github.com/blueshed/dzql)
keeps them in Postgres, compiled from their definitions, and [railroad](https://github.com/blueshed/railroad)
draws the page. It is a [paintbrush](https://github.com/blueshed/paintbrush) app at its Postgres step.

```sh
bun install
bun run db:up      # a Postgres server in Docker (compose.yml)
bun dev            # http://localhost:3000
bun test           # register, post, see it arrive, edit, delete: in two browsers, Postgres in memory
```

## How it is made

- **Routes** are `Bun.serve()` routes in `src/server.ts`: the page, `/ws` and `/health`.
- **Documents** ride the one WebSocket. `posts:` is every post, read by everyone signed in;
  `mine:<id>` is one person's own, and every post is written, changed and deleted through it. A
  post added through it is theirs: its author comes from the document's name, never the value.
- **Sign-in** is dzql's `auth-jwt`: register with a name, email and password, or sign in; the page
  keeps the token and signs in again on every connect.
- **A resource** is a folder of three files: `<name>-api.ts` (the server side and the shared
  types), `<name>.ts` (what the page opens) and `<name>-view.tsx` (the view).

Set `DATABASE_URL` (the Postgres server) and, in production, `JWT_SECRET` (a long random string):
`.env` has both. `bun run start` serves from source in production, with nothing to build.
