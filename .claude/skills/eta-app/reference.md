# eta reference

How each piece works, one section a piece. Each section starts with what the piece is and when you
use it, then gives an example, then the details. `SKILL.md` is the order to work in, and
`first-app.md` at the root is the way in for someone new. The types in `src/` are the contract:
where this file and the code disagree, the code is right.

## The page

The page is one function: `Example.render(sessionId)` returns the whole page for one person, as
HTML. Chat's draws the name form, the rooms, or a room, depending on the session.

- It is the only renderer. It decides which screen, and reads whichever documents it must.
- A compartment looks after a document, not a place on the page.
- After a write, every page that read the document is drawn again, and sent only the parts that
  changed (see Parts).

## `Example` (`src/example.ts`)

An example is one app: its documents, its compartments and its page, exported from
`examples/<name>/index.ts`.

```ts
export type Example = {
  name: string;                       // tells it from another example object at runtime
  compartments: Compartment[];        // one per document type, the session's first; the kernel adds its ledger
  render(sessionId: string): string;  // the whole page
  active(sessionId: string): boolean; // may this session write at all right now?
  index: HTMLBundle;                  // served at "/" and at any path the kernel does not own
  delta: Local;                       // its documents: delta's backends on a createLocal()
  who?(sessionId: string): unknown;   // who a session is, to delta (the ledger's who, row-level security); default the session
  routes?: Record<string, ...>;       // extra HTTP routes; a kernel route of the same path wins
};
```

- `active` is there because only the example knows what "signed in" means. Chat's is "has a
  name"; leave's is "is signed in". A tab left open after signing out may not write, nor undo a
  write made before.
- `src/start.ts` runs `examples/${ETA_EXAMPLE}/index.ts` (default `chat`). One process serves one
  example.

### Signing people in

A session is anonymous until the example says who it is. Leave does it with an email and password,
and the password never crosses the socket.

1. The sign-in page is a plain `<form method="post" action="/login">`, with no `data-write`, so
   the client lets it post.
2. A route on `Example.routes` answers it. It refuses a post from another site (delta's
   `refuseOrigin`) and checks the password with `Bun.password.verify`, against a hash in a table
   no document includes.
