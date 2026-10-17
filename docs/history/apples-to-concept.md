# What apples_pears could bring to concept

> **A record.** Kept as it was written, for the history and the citations. How an app is made
> now is the root [README](../../README.md#how-an-app-is-made); where this differs from the code, the code is
> right.

*Context for a discussion, 11 September 2026. Written from both trees as they stand: concept at
`941f219` (3 Sep), apples_pears at `ba78295` (11 Sep). Facts are marked as facts; the rest is a
reading, offered for Peter to say "is this true?".*

## The two projects, in one paragraph each

**concept** (31 Aug – 3 Sep) is an attempt at *deriving usability*: seven single-noun apps on a
shared kit, judged by eighteen articles (`constitution.md`) and one currency, clicks plus keystrokes
per verb, counted by hand in the running app (Articles 1, 2, 10). Each app is a React page over one
JSON document on one socket (`kit/server` `runStore`, `kit/client` `connect`, one method: `save`).
The interface language is its own app, `wireframe`, twenty-two terms each with rules and open
questions. `scale.md` measures every idiom against the legacy's real dimensions (612 venues, 40k
areas, 5k products, 85k rights) and says what dies where. `market.md` rewrites the rights model's
133 stories as the customer's season. `direction.md` names what is next: yield, the right's rate,
the scenario, the racecard, retire, the sponsor's face. Nothing in concept derives a screen from a
model; the convergence between apps is prose (the wireframe's rules, the readme's queue), and the
kit holds only what all seven proved identical (1,130 lines). Usability is a discipline practised by
a hand on a mouse.

**apples_pears** (5 – 11 Sep) is an attempt at *deriving the mechanism*: two documents and a
library. A declaration in a text notation (hjeli's tree with apples' words on it) gives, without
app code: the documents composed per subject and carried over one socket with framed echoes and
revocation (pears); the readings from named axes, the drawer from the words, permission from
`owner`, `grant`, `self`, `gate` (apples); and the page from the grounds — one box per ground, a
collection as a page, the breadcrumb, the drawer for edit, the modal for new or delete, marks
(*The page*, once bento.md). The page table is written before the client and its closure run story
by story. The test of the text is the isolation build: an app made from the documents alone, every
gap a finding, every finding an edition. Fourteen editions of apples, seventeen of pears, twenty-four
runs, three applications. The library is 7,952 lines of plain DOM and SVG, no framework.

## The bridge that already exists (facts)

The two projects are not strangers. The flow so far has run one way, concept → apples:

- **Concept's apps were apples' briefs.** `tests/calendar-run1`, `location-run1` and
  `projects-run1` were built from `legacy-model.md`, each "an extract from concept/calendar",
  `concept/location`, `concept/projects`: the model, the rules, and the verb ledger with its hand
  counts. The derived ledgers were tested against concept's numbers: 13 of 14, 15 of 18, 12 of 12.
- **Concept's law is in apples' text.** `caption` and `required` came from the constitution
  (documents-history). Apples' *Keys and cost* is Articles 2 and 3 restated ("a verb reachable only
  by pointer is a defect, not a style"). *Ceilings* is `scale.md` restated, number for number (a
  select at six, a yard at two hundred, one document at a few thousand). *Filter* is Article 5
  ("dims what misses and never hides it; a count says what is hushed"). *Nearest answer wins* is
  Article 18. *The scenario* is direction.md's scenario noun, in apples' words (`proposed` on a
  root). A durable noun refusing `del` is half of Article 17.
- **Can You? is measured by the constitution.** `examples/can_you/UX.md` is a verb ledger "held
  against the Utility Constitution", by hand, Article 10.
- **Concept does not mention apples, pears or hjeli anywhere.** Its one pointer outward is
  `scale.md`: "medwyn's delta ops exist because of this exact number."

So the question is not "does apples know concept's rules". It does. The question is what would flow
back, and whether any of it is worth the disturbance to a project whose method is *use it weekly*.

