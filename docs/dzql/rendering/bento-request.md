# Bento request: the page, for all three examples

*16 September 2026, at 0.37.0. Written after the bento mock-up (`examples/bento/`, 0.36.0) and
the computed tray (`src/tray.ts`, 0.37.0). The mock-up's `README.md` holds eighteen rules for the
page, drawn from apples.md's "The page" and the atlas in `Workshop/concept/location`. This is the
request to build those rules into the examples -- all three, because a rule that describes only
the wedding is not a rule of the page. Numbered so the changelog can name them.*

## Where this comes from

The wedding was built before the rules were written down, and it breaks about half of them: its
tools are pills, undo and redo and leave sit in a toolbar under the box, opening a resource goes
to another page, the property panel narrows the page behind it, there is no filter and adding is a
form on the page. Chat and the ticker were never drawn as boxes at all, though rule 1 says every
page is a box or a collection and both are one or the other. The wedding goes first because it has
the most rules to honour and fifty-one stories to hold it; chat and the ticker are the small
proofs, as they were for the stories.

Two things are already right and are not in this request. The tray is computed (0.37.0) and the
wedding's boxes are cut into it, so items about the box start from there. Lucide is the icon set
and the kernel draws it (`src/rendering/icons.ts`, 0.36.0).

## How to work

- **Build from the rules and the stories, not from the mock-up's CSS.** The mock-up's readme
  forbids copying it for a reason: its tray is hand-written and its readings are pictures. Read
  each rule, look at the mock-up to see what it means, then write the example's own view and
  stylesheet. Examples never share code; the corner family and the tokens are repeated in each
  example's own `styles.css` because they are a rule, not a module.
- **Stories first.** Every rule that is behaviour gets its stories in the example's `stories.ts`
  before a view is touched, and `bun run stories` says when the retelling is done. Rules that are
  only look have no stories; the mock-up and the design canvas are their reference.
- **A rule that will not fit is a finding.** If an example cannot honour a rule without strain --
  a delete that should not need a modal, a resource that is neither a collection nor a thing --
  stop, write it down under "Findings" at the foot of this document, and go on to the next item.
  The rule is what is on trial. Do not bend the rule quietly and do not bend the example.
- **One item, one commit**, with a changelog entry naming the item, `bun run test` at exit 0 with
  the coverage table at 100%, and the example's stories green. Do not touch `examples/bento/`
  except its readme, and only to say what the examples now do.
- Session writes that are only the page's state -- which drawer is open, which reading is
  pressed, what the filter says -- are never on the ledger (`undoable = 0`, as the wedding's
  session document already does). Undo is for facts.

## Kernel

Three small things the client or a document needs and no example should improvise.

### K1. The moving element

**What.** A render may mark one element `data-moving="<name>"`. When a full render arrives and both
the page as it is and the page as rendered carry an element with the same `data-moving` value, the
client gives that element, and only that one, `view-transition-name: moving`, morphs inside
`document.startViewTransition` where the browser has it, and clears the name after. Nothing else is
named, and the moving element is drawn on top (`::view-transition-group(moving) { z-index: 1 }` in
the kernel's own client stylesheet, if it gets one, else documented for the example's).
`prefers-reduced-motion` skips the transition. Without support the morph runs as it does today.

**Why.** Rule 7: opening does not go anywhere; the same element grows into the window. The morph
is the kernel's, so the kernel has to name the moving element, and the mock-up learned the hard
way that naming every resource animates the moving one under its neighbours.

**Not this.** Not a general animation vocabulary. One attribute, one name, one element.

### K2. Bring into the clear

**What.** After a morph, if the rendered page carries an element with `data-reveal` that the page
before did not (or carried on another element), the client calls `scrollIntoView({ block:
"nearest", inline: "nearest" })` on it. The example's stylesheet sets `scroll-margin` on the
element so a panel docked at the right counts as an edge.

**Why.** Rule 18: when the drawer opens, the chosen figure scrolls into the clear beside it, and
the window does not move. The scroll is a client act on a render; the kernel's client is the only
code that knows a render just landed.

**Not this.** Not a scroll position on the wire, not the kernel deciding what to reveal.

### K3. Forms that write as you type

