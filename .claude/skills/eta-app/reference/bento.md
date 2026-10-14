# Pages: the bento, and the address

The kernel's parts for drawing a page as a box or a collection, with its drawers and modals, and the address that says where a person is. How a page is sent is [page.md](page.md).

## Pages: the bento (`src/bento.ts`, `src/bento.css`)

The bento (`docs/bento/README.md`) says what a page is for: where am I, what can I do. These are
the kernel's defaults for drawing it, not rules: use them, change them, or draw your own when
a story asks. Bind it once per example, then build pages from what it returns:

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
- A modal is new or delete, so there are two and no bare one. `addModal(title, fields,
  add, close, verb?, said?)` asks for a new thing: each `Field` is typed (`type`: `text`, `email`,
  `number`, `date` or `url`), or, given `options` (`{ value, text }`), chosen from a select, its
  `value` the option drawn chosen, else the first. A refused add hands back what was typed and
  chosen, with `said` beneath. `confirmModal` asks before a removal.
- `patchCollections(ui, op)` applies what find and the reading switch write (`/filter/<key>`,
  `/hide/<key>`, `/reading/<key>`).
- The stylesheet imports `src/bento.css` first, then says its own tokens. `bento.css` draws the
  frame, what `layers()` ([page.md](page.md)) draws: its buttons, fields and boxes are the bento's only in there, so
  every bento page is drawn in it (one nothing opens over is `layers(page, "", "")`, as chat's
  are), and the page outside it (`body`, `#app`, an old page) is the app's to style.
- `data-moving` names the element that grows (a view transition runs only when its own tag
  changes). `data-reveal` scrolls the chosen row into the clear; one too tall for it, by its top.
- What opens is a button: a cell's name is its button, and a row that taps is a
  `<button>`, so Enter and Space open them. An opener of the example's own is a `<button>` too
  (the wedding's bubbles), never a `div` with `role="button"`, which nothing opens from the
  keyboard; a figure in an applet's SVG says `role="button"` and answers Enter and Space itself.
  A row an applet draws is opened by a `<button>` of the page's over it, beside the mount and
  named by it (`aria-labelledby`), not around it: the mount then stands where it stood before
  the row could be opened, and keeps what it has drawn (the ticker's board, on the box and in
  the window).
  While a window is open the box behind it is `inert`, and the client keeps the keyboard with the
  cell as it opens and closes.
- A render keeps the reader's place: in each scroller that is scrolled (the page, the bento's
  window), the first element below where reading starts stays where it was, whatever is taken
  out or put in above it, or under a sticky header -- but not while someone is pressing (a drag,
  a selection being made). Reading starts below any bar stuck at the scroller's top (position `sticky`
  or `fixed`, over the middle of its view), as the client measures it, and `data-reveal` lands
  below it too. A header the client cannot measure there is declared: `scroll-padding-top` on
  the scroller (`html` for the page) overrides the measure.

Escalate only as the data forces: in place, then the cell, then a drawer, then a window, then a
modal. A list of five needs no find.

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