## What apples_pears could bring, item by item

Each item: what concept has today, what apples offers, the evidence, and the doubt.

### 1. The second side: a subject, and permission from the words

**Today.** Concept has no subject. One file, one socket, everyone writes everything. Every ladder is
one hand's; Article 16 (*two sides*) is written and built nowhere. `direction.md`'s first three
steps — yield, the sponsor's face, the contractor's scenario — all need "a second person to hold
the other side", and `packages/todo.jsonl` says it plainly: "the conflict is visible now; its
resolution is a move with a second party."

**Offer.** This is the thing apples_pears was made for. The subject is the transport's
(`?user_id=`, a cookie, a code). The words give the whole permission table with no app code:
`owner`, `grant` with a `gate`, `self` on a grant row so that "an offer is answered by the side
that did not write it" — Can You?'s ask, accept, decline, suggest, withdraw, leave, each a refusal
or a permission the stories check over real sockets. Revocation is pears' `del`. Whose move it is
sits on the row.

**Evidence.** `examples/can_you_2/test/stories.test.ts`: every Article 16 move on the wire, Ana and
Ben and Cy on three connections. `pears.md`, *Can You?, on the wire*, matched message for message.

**Doubt.** Apples' subject model has known edges the wedding found (`todo.jsonl`
`mixed-subject-table`: one engine, one subject table, so a code-bearer and a signed-in user cannot
share it) — and the market has seven players. The proof that an actor can *play* a model is hjeli's
turn closure (documents-history, open question 6), not apples'; the 133 stories are already in
hjeli form in `medwyn/apps/rights`. For the market, the honest route is model → hjeli → apples, not
concept's kit growing a subject. That is a different project from concept.

### 2. The chrome derived, not re-drawn per app

**Today.** Every app carries its own frame: crumbs, rail, panel, help card. `readme.md`'s "More
like than different" is a convergence queue; five copies of the help table; `wireframe`'s samples
"are drawn by hand and go stale the moment an app moves on" (its own known limit). The kit
deliberately holds only CSS for these.

**Offer.** Readings from axes (a calendar, a map with drill, a wall, chips, a list) and the drawer
from the words, drawn by the library; the page's surfaces (`bento.ts`) and the router; the page
table as the design document. The three runs drew concept's calendar, atlas and planner "without a
line of drawing code" (calendar-run1) — the map with discs per zone and drill, the wall with the
drive in amber, the panel off the declaration.

**Evidence.** The runs' NOTES. Also what they could *not* draw: the level, the disc and the address
are the reading's and the page's, not the declaration's (location-run1 A13, A14); of the legacy's
eleven keys the notation places one (`n`); the wall's zoom does not survive an echo (projects-run1
C11); the panel's confirm cannot be turned off for an app with undo (C2).

**Doubt.** Concept's real value is not in its chrome but in `occasions/reckon.ts` (808 lines): the
wall *derived* from placements, the roster, the sheet, `resolve` for Article 18, `whyOf` for a
package's coverage. Apples has aggregates and *Derived axes*, and nothing that declares "a rig and
a derig per zone, sized by the products' efforts". Articles 14, 15 and 18 as code are concept's and
apples cannot say them. Bringing apples' chrome to concept would leave that layer exactly where it
is, in TypeScript, and that is probably right.

### 3. The ledger as a derivation and a test

**Today.** Counts are by hand, and three readmes say so in the same sentence. Article 2's "none goes
up unannounced" has no enforcement but a person walking the ledger weekly.

**Offer.** Apples says the ledger "is derived from the declaration, not counted by hand". In fact
it is half a derivation (lib NOTES 58; all three runs say so): the adds cost off `required`, the
pickers off the enum's buckets, the keys off `keyTable`; the rest is the readings' chrome and the
page's keys, stated not derived. But the half that is derived is a *test*: location-run1 asserts
fifteen rows meet the hand count and three part "for a said reason", and a cost that rose would fail
the suite. That is Article 2 made mechanical.

