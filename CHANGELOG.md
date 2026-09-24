# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking (for example authors)

- **The stories check delivery, not only pages.** A story that passed may now fail, by name:
  - an `unseen` member told of any document -- sent a patch -- by the write, its undo or its redo
    (`cy was told of room:general, and should not have been`);
  - a `cannot` whose writer is not answered with the page (`refused, but ada was not answered`);
  - anything the kernel reports failing while the story runs (`the server failed handling an
    event: …`), so a refusal that is really a throw is no longer a refusal.

  To move across: a page is told every change to each document it reads, shown or not, so a page
  that reads a document it does not show leaks it by patch. Read only what the page shows, or cut
  the document by who reads it.
- **A document kept off the ledger says so: `Compartment.ledger: false`.** A write whose ledger
  entry disagrees with its compartment is reported as a failure: one registered in delta without
  `{ ledger: true }` whose compartment does not say `ledger: false` (no undo could ever work), and
  one that says it and is recorded all the same. To move across: add `ledger: false` to the
  compartment of each document you register without a ledger, as the ticker's desk and the
  wedding's session now do.

### Fixed

- **A message that is not a write, or a write whose handling throws, is answered.** A write must
  name its document (a string) and carry one op or more, each `add`, `replace` or `remove` with a
  JSON Pointer path (`""` or starting `/`); anything else -- not JSON, `ops` not a list, a `null`
  op, a path without its slash -- is refused like any refusal: the writer's page handed back.
  Before, each of those threw inside the server, was logged, and the writer heard nothing. A write
  whose `permit`, `shape` or `wrote` throws is reported (`failed`) and handed back too.
- **After an undo, a field shows the value undone to** (`src/client/morph.ts`). Once typed in, a
  field's value no longer follows its `value` attribute (nor a textarea's its text), so it went on
  showing the undone value, and an editing form (`data-write-on`), comparing it with what was
  rendered, sent it again on the next blur -- reverting the undo. A render that changes a field
  nobody is in now sets what it shows; a field someone is in keeps what they type.
- **A render in parts never reaches inside an applet** (`src/client/app.ts`). Its targets were
  found anywhere in the page, so a part inside an applet's element was replaced, or had rows put
  beside it, over what the applet drew. The applet's own element may still be a part.
