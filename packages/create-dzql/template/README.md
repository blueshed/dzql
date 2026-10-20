# Starter

An app made by `bun create dzql`: [dzql](https://github.com/blueshed/dzql/tree/main/packages/dzql)
draws every page on the server and tells each one what changed, and
[delta](https://github.com/blueshed/dzql/tree/main/packages/delta) keeps the documents and serves
it, in Postgres: PGlite in the process, in the data folder (`DATA_PATH`, else `data/`), until
`DATABASE_URL` names a server. It begins as nothing but its page, waiting for its first story.

```sh
bun dev          # http://localhost:3000, and the model's page at /model, where the stories are told first
bun test         # the page is served and drawn, and every story passes
bun run stories  # each story in stories.ts, told against the app
bun run model    # the model's page alone, http://localhost:3001/model
bun run stop     # a server started in the background
```

## How it grows

- **Stories first.** `stories.ts` says who does what and who then sees it, each a sentence a
  customer could call true or false. Tell one, watch it fail, build the least that makes it pass.
- **Routes and resources.** `src/routes.ts` is the server: the app's page and socket, any HTTP
  route, and in development the model's page, on delta's one server (`@blueshed/delta/serve`: the
  page, the socket, `/health`), never a `Bun.serve` of its own. Each document is a resource in
  `src/resources/<name>/`: its document (`<name>-api.ts`), its rules (`<name>.ts`) and its part of
  the page (`<name>-view.ts`). The first story says which document a person needs in front of them
  to act.
- **The page** is `src/page.ts`, drawn by the server from each resource's view.
