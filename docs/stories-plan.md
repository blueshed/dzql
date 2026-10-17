# Where stories live

*15 October 2026. A plan, not code: nothing in eta, delta or paintbrush has been changed. Written
from eta's `src/stories.ts`, `src/harness.ts`, `src/stories-run.ts`, `docs/stories.md`, the
eta-app skill's `reference/stories.md` and the modeller's `examples/modeling/loader/from-stories.ts`;
delta 1.0.0's `@blueshed/delta/testing` and `createLocal`; paintbrush 0.7.0's evolve skill and
tests; and canyou's `docs/stories.md`. Peter decides; the questions are at the end.*

*Reordered the same day, after `monorepo-plan.md`: railroad, delta and eta move into bluetools
(the dzql repo, renamed), a new app starts on eta through create-dzql, and paintbrush is
side-stepped. The split below stands; paintbrush's steps are dropped, and the order follows the
moves.*

*Revised 16 October, with the monorepo plan's review. Peter: the slated development is done first,
then the move. So steps 1 to 4 land **before** the move, in today's repos, each on its sibling's
published version (none needs a workspace). paintbrush's steps are not dropped yet: they wait on
the monorepo plan's question 8 (does a new app start on eta, or does paintbrush stay a way to
start?). The starter is named in its question 9 (`@blueshed/create-eta` proposed, in place of
create-dzql).*

## The gap

The lineage is stories → documents → entities. Only eta can tell a story. A paintbrush app, a
plain delta app, dzql's Postgres apps: none has `story()`, none has a runner. canyou shows what
that costs: 46 stories in a table in `docs/stories.md`, each marked ✓ "by reasoning, not run".
debk tells its stories by importing `eta/src/stories`, though it is documents first.

A story checks two kinds of thing, and they belong to two owners:

| What the story checks | Whose | Today |
|---|---|---|
| The write lands; who holds the documents it changes is told; nobody else is sent anything; a refusal moves nothing and says why; undo and redo put every document back; each holder's copy, with what it was told applied, equals what storage reads | **delta's**: it is the wire and the documents | eta's harness, steps 1-4, mixed with the page |
| A page offers a control that sends the write; the change shows on the right pages and no others; it can be done by hand on a phone; what Undo says; what a step costs a page | **the renderer's**: eta's server-drawn HTML, or a paintbrush app's railroad page | eta's harness, steps 2-8 and `by-hand.ts` |

The first half is already nearly in delta. Its law (`src/cases/law.ts`) checks "every watcher's
copy, with what it was told applied, equals what a reader reads from the tables" after random
writes; `createLocal()` gives a caller per identity (`as(me)`), undo and redo by cursor, and hears
every publish with who it went to (`onPublish`). A story is the law asked after a write someone
chose and named, with the people named too.

## The split

### Moves to delta: the story's words, and the document half

**`@blueshed/delta/stories`** (new subpath, `src/stories.ts`): the shape, and nothing that runs.
No `bun:test`, so an app's `stories.ts`, the modeller and eta can all import it.

```ts
import type { DeltaOp } from "./core";

/** One message, exactly as a client sends it. Eta widens the ops to its own (a `test`). */
export type Write<Op = DeltaOp> = { doc: string; ops: Op[] };
/** A document a member holds open: the wire's `open`. What is in front of them. */
export type Open = { open: string };
export const open = (doc: string): Open => ({ open: doc });

/** Each member, and the messages that put them where the stories find them: what they open, what they write. */
export type Cast<Op = DeltaOp> = Record<string, (Write<Op> | Open)[]>;

/** Who is told. A record's places are the page's (eta's `goTo`); the document half reads its names. */
export type Seen = string[] | Record<string, string>;

type Common<Op> = { as: string; premise?: Cast<Op>; model?: number };
type Does<Op> = Common<Op> & { does: Write<Op>; seen: Seen; untold?: string[] };
type Cannot<Op> = Common<Op> & { cannot: Write<Op>; told?: string };

export type Story<Op = DeltaOp> = { name: string } & (Does<Op> | Cannot<Op>);
export type Stories<Op = DeltaOp> = { cast: Cast<Op>; stories: Story<Op>[] };

export function story(name, body): Story;          // as eta's
export const writeOf = (s: Story) => ...;           // as eta's
export const STORY_KEYS = { does: [...], cannot: [...] }; // the core keys of each kind
export function misshapen(s: Story, pageKeys?: readonly string[]): string[]; // eta's check, moved
```

