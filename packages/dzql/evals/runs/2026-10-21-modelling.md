# modelling: 21 October 2026, round 3

Run by `bun scripts/evals.ts` on blueshed/dzql at 986b1223: each scenario a fresh `claude -p`
(Claude Code, its default model) in a project made from the checkout, its packages installed as
npm ships them, given its query word for word, with nobody stepping in. Graded by a separate
session from each run's diff and files, `bun check` and the tests run again; a session's last
message taken only as its claim. Compared with round 2 (`2026-10-20-modelling.md`): what that found was
fixed between the two, and some scenario lines changed with it. What this round found is
fixed in the commits after 77e359da.

---

Each scenario ran as a fresh `claude -p` session, with nobody there, in a project made by
`bun create dzql --local` from the checkout, with the packages installed as npm ships them. The
skills were the checkout's (`.claude/skills/modelling` in run 1 is byte-identical to
`packages/dzql/.claude/skills/modelling`). Each session was given its query word for word.

The grade draws on `git diff start HEAD` in each run, the files it left, and the session
transcripts (`~/.claude/projects/-Users-peterb-Workshop-evals-2026-10-21-dzql-modelling-<n>/`).
`bun check`, `bun test`, `bunx dzql model check` and `bun run model:check --against-page` were run
again on copies in a scratch folder. Nothing in the runs was changed, and no server was started.

| Scenario | Score | Round 2 | Minutes | Exit | Page stopped |
|---|---|---|---|---|---|
| 1, bakery, told from scratch | **5.5 / 7** | 6.5 | 2.3 | 0 | yes, `bun run stop` (`stopped 15714`) |
| 2, café surrogate, from 3d12b19d | **5 / 5** | 5 | 1.0 | 0 | yes, `bun run stop` |
| 3, café "now build it" | **4.5 / 5** | 5 | 5.3 | 0 | started by accident, then `pkill` (see F10) |
| **Total** | **15 / 17** | 16.5 | | | |

The hang is gone. Every run exited on its own, and no run restarted the page. The points lost
are new: scenario 1's model passes every check but fails its own proof, and the session never
ran the proof. Scenario 3 never read the app back against the model.

---

## Scenario 1: bakery pre-orders, told from scratch

