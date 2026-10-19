# Pages: the bento, and the address

The kernel's parts for drawing a page as a box or a collection, with its drawers and modals, and the
address that says where a person is. How a page is sent is [page.md](page.md).

```ts
// examples/leave/page.ts (trimmed)
const { tool, collectionPage, drawer, confirmModal, addTool, go, site, readingSwitch } = bento({ icon, session: "session", leave: { text: "Sign out", icon: "log-out", path: "/person_id" } });

export function render(sessionId: string): string {
  const { person: me, page, draft } = sessionOf(sessionId);
  const { path, what, which } = parseAddress(page);                // "2026-10?request=1"
  …
  const sheet = what === "request" && r ? requestSheet(t, me, r, path, sessionId) : what === "draft" ? draftSheet(t, me, draft, path, sessionId) : "";
  const modal = what === "confirm" && r && stillMine(me, r) ? confirmModal("Take it back", `Take back ${days(r)}?`, write("team", "remove", `/requests/${r.id}`), go(address(path, "request", r.id)), "Take it back") : "";
  return site(page, layers(collectionPage([{ label: t.name }], { key: "leave", reading, tools, body }), sheet, modal));
}
```

`docs/bento/README.md` says what a page is for: where am I, what can I do. `bento()` (`src/rendering/bento.ts`)
binds the app's icons, its session's docType and the last tool, once. These are defaults, not rules.

- A page is a **box** (`boxPage`: cells in a tray, one may grow into the window; laid out by
  `grid()`, `src/rendering/grid.ts`) or a **collection** (`collectionPage`: the window alone).
  Pick the example by kind: ticker (`examples/ticker/views/page.ts`) for a box, leave for a
  collection. A box's trail is the box's own; when a cell opens, the window gains the way back to
  the box and the cell's name on its own (`boxPage(trail, inPlace, cells, open)`).
- Every gesture is a `data-write` string you hand in.
- A modal is new (`addModal`) or delete (`confirmModal`); there is no bare one.
- **A page displays; an edit or a deed opens over it.** A row shows what a thing is and taps open
  its drawer (`drawer`), where its fields and its deeds are; making a new one is the window's plus
  (`addTool`) opening `addModal`; taking one away is `confirmModal`. No form, input or select
  sits on a page that displays, and no row carries a button beside it: the deed is in its drawer.
  The one exception is the thing the page is for, said in one field at its foot (chat's message).
- **Several kinds of work are a box**, a cell each (`cell`, its count and summary in its head),
  one grown into the window at a time -- never one long scroll of sections. A person whose work is
  one list is a collection.
- Escalate only as the data forces: the cell, then a drawer, a window, a modal. A list of five
  needs no find.
- Find and the reading switch write to the session (`/filter/<key>`, `/hide/<key>`,
  `/reading/<key>`): its `permit` says yes when `collectionsWrite(op)` is not undefined, and its
  `shape` takes `collectionsWrite(op, ui)`, each field it moves replaced whole (the ticker's desk).
- The stylesheet imports `src/rendering/bento.css` first, then says its own tokens. `bento.css` styles only
  inside `layers()`: draw every bento page in it (`layers(page, "", "")` when nothing is open).
  Outside it (`body`, `#app`) is the app's to style.
- What opens is a `<button>`, never a `div` with `role="button"` (an applet's SVG figure says
  `role="button"` and answers Enter and Space). A row an applet draws is opened by a `<button>`
  beside the mount (`aria-labelledby`), not around it.
- `data-moving` names what grows (a view transition runs only when its own tag changes);
  `data-reveal` scrolls the chosen row into the clear, one too tall by its top.
- A render keeps the reader's place below a sticky bar; one the client cannot measure is declared
  with `scroll-padding-top`.

## Where you are: the address

Where a person is, is one string on their session, `path?what=which`: the page and the one thing
open over it (`guests?guest=2`, `gifts?new`, leave's `2026-10?request=1`).

- `address(path, what?, which?)` builds one; `parseAddress(page)` reads one.
- Opening a drawer or a modal is going to the same page with it named; closing it is going to the
  page alone. Going anywhere puts away what was open.
- The address is the screen's URL, and the server routes it: name the write that sets it as the
  app's `address` ([example.md](example.md)), and a tab opened at a URL is put there before its
  page is drawn. Put the address in `data-page`, and that write in `data-page-write` (`site()`
  does): the client puts each new address in the URL, and sends the one back and forward reach.
- The stories put people there with `Stories.goTo(address)`. A story's `from`, and each place its
  `seen` names, must be one a control leads to: a button whose `data-value` is the address, or a tap
  an applet names. The URL, `data-page-write` and the back button are not controls: a place reached
  by a link (an email) goes in the cast's own writes.
