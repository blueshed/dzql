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
- The page that sent the write is also answered `{type: "refused", id, reason}`, by the write's
  own id (see The wire): the refusal is that write's, whatever else was sent since.
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
  `serverWrite`, one run at a time, each after the last (`examples/chat/presence.ts`). Two runs at
  once diff the same copy, and delta refuses a remove or replace of what is not there (404), with
  the rest of the write: the second run's removes, and its adds with them.
- **`afterWrite(ws, docId, ops)`** runs after a fresh write from this person, with the ops as the
  page sent them: what follows for the writer alone. Leave closes the draft's drawer once it is
  asked for. The write has landed by then: a throw here is the server's failure, reported
  (`following a write to …`), never a refusal.
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

A part is a region of the page that can be sent alone, and it is the unit of a message: a change
goes as the smallest part that holds it, whole, with everything inside it that is not a part of its
own. So make what changes alone -- a row, a card, a count -- a part of its own. Name one with
`part(key, html)`, and its root element is tagged `data-eta-part="<key>"`. Chat's room:

```ts
part("people", `<ul id="people">…</ul>`),
part("messages", `<ul id="messages">${transcript.map((m) => part(`m${m.id}`, `<li id="m${m.id}">…</li>`)).join("")}</ul>`),
```

A message said goes as its one `<li>`, put in after the last, and someone arriving as the faces
in `people`; were the messages not parts, every message said would send the whole conversation
again. A keyed part may move from one parent to another (a stop to another day) and goes as that
move, not as either parent (todo n82, fixed in 0.50.0), so a row that moves can be a part too.

