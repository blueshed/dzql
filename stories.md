# Stories: what eta is for

*15 September 2026. Written after `history/change-request.md`, which is done as a list: what the wedding
asked of the kernel, item by item. This is not a list. It says what the three examples, the
kernel and the change request were reaching for, so that the next thing built is built towards
it. It comes out of a longer history: seven projects that each tried to keep what a person sees
truthful to what a database holds. The reader is Peter, and any
builder handed this repo.*

## The claim

An app is a set of stories. Each story says who does what, and who then sees it. Everything else
in the app -- the documents, the compartments on the page, the permit tables, who is told of a
write -- is derived from the stories, and the running app is tested by running them.

Two canons hold the whole thing up:

1. **Everything can be seen by someone.** No write lands nowhere. If a person may change it,
   somebody's page shows it, and the story says whose.
2. **Every change is complete and consistent.** A write happens whole or not at all, and what
   people see afterwards is what the tables hold.

hjeli proved the first on a model, with predicates, before code existed. epsilon proved the second
on the wire, with a law, after. eta does both on the running app, from one file of stories, and
needs neither a model beside it nor a copy of the document in the browser to compare.

## A story

A story is told in the wire's own words and no others: a session, a write, and who then sees it,
where. Three from the wedding's `stories.ts`:

```ts
// The cast: a session each, and the writes that put it where the stories find it.
cast: {
  couple:  [session("/code", "DASH")],
  okafors: [session("/code", "OKAFOR")],
  benToo:  [session("/code", "BEN")], // Ben's household, a second tab
  stranger: [],
},
// The write that puts a member at an address, in this example's own words: a page, the one thing
// open over it, and after " @ " what else the session holds there (find's word).
goTo: (address) => ...one session write...,

story("Femi's top turns green, and the photo everyone watches changes", {
  as: "okafors",
  from: "?guest=2", // his drawer, where the dress is
  does: household("replace", "/guests/2/minifigure/top", "#7FAE4E"),
  seen: { okafors: "", couple: "", benToo: "everyone" },
});

story("The Okafors leave the caterer a note, and only the couple read it", {
  as: "okafors",
  from: "?answer",
  does: household("replace", "/message", "Ada is vegetarian."),
  seen: { okafors: "", couple: "?family=1" },
  untold: ["ben", "benToo"],
});

story("A household cannot change the couple's welcome", {
  as: "ben",
  cannot: board("replace", "/message", "Hi"),
});
```

Every word in those is one eta already has. `as` is a session. `does` is a `{doc, ops}` message,
exactly as the browser or the CLI would send it. `seen` names who should notice and where: a page,
and whatever else the example's `goTo` understands, because a person sees only the page they are on
and a story says where its change shows; in an example with one page (chat's is the room; the
ticker has one), `seen` is just a list of names. Where people sign in, the cast signs in through the example's
own sign-in page (`signIn`), since a password is never a write. A place a story names must be a
place the example has: the harness checks the member's page stands where it was put. And it must
be a place a person can get to: the harness puts people there by a session write of its own, and
a story whose `from` no control leads to passes while nobody could do it (japan-eta's add-a-base
modal, whose story passed while Peter asked twice how to add a base). Everyone else in the cast must notice nothing, where the cast
left them: a story says everyone who sees its change, counts on a home page included, so one that
leaves someone out fails by name. `untold` names who must not even be told: sent no document's ops. `cannot` is a refusal: the permit table's
other half, told as a sentence, whichever layer refuses (the permit, a document that finds nothing
to change, a session with no document to resolve). A `cannot` with `told` also says what the
refused person is shown, beside the control that sent it (`refuse`, in the eta-app skill). Undo is a story too, and a redo, and the
harness runs them for free: every `does` is followed by its undo and its redo, and the seeing
must hold in reverse -- unless the ledger says the write is a fact (a tick), which undo must
leave alone, or the author has since gone (logged out), who has no undo to press.

What the undo takes back may be said to its author, over the page where Undo is (`afterWalk` and
`tell`, in the eta-app skill), and a `does` with `undone` says what it must say. The wedding's
household is told, since its Undo may change a photo someone else is watching, or a drawer that
is shut:

```ts
story("The Okafors say maybe, and the couple's photo and everyone's change", {
  as: "okafors",
  does: household("replace", "/answer", "maybe"),
  seen: { okafors: "?answer", couple: "", benToo: "everyone" },
  undone: "Undone: your answer.",
});
```

