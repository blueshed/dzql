# Applets (`src/applets.ts`)

Client code for the piece of a page a redraw would destroy: when to write one, how it gets its data, how the stories count its controls, and islands.

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

## How an applet gets its data: the document it watches

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
  for afresh. A render is compared with the props the client holds, not with the mount's attribute
  (still the first render's), so a page drawn afresh after the socket went is what it draws.
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

When the app's document is one big one, cut the applet's from it in `delta.ts` ([documents.md](documents.md)): a second document
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
- Where the applet shows whole rows, a plain document over just their collections is told field
  by field: `defineDoc("strip:", { root: "trips", include: ["bases", "stops"] })`. It includes
  every column, so a note goes to it as its stop's note, and a heart, in rows of its own, not at
  all. Name its columns (`columns: { stops: ["day", "title"] }`, delta's) and it is told only what
  it shows.
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

## An applet's controls

An applet's controls are drawn in the browser, so the stories cannot find them in the page. Its
mount says exactly what they write instead: a document, an op and a path each, where a segment
that is only `*` is any one member (an id the applet reads from its props), never `-`: an applet
that appends to a list names the `-` itself (`["trip", "add", "/events/*/party/-"]`). Reading a document
(`data-doc`) is not writing it: an applet that says nothing offers nothing (the ticker's clock
face), and its story fails, by name, until the mount says what it sends (the city picker beside
it, `appletWrites(["clock", "replace", "/tz"])`):

```ts
`<div data-applet="calendar"${appletWrites(["session", "replace", "/draft"], ["team", "replace", "/requests/*/starts"], ["team", "replace", "/requests/*/ends"])} data-props="…">`
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

## Islands

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
