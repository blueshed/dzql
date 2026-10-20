# The server: delta's one server for the page and the socket

From the recipe's `routes.ts` (`recipe.md`), the app's routes and its resources:

```ts
import index from "./index.html";
import { createWs } from "@blueshed/delta/server";
import { run, serve } from "@blueshed/delta/serve";
import { roomApi } from "./resources/room/room-api";

const ws = createWs();
roomApi(ws);   // the room's document, on the socket

await run(() => serve({ ws, routes: { "/": index } }, { port: 3100 }));   // Bun bundles the HTML and its TS
```

A resource's `<name>-api.ts` registers its document on the `ws` it is given (`registerDocs`), or
answers an HTTP route; what it opens that must be closed (a database) goes in `serve`'s `close`.

`serve(app, { port, dev })` (`src/server/serve.ts`, `@blueshed/delta/serve`) is Bun.serve with the socket on its path (told the
server, so a change reaches every page), `/health`, a 404, and the app's `close` list run when it stops. `run(start)` is the
process: a pid file (`.server.pid`, `PID_FILE`) refusing a second start, `bun --hot`, SIGINT/SIGTERM; `delta stop` stops it.
An app writes no `Bun.serve` of its own. `WsOptions` and `WsServer` in `src/server/server.ts` are the socket's contract (`path`
defaults to `/ws`).

Working: [examples/lists](https://github.com/blueshed/dzql/blob/main/packages/delta/examples/lists/routes.ts), `serve` with the sign-in's
routes, the socket and the page, the database in its `close`, and `run` around it (`routes.ts`);
[examples/lobby](https://github.com/blueshed/dzql/blob/main/packages/delta/examples/lobby/resources/here/here-api.ts)'s `join`, a `registerMethod`
(`resources/here/here-api.ts`).

## Rules

- **`serve` tells the socket its server** (`ws.setServer`): by hand, without it nothing is broadcast.
- Route order does not matter: the upgrade is its own request.
- `registerMethod(ws, name, (params, client) => …)` adds a `call` method; a name starting with
  `_` is private and throws. Mark one that signs a socket in with `ws.changesIdentity(name)` (`auth.md`).
- Port `0` lets the OS pick one (tests).

## Origins

A WebSocket is not bound by the same-origin policy: any page a signed-in person visits could open
one as them, cookies and all. So `ws.upgrade` (and `upgradeWithAuth`, before `onUpgrade`) answers
**403** to a browser whose `Origin` is not the server's own (the `Host` it asked, whatever scheme a
proxy terminates). A request with no `Origin` (the CLI, a test, a server) is let in.

```ts
createWs();                                                                     // its own origin only
createWs({ origins: ["https://admin.example.com", "http://localhost:5173"] });  // and these
createWs({ origins: "*" });                                                     // every origin
```

- List a page served from another origin (a dev server on another port, an admin app) and the
  public origin when a proxy rewrites `Host`.
- An entry is `scheme://host[:port]`; one that is not a URL throws at `createWs`.
- `refuseOrigin(req, origins)` is the same check for your own upgrade handler: a `Response` to
  return, or `undefined` to go on.

## Gotchas

- The logger is railroad's, kept in step: `@blueshed/delta/logger` (`createLogger`,
  `setLogLevel`, `loggedRequest`), so a server needs no railroad.
- A socket's messages run side by side except around a sign-in; `maxHeld` / `maxHeldBytes`
  cap what waits (`auth.md`).
