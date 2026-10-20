# Pages: the bento, and the address

The kernel's parts for drawing a page as a box or a collection, with its drawers and modals, and the
address that says where a person is. How a page is sent is [page.md](page.md).

```ts
// examples/leave/surfaces.ts
export const surfaces = bento({ icon, session: "session", leave: { text: "Sign out", icon: "log-out", path: "/person_id" } });

// examples/leave/page.ts (trimmed): each resource's part of the page, composed

export function render(sessionId: string, page: string): string { // page: where this tab stands
  const { person: me, draft } = sessionOf(sessionId);
  const { path, what, which } = parseAddress(page);                // "2026-10?request=1"
  …
  const sheet = what === "request" && r ? requestSheet(t, me, r, path, sessionId) : what === "draft" ? draftSheet(t, me, draft, path, sessionId) : ""; // the team's view, the session's
  const modal = what === "confirm" && r && stillMine(me, r) ? takeBack(r, path) : ""; // the team's view: confirmModal(...)
  return site(page, layers(collectionPage([{ label: t.name }], { key: "leave", reading, tools, body }), sheet, modal));
}
```

`docs/bento/README.md` says what a page is for: where am I, what can I do. `bento()` (`src/rendering/bento.ts`)
binds the app's icons, its session's docType and the last tool, once. These are defaults, not rules.

- A page is a **box** (`boxPage`: cells in a tray, one may grow into the window; laid out by
  `grid()`, `src/rendering/grid.ts`) or a **collection** (`collectionPage`: the window alone).
  Pick the example by kind: ticker (`examples/ticker/page.ts`) for a box, leave for a
  collection. A box's trail is the box's own; when a cell opens, the window gains the way back to
  the box and the cell's name on its own (`boxPage(trail, inPlace, cells, open)`).
- Every gesture is a `data-write` string you hand in.
- A modal is new (`addModal`) or delete (`confirmModal`); there is no bare one.
- **A page displays; an edit or a deed opens over it.** A row shows what a thing is and taps open
  its drawer (`drawer`), where its fields and its deeds are; making a new one is the window's plus
  (`addTool`) or the heading's deed opening `addModal`; taking one away is `confirmModal`. No
  form, input or select sits on a page that displays. A row carries at most one deed of its own,
  the one the line is for (Add, on a menu): `row({ act })`, its name then the button that opens
  it; every other deed is in its drawer. The one exception is the thing the page is for, said in
  one field at its foot (chat's message).
- The rest of a box, as Paintbrush's design draws it: a **heading** (`boxPage(…, heading)`: the
  name large under the trail, a logo, the page's own deeds and its tools; at the root, alone), a
  **run** heading a group of rows (`run`), a **total** (`row({ total })`), a **pin** in a cell's
  head or on a line (`pin`, `cell({ pins })`), a cell two rows tall (`cell({ rows })`).
- **Several kinds of work are a box**, a cell each (`cell`, its count and summary in its head),
  one grown into the window at a time -- never one long scroll of sections. A person whose work is
  one list is a collection.
- Escalate only as the data forces: the cell, then a drawer, a window, a modal. A list of five
  needs no find.
- Find and the reading switch write to the session (`/filter/<key>`, `/hide/<key>`,
  `/reading/<key>`): its `permit` says yes when `collectionsWrite(op)` is not undefined, and its
  `shape` takes `collectionsWrite(op, ui)`, each field it moves replaced whole (the ticker's desk).
- The stylesheet imports a look first, then says its own tokens: `dzql/rendering/bento-plain.css`
  (plain: hairlines, black, 4px, no shadows; the starter's) or `dzql/rendering/bento.css` (the
  tray, rounded and lifted). Every look decision is a token of `bento.css`'s, listed at its top:
  say a token, never a rule over the bento's. It styles only inside `layers()`: draw every bento
  page in it (`layers(page, "", "")` when nothing is open). Outside it (`body`, `#app`) is the
  app's to style.
- The light client draws the same HTML in the browser (paintbrush's `bento.tsx`, held to this one
  by its test), so a page that moves here keeps its look: each handler there is a write here.
- What opens is a `<button>`, never a `div` with `role="button"` (an applet's SVG figure says
  `role="button"` and answers Enter and Space). A row an applet draws is opened by a `<button>`
  beside the mount (`aria-labelledby`), not around it.
- `data-moving` names what grows (a view transition runs only when its own tag changes);
  `data-reveal` scrolls the chosen row into the clear, one too tall by its top.
- A render keeps the reader's place below a sticky bar; one the client cannot measure is declared
  with `scroll-padding-top`.

## Where you are: the address

Where a person is, is one string, `path?what=which`: the page and the one thing open over it
(`guests?guest=2`, `gifts?new`, leave's `2026-10?request=1`). It is the **tab's**, not the
session's: the session keeps who you are and what is yours, and two tabs of one session stand on
two screens, each drawn where it is (`render(sessionId, address)`).

- `address(path, what?, which?)` builds one; `parseAddress(page)` reads one.
- Opening a drawer or a modal is going to the same page with it named; closing it is going to the
  page alone. Going anywhere puts away what was open.
- The address is the tab's URL. Going there is a write on the session (`go(address)`: `replace
  /page`), named as the app's `address` ([example.md](example.md)): the session's resource says
  where this session may stand (`permit`, `shape`, given the tab's address by `addressOf(ws)`), and
  the kernel takes the op off the write and moves the tab that sent it -- never the session, so no
  `page` field is kept. A tab opened at a URL is put there the same way before its first page is
  drawn: a link, a bookmark or a reload opens on its screen. Put the address in `data-page`, and
  that write in `data-page-write` (`site()` does): the client puts each new address in the tab's
  URL, and sends the one back and forward reach.
- What follows a write may move the writer's tab: `moveTab(ws, address)` (`dzql/rendering/tabs`)
  from `afterWrite` or `afterWalk` -- the modal a write answered put away, the drawer of a request
  it made opened. `addressOf(ws)` says where the tab stands.
- Per tab or per session: what a page reads follows the tab's address (a month, a drawer's row),
  and a page sees what it read, tab by tab. Which document of a type a person is on (`resolveDoc`)
  is the session's -- their own session, their team, chat's room (being in a room is the person's:
  others see them arrive) -- never the address. Who you are and what is yours (a draft, a
  watchlist, how you read a list, what you were last told) are the session's, so every tab of it
  shows them, and a write in one reaches the others wherever they stand.
- The stories put a person's tab there with `Stories.goTo(address)`. A story's `from`, and each
  place its `seen` names, must be one a control leads to: a button whose `data-value` is the
  address, or a tap an applet names. The URL, `data-page-write` and the back button are not
  controls: a link (an email) opening a tab is an `opensTab` story ([stories.md](stories.md)).
