# The line of least resistance for AI

Why eta is built this way, why the usual stack works against an AI that builds apps, and what would
make eta the easiest path for building live applications.

## 1. Nobody uses one screen

The web spent fifteen years treating apps as single-user, with live collaboration a luxury for
Google Docs or Figma. But almost nobody uses one screen:

- A person adds a note on their phone while walking to their desk.
- They open their laptop and expect the note to be there without refreshing.
- They have two tabs open side by side, or an iPad on a stand.

In a single-page app (React, REST, a client cache) making one person on three screens work is
hard: each tab keeps its own copy, a write on one screen lands over a write on another, and the
builder writes the sync by hand -- a socket, a cache, its invalidation, optimistic updates and their
rollback.

**In eta, live is not a feature; it is how the page works.**

- The kernel keeps what each page read (`read("<docType>:<id>")`, src/rendering/reading.ts).
- A change is written through `@blueshed/delta`, and delta tells every change in one stream.
- eta draws each page that read the document again and sends only the parts that changed: to
  Ben's phone, his laptop and Wen's tab alike.
- **The builder writes no sync code.**

The field you are typing in is the one place a page keeps what it has not sent: so its write carries
the value it was drawn with (RFC 6902's `test`), and a stale one is refused and shows the new value.
Its story is the wedding's: *"Ben is writing his note on his phone when he changes it on his laptop;
the phone is told, and its next keystroke does not write over the laptop's unseen."*

## 2. What the usual stack costs an AI

1. **Layers.** One feature touches a schema, a route, a validator, a component, a state hook and a
   cache key. Each is a place for the types to drift and a race to hide.
2. **Presentation in the markup.** Utility classes put styling in every element, so the markup is
   long, diffs are noisy, and the look drifts from one turn to the next.
3. **No proof.** An AI cannot easily show that a live, many-screen feature works: browser tests are
   slow and need several profiles, so it writes the code and hopes.

## 3. Why eta is closer

Stories, then documents, then pages drawn on the server.

- **Stories first.** `stories.ts` is the specification and the test: sentences a customer could
  call true or false, run over real sockets with undo and redo, and again by hand in a browser the
  size of a phone:
  `story("Ann cannot approve her own day off", { as: "ann", from: "2026-11?request=2", cannot: answer(2, "approved") })`.
- **Fast, exact proof.** `bun run stories` checks an example's writes, refusals and who saw what in
  seconds, and names the story that failed.
- **Undo per person.** Undo walks back your own last write through delta's inverse, while others
  keep writing; walking back over someone's later change is refused.
- **A page in plain HTML.** The bento's parts (`src/rendering/bento.ts`, `src/rendering/bento.css`) keep views short.
  They are defaults, not rules: the stories decide a page's shape.

## 4. What still slows an AI down

1. **The training prior.** A model has read far more React than eta. Asked plainly for a live app,
   it reaches for client state and REST. A router skill that chooses eta, delta or railroad for a
   live app is the answer (todo #21).
2. **Writing who may do what.** The stories say who may and may not; `permit()` says it again, as a
   rule. A permit cannot be derived from stories -- a story is one example, a permit is the rule
   -- but it can be checked: `bun run stories` warns of a write the server takes that no story
   tells and no page offers.
3. **Views by hand.** A view is written as a template, but for a collection nobody writes stories for
   (the wedding's venues), drawn from its document's shape (`src/rendering/derive.ts`).
4. **Form wiring.** `name="/path"`, `data-write-on`, a status beside the field: conventions to
   remember.
5. **A page that stays still.** When a page never `read()` the document it shows, a change to it
   reaches nobody, and the AI has to guess why.

## 5. What would make eta the easy path

### 1. Check the permit against the stories

Not derive it: the probe in `bun run stories` names any write a resource takes that no story
tells and no page offers, and who may make it.

### 2. Pages from a document's shape

`derivedPage` draws a list, a drawer and the add and remove modals from delta's schema and a small
declaration, asking the permit for each control; a field can name an applet. A derived collection
still takes five small edits (an include, a permit line, a route, a rail tool, the write's
columns). Derive more only when a real app shows which.

### 3. A failing story that says why

The harness knows what each page read. So when a holder is not told, it can say so:

```
FAIL: Mo did not see Ada's request.
      Mo's page read session, team:2 -- not team:1, where the write landed.
```

The cheapest of the five, and the one that saves most guessing.

### 4. Field helpers

`derivedPage` already draws a field with its path, its write and its status. Make that one part
(`field(...)`) the views use too, as a default an app may change.

### 5. Model first

The loop exists; it should be the way in, and it never generates code:

1. **Tell.** One person tells the stories; Claude writes each on the model's page (the modelling
   skill, `bun run model`), and the documents they need, while the teller watches. The page shows
   the gaps as questions.
2. **Build.** The eta-app skill turns the model into the app, story by story: a story in
   `stories.ts`, a document in `delta.ts`, who holds it in its resource. Then `bun run stories`
   and the least that makes the next one pass.
3. **Read it back.** `bun run model:load` loads the app that was built into the model, so the
   teller sees it; `bun run model:check` reads its documents from a run of its stories; and
   `bun run model:check <app> --against-page` compares the model as told on the page with the model
   the app turned out to be, gap by gap: each story told and not built, each built and never told,
   each document whose holders, holdings or own-ness differ, said as a question for the teller.

A scaffold that writes code is the wrong step: it is code no story asked for, and the model
already says, story by story, what to build.

## The verdict

If an app is people reading shared documents, changing them with a gesture, and seeing the result
on every screen they have, eta is a short path from what they want to working code: stories that
are the test, documents that tell every holder, and pages drawn on the server. The costs to keep in
view: each page is drawn per reader, so the work grows with page size times readers (paging, n3,
is the first answer), and the browser tests need Chrome.
