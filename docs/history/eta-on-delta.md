# eta on delta: who provides what

*24 September 2026. A design note, written after an experiment and before the work it decides.
The experiment is on two branches: eta's `experiment/chat-on-delta` (pushed) and delta's
`experiment/eta-engine` (local). What it found is in `eta/examples/chat-delta/FINDINGS.md`; what it
led to is below.*

## The decision

eta is built on delta. Three libraries, three jobs:

- **delta owns documents**: what a document is, where its truth lives, how it changes, and the
  history of its changes.
- **eta owns people and pages**: who someone is, what they see, what they may do, how their page
  is drawn and kept current, and whether the stories hold.
- **railroad owns the browser's own drawing**: applets inside eta's pages, and whole apps with no
  eta at all (duckdown's editor).

In an eta app the browser speaks eta's wire only. delta runs in the same process, behind eta,
through `createLocal()`; its own WebSocket stays for apps that are delta and railroad alone.

## Who provides what

| Service | Owner | Today | To do |
|---|---|---|---|
| Document shape, schema, validation of a write's data | delta | delta; eta's documents hand-written | eta's documents become delta documents |
| Document kinds (below) | delta | written and fact only | memory, source and static backends |
| Storage: JSON file, SQLite, Postgres | delta | delta; eta hand-writes SQLite | eta's goes to delta |
| Derived documents (a room list, totals) | delta | delta's custom docs; eta hand-writes SQL | to delta |
| Transactions, versions | delta | both | delta's only |
| The inverse of a write | delta | delta, on the branch | done |
| **The ledger**: history, inverse, who wrote, whether undoable | delta | eta's `src/ledger.ts` | moves to delta |
| Undo and redo, as a tool on a page | eta, over delta's ledger | eta | stays |
| One stream of changes, local and from other processes | delta | in-process only | delta emits it; eta subscribes |
| Authentication: cookies, sessions, signing in | eta | eta | stays |
| **Who someone is**, as delta sees them | eta resolves, delta carries | lost at the seam | see Identity |
| Who sees a document (from what their page read) | eta | eta | stays |
| May this person, on this page, write this | eta's `permit` | eta | stays |
| May anyone write this data (shape, row rules) | delta: validation, and row-level security in Postgres | delta | stays |
| The wire to the browser | eta | eta | stays |
| Pages, parts, what is sent after a write, bento | eta | eta | stays |
| Browser: morph, applet host | eta | eta | stays |
| Applying ops to a value (browser and harness) | delta core | delta core, and a copy in eta (`applyPatch`) | eta's copy goes |
| Drawing an applet | railroad, or React | railroad | stays |
| Stories: pages and patch stream checked | eta | eta | stays |
| The law for one document: ops replayed equal a fresh read | delta | not yet (epsilon had `proveLaw`) | delta gains it |
| CLI | eta's for eta apps; delta's for delta alone | both | stays |

## Document kinds

Divided by where a document's truth lives, not by how it is stored.

| Kind | Truth lives | Lasts | Ledger | Written from the wire | A change reaches pages by |
|---|---|---|---|---|---|
| **Written** (a room, a household) | our database | persistent | yes, undoable | yes, as `permit` allows | a person's write |
| **Fact** (a tick, a trade) | our database | persistent | recorded, never undone | by its feed only | the feed |
| **Live** (who is online) | this process | until restart | no | no | the system's own events |
| **Sourced** (a reactor's temperature) | outside: a device, an API | the latest reading | no | no | the source pushing, or a poll |
| **Static** (SI units, countries) | the repository | a release | no | no | a deploy |

All five are delta's, as backends:

- **Live** is the memory backend: the JSON-file backend without the file. eta feeds it (only eta
  knows who is connected); delta holds it.
- **Sourced** is an adapter, `read()` and optionally `subscribe(push)`, with a poll interval. One
  reading is shared by every viewer; it is never read per viewer, per redraw. **A reading carries
  when it was taken**, and a page says when it is stale: of the five, only this one can go quietly
  wrong while looking right.
- **Static** is a file loaded at start, read-only. A refresh is a deploy. What refers to a static
  entry refers by a stable id (ISO codes), and a release that renames or retires one migrates the
  written data that pointed at it: the one reason a refresh may need a hand.

Each compartment declares its document's kind, and eta derives the rest from it: the ledger or
not, undoable or not, writable from the wire or not, whether reading it subscribes a page (not
for static), and when a sourced reading is shown stale.

## Identity

delta was designed to know who makes a change, and its user is pluggable: `DeltaAuth<Identity>`
keeps identity opaque, `gate(client)` gives it for every message, and `asSqlArg(identity)` carries
it into Postgres for row-level security (`app.user_id`). The experiment lost it: `createLocal()`
has one client, so every write reached delta as eta.

So identity crosses the seam **per call, not per connection**:

- **eta resolves it.** An example says who a session is: `Example.who(sessionId)`, defaulting to
  the session itself. The wedding would answer with the household or the couple; an Allertons
  app with the signed-in user.
- **delta carries it.** `createLocal().as(identity).call(...)`: a client per identity, so delta's
  own gate, Postgres's row-level security, and the ledger's writer all see the person.
- **delta never interprets it** beyond `asSqlArg` and equality.

The ledger records two things, because they differ:

- **who**: the identity, for the audit and for row-level security;
- **cursor**: the key undo walks, opaque to delta. eta passes the session: undo takes back what
  this session did, as it does today.

A session id is a credential and never goes on the wire; as a cursor in delta's ledger it is
stored, never sent. `inspect` goes on saying `mine`, never who.

## The seam

- **One stream of changes.** eta redraws a page when a document it read changes. Today that
  happens only after eta's own writes. With delta underneath, every change -- this process's, or
  another's over Postgres `LISTEN/NOTIFY` -- arrives on one stream from delta, and that stream is
  eta's only trigger to redraw. It also ends eta evicting delta's cache after every call.
- **Two permission layers, each with its question.** delta: is this valid data, and may this
  identity touch these rows. eta: may this person, on this page, make this write. A rule goes in
  the layer whose question it answers.
- **One wire per app.** The browser speaks eta's wire. An applet that takes a document's patches
  takes delta's ops, as eta echoes them.

## What the experiment settled

- Chat's ten stories pass with its rooms in a delta document, sentences unchanged.
- delta gained, on its branch: savepoints, the inverse of a write, `createLocal()`, implied
  documents (396 tests, Postgres included).
- eta gained, on its branch: a document named whole on the wire, sight derived from what a page
  read, pages sent in parts (drawers and modals included), and the stories checking the patch
  stream as well as the page (353 tests, 100% coverage).

## What is still open

1. ~~Undo per session or per person?~~ **Per session**, decided 24 Sep: the cursor eta passes is
   the session.
2. ~~The wedding's documents.~~ **They can**, decided 24 Sep: households, guests (each wearing its
   look, its choices a JSON column), asks and claims are rows; the hand-written patching became
   `shape()`, and undo is delta's inverse (see "What the ports taught").
3. **delta's `experiment/eta-engine` branch** is not pushed: delta is public.

## Order of work

1. delta: identity per call (`createLocal().as`); the ledger, with who and cursor; one stream of
   changes. **Done for SQLite, 24 Sep** (delta `87c799b`, on `experiment/eta-engine`): the
   ledger, `undo` / `redo` / `history`, the cursor named in-process and the connection's own on
   a socket; the stream is `createLocal().onPublish`, each change carrying its version.
   **The Postgres ledger, done 24 Sep** (delta `082149d`): the same entry written by `delta_apply_logged` in the write's transaction,
   a lock per document so the inverse is read from what the write replaced, and undo tested
   across two processes on one database.
2. delta: the memory, source and static backends. **Done 24 Sep** (delta `0d90fa8`), with
   `createLocal()` made asynchronous, so every backend answers through it.
3. eta: delta as its only document layer; `src/ledger.ts` and eta's document migrations go.
   **Done 24 Sep**, but for Postgres. eta `90c055d`: the kernel keeps a copy of each document a
   page reads, kept current from delta's one stream; drawing stays synchronous (a read not held
   yet throws `Pending`, and the drawing runs again once it is loaded); events are handled one at
   a time, in order. Chat runs on it; `29ea641` the ticker; `e06210b` the legacy path gone
   (`src/ledger.ts`, `migrate()`, a compartment's `write`, `notify`). Still to go: chat's stories
   over delta's Postgres backend, which the kernel is written for (tested against a fake that
   answers a write before its change comes back, as Postgres does) but has not yet run on.
