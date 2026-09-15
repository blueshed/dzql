# Stories: what eta is for

*15 September 2026. Written after change-request.md, which is done as a list: what the wedding
asked of the kernel, item by item. This is not a list. It says what the three examples, the
kernel and the change request were reaching for, so that the next thing built is built towards
it. It comes out of a longer history, `Workshop/documents-history.md`: seven projects that each
tried to keep what a person sees truthful to what a database holds. The reader is Peter, and any
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

A story is told in the wire's own words and no others: a session, a write, and where it is seen.
Here are three from the wedding, in the shape the first `stories.ts` will correct:

```ts
// The cast: a session each, and the writes that put it where the stories find it.
const cast = {
  couple:  { code: "DASH",   page: "board" },
  okafors: { code: "OKAFOR", page: "household/guests" },
  ben:     { code: "BEN",    page: "household" },
};

story("Mrs Okafor turns her daughter's top green, and the couple see it on the board", {
  as: "okafors",
  does: { doc: "household", ops: [{ op: "replace", path: "/guests/1/minifigure/top", value: "green" }] },
  seen: { okafors: "household", couple: "board" },
  unseen: ["ben"],
});

story("The Okafors say yes, and their figures walk into everyone's photo", {
  as: "okafors",
  does: { doc: "household", ops: [{ op: "replace", path: "/answer", value: "yes" }] },
  seen: { okafors: "household", couple: "board", ben: "board" },
});

story("A household cannot change the couple's welcome", {
  as: "ben",
  cannot: { doc: "board", ops: [{ op: "replace", path: "/message", value: "Hi" }] },
});
```

Every word in those is one eta already has. `as` is a session. `does` is a `{doc, ops}` message,
exactly as the browser or the CLI would send it. `seen` names, for each member of the cast who
should notice, the compartment that shows it; `unseen` names who should not. `cannot` is a
refusal: the permit table's other half, told as a sentence. Undo is a story too, and a redo, and
the harness runs them for free: every `does` is followed by its undo and its redo, and the seeing
must hold in reverse.

The sentence at the front is the story's name and its whole value to a customer. It is what you
scroll through with the groom and ask "is this true?". The object after it is what runs.

## What falls out

Given a pile of stories, these are not written; they are read off:

- **The permit table.** Every session role, path and verb that a `does` uses is permitted for
  that role, and every `cannot` is refused. Today each compartment hand-writes a list of regexes
  and verbs; the stories say the same thing as sentences, and the list is the one thing in a
  compartment that should be derived first.
- **The audience.** Who sees a document is who the stories say sees it. The change request's
  item 1 asked for a method on the compartment; it is better as a fact of the stories.
- **The compartments.** The places on the page are the places stories name in `seen`. A
  compartment nobody's story sees is not a compartment.
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

One kernel function, `run(example, stories)`, and one script per example beside its cost
measure. For each story:

1. Connect the cast over real sockets to a real server, apply each member's setup writes, and
   render every member fresh from the tables.
2. Send the story's `does` as its session. Let every echo and render land.
3. Canon 1. Render every member fresh again. For each name in `seen`, that member's named
   compartment must differ from before; for each name in `unseen`, nothing of theirs may differ.
   For a `cannot`, nothing anywhere may differ, and the ledger must not have moved.
4. Canon 2. For every member with a page open in a real browser, the page the morph holds must
   equal a fresh `render(sessionId)` after the story's echo, with each applet compared by its
   props and not its drawn insides. Then undo, compare again; redo, compare again.
5. Report by story name. A failing story is a sentence, not a stack trace.

Before any story runs, the harness checks that every rule in every permit table is used by at
least one story. A permitted write no story tells is a story nobody wrote, and the harness says
so by the rule.

Item 10 makes step 3 cheap: a compartment renders into `#c-<docType>`, so "did the couple's board
change" is a comparison of one element, not a diff of a page. Item 11 makes step 4 honest: a
story that throws halfway leaves nothing behind to compare.

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
- **Applets.** A tick is seen by the board applet, not by a compartment's render. `seen` may
  need to name an applet's props as well as a compartment's element.
- **Who tells the ticker's stories.** `as: "feed"` is a session that is not a person. Presence
  has the same shape: a join is a story told by the socket.
- **The negative space.** `unseen` lists who should not notice. Whether the harness should
  assume everyone not in `seen` is unseen, or only those named, is the difference between a strict
  canon and a lenient one. Start strict and see which stories complain.
