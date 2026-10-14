# Bento: everything in its place

A bento box brings different things to one place, each in its own compartment, neat, nothing
spilling into anything else. A page is that: the different things a person needs to act -- a list,
a calendar, a map, a person, a total -- each in its compartment, small enough to be seen together,
each able to grow to its full size. And whoever uses it always knows where they are and what they
can do.

These are directions, not a checklist: an experience people can expect, and that an app can build
on. Where an app's stories ask for something else, the stories win.

## The box

1. **A page is a box of compartments**, or one compartment on its own (a collection: a list, a
   conversation). Each compartment holds one kind of thing and shows it small: a count and a line,
   a few rows, a small map, a photo.
2. **The box lays itself out from what it holds**, not by hand: the compartments fill the tray in
   the box's order, the one that matters most the widest; on a phone, one column. Clean edges, no
   compartment spilling into the next.
3. **A compartment grows into the window**: the same thing at full size, the box still behind it.
   Closing it puts it back where it was.

## Where am I

4. **The place says its name, and the trail back up.** Every earlier step on the trail is a way
   back; the first is home.
5. **The same place can be read another way** -- a list, a calendar, a map, a line -- and a
   switch says which. Switching changes how you look, not where you are.

## Cards and pins

6. **A card is a summary of one thing.** Its pins -- when it is, where it is -- open a popover beside
   it: its day on a small calendar, its spot on a small map. The popover grows into the full
   calendar or map, with that thing chosen. Small first; full when asked.

## What can I do

7. **A tap does what it names.** A place goes into it; a thing opens its drawer. Never a preview,
   never a second copy of what is already on the page.
8. **Make or remove in a modal**: one question, a button that says what it does ("Ask Sam",
   "Take it back"), and Never mind. **Change in a drawer** (a sheet on a phone), over the page you
   are on: it saves as you go.
9. **One overlay at a time, each a step.** Back or Escape closes it, and the keyboard goes back to
   what opened it; moving elsewhere closes it. Nothing is left open behind you.
10. **Offer only what this person may do.** Nothing is offered only to be refused; what they may
    only read, they read.

## What happened

11. **Every change says what it did, where you are**, and what it made appears where it lands.
    A refusal says why, beside what was tried.
12. **A thing once on a page**, in plain words: never a state as it is stored, never the same
    thing twice, and what is true of the person looking (their own name) shown by place or colour,
    not said.

## In eta

The kernel builds these (`src/bento.ts`, `src/bento.css`, laid out by `src/grid.ts`):

| | |
|---|---|
| The box, the tray, a compartment (1-3) | `boxPage`, `cell`, its window when open |
| One compartment on its own (1) | `collectionPage` |
| The trail (4) | `crumbs`, and the window's head |
| Another reading (5) | `readingSwitch` |
| A card (6) | `row`; a thing's `cell` |
| Make or remove; change (8) | `addModal`, `confirmModal`; `drawer` |
| Where you are, in the URL; Back (9) | `go`, `site` |
| What happened (11) | `tell` and `refuse` (src/refusal.ts) |
| Find, on a long list | `findControl` |

Not yet in the kernel: **pins and their popovers (6)**, which Can You has (a small map beside a
row, grown into the plan's map: `openMap` and `grow` in `Workshop/canyou/src/resources/asks/`).

How it looks -- the tokens, the corners, the 40px touch, light and dark -- is `src/bento.css`, and
an app brings its own paper and ink.

## The samples

`design/` holds six sample pages drawn to these directions, one file an artboard and `canvas.json`
laying them out: the box (1-6), a compartment grown into the window (3), a card's pin and its
popover (6), changing in a drawer (8), making in a modal (8), and the box on a phone (2). They
are drawn on Claude's design canvas, whose runtime they need to render (claude.ai/artifact/1QLsr4aa8aH5mLxZbPi37s,
private until shared); here they are the record of what was drawn, and the source to redraw from.

## Where it comes from

The box from apples.md, "The page" (`Workshop/apples_pears`), and the atlas
(`Workshop/concept/location`), whose map is the window and whose tools float on it. Where am I,
cards and pins, and what a tap does from Can You (`Workshop/canyou/docs/minimum-ux.md`, "Where you
are" and its tap rules), which found them by use.
