# pears on delta: a plan

*29 September 2026. Proposed, not started. Written after a strategic conversation and a review of
every earlier implementation. Nothing here has been built or run: the reviews were reads of the
code and the tests' names, and where this plan says a thing "works", it means delta's manual says
so.*

## What we are making

**pears**, the protocol for listening, written as a package that **depends on delta** and leaves
delta unchanged. pips's idea comes with it: a graph of nodes you build by talking to Claude.

- **Delta** keeps the data: documents over tables, three verbs, the ledger (undo, redo, history),
  temporal reads, the scope rule.
- **pears** holds the graph: nodes at paths, wiring by path prefix, the cascade, kinds, and the
  seven-method wire protocol.

The stack line, so it is written once: railroad draws, delta keeps, eta is the app, pears is the
graph. A node is owned by whoever made it; what crosses to someone else is **data, mime-typed**.
Functions are the owner's own and run only on data. That is the rule that keeps a shared graph
safe, and it is the point of the idea (Broadcast XML, 1990s; pears, a protocol for listening).

## Origin: Broadcast XML, Razorfish, March 2000

The idea is older than the code. `Broadcast XML2.ppt` (in this folder; saved 4 April 2000) is a
deck for Razorfish that already states it. It is an old binary `.ppt`; its text was extracted, and
its drawings have not been seen. What it says, and where each thing landed:

| The deck (2000) | Where it is now |
|---|---|
| **Six verbs**: locate, create/subscribe, update, delete, view, access control | pears' methods (`def`, `set`, `del`, `on`/`off`, `get`, `see`) and delta's scope rule. The spec has seven; the deck's six are the design |
| "XML is only a protocol. It is how we express what we have and what has happened." | pears is a protocol, not a stack |
| **DTD, XML, XSL, XSLT**: definition, data, display, translation | hjeli's grammar, the documents, apples (display kept apart from data), and the mapping between owners. "Translate once to automate" is the per-owner map |
| Broadcast a change as the **identity of the element** and the **nature of the change** | delta's path plus op |
| Build your own objects, share with others, explore others', re-use them | the HyperCard idea; pips's chat panel; a graph exported and replayed |
| Publish and subscribe, access control, stateful user-definable objects, rich content | pears' subscription by path; delta's scope; nodes with state and history |
| Data-driven relations: one to one, one to many, **many to many**; action-driven objects | the wiring; compute kinds |
| The web as static, request-response, polling; email stateless and overloaded | the case for a reactive network, unchanged in 26 years |

### Communication is not transaction

The deck separates two things that most systems mix. **Communication** is "the transmission of a
message via a channel from a speaker to a listener." **Transaction** is "commitment to action between
parties that is binding." The plan keeps them apart, because the products that exist do not:

- **Communication** is what atproto and Bluesky carry, and it is what chat and video streams are:
  speakers, listeners, feeds.
- **Transaction** is what the rights market (Allertons) and the reconciler are: a binding, its status,
  and both parties' hold on it.