The bento's cells, the open window, rows with an id, lists given a key (`rows(items, empty, key)`)
and drawers are parts already. Name the rest (a strip, a list, a row, an applet's mount) where a
change should travel alone.

After a write the kernel draws each page again and sends what differs from what that page was
last sent:

- a part whose own tag changed and nothing inside it (a class, `inert`, an applet's props): its
  tag alone (`tag`);
- a part whose inside changed: replaced (`replace`, morphed in place);
- a list (a part whose rows are parts, in one run): rows put in (`after`, `before`) and taken out
  (`remove`). A list that was empty, or whose rows changed order, is replaced. A row may move from
  one list to another (a stop to another day): it is taken out of the one it left and put in the
  other;
- nothing, when nothing changed;
- the page whole only when its own outline changed: a different page.

Details:

- A key is unique on its page. The same thing drawn twice is fine; two different things under one
  key are no part, and what holds them is sent instead.
- A mount that watches a document (`data-doc`) is compared without that document and without what
  is inside it: its patches keep both. The rest of its props is compared, and goes as its tag when
  it changed (Applets, "the document it watches").
- Drawers and modals go through `layers(page, drawer, modal)` (`src/bento.ts`). There are two
  layers, each always there and empty when nothing is open: the ground (the page, with the drawer
  over it) and the modal's. Opening or closing one sends its layer, and a modal puts the ground
  `inert` by its tag. They are the bento's frame: while a modal is open, and below 820px a
  drawer, the page behind holds still; from 820px a docked drawer leaves it scrolling.
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
- **The socket is compressed** (permessage-deflate, which every browser offers; `src/server.ts`),
  each message on its own, so no memory is kept per connection: a page crosses at a sixth to a
  quarter of its size, a patch at about two thirds. It costs CPU for each page a message goes to,
  about 2 µs a KB up to 20 KB and 9 µs a KB past 32 KB (a 178 KB page, 1.6 ms), so a big page sent
  whole to many at once is the cost to watch. As with BREACH, someone who can put text on a page
  and watch the encrypted sizes of what it is sent can guess a secret drawn in the same message, so
  draw no secret (a code, a token) beside what others write.
- **A message in is at most 1 MiB, inflated** (`maxPayloadLength`): past it the socket is closed, so
  send a picture or a file by HTTP, never over the socket.

Messages:

- Client to server: `{id?, doc, ops: [{op, path, value?}]}`. `doc` is a whole name, or a bare type
  for the one of that type the page is on (`resolveDoc`). `path` is a JSON Pointer, never a verb.
  `id` is the sender's own, which the server only hands back: a number JSON can say, or a string
  of at most 64 characters (`LONGEST_ID`). The kernel's client numbers its writes from 1, and the
  harness gives every write it sends one.
- Server to client: `{type: "patch", doc, version, ops, id?}`, with `doc` named whole (what was
  applied; kept in `window.eta.docs()` under that name). The echo sent to the writer of the change
  its write made (an undo's or a redo's too) carries the write's `id`; everyone else's, and the
  writer's echo of anyone else's change, none. Then `{type: "render", html, wire}` (the page) or
  `{type: "render", ops}` (the parts that changed).
- A write that applies nothing -- refused, not a write at all, nothing to undo, a throw on the way
  -- is answered `{type: "refused", id, reason?}` when it carries an id (`reason` when `refuse`
  said why), then with the page whole. A throw is reported through `failed()` (`src/failed.ts`),
  which fails the story it happened in. A message whose `id` is not one (a longer string, an
  object) is not a write, and is answered by the page alone: nothing larger than an id goes back.
  A number JSON cannot say back (`1e400`, Infinity) is no id.
- `wire` on a page sent whole is the wire's version (`WIRE`, `src/json-patch.ts`: 2 since
  a write carries an id). A page from before ids sends none, and is answered as it always was: its
  writes echoed without one, a refusal by the page whole, and `refused` ignored, so a tab left open
  over a deploy keeps working. A page sent a page whole by a server of another wire (one from
  before ids, after a rollback) loads itself again, so page and server speak alike; not twice in a
  minute, when it draws the page and says so in the console.
- `{type: "inspect", limit?}` answers with the documents this page sees and their latest ledger
  entries (delta's history). An entry says `mine: true|false`, never who.
- `window.eta.inspect().lastSent` is the page's last write, `{id, doc, ops, echoed, refused,
  reason?, unanswered?}`: echoed only by its own echo, refused (and why) only by its own refusal,
  unanswered when its socket went first.

### Controls

A control says what it writes with `write(doc, op, path, value?)`, which gives
`data-write='{"doc","op","path"}'`:

```ts
`<form${write("room", "add", "/messages/-")}><input name="text" required>…</form>`
```

- A **form** writes on submit: its one field's value, or a record of several. A field has one
  type whatever form it is in: a box is `true` or `false`, a group of radios is one field, the
  value chosen or `null`, a `multiple` select its last choice or `null`, anything else its text.
  A record keeps every named field's key, so a value keeps one shape. It clears as it sends. Its
  write's own refusal (`refused`, by the write's id, before the page handed back) hands back what
  was sent, into each field not typed in since; its own echo ends the wait. What is typed while a
  write is on its way is kept, whoever's echo comes, and so is what a page sent whole for another
  reason finds there (someone else's write turning the page into another). A write on its way
  when the socket goes is unanswered: the page drawn afresh hands back what its form sent, as a
  refusal would (it may have landed, which that page then shows: better there twice than lost),
  and then each editing form says, once, any edit that page does not show -- one unanswered, or
  one the closed socket never took; one that landed is drawn, and not said again.
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
  it, nor a refusal hands it back. Escape (which presses the last `[data-escape]`) and the back
  button first say the editing form someone is in, as leaving its field would: a drawer's words
  are not lost with it, though WebKit fires no `focusout` for a field a render takes out.

Also:

- The stories count a control only where a person could press it: not drawn `disabled`, and not
  `inert`, `hidden` or in a disabled fieldset, itself or by what it is in. So a story told from a
  modal is done in the modal: the page behind it, inert, offers nothing. The page's address
  (`data-page-write`) is the URL bar's, not a control: a story that goes somewhere needs the
  button that goes there.
- When the connection drops, the page stays as it was (what is typed, what applets hold), but
  `inert`, and `#app` is marked `data-offline` (`src/bento.css` dims it and says so) until the
  server, reached again, draws it afresh. A write made while it is down is not sent, nor taken
  for sent: a form keeps what is typed, and an editing form says it once the page is drawn afresh.
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
- The stories put people at addresses with `Stories.goTo(address)`, and check they got there,
  and that a person could have: a story's `from`, and each place its `seen` names, must be one a
  control leads to from where the cast stands (a button whose `data-value` is the address, or a
  tap an applet's mount names). One nothing leads to fails the story: `no control leads okafors
  to "?guest=2"`. The URL and the back button are not controls: a place a person reaches by a
  link (an email, a shared URL) is put in the cast's own writes, where their ways start.

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
- The stylesheet imports `src/bento.css` first, then says its own tokens. `bento.css` draws the
  frame, what `layers()` draws: its buttons, fields and boxes are the bento's only in there, so
  every bento page is drawn in it (one nothing opens over is `layers(page, "", "")`, as chat's
  are), and the page outside it (`body`, `#app`, an old page) is the app's to style.
- `data-moving` names the element that grows (a view transition runs only when its own tag
  changes). `data-reveal` scrolls the chosen row into the clear.
- What opens is a button (rule 19): a cell's name is its button, and a row that taps is a
  `<button>`, so Enter and Space open them. An opener of the example's own is a `<button>` too
  (the wedding's bubbles), never a `div` with `role="button"`, which nothing opens from the
  keyboard; a figure in an applet's SVG says `role="button"` and answers Enter and Space itself.
  A row an applet draws is opened by a `<button>` of the page's over it, beside the mount and
  named by it (`aria-labelledby`), not around it: the mount then stands where it stood before
  the row could be opened, and keeps what it has drawn (the ticker's board, on the box and in
  the window).
  While a window is open the box behind it is `inert`, and the client keeps the keyboard with the
  cell as it opens and closes.
  changes). `data-reveal` scrolls the chosen row into the clear; one too tall for it, by its top.
- A render keeps the reader's place: in each scroller that is scrolled (the page, the bento's
  window), the first element below where reading starts stays where it was, whatever is taken
  out or put in above it, or under a sticky header -- but not while someone is pressing (a drag,
  a selection being made). Reading starts below any bar stuck at the scroller's top (position `sticky`
  or `fixed`, over the middle of its view), as the client measures it, and `data-reveal` lands
  below it too. A header the client cannot measure there is declared: `scroll-padding-top` on
  the scroller (`html` for the page) overrides the measure.

