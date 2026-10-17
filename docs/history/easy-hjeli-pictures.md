# easy and hjeli: the pictures, and two kinds of complete

> **A record.** Kept as it was written, for the history and the citations. How an app is made
> now is the root [README](../../README.md#how-an-app-is-made); where this differs from the code, the code is
> right.

*24 September 2026. Input to the next step. It follows [paintbrush.md](paintbrush.md). Written
from the trees as they stand:

- easy at `c5dc39e` (archive head, 24 May) and `1f0473f` (v0.6.2, 22 Apr, the last version
  that renders)
- hjeli at `98f3c9a`
- rights' `derive-ux.ts` and `extract-diagrams.ts` at medwyn `5056e97`

Both tools were run side by side on scratch copies of their models and looked at in a browser.
Facts are marked as facts; the rest is a reading, offered for Peter to say "is this true?".*

## In one paragraph

Peter asked whether it makes sense that **easy seems so much more complete than hjeli, but hjeli
is better at completeness**. It does, because "complete" is doing two jobs:

- **Coverage.** Has everything been said? easy is complete this way: it says a lot, and it shows
  what it says as pictures.
- **Closure.** Is nothing that has been said left hanging? hjeli is complete this way: six
  predicates prove it.

You can reach closure by saying less, and hjeli did. Its port of the same domain holds a quarter
of easy's entities, and it is proven. The two tools also served different readers. easy was
complete *for the human*: pictures, pages, checklists. hjeli is complete *for the machine*:
predicates and exporters. documents-history names the goal as "a shared state with two faithful
readers"; each tool served one of them faithfully.

On pictures specifically, hjeli did not surpass easy's UML-like diagrams: it lost the use-case
picture, the entity-neighbourhood picture and the document page. The picture that *would* surpass
UML on hjeli's own terms, the **turn** (whose move it is), exists, but it was built outside hjeli,
in rights' `derive-ux.ts`.

## Two kinds of complete

### The same domain in both tools (facts)

Both hold the Allertons workflow, with the same five actors (Authority, Venue owner, Promoter,
Sponsor, Contractor).

| | easy (`model.db`) | hjeli (`data/workflow`, ported 30 May) |
|---|---|---|
| Entities | 42 | 10 |
| Fields | 243 | 36 |
| Relations | 66 | carried as foreign keys |
| Stories | 91 | 17 |
| Documents | 10, with 54 expansions | 7 |
| Methods / actions | 97 methods, each with a permission and what it publishes (171 publishes, 114 notifications) | writes carried on the stories |
| Human checks | 8 checklists, 57 checks (44 *can*, 13 *denied*), with `confirmed` flags for API and UX | none |
| Machine checks | `doctor` (orphaned references only) | six predicates, all closed |

hjeli's largest model is rights: 41 entities, 22 documents, 133 stories, 7 actors. So its grammar
does scale. It was the workflow *port* that was cut down, not the method.

### What the numbers say (reading)

- **easy is complete as a description.** Everything the conversation produced was kept: every
  method with its permission path, every notification, every checklist. Nothing checked it
  against itself.
- **easy did have a notion of completeness, and it belonged to a person.** A checklist is a set of
  *can* and *denied* claims per actor and method, with a `confirmed` flag for API and for UX, to be
  ticked by someone who has tried it. **None of the 57 checks is confirmed** (fact). Completeness by
  a person was designed and never exercised.
- **hjeli is complete as a proof.** Every write reaches a watcher, every actor has something to
  watch, every name resolves, and every write can be scoped to its author. That is closure over
  what the model says, and the model says less.
- **Closure is not the same as playable.** On the same workflow sample, hjeli's observatory shows
  "all closed" (observed), while hjeli's own `feature-request.md` records that `Project.accepted`
  and `Project.rejected` can never be reached: "the sample models an accept/reject flow nobody can
  drive". The proof is green and the model can't be played. On rights, the same check found that
  "the purchase move did not exist".
- **So there are three kinds of complete, not two:**

  | Kind | Question it answers | Who holds it |
  |---|---|---|
  | Coverage | Is everything said? | easy |
  | Closure | Is nothing said left hanging? | hjeli |
  | Playability | Can each actor actually take their turn? | neither: `derive-ux.ts`, outside both |

  Each tool held one kind. The next tool should hold all three.

## The pictures

### What easy drew (observed, v0.6.2)

The archive head renders nothing. Since the 24 May delta migration, the server returns the data
(checked over the socket), but every view is empty, so v0.6.2 is the last easy that draws.

- **Stories:** cards, "As a *Authority*, I can …", each linked to its documents, entities and
  methods.
- **Use cases:** actors on either side, stories grouped under the document they happen in (People,
  Org, Activity, Occasion, …), coloured by actor. At 91 stories it becomes one tall column with
  shortened labels. It answers *who does what, and where*.
- **One entity:** a UML class box (fields, types, `save()` and `remove()`), with its neighbours
  around it and labelled cardinalities (`packages (*)`, `organisation (1)`). It answers *what this
  is and what it touches*. The all-entities diagram at 42 is unreadable at full view; the
  per-entity diagram is what works.
- **One document:** the expansion tree drawn as a diagram, then **changed by** (which entities
  write into it, at which path), then **methods**, each with its permission path
  (`@organisation_id->Employee.person_id`) and what it publishes, then the **stories** that use
  it. It answers *what this screen is, what changes it, and who may*. This is the best page in
  either tool.

### What hjeli draws (observed)

- **The observatory:** actors → documents → entities in three columns, with the six predicates
  across the top.
  - **Selecting a story lights up its path**, for example *propose a permit*: authority →
    `MyOccasionsDoc` → `Permit.status`. That is new, and good.
  - **Selecting a predicate gives its verdict**, with any gaps shown on the canvas.
  - **Selecting an entity or document fills the inspector with text** (who watches it, who writes
    it, its fields and keys). There is no picture of its neighbourhood.
  - **The links between entities are not drawn**; the lines run document → entity.
  - **Stories are a list.** There is no use-case picture.
  - On rights (41 entities, 22 documents), it is the same three columns, much taller.
- **`export site`:** the model read back in plain language: per actor, their stories, what they
  watch, and what is in each view. Mostly it reads well. Where a scope is not simple, SQL leaks
  through ("Occasions, filtered live (Occasion.venue_id IN (SELECT …))"). The relationships come
  as a pure-HTML ownership tree, plus an ER diagram as **mermaid source, which is not drawn**.
  hjeli's own `feature-request.md` notes that Safari shows it as text.

### The pictures made outside hjeli (facts, from `medwyn/apps/rights`)

Rights' `bun run sync` runs hjeli's `export site`, then two scripts of its own:

- **`extract-diagrams.ts`** pulls the mermaid blocks into `diagrams.html` with a CDN renderer.
  At 41 entities the result, at page width, is an unreadable tangle (observed).
- **`derive-ux.ts`** ("The UX is the story graph, not the schema. Everything below is computed,
  nothing authored.") writes `ux.html`: per actor, **"your move"** queues. Each is a state another
  actor produced that is now this actor's turn, together with the stories that answer it and the
  document it is visible in. Warnings such as *single exit* are shown inline, and there is a flow
  audit at the top.

**This is the most useful picture found in either tool** (observed). hjeli's `feature-request.md`
(8 Aug) proposes adding it as predicate 7, *turn closure*, plus a later `export ux`. Neither has
been built.

## The picture that would surpass UML (reading)

UML's two diagrams answer **what exists** (the class diagram) and **who does what** (the use-case
diagram). easy drew both, plus a third, the document, which UML has no equivalent of.

hjeli moved the design centre twice:

- to *"a document is what an actor sees in order to do a job"*
- and, in practice (rights, the feature request), to *whose move it is*.

It kept drawing *what exists*, as columns of entities. The picture for its own thesis is the
**turn**:

- actors as lanes
- the states that pass between them as hand-offs (`Permit.status = proposed`: from Authority to
  Venue owner)
- at each hand-off, the document the move is seen in
- a turn nobody can take, or a state nobody can see, drawn as a break in the lane

UML's nearest equivalent is an activity diagram with swimlanes, which easy never drew either. The
data is already in hjeli's grammar: `requires` with `byOther` says whose move it is, write `to`
values name the transitions, and `opens` names the document. `derive-ux.ts` already computes it,
in about 250 lines.

This would also join closure and playability in one picture: a gap in the turn graph is both a
failed predicate and a break the reader can see.

One caution. By Peter's rule that *a ground is drawn as itself, chosen by a person, never
derived*, three derived columns are the modelling tool's version of the box. The turn is offered
as the model's picture, not decided as it.

## Putting them to bed

- **easy.** Archive it pointing at v0.6.2 (`1f0473f`), with a line saying the head's client
  renders nothing since the delta migration. What is worth remembering is its three pictures and
  the checklist idea: completeness confirmed by a person, per actor and method, for both API and
  UX.
- **hjeli.** Keep it as the proof engine and exporter. For its human surface to overtake easy, it
  would need:
  1. the **turn picture**, with predicate 7 (from `derive-ux.ts`, which rights already runs)
  2. **easy's document page**: tree, changed by, actions with their guards, stories
  3. **easy's entity-neighbourhood picture**, one entity at a time, never all 41
  4. the ER **drawn**, not left as source (or dropped in favour of 3)
- **paintbrush** (from [paintbrush.md](paintbrush.md)). Its influence here is the one
  already named: small, explicit, and a design system written for agents. A human surface for
  hjeli would want its own `DESIGN.md` in that style before any new picture is drawn.

## Questions for Peter

1. Does **three kinds of complete** (coverage, closure, playability) match your sense of it? Or
   is "easy feels more complete" about something else, such as the richness of the conversation
   it kept?
2. easy's checklists were **completeness confirmed by a person**, and never used. Was that because
   they cost too much to keep up, or because hjeli made them look redundant? Does a person's tick
   still have a place beside the predicates?
3. Is the **turn** the model's picture? Or is there a better ground for it?
4. Should hjeli grow easy's coverage back (methods with permission paths, notifications,
   checklists)? Or is the smaller grammar the point, with coverage living in the stories?
5. The hjeli workflow port stopped at 10 of 42 entities. Is it worth finishing, as a like-for-like
   test of hjeli against easy on the same domain?