So a node in pears is either a **statement** (owned, published, heard) or a **commitment** (a claim
by one party and an acknowledgement by another, each written only by its own owner, with the
acknowledging owner's record the authority). The engine treats them the same way; the difference is
in the kinds and the stories. A commitment needs claim and acknowledge, a status both can read, and
the ledger's record of who wrote what. That, not the transport, is what a Bluesky-shaped system lacks.

## Why now, and why not before

- The idea is sound and has converged with others (JSON Patch's three verbs, atproto's signed
  repos and subscribers that derive their own views). We are not proposing a standard; we are
  building a tool, for our own sites first.
- Delta now has what neither earlier server had: real transactions, a per-person ledger with
  inverses, temporal reads and a scope rule. Those were the things pears and pips claimed and did
  not deliver.
- Claude is the authoring layer (the HyperTalk of pears). pips showed the shape: a chat panel that
  writes nodes through the same verbs as any client.

## What was there (the review)

Three layers, and the best is the spec.

| Layer | Where | State |
|---|---|---|
| **The spec**, 17th edition | `blueshed/archive/apples_pears/pears.md` | Seven methods, three notifications, three kinds (cell, namespace, counter), a normative cascade order, frames per connection, revocation, a transport-set subject. Tested by four isolation builds written from the spec text alone. Says nothing of functions, history or undo. |
| **The engine** | `apples_pears/lib/pears` (`pears.ts`, `sqlite.ts`, `server.ts`) | A close reading of the spec: cascade order, frames, own effects, revocation, per-subject nodes, refusal order. The wire matched the worked example (`can_you_2`). No compute kind, no replay, no undo. |
| **Two dialects** | `archive/pears`, `archive/pips` | Built the graph, and added functions, bags, cron and (pips) `ai` nodes. They do not meet the spec's guarantees, or their own docs. |

**What both dialects got wrong**, and this plan must not repeat:

- **Null does not gate** (pears): a function returning null does not stop the cascade, and the test
  that claims to cover it passes vacuously.
- **No transaction across a cascade**: each hop is its own write; a crash leaves a half-updated graph.
- **Undo is a per-path flip-flop, not a ledger**: twice undoes then redoes, it reverts other people's
  later writes, and in pears an undo with no earlier version deletes the node.
- **Identity is a name in the query string**, no permissions, bound to all interfaces. Any client can
  `def` a function.
- **No sandbox**: `new Function` in a Worker with full `fetch`, `Bun` and the filesystem. Pears shares
  one worker; a timeout kills every function's state.
- **Lossy export**: layouts, cell types and function values are dropped; replay can interleave.
- Smaller: cron day rules are not standard, a bag stores the whole array as a new row on every append,
  a diamond fires a node on the first arrival only.

**What is worth keeping** (all of it in the engine or the dialects):

- Nodes at paths, wired by path-prefix subscription; the nearest match wins; diamonds allowed, loops cut.
- The cascade order, frames (`at`), own-effects, revocation as a `del`, per-subject nodes.
- `Kind` as the plug-in seam, and `deliver` returning "yielded nothing" as the null-gate.
- `fromPath` as a function's second argument (multi-input functions with no graph language).
- A bag delivers the appended item, not the array; generators with a seed on restart.
- The display is a property of the card, not of the node.
- Every write carries `changed_by` and `is_ai`: the seed of the ledger.
- `see`: what a node listens to and what it triggers.
- The spec's conformance discipline, and `can_you_2`'s stories as acceptance tests.

## The design

### One delta document per owner

*Changed after review (29 Sep): the first draft said "the whole graph is one delta document". Fable
read delta's source and found that every write to a list-mode document clones the whole cached
document for its inverse (`sqlite.ts:1176`) and re-reads it after commit (`:1230`); on Postgres
`delta_apply_logged` opens the whole document for `v_before` on every logged write (`001g:146-149`).
One document for one graph would make every `set` cost the size of the graph, and one lock would
serialise everything. So the graph is partitioned from the start.*

A graph is **one delta document per owner** (`graph:<owner>`), and a very large owner splits by
top-level path prefix into more. Inside it, the tables are:

| Table | Columns | Note |
|---|---|---|
| `nodes` | `id` (serial), `path`, `kind`, `definition`, `value` (`json`), `error`, `owner` | Doings only. `temporal: true`: the graph as it stood at time T comes free, through `open_at` |
| `facts` | `id`, `path`, `value` (`json`), `at` | Facts and everything fed by a live source (see "What is recorded"). Written with `undoable: false`, so a fact never sits on a row a doing's undo guards |
| `edges` | `id`, `listener` (path), `source` (path), `made_by` | Paths as text, **not foreign keys**: the spec lets you listen to a node that does not exist yet |

- **Ids are serial** (the storage rule, never text ids); a path is a column, and the engine keeps the
  path → id map, built from the echo of each write (`add /nodes/-` names the row server-side).
- **A path is unique because the engine says so.** Delta has no unique constraint
  (`schema.ts:20-24`), so two concurrent `def`s of one path would make two rows. The single-writer
  queue prevents it in one process; two processes need a lease (below).
- **The document is a list-mode document, not an implied one.** `implied` is for a single document
  keyed by its root id and refuses a scope (`schema.ts:200`); it does not apply here. The engine
  `open`s the document before its first write (`sqlite.ts:1276-1281`).
- **A cascade that crosses owners is two writes.** Cross-owner atomicity is given up on purpose. It
  matches the rule that what crosses to someone else is data: each owner's graph has one writer.

### A cascade is one write

The engine computes a whole cascade against a snapshot, collects every node change that is *recorded*
(see "What is recorded", below) as ops, and sends them as **one write**: one atomic transaction, one
ledger entry, one broadcast. Consequences, from delta's manual:

- **Undo reverses the whole cascade**, and redo replays the stored ops without re-running any
  function, so an `ai` node's output stays as it was.
- **Undoability belongs to the write, so it belongs to the cascade's origin.** Delta takes
  `undoable` per write, not per op (`ledger.ts:44`, `sqlite.ts:1166`), so one write cannot hold both
  an undoable doing and a fact that undo must skip. *Found in review; the first draft promised both.*
  The rule: **a cascade started by a person is one undoable write, derived values included; a
  cascade started by a fact (a cron tick, a source reading) is one write with `undoable: false`,
  derived values included.** Class is decided by what started the cascade, and a derived node takes
  the origin's class for that cascade. This needs no change to delta.
- **A fact must not land on a row a doing's undo guards.** An undo is all-or-nothing on a per-field
  guard: if any changed field was written since, "nothing is walked" and the walk is recorded as
  skipped (`ledger.ts:116`, `:169`; `001g:224`). So a later cron tick on a node a cascade wrote would
  make that cascade's undo refuse. Facts, and any node a live source feeds, live in the `facts`
  table, never in `nodes`.
- **The cursor is ours to name in-process**: one cursor per person, and one per chat turn of Claude's,
  so "undo this whole Claude turn" is one call (the idea `time-travel.md` wanted and never built).
- **A conflict is refused, not overwritten**: an undo will not set back a field someone has written since.

### What is recorded

Not every value a graph produces should reach a table or a ledger. pips's clock was a server-side
generator that yielded `drawClock()` every second (`delay: 1000`); each frame went through the
cascade and was stored, as a temporal row and a log row, and a cron firing every minute grew the
database for ever (`pruneHistory` was never called). Peter had already seen it: `improvements.json`
in pips holds an open item, `ephemeral-nodes`, "skip DB persistence for nodes that update frequently
(clock, sensors)", rated low effort and never built. pips's `@browser` prefix, which runs a function
in the browser so its results never touch the server, was the first step toward the answer.

eta's ticker is the answer, and it had already sorted what a system writes into kinds. Its
`delta.ts` says which is which, and its clock's hands never cross the wire: the applet is "drawn and
driven entirely in the browser", and a story checks that "nothing crosses the wire but the city".

**Every node has one of five classes.** The class is a property of the node's kind, chosen when it is
made, and it decides what the engine does with a value:

| Class | What it is | Stored | On the ledger | Undoable | Sent to subscribers | Example |
|---|---|---|---|---|---|---|
| **Doing** | Something a person did | Yes | Yes | Yes | Yes | The clock's city; a watchlist; a claim |
| **Fact** | Something that happened | Yes | Yes | **No** (`undoable: false`) | Yes | A price tick; a cron tick; a sensor reading that matters; an acknowledgement |
| **Kept** | Something remembered for a person | Yes | **No** | No | Yes | Layouts, filters, where you are on the page |
| **Live** | A reading nobody needs kept | **No** | No | No | Yes, **latest wins** | Who is online; a sensor's current value (delta's `memory` and `source` kinds) |
| **Drawn** | A function of things every subscriber already has | **Not a node** | No | No | **Never** | A clock face; a chart of a value; any display |

