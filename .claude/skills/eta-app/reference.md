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

**`render()` returns the whole page, not a fragment.** `assemble()`'s
`renderFor` tries each compartment's `render(sessionId)` in turn and uses the
*first* one that returns a string — this is chain-of-responsibility, not
composition. `examples/chat/compartments/room.ts::render()` returns the room
selector or the entire chat screen, not just "the room's bit of the page";
`session.ts::render()` returns the whole name-entry form, or `undefined` to
defer to the next compartment (room) once a name exists. Only one compartment
renders on any given turn. This is why render *order* is meaningful (set in
`Example.compartments`) and why a compartment's `render()` often reads *other*
documents too (`room.ts::render()` reads `sessionDoc` to decide whether to
show the room selector or the chat screen) — it has to produce the full
picture for whatever screen it's in charge of, not just its own slice.

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

**Vocabulary, informally: the tray and tools.** change-request.md item 10 names two things this
reference has so far just called "the session compartment" and "the undo/redo/logout buttons".
The session is **the tray**: the ground the other compartments sit on -- which page a tab is on,
which drawer is open, how a collection is read -- not a place of its own on the page. Undo, redo,
and leaving (logging out, leaving a room) are **tools**: verbs beside the compartments, on the
box, not in one. As of this writing these are names, not yet a different contract -- the tray is
still wired exactly like any other compartment (see item 10's own "How" for the structural split:
`Example.compartments` will list only real compartments, and the tray and the ledger will keep
the same contract minus `render`).

## The `Example` seam

`src/example.ts`:

```ts
export type Example = {
  name: string;             // namespaces its migrations
  compartments: Compartment[];      // render order; kernel appends its own ledger compartment after these
  active(sessionId: string): boolean; // may this session write at all right now?
  index: HTMLBundle;        // served at "/"
  routes?: Record<string, Bun.Serve.BaseRouteValue | RouteHandler>; // merged in; a kernel route of the same path wins
};
```

`examples/chat/index.ts` is the whole thing an example needs:

```ts
export const example: Example = {
  name: "chat",
  compartments: [session, room],
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

`src/start.ts` resolves `examples/${ETA_EXAMPLE}/index.ts` (env var,
default `chat`) and passes its `example` export to `createServer`. One
process serves exactly one example — calling `createServer` with a
*different* `Example` object while a server for the first is still running
throws.

## The `Compartment` contract

`src/compartments/compartment.ts`:

```ts
export type WriteResult = { version: number; applied: PatchOp[]; rendered?: boolean };