A story that starts from something the cast does not hold -- the deadline passed, a wine already
chosen -- says so in its `premise`: writes in the cast's own shape, a member's name and what they
write, made before anything else in the story and rolled back with it, so no other story starts
there. Each must change something, or the story is not told: a write refused, or one already
so, says a premise wrongly. What every story needs is the cast's; what the app should start with
is the seed's.

```ts
story("Once the deadline has passed, the Okafors cannot change their answer", {
  as: "okafors",
  premise: { couple: [board("replace", "/deadline", "2026-01-01")] },
  from: "?answer", // where the answers are, drawn disabled now: a live one would fail the story
  cannot: household("replace", "/answer", "maybe"),
});
```

A tab closing is a story with no write: `closesTab: true` in place of `does`. The socket goes, as
a browser's does, and whoever is still looking must see what the server tells of it; the author,
gone, sees nothing, and there is nothing to undo. Chat's:

```ts
story("Bob closes his tab, and Ada sees him leave general", {
  as: "bob",
  closesTab: true,
  seen: ["ada"],
  untold: ["cy", "dee", "eve"],
});
```

A story that writes may say how a person does it, where the page cannot: an applet draws its own
controls in the browser, so a drag across its days is the story's `gesture`, a `press` on what a
CSS selector names or a `drag` from one to another. Leave's:

```ts
story("Ann drags across two days in Bo's week, and sees the clash before she asks", {
  as: "ann",
  from: "2026-10",
  does: draft("2026-10-06", "2026-10-07"),
  gesture: { drag: [day("2026-10-06"), day("2026-10-07")] }, // each day's date, in its week's row
  seen: { ann: "2026-10" },
});
```

A story with a gesture is done by hand whenever it is told (the harness, step 6), and the drag
must send its `does`.

A story is one of the three -- `does`, `cannot`, `closesTab` -- with only that one's keys. The
harness refuses one that mixes them, or carries a key it does not read, before it runs: a story
file is not type-checked when it runs, and a key nobody reads would be dropped without a word.

The sentence at the front is the story's name and its whole value to a customer. It is what you
scroll through with the groom and ask "is this true?". The object after it is what runs.

*Learned from the first run (15 September).* The shape was first written with `seen` naming a
compartment. The wedding showed that a household's whole page is one compartment and the couple's
another, so the word carried nothing; what decided whether someone noticed was the page they were
on, and for choices and coming, the reading of the list. `seen` now names where. And `untold` was
first every member not in `seen`; the wedding's home pages, with their counts and the photo,
noticed nearly everything, so silence now means silence.

## What falls out

Given a pile of stories, these are not written; they are read off:

- **The permit table.** Every session role, path and verb that a `does` uses is permitted for
  that role, and every `cannot` is refused. Today each compartment hand-writes a list of regexes
  and verbs; the stories say the same thing as sentences, and the list is the one thing in a
  compartment that should be derived first.
- **The audience.** Who sees a document is who the stories say sees it. The change request's
  item 1 asked for a method on the compartment; it is better as a fact of the stories.
- **The pages and their places.** Where a change shows is where stories say it shows. A page
  nobody's story sees is not a page, and a compartment nobody's story sees is not a compartment.
- **The documents and their shapes.** The paths written say what a document holds; the values
  say what the paths refer to. Entities come last, as hjeli says they should.
- **The two canons, run.** Canon 1 is every `seen` checked on that person's page. Canon 2 is
  every `does` run through a browser and the page compared to a fresh render.

## Who compiles

Claude does. simple found this in the spring: the stories are the source, Claude reads them and
writes the documents, the compartments and the permit tables, and the harness runs the same
stories through the app and reports every place the reading was unfaithful. There is no story
compiler in code. The harness is not a proof tool for the app; it is the test of the compiler.

That is what makes the state shared. For the builder the stories are a recipe: deterministic
enough that regenerating an example is not a gamble. For a person they are a list of decisions:
legible enough to read aloud. Neither the code nor a model is the product. The stories are.

## The harness

One kernel function, `run(example, stories)` in `src/harness.ts`, and one script, `bun run stories`
(`src/stories-run.ts`; `ETA_EXAMPLE` picks the example). For each story:

1. Connect the cast over real sockets to a real server, apply each member's setup writes, then
   the story's own `premise` (each write must change something), and render every member from
   the documents the server draws from, its copy, as a page is drawn.
2. Put the author where the story says they act (`from`: the drawer or modal that holds the
   control), and find on their open page the control that sends the story's write -- a
   `data-write` with its document, op and path, and a button's own value; a field or a form sends
   whatever is typed, a select each option it can choose and a radio its value; an applet
   declares exactly what it writes (`data-writes`: an op and a path each, `*` for any one
   member but `-`, the end of a list, which an append names), and one that declares nothing offers nothing, whatever
   document it reads (the ticker's clock face shows the clock and writes none of it). A control
   the browser sends nothing from is none: drawn `disabled`, or `inert` (behind an open window or
   modal), `hidden`, in a `<template>`, or in a disabled fieldset (but for its first legend),
   itself or by what it is in, which ends where HTML says it does, end tag or none (a `<li>` with
   no `</li>` ends at the next); and the page's address
   (`data-page-write`) is the URL bar's and the back button's, not a control on the page. None is
   a failure: a story nobody can do from a page is not a story (`offPage` marks a write from a
   feed or the CLI).
   Then send the `does` as its session, with an id of its own as a page sends one, wait for the
   wire to go quiet, and it must have landed: its author echoed the change with that id, whoever
   else wrote meanwhile. A `closesTab` has no control to find: the author's
   socket closes, the server is waited for, and something must land for someone still looking.
3. Canon 1. Render every member again, from the same copy. For each name in `seen`, that
   member's page must differ from before; for everyone else, nothing of theirs may differ; and
   each name in `untold` must have been told of nothing: sent no document's ops, by the write,
   its undo or its redo (a page that reads a document is told every change to it, shown or not);
   after a tab closes, only who is still looking is looked at. For a `cannot`, nothing anywhere
   may differ, the ledger must not have moved, and the writer must be answered: refused, by their
   own write's id, and the page handed back. With `told`, that refusal must give that reason, and
   the writer's page must show it, and nothing else of it may differ (what an earlier write told
   them is not this story's: step 4); without it, a button on the
   writer's page that sends exactly the refused write is
   a control that always fails. Whatever the kernel reports failing while a story runs fails it, so a refusal
   that is really a crash is not a refusal.
4. Undo, and every page must be as it was before; redo, and every page must be as it was after.
   Where the author stands is theirs, not the write's: a write that put a modal away is looked
   at from where each was taken.
   Skipped when the write is off the ledger (its compartment says `ledger: false`, and the kernel
   reports a write that disagrees), when the ledger says it is a fact, or when its author
   has gone -- before the undo, or because of it (undoing the write that gave you your name); a
   story that says what its undo says (`undone`) then fails, since no undo says it.

   What the write, the undo and the redo each tell their author (`tell`: "Undone: your answer.")
   is theirs, and of that moment: the page before the write never said "Undone", nor will the page
   after the next. So the author's pages are compared as though they had been told nothing, the
   kernel's `told` document read as empty, here and in step 3, and what each told them is checked
   on its own, where it left them: it must be on their page, and after the undo it must be the
   story's `undone`, when the story says it. Only the line the kernel keeps is left out: words an
   app keeps in a session of its own are the page's, and an undo that changes them does not
   restore it.
5. After every story, where each could go, judged from where each story starts: the cast as its
   own writes left it, and the story's premise. In a cast of its own in that state, rolled back
   after, the harness walks from where it put each member: every page they are drawn there is kept
   by where it stands (`data-page`), with its controls, and a control leads somewhere when the op
   of `goTo`'s write that sets the address is exactly what it sends of its own value (a button's
   `data-value`, a radio's value, each option a select can choose, or a value an applet's mount
   names); going somewhere may put other things away too. The places their pages lead to, and the places those lead to, are where they can go.
   Each story's `from`, and each place its `seen` puts someone, that no control leads them to
   fails the story, by name: `no control leads okafors to "?guest=2", where the story has them
   act`. After " @ ", what else the place holds (find's word, a reading) must be sent by a control
   on the page there. The pages of the stories as they are told are not the walk's: a plus that
   another story's write drew is not one this story starts with. A page that says nowhere it
   stands (a welcome before a code) has nowhere to go, and is not asked. The URL and the back
   button are not controls: a place only they reach is one a person must be told about. Where
   they are told about it -- a link in an email, a shared URL -- the cast says so in its own
   writes: a member the cast puts at an address arrived there as the link brings them, and their
   ways start from it.
6. By hand, in a browser the size of a phone (`Bun.WebView`, `src/by-hand.ts`), as its author, in
   a tab of their session: each story that says its `gesture`, and with `STORY_BY_HAND=1`
   (`run(example, stories, undefined, { byHand: true })`, which `bun run stories:all` sets) these:
   - a write from a page (`does`, not `offPage`): the controls on the way to where it is done are
     pressed from where the story starts, each landing where it leads (a step a person cannot
     take, covered on a phone, is left for another way), then the write is done as a person does
     it -- a button pressed, a form typed into and sent, a select or a date chosen, or the
     story's gesture. What the page sent must be the story's write, and it must land: `by hand,
     ann could not replace /draft on team: the page sent replace /draft {…} on team`.
   - a refusal whose write a control of the page's own sent when it was told: walked to, then
     tried so, and it must not land. Where the control cannot make it (a select without that
     choice), nobody can send it from the page, as the story says.
   - any other refusal told from a place (`from`): walked to, and nothing pressed. One told where
     the cast stands with no control that sends it is not done by hand: that none does is the
     point. Nor is a write from no page, nor a tab closing.

   A press is a native click at the middle of the control, once it holds still and nothing
   covers it, never a script's `element.click()`; a drag is a mouse's pointer events, each sent
   to what is under the pointer, then the click a browser sends. A gesture's write is what the
   page sent from its press going down to the gesture done; what the page sends by itself,
   before anything is pressed or in the quarter second after a gesture's write lands, fails the
   story. A record may carry no key the story does not name, but for a field left blank. A write
   only an applet's own control sends is sent as its mount declares, unless the story says the
   gesture.
7. Report by story name. A failing story is a sentence, not a stack trace.

*What it does not do yet (17 September).* Said plainly, because a builder will otherwise trust it
for more than it checks:

- **A control hidden by a stylesheet still counts, until the story is done by hand.** Without a
  browser the harness reads the HTML, not what it looks like: a control under `display: none` by
  a class, `visibility: hidden`, `aria-hidden`, covered by something drawn over it, of no size,
  or off a phone's screen, is offered as if a person could press it. Only what HTML itself says
  is looked at: `disabled`, `inert`, `hidden`, a `<template>`, a disabled fieldset. By hand
  (step 6) each of those fails by name. By hand, a drag's pointer is not captured: its events go
  to what is under it, so an applet must allow `setPointerCapture` to refuse a test's pointer
  (leave's calendar does); and an applet's control no story says the gesture for is not worked.
  And a page that sends again more than a quarter second after a gesture's write has landed is
  not seen doing it: the harness waits that long for quiet, and no wait can catch every late send.

- **The morph is not under test.** Canon 2 is run without a browser: every member's open page is
  kept as the client would keep it -- a full render replaces it, a render in parts is applied
  part by part -- and after the story, its undo and its redo it must equal a fresh render from
  storage, each document read again from delta's tables: the one render here that reads them, so
  a copy that drifted from the tables fails too. So a write that reaches the tables and not
  someone's open page fails, by name. An applet that takes its document's patches itself is
  compared without its props. What the morph then does with the
  HTML, and what an applet draws, are the browser tests' to check.
- **A permitted write no story tells is not found.** Every control a story uses is on a page, and
  a button offered that is always refused fails; but the other way round -- a write the server
  accepts that no page offers -- needs a list of what is permitted.
- **No permit table is checked against the stories.** The intent was that a permitted write no
  story tells is a story nobody wrote. While permit tables are written by hand that check would
  run backwards -- it would push a builder to write a story after a feature, to justify it -- so it
  waits until the table is derived from the stories.
- **A story about the session cannot fail.** Any write to a session's own state changes its author's
  page, so "Ada opens the people, and only her page shows the window" passes whatever the code
  does. Such a story proves nothing. Tell what a person wants; where they must stand to see it is
  what `seen`'s place is for.

## What a story costs

*28 September.* japan-eta ran for a day at 8 KB a vote, for a 146-byte patch, and nothing said
so. So the harness keeps what each story's step -- the write, the refusal, the tab closing --
handed each member's page: the bytes as the page takes them, as they crossed the wire
(compressed: the cast's sockets go through the tap `bun run costs` uses, src/costs.ts), and the
biggest part, beside the write's own size; and the bytes a write's undo and redo handed each,
since a person's undo is a write too. `STORY_WIRE=1 bun run stories` says it under each story.
The wedding's:

```
 ok   The Okafors say maybe, and the couple's photo and everyone's change
        a 77-byte write handed
          couple  10,183 bytes (2.1 KB on the wire): photo 9.7 KB; undo 10,183, redo 10,183
          okafors 14,338 bytes (2.9 KB on the wire): photo 9.9 KB; undo 14,376, redo 14,339
          ben     514 bytes (248 B on the wire): everyone:1 patch 514 B; undo 516, redo 514
          benToo  1,490 bytes (566 B on the wire): everyone-photo 950 B; undo 1,494, redo 1,490
```

A part is named by its key (`part(key, html)`); a page sent whole is "the whole page", and a
document's ops are its patch. Here the couple are handed their whole photo again for one answer.

A `budget` says what a story may cost: the most bytes its step, its undo or its redo may hand any
one page, before compression -- what the page takes and morphs, and a size that does not move
with the random ids a compressed one does. A page handed more fails the story, by name, with the
step and its biggest part: `dee's page was handed 4,339 bytes on the undo, more than the example's
budget of 4,096: the most, ground, 3.9 KB`. It goes beside the story's other expectations, or on
the example's stories for every story, and a story's own stands in place of the example's.
Chat's is 4.5 KB:

```ts
export const stories: Stories = {
  cast: { ... },
  budget: 4608,
  stories: [
    story("Ada says hello; Bob, in the room, sees it; Cy, in the kitchen, does not", {
      as: "ada", does: say("hello"), seen: ["ada", "bob"], untold: ["cy", "dee", "eve"], budget: 1024,
    }),
```

## What we do not build

- **Not a modelling tool.** No `model.db`, no site to browse the entities, no predicates over a
  schema. The stories are in the app's own repo, in one file, in the wire's words.
- **Not a story language.** A story is a TypeScript object with a name and a few keys: who,
  the write, the refusal or the tab that closes, who sees it, where the author acts, how (a drag
  on an applet), what it alone starts from, what its undo says, and what it may cost.
  Each key came from a story that needed it (the premise, from a deadline passed for one story
  only; the gesture, from leave's calendar and japan-eta's drags; `undone`, from japan-eta's line
  that says what Undo took back; the budget, from japan-eta's votes); it will not need a grammar.
- **Not generated code.** Claude writes the compartments by hand from the stories, and a person
  can read both. When the permit table is the first thing derived rather than written, that is
  one function over the stories, not a code generator.
- **Not a client copy of the document.** epsilon's law compared the browser's copy to a
  recompute. eta's browser holds HTML, and the comparison is against a fresh render. The morph is
  what is under test.

## Where it starts

Chat first, as the ten-line proof: a name, a room, a message, someone else in the room sees it,
someone in another room does not. Then the wedding, where the stories already exist in prose in
its brief and the cast has three roles who see different things; that is the file that will
correct the shape above. The ticker last, because a tick is a story told by nobody -- the feed is
its author -- and a clock is a story with nothing on the wire after the page, and both will say
something about what `as` and `seen` mean at the edges.

After that, the derivations, in the order they become pure: the permit table, then the audience.
Documents and compartments stay Claude's to write from the stories, and the harness stays what
says whether they were written right.

## Open

- **Time.** The wedding's deadline locks answers. A story told after the deadline is a `cannot`
  that was a `does` the day before, and its premise moves the deadline into the past. The day
  itself coming (the names in the photo) is a clock no write moves: that may still need a `when`.
- **Values.** A story writes a value; the harness needs it to be a real one (guest index 1 must
  exist). The cast's setup writes are where that is made true, and they may grow longer than the
  stories. If they do, the seed is wrong, not the story. What only one story needs is its premise.
- **Who tells the ticker's stories.** `as: "feed"` is a session that is not a person. Presence
  has the same shape: a join is a story told by the socket, as a tab closing now is (`closesTab`).
- **Meanwhile.** A story cannot yet put someone else's write between its `does` and its undo
  ("Ada takes back her note, and Femi's, written after, stays"): the premise comes before.
