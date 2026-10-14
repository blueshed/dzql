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

`docs/bento/README.md` says what a page is for: where am I, what can I do. `bento()` (`src/bento.ts`)
binds the app's icons, its session's docType and the last tool; what it returns is its type. These
are defaults, not rules: draw your own when a story asks.

- A page is a **box** (`boxPage`: cells in a tray, one may grow into the window; laid out by
  `grid()`, `src/grid.ts`) or a **collection** (`collectionPage`: the window alone).
- Every gesture is a `data-write` string you hand in.
- A modal is new (`addModal`) or delete (`confirmModal`); there is no bare one.
- Escalate only as the data forces: in place, then the cell, a drawer, a window, a modal. A list of
  five needs no find.
- Find and the reading switch write to the session (`/filter/<key>`, `/hide/<key>`,
  `/reading/<key>`): its `shape` applies them with `patchCollections(ui, op)`.
- The stylesheet imports `src/bento.css` first, then says its own tokens. `bento.css` styles only
  inside `layers()`: draw every bento page in it (`layers(page, "", "")` when nothing is open).
  Outside it (`body`, `#app`) is the app's to style.
- What opens is a `<button>`, never a `div` with `role="button"`. A figure in an applet's SVG says
  `role="button"` and answers Enter and Space itself. A row an applet draws is opened by a page's
  `<button>` beside the mount, named by it (`aria-labelledby`), not around it.
- `data-moving` names what grows (a view transition runs only when its own tag changes);
  `data-reveal` scrolls the chosen row into the clear, one too tall by its top.
- A render keeps the reader's place, below any sticky bar the client can measure; one it cannot is
  declared with `scroll-padding-top`.

## Where you are: the address

Where a person is, is one string on their session, `path?what=which`: the page and the one thing
open over it (`guests?guest=2`, `gifts?new`, leave's `2026-10?request=1`).

- `address(path, what?, which?)` builds one; `parseAddress(page)` reads one.
- Opening a drawer or a modal is going to the same page with it named; closing it is going to the
  page alone. Going anywhere puts away what was open.
- Put the address in `data-page`, and the write that sets it in `data-page-write` (`site()` does):
  the client mirrors it into the URL and sends it on back and forward; on first load the session
  catches up to the URL.
- The stories put people there with `Stories.goTo(address)`. A story's `from`, and each place its
  `seen` names, must be one a control leads to: a button whose `data-value` is the address, or a tap
  an applet names. The URL and the back button are not controls: a place reached by a link (an
  email) goes in the cast's own writes.