- **A dropped connection leaves the page as it was** (`src/client/app.ts`, `src/bento.css`).
  It was replaced by "Disconnected. Reconnecting…", which threw away what was half typed and
  unmounted every applet (the ticker's sparkline histories, a half-dressed figure). Now `#app` is
  made `inert` and marked `data-offline` -- the bento dims it and says "Reconnecting…" -- until
  the socket is open again and the server draws the page.
- **`inspect` gives at most 100 entries a document**, however many it asks for: `limit: 1e9` asked
  delta for a document's whole history, and every event waited on the answer. A limit that is not
  a whole number is the default (the latest).
- **`write()` escapes its spec** (`src/html.ts`): the JSON sits in single quotes, and a `'` or `&`
  in it -- a path built from what someone typed, `/rooms/lobby' onclick='…/topic` -- ended the
  attribute and began another. Both are escaped now; nothing else in the output changes.
- **Two compartments owning one document type throw** when the example is assembled, naming the
  type (the kernel's own `ledger` among them). Before, the last silently won.

### Added

- **`failed(what, err)` and `onFailure(fn)`** (`src/failed.ts`): every failure the kernel catches
  -- a message, a drawing, a change being told -- is logged in one place and heard by whoever
  listens. The stories harness listens.

## [0.47.0] - 2026-09-24

### Breaking (for example authors)

- **eta keeps every document in delta.** `@blueshed/delta` is a dependency, and `Example.delta`
  (the example's backends registered on a `createLocal()`) is required. The kernel keeps a copy of
  each document a page reads, kept current from delta's one stream of changes, and draws
  synchronously from it: `read("<docType>:<id>")` (`src/documents.ts`) gives a document as held,
  and a read of one not held yet throws `Pending` -- the kernel loads it and draws again
  (`settled()`). A write goes to delta as the person (`Example.who`, optional, default the
  session), with the session as the cursor undo walks; the ledger is delta's. eta needs
  `@blueshed/delta` 0.6.0 (from npm): `createLocal`, documents that are `implied`, and the
  ledger's undo, redo and history are all new there.
- **Gone from the kernel:** `migrate()` and the kernel's migrations, `src/ledger.ts` (its naming
  helpers `prefixDoc` and `splitDoc` are in `src/names.ts`), `Compartment.write`, `notify`,
  `renderRequested` and the event bus (`src/compartments/bus.ts`), and `MIGRATIONS_DIR` (from
  `.env.example` too). Every change is told from delta's stream, never by hand.
- **The `Compartment` contract.** `write` is gone; a compartment permits and shapes, and delta
  writes. New: `own` (its documents are keyed by the session id: seen by that session alone and
  named by type), `kind` (`written`, the default; `fact`, `live`, `sourced`, `static`), `at` (where
  eta's paths sit in the document, `/sessions`), `shape(ws, docId, ops)` (the wire's ops as the
  document takes them, for a fresh write only; shaping to nothing refuses the write), `changed(docId,
  ops)` (after any change is told: keep a live document true) and `wrote(ws, docId, ops)` (after a
  fresh write from this connection: what follows for the writer, such as putting a modal away).
  `permit` is optional (omitted, nobody may write) and is given the document's id.
- **A document is named whole on the wire**, `<docType>:<docId>` (`room:general`), in every echo, in
  `inspect` and in `window.eta.docs()`, so one socket holds any documents. A bare type still means
  the one this connection is on (`resolveDoc`). A session's own documents are marked `own` and go
  by their type alone, since the id is a credential; a document keyed by a live session's id that
  is not `own` is refused by name.
- **A connection sees what its page read.** `Compartment.sees` is gone: while the kernel draws a
  page it keeps every document the drawing read, and those, with the one of each type it is on,
  are what the connection is told about and may write. Cut documents by who reads them.
- **A page is sent in parts.** `Compartment.fragments` is gone. A render names its regions with
  `part(key, html)` (`src/parts.ts`); the bento's cells, rows, keyed lists and drawers are parts
  already. After a change the kernel draws each page that read the document again and sends what
  differs: a part replaced, its tag alone (`tag`), a row put in (`after`, `before`) or taken out,
  nothing when nothing changed, the page whole only when it is a different page. The render ops'
  `add` is gone. The bento's `inertWhile` is replaced by `layers(page, drawer, modal)`: opening a
  drawer or a modal sends its layer, not the page.
- **Echoes are delta's.** delta tells a change as the rows it leaves: a field replaced goes out as
  its row, whole (`replace /ALPH {...}`), and a field of a document whose root is one row as the
  root (`replace "" {tz}`). An applet that takes a document's patches (`data-doc`, named whole)
  holds the document in its props as delta holds it, rows and all, at `data-at`.

#### Moving an example across

The examples are demos, and their data is not carried over: each example's tables are now named
`<example>_...` (`chat_messages`, `wedding_guests`), made fresh and seeded. The old tables are
left in the database as they were, and nothing migrates them. Compare the ticker's port
(`git diff 63cad94 HEAD -- examples/ticker`) with these steps.

1. Replace `migrations/` and `db.ts` with a `delta.ts`: the schema (`defineSchema`, tables named
   `<example>_...`), `createTables` against `src/db`'s `db`, a seed run into empty tables, and the
   documents on a `createLocal()` -- `registerDocs(..., { ledger: true })` for what is written and
   undone, `registerMemory` for what is live, and a registry with no ledger for a tray whose visits
   are not history. Export it and set `delta` on the example. Chat's, the ticker's and the
   wedding's are the pattern; delta's `delta-doc` skill says how to write the schema and documents.
2. A document module reads through `read("<docType>:<id>")` and adapts delta's rows into what the
   views want; it keeps its pure rules (`after(state, ops)`) beside it. A page's reads all go this
   way. Reads that go to the tables directly are the ones no page reads as a document: what a live
   document is computed from, a credential looked up (a code), a blob (a picture), a rule checked
   across rows.
3. Mark every compartment whose documents are keyed by the session id `own: true` (a session, a
   desk, a watchlist, a clock). Give a compartment `at` where its fields sit under the document's
   root (`/quotes`, `/watchlists`, `/clocks`), so the wire keeps its short paths. A write that was
   recorded as not undoable is `kind: "fact"`; a document the server keeps is `kind: "live"`.
4. A compartment's `write` becomes `shape`: validate, trim, mint an id (`Bun.randomUUIDv7()`),
   turn a nested wire path into the rows it moves, and return the ops; return nothing to refuse.
   Undo and redo are delta's inverse, never shaped, so any replay-only branch goes.
5. What followed a write by hand (`notify`, a render request, a presence broadcast) becomes
   `changed` (keep a live document true: compute it whole, write the difference with
   `serverWrite`) or `wrote` (what follows for the writer alone, such as closing the modal that
   asked). `serverWrite` goes straight to delta, so it takes the document's own paths, not eta's:
   `/desks/page`, `/quotes${path}`.
6. Drop `sees` and `fragments`. Name the page's regions with `part()` where a change should travel
   alone, and name documents whole wherever the page or an applet names one.
7. Replace `inertWhile(open, page)` with `layers(page, drawer, modal)`, so a drawer or a modal
   travels as its own layer.
8. An applet that takes its document's patches: name the document whole in `data-doc`
   (`ticker:market`), say where its props sit in it with `data-at` (`/quotes`), give it the rows
   as delta holds them, and have `patch` take delta's row-shaped ops -- a quote replaced whole
   (`replace /ALPH {price, prev, ...}`), a one-row document replaced at its root
   (`replace "" {tz}`) -- not a single field. The stories check that the ops land.

### Changed

- **Events are handled one at a time, in order**, each done when what it set going is; **changes
  are told one at a time, in order**. A failing event, drawing or change listener is logged and
  the next goes ahead.
- **Chat, the ticker and the wedding keep their documents in delta**, each with a `delta.ts`
  (schema, seed, documents) in place of its migrations. Chat's sessions and rooms are written, who
  is here and the list of rooms are live. The ticker's market is a fact, never undone; a watchlist
  and a clock are written; the desk is kept with no ledger. The wedding's documents are cut by who
  reads them -- the couple's `board`, a `household`, the `wedding`'s lists, the `welcome`, and a
  live `everyone` (who stands in the photo, and how many have claimed each gift) -- so a household
  is never told another's email or code. The wire and every story sentence are unchanged.
- **`inspect` lists every document a connection sees**, with delta's history for each.
- **The stories check the patch stream**: each member's applet props, as last sent with every
  patch since laid on, must equal what a fresh render gives. It found three faults in the ticker's
  board and city picker, now fixed.
- **Every measured cost went up** since 0.46.0 (README, "What a write costs"): a chat message is
  1,111 B to each other member (was 425 B), a tick 186 B (was 104 B), and a household a change does
  not concern is sent 302 B (was nothing). Why: delta tells a change as the whole row it leaves,
  not the field; a row's time-ordered id, 36 characters, is written three times in each list row
  sent; chat's window of 50 messages slides on every message (the oldest taken out, the
  new first one redrawn, the new one put in -- nothing is sent twice, and 0.46.0's append-only
  fragment was wrong); and the wedding's other households now read the public `everyone` document,
  so they are told its changes (the photo's one changed figure, with no HTML).
- **The release gate is named**: `bun run check` (`tsc --noEmit`, now clean), `bun test` and
  `bun run stories:all`, run by the shared `/publish` (`.claude/commands/publish.md`). The eta-app
  skill carries a `version:` line for it to stamp.
- **Docs**: the README is for someone deciding whether to use eta; the eta-app skill, its
  reference and `CLAUDE.md` describe the kernel on delta. The kernel, `CLAUDE.md`, the README and
  the skill no longer point at notes outside the repository.

### Fixed

- **An earlier example's copy of the documents still told changes**, so a later server over the
  same delta echoed each twice. Only the active example's copy tells now.
- **Stopping one server of an example cleared it for the servers still running.** It is cleared
  when its last server stops.
- **`inspect` gave every entry the id 0.** It gives the ledger entry's own.
- **Chat's room grew past its 50 messages** on an open page, since the hand-written fragment only
  appended; parts take the oldest out.

## [0.46.0] - 2026-09-17

### Changed

- **Where you are is one address.** `path?what=which`: the page, and the one thing open over it
  (`guests?guest=2`, `gifts?new`, `?answer`). The wedding's session kept a page and six fields for
  drawers and modals (`focus`, `gift`, `keep`, `answering`, `new`, `confirm`), four of which could
  never be open together; the ticker's desk kept four. Each keeps one string now, plus find.
  Opening a drawer is going to the same page with it named; closing it is going to the page
  alone. The address is what goes in the URL, so the back button closes a drawer and a link opens
  one -- the ticker has that now too. `address()` and `parseAddress()` are the kernel's
  (`src/bento.ts`); the bento's `addTool`, `addModal` and `confirmModal` are handed their open and
  close writes instead of assuming `/new` and `/confirm` on the tray. Cancelling a removal goes
  back to the drawer it was asked from.
- **The stories that only moved the tray are gone**: 17 of the wedding's (63 to 46) and 8 of the
  ticker's (23 to 16). They opened a window, a drawer, find or a modal, nobody else saw it, and
  they could not fail -- one, "Grace claims the kettle from its drawer; the couple see it
  claimed", was false and passed. What they drew is still covered by each example's server test.
  The ticker gains the story its stale drawer never had: a tick while a symbol's drawer is open
  moves the drawer's price.
- **The reference is a third of its length** (4,700 words to 1,700): one short section a piece,
  the contracts as they are now, no history.

## [0.45.0] - 2026-09-17

### Changed

- **One `write`.** `Compartment.replay` was `write`'s near-copy in all six implementations.
  `write(ws, docId, ops, undoes?)` is the one path: fresh from the wire, or the ledger walking an
  entry back or forward. What a compartment does to a fresh value it does only when `undoes` is
  undefined.
- **One `notify`.** `notify(docType, docId, result, {echoTo?, renderTo?})` replaces the four
  hand-written ways a write was told: each tray's own patch-and-render, the wedding's two copies
  of `echoAndNotify`, chat's presence. A tray's audience is its session's own tabs, so a second
  tab is no longer left stale by a tray write.
- **One `render`.** `Example.render(sessionId)` is the whole page. A compartment owns a document,
  not an element: `Compartment.render`, the first-one-wins chain, the `<div id="c-<docType>">`
  wrapper with its `display: contents` rule, and the middle tier that re-rendered "the owning
  compartment's element" (which, with one rendering compartment per page, was the page) are gone.
  A write is answered with what `fragments` says changed, or with the page. `Example.tray` is gone
  too: the session's own document is a compartment like any other, listed first.
- **The harness waits without a clock.** It waited for 40ms of quiet after a write, and a render
  that was slow to make arrived after it (the ticker's stories failed two runs in three). Each
  member is asked a question on their own socket instead; their answer comes after all that was
  sent before it. The wedding's 63 stories run in about three seconds.

## [0.44.0] - 2026-09-17

### Changed

- **The stories check what each person was sent, not only the tables.** The harness keeps every
  member's open page as the client would -- a full render replaces it, a fragment is applied to
  its target (`HTMLRewriter`) -- and after a story, its undo and its redo that page must equal a
  fresh render. Canon 2, without a browser. The wedding passed as it stood, 63 of 63.

### Fixed

- **The ticker's page went stale in three more places**, all hand-kept lists of fragment targets:
  watching a symbol left "nothing watched yet" on the board; choosing a city left the old one on
  the clock's compartment and in its drawer. A watchlist or clock write is answered with the page
  now; the applets, being a morph boundary, keep what they hold.
- **Someone choosing a room was never told the list had changed** when a coming or a going made a
  room or took the last person out of one.
- **A view transition ran whenever anything inside an open window changed**, and swallowed the
  keys of whoever was typing in it. A move is the element itself changing -- its own tag -- not
  what is in it.

## [0.43.1] - 2026-09-17

### Changed

- **A bare `bun test` is the right command.** `.env.test` keeps the tests off the dev database and
  stills the ticker's feed; `bunfig.toml` turns coverage on and fails the run below 100%, so the
  aim is a gate. `bun run stories` reads the same `.env.test`.
- **The kernel's coverage no longer leans on an example being wrong.** The harness's excerpt was
  only reached when chat failed an undo comparison; a deliberately false refusal in the harness's
  own test reaches it now.
- **`bun run start` runs in production mode** (it ran with HMR and stack traces before), and
  **`bun run stop` stops whatever is listening on `PORT`**. `src/pid.ts` is gone: every dev script
  shared one pid file, and its test deleted the real one.

## [0.43.0] - 2026-09-17

### Changed

- **The bento's surfaces are the kernel's.** The trail, the tray and its compartments, the
  window, the stacks of tools, find, the rows, the drawer and the modal were written three times,
  with their CSS and the reading/find/eye tray state beside them. They are `src/bento.ts` (bound
  once per example: `bento({icon, tray, leave?})`), `src/bento.css` (imported first, then the
  example's own tokens), `src/html.ts` (`esc`, `write`, `join`) and `patchCollections`. A page is
  a box (`boxPage`) or a collection (`collectionPage`). The wedding and the ticker are rebound to
  them; the wedding's tests pass unchanged.
- **Chat is three steps again: your name, a room, say something.** 0.42.0's box of three
  compartments, with its drawers, modal, find and eye, had stories written after it to cover it.
  The stories are the source again -- the six real ones in the order of the intent, the two steps
  that had none (giving your name; naming a room nobody has made) and the refusal of a blank room
  name, ten in all -- and chat is what they need: two pages, each a collection, the HTML in the
  compartment, a session that is a name and a room. `migrations/0003_ui.sql` is gone.
- **A room is where someone is or something was said.** Entering a room nobody had made was two
  changes and undo took back one, which the reclaimed stories found on their first run; nothing
  makes a room now, and the `rooms` table is dropped (`0003_rooms_are_where_people_are.sql`).
- **Bento rule 2: inside a window the trail is whole**, one crumb longer, every earlier crumb a
  way back, so opening something never loses the root. The kernel and the mock-up draw it.
- **Say a thing once.** `CLAUDE.md` states it for any list: what an item shares with the one
  before it is said at the start of the run, and what is true of the person looking is not said
  to them. Found by giving clean agents only the docs and chat's stories, three times over: they
  built the three steps every time, and repeated a name on every bubble until the rule was written.
- **Docs: one home per fact.** `CLAUDE.md` is the rules a builder must not break, stories first;
  the eta-app skill makes the story step 0; the reference loses its duplicated vocabulary, its
  citations of finished request items and the statements the code contradicted; `stories.md` says
  what the harness checks and the four things it does not yet. `change-request.md` and
  `bento-request.md`, both done, are in `history/` beside a first-principles review
  (`history/review-2026-09-17.md`) whose proposals are open.

### Fixed

- **The harness and an author who goes by undoing.** Undoing the write that gave you your name
  logs you out; redo is then not yours to press, and the harness no longer asks for it.
- **A click in a field that carries `data-write` sent a blank write**, emptying find's word on the
  server while the box still showed it. A field's `data-write` names its path; it is not a gesture.
- **A household could give itself unlimited plus-ones** by sending the whole-row shape an inverse
  carries (`named_by: "couple"`), or two adds in one message. The wire may name a plus-one or an
  ask and nothing more; the rest reaches the document through `replay()` alone.
- **`inspect` told everyone in a room each other's session id**, which is the cookie and a
  person's only credential: anyone could become anyone who had spoken. A session id never goes on
  the wire now; an entry says `mine: true|false`, and names its document by docType alone.
- **A field waiting with `autofocus` never got the caret after the first page**, since a browser
  honours it once per document. After a render the client focuses it, when nothing has the caret.
- **The root's name sat against the trail card's edge** and jumped 8px when the trail grew.
- **The ticker's open drawer went stale** on a tick, and on watching from it: with a drawer open
  the compartment is redrawn whole rather than by a hand-kept list of targets.

## [0.42.0] - 2026-09-16

### Changed

- **Chat is a box (bento-request.md C1-C3).** The room is the ground: a tray of three
  compartments -- the conversation, big, with its last lines as the small reading; the people,
  as faces; the rooms, with the one you are in -- each growing into the window, its tools on the
  rail, undo, redo and log out one stack at the bottom right (across beside the trail on the box).
  Entering a room opens the conversation, since that is what you came for. A person is a thing:
  a row opens their drawer, and your own drawer is where you change your name. A new room is the
  plus and a modal asking its name; the room picker applet, and the morph test that used it as
  its specimen, are gone, since the rooms are rows now and chat has no applets. Find on the
  conversation and on the rooms, with the tally and the eye. The session keeps the tray's state
  in a `ui` column (`examples/chat/migrations/0003_ui.sql`), never on the ledger; re-entering the
  room you are in is a no-op rather than a recorded write. Seven new stories, thirteen in all.
- **The ticker is a box (T1-T3), and gets a tray.** The desk: the board, big, with two readings,
  the applet's sparklines and a list of rows; the market, every quote a row, with find and the
  eye; the clock, a thing whose drawer holds the city picker. A row's drawer holds what a symbol
  is and what it carries -- watch, or stop watching -- and both ask in a modal, the plus on the
  board's rail and a confirm. `documents/desk.ts` is the tray, a session's own with no sign-in
  behind it (`migrations/0003_desks.sql`); `inspect` now lists it first. A tick still costs 104
  bytes on the box; a session reading the market's rows or the board as a list has those rows
  redrawn. Ten new stories, twenty-three in all.
- **A modal closes on the write that answers it (rule 14)**, in all three examples: watching
  closes the ask, dropping closes the confirm and the row's drawer, adding a guest or a course
  closes the add. The wedding's modals stayed open until now.
- Each example's stylesheet is the same design in its own palette and type: chat's green ink on
  paper, light and dark; the ticker's dark screen with amber for the one accent.

## [0.41.0] - 2026-09-16

### Changed

- **The wedding drawn as the mock-up draws it, every screen reviewed.** After Sonnet's W1-W5
  the pages honoured the rules in prose and not in look, so this is one design pass by Fable over
  `examples/wedding/views/*` and `client/styles.css`, with `examples/bento` open beside it as
  the reference for every measurement. The window is the screen less a margin (24px, 8 on a
  phone), as the mock-up's is -- W5.1's "the tray's rectangle" was a wrong reading of the mock-up
  and is gone -- and its trail floats top-left as a control: the box it came from, ›, its name.
  The rail at the right holds stacks of 32px square buttons: the reading switch, then find and
  the plus; the page's tools are one stack at the bottom right of the window, and across beside
  the trail on the box. Every reading keeps clear of them (72px 80px 96px 24px, the mock-up's
  own), photos included. One row grammar for every list (`views/bento.ts`'s `row()`: a lead, the
  words, the state in small caps, the mark), one property grammar for every drawer (`prop()`),
  one choice control (`choice()`, `.pick`), one modal with as many fields as it needs
  (`addModal()`): the eleven `.row-line` variants, `.pill`, `.coming-pills`, `.seg`, `.tool-form`,
  `.foot-tools`, `.cell-tools`, `.field-row`, `.dish-row` and the rest are gone, and the
  stylesheet is rewritten as tokens, base, controls, stack, trail, tray, window, rows, drawer,
  modal, then the drawings untouched.
- **The guests are a compartment that opens.** The family photo is the guests' small reading on
  the box, still; the compartment grows into the window with the photo or the list, its plus and
  find on the rail. The couple's home shows the families the same way, and a family's box its
  own; the code on a family's box is a thing (rule 15) whose drawer holds the email, the
  plus-ones and the way to chase them. Inviting is the plus and a modal of three fields, off the
  rail. What a row carries -- claim, coming, shared -- is a choice in its drawer. The couple's
  households list carries a household's waiting asks as a note on its row; the asks themselves
  are answered in the family's own asks window.
- **The eye (rule 17).** Find's field carries the tally and an eye: pressed, what the word misses
  is hidden instead of dimmed (`/hide/<key>` on the session, never on the ledger; closing find
  forgets it with the word). Three stories, and `documents/session.ts` tests it.
- **Fragments follow the guests into the window.** `compartments/household.ts` replaces the
  family photo or a guest's row in the guests window, the small reading on the box
  (`#family-mini`, `#board-mini`), and the open drawer's dress and menu wherever the drawer is.

### Fixed

- **The kernel's View Transition no longer throws when interrupted.** `src/client/app.ts` marks
  the transition's `ready` and `finished` promises handled: a second render arriving before the
  first has settled skips the animation, which is routine, and was surfacing as an unhandled
  `InvalidStateError` on every quick pair of renders.
- Every square button on a rail says its word to a screen reader (`aria-label`).

## [0.40.0] - 2026-09-16

### Changed

- **Rule 17 rewritten, after the filter: the eye.** `examples/bento/README.md`'s rule 17 and
  `bento-request.md`'s W4 no longer say the filter "never hides" -- find still dims by default,
  but an eye beside the field hides what misses instead, for a long list, and the tally still
  counts all; closing find still forgets both. `bento-request.md` gains W5, the five findings
  Fable's review of the 0.39.0 preview left: the window's shape (rules 7/18), the reading's
  clearance, the page's tools floating outside the tray, the rails not stepping aside for the
  drawer (the rule 18 finding this review answers), and the eye itself.

## [0.39.0] - 2026-09-16

### Changed

- **W1: the wedding's look, `bento-request.md` rules 9 and 11 and rule 18's second half.** One
  family of corners across `examples/wedding/client/styles.css` -- a button inside a control 4px,
  a control 6, a thumbnail 8, the drawer and the modal 20, the tray and the window 28 -- and every
  `border-radius: 999px` is gone (the base `button`, `.seg`, `.tool`, `.pill`, `.choice`,
  `.sheet-close`, `.chase-link`). Every shadow tints toward the ink (`--ink-rgb`, navy, not black).
  `views/bento.ts`'s `pageTools()` is the one place undo, redo and leave are built now -- no call
  site constructs the trio by hand any more -- and it floats as a `.stack` (a bordered box of
  square icon buttons, Leaflet-control style) at the bottom right of the tray, over the
  compartments, Leave set apart by a rule; `boxPage`'s and `collectionPage`'s own `tools`/`extra`
  parameters carry only what is left (a plus-one to name, a household to chase). A collection's
  own tools -- the reading switch, what adds -- move to `.rail.work`, a floating rail at the
  page's right edge in the same style. The panel overlaps: the `main#app:has(.sheet)` padding rule
  is gone, so the tray keeps its shape whatever is open; the sheet's desktop shape takes radius 20
  and the corner family. `::view-transition-group(moving) { z-index: 1 }` is in the stylesheet
  now, ready for W3. Nothing on the wire changed; all 51 stories and the coverage table stay as
  they were.
- **W2: the drawer and the modal, rules 13, 14 and 15.** A figure shows it is chosen while its
  drawer is open: `aria-pressed` and a lit line across a guest's or a gift's row
  (`.row-line[aria-pressed="true"]`), a ring around a chosen figure in the photo
  (`applets/photo.ts`'s new `PhotoEntry.chosen`, an `<ellipse class="ring">`), and `data-reveal`
  (K2) so the chosen one scrolls into the clear beside the docked drawer. What a guest carries --
  coming -- moves into their drawer as one control, off the row; the couple's welcome becomes a
  "thing" compartment of its own (`views/board.ts`'s `welcomePreview`/`welcomeSheet`), carrying ✎
  and lighting while its drawer (the same `answering` key a household's own answer already used)
  is open, its names, day, venue, picture and words all edited there instead of inline on the box.
  Adding a guest, a gift, an ask, a course, an event or a place is now the plus on its collection's
  rail (`views/bento.ts`'s `addTool`) and a modal asking one question, the name
  (`addModal`/`modalShell`, a `<dialog open class="modal">` with its own scrim, since the kernel's
  client learns no `showModal()` call); removing a kept row asks in a modal too
  (`confirmModal`, `views/board.ts`'s `confirmRemove`). While a modal is open the page behind it is
  `inert` (`views/shared.ts`'s `inertWhile`) and, on a phone, held still (`frame()`'s new `locked`
  parameter sets `.site.locked`, read by `body:has(.site.locked) { overflow: hidden }`, since the
  render owns no element of `body` itself). A new session key, `new` (which collection's add-modal
  is open) and `confirm` (`"<table>/<id>"`, which removal is being confirmed), neither on the
  ledger. `stories.ts`'s `at` now turns any `key.sub=value` into `/key/sub`, not only `reading.`.
  Four new stories (`bento-request.md`'s own), and the existing claim, keep, answer and welcome
  stories retold where a drawer is now the way. `examples/wedding/views/photo.ts`'s unused
  `photoApplet` (dead since nothing called it) is gone, closing that file's own pre-existing
  coverage gap; `household.ts`'s pre-existing gap closes too, mostly by giving the asks list (an
  untested "waiting"/"yes"/"no" row) real coverage in `server.test.ts`.
- **W3: open in place, rules 7, 8, 10 and 12.** `views/bento.ts`'s `collectionPage` is gone;
  `boxPage` takes an `open?: OpenOptions` instead, and for the compartment it names, substitutes
  the tray cell's own element for one holding the reading, its rail and a note (`.cell.open`) --
  the other cells go behind it (`.cells.has-open .cell:not(.open) { display: none }`). `cell()`
  carries `data-moving` on every navigable compartment now (K1), keyed by the page value it opens
  under, which a `CellOptions.key` override keeps equal to the tray's own grid-area identity when
  a compartment's label reads differently from its page ("the day" is page `day`). The couple's
  own household box (`familyBox`) grows its own "asks" compartment the same way, one level down.
  The reading scrolls under the rail and the page's tools (`.cell-open-body`'s own scroll, 15rem
  clear of the rail unless a photo reading runs under it). No page value's meaning changed and no
  story's `does` did either.

  Opening this up to more than one candidate compartment at once broke K1's own assumption that
  at most one element on the page ever carries `data-moving` -- `src/client/app.ts`'s
  `movingElement()` grabbed the *first* `[data-moving]` match unconditionally, which silently
  named the wrong element (typically one about to go `display: none`) and threw
  `InvalidStateError: Transition was aborted because of invalid state`. Fixed in the kernel:
  `movingElement()` now checks every current candidate and picks the one whose matching element in
  the render actually differs, since a still-closed sibling's markup renders byte-for-byte
  unchanged whether or not another compartment opened. `src/client/app.test.ts` gained a story for
  it: three siblings all carrying `data-moving`, only the one that changed gets named.
- **W4: the filter, rule 17.** Find is a tool on the rail of guests, gifts and households
  (`views/bento.ts`'s `findControl` -- closed, the plus on the rail; open, its own bordered field,
  `data-write-on="input"`, K3, beside a close button that forgets the word rather than merely
  clearing it). A new session key, `filter` (by the collection's own name, like `reading`),
  neither on the ledger, persisted across a page change the same way `reading` is (both are the
  collection's own state, not the page's). `views/shared.ts`'s `matches`/`hushed`/`tally` are
  the shared pieces: a case-insensitive substring match, a `hushed` class that dims (never
  `hidden`) a row (`.row-line[...]`) or a photo figure (`applets/photo.ts`'s `PhotoEntry.hushed`,
  an SVG `.slot.hushed`), and "n of m" as its own `<p class="note">` (never inside
  `OpenOptions.note`, which `esc()`s plain text and would double-escape the tally's own markup).
  Wired into the household's own guests (inline, not open -- find sits on the cell's own tools)
  and gifts, and the couple's households and kept gifts. `stories.ts` gains the three stories
  `bento-request.md` sketches; the closing one's `seen` opens find first (`"guests @
  filter.guests=Ok"`) since the actor's own `does` is only the `remove`, and removing a key that
  was never set is rightly a no-op the harness would otherwise see no page change from.

## [0.38.0] - 2026-09-16

### Added

- **K1: the moving element.** `src/client/app.ts`'s `render()` finds an element with `data-moving`
  in the page as it is and, by parsing the incoming HTML, one with the same value in the render;
  when both exist it names only that element for a view transition (`view-transition-name:
  moving`), runs the morph inside `document.startViewTransition` where the browser has it, and
  clears the name once the transition settles -- `prefers-reduced-motion` and a browser without
  support morph as before, and a fragment render never transitions. `reference.md` documents the
  `::view-transition-group(moving) { z-index: 1 }` an example's stylesheet needs, since the kernel
  has no client stylesheet of its own.
- **K2: bring into the clear.** After a full render's morph, an element that now carries
  `data-reveal` and didn't before -- or carries it on a different element than before -- scrolls
  into view (`scrollIntoView({ block: "nearest", inline: "nearest" })`); the window itself never
  moves. `reference.md` notes that an example's stylesheet owns `scroll-margin`, so a docked panel
  counts as an edge.
- **K3: forms that write as you type.** `data-write-on="input"` joins `"blur"`/`"change"`: every
  `[data-write]` field whose live value differs from what the last render wrote becomes one op in
  one message, debounced to ~150ms after the last keystroke anywhere in the form, flushed at once
  by a `focusout` inside it, and never repeating a message identical to the last one that form
  actually sent.

`src/client/app.test.ts` (new, with its own `app.test.html`/`app.test.entry.ts`) drives all three
in a real `Bun.WebView`, app.ts's own socket stubbed so no eta server is needed.

## [0.37.0] - 2026-09-16

### Added

- **The tray is computed, not drawn.** `src/tray.ts`: a box says its compartments in its own order
  and how much of the tray each deserves -- its span in columns and rows ("bigger for what matters
  more") -- and `tray(compartments, columns)` places them first-fit, never above the row the last one
  started on, so the box's order is kept; a gap at the end of the last row goes to the compartment
  before it, so the tray's foot is whole. It answers with the grid's template areas and, for each
  compartment, its area and which of the tray's corners it sits in -- because a compartment is cut
  into the tray, square where its walls meet another, curved only in the tray's corners. Pure and
  viewport-free; the wedding's `boxPage` computes one tray for three columns and one for a phone,
  hands both over as custom properties, and the stylesheet picks by width. The wedding's boxes
  (a household's home, the couple's, a family's) now look as the bento mock-up does, and their
  hand-written `grid-column` spans are gone. `slug()` turns a compartment's label into its
  grid-area name. 100% covered; the wedding's 51 stories and browser tests unchanged.

## [0.36.0] - 2026-09-16

### Changed

- **Lucide is the examples' icon set, as a package; the kernel draws.** `lucide` (ISC, no
  dependencies of its own) is in `package.json`. `src/icons.ts` is new and knows only the shape of
  an icon -- a list of nodes, each a tag and its attributes -- and renders one as SVG at a size
  with a label (`svg(node, {size, name, label})`); it imports no icon set. The wedding's
  `views/icons.ts` keeps its names and its `icon(name, size, label)`, now as a map from name to
  lucide's outline plus a call to the kernel, so no view changed; its hand-copied `PATHS` table is
  gone (two of its twenty outlines had been truncated in the copying). `chevron-left` and
  `map-pin` join the names. Examples import from `lucide` and from `src/`, never from each other.
- **`examples/bento/`**, a standalone design mock-up of the page (not an eta example: no documents,
  no wire; `bun run dev:bento` on port 3003, in `.claude/launch.json` too), rewritten on purpose
  and written up: its README is eighteen rules, from apples.md's "The page" and the atlas in
  `Workshop/concept/location`, each pointing at where the mock-up honours it. Compartments are cut
  into the tray; an opened compartment is a window whatever it holds, with every tool floating in it
  as a Leaflet-style control and the reading scrolling underneath; a figure opens its drawer and
  what it carries waits there; the plus is a modal; the filter dims and counts and never hides; the
  rails step aside for the drawer and the reading scrolls the chosen figure into the clear. Its
  marks are lucide's, drawn by `createIcons` from `<i data-lucide>`; `src/icons.ts` is the
  server's way.

## [0.35.0] - 2026-09-15

### Fixed

- The four findings the first stories run left red, one commit each: chat's redo of an undone
  message now brings back the same message (the inverse of a "remove" carries the message's own
  id and sentAt, not just name and text); the ticker's undo of a dropped symbol restores it at
  its own row, not the end of the list (an indexed `add`, replay-only, renumbering what follows);
  the wedding's welcome shows the couple's own message; and a deadline is shown to those it
  affects -- "Answers by \<date\>" on a household's home while still open, and on the couple's own
  home too, not only "Answers closed on \<date\>" once it has passed. All 70 stories pass.

## [0.34.0] - 2026-09-15

### Changed

- **`seen` names where.** The first run of the stories (0.33.0) showed that naming a compartment
  in `seen` carried nothing -- a household's whole page is one compartment -- and that what
  decided whether someone noticed was the page they were on, and for choices and coming, the
  reading of the list. So `Seen` is now a list of names (left where the cast put them: chat, the
  ticker) or a record of name to *where*, in the example's own grammar, and `Stories.at(where)`
  is the write that puts a member there; the harness sends it before it looks. The wedding's
  `at` takes `"page @ key=value, ..."` -- `focus=2`, `keep=courses/1`, `reading.guests=list`.
  And `unseen` is now only who the story names: anyone in neither list is not asked, since a home
  page with counts on it changes for many reasons and a story asserts only what it says
  (stories.md, "Learned from the first run"). Two wedding stories were retold as refusals, since
  the seed has no reply to withdraw and no wine to change one's mind about. The wedding goes from
  21 of 51 to 49 of 51; the two left are findings: the welcome does not show the couple's message,
  and a future deadline is shown to nobody. Chat's and the ticker's one failure each stand too:
  redo re-adds a message under a new id, and undo of a drop re-adds the symbol at the end.

## [0.33.0] - 2026-09-15

### Added

- **Stories, and the harness that runs them.** `stories.md` says what eta is for: an app is a set
  of stories -- who does what, and who then sees it where -- held to two canons (everything can be
  seen by someone; every change is whole and true), with Claude as the compiler from stories to
  compartments and a harness as the compiler's test. `src/stories.ts` is the shape: `as`, `does`,
  `seen`, `unseen`, `cannot`, and a sentence as the name. Each example has a `stories.ts` (chat 6,
  ticker 13, the wedding 51, every permit rule used by at least one). `src/harness.ts` runs them
  over real sockets: each story connects the cast afresh inside one database transaction, compares
  a fresh render from the tables for every member before and after (so a change that reaches a
  page through an applet's patch counts), undoes and redoes the write as its author (a fact on the
  ledger must survive its undo; an author who has logged out gets none), and rolls the
  transaction back. `bun run stories` (`ETA_EXAMPLE` picks; `STORY=` runs one by substring,
  `STORY_DIFF=1` shows where two pages part company, `STORY_TRACE=1` prints what the author
  heard). First run: chat 5 of 6, ticker 12 of 13, the wedding 21 of 51 -- the failures are
  findings, not the harness's: chat's redo re-adds a message under a new id, the ticker's undo of
  a drop re-adds the symbol at the end, the wedding's households page hides a household with no
  guests, its welcome does not show the couple's message, a future deadline is shown to nobody;
  and most of the wedding's are one finding against the shape: a member sees only the page they
  are on, so `seen` needs to name a page, not a compartment.

### Fixed

- Chat's cost script (`examples/chat/scripts/measure-render-cost.ts`) waited for a presence
  message a joiner has not been sent since 0.25.0 and hung; the README's 427 B holds.

## [0.32.0] - 2026-09-15

### Changed

- **Where a tab is** (change-request.md item 3). An example may mark an element within `#app`
  with `data-page` (the session's own page) and `data-page-write` (the write that sets it); the
  kernel client mirrors that into `history.pushState` on every full render and, on `popstate`,
  sends the declared write with the URL's own page -- so the back/forward buttons and a shared
  link now work, without the kernel knowing what a "page" is. `src/server.ts` gained a
  `"/*": example.index` fallback so a reopened or shared link actually reaches the client to read
  (the server still doesn't resolve anything about the path). The wedding's welcome, household,
  and board pages (`views/shared.ts`'s `frame()`) declare it; chat's `room` was left alone. On a
  fresh connect whose URL already names a page the session doesn't have yet, the session is
  caught up to the URL rather than the URL snapping back to the session's default.

## [0.31.0] - 2026-09-15

### Changed

- **Coverage that counts applets** (change-request.md item 4). Every wedding and ticker applet
  that mixed drawing with DOM mounting is now two files: `<name>.ts` keeps the drawing (and, for
  the board applet, the pure `applyOps` patch logic), `<name>-applet.ts` holds
  `registerApplet(...)` and everything that touches the DOM. `client/main.ts` in both examples
  imports the `-applet` files, so mounting code is invisible to `bun test --coverage` (never
  imported in-process by a test) and covered instead by the real-browser suites, the same way
  chat's `room-picker.ts` always was. Every applet's drawing file now reads 100%/100%; the one
  real gap the split surfaced (`photo.ts`'s untested "lunge from the left" bomber branch,
  previously hidden inside a low blended average) got a test.

## [0.30.0] - 2026-09-15

### Changed

- **Forms that edit** (change-request.md item 2). A `<form data-write-on="blur">` (or
  `"change"`) commits when a field inside it fires that event, instead of on submit; `data-write`
  moves from the form to its individual fields, each naming its own path, and every field whose
  live value differs from what the last render put there (an `<input>`'s `value` attribute, or a
  `<textarea>`'s `defaultValue`, since it has no such attribute) becomes one op in a single
  `{doc, ops}` message. An editing form never carries the form-level `data-write` the
  reset-on-echo mechanism keys on, so it never resets -- the morph keeps its fields' rendered
  values current instead. The wedding's keep drawers (`views/board.ts`) now use it throughout:
  `fieldForm`'s one-form-one-Save-button per field is a bare field inside one drawer-wide editing
  form; the welcome's name/day/venue fields and message textarea the same way. The Save buttons
  and their now-dead CSS are gone.

## [0.29.0] - 2026-09-15

### Changed

- **Who sees a document** (change-request.md item 1). `Compartment.sees?(ws, docId)` answers
  which connections see a document -- defaulting to `resolveDoc(ws) === docId` (right when a
  document's writer is also its only reader: chat's room, the wedding's board, the ticker's clock
  and watchlist, all unchanged), overridden when someone else genuinely sees it without writing
  it (the wedding's `household.sees` also says yes to the couple, who read every household
  through the board). `src/compartments/audience.ts` is the kernel's one registry of open
  connections (`audienceFor`/`notify`/`allOpenSockets`), so a compartment no longer keeps a
  socket registry of its own: chat's `roomSocketSets` and the wedding's whole
  `concepts/presence.ts` (`join`/`leave`/`everyone`/`seeingHousehold`/`seeingBoard`) are gone,
  replaced by calls into the shared module. The wedding's household/board writes still ask
  *everyone* for a render (an aggregate view -- the couple's totals, the "everyone" photo -- can
  change from any household's write, and there's no smaller audience for that yet) while
  narrowing the *patch* echo to `audienceFor` -- a genuine two-tier need `notify()` doesn't cover
  on its own, so those two compartments call `audienceFor`/`allOpenSockets` directly. Chat's
  presence announcements (item 8) move onto the same registry too, unchanged behavior confirmed
  against every existing scenario (multi-tab dedup, a logout mid-room, a redundant tab closing).
  The exclusion logic those announcements need (a joiner shouldn't count itself as "already
  there") and the wedding's `sees` override were each confirmed load-bearing by breaking them and
  watching the right existing tests fail, then restoring. Full suite green (`bun run test`, exit
  0): 269 pass, 0 fail, 100% coverage throughout.

## [0.28.0] - 2026-09-15

### Changed

- **A patch is one transaction** (change-request.md item 11). Every document's `patch()` -- chat's
  room and session; the ticker's clock, market and watchlist; the wedding's household, board and
  session -- is now `export const patch = db.transaction(function patch(...) {...})`, signature
  and every call site unchanged. Before, each statement inside a `patch()` (and `record()` after
  them) was its own autocommit: a throw partway through left a half-applied write, or a table
  changed with no ledger inverse to undo it by. Nested `patch()` calls (a household's own,
  reached through the wedding board's helpers) become savepoints in `bun:sqlite`, so this
  composes for free. Proof: `examples/chat/documents/room.test.ts` mocks `record()` to throw
  once and asserts the message insert that came before it rolls back too (verified by reverting
  the wrapper and watching that test fail). `src/db.ts` also sets `PRAGMA journal_mode = WAL`
  once, before migrations: one sync per commit instead of one per statement, and readers no
  longer wait on a writer; an in-memory database (the test suite's) answers the pragma with
  `"memory"` and is otherwise unchanged, so nothing on the wire or in the measured costs moves.
  `write`/`replay` in `server.ts` stay unwrapped -- a compartment sends its echo and asks for a
  render from inside `write`, so rolling that back would chase a message already sent.

## [0.27.0] - 2026-09-15

### Changed

- **The words: tray, compartment, tools** (change-request.md item 10), in the two commits it
  asked for. First, a pure rename: `Concept` becomes `Compartment` (`src/concepts/` becomes
  `src/compartments/`, `createLedgerConcept` becomes `createLedgerCompartment`), `Example.concepts`
  becomes `compartments`, and the eta-app skill/CLAUDE.md/README follow, now also describing the
  session as **the tray** and undo/redo/leaving as **tools** -- vocabulary only, nothing else
  changed, full suite green. Second, the contract: a compartment's `render()` returns its own
  place on the page, which the kernel wraps in `<div id="c-<docType>">`; after a write, the kernel
  re-renders the *owning* compartment's element as a single `replace` for every connection that
  sees the document, unless the compartment answers `fragments` itself (`[]` included) -- so
  `fragments` is now the exception, not the rule, and `WriteResult` drops its `rendered` flag
  entirely (a write's own connection is rendered the same way as any other that sees the
  document, never twice). The tray and the kernel's own ledger compartment keep the same contract
  minus `render` and aren't listed in `Example.compartments` (a new, optional field): whatever
  they used to render (chat's name form, the wedding's welcome) moved into whichever domain
  compartment is tried first. Chat and the wedding are the proof (both full suites green,
  including real-browser tests); the ticker's measured numbers are unchanged (a tick still
  renders nothing). One CSS fix fell out of it: a compartment's wrapper is a DOM/morph boundary,
  not a layout one, and chat's `.messages` relied on being a direct flex child of `#app` --
  `[id^="c-"] { display: contents; }` restores that, now documented in the skill.

## [0.26.0] - 2026-09-15

### Added

- **Redo.** The ledger's cursor walked forward again: `nextRedo(sessionId)` (`src/ledger.ts`) finds the newest undo this session made that nothing has walked back since, unless a fresh write has come after it; replaying its inverse is the original write over, recorded as undoing the undo. Chains of `undoes` alternate direction by depth (even: a write or a redo; odd: an undo), and the tip of a chain is what counts -- one recursive query, no new state. On the wire it is `{"doc":"ledger","op":"add","path":"/latest"}` beside undo's `remove`; the CLI gains `redo`; chat and the wedding gain a Redo button.
- **A write may be a fact.** `record(..., undoable = true)` (`src/ledger.ts`, migration `0002_ledger_undoable.sql`): a write recorded with `undoable: false` is on the ledger -- history, `inspect`, a replay of the last minute -- but the undo/redo cursor passes over it as if it were not there, and it does not end what a person could redo. A price tick is the case: nobody's Undo may move the market. That is the second word beside the wedding's unrecorded session (change-request.md item 5): unrecorded, and recorded but not undoable.
- **An applet may take a document's patches.** `Applet.patch?(el, ops)` (`src/applets.ts`): an applet whose element names a document in `data-doc` is handed that document's ops as the client receives the echo, with no HTML sent -- the delta is the update. The concept answers `fragments` with `[]` for such a page, so nothing follows the patch. This is the third tier of render (the page; a fragment; the patch itself), and the one that makes a data feed cost what a data feed costs.
- **`examples/ticker/`**, the third example: a price board. One shared document, the market (a quote per symbol; a tick is `replace /<SYMBOL>/price`, from a feed that runs while anyone is connected, or typed through the wire or the CLI, every tick on the ledger for history and none of them under anyone's Undo); a watchlist per session (`add /symbols/-`, `remove /symbols/<index>`, the writes Undo and Redo walk here); a board applet that draws the watched symbols as an SVG table with a sparkline each and takes ticks straight from the patch; and a Swiss railway clock applet showing a city's time, drawn and driven in the browser (the seconds hand sweeps the minute in 58.5 s and waits at twelve). The city is a document per session (`clock`, `replace /tz` with one of the runtime's own zones, on the ledger so Undo takes you back), chosen through a city picker applet (`applets/city-picker.ts`): the zones are `<option>`s the server writes inside the applet's mount as "Tokyo (UTC+09:00)" or "Buenos Aires, Argentina (UTC-03:00)" (the zone's continent is not shown: "Vancouver, America" is wrong), read once at mount, so no JSON crosses the wire; cities that start with what was typed rank first and shortest first, the arrow keys move the highlight, Enter takes it. The clock applet takes the `replace /tz` itself and puts the new name on its face, so a change of city renders nothing. Measured (`DB_PATH=:memory: TICK_MS=0 bun examples/ticker/scripts/measure-render-cost.ts`): one tick is 104 B to each viewer, the patch alone, against 41 B for the same tick as a bare JSON feed. `bun run dev:ticker` serves it on port 3002; `TICK_MS` and `CLOCK_TZ` in `.env.example`.
- The README leads with what eta is made of and why to choose it, with the numbers.

## [0.25.0] - 2026-09-15

### Changed

- Presence is a plain write, not a bare re-render: chat's room concept applies `add /people/-` (a name arriving) and `remove /people/<index>` (a name leaving) to the room document on join/leave, echoed to everyone else in the room exactly like a transcript op -- a patch, then (with 0.24.0's fragments) a `replace` of `#people` instead of the whole page. Never recorded to the ledger (undoing an arrival is nonsense; change-request.md item 5). Two side effects worth naming: (1) the announcing socket doesn't get its own presence echo -- it's about to see the room in its own full render anyway, so a solo join into a fresh room now sends *nothing* extra, not even a wasted re-render; (2) a redundant tab closing (another tab of the same session is still in the room) now sends nothing to anyone, where before every open/close blindly re-rendered the whole room regardless of whether the visible list actually changed. `documents/room.ts`'s multi-tab dedup logic (`peopleWith`) has to substitute the departing socket's pre-write name for a logout specifically, since its session row is already revoked by the time the presence check runs.
- `inspect` takes a `limit` (`{"type":"inspect","limit":n}`) and answers with that many ledger entries per document (`InspectDoc.entries: LedgerEntry[]`, oldest excluded beyond `limit`) instead of just the latest (`head` is gone). Default is 1, the longstanding behavior. The CLI's `watch` now catches up on each doc's recent history (`formatHistory`, oldest first) before following live patches, and both `inspect` and `watch` accept a `--limit <n>` flag (`extractLimit`) to ask for more. Change-request.md item 8, in full.

## [0.24.0] - 2026-09-15

### Changed

- Fragment renders: a write can go out as the delta in HTML's terms instead of the whole page. `Concept.fragments?(ws, docId, result)` answers, per connection, with HTML ops -- `replace` (morph one element), `add` (append inside one), `remove` -- or `[]` (nothing on that page changed: nothing is sent), or `undefined` (the whole page, as before). A `renderRequested` emit may now name the write (`{ sockets, write: { docType, docId, result } }`); a bare iterable still asks for full renders. The client (`src/client/app.ts`) morphs each target in place (`morphElement` in `morph.ts`), mounts what appeared and pins what grew, exactly as after a full render. This is the granular vocabulary 0.12.0 removed when undo needed a word for *removing* an element and there was only `append`; it comes back with that word, and with the full render as the fallback wherever a concept declines. Measured (`DB_PATH=:memory: bun examples/<name>/scripts/measure-render-cost.ts`):
  - **Chat**, 100 messages, 5 members, bytes to each other member per message: 7,532 before (patch + page) to 427 after (patch + one `<li>`). The `<li>` is 268 B now against 120 B for 0.4.0's append, because a message is a bubble with an avatar and a name line since 0.22.0.
  - **The wedding**, one guest's top changed to green: the sender with the drawer open 14,146 to 1,918 (the family photo and the dressing sheet); a second tab on the box 11,387 to 1,441; the couple on their home 8,912 to 123 (the patch echo alone: nothing on their page shows a look); another household on its box 10,879 to 0; another on the everyone page 3,781 to 1,612 (the photo's new props). Chat answers every room write (a message appended; an undone message removed, and the one after it redrawn since it may now start a run). The wedding answers a look or a choice, per viewer's page and reading, and declines the rest; the board declines everything, for now.
  - The applets' props go whole (the photo re-sends every figure for one changed top), so an applet-heavy page sits an order under the page rather than two; and fan-out is unchanged: every connection is still asked, only the answer is now often nothing. Both are the change request's items 7 and 1.
- Chat's transcript carries message ids (`<li id="m<id>">`, `ChatMessage.id`) and the room's `patch()` returns the message an undo `removed`, which `fragments` needs to name it.

## [0.23.0] - 2026-09-14

### Added

- `examples/wedding/`: the second example, a site for one wedding (Rowena & Dashiell's, from `apples_pears/examples/wedding`'s brief). A household arrives by the code in its invitation and gives its answer, names its guests and a plus-one, asks to bring someone, dresses each guest's Lego minifigure and gives it an attitude, chooses each guest's dish and drink per course, claims a gift, reads the day and where to stay, and sees the photo of everyone whose household has said yes (a maybe as a ghost, no names until the day). The couple arrive by the wedding's own code and keep everything: the welcome, the households (invite, reply to asks, a yes makes a guest), the courses with their dishes and drinks, the gifts, the events, where to stay, and a picture for any of them. Nothing in `src/` needed a seam it did not already have. What it exercises that chat did not:
  - **Three documents, two of them shared.** `session` (a visit: the code, the page, which drawer is open, how a collection is read) is a household's or the couple's own and is never recorded on the ledger -- Undo takes back an answer, never a page. `household` (by code) and `board` (the wedding, by its code) are the ledger's: every op computes its inverse, including whole rows -- a removed course comes back with its dishes and drinks, a removed household with its guests, asks and claims, a guest whose ask was un-yes'd with the minifigure they had built.
  - **Applets given their data as props.** The photo (`applets/photo.ts`: `arrange()` places the crowd in rows by proportion, bombers at the edges; a newcomer walks in; on the day the names come down), the dressing sheet (`applets/dress.ts`: which part is open is the applet's; each choice is one write on one field), the menu (`applets/menu.ts`), and the picture field (`applets/picture-field.ts`: the bytes go to this example's own `/api/picture` route, and the key that comes back is a plain write on the document). The drawings are strings, tested without a browser; their mounting is covered by `client/app.test.ts` in a real one, which bun's coverage does not count (chat's `room-picker` is not measured at all, for the same reason).
  - **A permit surface as a table of paths and ops** (`concepts/household.ts`, `concepts/board.ts`), with the deadline locking answers, coming and choices, and a plus-one allowed only while the invitation owes one.
  - **Everyone re-renders on any domain write** (`concepts/presence.ts`): a claim takes a gift from every other household; an answer moves figures into the photo every code watches. The patch itself echoes only to those who see the document.
  - **Its own tables share the kernel's database** with chat's, so none is named `sessions`: a visit is a `visit`. Seed data (`migrations/0002_seed.sql`) with the codes `DASH` (the couple), `OKAFOR` and `BEN`. `bun run dev:wedding` serves it on port 3001; `.claude/launch.json` has a `wedding` entry.

- `.claude/skills/eta-app/`: a skill for building an example on eta -- the checklist (`SKILL.md`) and the full reference (`reference.md`: the `Example` and `Concept` contracts, `read`/`patch` and inverses, the ledger and undo, migrations, the wire, applets, CLI verbs, and when it looks like `src/` needs touching). `CLAUDE.md` points at it.
- `change-request.md`: six things the wedding asked of the kernel, none of which blocked it -- who sees a document (so the kernel does the echo and re-render), forms that edit (write on blur, one path per field), the page in the URL, coverage that counts applets, a word for a document that is off the ledger, and the picture route staying the example's.

### Fixed

- `src/client/morph.ts` reused an applet's element for whatever plain element landed in the same position -- and since a morph never descends into an applet, the applet's own children (a whole SVG) survived under the new element's attributes. Found switching the wedding's guests from the photo to the list. `sameType()` now also requires the same `data-applet`; test added and verified by reverting the fix.

## [0.22.0] - 2026-09-14

### Changed

- The chat view is less sparse: messages are bubbles (yours on the right in the button tint, everyone else's on the left with a monogram, the name shown only on the first message of a run), the transcript anchors to the bottom, people are chips in the header beside the room label, and the composer is a pill. Picked from three options drawn up on a design canvas. Buttons and inputs share one radius and focus ring (they each showed a browser default before). `examples/chat/concepts/room.ts::renderChat` and `styles.css` only; the wire, the writes and the morph are untouched. The server tests that asserted the exact people markup now compare the chip names.
- The chat fills the viewport: `#app` is a `100dvh` flex column and the transcript takes the spare height and is the only thing that scrolls (the old `max-height: 50vh` cap is gone). Two scrolling bugs found on the way: `justify-content: flex-end` on a scrolling flex column pushes overflow above the scroll origin so older messages were unreachable (now an auto top margin on the first message anchors a short transcript instead), and the kernel client only pinned an autoscroll list to the bottom when it grew, never when it first appeared -- a reload of a room with history opened at the oldest message. `src/client/app.ts` now pins a `[data-autoscroll]` element that is new in this render too; browser test added and verified by reverting the fix.

## [0.21.0] - 2026-09-14

### Changed

- Split eta into a generic kernel (`src/`) and a first example (`examples/chat/`), so a second example (a wedding site, next) can be added under `examples/wedding/` without editing anything in `src/`. Moved to `examples/chat/`: `migrations/0002_sessions.sql`/`0003_rooms.sql` (renumbered `0001`/`0002`, under their own namespace -- see below), `documents/session.ts`, `documents/room.ts`, `concepts/session.ts`, `concepts/room.ts`, `applets/room-picker.ts`, `client/index.html`/`styles.css`, `scripts/measure-render-cost.ts`, and the tests that exercised chat-specific behavior (`server.test.ts`, `client/app.test.ts`, and the chat-verb half of `cli/commands.test.ts`, now `examples/chat/cli.test.ts`). Four couplings made this a kernel/example split instead of a rename:
  1. **The concept list was hard-coded** (`concepts/index.ts`'s `[session, room]`). Replaced with `assemble(example: Example)`, returning `{ concepts, byDocType, renderFor, inspectFor }` for whichever example is passed in; the kernel appends its own ledger concept (reached only by docType, still excluded from render/inspect). `renderFor`'s fallback-throw test now passes a fake `Example` with no concepts, instead of an empty list override.
  2. **Undo needed the session concept for echoing, and the "is this session active" guard read `.name`.** New `src/example.ts`: `Example = { name, concepts, active(sessionId), index, routes? }`. `active` is the one thing the kernel can't derive generically (a stale, logged-out tab shouldn't be able to undo a write made before it went stale) -- chat's is `sessionDoc.read(id).name !== null`. The ledger concept is now a factory, `createLedgerConcept(lookup, active)`, so it can find the concept owning whatever document an undo lands on without importing it.
  3. **`documents/undo.ts` imported both example documents to dispatch on docType, and `concepts/ledger.ts` special-cased session vs. room for echoing.** Replaced both with one `Concept.replay?(ws, docId, ops, undoes)` method: applies already-shaped ops (a ledger inverse) and echoes exactly as a direct write would, skipping `permit` (not a fresh request against the normal writable surface). Undo in the ledger concept is now `lookup(docType)!.replay(ws, docId, entry.inverse, entry.id)` after splitting `nextUndo(sessionId)`'s `doc`. `documents/undo.ts` and its test are deleted (coverage moved into `concepts/session.ts`/`concepts/room.ts`'s new `replay` methods and their example-level tests); the `undoApplied` event is gone along with it, and `echoSessionPatch` no longer needs exporting for the ledger's sake.
  4. **The client entry imported the applet by name** (`import "../applets/room-picker"` in `client/app.ts`). Removed. `examples/chat/client/index.html` now loads `examples/chat/client/main.ts`, which registers chat's own applets before importing the kernel's `src/client/app` -- the kernel stays free of any specific applet.
- `migrate(db, dir, namespace)` now takes a required namespace, recording applied files as `${namespace}/${file}` in `_migrations` -- the kernel (`"eta"`) and an example (its own `name`) can't collide on filename. `examples/chat/db.ts` imports the kernel's `db`, runs chat's own migrations under `"chat"`, and re-exports it; every document module in chat imports `db` from there, never from `src/db` directly, so its migrations are guaranteed to run before its module-load-time prepared statements touch the database. **Existing dev `db.sqlite` files will not upgrade** — their `_migrations` rows were recorded unnamespaced, so every migration looks unapplied on next boot and re-running `CREATE TABLE` will error. Delete the local file (gitignored, dev-only) and it's recreated correctly; migrations have been renumbered freely before in this project (see 0.15.0) and there's no deployed database whose upgrade path needs preserving.
- `createServer(example: Example, port?)`: assembles the given example's concepts, serves `example.index` at `/`, spreads `example.routes` into the route table (a kernel route of the same path wins), keeps `/api/health` and `/ws` as before. The `renderRequested` listener registers once per process, not once per call, rendering through whichever example's `createServer` call was most recent. One example per process is an invariant: calling `createServer` with a *different* example object while the previous one's server(s) are still running throws; stopping a server clears the guard, so a test suite that creates one example's server, stops it, then creates a different example's server (as the kernel's own generic tests and an example's own tests do, in the same process) doesn't trip it.
- `src/start.ts` resolves `examples/${ETA_EXAMPLE}/index.ts` (default `chat`) and passes its `example` export to `createServer`; documented in `.env.example`. `src/cli.ts` keeps `inspect`/`watch`/`undo`/a new generic `write <doc> <op> <path> [value]` in the kernel, and loads an example's own short verbs (chat's `name`/`room`/`leave`/`logout`/`send`) from `examples/${ETA_EXAMPLE}/cli.ts` if that file exists -- that file only builds wire ops, no database import. `formatInspection`'s CLI output (and the `inspect` wire response itself) is now generic over whatever docs an example's concepts report, rather than special-casing a top-level "session" field with `name`/`room` -- the same information is still visible per-doc (`session  v2  last: replace /room "lobby"`).
- Added one kernel-only test (`src/server.test.ts`) that boots `createServer` with a tiny inline example (a single in-memory concept, a one-line HTML fixture) and drives a write and an undo over the websocket, proving the kernel needs nothing from `examples/chat`. `src/cli/commands.test.ts` gained an equivalent inline example for its own "against a real server" tests.
- `tsconfig.json`'s `include` now covers `examples` as well as `src`. Bumped to 0.21.0.

## [0.20.1] - 2026-09-14

### Added

- Measured what request 5 (morph, don't replace) costs on the wire (`scripts/measure-render-cost.ts`, not a test -- a report): removing `append` means a room write now sends every other member a patch echo plus a full re-render, instead of a patch echo plus one appended `<li>`. At 100 messages and 5 members: 279 B before, 3140 B after -- about 11x. It plateaus rather than growing unbounded, since `documents/room.ts::read()` caps the rendered transcript at 50 messages regardless of total history. Numbers and methodology in the README under "Cost". Not fixed here, per the request: the number is the deliverable, not a regression.

## [0.20.0] - 2026-09-14

### Changed

- A form's value on submit is no longer scalar-or-nothing: a single named field still sends its raw value, but a form with more than one named field now sends a record of all of them (`src/client/form-value.ts`). Every form up to now has had exactly one field, so nothing currently rendered changes behavior -- this is for the next thing built on eta, which won't get to day two before needing it.

## [0.19.0] - 2026-09-14

### Changed

- Undo's wire shape: `{"doc":"session","op":"add","path":"/undo"}` was a verb wearing a path -- `/undo` isn't a session field. It's now `{"doc":"ledger","op":"remove","path":"/latest"}`: a new `ledger` concept (`concepts/ledger.ts`) whose document is this session's own cursor into its ledger entries, and "remove the latest [undoable one]" is what undo actually does. Which entry "/latest" resolves to is still decided server-side (`documents/undo.ts`), so the client never needs to know or track an id -- no new client-side domain state.
- `ledger` is excluded from `concepts/index.ts`'s render/inspect list: it has no view of its own and no `ledger:<id>` document to report a version for (real entries live under `session:<id>`/`room:<name>`). It's only ever reached by docType, for writes. `Concept.render` is now optional, matching `onOpen`/`onClose`, so a concept like this one doesn't need a stub that's never called.

## [0.18.0] - 2026-09-14

### Changed

- A room message's "is this text valid" rule lived twice: `concepts/room.ts`'s `permit()` trimmed and length-checked it, then `write()` trimmed it again to build the value passed on. Moved the check into `documents/room.ts::patch()` instead, the same place `documents/session.ts` already owns blank name/room checks -- `permit()` now only answers "may this connection write this path" (is it `/transcript/-`, is the session logged in), and the document owns what a valid value is. Added a document-level test for both the blank-is-ignored and the trim-survives-a-valid-message cases.

## [0.17.1] - 2026-09-14

### Added

- `LOG_FILE` env var: where `bun run start` redirects the detached process's output, defaulting to `server.log` as before. Same category as `PID_FILE`, documented alongside it.

## [0.17.0] - 2026-09-14

### Added

- `PID_FILE` and `MIGRATIONS_DIR` env vars, both with the same defaults as before (`server.pid`, `migrations/` next to the source). `bun run stop`'s hardcoded `server.pid` now reads the same `PID_FILE` env var `pid.ts` does, so the two can't drift out of sync. Documented alongside the existing vars in `.env.example`.
- CLI: a `--session <file>` (or `--session=<file>`) flag overrides the default `.eta-session` file, so separate invocations can act as separate people -- e.g. `watch` as one identity in one terminal while sending as another elsewhere.

## [0.16.1] - 2026-09-14

### Changed

- Documented `NODE_ENV` (secure cookies, dev-mode bundling) and `ETA_URL` (which server the CLI talks to) in `.env.example`, commented out as optional since neither is needed for basic local development. `PORT`/`DB_PATH` were the only ones listed before, even though the code had grown two more.

## [0.16.0] - 2026-09-14

### Added

- A CLI (`bun run cli`): `name`, `room`, `leave`, `logout`, `send`, `undo`, `inspect`, and `watch`, talking the same `{doc, ops}`/`{type:"inspect"}` protocol the browser does. It never touches rendered HTML — only ops and `inspect`, proving the document/ledger layer stands on its own without a browser. Identity persists across invocations via a local `.eta-session` file, the same role a browser cookie plays. `src/cli.ts` is a thin, untested entry point (argv, process I/O) in the same spirit as `start.ts`; the actual command logic lives in `src/cli/commands.ts` and is tested against a real server, same discipline as everywhere else.

## [0.15.0] - 2026-09-14

### Changed

- Reordered the migrations: ledger first, then sessions, then rooms. The ledger is generic infrastructure with no dependency on either document (`session_id` is a plain column, not a foreign key); rooms is the demo-specific concept and already depended on sessions existing (it adds the `room` column to it), so it has to come last. Renumbered `0003_ledger.sql` → `0001_ledger.sql`, `0001_sessions.sql` → `0002_sessions.sql`, `0002_rooms.sql` → `0003_rooms.sql`. Verified against a fresh file-backed database.

## [0.14.0] - 2026-09-14

### Changed

- Merged migration `0004_ledger_undo.sql` into `0003_ledger.sql`: still in development, with no deployed database whose upgrade path needs preserving, so the ledger's `undoes` column belongs in its `CREATE TABLE` rather than a follow-up `ALTER TABLE`.
- DRY pass over the code the change request grew: the `<docType>:<docId>` ledger key convention was a string template repeated in three files and hand-parsed in a fourth — centralized as `prefixDoc`/`splitDoc` in `ledger.ts`. `concepts/room.ts`'s repeated "echo the ops, then ask the room to re-render" sequence (a direct write, and undo landing on the room doc) is now one `echoAndNotify` helper; `concepts/session.ts`'s three near-identical echo-and-return branches in `write()` collapsed into the same pattern. `client/morph.ts` no longer reads an applet's `data-props` attribute three times to compare it against itself. No behavior changed; full suite still green at 100% coverage, plus a live two-browser smoke test.

- Rewrote `README.md` (a human-facing description of what eta is and how to run it) and `CLAUDE.md` (a concise map of the architecture and the change request's constraints, for whichever agent picks this up next).

### Removed

- `CHANGEREQUEST.md`: all six requests are implemented; kept out of git throughout per the working agreement with the session that wrote it.

## [0.13.0] - 2026-09-14

### Added

- Legibility (request 6, the last of the change request): a `{"type":"inspect"}` wire request answers with this connection's session, the documents it currently sees with their versions, and the latest ledger entry behind each one (`concepts/index.ts::inspectFor`). `window.eta.inspect()` answers the same question from the client's side: the docs it holds, plus the last write it sent and whether the server echoed it back. Both exist so a person can answer "what happened" without adding a log line; documented in the new README, each with its own test.

## [0.12.0] - 2026-09-14

### Changed

- Morph, don't replace (request 5): the client reconciles the existing DOM against a render's HTML instead of overwriting it with `innerHTML`. Same tag in the same place is reused, a different tag is replaced, and children are matched by `id` first, then by position (`src/client/morph.ts`, hand-rolled, no dependency). An element a person is focused on, typing into, or has scrolled survives a render that doesn't concern it, because it's the same element afterward.
- `[data-applet]` is a boundary the morph never descends into: it reconciles the element's own attributes, and calls the applet's new optional `update(el, props)` if `data-props` changed, but leaves the applet's hand-managed children alone. A mounted applet whose element disappears gets its cleanup run before removal; a newly-appeared one mounts after the morph, as before. `room-picker`'s `update()` refreshes its suggestions against new props without resetting the typed filter.
- Full renders are cheap now that they morph instead of replace, so the granular wire vocabulary for "someone joined," "a message arrived," or undo's transcript change is gone: everyone affected by a room change just gets asked to re-render (`renderRequested`, in `concepts/render.ts`). The `append` message type and the `selector` field on `render` are removed; a render is always the whole `#app`.
- A form resets on the **echo** of its own write, not on submit, so a refused or lost write hands the person's text back instead of silently discarding it.
- Removed the `[autofocus]` refocus behavior: a focused element now keeps focus by virtue of surviving the morph, so re-applying it after every render is no longer necessary. `data-autoscroll` stays, but only pins to the bottom when the element it's on actually gained content in that render -- an unrelated update (someone else's presence, an undo elsewhere) no longer yanks the scroll position.

## [0.11.0] - 2026-09-14

### Added

- Undo (request 4): a session's last write, walked back. `undo(sessionId)` finds the newest not-yet-undone entry this session wrote in the ledger, to any document, and applies its `inverse` as a new patch — so the undo is itself in the ledger and echoed. It's a cursor, not a toggle: `nextUndo`'s query excludes both entries already undone and undo-entries themselves, so pressing it repeatedly walks further back instead of toggling the same write on and off. One "Undo" button in the user bar, wired as `{"doc":"session","op":"add","path":"/undo"}` — undo is a per-session cursor, not a real field on the session document, but it's triggered through it since a session only ever has one.
- `documents/room.ts::patch()` now applies `remove /transcript/<index>` ops (previously only `add .../-` was implemented), needed so undo can actually walk back a sent message. Only reachable via undo: the room concept's `permit()` still never allows a bare "remove" write from the wire.

### Fixed

- Two of `documents/session.ts`'s computed inverses could restore a field to `null` via `{ op: "replace", value: null }` — but `patch()` treats a blank/null value as invalid and ignores it, so undoing a session's very first name-set or room-join would silently do nothing instead of logging out or leaving the room. Restoring "no value" is now expressed as `remove`, not `replace` with `null`.

## [0.10.7] - 2026-09-14

### Changed

- The dark green terminal theme was hardcoded (`color-scheme: dark`) regardless of the desktop's actual appearance setting. Colors are now CSS custom properties with a light default and a `prefers-color-scheme: dark` override, and `color-scheme: light dark` lets native form controls follow suit — the app now matches daylight/dark desktop settings instead of always looking like a terminal at night.

## [0.10.6] - 2026-09-14

### Changed

- Moved `index.html`, `styles.css`, and `app.ts` (with its test) into `src/client/`, separating the browser-delivered client from the server-side documents/concepts/ledger code that shares the `src/` root with it.

## [0.10.5] - 2026-09-14

### Fixed

- `renderFor`'s fallback throw (no concept produced a view) was unreachable in normal operation, since session and room together cover every state, leaving `concepts/index.ts` short of the project's 100% coverage standard. `renderFor` now takes an optional concepts list, defaulting to the real one, so a test can pass an empty list to exercise the throw without changing production behavior.

## [0.10.4] - 2026-09-14

### Fixed

- The client's reconnect backoff never reset after a successful reconnect: a client that had scaled up to the 10s maximum during a period of network turbulence would still wait 10s on its very next drop, hours later, instead of retrying promptly. `connect()`'s backoff is now shared module state that resets to the initial delay on the socket's `open` event.

### Added

- `window.eta.socket()` exposes the live WebSocket and `window.eta.reconnectDelay()` its current backoff — a person at the console can now see connection state directly, in the same spirit as `window.eta.docs()`.

## [0.10.3] - 2026-09-14

### Fixed

- A session open in two tabs in the same room showed up twice in the people list, once per socket. `peopleIn` now dedupes by name. Closing one of the two tabs correctly leaves the other's presence intact, since presence is recomputed from the live socket set on every broadcast rather than tracked incrementally.

## [0.10.2] - 2026-09-14

### Fixed

- Logging out while in a room now records an inverse that restores both `/name` and `/room`. Logout clears both columns in one statement, but the computed inverse only ever restored `/name` — an undo (coming in request 4) would have logged the person back in while leaving them orphaned from the room they were in.

## [0.10.1] - 2026-09-14

### Fixed

- Migrations now apply each file's statements and its `_migrations` bookkeeping row in one transaction. Previously a migration that failed partway (bad SQL, a constraint violation) could leave the schema half-applied with no record of the attempt, so the next run would neither retry nor recognize the mismatch. A failure now rolls back cleanly, leaving nothing behind to apply or to explain.

## [0.10.0] - 2026-09-14

### Changed

- Gestures are writes (request 3): the named wire events (`set-name`, `join-room`, `leave-room`, `logout`, `send-message`) are gone. An element now says what it writes: `<form data-write='{"doc":"session","op":"replace","path":"/name"}'>` (a form's field is the value), `<button data-write='{"doc":"session","op":"remove","path":"/room"}'>` (no value), `<li data-write='...' data-value="general">` (a `data-value` is the value). The client sends one shape up, always: `{doc, ops}`, where `doc` is a bare type name ("session" | "room") — never a concrete id, since a connection only ever sees its own session and the room it's currently in.
- The server resolves `doc` for the connection (a concept's `resolveDoc`), checks the concept's `permit` for each op, applies through the document's `patch()`, and echoes — one generic pipeline in `server.ts`, no per-event dispatch table. `Concept` shrank from an `events` map to `render`, `resolveDoc`, `permit`, `write` (`write` covers apply + side effects + echo, since only the owning concept knows its own document's audience and side effects).
- "Joining"/"leaving" a room is now a *consequence* of a session document write, not an event of its own: `session` emits `sessionPatched` after any successful write to its own document, and `room` subscribes to react to `/room` changes (and `/name` removal, for logout) — the same event-bus pattern already used for ending a session, generalized.
- The patch echo's `doc` field is now the bare type too (`"session"`/`"room"`), not the internally-prefixed ledger id — a connection only ever holds one document of each type, so `window.eta.docs()` is keyed the same way.

### Fixed

- Refactoring `join-room`'s guard into `permit()` initially dropped the check that a session must be logged in before it can write `/room` — reintroducing the exact stale-tab session leak fixed earlier. Caught before committing by re-deriving the message sequence from the spec and checking it against the existing regression test; `permit` now requires an active session for `/room` writes, same as before.

## [0.9.0] - 2026-09-14

### Added

- Echo the write (request 2 of the change request): when a document is patched, every connection that can see it now receives `{type: "patch", doc, version, ops}` *before* the HTML that follows. A session document's echo goes only to its own connection (direct send); a room document's echo broadcasts to every connection currently in that room, same audience as the existing `.people`/`.messages` broadcasts. `documents/session.ts::patch()` and `documents/room.ts::patch()` now return `{version, applied, ...}` — `applied` is only the ops that actually took effect, so the echo (and, later, the ledger) never claims a rejected write happened.
- The client keeps what it's seen, per document: the latest version and the last 5 ops, in memory, exposed as `window.eta.docs()` — a person at the console can read the session back without a log line for it.

### Fixed

- `server.test.ts`'s message helper created a fresh `{once: true}` listener per call, which had a latent race: two messages sent back-to-back by the server (now routine, with the patch echo landing immediately before its render) could both arrive before test code re-subscribed after awaiting the first, silently dropping one. Replaced with a persistent per-socket FIFO queue — messages are never lost regardless of when a test asks for them.

## [0.8.0] - 2026-09-14

### Added

- A ledger (`migrations/0003_ledger.sql`, `src/ledger.ts`): every patch a document applies is recorded as `(doc, version, ops, inverse, session_id, at)`, one shared table for every document type. `patch()` now returns the new version, and computes each op's inverse from the state *before* applying it — a `replace`/`remove` inverts to a `replace` back to the old value; an array `add` (only used for `/transcript/-` today) inverts to a `remove` at the index the item actually landed at in the full, unpaginated history, so it stays correct regardless of `read()`'s display limit. A patch where nothing actually applied (blank name, unrecognized path) doesn't record an entry or bump the version.
- Documents own the recording, not concepts — `documents/session.ts` and `documents/room.ts` call `ledger.record()` internally as part of `patch()`. This is the first of a sequence of changes (see the project's change request) building toward the write itself, not just its picture, being the source of truth.

## [0.7.5] - 2026-09-14

### Fixed

- A stale second tab (or any client) sharing a `session_id` cookie with a session that just logged out could still send `join-room` and have it silently succeed: `join-room` never checked that the session actually had a name before writing to it. The write was invisible through `read()` (filtered by `revoked_at`), but the socket was still added to the room's live broadcast set forever (nothing would ever remove it), and the stale room value could resurface if that session later set a name again. `join-room` now requires a name first, like `send-message` already did.
- Any targeted update — most commonly a presence-only `.people` render — was stealing focus back to the chat input and force-scrolling `.messages` to the bottom, because `app.ts`'s post-update behaviors (`[autofocus]`, `[data-autoscroll]`, applet mounting) scanned the whole page unconditionally instead of the region that actually changed. Scoped to the actual render/append target (handling the case where the target itself carries the matching attribute, not just a descendant).
- Both found via a multi-agent code review (`/code-review high`) with an independent verification pass per finding; both reproduced and fixed with regression tests, and manually confirmed by reverting each fix and watching its test fail.

## [0.7.4] - 2026-09-14

### Changed

- Renamed `src/session.ts`'s `SessionData` to `ConnectionData` (file renamed to `src/connection.ts`). It's the shape of `Bun.serve`'s per-connection data (`{ sessionId: string }`, an opaque connection identifier) — foundational plumbing used by `server.ts` and the generic `Concept` contract, not something owned by the session concept. The old name made it read as if it belonged there, which is what raised the question of folding it into `concepts/session.ts` in the first place (it can't be: `server.ts` and `concepts/concept.ts` both depend on it and must stay agnostic of any specific concept).

## [0.7.3] - 2026-09-14

### Changed

- Folded `src/rooms.ts` (the live socket registry) into `concepts/room.ts` as a private implementation detail. It was standalone only because `documents/session.ts` and `documents/room.ts` used to reach into it too; now that live connection state is exclusively a `concepts/room.ts` concern, its own module was no longer earning its keep.

## [0.7.2] - 2026-09-14

### Changed

- Removed the last direct cross-concept import: `concepts/session.ts`'s `logout` handler used to call `concepts/room.ts`'s `broadcastPeople`/`leaveRoom` directly. Added a minimal typed pub/sub (`src/concepts/bus.ts`); `session` now just emits `sessionEnded` without knowing or caring who's listening, and `room` subscribes to it and reacts on its own (leaving the room, broadcasting presence). `session.ts` no longer imports anything from `room.ts` at all.

## [0.7.1] - 2026-09-14

### Changed

- `documents/session.ts` and `documents/room.ts` no longer import `rooms.ts` (the live socket registry). Live connection state isn't persisted data, so it has no business being touched from the document layer: `patch()` on both documents is now pure SQL, and `documents/room.ts`'s `RoomDocument` drops `people` entirely (it only returns `transcript`, its one real query result).
- Presence (`people`) is now assembled in `concepts/room.ts` — combining the live socket registry with a session-document lookup per socket — and the `join-room`/`leave-room`/`logout` event handlers now own the `joinRoom`/`leaveRoom` calls directly, since they're the ones with a `ws` to act on. `documents/session.ts::patch()` dropped its `ws` parameter entirely as a result.
- Net effect: `documents/*` is SQL only; `concepts/*` is the only layer that touches live connection state, matching the concept/document split more precisely than before.

## [0.7.0] - 2026-09-14

### Changed

- `server.ts` and `views.ts` (now deleted) knew about "session" and "room" as specific concepts — hardcoded event names, direct document imports, an explicit name-then-room render order. Introduced `src/concepts/`: each domain idea is a self-contained `Concept` module owning its own wire events, rendering, and open/close lifecycle (`src/concepts/session.ts`, `src/concepts/room.ts`). `server.ts` now only knows the generic `Concept` shape — it merges every concept's `events` into one dispatch map and asks each concept in turn to render, with zero references to "session" or "room" as concepts (the remaining `sessionId` is just the opaque per-connection identifier, not the session concept).
- Wire protocol and rendered output are unchanged — this was a pure internal reorganization, verified by the full existing test suite passing untouched plus a live two-browser smoke test.



### Fixed

- Room presence (`people`) now broadcasts live to everyone already in a room when someone joins or leaves, instead of only being reflected on that member's own next render. Reuses the existing selector-aware `render` message (`{type: "render", selector: ".people", html}`) rather than a full-page re-render or new wire protocol.

## [0.6.0] - 2026-09-14

### Added

- Versioned SQL migrations (`migrations/0001_sessions.sql`, `migrations/0002_rooms.sql`), applied in order and tracked in a `_migrations` table (`src/migrate.ts`), replacing the `CREATE TABLE IF NOT EXISTS` calls that used to live in `db.ts`.
- Documents: `src/documents/session.ts` and `src/documents/room.ts` replace `db.ts`'s per-entity CRUD functions. A document's `read()` is a single query — SQLite's `json_object`/`json_group_array` build the JSON directly in SQL, so the query result *is* the document, not a row `read()` has to assemble. Writes go through `patch(id, ops)`, RFC 6902 JSON Patch operations resolved via RFC 6901 JSON Pointer paths (`src/json-pointer.ts`, `src/json-patch.ts`); each document type owns what a patch to its fields means, including side effects (e.g. patching a session's `/room` leaves the old room's live socket set and joins the new one).
- `db.ts` is now just the SQLite connection plus migration bootstrap — no business-logic-shaped exports.
- Room presence: the room document now includes `people` (names of currently-connected sessions in that room), derived from the live socket registry (`rooms.ts`) plus a session-document lookup per socket. Surfaced in the chat view as a simple list. Note: presence isn't broadcast live to other members on join/leave (unlike chat messages) — a room member only sees an updated people list on their own next render, not the instant someone else joins.

### Fixed

- Patching a session's `/room` used to assume a `sessions` row already existed (created via `/name`); calling it in isolation was a silent no-op against a nonexistent row. `sessions.name` is now nullable and joining a room upserts the row, so a document's patch API doesn't have a hidden required call order.

## [0.5.0] - 2026-09-14

### Added

- Applets: a minimal plugin mechanism for client-side components with their own lifecycle, layered on top of the existing render/append transport. A server-rendered `<div data-applet="name" data-props="...">` gets mounted by a registered `{ mount(el, ctx) }` handler (`ctx` gives `props` and the same `send()` the rest of the client uses); `app.ts` stays domain-agnostic — it only knows the generic mount contract, not what any applet does.
- First applet: `room-picker` (`src/applets/room-picker.ts`) replaces the room selector's static button-list-plus-form with a single input that filters the room list client-side as you type — no round trip per keystroke. It reuses the existing generic `data-event` delegation for both paths (a `<form data-event="join-room">` for creating/submitting by Enter, `<li data-event="join-room" data-room="...">` suggestions for clicking an existing room), so it needed no new wire protocol and no changes to `server.ts`'s event handling.
- `render` now accepts an optional target selector (defaulting to `#app`), so a future applet's own subtree can be replaced without a full-page re-render.

### Fixed

- `tsconfig.json` was missing the `DOM.Iterable` lib, which is where `FormData`'s (and `NodeList`'s, `URLSearchParams`'s, etc.) iterator/`entries()` live — some tools tolerated the gap, others (e.g. Zed's TS language server) correctly flagged `Object.fromEntries(new FormData(form))` as a type error.

## [0.4.1] - 2026-09-14

### Changed

- New chat messages no longer trigger a full-view re-render; the server sends a generic `{type: "append", selector, html}` event and the client inserts it at that selector. Payload size for a new message no longer scales with room history (measured ~263 bytes full render vs ~82 bytes append for a 20-message room, and the gap widens with history size).
- `app.ts` stays domain-agnostic: it only knows `render` (replace `#app`) and `append` (insert HTML at a server-given selector), plus the existing generic `data-event` delegation. Scroll-to-bottom is now a declarative `data-autoscroll` attribute the server can put on any element (mirroring the existing `autofocus` convention), not a hardcoded `.messages` special case in the client.
- Forms now call `.reset()` right after sending, since `append` no longer implicitly clears the sender's input the way a full re-render used to.

## [0.4.0] - 2026-09-14

### Added

- Room selector: after entering a name, a session picks an existing room (listed as buttons) or types a new one to create it; a "Change room" button in the chat view returns to the selector. Current room is tracked in `sessions.room`.

### Changed

- Chat is now persisted in SQLite instead of in-memory: new `rooms` (known room names) and `messages` (room, name, text, sent_at) tables. `src/rooms.ts` now only tracks currently-connected sockets per room (for broadcasting); message history and the room list survive a server restart.
- Logging out now also clears the session's current room, in addition to the name.
- `app.ts`'s click handler forwards any extra `data-*` attributes (e.g. `data-room`) as the event payload, so a single `join-room` event serves both the room-list buttons and the "create a room" form.

### Note

- No schema migration: a `db.sqlite` created before this change is missing the `sessions.room` column and will error on startup. Delete the local `db.sqlite` file (gitignored, dev-only) and it'll be recreated with the new schema.

## [0.3.0] - 2026-09-14

### Added

- Group chat: once a session has a name, it joins a shared room (`src/rooms.ts`) and sees a live message list plus a `send-message` form; messages broadcast to every connected room member in real time.
- `DEFAULT_ROOM` is a single hardcoded room for now (`"general"`), but the room registry (`Map<roomId, { sockets, messages }>`) is already keyed by room id, so multiple rooms are a matter of adding room selection later, not restructuring storage.
- In-memory message history capped at the last 50 messages per room (not persisted to SQLite — restarting the server clears chat history; sessions/names still persist).
- `app.ts` now restores focus to the `[autofocus]` element and scrolls `.messages` to the bottom after every re-render, since a full HTML replace otherwise drops both.

## [0.2.1] - 2026-09-14

### Changed

- Split `src/server.ts` down to just `Bun.serve` wiring: pid file handling moved to `src/pid.ts`, HTML rendering to `src/views.ts`.
- `sessions` table gained `created_at`/`revoked_at` timestamps; logout now soft-deletes (`revoked_at` set) instead of `DELETE`-ing the row, so a session id can be reactivated later and history isn't lost. `getSessionName` only considers rows where `revoked_at IS NULL`.
- Session cookie handling now uses Bun's built-in `request.cookies` (`CookieMap`) instead of a hand-rolled parser, which also fixes a crash on malformed `Cookie` headers and adds the `Secure` attribute in production.

### Fixed

- The `/ws` message handler could crash the entire server process on a malformed or incomplete client message (bad JSON, or valid JSON missing `payload`). Both are now handled without dropping the connection.

## [0.2.0] - 2026-09-14

### Changed

- Reworked the app as a server-rendered "thin client": the server owns all state and pushes rendered HTML fragments over `/ws`; `src/app.ts` only swaps `#app`'s HTML and forwards `submit`/`click` events (via `data-event` attributes) back over the socket as JSON. Replaced the old title/broadcast demo.

### Added

- `src/db.ts` — session storage via `bun:sqlite`, path configurable with the `DB_PATH` env var (added to `.env.example`).
- Cookie-based session id (`session_id`, set on `/ws` upgrade) ties a browser session to its SQLite row.
- Name-entry form → user label + logout button flow; logout clears the session row and re-renders the form.
- Browser-driven tests via `Bun.WebView` covering the full flow, including session persistence across a reload.

## [0.1.0] - 2026-09-14

### Added

- Bun HTTP server (`src/server.ts`) serving `src/index.html` via `Bun.serve` routes.
- `src/styles.css` and `src/app.ts` linked from `index.html`.
- `tsconfig.json` with `@types/bun`.
- `PORT` environment variable support with `.env.example`.
- Self-managed pid file (`server.pid`) written and cleaned up by the server itself.
- `start`/`stop` package.json scripts (`bun run start`/`bun run stop`) using `bun --watch` and the pid file.
- WebSocket `/ws` route (upgrade via the route handler, not `fetch`) with pub/sub broadcast, and a reconnecting client in `src/app.ts`.
