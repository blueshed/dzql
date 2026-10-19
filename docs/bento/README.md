# Bento

A bento box brings different things to one place, each in its own cell, in a clean layout.
A page does the same for the things a person needs to act. The bento is not large and not
constricting: it points the way, so that people know where they are and what they can do, and
find the experience they expect, one an app can build on.

Its words are Peter's, from apples ("The page") and from Can You, where they were found by use.
These are directions. A page's shape comes from its stories; the directions are how to check it.

## Three surfaces, three meanings

> Three surfaces, three meanings, always. **Navigation** is *what is here*. A **drawer** is
> *editing*. A **modal** is *new or delete*. A person who has used one page knows every other.

- **Navigation** goes from place to place, and the trail is the way back, each step on it a place.
- **A drawer** is where a thing is changed: its own properties, and nothing that stands elsewhere.
  The page stays behind it, as it was. On a phone it is a sheet.
- **A modal** is where a named thing is made or destroyed. One question, one answer, gone. A modal
  never edits.

## A page is a box or a collection

- **A box** shows one place, one cell per thing on it, and only one: bigger for what
  matters more. A cell that fits its things whole is them; one that can only sum them up
  says so, and goes into them as a page of their own.
- **A collection** shows one list, in a reading: a list, a calendar, a map. A row is a summary; what
  it can carry it decides on the row, and what needs the thing itself opens the thing.
- **Nothing is shown twice.** A thing lives in one cell. A photo and a list of the same rows
  are one cell read two ways, never two cells.
- **A place with a picture is drawn as it**: an atlas is its map, a household the photo of its
  people, a plan the wall of its days. The box is the fallback. Do not invent a picture to avoid a
  box, and do not offer a box where the work has a picture.

The stories choose. Chat is three steps, each one thing -- a name, a room, a conversation -- so it
is three collections, and a box would only put the same thing in several cells. Japan in
Can You is several different things at once -- what is asked, its days, its places, its people --
and that is a box.

## Where am I

> "We really need to figure out context and what the buttons do." -- Peter, on Can You

Three questions, always answered on the page:

- **Where am I?** The place's name.
- **How did I get here, and up?** The trail, each step a way back.
- **How am I looking at it?** Which reading, the same place read another way.

## Small first, full when asked

A card is a summary of one thing. Its pins -- when it is, where it is -- open a summary beside it,
and that grows into the full calendar or map, the thing chosen. A cell is the same: small in
the box, the whole thing when it is opened.

## What a tap does

> "This sort of ux logic should be determined by rule." -- Peter, on Can You

- **A tap on something named is that thing, in one tap**: a place goes into it; a thing opens it.
  ("I clicked an item -- either open it or its container.")
- **A tap never shows again what is already on the page.** ("That is two identical items on the
  screen -- one just bigger than the other.")
- **Nothing opens by itself**, and **closing changes nothing**: the page behind is as it was.
- **One open at a time, each a step**: Back closes it, and leaving the page closes it.
- **Offer what this person may and would do**; nothing is offered only to be refused.
- **Every change says what it did**, where the person is.
- **Words on buttons say what they do.** ("Ask! Or Never mind!")

## In both clients

One way to draw these, the same HTML in both: dzql's, drawn by the server
(`packages/dzql/src/rendering/bento.ts`, laid out by `packages/dzql/src/rendering/grid.ts`), and
paintbrush's, drawn in the browser by railroad (`packages/paintbrush/src/resources/bento.tsx`,
held to dzql's by `packages/paintbrush/tests/bento.test.ts`). The parts: a box and its tray, a
heading, a collection, the trail, readings, rows, runs and totals, pins, a drawer, a modal, find,
and the page's undo and redo. A page moves from one client to the other with its look: a handler
in the browser is a write on the server.

How they look -- sizes, corners, shadows, type, the tray -- is a look's, not the bento's: one
stylesheet, `packages/dzql/src/rendering/bento.css`, whose every look decision is a token. Its
defaults are the tray (rounded, lifted, small capitals); `packages/dzql/src/rendering/bento-plain.css`
is Paintbrush's (`paintbrush/` below: hairlines, black, 4px, no shadows), the starters'. An app
may use the parts, change them or draw its own; a direction never requires a part, and a choice is
justified by a story, never by this page.

Not yet in either: a pin's summary, which grows into the full calendar or map, as Can You (an app
of Peter's, outside this repository) has it.

## The samples

`design/` holds six sample pages drawn to these directions -- a box, a cell opened, a card's
pin, a drawer, a modal, a phone -- one file an artboard and `canvas.json` laying them out. They are
drawn on Claude's design canvas, whose runtime they need to render
(claude.ai/artifact/1QLsr4aa8aH5mLxZbPi37s, private until shared); here they are the record of what
was drawn, and the source to redraw from.

`paintbrush/` is the same directions in another look, Paintbrush's (plain, black, 4px, no
shadows, a toast for every change), on another subject, a café: its menu, your order, the
kitchen's open orders. Its logo stands in for an app's on every page
(claude.ai/artifact/YFtnHRNFWf6VaMeYUGUsB3, private until shared). The two sets differ in every
look and agree in every direction: that is the bento being a guide, not a style. The plain look,
`bento-plain.css`, is drawn from it.

## Where it comes from

Peter's earlier notes, outside this repository: apples and pears' "The page", Can You's minimum UX
("Where you are" and its tap rules), and the location atlas. This page is what was taken from them,
and the authority here.
