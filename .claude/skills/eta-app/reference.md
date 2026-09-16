# eta reference

Detail behind the checklist in `SKILL.md`, with excerpts from `examples/chat`
and the kernel it runs on. `examples/wedding` is the second example: three
documents, a permit surface as a table of paths and ops, applets that take
their data as props (`applets/photo.ts`, `dress.ts`, `menu.ts`,
`picture-field.ts`), and an `Example.routes` entry for uploaded pictures.

## Vocabulary: there is no "view" — a Compartment is model, view, and controller for one idea

eta used to have a `views.ts`: a module of pure rendering functions, fed
data pulled from every document. It's gone (commit `46df7bd`, "Make
server.ts and views.ts agnostic of session/room via Concept modules" — the
`Concept` name it used then, before item 10's rename to `Compartment`) —
it had to import both documents and hardcode their cross-domain render
order itself, which is exactly the kind of thing this codebase doesn't let
one file know. **Don't recreate `views.ts` under a different name.** If a
plan for a new example includes a `views/` directory, a `Renderer`, or
anything whose only job is "take some data, return HTML" separately from
the compartment that owns that data, stop and fold it into the compartment instead.

A **Compartment** (`src/compartments/compartment.ts`) is deliberately *not* layered —
one module is simultaneously the model, the view, and the controller for
one domain idea: it owns a `docType`, decides what's on screen when it's
this compartment's turn to render, decides which writes are allowed, applies
them, and handles this domain idea's own connection lifecycle. Nothing
outside the compartment touches its documents.

**`render()` returns this compartment's own place on the page, wrapped by the
kernel in `<div id="c-<docType>">`.** `assemble()`'s `renderFor` tries each
compartment's `render(sessionId)` in turn and uses the *first* one that
returns a string, wrapped — this is chain-of-responsibility, not
composition, and only one compartment ever renders on a given turn.
`examples/chat/compartments/room.ts::render()` returns the name form, the
room selector, or the chat screen: chat has no tray-absorbing compartment of
its own besides room (its tray, the session document, has no `render` at
all — see "The tray and tools" below), so room's `render()` is *also* where
the tray's old "no name yet" screen lives now, and it's the only compartment
in `Example.compartments`. When one compartment's answer is the only thing
on the page (chat's name form; the wedding's welcome, in
`household.ts::render()`), its wrapper *is* the page — there's nothing else
to compose it with. This is why render *order* is meaningful (set in
`Example.compartments`) and why a compartment's `render()` often reads
*other* documents too (`room.ts::render()` reads `sessionDoc` to decide
whether to show the name form, the room selector, or the chat screen) — it
has to produce the full picture for whatever screen it's in charge of, not
just its own slice.

**An applet is not a smaller view — it's an escape hatch for client-side
state a re-render would destroy.** Every compartment's `render()` output is
just an HTML string, morphed into `#app` fresh on every render; that's
enough for the overwhelming majority of UI (forms, buttons, lists — see the
wire protocol section below). Reach for an applet (`src/applets.ts`) only
when a piece of DOM needs to keep *live client-side JS state* across a
render that would otherwise blow it away — `room-picker`'s typed filter is
the one example in chat: without an applet, every render would reset the
input the person is mid-typing into. If nothing in your new UI needs to
survive a re-render like that, you don't need an applet — plain
`data-write` HTML rendered by a compartment's `render()` is the default, not
the exception.

**When do you need a new Compartment vs. a new branch in an existing one's
`render()`/writable paths?** A new `Compartment` means a new `docType` — a new
kind of document with its own identity, its own row(s) in the ledger, its
own undo history. A new *screen state* of something that's still the same
document (e.g. an RSVP form vs. a thank-you message, both about the same
guest) is just another branch inside that document's existing compartment, not
a reason to create a second one.

