# The app (`Example`), signing people in, and the CLI

The app's one export (`index.ts`), how a person signs in, and the CLI that writes from the terminal.

## `Example` (`src/example.ts`)

An example is one app: its documents, its compartments and its page, exported from
`examples/<name>/index.ts`.

```ts
export type Example = {
  name: string;                       // tells it from another example object at runtime
  compartments: Compartment[];        // one per document type, the session's first; the kernel adds its ledger
  render(sessionId: string): string;  // the whole page
  active(sessionId: string): boolean; // may this session write at all right now?
  index: HTMLBundle;                  // served at "/" and at any path the kernel does not own
  delta: Local;                       // its documents: delta's backends on a createLocal()
  who?(sessionId: string): unknown;   // who a session is, to delta (the ledger's who, row-level security); default the session
  identify?(req): string | Response | undefined; // at /ws, before it opens: the session to use, a refusal, or a visit (may be async)
  routes?: Record<string, ...>;       // extra HTTP routes; a kernel route of the same path wins
};
```

- `active` is there because only the example knows what "signed in" means. Chat's is "has a
  name"; leave's is "is signed in". A tab left open after signing out may not write, nor undo a
  write made before.
- `src/start.ts` runs `examples/${ETA_EXAMPLE}/index.ts` (default `chat`). One process serves one
  example.

### Signing people in

A session is anonymous until the example says who it is. Leave does it with an email and password,
and the password never crosses the socket.

1. The sign-in page is a plain `<form method="post" action="/login">`, with no `data-write`, so
   the client lets it post.
2. A route on `Example.routes` answers it. It refuses a post from another site (delta's
   `refuseOrigin`) and checks the password with `Bun.password.verify`, against a hash in a table
   no document includes.
3. For a good password it starts a **fresh** session (never the visit's own id), writes who it is
   into the session with `serverWrite`, and answers `303 /` with `sessionCookie(id)`
   (`src/server.ts`: the kernel's cookie and its attributes).
4. A wrong one is told on the page it came from: `tell(visit, { doc, path, reason })`, drawn by
   `toldAt` ([compartment.md](compartment.md#saying-why-a-write-was-refused-or-what-one-did)). A route that does what a form asked (a password changed) says so the same way, as a
   success: `tell(visit, { doc, path, said: "Your password is changed." })`.

Then:

- Who you are is the session's. The session's `permit` refuses changing it over the wire, but
  allows removing it: signing out, which every tab of the session hears.
- `who` gives delta the person, and `active` says whether anyone is signed in.
- A new row's id is a serial number the server names, the same on every backend (delta's skill, Rules,
  "The id rule"). In a path and on the wire it is text (`/asks/3`): compare ids as text.
- `/ws` refuses a socket opened from another site. Allowed: no `Origin`, the page's own, or one
  listed in `ETA_ORIGINS` (comma-separated).
- In the stories, `signIn(name)` gives the route and form for a member of the cast. The harness
  posts it, and starts them from the page it signs them into.
- A story may post to a route itself: `does: post(path, form)` (src/stories.ts), the same shape.
  The harness posts it as the author's browser does (same site, their cookie), follows the 303 to
  the page it lands on as theirs (a new session where the answer's cookie names one), and checks
  `seen` and `untold` as for a write: what the route's `serverWrite`s change is told from delta's
  stream. No undo follows: the writes are the server's. The author's page must offer a plain
  `<form method="post" action="<path>">` with a field for each key, or the story says `offPage`
  (a link from outside the app); by hand the form is typed into and sent. `cannot: post(...)` is
  a route's refusal: a 4xx (its body the reason) or a `tell` with a reason on the page it came
  from, checked against `told`.
- Someone who keeps guessing is slowed: leave lets one email's password be tried five times, each
  within a minute of the last, then once a minute, the right one included, and says so.

**Who you are, before the socket opens.** Where the request itself says who it is -- a sign-in
proxy in front of the app, a token from the CLI -- `Example.identify(req)` says so at `/ws`, after
the Origin check and before the upgrade. It returns the session to open (the kernel sets its
cookie when it is not the one sent), a `Response` that refuses it (leave's: 403), or undefined: a visit, on
its cookie's session or a new one, which signs in by the page as above. Leave's
(`examples/leave/signin.ts`):

- `Authorization: Bearer <token>` is the person whose token it is, kept as its SHA-256 in a table
  no document includes. The CLI sends `ETA_TOKEN` so (*CLI*).
- `X-Forwarded-Email` is believed only with the proxy's secret (`X-Proxy-Secret`, set as
  `LEAVE_PROXY_SECRET`; none set, no proxy is trusted). The proxy must overwrite both headers on
  every request, so a browser cannot send its own.
- A person found keeps the cookie's session when it is already theirs, else gets a fresh one with
  who it is written in, as signing in does: never the visit's id. One not on the team is refused.

OAuth2 and LDAP plug in behind the same shapes, and are not built:

- **LDAP** is a password checked elsewhere: the `/login` route binds as the person (a client such
  as `ldapts`, a new dependency to ask about) where leave calls `Bun.password.verify`, and the rest
  is the same.
- **OAuth2 / OpenID Connect** is two routes: `GET /login` redirects to the provider with a `state`
  and a PKCE challenge kept in a short cookie; `GET /callback` checks the state, exchanges the code
  with `fetch`, verifies the id_token against the provider's keys (`crypto.subtle`, or `jose`, to
  ask about), finds the person by its email or subject, then starts a fresh session and redirects
  home, as `/login` does. `identify` is not needed: the cookie carries it from there.
- A proxy that does OAuth2 for the app (oauth2-proxy, Cloudflare Access) is the header case above.

## CLI

The CLI talks to a running server over the same socket a browser does, with no database import.

- `src/cli.ts` knows `login <email> <password>` (signs in by the app's own `/login` form, and keeps
  the session in `.eta-session`, or `--session <file>`), `inspect`, `watch`, `undo`, `redo` and
  `write <doc> <op> <path> [value]`. A refused write prints `refused: <why>` and exits 1.
- With `ETA_TOKEN` set, it sends `Authorization: Bearer <token>` too, and the app's `identify` says
  who it is (*Signing people in*): no `login` first. A token the app does not know refuses the socket.
- An app's `cli.ts` may export `aliases`: short verbs that build `{doc, ops}`, with no database.
- `ETA_EXAMPLE` says which app (`./app`, or an example's name), `ETA_URL` which server.