**What.** `data-write-on="input"` on a form, alongside the existing `blur` and `change` (item 2 of
the change request). Same rule -- every `[data-write]` field whose live value differs from what the
last render wrote becomes one op in one message -- debounced to about 150 ms after the last
keystroke, and never sending a message identical to the last one sent.

**Why.** Rule 17, the filter: what it misses dims as the word is typed. The filter is a reading of
the session, rendered by the server like every other reading, so the stories can tell it and the
harness can check it. A filter that lived only in the browser could not be storied, and "no
client-side domain state" is the rule we already keep.

**Not this.** Not a keystroke protocol. Debounced writes of a field's value, nothing new on the wire.

## The wedding

The session document already holds `page`, `focus`, `gift`, `keep`, `answering`, and `reading.<key>`.
Items W2 and W4 add `new` (which modal is open, as `"<collection>"`) and `filter.<key>`. The `at`
grammar in `stories.ts` already carries any key.

### W1. The look, no behaviour change

Rule 11, rule 9, rule 18's second half. One family of corners: a button inside a control 4px, a
control 6, a thumbnail 8, the drawer and the modal 20, the tray and the window 28, and nothing is a
pill -- every `border-radius: 999px` goes. Every shadow tints toward the ink. Undo, redo and leave
leave the foot and float as one stack at the bottom right of the tray, over the resources,
leave set apart by a rule; a collection's tools (the reading switch, what adds) float as stacks on
the right edge of its page. The panel overlaps: `main#app:has(.sheet)` no longer narrows the page,
and the tray keeps its shape whatever is open. Nothing on the wire changes and every story stays
green as it is.

### W2. The drawer and the modal

Rules 13, 14, 15. A figure in a reading -- a guest's row, a gift's row, a photo, an event -- opens
its properties in the drawer and shows it is chosen: a row lights across its whole line, a photo
rings. What a figure can carry waits in its drawer as one control: claiming a gift, keeping a row,
answering, are buttons in the drawer, not on the line. A resource that is a thing -- the
household's own answer; the couple's welcome message -- carries ✎, not ›, and a tap opens its
drawer with each property by its kind, the resource lit while the drawer is open. Adding a
guest, a gift, an ask, an event, is the plus on the collection's rail and a modal (`<dialog>`)
asking one question, the name, with everything behind it dimmed; removing one asks in a modal too,
one question, since a modal is new or delete and nothing else. The panel is a panel from 820px and
a sheet from the foot below, and while either is open the page behind holds still.

Stories, retold and new (the `seen` place is the resource or page the drawer sits on):

```ts
story("Grace opens Arjun's drawer, and only her page shows him chosen", { as: "okafors", does: at("guests @ focus=1"), seen: { okafors: "guests" } }),
story("Grace asks to add a guest, and the modal asks for the name", { as: "okafors", does: at("guests @ new=guests"), seen: { okafors: "guests" } }),
story("Grace claims the kettle from its drawer; the couple see it claimed", { as: "okafors", does: at("gifts @ gift=2"), seen: { okafors: "gifts" } }),
story("The couple open their welcome to edit it; nobody else's page changes", { as: "couple", does: at(" @ answering=true"), seen: { couple: "" } }),
```

The existing claim, keep and answer stories keep their `does`; their `seen` gains the drawer's
place where a drawer is now the way to the button.

### W3. Open in place

Rules 7, 8, 10, 12. Going to a collection stays a write of `/page`, and the trail stays as it is,
one crumb longer. What changes is the render: the box is rendered with the named resource grown
into the window and the others gone behind it, the resource's element carrying
`data-moving="<key>"` in both renders so K1 morphs the shape. A map, a list, a grid, the photos:
all open the same way, and the reading scrolls under the controls, clear of them where it is a list
or a grid. The `collectionPage` view goes; `boxPage` learns an open resource. No story changes
its `does`; some `seen` places that named a page now name the resource, which is the same key.

### W4. The filter

Rule 17. Find is a tool on the rail of guests, gifts and households. Pressing it opens a field
beside it in a form with `data-write-on="input"` writing `/filter/<key>`; the render dims what the
word misses, keeps lit what it hits, and the tally says how many of all. Closing the tool removes
the key and everything is lit and shown again.