**Doubt.** Article 10 is the constitution's deepest rule: "reading code finds bugs; using the
product finds the truth." A derived count is the *target* column, not the *cost today* column. The
two should meet, and only the hand can say whether they do. The derived ledger does not replace the
weekly walk; it makes the walk's disagreements precise.

### 4. The transport past the ceiling

**Today.** `scale.md`: "One JSON document over one socket | dies at ~5k | 41k areas, 142k
placements. The whole-book save and broadcast — the kit's transport — has its ceiling here."
`occasions` re-derives every wall on every save (620 ms cold at a year's size).

**Offer.** Pears composes per subject and per document; a write yields a frame at the deepest
changed ancestor (`at`), not the whole book; sources name what a document reads so only what
changed recomposes; a list document takes a `where` on an axis, an `order`, a `limit`, and "a drill
per level is the same rule read through a tree".

**Doubt.** Apples says of itself: "a list document is one JSON document over one socket and dies at
a few thousand rows." Pears does not lift the ceiling; it gives the shape for standing under it
(windows, drill, framed echoes). And its cascade recomposes a document per write, per subject:
at York's size that could cost more than concept's memoised derivations, not less. This item is
"the right shape", not "faster". Nothing in apples_pears has been run at 41k areas
(`can_you_2/PAGES.md`: "Built; not exercised at scale").

### 5. Two vocabularies for one chrome

**Today.** `wireframe/data.json`: Title (crumbs), Tools (the rail), Cards, Properties (the panel),
Modal, Undo, Filter, Selection, Address, Rows, Keys; Map, Timeline, Table, Calendar; Entry, Select,
Typeahead, Multi-pick, Tags, Swatches, Levels. Written 2 Sep, as data, with rules and open questions.

**Apples, *The page*.** Box, compartment, collection page, breadcrumb, drawer, modal, tool, in place,
a choice the row can carry, the marks. Written 10 Sep as bento.md, folded in on the 11th; seventeen
rules in prose.

They agree more than they know. Crumbs are the breadcrumb ("the last crumb is the thing you are in").
"New stays a modal; anything that edits a thing you can point at is a panel" (wireframe, and three
open `edit-*-panel` items) is apples' rule 5 and 7 exactly. "A row with a checkbox saves on tick, no
Save" is apples' choice on the row. The panel from 820px "docked right, a modal that stays open" is
the drawer on a desktop. The address as hash and the filter out of it: both. Armed editing: both.

They disagree in three places, and each is a decision, not a detail:

| | concept | apples |
|---|---|---|
| Saving a field | explicit Save, in-panel errors, a dirty guard, "a draft that survives a rejected save" | written when you leave the field, one `replace`, no Save (rule 8); the refusal comes back as the echo's absence and a message |
| A remove | never asks: it happens, the undo strip holds it fifteen seconds (Article 4) | asks first, `confirmNamed`, the library's dialog; no undo |
| A durable noun | retire with a date, never delete (Article 17), built nowhere yet | refuses `del` by its foreign keys; no retire word |

Article 4 ("undo over confirm") is the constitution's; apples contradicts it and projects-run1
recorded the cost (C2). Concept's typeahead past six, multi-pick, tags and levels are controls
apples' library does not have (location-run1: "Tag a site" costs one more because chips has no free
entry; the ceilings say typeahead and nothing draws one).

### 6. A model with a proof behind it

**Today.** Concept has no model beyond each app's `parse`; no stories; the market's stories live in
another repo. `prompt.md` says "do not read the rest of medwyn". "One noun per app" is a decision.