Rules that follow:

- **A cascade's ledger entry is one write, of one origin's class** (see "A cascade is one write").
  Kept writes go to their own unledgered document, beside it; live values are published after the
  commit; drawn values are not values at all.
- **A live source that feeds a durable node makes that node a fact.** The first draft said "a live tick
  can feed a durable node"; review showed that puts a fact on a row a doing's undo guards. A node fed
  by a live source is in the `facts` table, and its class is fact.
- **Undo walks back doings.** A fact is recorded and stays; a kept value is not on the ledger to walk.
- **Live is not free in delta.** `registerMemory` is its own document family, written only by a local
  caller and never in the graph's tables or fan-out (`kinds.ts:88`); it does not conflate (every write
  publishes, `:101`) and does not recompute on open (`empty(id)` only, `:72`); a slow socket client is
  dropped, not skipped (`server.ts:441`). "Latest wins" and "recomputed on open" are the engine's
  work. `registerSource` publishes `{ reading, at, stale }`, not a node (`kinds.ts:179`).
- **Live is conflated.** A slow subscriber skips intermediate frames and takes the latest; nothing is
  queued for it. A live value is recomputed when a document is opened, so a restart loses nothing.
- **A value that is a pure function of something every subscriber has is not sent.** Publish the
  inputs and let a display you trust draw it. The clock is one node, `/clock/tz` (a doing), and the
  face is a display on the card, drawn by an island. The deck's separation of data from display
  (XML from XSL) says the same thing.
