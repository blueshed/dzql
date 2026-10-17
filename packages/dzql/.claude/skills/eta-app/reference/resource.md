# Resources, and telling a change

A resource looks after one type of document: which one a page is on, who may write to it, what a
write becomes, what follows. Saying why a write was refused is [refusal.md](refusal.md).

```ts
// examples/chat/resources/room.ts
export const room: Resource = {
  docType: "room",
  resolveDoc(ws) {
    return sessionDoc.read(ws.data.sessionId).room ?? undefined; // the room this person is in
  },
  permit(ws, op) {
    if (op.path !== "/messages/-" || op.op !== "add") return false;
    return sessionDoc.read(ws.data.sessionId).name !== null;
  },
  // The wire says the text; the document takes a message: a new row, its author and the time.
  shape(ws, _room, ops) {
    const { name } = sessionDoc.read(ws.data.sessionId);
    return ops
      .map((op) => String(op.value ?? "").trim())
      .filter((text) => text !== "")
      .map((text): PatchOp => ({ op: "add", path: `/messages/${Bun.randomUUIDv7()}`, value: { name, text, sent_at: Date.now() } }));
  },
  afterChange: () => keepLobby(), // the list of rooms follows
};
```

The hooks, in the order they run: see `Resource` in `src/rendering/resources/resource.ts`.

## Who sees what

- A page sees what it read: every `read("<docType>:<id>")` while drawing, and the one of each type
  it is on (`resolveDoc`). Those it is told about, and may write. Nothing declares it.
- A field in a document reaches every page that reads it, drawn or not: a field only some may see
  belongs in a document only they read.
- So cut documents by who reads them: the wedding's households read `wedding:1` and `everyone:1`,
  never the couple's board. An id may be criteria (`month:2026-09`); `permit` is given it.
- `perSession`: one per session (the session, a desk), seen by its own session alone, named on the
  wire by its type alone.

## A write: seen, `permit`, `shape`, then delta

1. **Seen:** the page can see the document.
2. **`permit`:** may this person make this change, to this path? Omitted: nobody may.
3. **`shape`:** what the page sent, as the document keeps it: checked, trimmed, an id made, a wire
   path (`/guests/2/minifigure/top`) turned into the rows it moves. Shaped to nothing is refused.
4. **delta:** is it valid data?

Undo and redo are delta's inverses, never shaped. Never write another resource's document from
`shape`. `kind`: `written` (default: ledger, undoable), `fact` (never undone), `live` (the server's,
in memory, never from the wire), `sourced` and `static` (read only).

## After a write

- `afterChange(docId, ops)`: after every change, once told (a write, an undo, another process's).
  Keep a live document true: compute it whole, `serverWrite` the difference, one run at a time
  (`examples/chat/presence.ts`): two at once diff the same copy, and delta refuses the second.
- `afterWrite(ws, docId, ops, landed)`: after this person's fresh write: what follows for the
  writer alone. `ops` are as sent (`add /requests/-`); `landed`, as delta applied them, the echo's:
  a new row by its id (`add /requests/<id>`), so leave's drawer goes on to the request its draft
  became. It has landed: a throw is reported, never a refusal.
- `afterWalk(ws, docId, { way, ops, inverse })`: after this person's undo or redo; `inverse` holds
  what it took back, rows whole. A walk that changed nothing comes with `ops: []`: say nothing.

## Telling a change

Every change is told from delta's one stream, whether this process wrote it or another did (two
processes share documents on Postgres, through dzql), one at a time, in order: never by hand. The kernel echoes the ops to everyone who sees the
document and draws every page that read it again, sending the parts that changed ([page.md](page.md)).
`audienceFor(docType, docId)`, `readersOf` and `allOpenSockets()` name who. delta tells a change as
the fields it changed (`replace /name`), and a row that arrives or leaves as the row, whole.
