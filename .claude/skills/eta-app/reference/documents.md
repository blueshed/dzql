# Documents (`delta.ts`, `documents/<thing>.ts`)

How an app's documents are declared (`delta.ts`), read for the page (`documents/<thing>.ts`) and undone (the ledger). Who may write them is [compartment.md](compartment.md).

An example's documents are delta's: `delta.ts` says the tables and the documents, and
`documents/<thing>.ts` reads them for the page.

```ts
// examples/chat/delta.ts
registerDocs(delta.server, db, schema, [
  defineDoc("session:", { root: "sessions", include: [], implied: true }),
  defineDoc("room:", { root: "rooms", include: ["messages"], implied: true }),
], [], { ledger: true });
```

`delta.ts`:

- defines the schema (`defineSchema`), with tables prefixed by the example's name (`chat_`);
- creates the tables, and seeds them when empty;
- registers the documents on a `createLocal()`: `registerDocs(..., { ledger: true })` for what is
  written and undone, `registerMemory` for what is live.

A session may go in a registry of its own with no ledger, where a visit is not history (the
ticker's desk, the wedding's session). Its compartment then says `ledger: false`: the kernel
reports a write whose ledger entry disagrees with its compartment, so a document left off the
ledger by mistake (where no undo could ever work) is caught. Chat's session is on the ledger, so
Undo right after entering a room takes you out of it.

A document is a root row and the collections it includes, each a map of rows by id. Two documents
may include the same rows, and delta carries a write to every one that holds them.
`defineSchema`, `defineDoc` and their options (`include`, `implied` for a document that opens
empty until its first write, `temporal`) are delta's: its `delta-doc` skill
(`node_modules/@blueshed/delta/.claude/skills/delta-doc/`) is the reference.

A document module reads with `read<T>("<docType>:<id>")` from `src/documents.ts`. It gives the
document as held, synchronously, from the copy kept current by delta's stream. It throws `Pending`
if the document is not held yet, and the kernel loads it and draws again. Adapt the rows there
into what the page wants (ids as text, a guest's look as one object), and put the pure rules
beside it (`after(state, ops)`, `shape(doc, ops)`), tested without a server.

- Address a row by its id, never its position: other people write between a write and its undo.
  Make ids in `shape` (`Bun.randomUUIDv7()` is time-ordered, so the key is the order).
- A value a column cannot default in SQL (an object) is given in the schema's `default`, and delta
  fills it in. Treat null as empty all the same.
- No migrations: `createTables` makes what is missing, and the seed runs into empty tables.
- `serverWrite(doc, ops)` is the server's own write: no person, no cursor, never undone. Use it for
  what `afterChange` keeps, and for signing in. It goes straight to delta, so its paths are the
  document's own and `under` is not added (`/desks/page`, `/quotes${path}`, not `/page`).
- Tests and scripts write as a person would, through the same `shape` (the wedding's `setup.ts`).
- A page's reads go through `read()`. Go to the tables directly only for what no page reads as a
  document: what a live document is computed from (chat's rooms spoken in, the wedding's
  `everyone`), a credential looked up (a household's code), a blob (the wedding's pictures), and a
  rule `shape` checks across rows (how many have claimed a gift).
- A long document is read in windows, by a keyset, never an offset (an offset moves when someone
  writes): chat keeps `/before`, the message the window ends before, in the session, and draws the
  fifty before it. The page still reads the whole room, so it is told every change; a message said
  meanwhile falls after the window, so a page reading back is sent nothing. A window as its own
  document waits for a room too big to hold whole.
- To try a change to delta before it is released, point `package.json` at a checkout
  (`file:../delta`, a copy: `bun install --force` after each change) and put it back before
  committing.

## The ledger

The ledger is delta's (`delta_ledger`), and it is what makes Undo work. It holds every write with
its inverse, its version, who made it, and the cursor Undo moves along, which is the session.

- The kernel's ledger compartment takes `remove /latest` (undo) and `add /latest` (redo), and asks
  delta to undo or redo along the session's cursor.
- It takes `remove /<change>` and `add /<change>` too: one change of the session's, named by the
  handle its write's echo carried (`change`, or its undo's), undone or redone whatever came after
  it. A person and an assistant in one browser are one session, so one cursor; "undo my last"
  would take whichever was newest, and each undoes its own by name instead. A handle is random and
  the session's own, never delta's entry, a serial that counts everyone's writes; the server keeps
  the session's (the last 100) while it has a page open. One it did not give the session is
  refused (`No change of yours is called 3f…`), and so is one undone already, or not undone.
  Undoing a row's making once someone has put rows under it is a conflict (delta's guard).
- One Undo reverses one write to one document. If a gesture changes two documents, it takes two
  presses, so keep what changes together in one document; where it cannot be, the hooks say what
  follows (leave's draft is in its asker's session until they ask: asking drops it, in
  `afterWrite`, and its Undo gives it back, in `afterWalk`).
- Before it runs, `permitUndo` is asked, and an undo that meets a later write by someone else is
  refused with a reason (see [Compartment](compartment.md#undo-is-checked-before-it-runs)).
