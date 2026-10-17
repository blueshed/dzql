# The app (`Example`), and the CLI

An app is one export from its `index.ts`: its documents, its compartments and its page. Signing
people in is [signin.md](signin.md).

```ts
// examples/leave/index.ts
export const example: Example = {
  name: "leave",
  compartments: [session, team], // the session first
  render,
  active: (sessionId) => sessionOf(sessionId).person !== null, // a signed-out tab writes nothing, Undo included
  who: (sessionId) => sessionOf(sessionId).person?.id ?? sessionId, // the ledger's who is the person
  index,
  identify, // a trusted proxy's header, or the CLI's token
  routes: { "/login": signIn },
  delta,
};
```

The fields are `Example` in `src/rendering/example.ts`.

- One compartment per document type, the session's first; the kernel adds its ledger.
- `active` is there because only the app knows what "signed in" means (chat: "has a name"). A tab
  left open after signing out may not write, nor undo a write made before.
- `who` is who a session is to delta (the ledger's who, row-level security); default the session.
- `routes` are extra HTTP routes; a kernel route of the same path wins. `index` is served at `/` and
  at any path the kernel does not own.
- `src/rendering/start.ts` runs the app `ETA_EXAMPLE` names (`./src`, or an example's name). One process
  serves one app.

## CLI

The CLI talks to a running server over the same socket a browser does, with no database import.

```ts
// examples/chat/cli.ts: short verbs that build {doc, ops}
export const aliases: Aliases = {
  room: (args) => ({ doc: "session", ops: [{ op: "replace", path: "/room", value: args.join(" ") }] }),
  send: (args) => ({ doc: "room", ops: [{ op: "add", path: "/messages/-", value: args.join(" ") }] }),
};
```

- `src/rendering/cli.ts` knows `login <email> <password>` (by the app's own `/login` form; the session kept in
  `.eta-session`, or `--session <file>`), `inspect`, `watch`, `undo`, `redo` and
  `write <doc> <op> <path> [value]`. A refused write prints `refused: <why>` and exits 1.
- With `ETA_TOKEN` set it sends `Authorization: Bearer <token>`, and the app's `identify` says who it
  is: no `login` first ([signin.md](signin.md)).
- An app's `cli.ts` exports `aliases`, and never imports the database.
- `ETA_EXAMPLE` says which app, `ETA_URL` which server.