```ts
story("Grace finds Ok among the guests; two stay lit, the rest dim, the tally says two of five", { as: "okafors", does: at("guests @ filter.guests=Ok"), seen: { okafors: "guests" } }),
story("The couple find kettle among the gifts, and only their page dims", { as: "couple", does: at("gifts @ filter.gifts=kettle"), seen: { couple: "gifts" } }),
story("Grace closes find, and every guest is lit again", { as: "okafors", does: { doc: "session", ops: [{ op: "remove", path: "/filter/guests" }] }, seen: { okafors: "guests" } }),
```

### W5. After the review

*Done, 0.41.0.* Items 1 to 4 landed as Sonnet's W5.1-W5.4 (0.40.0) and were then redrawn in one
pass by Fable against the mock-up itself, every screen at both widths: item 1 as written was wrong
-- the mock-up's window is the screen less a margin, not the tray's rectangle, and the mock-up won;
the reading's clearance, the stacks and the rails' step-aside are the mock-up's own numbers; item 5,
the eye, is built with its three stories. The same pass gave every list one row grammar and every
drawer one property grammar, made the guests a resource that opens, and moved the invite into
a modal (see CHANGELOG 0.41.0).


What Fable saw in the preview at 0.39.0, and what to change. The mock-up (`examples/bento`,
`bun run dev:bento` on 3003) is the exact reference for every measurement below -- where the
stacks sit in the window, the rail's width and offsets, the stack's own border, shadow and button
size, the reading's clearance, the page stack at the window's own bottom right corner. Write the
wedding's own CSS, never the mock's, but take the numbers from it rather than inventing one; where
the wedding differs from the mock in any of these, the mock wins.

1. **The window is the tray's rectangle.** Today `.cells.has-open .cell:not(.open) { display: none }`
   removes the other resources and `.cell.open` is `position: fixed` to the viewport, so the
   tray collapses and the window is as wide as the screen. Rule 7 and rule 18: the tray keeps its
   shape whatever is open. From 820px the other resources stay in flow and are covered (the
   tray is `position: relative`, the open resource `position: absolute; inset: 0` over them,
   drawn on top); the window is exactly the tray's rectangle, corners 28, and it transitions from
   the cell's rectangle to the tray's. Below 820px the window is the screen, as now, since the
   phone's column is taller than the screen. A reading taller than the window scrolls inside it.
2. **Every reading keeps clear of the rails, by the rails' own measure.** `.cell-open-body {
   padding-right: 15rem }` leaves a phone's rows a third of the window and a desktop's rows two
   thirds, and its `:has(.photo-reading) { padding-right: 0 }` exception is wrong: it is only a
   reading that scrolls and is bigger than its window -- a picture too large for it -- that may run
   under a control, and no reading in the wedding today is that; every photo (a household's,
   a family's, everyone's) fits its window and cannot scroll. So the exception goes, and every
   reading -- photo included -- keeps clear of the rail by the mock's own clearance from 820px, and
   by nothing below, where the rails sit at the foot; a find field that pops open is wider, and may
   overlap the reading briefly rather than push it.
3. **The page's tools are in the window, not on the screen.** `.page-tools` is fixed to the
   viewport, so on the box it floats outside the tray's right edge, and `.rail`'s own top offset is
   a guess (76px) at clearing chrome that lives outside the window in the wedding, not inside it as
   in the mock. Rule 9: undo, redo and leave are a stack at the bottom right of the tray on the box
   and of the window when one is open, the resource's own tools a stack at its top right;
   position both within `.cells` (and within the open resource), not the viewport, from 820px,
   at the mock's own offset from the window's edge. On a phone they may stay fixed to the screen's
   corner.
4. **The rails step aside for the drawer** (the rule 18 finding). The render knows a drawer is
   open (it renders the sheet), so the stylesheet can too: `main#app:has(.sheet) .rail`, and the
   page tools, move left by the panel's width from 820px, and the reading's right clearance grows
   by the same, so the chosen figure's `data-reveal` scroll brings it into the clear beside the
   panel. Nothing else moves; the tray keeps its shape.