**Offer.** A document is what an actor watches to do a job, closed to that actor, and hjeli proves
the set complete and safe before code. Article 13 ("scope is a promise: a control offers only what
is reachable from where the user stands") is document altitude said from the user's side.

**Doubt.** This is where the two philosophies actually part. Concept: an app per *noun*, the noun
drawn full-window, tools out of the way. Apples: a document per *actor's attention*, several trees
over the same tables. The occasions app is already four readings and a roster over one book — one
noun, several attentions. Whether "one noun per app" is a principle or was a convenience of the
one-file transport is the first question below.

## What concept has that apples_pears lacks

For the discussion to be honest, the reverse list:

- **The derivation layer as code.** `reckon.ts`, `rights.ts` (`whyOf`), `build.ts`: Articles 14,
  15, 18 running. Apples declares none of it.
- **Scale, felt.** York at eight levels, 643 sites, 193 placements; `scale.test.ts` at a year's
  size. Apples' ceilings are written, not exercised.
- **The controls past six.** Typeahead, multi-pick, tags, swatches, the lozenge.
- **Undo over confirm, and the strip that names what went.**
- **Performance as a currency**, five channels graded on real sites from the legacy.
- **The imports.** 387 recipes from 5,142 rows; York's tree with the `leaf` flag lesson.
- **A framework people know.** React, and a component library the design canvas can draw. Apples is
  plain DOM by conviction. Neither is the banked stack for the finals (Next + Supabase + shadcn,
  current-work.md), which matters for what either is *for*.

## Three routes, and a recommendation

**A. Leave both where they are.** Concept stays the usability lab, apples the mechanism lab; the
flow concept → apples has already happened and can continue by hand. Cost: nothing. Risk: the
market's second side gets built twice, once in each idiom, and neither at real scale.

**B. Concept adopts pieces.** A declaration per app with the ledger derived as a test (item 3);
pears as the transport only where a second side is needed (packages, yield, the sponsor's face).
Cost: two transports in one family, and React over pears' client is unbuilt. Risk: the kit's
whole-book save and pears' per-subject documents disagree about what a save is.

**C. Rebuild one concept app from the documents, the way can_you_2 was built.** A fourth
`legacy-model.md` extract — *packages*, the market's door, sixteen verbs, the smallest of the
market-shaped apps — built from the fourteenth and seventeenth editions alone, with two actors
(the promoter composes, the sponsor answers), the page table first, the ledger tested against
concept's hand counts, run on York's 643 rights. This is the method the repo already has and has
run three times on concept's own apps. It answers items 1, 2, 3 and 5 with numbers instead of a
reading, and it is the first Article 16 build anywhere. Cost: a day, and a `packages-run1` in
`tests/`. What it cannot answer is item 4 (scale) and the derivation layer, and it should say so
before starting.

**Recommendation: C**, because the disagreement between the two projects is not about ideas — the
ideas are already shared — but about whether a declaration can carry a two-sided screen at
concept's click costs, and only a build says. If C is not wanted, A over B: half-adopting a transport
is the worst of the three.

## Questions only Peter can answer

1. **Is "one noun per app" a principle or a convenience?** If a principle, apples' document-per-
   attention is the wrong shape for concept and item 6 closes the discussion. If a convenience of
   the one-file transport, occasions already broke it.
2. **Save or write-on-leave; confirm or undo.** Concept's Article 4 and apples' rule 8 and its
   `confirmNamed` cannot both be the family's rule. Which document yields?
3. **One interface language or two.** The wireframe (22 terms as data, with questions) and *The
   page* (17 rules in prose) describe one chrome. Should one be the home, and which? The wireframe
   has the controls; *The page* has the grounds.
4. **Where does the market's second side live?** On pears (the ask, as apples_pears was made for),
   on epsilon's op log (documents-history's open question: "pears and epsilon, layers or
   alternatives"), or in concept's kit grown a subject? The 133 stories already exist in hjeli.
5. **What is either project for**, given the finals are banked on another stack? If both are labs,
   route C is cheap and decisive. If concept is the seed of the Allertons app, the question is
   larger than this document.
