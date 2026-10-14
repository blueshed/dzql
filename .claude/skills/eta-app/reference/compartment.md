# Compartments, and telling a change

What a compartment decides for its one type of document: who sees it, which writes it allows, what a write becomes, what follows; and how a change is told. The documents themselves are [documents.md](documents.md).

## `Compartment` (`src/compartments/compartment.ts`)

A compartment looks after one type of document: which one a page is on, who may write to it, and
what a write becomes. Chat has four: `session`, `room`, and the live `here` and `lobby`. Its hooks
are listed in the order they run.

```ts
export type Compartment = {
  docType: string;                         // the type of document it looks after: "session", "room"
  resolveDoc(ws): string | undefined;      // which one of this type this person is on (chat: the room they are in)
  perSession?: true;                       // one per session: that session's alone, named by type on the wire
  kind?: Kind;                             // written (default), fact (never undone), live, sourced, static
  ledger?: false;                          // Undo skips it (a visit): said, so one left off by mistake is caught
  under?: string;                          // where the wire's paths sit in the document ("/sessions")

  // before a write
  permit?(ws, op, docId): boolean;         // may they make this change? omitted: nobody may
  shape?(ws, docId, ops): PatchOp[];       // what the page sent, as the document keeps it
  // before an undo or redo
  permitUndo?(ws, docId, ops): boolean;                // may it go ahead? omitted: always
  // after
  afterWrite?(ws, docId, ops): void | Promise<void>;   // after a fresh write, for the writer alone
  afterWalk?(ws, docId, walk): void | Promise<void>;   // after an undo or redo, for the walker alone
  afterChange?(docId, ops): void | Promise<void>;      // after any change from anyone, undo included
  onOpen?(ws): void | Promise<void>;       // a page connected
  onClose?(ws): void | Promise<void>;      // a page closed
};
```

### Who sees what

A page sees what it read. Nothing declares it.

- While the kernel draws a page, every document read through `read("<docType>:<id>")`
  (`src/documents.ts`) is noted. Those, and the one of each type the page is on (`resolveDoc`),
  are what the page is told about and may write.
- Show this month's appointments beside last month's and both are seen. Stop showing one and it
  is not.
- A document's id may be criteria (`month:2026-09`). `permit` is given it.
- So cut documents by who reads them. The wedding's households read `wedding:1` (the lists) and
  `everyone:1` (what they may know of each other), never the couple's board.

### `perSession`

For a document there is one of per session: the session itself, a desk, a watchlist, the ledger.

