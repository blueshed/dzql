# The ledger: undo, redo, history

From `tests/ledger.test.ts`'s shape: turn it on, write with a cursor, walk it back.

```ts
registerDocs(ws, db, schema, docs, customDocs, { ledger: true, who: (i) => String((i as { id: number }).id) });

await local.call("delta", { doc: "room:a", ops, cursor: "s1" });   // in-process: name the cursor
await local.call("undo", { cursor: "s1" });     // → { doc, ops, inverse, version, entry } | conflict | null
await local.call("redo", { cursor: "s1" });
await local.call("history", { doc: "room:a" }); // → newest first, limit 50, each with `mine`
```

Message shapes: `wire.md`. Every write is recorded in its own transaction: ops, inverse,
version, **who** (for the audit) and the **cursor** (what undo walks). SQLite keeps
`delta_ledger`.

From a page, `undo`, `redo` and `history` in `@blueshed/delta/client` (through `WS`, or the
client given): the change itself arrives through the documents, as every write's does, and the
answer says what it did.

```ts
import { history, redo, undo, type Walk } from "@blueshed/delta/client";
const done: Walk = await undo();          // Walked | WalkConflict | null
if (done === null) say("Nothing of yours to undo.");
else if (done.conflict) say("Someone has changed that since.");   // nothing changed
const entries = await history("room:a");  // HistoryEntry[], newest first, each with `mine`
```

Working: [examples/lists](https://github.com/blueshed/dzql/blob/main/packages/delta/examples/lists/README.md), two people signed in on one
list, each undoing their own, and an undo with the other's change in the way refused:
`{ ledger: true, who }` in `resources/lists/lists-api.ts`, the cursor's `clientId` in `app.tsx`,
Undo and Redo (`undo`, `redo`, `Walk`) in `resources/lists/lists-view.tsx`.

## The cursor

- In-process (`createLocal`, `data.local`): the caller names it, e.g. a session id.
- Over a socket: the connection's `clientId` (a `cursor` on the message is ignored), bound to
  the person signed in, or else to a key the server mints on the upgrade (the `delta_cursor`
  cookie: HttpOnly, never in the URL). **A browser undoes only its own writes.**
- `connectWs(url, { clientId })` keeps the cursor across reconnects (outside a browser, it sends
  a key of its own on each). The id is not a secret: a socket that names another's, without
  their sign-in or key, has a cursor of its own.
- To keep it across a reload, keep the id per tab (`sessionStorage`). A duplicated tab copies it,
  and shares the cursor.

## The walk

- Undo walks the cursor's writes back, newest first, across documents; redo forward; a fresh
  write ends redo. Each walk is an ordinary write: validated, recorded, broadcast.
- **The guard**: a walk sets back only what its entry changed, where the document still holds
  what it left. A field written since by anyone is a **conflict**: nothing changes and the
  answer has `conflict: [paths]`. Do not force the old values with your own replaces.
- The guard is per field, not per row: another field of the same row, written since, does not
  stop the walk. It stays as written, and the entry's fields are set back.
- A conflicting walk is recorded as walked (an empty entry), so the next undo goes on to the
  one before. `null` means nothing to walk.
- Each row is walked once by its net change; a single root is one row whichever path named it.
  A made row someone edited or put rows under is not removed.
- Removed rows come back under their ids, a cascade parent first. An undo reaches a document
  nobody has open.
- `walkVectors` (`./testing`) is the guard as data; `planWalk` answers it, and dzql's planner on
  Postgres.

## Options on a walk

- `undoable: false` on a write: a **fact** (a price tick), recorded, never walked, ends no redo.
- `dry: true`: answers what the walk would do and walks nothing; then `entry: <id>` walks only if
  that is still the cursor's next (409 otherwise).
- `change: <entry>`: one change of the cursor's (two writers on one cursor each undo their
  own). Another cursor's, a fact, or none is 404; a non-whole id 400. A conflicting named walk
  records nothing.

## Gotchas

- Answers, `history` and dry runs show only what the document holds (its columns, its
  collections); the ledger keeps rows whole, so undo puts everything back.
- `history` goes to whoever may open the document; `mine` says whether the asker's cursor wrote
  it, never who did.
- With `auth`, undo and redo pass the gate and `owns` of the entry's document.
- An empty write records nothing. The ledger does not carry to the next backend.
- **Starting afresh is a fresh database**: `:memory:`, or stop the server and delete the file
  (and its `-wal` and `-shm`, if there). A seed that deletes and re-adds rows under a kept
  ledger leaves entries naming rows that are not theirs. Never write delta's own tables
  (`delta_ledger`, `delta_versions`) by hand.
- **Without a ledger**, `inverse: true` on a `delta` answers `{ ack, ops, inverse }` on SQLite
  (`inverseOf` in `./sqlite`); on a memory document, the ops as applied only.
  A row made and removed in one write has no inverse.
