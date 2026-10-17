# The eta modeller: our own story

*24 September 2026, rewritten the same day. It follows [paintbrush.md](../../history/paintbrush.md) and
[easy-hjeli-pictures.md](../../history/easy-hjeli-pictures.md), and builds on [eta-on-delta.md](../../history/eta-on-delta.md)
and eta's `stories.md`. Written from the trees as they stand:

- eta at `e06210b`
- delta at `7917a5c` (`experiment/eta-engine`)
- the modeller work at `121a2e6` on branch `modeller/step-1`, in the worktree `Workshop/eta-modeller` (since 25 Sep, `Workshop/blueshed/eta-modeller`)
  (not pushed)
- the demo page, private: https://claude.ai/artifact/F8gVtR15c2Pi4bz42yXrSH

Facts are marked as facts; the rest is a reading, offered for Peter to say "is this true?".*

## What we are aiming for

Modelling is a collaboration between Peter and Claude, and **every document is an agreement they
reach**, as in Allertons: one side proposes, and the other answers.

- **Peter tells, and Claude reads back.** A story is agreed when Claude has written it in the
  wire's words and Peter says that is what he meant.
- **Claude proposes, and Peter agrees.** Each document, permit and table is proposed with a
  sentence ("a household, with its guests"), and agreed when Peter says the sentence is true.
- **The check is a helper.** After a change it writes the gaps it finds, and takes away the ones
  closed, as patches like any other write (as the harness writes its runs, and the ticker's feed
  its ticks). It never refuses anyone.
- **Nothing runs from the model, and nothing is generated.** Claude writes the code from what was
  agreed. The harness and a person's hand say whether it was written faithfully.

## The iteration

1. Someone tells a story, and it is the other's move.
2. Claude writes it in the wire's words (`as`, `does`, `seen`, `cannot`), and Peter agrees or
   says why not.
3. Claude proposes the documents, permits and tables it needs, each read as a sentence, and Peter
   agrees or says why not.
4. The gaps show what is still missing, as Claude's move. Claude closes each one, or proposes that
   it stands, with a reason, for Peter to agree.
5. Claude writes the code. The harness runs the agreed stories and records **A**.
6. Peter tries it with a hand on a mouse and records **U**.

## Our own story

The modeller's first stories are the modelling itself, in eta's words. `""` is home, which shows
whose move it is.

```ts
cast: { peter: [code("PETER")], claude: [code("CLAUDE")], harness: [], groom: [code("GROOM")] },
stories: [
  // Telling: a story is agreed when Claude's wire says what was told, and Peter says so.
  story("Peter tells a story, and it is Claude's move", { as: "peter", does: w("story", "add", "/-", { teller: "peter", told: "The Okafors leave the caterer a note, and only the couple read it" }), seen: { peter: "stories", claude: "" } }),
  story("Claude writes it in the wire's words, and it is Peter's move", { as: "claude", does: w("story", "replace", "/1/wire", { as: "okafors", does: "household replace /message", seen: "couple @ households/1", unseen: "ben" }), seen: { claude: "stories", peter: "" } }),
  story("Peter agrees the story, and modelling it is Claude's move", { as: "peter", does: w("story", "replace", "/1/answer", "agreed"), seen: { peter: "stories", claude: "" } }),
  story("Claude tells a story Peter's words implied, in the wire's words, and it is Peter's move", { as: "claude", does: w("story", "add", "/-", { teller: "claude", told: "A household cannot change the couple's welcome", wire: { as: "ben", cannot: "board replace /message" } }), seen: { claude: "stories", peter: "" } }),
  story("Peter says it is not quite true, and why, and it is Claude's move again", { as: "peter", does: w("story", "replace", "/2/answer", "not true: a household may not, the couple may"), seen: { peter: "stories", claude: "" } }),

  // Modelling: each proposal is read as a sentence, and agreed when the sentence is true.
  story("Claude proposes the document the couple watch", { as: "claude", does: w("model", "add", "/documents/-", { name: "household", root: "households", include: ["guests"], reads: "A household, with its guests", for: [1] }), seen: { claude: "model", peter: "" } }),
  story("Claude proposes the permit the story needs, and no other", { as: "claude", does: w("model", "add", "/permits/-", { doc: "household", op: "replace", path: "/message", reads: "A household may change its own message, and nothing else", for: [1] }), seen: { claude: "model", peter: "" } }),
  story("Peter agrees the permit's sentence", { as: "peter", does: w("model", "replace", "/permits/1/answer", "agreed"), seen: { peter: "model", claude: "model" } }),

  // Checking: after each write, the check patches the gaps: a gap found is added, a gap closed is removed.
  story("The couple's page does not read the households, so the note reaches nobody who should see it, and the gap is Claude's move", { as: "claude", does: w("model", "add", "/documents/-", { name: "board", root: "weddings", include: [], reads: "The wedding", for: [1] }), seen: { claude: "gaps", peter: "gaps" } }),
  story("Claude closes it: the couple's page includes the households, and the gap goes", { as: "claude", does: w("model", "replace", "/documents/2/include", ["households"]), seen: { claude: "gaps", peter: "gaps" } }),
  story("Claude proposes a gap stands, with its reason, and it is Peter's move", { as: "claude", does: w("decision", "add", "/-", { gap: "the feed tells stories and notices nothing", because: "a feed is not a person" }), seen: { claude: "gaps", peter: "" } }),
  story("Peter agrees it stands", { as: "peter", does: w("decision", "replace", "/1/answer", "agreed"), seen: { peter: "gaps", claude: "gaps" } }),

  // Proving: A is the harness's, a fact; U is Peter's.
  story("The harness runs the agreed story on the app, and A is recorded", { as: "harness", does: w("run", "add", "/-", { story: 1, passed: true }), seen: { peter: "checklist", claude: "checklist" } }),
  story("Peter tries it with a hand on a mouse, and U is recorded", { as: "peter", does: w("story", "replace", "/1/tried", true), seen: { peter: "checklist", claude: "checklist", groom: "checklist" } }),
]
```

