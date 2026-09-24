# eta reference

How each piece works, one section a piece. `SKILL.md` is the order to work in; the types in `src/`
are the contract itself, and where this file and the code disagree, the code is right.

## The page

`Example.render(sessionId)` returns the whole page for a session, as HTML. It is the only renderer:
it decides which screen (chat: the name form, the rooms, or the room) and reads whichever documents
it must. A compartment owns a document, not a place on the page. After a write, every page that
read the document is drawn again and sent only the parts of it that changed (below).

## `Example` (`src/example.ts`)

```ts
export type Example = {
  name: string;                       // namespaces its migrations
  compartments: Compartment[];        // one per document type, the session's own first; the kernel appends its ledger
  render(sessionId: string): string;  // the whole page
  active(sessionId: string): boolean; // may this session write at all right now?
  index: HTMLBundle;                  // served at "/" and at any path the kernel does not own
  routes?: Record<string, ...>;       // extra HTTP routes; a kernel route of the same path wins
};
```

`active` exists because only the example knows what "signed in" means. The kernel uses it to gate
undo: a stale, logged-out tab must not walk back a write made before it went stale. `src/start.ts`
runs `examples/${ETA_EXAMPLE}/index.ts` (default `chat`); one process serves one example.

## `Compartment` (`src/compartments/compartment.ts`)

```ts
export type Compartment = {
  docType: string;                         // the type of document it owns: "session", "room"
  resolveDoc(ws): string | undefined;      // the one of this type the connection is on (a bare name)
  own?: true;                              // keyed by the session id: that session's alone, named by type
  permit(ws, op, docId): boolean;          // may it write this path of this document?
  write(ws, docId, ops, undoes?): WriteResult; // apply, then notify()
  onOpen?(ws): void;
  onClose?(ws): void;
};
```

- **A connection sees what its page read.** While the kernel draws a page for a connection, every
  document whose `read()` calls `reading(docType, id)` (`src/reading.ts`) is noted; those, and the
  one of each type it is on (`resolveDoc`), are what it is told about and may write. Show this
  month's appointments beside last month's and both are seen; stop showing one and it is not.
  Nothing declares who sees what. A document's id may be criteria (`month:2026-09`); `permit` is
  given it.
- **`own` for a session's own documents** (session, desk, watchlist, the ledger): seen by that
  session alone, whatever reads them -- chat's presence reads everyone's name from their sessions
  -- and named on the wire by type, since the id is a credential.
- **Seen, then `permit`, then `patch()`.** A connection writes only what it sees (the kernel
  checks, before `permit` is asked); may it write this path of this document is `permit`'s; is
  this value valid is the document's `patch()`'s.