export type Compartment = {
  docType: string; // e.g. "session", "room" — what this compartment owns on the wire
  render?(sessionId: string): string | undefined; // this session's view, or undefined to defer to the next compartment
  resolveDoc(ws): string | undefined; // the doc id this connection currently sees for its docType
  permit(ws, op: PatchOp): boolean;   // may this connection apply op?
  write(ws, docId: string, ops: PatchOp[]): WriteResult; // apply + echo + side effects
  replay?(ws, docId: string, ops: PatchOp[], undoes: number): WriteResult; // undo's write, skipping permit()
  fragments?(ws, docId: string, result: WriteResult): HtmlOp[] | undefined; // the delta in HTML's terms, per connection; [] = nothing changed here; undefined = send the page
  onOpen?(ws): void;
  onClose?(ws): void;
};
```

### `rendered` — the double-render guard

`server.ts`'s dispatcher pushes a fresh full render to the writing
connection automatically after every `write`/`replay`, *unless* the result
says `rendered: true`. That default is right for a single-viewer document
like `session` (nothing else needs telling). It's wrong for a **broadcast**
document like `room`: `write`/`replay` already pushes a render to every
member (including the writer) via its own notify step, so the dispatcher's
automatic render would be a second, redundant one for the writer.
`examples/chat/compartments/room.ts` opts out accordingly:

```ts
write(ws, roomName, ops) {
  // ...
  echoAndNotify(roomName, result.version, result.applied); // renders every member, including this one
  return { ...result, rendered: result.applied.length > 0 };
},
replay(ws, roomName, ops, undoes) {
  // ...
  echoAndNotify(roomName, result.version, result.applied);
  return { ...result, rendered: true }; // unconditional: replay always changed something
},
```

If a new example's compartment broadcasts to more than one connection, set
`rendered: true` on any write path that already pushed its own render —
otherwise the writer gets rendered twice per write.

### `fragments` — the delta in HTML's terms

A full page per write is the default and the fallback. A compartment that can say which elements a
write touched answers `fragments(ws, docId, result)` with HTML ops instead:

```ts
type HtmlOp = { op: "replace" | "add"; target: string; html: string } | { op: "remove"; target: string };
```

`replace` morphs one element (give it an id); `add` appends inside one; `remove` takes one out.
`[]` means nothing on this connection's page changed and nothing is sent; `undefined` declines
and the page goes out. For the kernel to ask, the compartment's `echoAndNotify` must name the write
in its render request: `renderRequested.emit({ sockets, write: { docType, docId, result } })`.
Chat answers every room write (`examples/chat/compartments/room.ts`); the wedding answers a look or
a choice per viewer's page and declines the rest (`examples/wedding/compartments/household.ts`).
Anything the applet shows goes as its new `data-props`, whole.

Compartments never import each other's internals — they talk only through
`src/compartments/bus.ts` events (`createEvent()`/`.on()`/`.emit()`). Example:
`sessionPatched` fires after any successful session write so `room.ts` can
react to room-membership changes without importing `session.ts`.

`src/compartments/index.ts`'s `assemble(example)` wires one example's compartments
into a running set: it appends the kernel's own ledger compartment (reached only
by `docType`, never part of render/inspect order), builds the `docType ->
Compartment` map `server.ts`'s dispatcher uses, and returns `renderFor`/
`inspectFor`. Render order matters — the first compartment whose `render()`
returns non-`undefined` wins (chat decides "no name yet" before "no room
yet" makes sense).

### `write` vs `replay`

`write()` is a fresh request against a document's normal writable surface —
`permit()` has already said yes. `replay()` is the ledger walking back an
earlier write: it applies already-shaped ops (a recorded inverse) and echoes
exactly the way `write()` would, but skips `permit()` entirely, since it
isn't a new request. Compartments reached only by `docType` (like ledger itself)
don't implement `replay` — nothing ever undoes onto them.

`examples/chat/compartments/session.ts` shows the shared-echo pattern: both
`write` and `replay` call `sessionDoc.patch(...)` then a shared
`echoSessionPatch()` (exported so the ledger's replay path can reuse the
exact same echo a direct write produces):

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
- **Server -> client**: `{"type": "render", "html": "..."}` (a full view,
  morphed in) or `{"type": "patch", "doc", "version", "ops"}` (an echo of
  what was just applied, recorded into the client's `window.eta.docs()`
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

Elements with `data-autoscroll` (e.g. `<ul class="messages" data-autoscroll>`)
are automatically pinned to the bottom on render if new child nodes were
added, without disturbing scroll position during presence or other unrelated
updates.

## Applets — the escape hatch for client-side state

Three ways an applet's data reaches it, from cheapest to dearest on the wire:

1. **Props once, then the document's own patches.** The element names the document
   (`<div data-applet="board" data-doc="ticker" data-props=...>`), the applet implements
   `patch(el, ops)`, and the compartment's `fragments` answers `[]` for that page: after the first
   render only the patch echo crosses the wire (`examples/ticker/applets/board.ts`). Use it when
   the applet's props are a subtree of one document and the document changes often.
2. **New props on a fragment render.** The compartment replaces the applet's element as a fragment
   with new `data-props`; the morph calls `update(el, props)` (`examples/wedding/applets/photo.ts`).
3. **New props on a full render.** The default, when a compartment has no `fragments`.

An applet with nothing of the app in it -- a clock -- takes its props once and never hears from
the server again (`examples/ticker/applets/clock.ts`).

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
the client throws immediately on load.

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