3. For a good password it starts a **fresh** session (never the visit's own id), writes who it is
   into the session with `serverWrite`, and answers `303 /` with `sessionCookie(id)`
   (`src/server.ts`: the kernel's cookie and its attributes).
4. A wrong one is told on the page it came from: `tell(visit, { doc, path, reason })`, drawn by
   `reasonFor`.

Then:

- Who you are is the session's. The session's `permit` refuses changing it over the wire, but
  allows removing it: signing out, which every tab of the session hears.
- `who` gives delta the person, and `active` says whether anyone is signed in.
- An id is text, whatever the backend names a new row (a UUID on SQLite, a serial on Postgres).
  Never `Number()` one.
- `/ws` refuses a socket opened from another site. Allowed: no `Origin`, the page's own, or one
  listed in `ETA_ORIGINS` (comma-separated).
- In the stories, `signIn(name)` gives the route and form for a member of the cast. The harness
  posts it, and starts them from the page it signs them into.

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
  permitUndo?(ws, docId, ops): boolean;    // may it go ahead? omitted: always
  // after
  afterWrite?(ws, docId, ops): void | Promise<void>;  // after a fresh write, for the writer alone
  afterChange?(docId, ops): void | Promise<void>;     // after any change from anyone, undo included
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

### Saying why a write was refused

Throw `refuse(reason)` from `permit` or `shape` (`src/refusal.ts`), and the person is told why,
beside the control that sent it:

```ts
if (ends < starts) throw refuse("The last day is before the first.");
```

- The page draws the line with `reasonFor(sessionId, doc, path)`, where `doc` and `path` are the
  control's `data-write`. It gives `<p class="refused" role="alert">`, or nothing.
- The kernel keeps the reason in the session's own `refusal` document (in memory, off the ledger:
  a refusal is not something that happened) until the session's next write.
- A plain `false` refuses without a word. That is right for a write no control offers: there is
  nowhere to say why.
- Where the browser can refuse it first (`required`, `pattern`), let it.

### Undo is checked before it runs

The kernel asks delta what an undo or redo would write (in the wire's paths), and asks the
compartment's `permitUndo(ws, docId, ops)`.

- It is not `permit`: Undo may do what permit refuses (a message taken back).
- It is for a rule of time or state that holds against Undo too. The wedding refuses an undo that
  would set back an answer after the deadline: `refuse("Answers closed at the deadline.")`.
- An undo that meets someone else's later write changes nothing, and says so: "Someone has changed
  that since, so it cannot be undone."
- The kernel draws why an undo or redo was refused over the page (`.undo-said`), since Undo is its
  own tool.

### By kind

- `written`: on the ledger and undoable (a room's messages).
- `fact`: recorded, never undone (the ticker's ticks).
- `live`: held in memory and written by the server, never from the wire (chat's who is here).
- `sourced` and `static`: read, never written.

### After a write

- **`afterChange(docId, ops)`** runs after every change to the document, once it has been told:
  a write, an undo, another process's. Use it to keep a live document true (chat's presence and
  list of rooms, the wedding's `everyone`): compute it whole, and write the difference with
  `serverWrite`.
- **`afterWrite(ws, docId, ops)`** runs after a fresh write from this person, with the ops as the
  page sent them: what follows for the writer alone. Leave closes the draft's drawer once it is
  asked for.
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
- delta tells a change as the rows it leaves. A field replaced goes out as its row, whole
  (`replace /quotes/DLTA {...}`); a root field as the root (`replace ""` on a session's own).

## Parts: what is sent (`src/parts.ts`)

A part is a region of the page that can be sent alone. Name one with `part(key, html)`, and its
root element is tagged `data-eta-part="<key>"`:

```ts
part("messages", `<ul class="messages" id="messages">…</ul>`)
```

The bento's cells, the open window, rows with an id, lists given a key (`rows(items, empty, key)`)
and drawers are parts already. Name the rest (a strip, a list, a row, an applet's mount) where a
change should travel alone.

After a write the kernel draws each page again and sends what differs from what that page was
last sent:

- a part whose own tag changed and nothing inside it (a class, `inert`, an applet's props): its
  tag alone (`tag`);
- a part whose inside changed: replaced (`replace`, morphed in place);
- a list (a part whose rows are parts, in one run): rows put in (`after`, `before`) and taken out
  (`remove`). A list that was empty, or whose rows changed order, is replaced;
- nothing, when nothing changed;
- the page whole only when its own outline changed: a different page.

Details:

- A key is unique on its page. The same thing drawn twice is fine; two different things under one
  key are no part, and what holds them is sent instead.
- An applet on a document (`data-doc`) has the ops, so after a write to that document its props
  are not compared. After any other write they are, and go as its tag when they changed.
- Drawers and modals go through `layers(page, drawer, modal)` (`src/bento.ts`). There are two
  layers, each always there and empty when nothing is open: the ground (the page, with the drawer
  over it) and the modal's. Opening or closing one sends its layer, and a modal puts the ground
  `inert` by its tag.
- Make the page's outermost element a part too (the wedding's and the ticker's `.site`), so its
  class and its `data-page` go as a tag.
- The stories check the result: each member's page, rebuilt from exactly what they were sent,
  must equal a fresh render.

## Documents (`delta.ts`, `documents/<thing>.ts`)

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

### The ledger

The ledger is delta's (`delta_ledger`), and it is what makes Undo work. It holds every write with
its inverse, its version, who made it, and the cursor Undo moves along, which is the session.

- The kernel's ledger compartment takes `remove /latest` (undo) and `add /latest` (redo), and asks
  delta to undo or redo along the session's cursor.
- One Undo reverses one write to one document. If a gesture changes two documents, it takes two
  presses, so keep what changes together in one document (leave keeps a person's draft beside
  their requests for this reason).
- Before it runs, `permitUndo` is asked, and an undo that meets a later write by someone else is
  refused with a reason (see Compartment).

## The wire

The wire carries writes in, and HTML and ops out. There is no JSON tree of app state.

- **A document is named whole: `<docType>:<docId>`** (`room:general`, `month:2026-09`), so one
  socket holds any number of documents, of any type.
- The exception is a `perSession` document (a session, its ledger, a desk): it is named by its type
  alone, since the id is a credential. A document keyed by a live session's id that is not
  `perSession` is refused by name, loudly.
- **A session id never goes on the wire.** It is the `session_id` cookie and a person's only
  credential. No echo, render, op value or inspect reply may carry one.

Messages:

- Client to server: `{doc, ops: [{op, path, value?}]}`. `doc` is a whole name, or a bare type for
  the one of that type the page is on (`resolveDoc`). `path` is a JSON Pointer, never a verb.
- Anything that is not such a write, and a write whose handling throws, is answered as a refusal
  is: with the page whole. A throw is reported through `failed()` (`src/failed.ts`), which fails
  the story it happened in.
- Server to client: `{type: "patch", doc, version, ops}`, with `doc` named whole (what was applied;
  kept in `window.eta.docs()` under that name), then `{type: "render", html}` (the page) or
  `{type: "render", ops}` (the parts that changed).
- `{type: "inspect", limit?}` answers with the documents this page sees and their latest ledger
  entries (delta's history). An entry says `mine: true|false`, never who.

### Controls

A control says what it writes with `write(doc, op, path, value?)`, which gives
`data-write='{"doc","op","path"}'`:

```ts
`<form${write("room", "add", "/messages/-")}><input name="text" required>…</form>`
```

- A **form** writes on submit: its one field's value, or a record of several. A field has one
  type whatever form it is in: a box is `true` or `false`, a group of radios is one field, the
  value chosen or `null`, a `multiple` select its last choice or `null`, anything else its text.
  A record keeps every named field's key, so a value keeps one shape. It clears as it sends. A refused write (answered with the page whole, before any echo of the form's document)
  hands back what was sent, into each field not typed in since. What is typed while a write is on
  its way is kept, whoever's echo comes.
- A **button or row** writes on click, with its `data-value` if it has one. A click in a field
  never writes.
- A form with **`data-write-on="blur"`, `"change"` or `"input"`** edits in place: `data-write`
  goes on each field, and every field whose value differs from what was rendered becomes one op
  in one message. `"input"` is debounced about 150ms and sent when focus leaves. None of them
  sends the same message twice until a write lands; after that (an echo, an undo) it may. A render that changes a field nobody is in shows the new value (an undo's), so it is not
  sent again; a field someone is in keeps what they type. A select was rendered showing the last
  option drawn `selected`, else its first not disabled; it keeps a choice not yet drawn, by its
  value, however its options move, and otherwise shows what is drawn. A box was rendered ticked
  or not (`checked`), a group of radios with the value drawn `checked`; each goes only when what
  it holds differs, as it would from a form that creates. It keeps a tick not yet drawn (a
  radio's by its value, while its group offers it) and otherwise shows what is drawn. A
  `multiple` select is not a field here (a write carries one value): an editing form never sends
  it, nor a refusal hands it back.

Also:

- When the connection drops, the page stays as it was (what is typed, what applets hold), but
  `inert`, and `#app` is marked `data-offline` (`src/bento.css` dims it and says so) until the
  server, reached again, draws it afresh. A write made while it is down is not sent, nor taken
  for sent: a form keeps what is typed, and an editing form says it on its next commit.
- `autofocus` means "this field is waiting for the caret": after a render the client focuses it,
  but only when nothing else has the caret.
- `data-autoscroll` keeps a list at its foot as it grows.

## Where you are: the address (`src/bento.ts`)

Where a person is on the site is one string on their session: the address, `path?what=which`. It
is the page, and the one thing open over it: `guests?guest=2`, `gifts?new`, `?answer`, or leave's
`2026-10?request=1` (October, with request 1's drawer open).

- `address(path, what?, which?)` builds one, and `parseAddress(page)` reads one.
- Opening a drawer or a modal is going to the same page with it named. Closing it is going to the
  page alone. Going anywhere puts away what was open.
- Put the address in `data-page`, with the write that sets it in `data-page-write`, on any
  element of the page. The client mirrors it into the URL and sends the write on back and
  forward, so the back button closes a drawer and a link opens one. On first load the session
  catches up to the URL.
- The stories put people at addresses with `Stories.goTo(address)`, and check they got there.

## Pages: the bento (`src/bento.ts`, `src/bento.css`)

The bento is how a page looks and moves. Its rules are in `examples/bento/README.md`. Bind it once
per example, then build pages from what it returns:

```ts
const { collectionPage, drawer, confirmModal, tool } = bento({ icon, session: "session", leave: { text: "Sign out", icon: "log-out", path: "/person_id" } });
```

- `icon` is the example's own icon function. `session` is the docType that find and the reading
  switch write to. `leave` is the last of the page's tools.
- It returns `boxPage`, `collectionPage`, `crumbs`, `cell`, `row`, `tool`, `pageTools`, `addTool`,
  `findControl`, `readingSwitch`, `drawer`, `addModal`, `confirmModal`.
- A page is a **box** or a **collection**. A box (`boxPage(trail, inPlace, cells, open?)`) is
  cells in a tray, one of which may be grown into the window; its layout is computed by `grid()`
  (`src/grid.ts`). A collection (`collectionPage(trail, open)`) is the window alone.
- Every gesture is a `data-write` string you hand in.
- A modal is new or delete (rule 14), so there are two and no bare one. `addModal(title, fields,
  add, close, verb?, said?)` asks for a new thing: each `Field` is typed (`type`: `text`, `email`,
  `number`, `date` or `url`), or, given `options` (`{ value, text }`), chosen from a select, its
  `value` the option drawn chosen, else the first. A refused add hands back what was typed and
  chosen, with `said` beneath. `confirmModal` asks before a removal.
- `patchCollections(ui, op)` applies what find and the reading switch write (`/filter/<key>`,
  `/hide/<key>`, `/reading/<key>`).
- The stylesheet imports `src/bento.css` first, then says its own tokens.
- `data-moving` names the element that grows (a view transition runs only when its own tag
  changes). `data-reveal` scrolls the chosen row into the clear; one too tall for it, by its top.
- A page with a sticky header of its own says how tall it is: `html { scroll-padding-top:
  <height> }`. The client keeps no reader's place across a render; the browser's scroll anchoring
  does, on an element in the view, and without the padding the row hidden under the header is
  one. So a render that takes that row out slides the rows below it up under the header. With
  the padding the browser anchors below it, and `data-reveal` lands below it too.

Escalate only as the data forces: in place, then the cell, then a drawer, then a window, then a
modal. A list of five needs no find.

## Applets (`src/applets.ts`)

An applet is client code that draws inside one element. Use one only for a piece of the page whose
state in the browser a redraw would destroy: a drag halfway through, a scroll position, a chart's
history. Everything else is HTML from `render`.

```ts
export type Applet = {
  mount(el, { props, send }): void | (() => void); // cleanup optional
  update?(el, props): void;   // the element survived a render with new data-props
  patch?(el, ops): void;      // the ops of the document named in data-doc, as they are told
};
```

- Register it in `client/main.ts` before importing `src/client/app`.
- The morph never goes inside `[data-applet]`, and nor does a render in parts: the applet's own
  element may be a part (its tag, its props), but nothing inside it.
- Split drawing (`<name>.ts`, pure, tested directly) from mounting (`<name>-applet.ts`, the DOM,
  imported only by `client/main.ts`) when there is drawing worth testing.
- `client/index.html` must have an element with `id="app"`.

### How an applet gets its data: choose one

The mount point names it:

```html
<div data-applet="board" data-doc="quote:BRVO" data-under="/quote" data-props='{...}'>
```

- **On a document** (`data-doc`): its props hold that document, and every change reaches it as a
  patch (`patch`), so it is never sent its props again. Use this when the props are *only* that
  document. The document sits in the props at `data-under` (the root when not given), whole, with
  rows as delta holds them (their id and parent key included). The ops must land on it and say
  everything the document did: the stories check that each member's props, as last sent with
  every patch since, equal what a fresh render gives.
- **From props**: no `data-doc`. It is re-sent its props on every render, and draws from them
  (`update`). Use this when the props mix a document with where the person is: leave's calendar
  holds the requests, plus the month and the person's own draft.

Cut a document to what its applet shows. The ticker's board is a row applet per watched symbol,
each on that symbol's own document (`quote:<SYMBOL>`, a view of the market's row that delta tells
of every tick). So a board is told only the quotes it shows, and takes a tick as its quote whole.
An applet that held the whole market to draw a few rows would be sent every tick, and its page
would change for symbols nobody on it watches.

### An applet's controls

An applet's controls are drawn in the browser, so the stories cannot find them in the page. Its
mount says what they write instead:

```ts
`<div data-applet="calendar"${appletWrites(["team", "/draft"], ["team", "/requests"])} data-props="…">`
```

- `appletWrites([doc, path], …)` (`src/html.ts`) puts `data-writes` on the mount, and a story's
  write under one of those paths counts as offered (the wedding's dress and menu; leave's
  calendar, which writes a draft and moves requests).
- The applet sends its writes with `ctx.send(doc, ops)`: a drag let go.

### Islands

An island is an applet written as a railroad component (`@blueshed/railroad`):
`island(render, reduce?)` (`src/island.ts`) returns the `Applet`.

- `render(props, ctx, el)` gets its props as a signal, reads what the server drew inside `el` (the
  ticker's zones, as `<option>`s) and returns what replaces it. `update` sets the props, and
  `reduce(props, ops)`, when given, is `patch`.
- It draws only inside `el` and never binds `el`'s own attributes: they are the page's, the
  morph's to keep.
- Write one where an applet builds and updates DOM by hand (the ticker's city picker). Where it
  draws HTML from a pure function tested on its own (the wedding's menu and dress), keep that.
- A page with an island carries railroad; the kernel's client does not (the README says what each
  costs). Its file is `<name>-applet.tsx` (the tsconfig says `jsxImportSource: "@blueshed/railroad"`).

## CLI

The CLI talks to a running server over the same socket a browser does, with no database import.

- `src/cli.ts` knows `inspect`, `watch`, `undo`, `redo` and `write <doc> <op> <path> [value]`.
- An example's `cli.ts` may export `aliases`: short verbs that build `{doc, ops}`.

## When it looks like you need to touch `src/`

It usually means a seam is missing from what you know, not that the example is special:

- a per-example "may this session write" is `Example.active`;
- an extra HTTP route is `Example.routes`;
- a fresh write that differs from its undo is `shape` (undo is never shaped);
- what follows a write is `afterChange` or `afterWrite`.

Never teach the kernel the name of a specific document, applet or compartment.
