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
  name: string;                       // tells it from another example object at runtime
  compartments: Compartment[];        // one per document type, the session's own first; the kernel appends its ledger
  render(sessionId: string): string;  // the whole page
  active(sessionId: string): boolean; // may this session write at all right now?
  index: HTMLBundle;                  // served at "/" and at any path the kernel does not own
  delta: Local;                       // its documents: delta's backends on a createLocal()
  who?(sessionId: string): unknown;   // who a session is, to delta (the ledger's who, row-level security); default the session
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
  permit?(ws, op, docId): boolean;         // may it write this path of this document? omitted: nobody may
  walkable?(ws, docId, ops): boolean;      // may an undo or redo walk these ops onto it? omitted: any walk
  kind?: Kind;                             // where its truth lives: written (default), fact, live, sourced, static
  ledger?: false;                          // kept off the ledger (a visit): said, so one left off by mistake is caught
  at?: string;                             // where eta's paths sit in the document ("/sessions")
  shape?(ws, docId, ops): PatchOp[];       // the wire's ops as the document takes them (a fresh write only)
  changed?(docId, ops): void | Promise<void>;    // after any change to it is told: keep what follows from it true
  wrote?(ws, docId, ops): void | Promise<void>;  // after a fresh write from this connection: what follows for the writer
  onOpen?(ws): void | Promise<void>;
  onClose?(ws): void | Promise<void>;
};
```

- **A connection sees what its page read.** While the kernel draws a page for a connection, every
  document read through `read("<docType>:<id>")` (`src/documents.ts`) is noted; those, and the
  one of each type it is on (`resolveDoc`), are what it is told about and may write. Show this
  month's appointments beside last month's and both are seen; stop showing one and it is not.
  Nothing declares who sees what. A document's id may be criteria (`month:2026-09`); `permit` is
  given it. So cut documents by who reads them: the wedding's households read `wedding:1` (the
  lists) and `everyone:1` (what they may know of each other), never the couple's board.
- **`own` for a session's own documents** (session, desk, watchlist, the ledger): seen by that
  session alone, whatever reads them -- chat's presence reads everyone's name from their sessions
  -- and named on the wire by type, since the id is a credential. Their id is taken out of every
  op value on the wire.
- **Seen, then `permit`, then `shape`, then delta.** A connection writes only what it sees (the
  kernel checks, before `permit` is asked); may it write this path of this document is `permit`'s;
  what the write becomes -- validated, trimmed, an id minted, a nested wire path turned into the
  rows it moves -- is `shape`'s; is it valid data is delta's. The wire's vocabulary is the
  example's to choose (`/guests/2/minifigure/top`); `shape` translates it, and a write that shapes
  to nothing is refused (the page handed back). Undo and redo are delta's: an entry's inverse,
  never shaped.
- **A refusal can say why.** Where a person can make a write the server must refuse -- a code
  nobody has -- `permit` or `shape` throws `refuse("That code was not recognised.")`
  (`src/refusal.ts`). The kernel keeps the reason in the session's own `refusal` document (in
  memory, off the ledger: a refusal is not something that happened) until the session's next
  write, and the page draws it beside the control that sent it: `refused(sessionId, doc, path)`,
  the `doc` and `path` of that control's `data-write`, gives the line (`<p class="refused"
  role="alert">`) or nothing. A plain `false` stays silent: a write no control offers has
  nowhere to say why. Where the browser can refuse it first (`required`, `pattern`), let it.
- **Undo is looked at before it walks.** The kernel asks delta what the walk would write (in
  eta's paths) and asks the document's owner, `walkable(ws, docId, ops)`: not `permit`, since undo
  may do what permit refuses (a message taken back), but a rule of time or state that holds against
  Undo too -- the wedding refuses a walk that would set back an answer after the deadline, with
  `refuse("Answers closed at the deadline.")`. A walk that meets someone else's later write
  changes nothing (delta moves the cursor past it) and says so. The kernel draws why an undo or
  redo was refused over the page (`.walk-said`), since Undo is its own tool.
- **By kind.** `written` is on the ledger and undoable; a `fact` is recorded, never undone (the
  ticker's ticks); `live` is held in memory and written by the server, never from the wire
  (chat's who is here); `sourced` and `static` are read, never written.
- **What follows from a change.** `changed(docId, ops)` runs after every change to the document
  is told -- a write, an undo, another process's -- to keep a live document true from what is
  (chat's presence and list of rooms, the wedding's `everyone`): compute it whole, write the
  difference with `serverWrite`. `wrote(ws, docId, ops)` runs after a fresh write from this
  connection, with the ops as the wire said them: the modal that asked is put away by the write
  that answers it. Never write another compartment's document from `shape`.

## Telling a change (`src/server.ts`)

Every change reaches the kernel on one stream -- delta's publish, whether this process wrote it or
another did over Postgres -- and is told from one place: its ops echoed to everyone who sees the
document (at eta's paths, `at` taken off; an `own` document's id scrubbed), and every page that
read it drawn again, each sent only the parts that changed. Changes are told one at a time, in
order, and events are handled one at a time: an `inspect` is answered after everything the
events before it set going. Never send a patch or ask for a render by hand.

- `audienceFor(docType, docId)`: every open connection that sees the document; `readersOf`:
  every one whose page read it; `allOpenSockets()`: all of them (chat's presence).
- delta tells a change as the rows it leaves: a field replaced goes out as its row, whole
  (`replace /quotes/DLTA {...}`); a root field as the root (`replace ""` on a session's own).

## Parts: what is sent (`src/parts.ts`)

A render names the regions of its page with `part(key, html)`: its root element is tagged
`data-eta-part="<key>"`. The bento's cells, the open window, rows with an id, lists given a key
(`rows(items, empty, key)`) and drawers are parts already; name the rest -- a strip, a list, a
row, an applet's mount -- where a change should travel alone. The kernel keeps what each
connection was last sent and, after a write, draws its page again and sends what differs:

- a part whose own tag changed and nothing inside it (a class, `inert`, an applet's props) is sent
  its tag alone (`tag`); one whose inside changed is replaced (`replace`, morphed in place);
- a list -- a part whose rows are parts, in one run -- has rows put in (`after`, `before`) and
  taken out (`remove`); a list that was empty, or whose rows changed order, is replaced;
- nothing, when nothing on the page changed;
- the page whole only when its own outline changed: a different page.

A key is unique on its page (drawn twice the same is fine; two different things under one key are
no part, and what holds them is sent). After a write to the document an applet takes the ops of
(`data-doc`), its props are not compared -- it has the ops; after any other write they are, and
go as its tag when they changed.

Drawers and modals go through `layers(page, drawer, modal)` (src/bento.ts): the ground (the page,
and the drawer's layer over it) and the modal's layer, each always there and empty when nothing is
open, so opening or closing one sends its layer; a modal puts the ground `inert` by its tag. Make
the page's outermost element a part too (the wedding's and the ticker's `.site`), so its class and
its `data-page` go as a tag. Nothing is hand-written, and the stories check the result: each
member's page, rebuilt from exactly what they were sent, must equal a fresh render.

## Documents (`delta.ts`, `documents/<thing>.ts`)

An example's documents are delta's. `delta.ts` defines the schema (`defineSchema`; the tables
prefixed with the example's name, `chat_`), creates the tables, seeds them when empty, and
registers the documents on a `createLocal()`: `registerDocs(..., { ledger: true })` for what is
written and undone, `registerMemory` for what is live. A tray may go in a registry of its own with
no ledger where a visit is not history (the ticker's desk, the wedding's session), and its
compartment says `ledger: false`: the kernel reports a write whose ledger entry disagrees with its
compartment, so a document left off the ledger by mistake (no undo could ever work) is caught.
Chat's session is on the ledger, so undo right after entering a room takes you out of it. A document is a root
row and the collections it includes, each a map of rows by id; two documents may include the same
rows, and delta's fan-out carries a write to every one that holds them. `defineSchema`,
`defineDoc` and their options (`include`, `implied` for a document that opens empty until its
first write, `temporal`) are delta's: its `delta-doc` skill
(`node_modules/@blueshed/delta/.claude/skills/delta-doc/`) is the reference.

A document module reads: `read<T>("<docType>:<id>")` from `src/documents.ts` gives the document
as held -- synchronously, from the copy kept current from delta's stream -- and throws `Pending`
if it is not held yet (the kernel loads it and draws again). Adapt the rows into what the views
want there (numbers for ids, a guest's look as one object), and put the pure rules beside it:
`after(state, ops)`, `shape(doc, ops)`, testable without a server.

- Address a row by its id, never its position: other people write between a write and its undo.
  Mint ids in `shape` (`Bun.randomUUIDv7()` is time-ordered, so the key is the order).
- A value a column cannot default in SQL (an object) is given in the schema's `default` and delta
  fills it in; the reader treats null as empty all the same.
- No migrations: `createTables` makes what is missing, and the seed runs into empty tables.
- `serverWrite(doc, ops)` is the server's own write -- no person, no cursor, never undone -- for
  what `changed` keeps. It goes straight to delta, so its paths are the document's own, not eta's:
  `at` is not added (`/desks/page`, `/quotes${path}`, not `/page`). Tests and scripts write as a
  person would through the same `shape` (the wedding's `setup.ts`).
- A page's reads go through `read()`. What goes to the tables directly is what no page reads as a
  document: what a live document is computed from (chat's rooms spoken in, the wedding's
  `everyone`), a credential looked up (a household's code), a blob (the wedding's pictures), and a
  rule `shape` checks across rows (how many have claimed a gift).

**The ledger** is delta's (`delta_ledger`): every write with its inverse, its version, who made it,
and the cursor undo walks -- the session. The kernel's ledger compartment takes `remove /latest`
(undo) and `add /latest` (redo) and asks delta to walk the session's cursor. Two limits, while
delta 0.6.0 applies an inverse as recorded (`examples/wedding/server.test.ts` pins both as
`test.failing`): an undo puts a row back as the write found it, over whatever anyone wrote to it
since; and no compartment is asked again, so a rule of time or state (the wedding's deadline)
does not hold against Undo. An undo whose inverse no longer applies (the row is gone) fails, and
the session's Undo stays on it.

## The wire

HTML is the only vocabulary. No JSON tree of app state.

- **A document is named whole: `<docType>:<docId>`** (`room:general`, `month:2026-09`), so one
  socket holds any number of documents, of any types. The exception is an `own` document (a
  session's session, ledger, desk): it is named by its type alone, since the id is a credential. A
  document keyed by a live session's id that is not `own` is refused by name, loudly.
- Client to server: `{doc, ops: [{op, path, value?}]}`. `doc` is a whole name, or a bare type
  meaning the one of that type this connection is on (`resolveDoc`). `path` is a JSON Pointer,
  never a verb.
  Anything that is not such a write, and a write whose handling throws, is answered as a refusal
  is: the page whole. A throw is reported through `failed()` (`src/failed.ts`), which fails the
  story it happened in.
- Server to client: `{type: "patch", doc, version, ops}`, `doc` named whole (what was applied;
  kept in `window.eta.docs()` under that name), then `{type: "render", html}` (the page) or `{type: "render", ops}`
  (the parts that changed).
- `{type: "inspect", limit?}` answers with the documents this connection sees and their latest
  ledger entries (delta's history). An entry says `mine: true|false`, never who.
- **A session id never goes on the wire.** It is the `session_id` cookie and a person's only
  credential. No echo, render, op value or inspect reply may carry one.

An element writes through `data-write='{"doc","op","path"}'`:

- a **form** writes on submit: its one field's value, or a record of several. It clears as it
  sends, and a refused write -- answered with the page whole, before any echo of the form's
  document -- hands back what was sent, into each field not typed in since. What is typed while a
  write is on its way is kept, whoever's echo comes;
- a **button or row** writes on click, with `data-value` if it has one. A click in a field never
  writes;
- a form with **`data-write-on="blur"`, `"change"` or `"input"`** edits in place: `data-write` goes
  on each field, and every field whose value differs from what was rendered becomes one op in one
  message. `"input"` is debounced ~150ms, flushed when focus leaves, and never repeats itself. A
  render that changes a field nobody is in shows the new value (an undo's), so it is not sent
  again; a field someone is in keeps what they type.

When the connection drops, the page stays as it was -- what is typed, what applets hold -- but
`inert`, and `#app` is marked `data-offline` (`src/bento.css` dims it and says so) until the
server, reached again, draws it afresh.

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
`boxPage`, `collectionPage`, `crumbs`, `cell`, `row`, `tool`, `pageTools`, `addTool`,
`findControl`, `readingSwitch`, `sheet`, `addModal`, `confirmModal`. A page is a **box** (`boxPage(trail, inPlace, cells, open?)`:
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
descends into `[data-applet]`, and nor does a render in parts: the applet's own element may be a
part (its tag, its props), nothing inside it.

```ts
export type Applet = {
  mount(el, { props, send }): void | (() => void); // cleanup optional
  update?(el, props): void;   // the element survived a render with new data-props
  patch?(el, ops): void;      // the ops of the document named in data-doc, as they are echoed
};
```

**An island** is an applet written as a railroad component (`@blueshed/railroad`): `island(render,
reduce?)` (`src/island.ts`) returns the `Applet`. `render(props, ctx, el)` gets its props as a
signal, reads what the server drew inside `el` (the ticker's zones, as `<option>`s) and returns
what replaces it; `update` sets the props, and `reduce(props, ops)`, when given, is `patch`. It
draws only inside `el` and never binds `el`'s own attributes -- they are the page's, the morph's to
keep. Write one where the applet builds and updates DOM by hand (the ticker's city picker); where
it draws HTML from a pure function that is tested on its own (the wedding's menu and dress), keep
that. A page with an island carries railroad, and the kernel's client does not (the README says
what each costs). Its file is `<name>-applet.tsx` (the tsconfig says
`jsxImportSource: "@blueshed/railroad"`).

Mount point: `<div data-applet="board" data-doc="quote:BRVO" data-at="/quote" data-props='{...}'>`,
the document named as the wire names it. Data reaches an applet as new props on a render
(`update`), or, for a document that changes often, as the patch itself (`patch`: an applet with a
`data-doc` is never sent its props again, since every change to its document reaches it as a
patch, so no HTML follows).

An applet that takes a document's patches holds that document in its props, whole, at `data-at`
(the root when not given), rows as delta holds them (their id and parent key included): the ops
must land on it, and say everything the document did. The stories check it -- each member's
applet props, as last sent with every patch since laid on, must be what a fresh render gives it.
Cut the document to what the applet shows: the ticker's board is a row applet per watched
symbol, each on that symbol's own document (`quote:<SYMBOL>`, a view of the market's row that
delta tells of every tick), so a board is told only the quotes it shows, and takes a tick as its
quote whole. An applet that held the whole market to draw a few rows would be sent every tick,
and its page would change for symbols nobody on it watches. Register in `client/main.ts` before importing
`src/client/app`. Split drawing (`<name>.ts`, pure, tested directly) from mounting
(`<name>-applet.ts`, the DOM, imported only by `client/main.ts`) when there is drawing worth
testing. `client/index.html` must have an element with `id="app"`.

**An applet's controls are drawn in the browser**, so the stories cannot find them in the page.
Its mount says what they write: `writes(doc, path)` (src/html.ts) puts `data-writes` on it, and a
story's write under that path counts as offered (the wedding's dress and menu).

## CLI

`src/cli.ts` knows `inspect`, `watch`, `undo`, `redo` and `write <doc> <op> <path> [value]`. An
example's `cli.ts` may export `aliases`, short verbs that build `{doc, ops}`. No database import:
the CLI talks to a running server over the same socket a browser does.

## When it looks like you need to touch `src/`

It usually means a seam is missing, not that the example is special. A per-example "may this
session write" is `Example.active`; an extra HTTP route is `Example.routes`; a fresh write that
differs from its undo is `shape` (undo is never shaped); what follows a write is `changed` or
`wrote`. Never teach the kernel the name of a specific document, applet
or compartment.
