# Paths, ids and error codes

From `tests/client.test.ts`: make a row, and read the id the server gave it.

```ts
const doc = openDoc<any>("venue:1", client);
await doc.ready;
const ack = await doc.send([{ op: "add", path: "/rooms/-", value: { name: "attic" } }], { inverse: true });
// ack.ops: [{ op: "add", path: "/rooms/1", value: { id: 1, venues_id: 1, name: "attic" } }]
```

`DeltaOp` is in `src/core.ts`: `add`, `replace`, `remove`, RFC 6902's meanings, on every backend.

Working: [examples/lists](https://github.com/blueshed/dzql/blob/main/packages/delta/examples/lists/README.md), an item the server names
(`add /items/-`) and each path to one built with `joinPath`, in `resources/lists/lists-view.tsx`;
nobody is 401 there, and a list someone is not on is 404, to open or to write.
[examples/lobby](https://github.com/blueshed/dzql/blob/main/packages/delta/examples/lobby/README.md) is 403 to a page's write of who is here or of the colours.

## Paths

RFC 6901 JSON Pointers: `/coll/id` a row, `/coll/id/field` a field, `/coll/-` a new row the
server names (on an array, append). The parsers are `splitPath` / `joinPath` in `src/core.ts`;
`pointerVectors` (`./testing`) is the grammar as data.

- Every path starts with `/`; one that does not is a 400, never the root.
- Build paths from ids with `joinPath("messages", id)`: it escapes `~` as `~0` and `/` as `~1`.
  Never a template string.
- `""` on `replace` / `remove` swaps or clears the whole document in place (same kind:
  object for object, array for array). `"/"` is the member named `""`, not the root.
- A segment is a string unless its parent is an array: on a memory document
  `/items/007` is key `"007"`; on a table backend it is row 7.
- `add` at an array index inserts before it; `replace` or `remove` of what is not there is a 404.
- A row keeps the id its path names; an `id` in the value is ignored, and `id` is not a field.
- A replace of a row is the whole row: a field left out takes its default (null if nullable),
  a required one left out is 400. Its id and parent key stay unless the value names others, and
  a time only the server sets (`default: "now"`, `schema.md`) keeps its own.
  To change some fields, replace each field.

## Ids

- Ids are serial numbers on every table backend; `add /<coll>/-` takes the next and the echo
  carries it. Digits name their number (`/todos/007` is 7), up to 2^53 - 1; past that is 400.
- A client-chosen id (`add /todos/50`) must be past every id the serial has handed out, and
  moves the serial past it. One already handed out is 409 whether or not a row holds it, so the
  answer leaks nothing. Undo, redo, and a row the same write removed or made are let through.
- `-` never collides; a client clock (`Date.now() * 1000`) collides once one client is behind.
- A refused write that took a serial has spent it.
- Text ids: keep them to session tokens (a uuid), for documents that never move. A taken text id
  is 409, so make it unguessable.

## Error codes

`{ id, error: { code, message } }` on the wire, `DeltaError.code` on the client, the same on every
backend (`errorCodeCases` in `src/cases/writes.ts`):

- **400** malformed: no leading `/`, unknown field, missing required field, bad id, a time only
  the server sets (`default: "now"`) named.
- **401** not signed in (an `auth` gate said no; an `owns: "ANYONE"` document is open to it, `ownership.md`).
- **403** read-only: custom, static and source documents; memory over a socket; a past (`at:`) name.
- **404** not there: a document, row or path; a document the identity does not `own`; a row a
  `refs` column names (`schema.md`).
- **409** already there (an id taken, or a unique constraint's values: `schema.md`), or still
  named (a row a current row's `refs` column names, removed).
- **500** the server's own failure.
