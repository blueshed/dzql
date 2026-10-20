# The app (`Example`), and the CLI

An app is one `Example`: its documents, its resources and its page, the `app` its `routes.ts`
exports and serves (`serve(compose(appOf(app), ...))`), in a project and in every example alike.
Signing people in is [signin.md](signin.md).

```ts
// examples/leave/routes.ts
export const app: Example = {
  name: "leave",
  resources: [session, team], // the session first
  render,
  active: (sessionId) => sessionOf(sessionId).person !== null, // a signed-out tab writes nothing, Undo included
  who: (sessionId) => sessionOf(sessionId).person?.id ?? sessionId, // the ledger's who is the person
  index,
  address: { doc: "session", path: "/page" }, // the write that moves a tab: its URL is where it stands
  identify, // a trusted proxy's header, or the CLI's token
  routes: { "/login": signIn },
  delta,
  session: sessions.of, // a session is a numbered row, named by its cookie
};
```

The fields are `Example` in `src/rendering/example.ts`.

Working: [examples/leave](https://github.com/blueshed/dzql/blob/main/packages/dzql/examples/leave/routes.ts), a whole `Example` (`routes.ts`: `active`, `who`,
`address`, `identify`, `/login`, a session by its cookie); [examples/chat](https://github.com/blueshed/dzql/blob/main/packages/dzql/examples/chat/cli.ts), the
CLI's verbs (`cli.ts`), run against a server by `cli.test.ts`.

- One resource per document type, the session's first; the kernel adds its ledger.
- `active` is there because only the app knows what "signed in" means (chat: "has a name"). A tab
  left open after signing out may not write, nor undo a write made before.
- `who` is who a session is to delta (the ledger's who, row-level security); default the session.
- `routes` are extra HTTP routes; a kernel route of the same path wins. `index` is served at `/` and
  at any path the kernel does not own: that path is a screen.
- `address` is the write that moves a tab ([bento.md](bento.md#where-you-are-the-address)): its
  op, once the session's resource has permitted and shaped it, moves the tab that sent it and is
  never written. A tab opened at `/2026-10?request=1` is put there through it before its first page
  is drawn, so a link, a bookmark or a reload opens on its screen, drawn by the server, and another
  tab of the session stays where it is. Without it, the URL is only `/`.
- `session` finds a cookie's session: `sessionRows(delta, "sessions").of` (`dzql/rendering/sessions`)
  keeps each as a numbered row holding the cookie's hash, made on a visit's first socket and found
  through a `visit:` document scoped by that hash. Without it, the cookie is the session.
- `routes.ts` runs it (`bun dev`, `bun start` in a project; `bun examples/<name>/routes.ts` for an
  example). Its HTTP routes are entries in its `compose` (`{ routes: { "/api/x": { GET } } }`), or
  the app's `routes` field, which takes a handler.

## CLI

The CLI talks to a running server over the same socket a browser does, with no database import.

```ts
// examples/chat/cli.ts: short verbs that build {doc, ops}
export const aliases: Aliases = {
  room: (args) => ({ doc: "session", ops: [{ op: "replace", path: "/room", value: args.join(" ") }] }),
  send: (args) => ({ doc: "room", ops: [{ op: "add", path: "/messages/-", value: args.join(" ") }] }),
};
```

- `src/rendering/cli.ts` knows `login <link>` (a link the server printed as it started) or `login <email>
  <password>` (by the app's own `/login` form), the session kept in
  `.eta-session` (or `--session <file>`); `inspect`, `watch`, `undo`, `redo` and
  `write <doc> <op> <path> [value]`. A refused write prints `refused: <why>` and exits 1.
- With `ETA_TOKEN` set it sends `Authorization: Bearer <token>`, and the app's `identify` says who it
  is: no `login` first ([signin.md](signin.md)).
- An app's `cli.ts` exports `aliases`, and never imports the database.
- `ETA_EXAMPLE` says which app, `ETA_URL` which server.