5. **Inviting a household is adding, not a form on the rail.** `households`' own rail carries
   `form.invite` whole -- three fields and a submit button stacked in the tools -- which is not a
   tool, it is adding (rule 14), so it is the plus on the rail and a modal asking for the email and
   the names on the invitation, the plus-ones count too, the page inert behind it while it asks,
   the same as any other add. The rail then holds only tools: the reading switch, find, plus. Any
   other form living in a rail (`.rail .tool-form`) is the same finding, fixed the same way; a
   field that belongs to a row already in its own drawer (a course's plus-one count, a household's)
   is not this -- only a rail form that *adds* moves. The existing invite stories keep their `does`;
   one more for the modal opening:

```ts
story("The couple ask to invite a household, and the modal asks for the email", { as: "couple", does: at("households @ new=households"), seen: { couple: "households" } }),
```

6. **The eye.** The find form gets one more control beside the field: an eye (lucide `Eye` while
   dimming, `EyeOff` while hiding) that writes `/hide/<key>` `true` and, pressed again, removes it;
   while it is set, rows that miss are hidden (the `hidden` attribute) instead of `hushed`, and the
   tally still says n of m. Closing find removes both keys. Session key `hide.<key>` beside
   `filter.<key>`, never on the ledger. Stories:

```ts
story("Grace presses the eye; the gifts that miss are gone from the list, and the tally still says two of five", { as: "okafors", does: at("gifts @ filter.gifts=toast, hide.gifts=true"), seen: { okafors: "gifts" } }),
story("Grace presses the eye again, and the gifts that miss are back, dimmed", { as: "okafors", does: { doc: "session", ops: [{ op: "remove", path: "/hide/gifts" }] }, seen: { okafors: "gifts" } }),
story("Grace closes find, and every gift is lit and shown", { as: "okafors", does: { doc: "session", ops: [{ op: "remove", path: "/filter/gifts" }] }, seen: { okafors: "gifts" } }),
```

## Chat

Chat is a box whose ground is the room. Its session document is `{name, room}`; C2 adds `focus`
(whose drawer is open) and C3 adds `filter.conversation`, neither on the ledger. `stories.ts` gets
an `at` like the wedding's, `"general @ focus=bob"`: the place is the room, and a `seen` place names the
room the member stands in.

### C1. The room as a box

*Done, 0.42.0.* Entering a room opens the conversation, since that is what you came for; the way out of a room is the trail's root crumb on the box.


Rules 1 to 6, 9, 11, 12. Three resources: the people (faces with names; the summary counts who
is here), the conversation (the transcript, a list; the summary is the last line), and the rooms
(the room picker applet becomes this resource's reading: a list of rooms with a › into each,
the current one marked). Resources are cut into the tray by `src/tray.ts`, the conversation big.
The trail is `eta chat › #general`. Leave and log out are the stack at the bottom right, log out set
apart by a rule; undo and redo above them. Say is the conversation's own tool at the foot of its
reading, as it is. The corner family as in W1. The six stories stay green; their `seen` names the
resource where it named the page.

### C2. People are things

*Done, 0.42.0.*


Rules 13, 15. A face opens that person's drawer: the name, and whether they are here; your own
face's drawer lets you change your name, which is the write to `/name` that already exists. The
name asked at the door stays where it is: without a name you cannot enter a room, and the door is
not a drawer. Entering a room is the › on the rooms resource; a room nobody has is the plus and
a modal asking one question, the room's name, which is the write to `/room` that already makes a
room.

```ts
story("Ada opens Bob's drawer, and only her page shows him chosen", { as: "ada", does: at("general @ focus=bob"), seen: { ada: "general" } }),
story("Ada renames herself from her own drawer, and the room sees the new name", { as: "ada", does: { doc: "session", ops: [{ op: "replace", path: "/name", value: "Ada L" }] }, seen: { ada: "general", bob: "general" } }),
story("Ada asks for a new room, and the modal asks its name", { as: "ada", does: at("general @ new=rooms"), seen: { ada: "general" } }),
```

### C3. Find in the conversation

*Done, 0.42.0.* And on the rooms.


Rule 17. A word dims the messages that miss it and the tally says how many of all.