4. The wedding, ported: the test of the split. **Done 24 Sep** (eta `d84cc8a`): all 46 stories
   pass, their sentences unchanged. Two fan-out bugs in delta's SQLite backend found and fixed on
   its branch (`74fa9a7`, `7917a5c`); the Postgres backend's fan-out has not been checked for
   the same two.

## What the ports taught

- **The wedding's documents are cut by who reads them.** A page is told every change to what it
  read, so what a household reads decides what it may learn. The couple read `board:1` (every
  household whole); a household reads its own `household:<id>`, `wedding:1` (the lists) and
  `everyone:1` -- live, computed by the server from the tables: who stands in the photo and how
  many have claimed each gift, never who, and names only once they have come down. A visitor
  without a code reads `welcome:1`, the wedding's own row. The couple's code moved out of the
  wedding's row, into a table no document includes. Documents are addressed by id, not by code.
- **The wire kept its vocabulary.** The views, stories and CLI still say
  `/guests/2/minifigure/top` and `/households/1/asks/1/reply`; each compartment's `shape()`
  turns that into the flat rows it moves. delta's inverse replaced every replay-only path.
- **delta's fan-out is what makes one table many documents.** A reply written on the board
  reaches the household's own document; it had two bugs (a row onto a document whose root it
  is; a parent and its children in one write), both fixed in delta.
- **What one change sets going must be done before the next is told.** The household's change
  and its fan-out onto the board were told at once, and both kept `everyone`, twice. Changes are
  now told one at a time, in order.
- **A fresh write and its undo differ in what follows, not in how they are written.**
  `wrote()` runs after a fresh write from the wire: the modal that asked is put away by the write
  that answered it, and an undo leaves the page where it is.

- **delta tells a change as the rows it leaves.** A tick is `replace /quotes/DLTA {whole row}`,
  not the two fields it moved; a session's name is `replace /sessions {row}`. An applet takes
  rows: the board applet, the clock and the city picker were changed to. A page's applet props
  hold rows as delta holds them (id and parent key included), or ops do not land on them -- the
  stories' patch-stream check caught this.
- **The desk is a sixth thing.** Where a session is on the page (a window, a drawer, how a list
  is read) is written from the wire, stored, and never on the ledger. It is none of the five
  kinds. The ticker keeps it in a delta registry with no ledger, declared `written`: it works,
  but the kinds table does not say it.
- **What follows from a write is `changed()`.** Putting away a modal once its question is
  answered, keeping who is here: the compartment's `changed()` writes it as the server, after
  the change is told. It cannot tell a fresh write from an undo, so what it keeps must follow
  from state, not from the write.
- **A write the wire says is not the write the document takes.** `shape()` turns one into the
  other (a symbol added: the list replaced whole, so undo restores it exactly). The legacy
  replay-only paths (an indexed add, a whole guest put back) go: delta's inverse does that.
