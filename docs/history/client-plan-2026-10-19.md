# One look, two clients: the build

19 October. Peter asked: "can we have a task to unify the client styling - bento is not part of
paintbrush - should it be?" He chose option A: one look for both clients, the railroad page drawing
the same HTML and classes as bento.ts. He also said: "be careful the colors and style of paintbrush
was clean and simple - bento made beige monsters."

The look already exists: `docs/bento/paintbrush/` (14 October) is the bento drawn in Paintbrush's
look. It is the spec. Nothing here draws a new design.

## What the side-by-side showed

The café of `docs/bento/paintbrush/Main.dc.html` was drawn again by dzql's own bento.ts, unchanged,
under a stylesheet taken from the design (in the session's scratchpad: `draw.ts`, `paintbrush.css`,
`compare.html`). The two match closely: the same hairline tray, cells, rows, buttons, black primary
and toast, and no beige.

**The stylesheet took three layers:**
- 15 lines of tokens: colours, 4px corners, no shadows, a 32px control.
- About 25 rules overriding bento.css where tokens cannot reach: the tray's padding and gap, small
  capitals, row metrics, the look of a button, the drawer's and the modal's shadow.
- Paintbrush's own: the page, the toast.

Those 25 overriding rules are the finding. bento.css is a look as well as a frame, and Paintbrush's
look cannot be had from tokens alone.

**What bento.ts has no surface for**, drawn in the sample the nearest way it allows:
1. **A heading.** The design has the logo, the place's name large, and the page's own action ("Add
   to the menu"). Bento gives the name only as the trail's last crumb. The sample drew the heading
   in the box's "in place" slot.
2. **The page's tools.** The design has Undo alone beside the heading, and Undo in the toast on the
   kitchen's page. Bento puts undo and redo as a stack on the trail's line.
3. **A run**, a group heading in a list ("Coffee", "Food").
4. **A row with its own action.** The design's dish opens by its name (✎) and has its own Add. A
   bento row that taps is one button, the whole line, so it cannot hold another button.
5. **A pin** ("Table 4", "Open till 17:00"). `docs/bento/README.md` already says it is not in the
   kernel yet.
6. **A cell two rows tall.** The tray (`grid.ts`) takes `rows`, but `cell()` has no option for it.
7. Small: a row that is a total, drawn bold.

Read but not drawn: `Orders.dc.html` has the reading switch as words, not icons, and find as a field
in the heading. `Drawer.dc.html` puts each field's label above it, not in bento's name | value
grid, and its remove is a red link in the drawer's foot that leads to the modal. `Modal.dc.html`
matches `confirmModal` almost as it is.

**Work already done, to reuse:** Can You (Peter's, outside this repository: its `asks/ui.tsx` and `shell.tsx`) is
a railroad app of the Paintbrush line. Its steps (one thing open at a time, each a step, Back and
Escape closing it, the trail) are the browser's half of what the kernel's client does for the bento.

## The build, in stages

Each stage passes `bun run affected` and is committed on its own.

**1. Split bento.css into a frame and looks** (dzql). The frame is what makes it the bento:
- the tray's grid areas;
- the window's place;
- the drawer docked at the right, a sheet on a phone;
- the scrim, `inert`, the hit areas, focus that can be seen, reduced motion and forced colours.

A look is what it looks like: colour, corners, shadows, type, the size and drawing of a control,
the metrics of a row. Two looks:
- **plain**: Paintbrush's, from the design.
- **tray**: today's, so nothing that uses it changes.

Seven examples, the model's page and create-dzql's starter import bento.css; each keeps its look
unless Peter says otherwise (question 1). Every look token gets a name, so a look is mostly tokens.
dzql's browser tests and stories hold the examples as they were.

**2. bento.ts's missing surfaces** (dzql), each with its test in `bento.test.ts`:
- `cell({ rows })`;
- `run(name)`;
- `heading({ logo, name, actions })`, with the page's tools beside it;
- a row with its own action, its name becoming the row's button;
- `pin(mark, text, write)`, a pin without its summary for now.

These are additions; the cafe and the other examples change only where they choose to.

**3. The railroad bento** (paintbrush): JSX components that draw the same HTML and classes as
bento.ts, every surface: the trail, tool and stack, heading, box and cell, run and row, pin, drawer,
modal, field, choice and layers.
- A write becomes a handler. Where you are is the URL (bento's own `address` and `parseAddress`),
  with the steps from Can You.
- Undo and redo are delta's undo action on the socket.
- A paintbrush test (happy-dom) draws each surface both ways from the same input and compares the
  HTML, leaving out what only the wire carries (`data-write`, `data-value`, `data-eta-part`), so the
  two cannot drift apart.

**4. Paintbrush's page as a box** (paintbrush):
- `styles.css` becomes bento.css's frame, the plain look, and Paintbrush's own (the page, the toast).
- The message is a cell, a thing whose drawer holds the field and Save; the status is a cell.
- Its tests (saving, following, a refusal), 100% coverage, and the README that `create/setup.ts`
  writes.

**5. The evolve references, redrawn** (paintbrush): notes, testing, two-documents (the catalogue
and the order, the design's own café), sqlite's kitchen and undo, and auth. Then `test:evolve` runs.
Running the Shed evals again is Peter's call: they are agent runs.

**6. Words and record**:
- `docs/bento/README.md`, "In dzql" becoming "In both";
- dzql-app's `reference/bento.md`;
- evolve's SKILL.md;
- paintbrush's CLAUDE.md (the page is the bento's);
- the changelogs and `todo.jsonl`, here and in dzql and paintbrush;
- this file, kept as the record.

Moving a page to the server then becomes a step evolve can state: the same classes, a handler
turned into `write()`.

## Peter's answers

1. **The default look**: plain for both starters; the examples keep the tray until each is next
   worked on.
2. **The railroad bento**: in paintbrush, as template code, held to `dzql/rendering/bento` by a
   paintbrush test.
3. **The heading**: the bento's, in both clients.
4. **The drawer's fields**: the label above each field (in the plain look).

## Where it stands

Built on 19 October, a commit a stage:

1. `bento.css` is the frame, every look decision a token, its defaults the tray: the computed style
   of every element on five pages of every surface, at 375 and 1280, is as it was.
   `bento-plain.css` is the plain look, only tokens. The starter imports it.
2. `bento.ts` has the heading (alone at the root), runs, a row's own deed, totals, pins, and a cell
   two rows tall. The café of `Main.dc.html`, drawn with them under the plain look and nothing
   else, matches the design.
3. Paintbrush's `bento.tsx` draws 47 cases as `bento.ts` does, held by `tests/bento.test.ts`, which
   fails on one class changed. Where you are is the URL; Back and Escape close; the page is drawn
   again only when you go elsewhere.
4. Paintbrush's page is a box: its name the heading, the message (✎ to its drawer) and the status.
5. The evolve references draw with it, and `test:evolve` proves all nine.

One choice made on the way: a row may carry one deed of its own, the one the line is for (Add, on a
menu), as the design draws it. The dzql-app skill had said no row carries a button, so its rule
now says at most one, and every other deed is in the drawer.

Still open: an evolve step that moves a page to the server, now a handler turned into a write; the
examples' looks, the tray until each is worked on.