- **One `write`, fresh or walked.** Fresh from the wire, `permit` said yes and `undoes` is
  undefined. When the ledger walks an entry back or forward it calls the same `write` with the
  recorded inverse and the entry's id as `undoes`; `permit` is not asked. What a compartment does
  to a fresh value (chat shapes text into a message; the wedding keeps only a plus-one's name) it
  does only when `undoes` is undefined.
- **React to another compartment through an event** (`src/compartments/bus.ts`), exported by the
  compartment that emits it: chat's `sessionPatched` lets the room announce who came and went. Do
  not patch another compartment's document from your own `write()`.

## Telling a write (`src/compartments/audience.ts`)

- `notify(docType, docId, result, {echoTo?, renderTo?})` is the one way. It echoes the applied ops
  to everyone who sees the document, the writer included, and redraws those and everyone else
  whose page read it (a session's `own` document too: its ops never go to them, its effect on
  their page does). `echoTo` replaces who hears the ops (chat's presence leaves out the socket
  that came or went); `renderTo` replaces who is redrawn (the wedding passes `allOpenSockets()`,
  since totals and the photo draw on every household). Nothing applied tells
  nobody. Never send a patch or ask for a render by hand.
- `audienceFor(docType, docId, exclude?)`: every open connection that sees the document.
- The kernel never brings a write's own connection up to date separately. A `write()` that forgets
  to `notify` leaves its writer stale, and the stories catch it.

## Parts: what is sent (`src/parts.ts`)

A render names the regions of its page with `part(key, html)`: its root element is tagged
`data-eta-part="<key>"`. The bento's cells, the open window, rows with an id, lists given a key
(`rows(items, empty, key)`) and drawers are parts already; name the rest -- a strip, a list, a
row, an applet's mount -- where a change should travel alone. The kernel keeps what each
connection was last sent and, after a write, draws its page again and sends what differs:

- a part whose outline changed is replaced (`replace`, morphed in place);
- a list -- a part whose rows are parts, in one run -- has rows put in (`after`, `before`) and
  taken out (`remove`); a list that was empty, or whose rows changed order, is replaced;
- nothing, when nothing on the page changed;
- the page whole only when its own outline changed: a different page.

A key is unique on its page (drawn twice the same is fine; two different things under one key are
no part, and what holds them is sent). An applet that takes its document's ops (`data-doc`) is
compared without its props. Nothing is hand-written, and the stories check the result: each
member's page, rebuilt from exactly what they were sent, must equal a fresh render.

## Documents

A document module owns its SQL (prepared statements at module load) and exports `read(id)` and
`patch(id, ops, sessionId, undoes?)`. `read` begins `reading(docType, id)`: that is how a page that
shows it comes to see it, and a read that forgets leaves that page stale (the stories say whose).
`patch`:

- parses each op's JSON Pointer path, validates and trims the value, and skips what is invalid
  (not pushed to `applied`);
- applies the change and builds the inverse (`inverse.unshift(...)`: inverses undo in reverse). A
  `replace` whose old value was unset inverts to a `remove`, or undoing a first write does nothing;
- calls `record(prefixDoc(docType, id), applied, inverse, sessionId, undoes)` once and returns
  `{version, applied}`. Pass the acting `sessionId`, not the document id: undo is per session;
- is one transaction: `export const patch = db.transaction(function patch(...) {...})`. Its
  statements and the ledger row commit together or not at all; a transaction inside another is a
  savepoint.

Address a row in a shared list by its id, never its position: other people write between a write
and its undo. A document is off the ledger by never calling `record()` (the wedding's session,
chat's presence); a fact from outside is recorded with `undoable: false` (the ticker's ticks).

**The ledger** (`src/ledger.ts`) is the only undo state. `nextUndo(sessionId)` is the newest row
the session wrote that is neither an undo nor undone; `nextRedo` the reverse. The kernel's ledger
compartment takes `remove /latest` (undo) and `add /latest` (redo) and calls the owning
compartment's `write` with the inverse.

**Migrations.** `migrate(db, dir, namespace)` records each file as `${namespace}/${file}`, so the
kernel's and an example's cannot collide. An example's `db.ts` runs its own and re-exports `db`;
its documents import `db` from there, so migrations run before any prepared statement.

## The wire

HTML is the only vocabulary. No JSON tree of app state.

- **A document is named whole: `<docType>:<docId>`** (`room:general`, `month:2026-09`), so one
  socket holds any number of documents, of any types. The exception is an `own` document (a
  session's session, ledger, desk): it is named by its type alone, since the id is a credential. A
  document keyed by a live session's id that is not `own` is refused by name, loudly.
- Client to server: `{doc, ops: [{op, path, value?}]}`. `doc` is a whole name, or a bare type
  meaning the one of that type this connection is on (`resolveDoc`). `path` is a JSON Pointer,
  never a verb.
- Server to client: `{type: "patch", doc, version, ops}`, `doc` named whole (what was applied;
  kept in `window.eta.docs()` under that name), then `{type: "render", html}` (the page) or `{type: "render", ops}`
  (the parts that changed).
- `{type: "inspect", limit?}` answers with the documents this connection sees and their latest
  ledger entries. An entry says `mine: true|false`, never who.
- **A session id never goes on the wire.** It is the `session_id` cookie and a person's only
  credential. No echo, render, op value or inspect reply may carry one.

An element writes through `data-write='{"doc","op","path"}'`:

- a **form** writes on submit: its one field's value, or a record of several. It resets only when
  its own write is echoed, so a refused write keeps what was typed;
- a **button or row** writes on click, with `data-value` if it has one. A click in a field never
  writes;
- a form with **`data-write-on="blur"`, `"change"` or `"input"`** edits in place: `data-write` goes
  on each field, and every field whose value differs from what was rendered becomes one op in one
  message. `"input"` is debounced ~150ms, flushed when focus leaves, and never repeats itself.

`autofocus` means "this field is waiting for the caret": after a render the client focuses it, but
only when nothing has the caret. `data-autoscroll` pins a list to its foot when it grows.

## Where you are: the address (`src/bento.ts`)

Keep where a session is as one string on its own document: `path?what=which` -- the page, and the
one thing open over it (`guests?guest=2`, `gifts?new`, `?answer`). `address(path, what?, which?)`
builds one and `parseAddress(page)` reads one. Opening a drawer or a modal is going to the same
page with it named; closing it is going to the page alone; going anywhere puts away what was open.

Put the address in `data-page`, with the write that sets it in `data-page-write`, on any element
of the page. The client mirrors it into the URL and sends the write on back and forward, so the
back button closes a drawer and a link opens one. On first load the session catches up to the URL.

## Pages: the bento (`src/bento.ts`, `src/bento.css`)

The rules are `examples/bento/README.md`. Bind the surfaces once per example:
`bento({icon, tray, leave?})`, where `icon` is the example's own icon function, `tray` the docType
find and the reading switch write to, and `leave` the last of the page's tools. It returns
`boxPage`, `collectionPage`, `cell`, `row`, `tool`, `addTool`, `findControl`, `readingSwitch`,
`sheet`, `addModal`, `confirmModal`. A page is a **box** (`boxPage(trail, inPlace, cells, open?)`:
compartments in a tray, one grown into the window) or a **collection** (`collectionPage(trail,
open)`: the window alone). Every gesture is a `data-write` string the caller hands in.
`patchCollections(ui, op)` applies what find and the reading switch write (`/filter/<key>`,
`/hide/<key>`, `/reading/<key>`). The stylesheet imports `src/bento.css` first, then says its
tokens. `data-moving` names the element that grows (a view transition runs only when its own tag
changes); `data-reveal` scrolls the chosen row into the clear.

Escalate only as the data forces: in place, then the compartment, then a drawer, then a window,
then a modal. A list of five needs no find.

## Applets (`src/applets.ts`)

Only for a piece of the page whose client-side state a re-render would destroy. The morph never
descends into `[data-applet]`.

```ts
export type Applet = {
  mount(el, { props, send }): void | (() => void); // cleanup optional
  update?(el, props): void;   // the element survived a render with new data-props
  patch?(el, ops): void;      // the ops of the document named in data-doc, as they are echoed
};
```

Mount point: `<div data-applet="board" data-doc="ticker:market" data-props='{...}'>`, the
document named as the wire names it. Data reaches an
applet as new props on a render (`update`), or, for a document that changes often, as the patch
itself (`patch`; its props are left out when the page is compared, so no HTML follows). Register in `client/main.ts` before importing
`src/client/app`. Split drawing (`<name>.ts`, pure, tested directly) from mounting
(`<name>-applet.ts`, the DOM, imported only by `client/main.ts`) when there is drawing worth
testing. `client/index.html` must have an element with `id="app"`.

## CLI

`src/cli.ts` knows `inspect`, `watch`, `undo`, `redo` and `write <doc> <op> <path> [value]`. An
example's `cli.ts` may export `aliases`, short verbs that build `{doc, ops}`. No database import:
the CLI talks to a running server over the same socket a browser does.

## When it looks like you need to touch `src/`

It usually means a seam is missing, not that the example is special. A per-example "may this
session write" is `Example.active`; an extra HTTP route is `Example.routes`; undo behaving
differently is `write`'s `undoes`. Never teach the kernel the name of a specific document, applet
or compartment.