Escalate only as the data forces: in place, then the cell, then a drawer, then a window, then a
modal. A list of five needs no find.

## Applets (`src/applets.ts`)

An applet is client code that draws inside one element. Use one only for a piece of the page whose
state in the browser a redraw would destroy: a drag halfway through, a scroll position, a chart's
history. Everything else is HTML from `render`.

```ts
export type Applet = {
  mount(el, { props, send }): void | (() => void); // cleanup optional
  update?(el, props): void;   // new props: a render's, or its document's patch laid on them
  patch?(el, ops): void;      // the ops of the document named in data-doc, instead of update
};
```

- Register it in `client/main.ts` before importing `src/client/app`.
- The morph never goes inside `[data-applet]`, and nor does a render in parts: the applet's own
  element may be a part (its tag, its props), but nothing inside it.
- Split drawing (`<name>.ts`, pure, tested directly) from mounting (`<name>-applet.ts`, the DOM,
  imported only by `client/main.ts`) when there is drawing worth testing.
- `client/index.html` must have an element with `id="app"`.

### How an applet gets its data: the document it watches

An applet's data comes from a document it watches; its props say only what to show, and for whom.
The mount names the document and where it sits in the props, through `appletProps(props, watch?)`
(`src/html.ts`), the one helper that quotes props into an attribute, and `watch(doc, under)`
(`src/documents.ts`), which reads the document for the page and says the version it is held at:

```ts
// the wedding's photo of everyone: the `everyone` document, the family open in it, the names down or not
const props: CrowdProps = { everyone: everyone(), open: family, reveal: v.names };
`<div id="everyone-photo" data-applet="crowd"${taps}${appletProps(props, watch("everyone:1", "/everyone"))}></div>`
// gives data-doc="everyone:1" data-under="/everyone" data-v="7" data-props="{…}"
```

- **The props hold the document whole, at `under`** (the root when not given: the props are the
  document), as the page is told it: rows as delta holds them, by id, their parent key included.
  The rest is small: who is looking, what is open, a word to find by.