- It is seen by its own session alone, whatever reads it. (Chat's presence reads everyone's name
  from their sessions, but no page is told of another's session.)
- It is named on the wire by its type alone, since the session id is a credential. Its id is taken
  out of every op value on the wire.

### A write: seen, `permit`, `shape`, then delta

Each step answers one question.

1. **Seen:** the kernel checks the page can see the document before anything else.
2. **`permit`:** may this person make this change, to this path of this document?
3. **`shape`:** what the page sent, as the document keeps it: checked, trimmed, an id made, a
   nested wire path turned into the rows it moves. The wire's words are the example's to choose
   (`/guests/2/minifigure/top`); `shape` translates them. A write that shapes to nothing is
   refused, and the page handed back.
4. **delta:** is it valid data?

Undo and redo are delta's too: an entry's inverse, never shaped.

### Saying why a write was refused, or what one did

Throw `refuse(reason)` from `permit` or `shape` (`src/refusal.ts`), and the person is told why,
beside the control that sent it:

```ts
if (ends < starts) throw refuse("The last day is before the first.");
```

- The page draws the line with `toldAt(sessionId, doc, path)`, where `doc` and `path` are the
  control's `data-write`. It gives `<p class="refused" role="alert">`, `<p class="said"
  role="status">` for a success, or nothing.
- A success is told, not thrown: `tell(sessionId, { doc, path, said })`, from `afterWrite` or
  `afterWalk` (see After a write), or a route that answered a form. A line is one kind or the
  other: `reason` or `said`.
- The kernel keeps the line in the session's own `told` document (in memory, off the ledger: being
  told is not something that happened) until the session's next write.
- The page that sent the write is also answered `{type: "refused", id, reason}`, by the write's
  own id (see [The wire](wire.md)): the refusal is that write's, whatever else was sent since.
- A plain `false` refuses without a word. That is right for a write no control offers: there is
  nowhere to say why.
- Where the browser can refuse it first (`required`, `pattern`), let it.

### Undo is checked before it runs

The kernel asks delta what an undo or redo would write (in the wire's paths, each field it sets
back its own replace: `replace /answer`), and asks the compartment's `permitUndo(ws, docId, ops)`.

- It is not `permit`: Undo may do what permit refuses (a message taken back).
- It is for a rule of time or state that holds against Undo too. The wedding refuses an undo that
  would set back an answer after the deadline: `refuse("Answers closed at the deadline.")`.
- An undo that meets someone else's later write changes nothing, and says so: "Someone has changed
  that since, so it cannot be undone."
- The kernel draws why an undo or redo was refused over the page (`.undo-said`), since Undo is its
  own tool; and there too what one did, when `afterWalk` says.

### By kind

- `written`: on the ledger and undoable (a room's messages).
- `fact`: recorded, never undone (the ticker's ticks).
- `live`: held in memory and written by the server, never from the wire (chat's who is here).
- `sourced` and `static`: read, never written.

### After a write

- **`afterChange(docId, ops)`** runs after every change to the document, once it has been told:
  a write, an undo, another process's. Use it to keep a live document true (chat's presence and
  list of rooms, the wedding's `everyone`): compute it whole, and write the difference with
  `serverWrite`, one run at a time, each after the last (`examples/chat/presence.ts`). Two runs at
  once diff the same copy, and delta refuses a remove or replace of what is not there (404), with
  the rest of the write: the second run's removes, and its adds with them.
- **`afterWrite(ws, docId, ops)`** runs after a fresh write from this person, with the ops as the
  page sent them: what follows for the writer alone. Leave closes the draft's drawer once it is
  asked for. The write has landed by then: a throw here is the server's failure, reported
  (`following a write to …`), never a refusal. What the writer was told before has gone, so it may
  say what the write did: `tell(ws.data.sessionId, { doc, path, said })`, beside the control that
  sent it.
- **`afterWalk(ws, docId, { way, ops, inverse })`** runs after an undo or redo of this person's has
  landed, as `afterWrite` does after a fresh write: `way` is `"undo"` or `"redo"`, `ops` what the
  walk wrote and `inverse` what that wrote over, in the wire's paths, each row whole as the ledger
  keeps it -- so an undo's `inverse` holds what it took back. Say it over the page, where Undo is:
  `tell(ws.data.sessionId, { doc: "ledger", path: "/latest", said: "Undone: your answer." })`
  (the wedding's household). A walk that changes nothing (what it would set back is so already)
  lands all the same, delta moving the cursor past it, and `afterWalk` runs with `ops: []` and
  `inverse: []`: say nothing then. A throw here is reported (`following a walk of …`); the walk
  stands.
- Never write another compartment's document from `shape`.

## Telling a change (`src/server.ts`)

Every change is told from one place, and you never tell one by hand.

A change reaches the kernel on one stream, delta's publish, whether this process wrote it or
another did over Postgres. The kernel then:

- echoes its ops to everyone who sees the document, at the wire's paths (`under` taken off, a
  `perSession` document's id scrubbed);
- draws every page that read it again, and sends each only the parts that changed.

Changes are told one at a time, in order, and events are handled one at a time: an `inspect` is
answered after everything the events before it set going.

- `audienceFor(docType, docId)`: every open connection that sees the document.
- `readersOf`: every one whose page read it. `allOpenSockets()`: all of them (chat's presence).
- delta tells a change as the fields it changed (`replace /DLTA/price`, `replace /name` on a
  session's own); a row that arrives or leaves as the row, whole. A write's answer, the ledger and
  a walk's `ops` and `inverse` keep rows whole.