- **That rule is also a safety rule.** A stranger's function of time is code from a stranger, so it is
  never run. What travels is parameters; the drawing is done by our own island. This keeps "share
  data, never run others' code" true even for displays.
- **Generators are for sources, not for drawing.** A generator that emits real readings is a source
  (a fact, or live). A generator that only draws is a display, and belongs in the browser.
- **Bags and history are bounded.** A bag delivers the appended item and stores a window
  (`maxItems` or `maxAge`), not the whole array as a new row on every append, and old versions of a
  fact table are pruned on a stated schedule.
- **The story check carries over.** eta's stories assert what is sent, and what is not. For a drawn
  node the story is "nothing crosses the wire but the inputs"; for a live node, "a slow subscriber is
  sent the latest, and no more than one".

What delta already provides for this: `undoable: false` for facts, the `memory` kind (never on a
ledger, gone on restart, written in process) and the `source` kind (one shared reading, stale when it
stops) for live values, and, for kept ones, a document registered on its own with no ledger (eta's
desk: `registerDocs(..., { ledger: false })`, "a visit is not history"). That last is a separate
document, so a kept write cannot ride in the cascade's one write: it is made beside it, in the
same process, and the plan accepts that it is not atomic with it. What pears adds is the class on
each node and the rule that decides what goes into the cascade's one write.

### The engine serialises cascades

Delta locks per document only around the read an inverse is taken from. A cascade reads, computes,
then writes, so two could interleave. The engine holds one **single-writer queue per document**:
fine for one process, and the plan says so.

*Two processes is engine work, not a delta feature (review):* delta's per-document advisory lock
(`001g:146`) and row locks make each write safe, and a many-row cascade in two processes is the
deadlock shape delta maps to 409 "send it again" (`listener.ts:89-96`). Nothing in delta protects the
read-compute-write window: a second process would compute on a stale snapshot and its write would
succeed, since a `delta` write carries no version check. A lease per partition needs a
session-scoped `pg_advisory_lock` (not `_xact_`) or a lease row with an expiry, owned by pears, and
each process rebuilds the path → id map from broadcasts. Farming pure functions to workers is
separate and simpler: only the writer commits.

### What pears adds over delta

| Need | From |
|---|---|
| Durable nodes, edges, values | delta tables (written as documents) |
| A write to a node | one delta write |
| Who may read or write which path | delta's scope rule |
| History, undo, redo, time travel | delta's ledger and temporal tables |
| **Path-prefix subscription and the cascade** | **new, in pears** |
| **Kinds: cell, namespace, counter, and compute** | **new, in pears** |
| **The seven-method wire protocol** | **new, in pears** |
| **Pears frames** (deepest changed pointer inside a value) | **new**: delta broadcasts the whole row; the engine derives the frame |

### Compute is a kind

A compute kind, registered by the host (a client cannot introduce a kind, as in the spec). It must
have what the old dialects lacked:

- **Gating is explicit**: "yielded nothing" is the null-gate, and null is a value.
- **Multi-input recompute in topological order**, so a node reached from two sources runs once with
  both inputs current. No diamond glitch.
- **Isolation**: see decision 1.
- **Named sources**, so a compute write can bump what listens to it.

Bag, cron and `ai` are dialects until decision 2 says otherwise; they are written against `Kind` and
none reaches into the engine.

### Identity

The spec makes the subject the transport's, immutable per connection. The plan follows it, and
replaces `?user_id=` with real authentication through delta's `DeltaAuth`. A user exists as a node
(`/users/<id>`), as in pears; permission is delta's scope rule, re-expressing the engine's `reach`
(owner, grant, gate, nobody).

### Data in, and where it can do harm

Foreign data is data. Even so, the places it is *interpreted* need a rule:

- **Rendering**: a foreign `text/html` or `image/svg+xml` cell is shown as text or in a sandboxed
  frame, never as markup in the owner's page.
- **`ai` nodes**: the node's instruction is the owner's; the incoming cell is the operand, delimited.
  The node's output is data again, and it does not trigger a write of its own.
- **The chat's tools**: when Claude reads subscribed data it must not hold `def`. Author with owned
  data; read foreign data in a separate, tool-less step.