- **The kernel's client keeps them.** Each patch to the document is laid on the props at `under`,
  and the applet is given them again, `update(el, props)`: it draws from its props whether they
  came with a render or a patch, and needs no `patch` of its own (an island, no `reduce`). One
  that has a `patch` gets the ops instead, as before (the ticker's).
- **The mount says the version its props hold** (`data-v`, from `watch`), and a patch at or below
  it is passed over: the server's copy moves before its change is told, so a render drawn after a
  change can come before its patch. An op that then does not land is drift, and the page is asked
  for afresh.
- **It derives what it draws with a pure function, shared.** The applet runs it in the browser on
  each update; the server runs the same one for what the mount declares (`appletWrites`: the
  wedding's taps), for what the page says around it, and for a first paint inside the mount, so a
  test or a story sees what a person does. So it lives where both import it (`applets/<name>.ts`,
  pure, tested directly), never in the view alone.
- **A change to the document sends the mount nothing but the patch.** A page is compared with the
  watched document left out of the props, and nothing inside the mount: what the server draws in it
  is its first paint, and the applet's after. The mount goes again only when its own tag changes --
  its small props, a class, what it declares -- carrying the document as drawn then, or when a part
  holding it is replaced. So keep what follows where a person is off the mount where it can be
  (`aria-expanded`, a class), on an element beside it: the ticker's board row puts its button there.
- **The patches must say everything the document did**: the stories check that each member's
  props, as last sent with every patch since, equal what a fresh render gives.
- **A watched document is sent whole**, with the mount and in every patch, so watch one cut for the
  page's audience, holding no secret: the wedding's `everyone` (what households may see of each
  other), not the board, whose rows carry every household's code.
- **Each watching mount carries its own copy of the document**, paid once as it opens; only
  patches follow.
- **From props alone** (no `data-doc`) an applet is re-sent its props whenever they change, and
  draws from them (`update`). Keep that for props that are small, or that no document holds.

Cut a document to what its applet shows. The ticker's board is a row applet per watched symbol,
each on that symbol's own document (`quote:<SYMBOL>`, a view of the market's row that delta tells
of every tick). So a board is told only the quotes it shows, and takes a tick as its quote whole.
An applet that held the whole market to draw a few rows would be sent every tick, and its page
would change for symbols nobody on it watches.

When the app's document is one big one, cut the applet's from it in `delta.ts`: a second document
over the same rows, which delta tells of every write to them. A trip's strip shows the bases and
each stop's base, day and title, never the stops' notes or hearts:

```ts
const strip = defineCustomDoc<{ trip: string }>("strip:", {
  watch: ["bases", "stops"],
  parse: (trip) => ({ trip }),
  recompute: (db, { trip }) => ({
    bases: db.query("SELECT id, name FROM trip_bases WHERE trips_id = ?").all(trip),
    stops: db.query("SELECT id, bases_id, day, title FROM trip_stops WHERE trips_id = ?").all(trip),
  }),
});
registerDocs(delta.server, db, schema, [defineDoc("trip:", { root: "trips", include: ["bases", "stops", "hearts"] })], [strip], { ledger: true });
```

- A recompute document (`defineCustomDoc`, delta's skill, "Custom read docs") holds only what it
  selects, but delta reads it again on every write to a collection it watches and it is told
  whole, as `replace ""`: a note edited sends the strip, unchanged. Keep it small.
- Where the applet shows whole rows, a plain document over just their collections is told row by
  row: `defineDoc("strip:", { root: "trips", include: ["bases", "stops"] })`. It includes every
  column, so a note goes to it as its stop's row, and a heart, in rows of its own, not at all.
  delta's n70, a document over some of a row's columns, would give both: only what it shows, row
  by row.
- Either is read as any document is (`read("strip:1")`, `data-doc="strip:1"`), and has a
  compartment of its own that permits nothing: it is written through the trip.
  `src/documents.test.ts` holds both.

The harness warns, and does not fail, where props cost (`propsCost`, src/harness.ts; `bun run
stories` prints each once, under the first story that sent it):

- a mount whose own props, its document left out, pass 4 KB (`MOST_PROPS`): watch the document
  they come from;
- a mount sent again in parts with the props the page already had: with its tag, for something
  else on it (keep that beside the mount); drawn again for what the server paints inside it (let
  it watch its document, whose inside is not compared); or in a part drawn again around it for
  something else in it (make what changed there a part of its own, as the wedding's photo of
  everyone keeps its words in `everyone-note`).

#### What japan-eta's strip would change to take it

The strip (`views/strip.ts`, `applets/strip.ts`, `applets/strip-applet.ts`) sends `stripProps(t, me,
everyone)` -- the legs, the stops, who travels and their names -- as 5.2 KB of props, again with
every stop moved; the map (7.5 KB of pins) and the gestures do the same from the same trip. To
watch the trip instead:

1. `tripOf(doc)` (`documents/trip.ts`) moves where the browser can import it, a pure module of its
   own: `trip()` and the rules a write follows stay behind, with `read` and `refuse`.
2. `stripProps` moves beside `stripHtml` in `applets/strip.ts` (it needs only `lineColour` and
   `travellers`, both pure) as `stripOf({ me, people, trip })`: what the strip draws, derived from
   its small props -- `me`, and `people`, the travellers' names -- and the `trip:<id>` document as
   `read` gives it.
3. The mount says it, ``appletProps({ me, people, trip: doc }, watch(`trip:${t.id}`, "/trip"))``,
   in place of `data-props='${attr(...)}'`; `attr` goes (so do the map's and the gestures'
   `quoted`, n105). `stripHtml(stripOf(props))` stays its first paint, and its `appletWrites` stay:
   the server derives them from the same props.
4. `strip-applet.ts` derives on mount and on each update, `stripOf(ctx.props)`, and keeps what a
   drag holds as now; it needs no `patch`.
5. Then a stop moved, a day dragged or nights traded sends the strip nothing but the trip's patch,
   which the page is sent anyway. Its tag goes when `me` or a name changes, or a base comes or goes
   (its declared writes), carrying the trip as it stands. The map and the gestures take it the same
   way, on the same document.
6. The trip document is drawn whole into the page, so before it does, it must hold nothing a page
   must not carry beside what others write (an invitation's code); or the strip watches a document
   cut from the trip for it (`strip:<id>`, above), which holds only what it shows, and is told of
   every write to it: `under: "/strip"`, and `stripOf` reads that.

### An applet's controls

An applet's controls are drawn in the browser, so the stories cannot find them in the page. Its
mount says exactly what they write instead: a document, an op and a path each, where a segment
that is only `*` is any one member (an id the applet reads from its props), never `-`: an applet
that appends to a list names the `-` itself (`["trip", "add", "/events/*/party/-"]`). Reading a document
(`data-doc`) is not writing it: an applet that says nothing offers nothing (the ticker's clock
face), and its story fails, by name, until the mount says what it sends (the city picker beside
it, `appletWrites(["clock", "replace", "/tz"])`):

```ts
`<div data-applet="calendar"${appletWrites(["team", "replace", "/draft"], ["team", "replace", "/requests/*/starts"], ["team", "replace", "/requests/*/ends"])} data-props="…">`
```

- `appletWrites([doc, op, path], …)` (`src/html.ts`) puts `data-writes` on the mount, and a
  story's write that one of those names counts as offered, with any value (the wedding's dress
  and menu; leave's calendar, which writes a draft and moves requests).
- Name only what the applet sends. A write above, below or beside what it names is not the
  applet's, so a page that lost its own control for one (a drawer's Approve, under the
  calendar's requests) fails its story. An applet that can send nothing now names nothing (the
  wedding's menu once answers are closed), as a button that cannot is drawn `disabled`, which
  the stories count as no control.
- A write the applet sends with only one value, or a few, names them: `[doc, op, path, value]`,
  one each. That is how an applet says where it goes: the wedding's photo names each figure's tap
  (`["session", "replace", "/page", "?guest=2"]`), so a story may stand in the drawer it opens,
  as it may where a button with that `data-value` leads. The mount says each write once, its
  values together, since every page that shows the applet is sent it.
- A declaration that is not `[doc, op, path]` (the older `[doc, path]`) fails every story that
  meets it: `applet declaration must be [doc, op, path]`.
- The applet sends its writes with `ctx.send(doc, ops)`: a drag let go.
- A story says how a person works the applet's control, since the page cannot: `gesture: { drag:
  [from, to] }` (leave's `day("2026-10-06")` to `day("2026-10-07")`) or `{ press: selector }`.
  Done by hand, the drag is a mouse's pointer events, each sent to what is under the pointer:
  wrap `setPointerCapture` in a `try`, since a test's pointer is refused it (leave's calendar).

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
