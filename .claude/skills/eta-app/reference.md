# eta reference

How each piece works, one section a piece. `SKILL.md` is the order to work in; the types in `src/`
are the contract itself, and where this file and the code disagree, the code is right.

## The page

`Example.render(sessionId)` returns the whole page for a session, as HTML. It is the only renderer:
it decides which screen (chat: the name form, the rooms, or the room) and reads whichever documents
it must. A compartment owns a document, not a place on the page. A write is answered with what its
compartment's `fragments` says changed, or with the page.

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
  docType: string;                         // what it owns on the wire: "session", "room"
  resolveDoc(ws): string | undefined;      // the document id this connection sees for this docType
  sees?(ws, docId): boolean;               // who else sees it; default: resolveDoc(ws) === docId
  permit(ws, op): boolean;                 // may this connection write this path?
  write(ws, docId, ops, undoes?): WriteResult; // apply, then notify()
  fragments?(ws, docId, result): HtmlOp[] | undefined;
  onOpen?(ws): void;
  onClose?(ws): void;
};
```

- **`permit` and `patch()` split the question.** May this connection write this path is
  `permit`'s; is this value valid is the document's `patch()`'s.
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
  and asks for pages to be brought up to date; by default both go to everyone who sees the
  document, the writer included. `echoTo` replaces who hears the ops (chat's presence leaves out
  the socket that came or went); `renderTo` widens who is redrawn (the wedding passes
  `allOpenSockets()`, since totals and the photo draw on every household). Nothing applied tells
  nobody. Never send a patch or ask for a render by hand.
- `audienceFor(docType, docId, exclude?)`: every open connection that sees the document.
- The kernel never brings a write's own connection up to date separately. A `write()` that forgets
  to `notify` leaves its writer stale, and the stories catch it.

## `fragments`: smaller than the page

```ts
type HtmlOp = { op: "replace" | "add"; target: string; html: string } | { op: "remove"; target: string };
```

`replace` morphs one element (give it an id), `add` appends inside one, `remove` takes one out.
`[]` says nothing on this connection's page changed; `undefined` declines and the page goes. The
morph finds what changed in a page, so the page is always right. Answer smaller only where it is
worth the care: every target has to be right for every state the page can be in, and the ticker's
hand-kept lists went stale four times. Chat answers a message with one `<li>`; the ticker answers
a tick with `[]`, because its board applet took the patch.

## Documents

A document module owns its SQL (prepared statements at module load) and exports `read(id)` and
`patch(id, ops, sessionId, undoes?)`. `patch`:

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

- Client to server: `{doc, ops: [{op, path, value?}]}`. `path` is a JSON Pointer, never a verb.
- Server to client: `{type: "patch", doc, version, ops}` (what was applied; kept in
  `window.eta.docs()`), then `{type: "render", html}` (the page) or `{type: "render", ops}`
  (fragments).
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

Mount point: `<div data-applet="board" data-doc="ticker" data-props='{...}'>`. Data reaches an
applet as new props on a render (`update`), or, for a document that changes often, as the patch
itself (`patch`, with `fragments` answering `[]`). Register in `client/main.ts` before importing
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