```ts
story("Ada finds hello; the message stays lit and the tally says one of one", { as: "ada", does: at("general @ filter.conversation=hello"), seen: { ada: "general" } }),
```

## The ticker

The ticker has no tray and no sign-in: a visitor's board and clock are their session's, as
`documents/clock.ts` already keys by `sessionId` with a default when nothing is written. The desk
needs the same: a `desk` document, the example's tray, keyed by `sessionId`, holding `open`,
`focus`, `new`, `reading.<key>` and `filter.<key>`, none of it on the ledger. This is the one
place a tray appears on an example without a login, and the reason it is here is that the rules
say the drawer and the filter are the session's, whoever the session is.

### T1. The desk as a box

*Done, 0.42.0.* The tray is `documents/desk.ts`, a session's own.


Rules 1 to 6, 9, 11. Three resources: the board (the watched symbols; its summary counts them),
the market (every quote; the summary is how many symbols move), and the clock (a thing: the city
and the time). The trail is `eta ticker › The desk`. Undo and redo are the stack at the bottom
right; there is no leave. The thirteen stories stay green.

### T2. The board's readings and the market's filter

*Done, 0.42.0.*


Rules 16, 17. The board applet's drawing -- the table with a sparkline each -- is one reading and a
plain list is the other, the current one pressed; the applet is the reading, not the resource.
Find on the market dims the symbols the word misses and counts.

```ts
story("Ann reads her board as a list, and only her page changes", { as: "ann", does: at("@ reading.board=list"), seen: ["ann"] }),
story("Ann finds CH in the market; Charlie Metals stays lit, the rest dim, the tally says one of five", { as: "ann", does: at("@ filter.market=CH"), seen: ["ann"] }),
```

### T3. Watch, drop, and the clock's drawer

*Done, 0.42.0.* Dropping asks in a modal; it did not feel wrong on the desk, so there is no finding.