**The tray and tools.** A session or visit document (which page a tab is on, which drawer is
open, how a collection is read) is **the tray** (`Example.tray`): the ground the other
compartments sit on, not a place of its own on the page. It keeps every part of the `Compartment`
contract except `render` -- there's nothing for the kernel to wrap in a `<div id="c-<docType>">`,
so it isn't listed in `Example.compartments` and never competes for the page. Whatever it used to
show before item 10 (chat's name form, the wedding's welcome) moved into whichever domain
compartment is tried first (`room.ts`, `household.ts`) -- see the previous section. The kernel's
own ledger compartment keeps the same shape minus `render` too, for the same reason: it's the
tools' document (undo, redo), not a place. Undo, redo, and leaving (logging out, leaving a room)
are **tools**: verbs beside the compartments, on the box, not in one -- rendered by whichever
compartment or the tray currently owns the button, not by a compartment of their own.

A tray write has no owning element to fall back to, so it always asks (`renderRequested.emit`)
for the whole page -- see `examples/chat/compartments/session.ts::echoSessionPatch()` and
`examples/wedding/compartments/session.ts::write()`, both a bare `renderRequested.emit([ws])`
(no `write: {docType, docId, result}` -- there's no compartment for the kernel to ask `fragments`
of). `Example.tray` is optional: the ticker has none (no sign-in, anyone may write a tick).

## The `Example` seam

`src/example.ts`:

```ts
export type Example = {
  name: string;             // namespaces its migrations
  compartments: Compartment[];      // render order; kernel appends the tray (if any) and its own ledger compartment
  tray?: Compartment;        // the ground the compartments sit on; no render, not in `compartments`
  active(sessionId: string): boolean; // may this session write at all right now?
  index: HTMLBundle;        // served at "/"
  routes?: Record<string, Bun.Serve.BaseRouteValue | RouteHandler>; // merged in; a kernel route of the same path wins
};
```

`examples/chat/index.ts` is the whole thing an example needs:

```ts
export const example: Example = {
  name: "chat",
  compartments: [room],
  tray: session,
  active: (sessionId) => sessionDoc.read(sessionId).name !== null,
  index,
};
```

`active()` exists because the kernel can't derive "is this session logged
in" generically — only the example knows what that means for its own
documents. The kernel uses it in the ledger compartment to gate undo: a stale,
logged-out tab shouldn't be able to undo a write made before it went stale.
(Domain compartments should also consult their session document in `permit()`
to guard their own regular writes).

Every example's actual list of documents is bigger than `compartments` alone: the kernel adds
`tray` (if the example has one) and its own ledger compartment when it calls `assemble(example)`
-- both are reached only by docType, for write dispatch and lifecycle (`onOpen`/`onClose`), never
part of the page's render order.

`src/start.ts` resolves `examples/${ETA_EXAMPLE}/index.ts` (env var,
default `chat`) and passes its `example` export to `createServer`. One
process serves exactly one example — calling `createServer` with a
*different* `Example` object while a server for the first is still running
throws.

## The `Compartment` contract

`src/compartments/compartment.ts`:

```ts
export type WriteResult = { version: number; applied: PatchOp[] };

export type Compartment = {
  docType: string; // e.g. "session", "room" — what this compartment owns on the wire
  render?(sessionId: string): string | undefined; // this compartment's own place on the page, or undefined to defer -- omit entirely for a tray or the ledger
  resolveDoc(ws): string | undefined; // the doc id this connection currently sees for its docType
  sees?(ws, docId: string): boolean; // does this connection see docId -- not just its own resolveDoc; defaults to resolveDoc(ws) === docId
  permit(ws, op: PatchOp): boolean;   // may this connection apply op?
  write(ws, docId: string, ops: PatchOp[]): WriteResult; // apply + notify(); asks every connection that sees the doc to update, itself included
  replay?(ws, docId: string, ops: PatchOp[], undoes: number): WriteResult; // undo's write, skipping permit()
  fragments?(ws, docId: string, result: WriteResult): HtmlOp[] | undefined; // the delta in HTML's terms, per connection; [] = nothing changed here; undefined = decline (the kernel's own default applies)
  onOpen?(ws): void;
  onClose?(ws): void;
};
```

### Who sees a document: `sees`, `audienceFor`, `notify`

Change-request.md item 1: a compartment answers "who sees this document", the kernel keeps the
one registry of open connections that question needs, and neither has to be built twice per
example. `src/compartments/audience.ts` exports three things:

- `audienceFor(docType, docId, exclude?)`: every open connection whose owning compartment says it
  sees `docId` -- `sees?(ws, docId)` if implemented, else `resolveDoc(ws) === docId` (right for a
  document with one writer who is also its only reader -- most of them). `exclude` leaves one
  socket out regardless (an announcement that doesn't need telling about itself).
- `notify(docType, docId, result)`: echoes `result`'s applied ops to `audienceFor(docType, docId)`
  and asks that same audience for a render (`renderRequested.emit`) -- the one thing besides
  applying the patch that a `write()`/`replay()` needs to do. A no-op result (nothing applied)
  tells nobody.
- `allOpenSockets()`: every open connection, full stop -- for the rare write whose effect is
  genuinely everyone's concern (an aggregate view fed by more than one document), not just this
  document's own audience. Reach for `audienceFor` first; the wedding's board and household still
  use this for the *render* half of their notify (an aggregate total or an "everyone" photo can
  change from any household's write) while narrowing the *patch* echo to `audienceFor` -- the raw
  ops of a document that isn't yours would be meaningless on your own page.

Most compartments never implement `sees` at all: `resolveDoc`'s default is exactly right when a
document's writer is also its only reader (chat's `room`, the wedding's `board`, the ticker's
`clock`/`watchlist`, all unchanged by item 1). Implement it when someone else genuinely sees a
document without writing it -- the wedding's `household`:

```ts
sees(ws, docId) {
  const session = sessionDoc.read(ws.data.sessionId);
  return session.kind === "couple" || (session.kind === "household" && session.code === docId);
},
```

### Rule 2: a write re-renders its own compartment's element, by default

There's no `rendered` flag on `WriteResult` — a write's own connection is rendered exactly like
every other connection that sees the document, and it's the compartment's job to ask (`notify`,
above) for *all* of them, itself included; the kernel never renders the writer a second time on
its own. What "ask" gets back, absent `fragments`, is no longer the whole page: `server.ts`'s
`renderRequested` listener calls the *owning* compartment's own `render(sessionId)` and sends a
single `replace` of `#c-<docType>` instead — the whole page is the fallback only when there's no
owning compartment to re-render this way (a tray or ledger write) or that compartment's `render`
itself declines for this session right now (e.g. the write's docType belongs to a compartment a
couple viewer's session doesn't currently match — wedding's `board` vs. a household viewer).
`examples/chat/compartments/room.ts` asks for everyone in the room, including the writer, on
every write:

```ts
write(ws, roomName, ops) {
  // ...
  echoAndNotify(roomName, result); // notify("room", roomName, result) -- every member, including this one
  return result;
},
```

A new example's compartment should do the same: call `notify()` (or, if someone sees the document
without writing it, implement `sees` first so `notify()`'s audience already includes them) and
include the writer in it. Forgetting to is a real bug -- the writer's own connection would never
hear back.

### `fragments` — smaller than the compartment's whole element

A compartment that can say which elements a write touched can answer smaller than its own whole
element -- `fragments(ws, docId, result)` with HTML ops instead:

```ts
type HtmlOp = { op: "replace" | "add"; target: string; html: string } | { op: "remove"; target: string };
```

`replace` morphs one element (give it an id); `add` appends inside one; `remove` takes one out.
`[]` means nothing on this connection's page changed and nothing is sent; `undefined` declines,
falling back to rule 2's own-element default (not necessarily the whole page — see above).
`notify()` is what makes the kernel ask at all -- it names the write in the render request it
emits (`{ sockets, write: { docType, docId, result } }`) for `server.ts`'s listener to read.
Chat answers every room write (`examples/chat/compartments/room.ts`); the wedding answers a look
or a choice per viewer's page and declines the rest (`examples/wedding/compartments/household.ts`)
-- its `board` compartment implements no `fragments` at all, so every board write falls through to
rule 2's default (a couple viewer's own `#c-board` replaced whole). Anything the applet shows goes
as its new `data-props`, whole.

Compartments never import each other's internals — they talk only through
`src/compartments/bus.ts` events (`createEvent()`/`.on()`/`.emit()`). Example:
`sessionPatched` fires after any successful session write so `room.ts` can
react to room-membership changes without importing `session.ts`.

`src/compartments/index.ts`'s `assemble(example)` wires one example's compartments into a
running set: it appends the tray (if any) and the kernel's own ledger compartment -- both reached
only by `docType`, never part of render order, though the tray's own document is still worth
`inspect`ing (chat's records to the ledger) while the ledger itself isn't -- builds the `docType
-> Compartment` map `server.ts`'s dispatcher uses, and returns `renderFor`/`inspectFor`. Render
order matters — the first compartment whose `render()` returns non-`undefined` wins (the
wedding's `household` decides "not this code" before `board` gets a turn).

### `write` vs `replay`

`write()` is a fresh request against a document's normal writable surface —
`permit()` has already said yes. `replay()` is the ledger walking back an
earlier write: it applies already-shaped ops (a recorded inverse) and echoes
exactly the way `write()` would, but skips `permit()` entirely, since it
isn't a new request. Compartments reached only by `docType` (like ledger itself)
don't implement `replay` — nothing ever undoes onto them.

`examples/chat/compartments/session.ts` (the tray -- see above) shows the shared-echo pattern:
both `write` and `replay` call `sessionDoc.patch(...)` then a shared `echoSessionPatch()`
(exported so the ledger's replay path can reuse the exact same echo a direct write produces;
it's also where the tray's bare `renderRequested.emit([ws])` lives):

```ts
write(ws, id, ops) {
  const before = sessionDoc.read(id);
  const result = sessionDoc.patch(id, ops);
  return echoSessionPatch(ws, before, result.version, result.applied);
},
replay(ws, id, ops, undoes) {
  const before = sessionDoc.read(id);
  const result = sessionDoc.patch(id, ops, undoes);
  return echoSessionPatch(ws, before, result.version, result.applied);
},
```

## Documents: `read`/`patch`

A document module owns its own SQL (prepared statements at module load) and
is the *only* place that decides what value is valid — `permit()` only
answers "may this connection write this path at all," never "is this value
okay." `examples/chat/documents/session.ts::patch()`:

- Parses the JSON Pointer path (`parsePointer`) to find which field is being
  written.
- Validates and trims the value; an invalid one is silently skipped (`continue`),
  not pushed to `applied`.
- Builds the SQL-level effect and appends the applied op plus its inverse
  (`inverse.unshift(...)`, since inverses undo in reverse order).
- Decides whether the write is the person's to undo. A fact from outside -- a price tick, a
  reading -- is recorded with `undoable: false` (the sixth argument to `record()`): on the
  ledger for history, never under Undo (`examples/ticker/documents/market.ts`). A document
  that is pure UI state (the wedding's session) records nothing at all.
- Calls `record(prefixDoc(docType, id), applied, inverse, sessionId, undoes)` once,
  after the loop, and returns `{version, applied}`. Note: pass the acting
  `sessionId` to `record()`, not the document `id` (for a session doc they are
  the same, but for shared documents like `room` they differ; `nextUndo(sessionId)`
  derives undo candidates by session, so attributing writes to `sessionId` is
  essential).

A `replace` op's inverse can't always be another `replace` — restoring "no
value" (a field that was previously unset) must be a `remove`, or undoing a
first-ever write would silently do nothing. See `restoreOp()` in
`documents/session.ts` for the pattern.

`patch()` is one transaction (change-request.md item 11): wrap the exported function itself in
`db.transaction(...)`, keeping its own name for stack traces and every call site unchanged --
`export const patch = db.transaction(function patch(id, ops, ...) { ... });`. Every statement the
function runs (including, through a helper like `householdDoc.addGuest`, a different document's)
and the `record()` call at the end commit together or roll back together; `bun:sqlite` turns a
transaction called from inside another into a savepoint, so this composes for free. `src/db.ts`
also sets `PRAGMA journal_mode = WAL` once, right after the database opens -- one sync per commit
instead of one per statement, and readers stop waiting on a writer; an in-memory database (the
test suite's) answers it with `"memory"` and is otherwise unchanged.

## Opting a write out of the ledger

A document is off the ledger by omission, not by a flag: if its `patch()` never calls
`record()`, its version stays 0 (or, for a write that calls `record()` sometimes and not others,
simply doesn't advance on the calls that skip it) and `nextUndo()` never finds anything to walk
back for it. Two real examples: `examples/wedding/documents/session.ts`'s `patch()` never records
at all (a visit's page/drawer state isn't the wedding's history -- undo there means "take back my
last answer," never "go back a page"); `examples/chat/compartments/room.ts`'s presence ops
(`add /people/-`, `remove /people/<index>`) are sent as plain room patches but built and echoed
without ever touching `record()` (undoing an arrival is nonsense). There's no `Compartment`-level
flag for this today -- if the kernel ever needs to ask "is this document on the ledger" generically
rather than each document answering by omission, `Compartment.ledger?: false` is the shape.

## The ledger and undo

`src/ledger.ts` is the single source of truth for undo — there's no separate
"undo stack" state.

- `prefixDoc(docType, docId)` / `splitDoc(doc)`: the ledger's `doc` column is
  always `"<docType>:<docId>"`.
- `record(doc, ops, inverse, sessionId, undoes?)`: inserts one row per
  successful patch (a no-op patch with empty `ops` doesn't create a version).
  `undoes` marks a row as *itself* the replay of an earlier row, so it's
  never picked as a future undo target.
- `nextUndo(sessionId)`: the newest row this session wrote that is (a) not
  itself an undo and (b) not yet undone — derived entirely from the table via
  `id NOT IN (SELECT undoes FROM ledger WHERE undoes IS NOT NULL)`.
- `history(doc, limit)`: most recent entries for a `doc`, for `inspect`.

`src/compartments/ledger.ts`'s `createLedgerCompartment(lookup, active)` is a
factory (not a fixed compartment) so it can find whichever compartment owns the
document an undo lands on: it finds `nextUndo(sessionId)`, splits `.doc`
into `{docType, docId}`, and calls
`lookup(docType)!.replay(ws, docId, entry.inverse, entry.id)`. No
example-specific dispatch, no cross-compartment event needed for undo itself.

## Migrations and namespacing

`migrate(db, dir, namespace, legacy?)` (`src/migrate.ts`) records each
applied file as `${namespace}/${file}` in the shared `_migrations` table, so
the kernel (namespace `"eta"`) and any example (its own `name`) can't
collide on a filename like `0001_*.sql`. `legacy` maps an old recorded name
to its current file, for a dev database that ran migrations before a rename
or before namespacing existed — safe to leave in place, idempotent.

`examples/chat/db.ts` is the pattern every example's `db.ts` follows:

```ts
import { migrate } from "../../src/migrate";
import { db } from "../../src/db";

migrate(db, `${import.meta.dir}/migrations`, "chat");
export { db };
```

Every document module imports `db` from *this* file, never `../../src/db`
directly — otherwise a document's module-load-time prepared statements
could run before this example's migrations have.

## The wire protocol

HTML is the only vocabulary on the wire — no JSON tree of app state, ever.

- **Client -> server**: `{"doc": "<docType>", "ops": [PatchOp, ...]}` over
  the one websocket (`/ws`). A `PatchOp` is `{op, path, value?}` (JSON Patch
  shaped) where `path` is a JSON Pointer — never a function/verb name.
- **Server -> client**: `{"type": "render", "html": "..."}` (a full page,
  morphed in) or `{"type": "render", "ops": [HtmlOp, ...]}` (rule 2's default
  -- typically one `replace` of the owning compartment's `#c-<docType>`
  element, or a compartment's own smaller `fragments` answer), morphed one
  target at a time; or `{"type": "patch", "doc", "version", "ops"}` (an echo
  of what was just applied, recorded into the client's `window.eta.docs()`
  op-log — the *only* client-side domain state allowed).
- `{"type": "inspect", "limit"?: n}` -> `{"type": "inspect", "docs": [{doc, version, entries}, ...]}`:
  legibility without a log line, built by `assemble()`'s `inspectFor`. `entries` is that many of
  the document's most recent ledger rows (default 1, i.e. just the latest); the CLI's `watch`
  asks for more to catch up on history before following live patches.

An element declares what it writes via `data-write='{"doc":...,"op":...,"path":...}'`:

```html
<form data-write='{"doc":"session","op":"replace","path":"/name"}'>
  <input name="name" required />
</form>
```

`src/client/app.ts` reads `data-write` on submit (value = the form's single
named field, or a record of all fields if there's more than one — see
`src/client/form-value.ts`) or on click of a `[data-write]` element that isn't
itself a form (value = its `data-value`, or no value at all for a `remove`).
A form resets only on the server's patch echo of its own write, so a write
that is ignored or rejected leaves the person's typed input intact.

### Forms that edit, not create

That contract (one form, one path, reset on echo) fits a form that *creates* something —
inviting a household, adding a course. It doesn't fit a form that *edits* a document already on
the page, field by field, the way the wedding's keep drawers do: a gift's name, its words, its
link, each its own path, none of it wanting a Save button of its own.

For that, put `data-write` on the *fields*, not the form, and mark the form
`data-write-on="blur"` (or `"change"`):

```html
<form data-write-on="blur">
  <input name="name" value="Toaster" data-write='{"doc":"board","op":"replace","path":"/gifts/3/name"}'>
  <input name="link" value="" data-write='{"doc":"board","op":"replace","path":"/gifts/3/link"}'>
</form>
```

When a field inside such a form fires the named event, every `[data-write]` field in that form
whose live value differs from what the last render put there becomes one op, and all of them go
out together as a single `{doc, ops}` message — editing two fields and then clicking away sends
one write, not two. The comparison is against an input's `value` *attribute* (a `<textarea>` has
none, so its `defaultValue` — the DOM's mirror of its parsed content — stands in), not a
client-side dirty flag; the morph keeps that attribute current, so this stays correct across
renders without any bookkeeping. An editing form never sets the reset-on-echo state (it has no
form-level `data-write` to key that off), so it never resets — a refused edit is handed back
exactly as typed, the way a rejected create-form's input is.

Elements with `data-autoscroll` (e.g. `<ul class="messages" data-autoscroll>`)
are automatically pinned to the bottom on render if new child nodes were
added, without disturbing scroll position during presence or other unrelated
updates.

### `data-moving`: the same element grows into the window (bento-request.md K1)

A render may mark one element `data-moving="<name>"`. When a full render arrives and both the
page as it is and the page as rendered carry an element with the same `data-moving` value,
`src/client/app.ts`'s `render()` gives that element -- and only that one -- `view-transition-name:
moving`, runs the morph inside `document.startViewTransition` (feature-detected with
`"startViewTransition" in document`, not a `declare global` -- lib.dom already has it), and clears
the name afterward. `matchMedia("(prefers-reduced-motion: reduce)")` skips the transition
entirely, same as a browser without support: a plain morph, as always. Fragment renders
(`applyFragments`) never transition -- there's no "page as it was" to compare against a fragment.

The kernel has no client stylesheet of its own, so this is the one thing an example's stylesheet
has to add for `data-moving` to look right rather than merely work: without
`::view-transition-group(moving) { z-index: 1 }`, the moving element animates *under* its
neighbours instead of on top of them (the bento mock-up learned this the hard way -- naming every
compartment, instead of just the one moving, was the original mistake). Nothing else needs naming;
K1 is one attribute, one name, one element, not a general animation vocabulary.

### `data-reveal`: bringing the chosen figure into the clear (bento-request.md K2)

After a full render's morph, if the page now carries an element with `data-reveal` that it did not
carry before -- or carries it on a different element than before -- `render()` calls
`scrollIntoView({ block: "nearest", inline: "nearest" })` on it. This is a client act on a render,
not a scroll position on the wire: the kernel decides nothing about what "reveal" means, only that
the attribute moved. `"nearest"` is deliberate -- it does nothing when the element is already
visible, so a docked panel or a drawer only scrolls the page when the chosen figure would
otherwise be hidden behind it. Making a docked panel actually count as an edge is the example
stylesheet's job: give the panel's own edge (or whatever sits between the reading and it) a
`scroll-margin` matching the panel's width/height, the same way `scroll-margin-top` keeps a sticky
header from covering an anchor-scrolled heading.

### Where a tab is: `data-page` and `data-page-write`

An example that keeps "which page a tab is on" on the session (the wedding's
`household/asks`, `households/3`) can put that page in the URL too, so the browser's back button
and a shared link work. Mark any element within `#app` with both:

```html
<div data-page="households/3" data-page-write='{"doc":"session","op":"replace","path":"/page"}'>
```

The kernel reads this after every full render and mirrors `data-page` into `history.pushState`;
on `popstate` (the back/forward buttons) it reads the URL's own page back out and sends
`data-page-write`'s write with that value. The session document stays the one place the page
actually lives — a reload lands where the tab was even with cookies alone — the URL just follows
it, and follows it back. On the very first render after a fresh connect, if the URL already names
a page the session doesn't have (someone opened a link while already signed in), the *session* is
caught up to the URL, not the other way round — otherwise the render that follows connecting would
snap the address bar back to the session's default and the link would have done nothing.

For a reopened or shared link to reach the client to read at all, the server has to answer *some*
page to any path — see `src/server.ts`'s `"/*": example.index` fallback, which is generic and
already there; nothing about it is per-example. The wedding wires the mechanism itself into
`views/shared.ts`'s `frame()` (an optional `page` parameter, passed by `views/household.ts` and
`views/board.ts`; the pre-login welcome has no page yet). This is opt-in per example — chat's
`room` on the session was left alone (change-request.md item 3's Why explains why it grates less
there); skip it entirely unless the back button or a shareable link is something the example
actually wants.

## Applets — the escape hatch for client-side state

Three ways an applet's data reaches it, from cheapest to dearest on the wire:

1. **Props once, then the document's own patches.** The element names the document
   (`<div data-applet="board" data-doc="ticker" data-props=...>`), the applet implements
   `patch(el, ops)`, and the compartment's `fragments` answers `[]` for that page: after the first
   render only the patch echo crosses the wire (`examples/ticker/applets/board-applet.ts`). Use it
   when the applet's props are a subtree of one document and the document changes often.
2. **New props on a fragment render.** The compartment replaces the applet's element as a fragment
   with new `data-props`; the morph calls `update(el, props)` (`examples/wedding/applets/photo-applet.ts`).
3. **New props on a full render.** The default, when a compartment has no `fragments`.

An applet with nothing of the app in it -- a clock -- takes its props once and never hears from
the server again (`examples/ticker/applets/clock-applet.ts`).

### Drawing vs. mounting, for coverage that means what it says

`bun test --coverage` only sees a file a test imports in-process. An applet whose drawing is a
pure string-building function is worth testing that way directly -- but if `registerApplet`'s
`mount`/`update` live in the same file, importing it for the drawing test pulls the DOM-touching
half in too, and it shows up "uncovered" even though a real-browser test (`client/app.test.ts`)
drives it on every run. Split it in two: `<name>.ts` keeps the drawing (`dressHtml`, `menuHtml`,
`photoSvg`, `boardSvg`/`sparkline`/`applyOps`, `clockSvg`/`handsAt`/`partsIn`, `cityIn`/`matches`/
`step`) and whatever a `*.test.ts` imports directly; `<name>-applet.ts` keeps
`registerApplet(...)` and the `mount`/`update`/`patch` that touch the DOM, and is imported *only*
by `client/main.ts` -- exactly how chat's `room-picker.ts` (all mounting, no separate drawing
file) has always been imported. That's what keeps it out of the coverage table rather than
dragging a drawing file's number down: `src/applets.ts`'s registry doesn't care which file called
`registerApplet`, so nothing about the split is visible to the kernel or the wire
(change-request.md item 4). Skip the split for an applet with no drawing worth testing on its own
(`picture-field.ts`, which talks to `fetch` and a `<input type=file>` throughout).

Most UI is plain HTML + `data-write`, morphed in on every render — no applet
needed. Reach for an applet (`src/applets.ts`) only when something needs
live state a re-render would otherwise blow away (e.g. `room-picker`'s
typed filter surviving a props update).

```ts
export type Applet = {
  mount(el: HTMLElement, ctx: AppletContext): void | (() => void); // returns optional cleanup
  update?(el: HTMLElement, props: unknown): void; // called instead of remount if the element survives with new data-props
  patch?(el: HTMLElement, ops: PatchOp[]): void; // the ops of the document named in data-doc, as they are echoed
};
```

Render an applet's mount point as `<div data-applet="room-picker"
data-props='{"rooms":[...]}'></div>`. `morph.ts` treats `[data-applet]`
elements as a boundary it never descends into — the applet owns everything
inside by hand. An example registers its own applets in its own
`client/main.ts`, *before* importing the kernel's client:

```ts
import "../applets/room-picker";
import "../../../src/client/app";
```

The kernel's `app.ts` only knows the generic `[data-applet]`/`data-write`
contract; it has no idea any specific applet exists.

`src/client/app.ts` looks up its mount point with a non-null assertion --
`document.querySelector<HTMLElement>("#app")!` -- so `client/index.html`
must contain an element with `id="app"` (chat's is `<main id="app">`), or
the client throws immediately on load. A compartment's own wrapper
(`<div id="c-<docType>">`) is a DOM/morph boundary, not a layout one -- if
`#app`'s CSS depends on something being its direct child (a flex or grid
layout), give the wrapper `[id^="c-"] { display: contents; }` (chat's
`styles.css` has the pattern; it's what made `.messages` stretch to fill
`#app` again after item 10 added the wrapper).

## CLI verbs

`src/cli.ts` handles the kernel's own doc-agnostic commands
(`inspect`/`watch`/`undo`/`write <doc> <op> <path> [value]`) and, if
`examples/${ETA_EXAMPLE}/cli.ts` exists, loads its `aliases` table of short
verbs afterward:

```ts
export const aliases: Record<string, (args: string[]) => { doc: string; ops: PatchOp[] }> = {
  name: (args) => ({ doc: "session", ops: [{ op: "replace", path: "/name", value: args.join(" ") }] }),
  send: (args) => ({ doc: "room", ops: [{ op: "add", path: "/transcript/-", value: args.join(" ") }] }),
};
```

No database import in an example's `cli.ts` — it only builds wire ops; the
CLI process talks to a running server over the same websocket protocol a
browser client would.

## When it looks like you need to touch `src/`

It usually means a seam is missing, not that the example is special. Signs
of a real seam addition (rare) vs. a workaround (avoid):

- Needing a per-example "is this session allowed to write" rule → already
  solved by `Example.active`.
- Needing undo to behave differently for one document → already solved by
  `Compartment.replay`.
- Needing an extra HTTP route (e.g. serving uploaded files) → already solved
  by `Example.routes`.
- Wanting the kernel to know about a specific applet, document, or compartment
  by name → don't; that coupling is exactly what `assemble(example)` and the
  applet registry exist to avoid. If something seems to require it, the fix
  is almost always a new generic seam on `Example`/`Compartment`, added once, in
  the kernel — not a special case for one example.

## The tray: laying out a box

A page that is a box shows one compartment per thing on its ground. Do not hand-write its grid.
`src/tray.ts`'s `tray(compartments, columns)` takes the compartments in the box's own order, each
with a `key` (`slug()` its label) and how much of the tray it deserves (`span` in columns, `rows`),
and places them first-fit without reordering; a gap at the end of the last row goes to the
compartment before it. It returns `areas` (for `grid-template-areas`) and, per compartment, its
`corners`: which of the tray's corners it sits in, so a view can cut it into the tray -- square
where its walls meet another compartment, the tray's curve (less the wall) only in its corners.
It is viewport-free: compute one tray per column count you lay out for (the wedding does three and
one) and let the stylesheet pick by width. See `examples/wedding/views/bento.ts`'s `boxPage` and
`examples/bento/README.md` for the rules the tray serves.
