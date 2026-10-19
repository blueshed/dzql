# create-dzql

```sh
bun create dzql my-app
cd my-app
bun install
bun dev            # http://localhost:3000
```

An app on [dzql](https://github.com/blueshed/dzql/tree/main/packages/dzql), begun from its starter:
a page the server draws, no stories yet and no documents yet. Its stories come first
(`src/stories.ts`), and the app is built from them, the least that makes each pass. delta keeps
the documents and serves the app on its one server (`@blueshed/delta/serve`): the app is routes and
resources, never a `Bun.serve` of its own. `bun test` checks that the page is served and drawn and
that every story passes.
