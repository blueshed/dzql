# create-dzql

```sh
bun create dzql my-app
cd my-app
bun install
bun run db:up      # a Postgres server in Docker
bun dev            # http://localhost:3000
```

A [paintbrush](https://github.com/blueshed/paintbrush) app on [dzql](https://github.com/blueshed/dzql):
people register and sign in, and share posts that are live documents, kept in Postgres. A post
written in one window arrives in every other; each person edits and deletes only their own. Its
tests (`bun test`) do all of that in two browsers, with Postgres in memory.

Until 0.11.0 this made the whole-stack dzql's Vue app; that stack is retiring.
