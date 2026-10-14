# The page, and the parts it is sent in

What `render(sessionId)` is, and how a page is cut into parts so a change sends only what changed. How it looks is [bento.md](bento.md).

## The page

The page is one function: `Example.render(sessionId)` returns the whole page for one person, as
HTML. Chat's draws the name form, the rooms, or a room, depending on the session.

- It is the only renderer. It decides which screen, and reads whichever documents it must.
- A compartment looks after a document, not a place on the page.
- After a write, every page that read the document is drawn again, and sent only the parts that
  changed (see Parts).

## Parts: what is sent (`src/parts.ts`)

A part is a region of the page that can be sent alone, and it is the unit of a message: a change
goes as the smallest part that holds it, whole, with everything inside it that is not a part of its
own. So make what changes alone -- a row, a card, a count -- a part of its own. Name one with
`part(key, html)`, and its root element is tagged `data-eta-part="<key>"`. Chat's room:

```ts
part("people", `<ul id="people">…</ul>`),
part("messages", `<ul id="messages">${transcript.map((m) => part(`m${m.id}`, `<li id="m${m.id}">…</li>`)).join("")}</ul>`),
```

A message said goes as its one `<li>`, put in after the last, and someone arriving as the faces
in `people`; were the messages not parts, every message said would send the whole conversation
again. A keyed part may move from one parent to another (a stop to another day) and goes as that
move, not as either parent (todo n82, fixed in 0.50.0), so a row that moves can be a part too.

The bento's cells, the open window, rows with an id, lists given a key (`rows(items, empty, key)`)
and drawers are parts already. Name the rest (a strip, a list, a row, an applet's mount) where a
change should travel alone.

After a write the kernel draws each page again and sends what differs from what that page was
last sent:

- a part whose own tag changed and nothing inside it (a class, `inert`, an applet's props): its
  tag alone (`tag`);
- a part whose inside changed: replaced (`replace`, morphed in place);
- a list (a part whose rows are parts, in one run): rows put in (`after`, `before`) and taken out
  (`remove`). A list that was empty, or whose rows changed order, is replaced. A row may move from
  one list to another (a stop to another day): it is taken out of the one it left and put in the
  other;
- nothing, when nothing changed;
- the page whole only when its own outline changed: a different page.

Details:

- A key is unique on its page. The same thing drawn twice is fine; two different things under one
  key are no part, and what holds them is sent instead.
- A mount that watches a document (`data-doc`) is compared without that document and without what
  is inside it: its patches keep both. The rest of its props is compared, and goes as its tag when
  it changed ([Applets, "the document it watches"](applets.md#how-an-applet-gets-its-data-the-document-it-watches)).
- Drawers and modals go through `layers(page, drawer, modal)` (`src/bento.ts`). There are two
  layers, each always there and empty when nothing is open: the ground (the page, with the drawer
  over it) and the modal's. Opening or closing one sends its layer, and a modal puts the ground
  `inert` by its tag. They are the bento's frame: while a modal is open, and below 820px a
  drawer, the page behind holds still; from 820px a docked drawer leaves it scrolling.
- Make the page's outermost element a part too (the wedding's and the ticker's `.site`), so its
  class and its `data-page` go as a tag.
- The stories check the result: each member's page, rebuilt from exactly what they were sent,
  must equal a fresh render.