`does`, `cannot`, `as`, `seen`, `untold`, `premise`, `told`, `model` and the cast are the
document's words. `told` is the refusal's message: delta answers `{ code, message }`, and the
message is checked here; that the page shows it is the renderer's.

**`@blueshed/delta/testing`** gains the runner, beside the case suite it resembles
(`src/cases/stories.ts`):

```ts
/** What the runner needs of an app: its documents on a server, and who each member is. */
export type StoryApp = {
  /** Register the app's documents on `ws`, over a store in `dataDir` -- a fresh folder per story. What it returns closes it. */
  register(ws: WsServer, dataDir: string): Promise<(() => Promise<void>) | void> | (() => Promise<void>) | void;
  /** Who a member is, as the app's auth reads `client.data.identity` (createLocal's `as`). Omitted: anonymous. */
  me?(name: string): unknown;
};

/** A `bun test` per story, by its name: the failures are sentences. As `pathCases(standUp)`. */
export function storyCases(stories: Stories, app: StoryApp): void;
/** The same, as a report, for a CLI or the modeller. */
export function tell(stories: Stories, app: StoryApp): Promise<StoryReport>;
```

What it does for each story, in a fresh `dataDir` and a fresh `createLocal()`:

1. Each member a caller (`local.as(app.me?.(name))`) and a cursor of its own. Their cast in order:
   an `open` must answer, and its copy is kept as theirs; a write must land. Then the `premise`,
   each write of which must change something.
