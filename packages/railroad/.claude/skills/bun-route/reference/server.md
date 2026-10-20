# The server

**In a delta app** (`@blueshed/delta` in deps) the server is delta's: give your routes to
`serve({ ws, routes })` and run it with `run` (`@blueshed/delta/serve`; `/health`, the 404, HMR, the
pid file and the signals come with it). Never write the `Bun.serve` below in such an app: add the
route to the routes `serve` takes. The rest of this page is for a Bun app without delta.

```ts
// server.ts
import homepage from "./index.html";
import aboutPage from "./about/about.html";

const server = Bun.serve({
  port: process.env.PORT || 3000,
  routes: {
    "/": homepage,
    "/about": aboutPage,
    "/api/users": {
      GET: () => Response.json([]),
      POST: async (req) => Response.json(await req.json(), { status: 201 }),
    },
    "/api/users/:id": (req) => Response.json({ id: req.params.id }),
  },
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
});

console.log(`Listening on ${server.url}`);
```

An imported HTML file is a route: Bun scans its `<script>` and `<link>` tags, bundles them, rewrites the paths with content hashes and serves the assets. The route and handler types are Bun's (`Bun.serve` in `@types/bun`).

Working: [examples/jobs](https://github.com/blueshed/dzql/tree/main/packages/railroad/examples/jobs), a Bun app without delta: its `routes.ts` gives `Bun.serve`
the page, method handlers, `:id` routes and a socket, `development` gated on `NODE_ENV`. A delta
app: [create-blueshed/template](https://github.com/blueshed/dzql/tree/main/packages/create-blueshed/template) (paintbrush), whose `src/routes.ts` gives its routes to delta's `serve`, run by `run`.

- Always turn on `hmr` (`import.meta.hot`) and `console` (browser `console.*` mirrored to the terminal) in development, and gate them on `NODE_ENV` yourself: Bun serves the HMR client under `NODE_ENV=production` if `development.hmr` is set.
- Use `Bun.serve`. An existing `import { serve } from "bun"` also works; leave it.
- A handler that returns `Bun.file(...)` gets `Range` requests (`206 Partial Content`) for free, so `<video>` and `<audio>` seek (Bun 1.3.13+).

## Checking a route

A server of your own, on a free port, stopped by its pid, in one command:

```sh
PORT=0 bun server.ts > .server.log 2>&1 & pid=$!     # PORT=0: any free port, never one another run holds
for i in $(seq 50); do grep -q "Listening on" .server.log && break; sleep 0.1; done
url=$(sed -n 's/^Listening on //p' .server.log)       # http://localhost:<port>/
curl -s -o /dev/null -w "%{http_code}\n" "${url}about"   # must print 200
kill $pid; rm .server.log
```

- It needs the server above: `port` from `PORT`, and the `Listening on` line. Delta's `run` reads `PORT` and prints the line too.
- Background `bun` itself. In `cd app && bun server.ts &`, `$!` is a shell, and killing it leaves the server running.
- Stop only the server you started: `kill $pid`. Never `pkill -f` a pattern: it stops every server that matches, another session's too.
- In a delta app, start the entry `run` is in (paintbrush's `src/routes.ts`) with a pid file of its own, `PORT=0 PID_FILE=.check.pid bun src/routes.ts`, since `run` refuses to start over a dev server's `.server.pid`. `kill $pid` stops it, or `PID_FILE=.check.pid bun run stop` (`delta stop`).
- When the user runs the server, ask them to restart it and say its URL instead.

## Build and deploy

```sh
bun build ./index.html --production --outdir=dist   # hashed static assets, host anywhere
bun build --compile server.ts --outfile myapp       # server, client and runtime in one binary
./myapp
```

- `--compile` follows the HTML imports in `server.ts`; cross-compile with `--target=bun-linux-x64` and the like.
- `--target=bun` keeps `using`/`await using` native (Bun 1.3.14+), so the tests' `await using view` compiles.