Rules 13, 14, 15. Watching a symbol is the plus on the board's rail and a modal asking one question,
the symbol; the write to `/symbols/-` is unchanged, and the refusals ("cannot watch a symbol the
market does not quote") stay. Dropping a row is a delete, so it asks in a modal; if that feels wrong
on a desk, that is a finding against rule 14 (see "How to work"). The clock carries ✎ and its
drawer holds the city; the city picker applet becomes the drawer's control and the write to `/tz`
is unchanged. A row on the board opens its drawer: the symbol, its name, its price, and Drop.

```ts
story("Ann asks to watch, and the modal asks which symbol", { as: "ann", does: at("@ new=board"), seen: ["ann"] }),
story("Ann opens Bravo's row; her board shows it chosen and its drawer opens", { as: "ann", does: at("@ focus=BRVO"), seen: ["ann"] }),
story("Ann opens the clock, and its drawer offers the city", { as: "ann", does: at("@ focus=clock"), seen: ["ann"] }),
```

## After

When the wedding honours all eighteen rules, `docs/dzql/rendering/bento/README.md` points at the wedding for
each rule instead of at its own CSS, and the design canvas is regenerated from the wedding's pages
rather than the mock-up. Whether the mock-up then stays as a picture or goes is Peter's call, not
this request's.

## Order

K1, K2, K3 first, each with its client test and a changelog line; they are small and everything
below leans on them. Then W1, W2, W3, W4 in that order: the look changes nothing on the wire, the
drawer changes renders, open in place needs K1, the filter needs K3. Then C1, C2, C3; then T1, T2,
T3. The Londons stay a specification until the wedding has proved the rules on a real example.

## Findings

*Empty until something will not fit. Write the rule's number, the example, and what strained.*

**Rule 18, the wedding, W2/W3.** "The rails step aside for the drawer, and the content moves; the
window does not" -- the wedding's rails (`.rail.work`, `.page-tools`) stay fixed at the viewport's
edge whatever opens; they do not slide clear when a drawer docks over them, and the reading beneath
them does not reflow either. A drawer's own scrim and the reading's `scroll-margin` (K2) keep the
chosen figure findable, but the rail itself can sit over the drawer's own top corner on a narrow
desktop width. Fixing this needs the rail's own position to react to whether a drawer is open,
which the box's render already knows (`session.ui.focus`/`gift`/`keep`/`answering`) but `boxPage`
does not thread through to where the rail is built; doing it without plumbing that through felt
like bending the rule quietly rather than honouring it, so it is written down instead.
*25 Sep 2026: out of date for the window. `bento.css` now moves the rails and the page tools
clear of an open drawer (`main#app:has(.sheet)`). What still overlaps is the box's own page tools:
on the household's box the undo, redo and leave stack sits on the answer drawer's header.*

**Rule 7, the wedding, W3.** "Opening does not go anywhere; the same element grows into the
window" describes a tray cell growing into its own resource. It does not, and cannot, describe
the couple's own hop from a row in the households list (or a figure in its photo) into that
family's own box (`households/<id>`) -- a row is not a tray cell with a `data-moving` name to
grow from, so that one hop is a plain navigation, unanimated, the way every page transition was
before K1. The family's own box does honour rule 7 one level further in, growing its own "asks"
resource into its own window exactly as the root box grows any of its six.

**Rule 13, the wedding, W5.** "What the figure can carry waits in its drawer." An ask on the
couple's side has no drawer -- it is a name and one decision -- so its yes or no sits on its own
row in the family's asks window, the one place a row carries a control. Giving every ask a drawer
to hold two buttons would honour the letter and not the point.

**Rule 10, the wedding, W5.** "A picture is bigger than its window and scrolls under the
controls." No picture in the wedding is: every photo fits its window, so every reading keeps
clear of the rails, and when the drawer opens the photo reflows narrower beside it rather than
scrolling. The mock-up's map is the only reading that scrolls, and the wedding has no map.

### From duckdown

duckdown's editor (`Workshop/blueshed/duckdown`, `server/edit/`) was redrawn by these rules on 25 Sep
2026 (its ledger n134–140, the canvas at claude.ai/artifact/Y1QWMsHCw5X8rHJepmzD3c). It is the
first page built on them outside eta, and not a page of summaries: a person working on a page
of markdown, with the words and the page as a reader sees it side by side. These are the places
where the rules strained.

**Rules 4 and 7–10, duckdown's editor.** "A resource shows the state it is in … a › because it
opens" and "the same element grows into the window". The editor's tray is three resources
that are all open all the time: where you are (the tree), what you are changing (the page and
the one slot beneath it), what a reader would see (the preview). Nothing in it is a summary and
nothing grows into a window, because working means looking at all three at once. The rules
describe one kind of box, a box of summaries you open one at a time. This is a second kind, a
box of working resources, where the tray, the trail, the drawer and the modal hold and the
window has no part. The rules should say there are two kinds, so a workspace does not read as a
box that forgot its windows.

**Rule 13, duckdown's editor, n138.** "A drawer … opens its properties in a panel at the right."
In the editor the right is the preview, which is what shows the change, so a drawer over it
hides the effect of the edit it holds. A work chosen in the collection pane opens its
properties from the left, over the tree, the same size and shape as the right-hand drawer (Peter's
call: properties belong in a panel with room, but not over the preview). So the rule is about
what the drawer covers, not which side it comes from: it covers what you are not looking at
while you edit. The right happens to be that side in the wedding.

**Rule 2 and "say a thing once", duckdown's editor, n134 then n139.** The trail says where you
are, so n134 took the tree's `..` row out as saying the same thing twice. Using it on a real site,
Peter missed it, and `..` came back as the tree's first row. The trail is at the top of the
window; `..` is in the list where the eye and the pointer already are. A way up where you are
working is a control, not a label said twice. It is the case "say a thing once" should allow for.

**Rules 3 and 11, duckdown's editor, n138.** "The drawer and the modal 20, the tray and the window
28." That holds while the drawer floats at the viewport's edge, as eta's `.sheet` does. duckdown's
drawer sits inside the tray, a wall in from its edge, and at a fixed 20px against the tray's 22px
its corners bulged. It is now `calc(var(--radius-tray) - var(--wall))`, the same cut rule 3 gives
a resource in a corner. Rule 3's cut applies to anything placed inside the tray, not only to
resources. Rule 11's list should say its 20 is for a drawer outside the tray.

**Rule 6, duckdown's editor.** "On a phone the tray is a column … in the box's own order." Below
768px the preview has no place in the column: a page shown under the words it comes from is a
page you can't see while you type. It stays mounted and rendering, hidden. The header's Preview
lays it over the tree and the page at full height (the others go `visibility: hidden`, so the text
keeps its caret and scroll), and Edit or Escape puts it away. It counts as one of the things laid
over the page: showing it closes a drawer, and opening a drawer puts it away. So a resource can
leave the phone's column and come back as an overlay, when showing it beside its neighbours would
show nothing.

**Rule 2 extended into time, duckdown's editor, n136.** Earlier versions and Deleted were modals,
and now they are a place. The versions go where the tree was, since a version is also where you
are. The trail grows one crumb (`duckie › gallery › index.md › 23 Sep, 16:05`), and the version
shows read-only with the lines that differ from now marked, rendered in the preview. Any crumb
before it goes back to now, and Restore is one press that asks nothing, because what it replaces
is kept. This didn't strain the rules; it stretches rule 2 to cover a moment as well as a place.
eta's n1 (a document as it stood on a date) will need a page, and this is one that works.

### From reviewing the examples, 25 Sep 2026

On 25 Sep 2026 the wedding, the ticker and chat were read and used against the rules, at desktop,
375 and 320 (the work to do is in `todo.jsonl` n57-n72). In these places the example is right and
the rule should bend.

**Rule 1, chat.** Chat is neither kind of box. It is one window to work in, with nothing to open,
and rules 4, 7 and 13-18 have nothing there to act on. Beside duckdown's box of working
resources, that is a third kind. The name form in front of it (`renderNameForm`,
`resources/session.ts`) is a fourth: a door that asks one question before any page exists.

**C1-C3, chat.** They are marked done at 0.42.0, but 0.43.0 took the box down again: its drawers,
modal and find came from stories written after it was built, and the stories won. That is the
clearest case of "the stories win" so far, and this request should say so under C.

**Rule 14, chat.** A room is named in a form in place, because a modal needs tray state and chat
has none (CLAUDE.md says so; the Findings did not). The Send form is the stronger case: where
adding is the work itself, the form stays open at the foot, and a modal for each message would be
absurd. A modal is for new when making something is occasional.

**Rule 14, the ticker.** Its confirm modal says "Undo brings it back". A delete that Undo can take
back doesn't need asking about; duckdown's Restore asks nothing for the same reason. A modal is
for a delete that can't be taken back.

**Rule 14, the wedding.** Dishes and drinks are added and taken off inside the course drawer, with
no modal, and the story "The couple take the beef off" needs none. A list inside a drawer is a
property of the thing, not a new thing.

**Rules 1, 11 and 15, the wedding.** The household's answer and the couple's welcome are speech
bubbles above the tray, not resources in it. Each is a voice over the whole box, and its tail
points at the photo. The rules should allow a thing that stands on the ground rather than in the
tray.

**Rule 17, the wedding.** In a photo a missing figure reads as "not coming", so the photo rightly
never hides anyone. The eye is for lists.

**Rule 11, the wedding.** "Circles are for faces", but a colour swatch and an answer's status dot
are circles too, and read rightly as dots.

**Rule 16, the ticker.** The board's figures are a subset of the market's, so read literally the
two should be one resource with a reading or a filter. They are rightly two: two documents,
told to different people (the board only its own quotes). A resource is a document someone
reads, not a set of figures.

**Rule 4, the ticker.** "A summary line with the count" should move, but a live summary over a
shared document is told to every page of the box, and the stories want a tick to reach only
those watching that symbol. So the market's resource is blank today, and a summary's liveness
has to be scoped to who reads it.

**Rule 13, the ticker.** A quote has nothing to edit. Its drawer exists for one control, and its
properties repeat the lit row beside it. A drawer should hold what the row doesn't say.

**"Say a thing once", all three.** Some repetition is right:
- ✎ on every row is a control on each tap target, not a label said twice (as with duckdown's `..`).
- A household's trail ends in its own code, because the trail has to say where you stand.
- "You are Ada. Which room?" is the one place you see the name others see you by.

"Not said to them at all" should read "not said on their own things".
