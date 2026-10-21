# Signing in

Server and client: the four places auth is wired, and the sign-in `ConnectOptions.onConnect`
(`src/client/client.ts`) exists for (`tests/client.test.ts`, "onConnect").

```ts
// server: auth is a DeltaAuth (@blueshed/delta/auth)
wireAuth(ws, auth);                                  // auth.actions → "call" handlers
ws.upgrade = upgradeWithAuth(ws, auth);              // onUpgrade: cookie / Authorization
registerDocs(ws, db, schema, docs, customDocs, { auth });   // each doc says who has it: its owns path

// client: sign in on EVERY connect, before any document opens or re-opens
provide(WS, connectWs("/ws", {
  onConnect: async (ws) => {
    const token = localStorage.getItem("token");
    if (!token) return showLogin();
    try { showApp(await call<User>("authenticate", { token }, ws)); }   // showApp must be idempotent
    catch { localStorage.removeItem("token"); showLogin(); }           // stale or revoked
  },
}));
```

`DeltaAuth` in `src/server/auth.ts` is the contract: `onUpgrade?`, `actions?`, `gate`,
`asSqlArg?`. Delta reads no credentials itself and ships no sign-in scheme: write the `DeltaAuth`
your app needs (`login`, `authenticate`, `logout` as its `actions`). On Postgres, dzql's `jwtAuth`
is one, and `asSqlArg` names who row-level security sees (`postgres.md`). Who may open which
document: `ownership.md`.

Working: [examples/lists](https://github.com/blueshed/dzql/blob/main/packages/delta/examples/lists/README.md), the four places wired for
link sign-in, signed in by a link from the command or the page, with the picker in development:
`resources/people/people-api.ts` (`linkAuth`, `wireAuth`), `routes.ts` (the socket upgraded by
its cookie), `app.tsx` (`takeLink`, `onConnect`).

## Link sign-in: no passwords

`@blueshed/delta/auth-link` is a `DeltaAuth` delta ships: a link is someone, its tap a session
cookie the socket is signed in by (`src/server/auth-link.ts`; `tests/auth-link.test.ts`).

```ts
// server: people are the app's own collection
const auth = linkAuth({ store: sqliteLinkStore(db), personOf, people });   // personOf(id), people(): the app's
wireAuth(ws, auth);                                                         // me, link
serve({ ws, routes: { ...auth.routes, "/ws": upgradeWithAuth(ws, auth), "/": page } });   // delta's one server; its own "/ws" wins
registerDocs(ws, db, schema, [defineDoc("mine:", { root: "people", include: ["notes"], owns: "@id" })], [], { auth });

// page: take a link before the socket connects (the cookie rides on the upgrade)
await takeLink();                                   // opened at <site>/#/in/<token>: signed in
provide(WS, connectWs("/ws"));
const me = await call<Person | null>("me");          // null: nobody: show "Who are you?"
```

- **A link:** `call("link", { person, opens })` from anyone signed in (`mayLink` narrows it);
  the first person's from the server, `bunx @blueshed/delta link app.db 1 --origin https://my.app`.
- **In development** `everyone()` lists people and `becomeAs(id)` signs in as one: a picker
  instead of a password. Tests: `await auth.signInAs(id)` is a cookie header. None of these
  answers in production.
- **Sign out:** `signOut()` ends the session and reloads the page.
- **A script or test is signed in by its headers**: `connectWs(url, { headers: { cookie } })`
  sends them on every connect (Bun), then `openDoc` and `call` as a page does; a browser sends
  its own cookies and ignores them (`signedIn` in `tests/helpers/examples.ts`).

## Gotchas

- **Never put a token in the socket URL.** Upgrade-time (cookie or header via `onUpgrade`, no
  hook needed: every new socket arrives signed in) or in-band `call("authenticate", { token })`.
- **Use `onConnect`, not one `await call("authenticate")`**: a reconnect is a new,
  unauthenticated socket; without the hook its re-opens 401 and stop. What the hook sends goes
  out at once; documents wait for it.
- After `login`, store the token: the next reconnect signs in with it.
- **A socket's messages run side by side, except around an identity change** (`authenticate`,
  `login`, `register`, `logout`, or a method you mark with `ws.changesIdentity(method)`): it
  waits for what came before, and what comes after waits for it. So an `open` sent straight
  after `authenticate` is handled signed in.
- A socket may hold 1000 messages and 1 MiB waiting (`createWs({ maxHeld, maxHeldBytes })`); past
  either it closes with 1008 and none runs. Wait for the sign-in's answer before a large frame.
- **`logout` unsubscribes the socket from every document**; after it, open/delta are 401. On an
  identity switch re-open what the new user should see; nothing carries over.
- **A token that runs out** (`exp`): the gate refuses the socket and drops its subscriptions, at
  a request or before a change is told. The socket is told `{ doc, error: { code: 401 } }` and the
  client reconnects, so `onConnect` signs in again. A request's own 401 leaves the socket as is.
- `gate` is asked before every open, delta, open_at, history, undo, redo and close; a socket it
  refuses opens, hears and writes only a document `owns: "ANYONE"` (`ownership.md`).