- **Size and cycles**: a payload limit per cell, and a cycle cut that raises an event instead of being silent.
- **A cost cap per cascade.** Review measured what one hop costs in delta: a temporal row closed and
  opened (`sqlite.ts:818-822`), a ledger entry holding the ops *and* the inverse as full rows
  (`ledger.ts:256`), and a whole-row broadcast (`:827`). A 3-node cascade of 10 KB values is about
  3 rows, 60 KB of ledger and 30 KB of fan-out. Delta has no batch or op-count limit, so the engine
  must cap ops and bytes per cascade itself, and a spend cap on `ai` and cron nodes, which run
  unattended.

## Build order

Each slice ends in a test that could fail. Nothing later starts until the one before passes.

*Changed after review: the first draft ordered engine, wire, identity, compute, kinds, chat, replay,
and only then a use, which is the order pears and pips were built in. Slice 1's proof was also weak
(see "Review"). The slices below keep the engine small, put something to play with in the first one,
and put safety before anything public.*

1. **A cell and a function on a `nodes` table over SQLite delta.** `def`, `set`, `get`, `on`, one
   cascade, one function. The engine's own test suite, ported (`pears.test.ts`, 575 lines, about 30
   tests), run against the delta-backed store.
   - *Proof, all four, and the last is the one most likely to fail*:
     1. one undo reverses a cascade of three nodes, and one redo replays it without running the function;
     2. an undo of a person-started cascade also reverses its derived values;
     3. a fact-started cascade (a tick) is recorded and undo does not walk it back;
     4. **a cron tick on a node a cascade fed, after the cascade, does not make the cascade's undo
        refuse** (the guard case; the design puts such a node in `facts`).
   - If any fails, the plan's core is wrong and we stop and say so.
2. **The wire.** The seven methods and three notifications over a socket, with frames and revocation.
   `can_you_2`'s stories as acceptance, over real sockets.
3. **Identity and scope.** Real authentication; per-subject nodes; a revoked reader is sent a `del`.
4. **Compute, done properly.** The topological order, explicit gating, isolation per decision 1.
5. **Bag, cron and `ai`** as kinds; sources with `undoable: false`.
6. **The chat.** Claude authors through the same verbs, one cursor per turn, with the injection rules above.
7. **Export and replay**, defined honestly: a request log that replays deterministically, and a
   snapshot that keeps layouts, cell types and function values.
8. **A Sheets source**, then a second delta as a source: the first federation step, and only when a
   second owner exists (see below).

The first slice is small on purpose; it is the only slice this plan asks to start.

## Where it lives

A new package beside eta in `blueshed/`, depending on `@blueshed/delta` and `@blueshed/railroad`
(display). `archive/pears` and `archive/pips` stay as they are, as the record and as a source of
ideas: no code is copied from them without being read again, because both are wrong in the ways above.
The spec and `lib/pears` are the source. Repo locations rule applies: no second clone of delta.

## Decisions for Peter

1. **Isolation of functions.** A real isolate or subprocess per function, or a Worker on a trusted
   machine for now, with the limit stated in the README. Recommendation: the Worker on a trusted
   machine for slices 1 to 3, **an isolate before anything is published** (see decision 4), and never
   a shared worker again. Review noted Claude writes that code in slice 6, and the June Gemini review
   of pears called the sandbox "the most critical issue".
2. **Bag, cron and `ai`: spec kinds or dialects?** Recommendation: dialects, until two sites use one.
3. **Name and home.** A package name and folder. The spec says "pears"; `pips` is the old
   implementation. Recommendation: `pears`, if the old repository is not going to be reused.
4. **Publish something small, and safely.** *Replaces "Is the first customer real?", by Peter's
   decision on 29 Sep: who would use it is not the test; if it is useful and good enough people will,
   and his sons, shown the demo, said "publish it Dad, that's fun".* So the first goal is a public,
   playable thing, not a customer. That makes safety a gate, not a slice: a published pears must have
   **no shared `def` rights** (each visitor a graph of their own, in a sandbox with no `fetch`, no
   filesystem and no `Bun`), **real identity** (not a name in the URL), and **a spend cap** on chat
   and `ai`/cron nodes. Unauthenticated, pips would let any visitor run code on the host and spend
   the API key.
5. **A slice 0 first, or not?** Opus's review proposed rebuilding the one graph that was ever used in
   pips (the `/trading` portfolio view, about two weeks in April) as an eta example first: a
   `registerSource` for quotes, a delta document for holdings, a derived value in plain code, with
   "opened on 10 of the next 20 working days" as the stop condition. It is a cheap way to learn what a
   graph is for. Undecided.
