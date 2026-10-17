# What zeta had that eta on delta has lost

> **A record.** Kept as it was written, for the history and the citations. How an app is made
> now is the root [README](../../README.md#how-an-app-is-made); where this differs from the code, the code is
> right.

*24 September 2026, after railroad 0.12.0, delta 0.6.0 and eta 0.47.0.*

zeta (`blueshed/zeta`) is a fork of epsilon 0.10.4 with a screen layer on top. epsilon is the
runtime after delta: documents composed in Postgres, one op stream, undo in the schema. eta
took a different road -- HTML from the server, documents kept by delta, applets drawn with
railroad if at all. This note is what that road left behind. Each item says what zeta or
epsilon did, what eta and delta do now, and where the evidence is.

Sources: `blueshed/zeta/DECISIONS.md` (DEC-n), `blueshed/zeta/README.md` (epsilon's
"knowns"), `blueshed/zeta/db/003-doc-kit.sql`, `docs/history/documents-history.md`.

## Lost, and worth bringing back

### 1. Undo that will not clobber

**zeta/epsilon.** `doc_undo` refuses when a later op touched the same paths:
`RAISE EXCEPTION 'changed since: % v% — later ops touched these paths; look before you undo'`
(`db/003-doc-kit.sql:155`). The README: undo "reverts *your* last one — refused, never
clobbered, when someone wrote after you."

**delta 0.6.0.** Undo applies the entry's inverse whatever came after. Reproduced against the
published package:

```
Ada sets the topic to "tea"; Ben sets it to "coffee"; Ada undoes.
-> applied; the topic is now null. Ben's write is gone.
```

**Where it bites in eta.** Anywhere two sessions write the same fields: the couple's two tabs on
the wedding board, two tabs of one household, a room's shared state.

**Where the fix goes.** delta's ledger (`src/server/ledger.ts`, and `delta_undo` in
`src/sql/001g-delta-ledger.sql`): before walking an entry back, look for a later entry on the
same document, from another cursor, whose ops touch the same paths; if there is one, refuse with
the reason. The same for redo. A patch release, with tests on SQLite and Postgres.

### 2. A refused write that says why

**zeta.** DEC-8: a write the dispatch refuses returns to the writing socket as a write-scoped
error; the client shows the reason on one line and keeps what was typed. DEC-18: the refusal
shows *on the node* that made the gesture.

**eta.** A refused write hands the page back as it was (`src/server.ts`, `redraw(ws, true)`),
with no reason. The wedding's "That code was not recognised" is a one-off written into the
session document to get round it.

**Where the fix goes.** eta's kernel: `permit` and `shape` able to say why, and the reason sent
to the writer beside the page, shown where the write came from.

### 3. A lookup through the server

**zeta.** DEC-2: third-party lookups route through the server. DEC-11: an applet reports one
thing, and its lookups go through the server method the tree names. The typeahead searches a
server-side function (`todo_lookup`, `user_lookup`, answered for the socket's own user).

**eta.** The wire has writes and `inspect`, nothing else. The ticker's city picker ships all of
the runtime's ~400 time zones as HTML options, because it has no way to ask. A search over a
large list, or anything outside, is not possible.

**Where the fix goes.** eta's wire: a read-only, permitted, named lookup an applet may call, its
answer to that socket alone.

### 4. The socket checks where it is opened from

**epsilon.** `EPSILON_ORIGINS`, an allowlist of origins for the WebSocket upgrade: "a WebSocket
is not bound by the same-origin policy, so without an allowlist any page your users visit can
open a socket to your deployment and speak the protocol as them" (README, Deploying).

**eta.** `/ws` does not look at `Origin` (`src/server.ts`). The `SameSite=Lax` session cookie
keeps most cross-site sockets from carrying the session, but an allowlist is the standard
defence.

**Where the fix goes.** eta's `/ws` route: an allowlist from the environment, refused before the
upgrade.

### 5. The law, proved per document

**epsilon.** `proveLaw` (`epsilon/law.ts`) drives a document type's ops over the real wire and
proves the client's copy equals recompute-from-tables after every echo, undo and mirrors
included, naming the defect when it does not.

**eta and delta.** eta's stories check each page against a fresh render and each applet's props
against the patch stream -- the page, not the document. delta has no law harness. Already noted
in `eta-on-delta.md` ("delta gains it").

## Lost, and wanted as soon as a real app needs it

### 6. Users, sign-in and sharing

**epsilon.** `users` and `sessions` in the schema, register and login on day one, passkeys
(WebAuthn, `epsilon/passkey.ts`), sharing a board by email into the member's own list in the
same transaction, presence.

**eta.** An anonymous `session_id` cookie; each example invents who you are (a name in chat, a
code in the wedding). delta has `DeltaAuth` and a JWT reference module; eta uses neither.
`Example.who` is the seam where a signed-in person would go.

### 7. Lists and counts across documents, across processes

**epsilon.** A read-only view (`pgView`, one SQL function and one line) recomposes when its
named dependencies commit, and LISTEN/NOTIFY carries it between processes.

**eta and delta.** The equivalents -- the wedding's `everyone`, chat's list of rooms and who is
here -- are computed in one process's memory by a compartment's `changed()`. delta's SQLite
backend shares a write with every open document that holds its rows; its Postgres backend does
not (found while releasing 0.6.0: only the document written through hears it). Fine on one
process; the gap to close before eta runs on Postgres.

## Smaller

- **Embedded Postgres and a way out of it.** epsilon runs the same schema in-process (PGlite),
  and `epsilon:export` moves the data to a server later. delta's in-process answer is SQLite.
- **Refusing to boot open.** epsilon will not start in production with no database configured,
  so a typo cannot serve an open, auth-free app.
- **A trace per screen.** DEC-15: each screen keeps what went down, what came up (who sent it,
  the refusal if any) and how often it recomposed. eta's `inspect` and `watch` give the ledger's
  side of that, not the page's.
- **Readings.** zeta had a week (time as an axis, DEC-16) and a map (the location atlas). eta's
  bento reads a collection as a photo or a list.

## Traded on purpose, not lost

- **The screen as a document.** zeta composed a tree of nodes, versioned and patched like any
  document. eta sends HTML from the server. `documents-history.md`: "neither settles the
  question -- zeta's answer keeps one vocabulary everywhere; eta's removes a layer."
- **Derivation checked against the database** (DEC-10). delta's `defineSchema` makes the tables
  from the TypeScript, so the two cannot drift apart the way zeta guarded against.
- **A runtime you own.** epsilon is ~3.8k lines vendored into the app; eta, delta and railroad
  are packages.

## Order, if they come back

1. Undo that will not clobber -- delta 0.6.1. A correctness bug in a released package.
2. A refused write that says why -- eta.
3. The origin allowlist -- eta.
4. A lookup through the server -- eta.
5. The law per document -- delta.
6. Users and sign-in; views across processes -- with eta on Postgres.
