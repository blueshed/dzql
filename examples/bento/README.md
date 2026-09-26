# Bento

A design mock-up of the page, not an eta example: no documents, no compartments in the kernel's
sense, no wire. `bun run dev:bento` serves it on port 3003, and it is in `.claude/launch.json`.
It exists so the rules below can be looked at and clicked on before they are built into the
wedding's pages, and so that whoever builds them builds from the rules, not from this CSS.

The rules come from two places: apples.md, "The page", in `Workshop/apples_pears`, and the
atlas in `Workshop/concept/location`, whose map is the window and whose tools all float on it.
Each rule names where the mock-up honours it.

## The box

1. **A page is a box or a collection.** A box is one ground with one cell per thing on
   it, and only one. The tray holds five: where to stay, households, photos, gifts, and the household's own answer.
2. **The trail is where am I.** Root first, the ground you stand on last and bold: *Rowena &
   Dashiell › The Okafors* above the tray. Inside a window it is the same trail, whole, one crumb
   longer: *Rowena & Dashiell › The Okafors › Where to stay*. The crumb before the last closes
   the window, and every crumb before that is still a way back, the root included, so opening
   something never loses the way out. A crumb that is named but not a place (the couple, to a
   household) is drawn plain in both.
3. **Cells are cut into the tray.** Their walls meet square; only where a cell
   sits in a corner of the tray does it take the tray's curve, less the wall. A reading inside a
   cell is cut the same way: the map's well curves on its left with the cell, the
   households' well is square.
4. **A cell shows the state it is in.** Its mark and name in small caps, a › because it
   opens, a summary line with the count, and a small reading of what it holds.
5. **Bigger for what matters more.** The map takes the left column, whole.

6. **On a phone the tray is a column.** One cell under another in the box's own order, the
   tray's curve at the top of the first and the foot of the last, the walls square between; the
   readings inside are cut the same way. The window and the drawer keep their phone shapes: the
   window at the screen's edge, the drawer a sheet from the foot. While either is open the page
   behind holds still, and a scroll inside a reading stops at its edge rather than reaching the
   page.

## The window

7. **Opening does not go anywhere.** The same element grows into the window; a View Transition
   morphs the shape. Only the cell that moves is named for the transition, and it is drawn
   on top, or it animates under its neighbours.
8. **An opened cell is a window, whatever it holds.** A map, a photo, a grid of pictures
   and a list all open the same way. The reading changes; the window does not.
9. **Every tool floats in the window, and there is no toolbar.** The trail top-left, drawn like a
   Leaflet control. The camera, zoom in and out, in a stack under it. The cell's own tools
   in stacks on the right edge: the reading, find, edit, add. The page's tools, undo, redo and
   leave, one more stack at the bottom right, leave set apart by a rule.
10. **The reading scrolls under the controls.** A picture is bigger than its window, as a map is,
   and scrolls within it. A list or a grid keeps clear of the controls and scrolls beneath them.
11. **One family of corners, and nothing is a pill.** A button inside a control 4px, a control 6,
    a thumbnail 8, the drawer and the modal 20, the tray and the window 28. Circles are for faces.
    Every shadow tints toward the ink, so they read as one light.

## The three surfaces

12. **Navigation is what is here.** The trail, and the › into a cell. Nothing else moves
    you.
13. **A drawer is editing.** A figure in the reading, a pin, a face, a row, or a cell that is
    a thing (rule 15), opens its properties in a panel at the right on a desktop and a sheet from the foot on a phone, and shows it is
    chosen: a pin rings, a row lights across its whole line. What the figure can carry, claim or
    give, waits in its drawer as one control, not on the line.
14. **A modal is new or delete.** The plus on a collection's rail asks one question, the name,
    with everything behind it dimmed because nothing else may be touched while it asks. Answer,
    and the thing is on its list; Escape, or a tap on the dimmed page, cancels. Nothing else is a
    modal.
15. **A cell may be a thing, not a collection.** It carries ✎, not ›. A tap does not open a
    window: it opens the thing's drawer, with each property by its kind, and the cell shows
    it is chosen while the drawer is open. *Our answer* is one: the answer as a choice, the words
    as text.

## The rails

16. **The reading is a tool on the collection.** Map or list, photo or list, grid or list, the
    current one pressed. The same figures drawn another way, never two cells.
17. **The filter dims and counts.** Find pops a field open beside its tool; what it misses dims,
    what it hits stays lit, and the tally says how many of all. An eye beside the field hides what
    misses instead of dimming it, for a long list, and the tally still counts all. Close the tool
    and everything is lit and shown again. A dim is find's alone: nothing else on a page is dimmed,
    so whatever state a thing is in is said some other way (the wedding's mark at a guest's feet).
18. **The rails step aside for the drawer, and the content moves; the window does not.** When the
    drawer opens over the right edge, the stacks slide left of it and the reading scrolls the
    chosen figure into the clear beside it, the browser's own scroll-into-view. The box does not
    move: the tray keeps its shape and the drawer overlaps it, since a thing's properties are
    read in the drawer, not on the cell behind it. A window never changes size because
    its content changed. Beside a docked drawer the page is still in reach: a tap on another
    figure opens its drawer, a tool on the rail does what it does, and × or Escape puts the drawer
    away. Only the phone's sheet dims the page, and a tap on that closes it.

## What eta already does with this

The rules are built in the kernel: `src/bento.ts` draws the trail, the tray, the window, the
stacks, the rows, the drawer and the modal the way this mock-up does, and `src/bento.css` is their
look, the measurements taken from `styles.css` here. The wedding (`examples/wedding`, from 0.41.0)
was the first built on them; chat and the ticker are the others, each binding the surfaces to its
own icons (`bento({icon, session})`) and bringing its own paper and ink as tokens. The tray is computed in
eta by `src/grid.ts`: a box declares its cells and their spans, and the grid's areas and
each cell's corner cuts come out, once for three columns and once for one. The grid in this
mock-up's stylesheet is the same result written by hand, so it can be looked at without a server.
Where the wedding and this mock-up part company -- an ask's yes or no on its row, a photo that
reflows rather than scrolls -- `history/bento-request.md`'s Findings say why.

## Where it shows the shape and not the function

The drawer draws a figure's properties and, for the answer, its fields, but nothing is saved; the
atlas's drawer writes.
The modal makes and does not destroy. The second reading on each rail is a pressed button and
nothing more. The zoom is furniture. Those four are the places the wedding's pages will have to
finish what the mock-up only draws.

## Files

| File | Role |
| --- | --- |
| `index.html` | The box: the trail, the tray, five cells each with the same parts, the drawer, the modal. |
| `styles.css` | The rules as CSS, in the order above, with one paragraph at the top saying the whole. |
| `app.ts` | Open and close (the morph), the drawer, the filter, the modal, Escape. Icons are lucide's, drawn by `createIcons` from `<i data-lucide>` marks. |
| `server.ts` | Serves `index.html`, nothing else. |
| `design/` | The canvas: `build.ts` generates one artboard per state from `index.html` and `styles.css` (icons through the kernel's `svg`), `canvas.json` lays them out with the rules as notes, and the design skill's helper seeds `wedding-bento.html`, which is saved at claude.ai/artifact/7zUmiK3Qt5HLpDsSf3kN9P. Regenerate, never hand-edit the artboards. |