6. **Which dash and Allertons questions stay?** Review found dash needs nothing from pears (its
   authority is a Sheet, 385 lines, done) and Allertons' finals stack is Next.js + Supabase. A Sheets
   source stays in the plan only when a second site needs it. Undecided.

## What we do not know yet

- **Whether the cascade-is-one-write design holds for an `ai` node that takes seconds.** The design
  computes first and writes after, which is right for a cascade that ends, but a long call holds the
  queue. Likely fix: an `ai` node writes its result as its own later write, one entry, with its own
  cursor. To be settled in slice 5.
- **Pears frames** (answered in review): delta's ops reach `/<coll>/<id>/<field>` at most, so a
  change inside a `value` is a whole-column replace and delta cannot carry the frame. The engine
  derives `at` by diffing the old and new value, as `pears.ts` already does (`frameOf`, lines 75-85);
  it holds the previous value, so the cost is small. Nothing to prove in slice 2.
- **The order of a cascade's ops.** The spec's order (deepest edge, then creation) is invisible to
  delta: ops land in the array order sent (`sqlite.ts:896-898`) and a run of replaces on one row merges
  (`:797-803`). The engine keeps the spec's order in the op array so `history` reads it.
- **Per-subject views**: custom read documents against a scope per subject. Slice 3.
- **Whether `lib/pears` is at the seventeenth edition.** It is labelled fifteenth; the review found no
  semantic drift, but nothing was run.
- **The reviews were reads.** Test counts and coverage quoted in `lib/pears/README.md` (100%) are its
  own claim, not ours.

## Review, 29 September 2026

Two reviews read the first draft: **Fable** (technical soundness, against delta's source) and
**Opus** (adversarial: why a third attempt might fail). Both read files; neither ran anything.

**Fable: the core of slice 1 holds; the design as written did not.** One write, one ledger entry,
undo reverses the whole entry, redo replays stored ops without running a function: verified by
structure. Two structural findings, now fixed above: the whole graph as one document made every write
O(graph) and serialised everything (partition by owner), and a fact sharing a row with a doing would
make the doing's undo refuse (classes decide the table). Also fixed: the `implied` word did not apply;
delta has no unique path (the engine owns it); frames come from the engine's own diff, not delta; live
and kept only half-fit delta's kinds; two processes is engine work; a cascade's cost has no delta cap.

**Opus: "don't build this package now; build something smaller."** Its grounds, kept here because they
are evidence, not because they set the direction:

- dash needs nothing from pears (a Sheet, 385 lines, done); Allertons is on Next.js + Supabase; no
  reconciler exists in Workshop; the only graph pips ever really served was the `/trading` portfolio
  view, for about two weeks in April. pips's database: 69 paths, activity on 6 days.
- The first draft's order (engine, wire, identity, compute, kinds, chat, replay, then a use) is the
  order pears and pips were built in. pips's `improvements.json` shows architecture done and
  everything about use left open.
- Most of the five-class table, and a Sheets source (a `registerSource` `read`, about 50 lines),
  already exist in delta and eta; what is new is the path-prefix cascade, compute kinds, the seven-method
  protocol and frames.
- Slice 1's proof mostly tested that delta's multi-op write is atomic, which delta already guarantees.
- Missing: sandbox before slice 6, a spend cap, maintenance by one person (about 12 live stack
  packages already), and a stop condition that can fail.
- Its strongest case for building: pips's chat authoring worked (132 transcripts); undoing a whole
  Claude turn with one call is a real differentiator; delta now solves what the older versions failed
  at; the reference engine is small (`pears.ts` 616 lines, 29 tests).

**Where Peter disagrees, and the plan follows him.** Opus's first question, who would use it, is not
the test (decision 4). The plan keeps the changes that are technical and rejects none of them; it
takes on the ones about order (something playable in the first slice, safety before publishing) and
leaves open the one about a slice 0 (decision 5).

## Federation, later

Federated deltas are the natural next step, and the market Allertons runs (owners, promoters,
sponsors, contractors) is the case: every fact has one home; everyone else holds a read view and
sends requests. Nothing here builds it. It is a source kind, after a second owner runs delta. See the
notes on AT Protocol's Spaces (alpha, August 2026) before designing identity and schemas of our own.
