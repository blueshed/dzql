# {{name}}

An app made by `bun create dzql`: [dzql](https://github.com/blueshed/dzql/tree/main/packages/dzql)
draws every page on the server and tells each one what changed, and
[delta](https://github.com/blueshed/dzql/tree/main/packages/delta) keeps the documents and serves
it. It begins as nothing but its page, waiting for its first story.

```sh
bun dev          # http://localhost:3000, and the model's page at /model, where the stories are told first
bun test         # the page is served and drawn, and every story passes
bun run stories  # each story in src/stories.ts, told against the app
bun run model    # the model's page alone, http://localhost:3001/model
bun run stop     # a server started in the background
```

## How it grows

- **Stories first.** `src/stories.ts` says who does what and who then sees it, each a sentence a
  customer could call true or false. Tell one, watch it fail, build the least that makes it pass.
- **Documents** are delta's, in `src/delta.ts`: the first story says which document a person needs
  in front of them to act. Kept in SQLite (`bun:sqlite`, a file in `data/`) once they share rows.
- **The page** is `src/page.ts`, drawn by the server; `src/index.ts` is the app: its resources,
  its page, who may write.
- **The server** is delta's one server (`@blueshed/delta/serve`), run by dzql's `start.ts`: the
  page, the socket, `/health`. The app gives it routes and resources, never a `Bun.serve` of its own.
