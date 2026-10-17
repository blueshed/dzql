# bluetools

blueshed's packages in one repository ([blueshed/dzql](https://github.com/blueshed/dzql)), as Bun
workspaces. A change that crosses them lands, and is tested, in one commit.

| Package | npm | What it is |
|---|---|---|
| [`packages/railroad`](packages/railroad) | `@blueshed/railroad` | Signals, JSX and routes for Bun's fullstack runtime; `/webview`, a page in a real browser for tests |
| [`packages/delta`](packages/delta) | `@blueshed/delta` | Documents: open one and you're subscribed. JSON file and SQLite, the wire, the client, and the one server (`/serve`) |
| [`packages/dzql`](packages/dzql) | `dzql` | Stories to documents to pages: `dzql/modelling`, `dzql/rendering` (eta), and the compiled Postgres step |
| [`packages/paintbrush`](packages/paintbrush) | (private) | The starting website: routes and resources, a railroad page, delta documents |
| [`packages/create-blueshed`](packages/create-blueshed) | `create-blueshed` | `bun create blueshed my-app`: a paintbrush app |
| [`packages/create-dzql`](packages/create-dzql) | `create-dzql` | `bun create dzql my-app`: eta's starter, on dzql |

Each package keeps its npm name, its version and its CHANGELOG. In the workspace each uses its
siblings' source, not npm's. `/publish` releases what has changed in one round, a tag per package
(`railroad@x.y.z`, `delta@x.y.z`, `dzql@x.y.z`).

```sh
bun install              # at the root: every package, one bun.lock
bun run affected         # the gate: each package a change touches, and those that depend on it
bun run test:delta       # one package's fast tier; test:<package>:slow for its browsers and Postgres
```

- What changed across the packages: [CHANGELOG.md](CHANGELOG.md); what is open: [todo.jsonl](todo.jsonl).
- The documents, by package: [docs/](docs/README.md).
- How to work here: [CLAUDE.md](CLAUDE.md).

MIT licensed (`LICENSE`).