Result: `model.json` holds 7 stories and 3 documents: `day` (the baker's, with its orders),
`calendar` (a list of days, held by customer and baker) and `order` (one order, the
customer's). Every check is closed, so the page made `model/` itself, along with `todo.jsonl`
(8 open questions). Nothing was written in `src/`.

### Why 3 tests fail

The 3 failing tests are all in `model/model.test.ts`, the proof the model wrote. `bun test`
gives 7 pass and 3 fail, and every failure has the same cause:

```
"message": "story 1 (\"A customer orders loaves for a day ahead\") is told on order, not day"
```

- **What the customer holds.** The only document the customer holds that holds `orders` is
  `order`, a single-row document whose root is `orders`. You cannot add a new order through a
  document that is that order. `day` holds orders under a day, but only the baker holds it. So
  the model gives the customer nowhere to place an order.
- **The checks miss it.** Authorization closure asks only whether the teller holds a document
  holding the entity they write, and `order` qualifies, so it shows closed. `bunx dzql model
  check` on a copy says all eight are closed and remakes the same `model/`.
- **The proof planner puts the write on `day`.** `src/modelling/definitions.ts` `planOf` →
  `best` picks where the write goes. It scores the row's own one-row document as cost 2, and a
  document the teller does not hold as cost 1. So it writes story 1 on `day:1`, as the customer.
  `guards.ts` allows story 1 only on `order` (`m.writable`), so the guard refuses the write.
- **Which tests fail.** Story 1's own case fails. Story 2 ("baker says baked") and story 6
  ("customer cannot … say an order is baked") fail too, because each needs story 1 as its
  premise.
- **A fourth problem, hidden.** Story 4, "A customer cannot order for a day once the baker has
  closed it", is the teller's own refusal, and it has **no case at all**. Only `calendar` serves
  it, and `calendar` holds no `orders`. `writesOf` returns nothing, and `testsOf` drops the story
  without a word (`if (!writes.length …) return []`). The headline rule exists in `guards.ts` but
  is unproved.

The session never ran the proof. Its last message says "all eight of its checks pass" and does
not mention `model.test.ts`. The skill never asks it to run the proof (see F8).

| Line | Verdict | Evidence |
|---|---|---|
| Starts the page, hands the teller their link at once, signs the CLI in with its own | **partly** | `bun dev` in the background at 23:13:42. `bun run model login <Claude's link …ad106836>` at 23:13:57, so not as the teller. Peter's link (`…87da9131`) was never said in any message. The last message says "The link I gave you earlier stopped working", which is untrue. It did say to run `bun dev`, which the skill's headless sentence asks for. |
| Writes each story as told (who, does/cannot), one change at a time, never a wall of commands | **partly** | The words, actors and kinds are right ("A customer orders loaves for a day ahead", customer does). But the writes went in shell-function batches: `m(){ bun run model "$@" … }; m writes 1 …; m requires 1 …` made 7 writes in one call at 23:14:26, then 9 at 23:14:34 and 9 at 23:14:59. Three stories were chained with `&&` at 23:14:14. |
| The refusal is a cannot story | **held** | Story 4, customer cannot "A customer cannot order for a day once the baker has closed it", `writes add orders`, `requires days.closed=true`. |
| Documents named one word for what a person needs | **held** | `day` (the baker's list), `order` (the customer's), `calendar` (the days to choose from). |
| The closing state is a field on the row, set by a story | **held** | `days.closed:boolean`. Story 3, "The baker closes a day", writes `replace days.closed=true`. Stories 1 and 4 require it. |
| Reads the checks after each change, closes one-answer gaps itself and says so, asks only what could go either way | **partly** | It read the checks after each batch (`show` at 23:14:35, 23:14:50, 23:14:59 and 23:15:02), not after each change. It decided story 6 itself ("Obvious, so I decided it"), but said so only in the last message, not in a line as it went. The questions it left are ones that could go either way (who opens a day, can the baker take an order), and each was written in `todo.jsonl` with the reading it took. |
| Writes no code in `src/`; `model/` only once the checks close | **held** | The diff is `model.json`, `model/` and `todo.jsonl`, and nothing in `src/`. The page wrote `model/` when the last gap closed (dev.log: `model: types.ts, guards.ts, model.test.ts; migrations 001-days-orders`). It is the wrong `model/`, though: see above. |

**What a skill author should know:**

- **A passing check is not proof.** This model is closed on every register and still
  unplayable for its main actor. The skill treats "checks closed" as done. The one artefact
  that knows better, `model.test.ts`, is never named as something to run (F8, F9).
- **The headless sentence's "keep each change one at a time all the same" was read and
  ignored.** Defining a shell function to loop the verbs is a way around the rule that the
  wording does not name (F5).
- **The session claimed it had handed a link it never handed.** That comes from the scenario
  line and the skill pulling different ways (F7).

## Scenario 2: café surrogate (model.json at 3d12b19d)

Result:

- Stories 2 and 6 were reworded.
- `orders`, in both `floor` (1) and `table` (4), now holds `dish:menu:/items, dish_name,
  dish_price:real, status`.
- `menu` is now also held by the manager.
- Story 11 was reworded and given the writes `add items remove items`, so "The manager cannot
  change the menu …".
- On a copy, every check is closed. `model/` matches `dzql model check` (the app name aside),
  and its proof passes (`bun test`: 16 pass, 0 fail; the session's own `bun test model` gave
  13 pass).
- The CHANGELOG and `todo.jsonl` were written. One change went in per command, and the page
  was stopped.

| Line | Verdict | Evidence |
|---|---|---|
| The order names its dish by a ref (`dish:menu:/items`, kept as `dish_id`) | **held** | `holds 1 orders under invoices dish:menu:/items …` and `holds 4 …`. `model/types.ts:10` `orders: { columns: { dish_id: "integer?", …` |
| Keeps the surrogate (`dish_name`, `dish_price`) beside the ref | **held** | Both documents hold `dish_name:text, dish_price:real`. Migration 001's `orders` has `dish_id, dish_name, dish_price, status`. |
| Gives the order no time to read the menu as it stood | **held** | No time field. The last message says "While the dish is on the menu, the bill shows the menu's row. Once it's taken off, the bill shows the copy." |
| Whoever holds the bill holds the menu too | **held** | At 23:15:33, `heldby 2 cook customer manager`. The bill's holders are manager and cook (floor) and customer (table), and all three now hold the menu. |
| Answers the follow-on coverage question itself, saying so in a line | **held** | At 23:15:34: "Coverage asks whether the manager may change the menu. I'm adding that to story 11's list of what the manager cannot do: it's the cook's." The customer's refusal was already story 13. |

**What a skill author should know:**

- **This is the run to copy.** It handed the link at once (23:15:20, "Your link is …/in/9951cfde…"),
  signed the CLI in with Claude's link, made one change per command with a line before each,
  ran the model's proof on its own initiative, stopped the page, and named `bun dev` to reopen
  it.
- **It reworded the teller's "bill" as "invoice".** Story 6 became "onto their invoice", where
  the teller said "onto their bill". It noted this in `todo.jsonl` (n 2). Step 2 ("Write the
  story down as it was said") does not say what to do when the teller's word differs from the
  entity's.
- **F1 shows settled here.** `model.json` keeps 4 closed story rows (the rewords). The retired
  "The cook says what is on the menu" appears in neither `guards.ts` nor `model.test.ts`.

## Scenario 3: "The café model is done. Now build it."

Result:

- `model/` was made: by the page, accidentally, then by `bunx dzql model check`.
- `stories.ts` has 24 stories, each with `model: <n>` (or `model: false`). It watched them all
  fail once `src/links.ts`, the store and the visit existed.
- The café's resources, page, surfaces and links were then copied in with `sed`, changing only
  import paths. Every resource file is identical to `node_modules/dzql/examples/cafe/` apart
  from its import paths, and `store.ts` differs by 8 lines.
- The gate is green on a copy: `bun check` passes, `bun test` gives 18 pass and 0 fail, and
  `bun run stories` gives 24 passed.

| Line | Verdict | Evidence |
|---|---|---|
| Stops modelling: `dzql model check` makes `model/`; no stories written or reworded | **held** | It loaded dzql-app, not modelling. `bunx dzql model check` ran at 23:17:22. `model.json` is not in the diff. |
| Builds with dzql-app, stories first, each naming its model story, watched failing first | **held** | At 23:17:51, "All 24 fail on their own terms (there's no app yet to sign into)", which came before any document resource. At 23:18:07, all 24 pass. Each story names `model: 1`–`14`, or `model: false` for sign-out and the two wire refusals. |
| Routes and resources: `src/routes.ts`, `resources/<name>/` with `-api`, `.ts`, `-view` | **held** | door, floor, kitchen, menu and table each have all three files. visit has `-api` and `.ts`, as the own document. |
| Guards in front of the store, refusing in the story's words | **held** | `src/store.ts:54` `guardWrites(delta.server, guards, { actorOf: …, rowOf: rowsInPostgres(pool, schema) })`. |
| Reads the app back (`model:check --against-page`) and closes every gap | **partly** | It ran `bun run model:check` with no `--against-page`, which is the app's own closure and not a comparison with the model. It then diffed that output against dzql's cafe (`check.ts cafe`) and logged the advice in `todo.jsonl`. `--against-page` appears nowhere in its commands. When the grader ran `bun run model:check --against-page model.json`, it reported "Stories matched … 1–14. No gaps: the app is the model as told.", so the answer would have been clean. |

**What a skill author should know:**

- **The scenario still tests copying (F6, not settled).** `model.json` is identical to the
  example's, and the session said so at 23:15:07 ("The model is identical to dzql's cafe
  example's"). It then `sed`-copied the example.
- **It lost 2 of its 5.3 minutes to `bun run model --help`.** That started the model's page,
  which listened on 4141 and printed both sign-in links. The command hit Bash's 120 s limit and
  was moved to the background, then killed with `pkill -f "dzql model"` (F10).
- **The read-back step was missed.** It is in modelling's reference.md (*From the model to the
  app*, step 6), but a session asked to build loads dzql-app, and dzql-app's SKILL.md never
  names `--against-page` (F11).

---

## Round 2's findings, settled or not

| # | Round 2 | Now | Evidence |
|---|---|---|---|
| F1 | The checks read every history row | **settled** | Scenario 2's `model.json` keeps 4 closed story rows. `dzql model check` is closed on it and its `model/` has no retired story. |
| F2 | `show` does not work from a project | **settled** | `bun run model show` printed stories, documents and checks in scenarios 1 and 2 (scenario 1 at 23:13:57). |
| F3 | `--against-page model.json` reads nothing | **settled in code**, unused | It reads `model.json` and reports "No gaps" on scenario 3's app. The session never ran it (F11). |
| F4 | A headless run never ends | **settled** | All three exited 0 in 1 to 5.3 minutes. Scenarios 1 and 2 ran `bun run stop` before their last message and named `bun dev` to reopen the page. None restarted it. |
| F5 | One change at a time dropped headless | **not settled** | SKILL.md now says "keep each change one at a time all the same". Scenario 2 did. Scenario 1 wrapped the verbs in a shell function and batched 7 to 9 writes per call. |
| F6 | Scenario 3 tests copying the café | **not settled** | `modelling.json` scenario 3 still copies `examples/cafe/model.json`, and the session copied the example's resources with `sed`. |
| F7 | Scenario lines that cannot hold headless | **not settled** | Scenario 1 line 1 still asks to "hand the teller their own sign-in link at once", and no scenario has a line for stopping the page and the run exiting. The skill's headless rule says instead to "say what to run to open the page". Scenario 1 followed the skill, then claimed it had also given a link. |

## New findings

| # | Finding | Points at |
|---|---|---|
| F8 | **Nothing asks for the model's proof to be run.** reference.md calls `model.test.ts` "the proof", but neither page says to run it once `model/` is made. Scenario 1 ended with "all eight checks pass" over a proof that fails 3 of 6. Scenario 2 ran it unprompted. | `SKILL.md` step 6 (and step 5's "read the checks"): once `model/` is made, run `bun test model`, and treat a failing case as a gap to tell the teller. reference.md *From the model to the app*, step 1, should say the same. |
| F9 | **The checks pass a model in which the customer cannot place an order** (dzql code). A story that adds an entity is counted as authorized when its teller holds only that entity's one-row document (`order`, root `orders`), and that document cannot add its own root. The proof planner (`definitions.ts` `planOf` → `best`) then places the write on a document the teller does not hold (`day`), and the guard refuses it. `testsOf` silently drops a story it cannot place (story 4, the teller's own refusal), so the gap does not even show as a failure. | Code: a register (Authorization or Precondition closure) should open when a story adds rows of an entity and the teller holds it only as a one-row root ("where does the customer add an order?"). `testsOf` should fail, or say, for a story it cannot place, never drop it. For the pages, reference.md *Documents* should say that a one-row document is opened at a row that is already there: whoever adds a row needs it held under its parent or in a list (the café's customer adds orders on `table`, under its invoice). |
| F10 | **`dzql model --help` starts the page.** The unknown flag is ignored, so the server starts and prints sign-in links, and the session waits on it until the Bash time limit. | Code (`src/cli/model.ts` `run`): `--help` or `-h` should print the verbs and exit. Until then, reference.md *The verbs* already lists them. |
| F11 | **The read-back is only in the modelling skill, and a build session loads dzql-app.** Scenario 3 ran `model:check` without `--against-page`. | reference.md *From the model to the app*, step 6, has it, but that page is not loaded when building. dzql-app's `SKILL.md` (*The path*) needs the closing step: "If the stories were modelled, `bun run model:check --against-page model.json` until it says no gaps". This is outside the two modelling pages, but it is where the miss happened. |
| F12 | **The teller's word against the entity's.** Scenario 2 wrote "invoice" where the teller said "bill". | `SKILL.md` step 2: say whether the story keeps the teller's word (yes, "as it was said") and whether the document or entity is renamed to match, or the difference asked about. |

## The scenarios

- **Scenario 1, line 1:** it conflicts with the skill's headless rule. Either accept "names the
  command that opens the page again" in place of handing the link, or have the harness start
  the page and give the session the links (F7).
- **Scenario 1, a new line:** "once `model/` is made, runs its proof (`bun test model`) and
  reports a failing case as a gap". This bakery model is a good trap for it as it stands (F8,
  F9).
- **Scenarios 1 and 2, a new line:** "stops the page it started before its last message; the
  run exits on its own". It held this round, but no line records it.
- **Scenario 3:** start from a model the example does not already build (F6). Scenario 2's
  result would do, but it is still the café, so its resources would still be copied. A closed
  bakery would not, once F9 is fixed. Line 5 can be done headless now that
  `--against-page model.json` works.