2. **`does`**: sent as the author, with their cursor. It must answer without an error. A member
   is told when a publish lands on a document they hold, or a send names their identity
   (`onPublish`'s `to`). Everyone `seen` names must be told; nobody else may be (see question 3);
   `untold` is then checked the same and said by name. Every member's copy, with what they were
   told applied, must equal a fresh `open` from a reader registered on the same store (law.ts's
   `reader`), or, for a free-form `registerDoc` that loads its file once, from the writing server.
3. **Undo, then redo**, on the author's cursor. Every copy must equal the one before the write,
   then the one after it. A document on no ledger answers undo with 400 (nothing registered): the
   story says so once and is not failed, as eta skips `ledger: false`.
4. **`cannot`**: it must be refused; with `told`, in those words. Nobody is told anything, and every
   copy equals a fresh read.
5. Keys a page reads (`from`, `gesture`, `offPage`, `undone`, `redone`, `budget`, a `seen`
   record's places) are accepted, not checked, and the report says once how many stories carry
   them. A key nobody reads is refused before anything runs, as eta's harness refuses one.

This runs any backend that registers on a `WsServer`: the JSON file and SQLite in delta, dzql's
Postgres through its own `register`, and a paintbrush app's `registerDoc`.

### Stays in eta: the page half, and eta's extra kinds

- `src/stories.ts` becomes delta's types widened: `Write<PatchOp | Test>`, and the keys only a
  page has -- `from`, `offPage`, `gesture`, `undone`, `redone`, `budget` -- with `closesTab` and
  `post` (a route's form) as eta's own kinds, `signIn` and `goTo` on `Stories`. It re-exports
  everything else, so `eta/src/stories` keeps every name it has today (debk, japan-eta and each
  example's `stories.ts` change nothing).
- `src/harness.ts` keeps its steps: Canon 1 on pages, Canon 2 against a fresh render, the walk,
  hidden verbs, by hand, the wire's cost. It takes `misshapen` and `STORY_KEYS` from delta and
  adds its own keys; it does not call delta's runner (its `seen` is stricter in a different way:
  it compares pages, not who was sent ops).
- An eta cast is writes only: its pages decide what is read. An `open` in an eta cast is refused
  by name ("an eta page opens what it reads").
- `bun run stories`, `STORY_BY_HAND`, `STORY_WIRE`, `docs/stories.md` and the eta-app skill's
  reference stay; the reference says the shape now comes from delta.

### The modeller's `from-stories` loader

It reads only the document half already: `as`, `does`, the names in `seen`, `untold`, the cast's
names. It imports `writeOf`, `Stories`, `Story`, `Write` from `src/stories` and `goTo` only to
leave the session's document out. Switched to delta's types (with `goTo` optional), it reads any
app's `stories.ts`: a paintbrush app's, canyou's once written, a plain delta app's. No move: the
modeller stays eta's example. An `open` in the cast is what the loader never had: who holds which
document. It may read it into the model's `opens` (today always `[]`), so hjeli's predicates
about what a document watches can run over delta apps' stories; that is a later step.

### A plain delta app's stories (paintbrush's steps, waiting on a question)

*Waiting on `monorepo-plan.md` question 8: dropped if a new app starts on eta, done if paintbrush
stays a way to start. What follows is kept either way for what it shows: a delta app's stories, told with `open` in the cast. delta's runner proves itself on
delta's own examples (kanban, shared-state) instead, and canyou can take the same shape.*

- **`src/documents.ts`**: `registerDocuments(ws, dataDir)`, taken out of `startServer` (which calls
  it), so the runner can register the app on `createLocal().server`.
- **`stories.ts`** at the app's root, as eta's: the template's own, for the message.

  ```ts
  import { open, story, type Stories } from "@blueshed/delta/stories";
  const say = (text: string) => ({ doc: "message", ops: [{ op: "replace", path: "/text", value: text }] });

  export const stories: Stories = {
    cast: { ada: [open("message")], bob: [open("message")], cy: [] },
    stories: [
      story("Ada changes the message, and Bob, who has it open, sees it", { as: "ada", does: say("Hi Bob"), seen: ["ada", "bob"], untold: ["cy"] }),
      story("A message is words: a number is refused", { as: "ada", cannot: { doc: "message", ops: [{ op: "replace", path: "/text", value: 7 }] }, told: "a message is a replace of /text with a string" }),
    ],
  };
  ```
- **`tests/stories.test.ts`**: `storyCases(stories, { register: registerDocuments })`. It counts
  for coverage like any test.
- **The evolve skill**: the order of work starts "Tell the story first, in `stories.ts`, and watch
  `bun test tests/stories.test.ts` fail"; `references/stories.md` (the shape, `open` in the cast,
  that a refusal is a story); each reference's example gains its stories, so `bun run test:evolve`
  runs them (notes' add and remove; the kitchen's "a line added to an order reaches the kitchen";
  undo).
- **By hand, second** (`tests/by-hand.ts`, the template's, beside `tests/browser.ts`): for each
  story with `from` (a route, `#/notes`) and a `gesture`, open one phone-sized `Bun.WebView` per
  member at the route their cast puts them at, take each page's `body.innerHTML`, catch what the
  author's socket sends (as `refuseWrites` already does), do the gesture, and check: the page sent
  the story's write; every `seen` page changed; every other page did not. That is eta's step 7 and
  Canon 1 on a client-drawn page. A gesture gains `{ type: [selector, text] }` for a field, beside
  eta's `press` and `drag`. The template keeps it until a second app needs it, then it is weighed
  for a package (question 4).

## Order of changes, and the release each needs

The move numbers are `monorepo-plan.md`'s.

| Step | Where | What | Release |
|---|---|---|---|
| 1 | `packages/delta`, after move 2 | `src/stories.ts`, the `./stories` export, its tests | with 2 |
| 2 | `packages/delta` | `src/cases/stories.ts` (`storyCases`, `tell`) in `./testing`; stories for `examples/kanban` (SQLite, ledger) and `examples/shared-state` (JSON file) as its proof; `delta-doc` skill's reference | **delta 1.1.0**, its first from bluetools (minor: two additions, nothing changed) |
| 3 | `packages/eta`, in move 3 | `src/stories.ts` widens delta's; harness takes `misshapen` from delta; `from-stories` reads delta's types; an `open` in a cast refused | **@blueshed/eta 0.54.0**, on Peter's word |
| 4 | `packages/dzql` | the same stories told against dzql's Postgres beside SQLite (delta's runner, dzql's `register`) | dzql's next |
| 5 | canyou | its 46 stories into `stories.ts`, run by delta's runner (canyou is on delta ^0.11: its delta upgrade comes first); debk imports `@blueshed/delta/stories` or `@blueshed/eta/stories` | the app's own, when it is picked up |

Before the move (16 October revision), step 3 takes delta's words from delta's release (1.1.0);
in one workspace later, eta would take them from its sibling the day they merge. The eta starter
(move 4, `@blueshed/create-eta` as proposed) is born with a `stories.ts` on these words.

## Step 1, ready to start

In bluetools, `packages/delta`, on a branch `feat/stories`, once move 2 is in. (If Peter wants it
sooner, it can start in `~/Workshop/blueshed/delta` now: the filter-repo merge carries the branch's
commits over.)

- `src/stories.ts`: the types above; `story`, `open`, `writeOf`, `STORY_KEYS` (core keys only),
  `misshapen(story, pageKeys = [])` -- eta's `misshapen` (`src/harness.ts` line 601) moved, with
  `pageKeys` the keys a renderer adds, so eta passes its own and delta's runner passes the page
  keys it accepts unchecked.
- `package.json`: `"./stories": "./src/stories.ts"`.
- `tests/stories.test.ts`: a story of each kind takes only its keys (types and `misshapen`); a
  mixed one (`does` and `cannot`), an unknown key and a page key with no `pageKeys` are refused by
  name; `writeOf` gives the write of each kind; `open` is the wire's open.
- CHANGELOG `[Unreleased]`; a todo.jsonl item for step 2.
- Done when `bun run ci` is green. No release until step 2 is in.

## Not in this plan

- **Hidden verbs for delta apps.** eta asks each compartment's `permit` without writing. A delta
  app's validators throw inside `ws.on("delta")`; asking them means writing and rolling back. Later,
  once the runner is used.
- **What a step costs.** delta's runner could count the bytes each member is told; eta's budget
  counts a page's HTML. Later, if a delta app with a page of its own needs it.
- **A tab closing and a route's form** for delta apps (`closesTab`, `post`): eta's kinds until a
  delta app has presence or a sign-in that writes documents.

## Questions for Peter

1. **Home.** The words in `@blueshed/delta/stories` and the runner in `@blueshed/delta/testing`
   (recommended: about 120 lines of types and 400 of runner, next to the law it reuses), or a
   package of its own (`@blueshed/stories`) that depends on delta?
2. **The cast opens.** A delta app's member says what they hold with `open("room:general")`, the
   wire's own word, beside their writes. Right word, and right place?
3. **Seen, at the document level.** delta's runner fails a story when someone not in `seen` is
   sent a change to a document they hold ("a document is what you need in front of you": if it
   changed, they saw it). eta lets a page be sent ops and show nothing. Strict for delta apps
   (recommended)?
4. The page half for paintbrush: waits on `monorepo-plan.md` question 8 (dropped if a new app
   starts on eta). A railroad island inside an eta page
   is worked by a story's `gesture`. Whether an island should declare what it writes
   (`data-writes`, as eta's applets do) so a story needs no gesture is eta's question.
5. **Step 3.** Part of eta's move into bluetools (the monorepo plan's question 3 says who), or a
   brief to the ETA plan session before the move?
6. **Release.** delta 1.1.0 as soon as step 2 is green, or batched with what else delta has open?
7. **canyou.** Its 46 stories into `stories.ts` when canyou is next picked up, after its move to
   delta 1.x?
