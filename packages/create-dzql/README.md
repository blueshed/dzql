# create-dzql

```sh
bun create dzql my-app
cd my-app
bun install
bun run db:up      # a Postgres server in Docker
bun run link "Your name"
bun dev            # http://localhost:3000
```

A [paintbrush](https://github.com/blueshed/paintbrush) app on [dzql](https://github.com/blueshed/dzql):
people sign in by link, with no passwords, and share posts that are live documents, kept in
Postgres. A post written in one window arrives in every other; each person edits and deletes only
their own. `bun run link "Your name"` gives the first person their link; in development the page
lists everyone to pick from. Its tests (`bun test`) do all of that in two browsers, with Postgres
in memory.