There are no refusals yet. A `cannot` is added when something actually goes wrong without one,
not in advance.

## Where the words come from

Nothing above is new:

- **eta:** stories (`as`, `does`, `seen`, `untold`, `cannot`), the harness, `delta.ts`, bento,
  applets, and a home page that shows whose move it is.
- **UML:** use case, class, sequence and state diagrams, drawn from the facts below rather than by
  hand.
- **hjeli:** the six predicates and their gap names (the gaps page), `requires` and `byOther`
  (agreement), and "design from the write backward".
- **simple:** Claude as the compiler, checklists (`can`/`denied`, confirmed `A` and `U`), and flags
  before done.
- **Allertons:** agreements, where one side proposes and the other answers.

## One step removed: the documents in delta

Divided by where each document's truth lives, in eta-on-delta's kinds:

| Document | Holds | Kind | Persistent or transient | In delta today (facts) |
|---|---|---|---|---|
| `story` | `told`, `wire`, `answer`, `tried` | written | persistent: on the ledger, undoable | SQLite or Postgres backend, with the ledger |
| `model` | proposed documents, permits and tables, each with its sentence and `answer` | written | persistent | same |
| `decision` | the gaps that stand, with the reason and `answer` | written | persistent | same |
| `run` | the harness's results | fact | persistent: recorded, never undone | the ledger records facts |
| `gap` | what the check found missing (hjeli's six predicates, and where the code disagrees), each with its fix | live, written by the check | transient: the check writes it again from the agreements whenever it starts | memory backend (`registerMemory`, written by a caller in this process) |
| the desk | who is on which page, which drawer is open | live | transient | memory backend (`registerMemory`) |
| the code | `stories.ts`, `delta.ts`, the compartments, as they stand in the repo | sourced | outside: the repository | source backend (`registerSource`: read, and pushed on change) |

*Reading:*

- **The persistent documents are the agreements, the project's state.** For it to be repeatable, we
  want it in the repo. How is open: a committed JSON-file backend (paintbrush's rung, hjeli's
  `model.json`), or SQLite with its ledger, committed.
- **Whose move and the checklist are not documents.** They are how a page reads the agreements.
  Home shows the proposals whose answer is empty, for the one who must answer. The checklist page
  shows each story with its `run` and its `tried`. The server draws them from what they read, as
  every eta page is drawn, and sends only the parts that changed.
- **The gaps are written, as patches.** The check is a writer like the harness: it adds a gap it
  finds and removes one that closes, so a gap reaches a page the way every change does.
- **The code is sourced, never generated.** Claude writes it. The gaps compare what was agreed
  with what the source says, and a disagreement is Claude's move.

## What was built (facts)

A demo page, drawn for the wedding from what the app already holds, with nothing proposed:

| Shown | Read from |
|---|---|
| 46 stories, who tells and who notices, where | `stories.ts` |
| 13 tables and their columns; 6 documents, each with its root and includes, and its kind | `delta.ts` |
| 21 permit rules, and which stories each allows or refuses | the compartments' `RULES` |
| Where code touches a table outside a document (the seed, raw SQL) | a scan of the example's files |
| **A** for each story, what every member was sent and its size, and the ledger's before and after | a real harness run |
| Tasks | eta's `todo.jsonl` |

The only parts that are not facts are marked DEMO: agreeing a story, and ticking **U**. They are
kept in the page and nowhere else.

One page shows:

- **The model:** stories, then actors → documents → tables, then properties. hjeli's layout.
- **Five views** in the middle panel, all linked to the selected story:

  | View | What it draws |
  |---|---|
  | Model | actors → documents → tables |
  | Use cases | one boundary per document, who tells on the left, who notices on the right |
  | Classes | the tables, their parents, and what stories do to each |
  | Sequence | one story as the wire carried it, with its undo and redo |
  | States | each column that moves, from the ledger |

- **A document page**, as easy had it: the document's tree, and for each part who changes it, who
  is refused, and who notices.
- **Flags**, each pointing at the file and line a concept came from.

Code, on `modeller/step-1`:

- `modeller/extract.ts` reads an example's facts.
- `modeller/page.ts` builds the page for an example (`bun modeller/page.ts wedding out.html`).
- `modeller/from-stories.ts` and `modeller/report.ts` are step 1's run of hjeli's predicates over
  stories.
- One kernel change: `run(example, stories, observe?)`. The harness reports each write, what every
  member heard, and the ledger's `ops` and `inverse`. The run itself is unchanged; eta's suite is
  312 passing, coverage at 100%.

## What it found in the wedding (facts)

- **The couple acts in 20 stories, but no story makes someone the couple.** The cast starts them
  signed in with the code `DASH`. That code is a row in `couples`, which only `seed.sql:8` makes,
  and which `documents/session.ts:45` reads with raw SQL to decide who the couple is. hjeli calls
  this an unestablished actor.
- **States reached only by the seed.** Stories move a household's `answer` out of `yes`, but none
  moves one into it. `guests.coming` starts at `1` the same way.
- **A permitted write no story tells.** The rule `household remove /claims/\d+` allows a household
  to withdraw its claim on a gift. No story does it.
- **Locked after the deadline, and no story says so.** Three household moves are allowed by
  *dated* permit rules. Every story runs before any deadline. This is `stories.md`'s open question
  about time.
- **Seven refusals are made by who is writing, or by the value, not by the path.** The path rules
  would allow them; something else refuses.
- **The stories under-describe who is affected.** 29 times, someone a story does not mention was
  sent something, mostly patches to the `everyone` photo.
- **What changes cost.** The Okafors' own writes send them 12–16 KB (their `ground` part, whole);
  the couple gets 2 KB for the same change. Each of the 9 refusals re-sends the author's whole page,
  about 10–12 KB.

Step 1's earlier finding still stands: on Allertons' stories (157 now), every gap came from not
knowing which table a document's path lands in. `delta.ts` says it, and Allertons has no `delta.ts`
yet.

## What the agreements found in Allertons (facts)

Allertons is not built, so it cannot be run. Its agreements are drawn instead, in the UML session
(`uml/allertons`, `bun watch.ts allertons`): twelve state machines. Each arrow cites the stories
that move it. Every move is asked Peter's two questions, worked out from the stories' `seen`:

- **Do I have what I need to act?** Everyone with a move out of the state it lands in is told.
- **Can I see the consequences?** Everyone whose move put it in the state it leaves is told.

The parties are those told when a thing is made. Anyone else joins when first told of it. An arrow
to the end circle says it ends there, and to go again a new one is made. A state with no move out
that is not drawn as an end is flagged as undecided.

On first drawing, the checks found:

- **Sam was not told** when his blocked build was resolved or cancelled.
- **The BHA was not told** of a permit the venue granted, and revoking it was the BHA's move.
- **An offered package could not be bought.**
- **Six dead ends were undecided.**

Peter decided:

- A package is sold alone or in a campaign. Either way it is `agreed`, and it is gone for every
  other sponsor, on offer or not.
- Nothing ended goes again: a new one is made.

From those, the stories now say:

- A permit is revoked by whoever granted it.
- A worker is put only on a deployment the venue has accepted.
- The contractor sees Sam's availability.

Every status the stories move is now on a diagram, and every diagram passes. This is the contract
made visible before any code: each red arrow was a conversation, not a bug.

## The story canvas: the whole story on one page

Twelve state machines in alphabetical order are correct, but they do not show the story. Peter
asked for what a Gantt chart with a critical path gives a build: one large canvas with the whole
story, end to end. There are two now, one for each kind of model. Each is "stories" at the top of
its session's sidebar, and is drawn again on every change.

### One grammar for both

- **Lanes are who acts**, top to bottom. Each lane's header lists the documents that party has
  open, taken from the stories' `seen`.
- **Left to right is the order the story is told in**, in its sections.
- **An arrow's colour is who makes the move.**
- **Both of Peter's questions are on the page.** "Do I have what I need to act" is the page each
  state is seen on. "Can I see the consequences" is who a move reaches.

The clarity came from choosing this grammar first, and then placing things by hand. PlantUML's
automatic layout could not give it. What is hand-made is only where things sit. What they say comes
from checked sources, so the canvas cannot say anything the contract does not.

### Allertons: the intent, drawn before any code

`uml/allertons/canvas.ts`:

- **Lanes are the seven roles, and a state sits in the lane of whoever moves next.** An arrow that
  crosses lanes hands the turn over. An agreement that ends between two parties sits on the line
  between their lanes.
- **The critical path is highlighted.** Dashed lines are what one agreement waits on in another
  ("with its approved scenario", "only once accepted"). Each cites the story that says so, found by
  its words, so the citation follows when stories are renumbered.
- **Where the arrows come from:** the twelve checked `.puml` agreements. A state with no place on
  the canvas is listed in red.

Read whole, it shows what no single diagram did:

- **The contractor's lane is the spine.** The project runs the width of the page, and nearly every
  later agreement starts from a contractor's dot.
- **The sponsor goes quiet after the purchase.** Nothing is their move again, which is the open
  question of an engagement that never ends.
- **The venue's last move is accepting a deployment.**

### Chat: the facts, drawn from a run

`uml/canvas.ts`. Chat ports, but not as a copy:

- **Its lanes are the cast, not roles.** Chat has one role, so the lanes are Ada, Bob, Cy, Dee and
  Eve, each as the cast starts them.
- **Each column is one story, not a moment.** Every story starts from the same cast, so a column is
  a what-if against the same room.
- **There are no agreements to hand over.** Every move is the teller's own, and the only states are
  each person's session. So a column shows the move in the teller's lane, and in every other lane
  what that person heard, on which document:

  | Mark | Meaning |
  |---|---|
  | green | the story says they see it |
  | grey ✗ | the story says they must not, and they do not |
  | amber | they heard it, and the story does not say so |
  | red | the story and the run disagree |

- **It is drawn from a real run.** Chat is built, so nothing is inferred: the canvas comes from
  the harness's trace (`observe`). Each move also says whether the model (`uml/types.ts`) has that
  write, so the drawn intent and the built app are read side by side.

## What chat's canvas found (facts)

All 10 stories pass, and three columns are not as told:

1. **(6) Dee hears Cy come over, on the lobby** (`lobby:all`). No story says Dee is affected.
2. **(7) "Bob leaves" removes `/room`**, and the model has no such write. In the UML session, Peter
   ruled there is no leaving a room.
3. **(10) Logging out removes `/name`.** The model logs out by removing the whole session.

The first is a consequence nobody wrote down. The other two are the model and the app disagreeing,
and one of them has to give way.

This is the answer to "30,000 lines and I will not know if you have completed our contract". Before
the code, the Allertons canvas is the contract, and it can be read. After the code, the chat canvas
is what the app did, drawn in the same grammar. A column that is not as told is the contract unmet,
found before it becomes a bug.

## Next

1. **Make the agreements real.** The demo's Agree and **U** become the `story`, `model` and
   `decision` documents in the table above, kept in delta and committed with the project.
2. **The page as an eta app**, not a static artifact, so it follows the code as it changes (the
   code, sourced).
3. **Allertons' seed as data**, the first piece of its `delta.ts`. Then each story's
   before-state is the seeded row's value, and the agreements can be derived instead of drawn. The
   decisions no story states (the ends) become `cannot` stories on the ended states. Once Allertons
   is built, its canvas is drawn from a run, as chat's is.
4. **The ticker**, which has a `delta.ts`, on a canvas.
5. **These stories, our own**, as `examples/modeller/stories.ts`: the modeller's first model is
   itself.

hjeli's `requires` and `byOther` (a move that answers another) come in only if a gap needs them to
be seen.

## Open

1. **How the agreements reach the repo:** a committed JSON file, or SQLite and its ledger,
   committed?
2. **The groom:** does the customer only read, or also answer? "Is this true?" is asked of them
   too.
3. **Where hjeli's predicates live**, now that the check uses them: in delta, in eta, or imported
   from hjeli until it is put to bed?
4. **Chat: the model or the app?** Leaving a room, and logging out by removing `/name`, are in the
   built chat and not in the model. Which gives way?
5. **Should a story name everyone it reaches?** Dee hears Cy's move on the lobby, and the wedding's
   stories leave out 29 people who are sent something. Should `seen` be exhaustive, or is silence
   allowed for what only informs?
