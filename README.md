# bluetools

blueshed's packages in one repository, as Bun workspaces. A change that crosses them lands, and is
tested, in one commit, and they are released together.

| Package | npm | What it is |
|---|---|---|
| [`packages/railroad`](packages/railroad) | `@blueshed/railroad` | Signals, JSX and routes for Bun's fullstack runtime |
| [`packages/delta`](packages/delta) | `@blueshed/delta` | JSON-Patch document sync: open a document and you're subscribed |
| [`packages/dzql`](packages/dzql) | `dzql` | delta's compiled Postgres step |
| [`packages/create-dzql`](packages/create-dzql) | `create-dzql` | `bun create dzql`: a paintbrush app on dzql |

Each package keeps its npm name, its version and its CHANGELOG. In the workspace each uses its
siblings' source, not npm's. CI runs a package's tests when it or a sibling it depends on changes,
and `/publish` releases what has changed in one round, a tag per package (`railroad@x.y.z`,
`delta@x.y.z`, `dzql@x.y.z`).

```sh
bun install          # at the root: every package, one bun.lock
cd packages/delta && bun run ci
```

MIT licensed (`LICENSE`).
