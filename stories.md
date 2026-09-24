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
// Where a member must be to notice, in this example's own words: a page, and after " @ " what
// else the tray holds there (a drawer open, a list reading).
at: (where) => ...one session write...,

story("Femi's top turns green, and the photo everyone watches changes", {
  as: "okafors",
  does: household("replace", "/guests/2/minifigure/top", "#7FAE4E"),
  seen: { okafors: "", couple: "households", benToo: "everyone" },
});

story("The Okafors leave the caterer a note, and only the couple read it", {
  as: "okafors",
  does: household("replace", "/message", "Ada is vegetarian."),
  seen: { okafors: "", couple: "households/1" },
  unseen: ["ben", "benToo"],
});

story("A household cannot change the couple's welcome", {
  as: "ben",
  cannot: board("replace", "/message", "Hi"),
});
```

Every word in those is one eta already has. `as` is a session. `does` is a `{doc, ops}` message,
exactly as the browser or the CLI would send it. `seen` names who should notice and where: a page,
and whatever else the example's `at` understands, because a person sees only the page they are on
and a story says where its change shows; in an example with one page (chat's is the room; the
ticker has one), `seen` is just a list of names. `unseen` names who must notice nothing, where the
cast left them; anyone in neither is not asked, since a home page with counts on it changes for
many reasons and a story asserts only what it says. `cannot` is a refusal: the permit table's
other half, told as a sentence, whichever layer refuses (the permit, a document that finds nothing
to change, a session with no document to resolve). Undo is a story too, and a redo, and the
harness runs them for free: every `does` is followed by its undo and its redo, and the seeing
must hold in reverse -- unless the ledger says the write is a fact (a tick), which undo must
leave alone, or the author has since gone (logged out), who has no undo to press.

The sentence at the front is the story's name and its whole value to a customer. It is what you
scroll through with the groom and ask "is this true?". The object after it is what runs.

*Learned from the first run (15 September).* The shape was first written with `seen` naming a
compartment. The wedding showed that a household's whole page is one compartment and the couple's
another, so the word carried nothing; what decided whether someone noticed was the page they were
on, and for choices and coming, the reading of the list. `seen` now names where. And `unseen` was
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

1. Connect the cast over real sockets to a real server, apply each member's setup writes, and
   render every member fresh from the tables.
2. Send the story's `does` as its session, and wait for the wire to go quiet.
3. Canon 1. Render every member fresh again. For each name in `seen`, that member's page must
   differ from before; for each name in `unseen`, nothing of theirs may differ. For a `cannot`,
   nothing anywhere may differ, and the ledger must not have moved.
4. Undo, and every page must be as it was before; redo, and every page must be as it was after.
   Skipped when the write is off the ledger, when the ledger says it is a fact, or when its author
   has gone -- before the undo, or because of it (undoing the write that gave you your name).
5. Report by story name. A failing story is a sentence, not a stack trace.

*What it does not do yet (17 September).* Said plainly, because a builder will otherwise trust it
for more than it checks:

- **The morph is not under test.** Canon 2 is run without a browser: every member's open page is
  kept as the client would keep it -- a full render replaces it, a render in parts is applied
  part by part -- and after the story, its undo and its redo it must equal a fresh render. So
  a write that reaches the tables and not someone's open page fails, by name. An applet that takes
  its document's patches itself is compared without its props. What the morph then does with the
  HTML, and what an applet draws, are the browser tests' to check.
- **No permit table is checked against the stories.** The intent was that a permitted write no
  story tells is a story nobody wrote. While permit tables are written by hand that check would
  run backwards -- it would push a builder to write a story after a feature, to justify it -- so it
  waits until the table is derived from the stories.
- **A story about the tray cannot fail.** Any write to a session's own state changes its author's
  page, so "Ada opens the people, and only her page shows the window" passes whatever the code
  does. Such a story proves nothing. Tell what a person wants; where they must stand to see it is
  what `seen`'s place is for.

## What we do not build

- **Not a modelling tool.** No `model.db`, no site to browse the entities, no predicates over a
  schema. The stories are in the app's own repo, in one file, in the wire's words.
- **Not a story language.** A story is a TypeScript object with five keys and a name. If it
  needs a sixth key the first `stories.ts` will say so; it will not need a grammar.
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
  that was a `does` the day before. The cast may need a clock, or the story a `when`.
- **Values.** A story writes a value; the harness needs it to be a real one (guest index 1 must
  exist). The cast's setup writes are where that is made true, and they may grow longer than the
  stories. If they do, the seed is wrong, not the story.
- **Who tells the ticker's stories.** `as: "feed"` is a session that is not a person. Presence
  has the same shape: a join is a story told by the socket.
