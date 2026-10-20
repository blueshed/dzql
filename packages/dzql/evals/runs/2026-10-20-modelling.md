# modelling: 20 October 2026, round 2

Run by `bun scripts/evals.ts` on blueshed/dzql at 82372f05: each scenario a fresh `claude -p`
(Claude Code 2.1.303, its default model) in a project made from the checkout (`--local`), given its
query word for word, with nobody stepping in. Graded by a separate session from each run's diff
and files, `bun check` and `bun test` run again; a session's last message taken only as its claim.
Round 1, the same morning, ran on a faulty harness (a stale skill, the dzql projects' skills empty,
fixtures missing) and is compared only where it still says something. What this run found is
fixed in 8d167184 and ce7e0dc2, and the scenarios changed with it: the next run is measured
against these lines where they still stand.

---

Scenarios: `packages/dzql/evals/modelling.json` (3). Evidence comes from `git diff start HEAD` in each
run, the resulting files, and the session transcripts
(`~/.claude/projects/-Users-peterb-Workshop-evals-2026-10-20-r2-dzql-modelling-<n>/*.jsonl`).
Checks were re-run only on copies in a scratch folder. Nothing in the runs was changed, and no
server was started.

| Scenario | Score | Minutes | Exit |
|---|---|---|---|
| 1, bakery, told from scratch | **6.5 / 7** | 45 (the work itself took 2) | 143, killed |
| 2, café surrogate, from 3d12b19d | **5 / 5** | 45 (the work itself took 2.7) | 143, killed |
| 3, café "now build it" | **5 / 5** | 4.1 | 0 |
| **Total** | **16.5 / 17** | | |

## Why 1 and 2 were killed (exit 143)

The modelling work in both runs was finished in under three minutes. Neither process exited,
because the model's page was still running as a background task.

| Time (UTC) | Scenario 1 | Scenario 2 |
|---|---|---|
| Session starts | 18:13:17 | 18:15:21 |
| Page started with Bash `run_in_background` | 18:13:33 `bun dev` | 18:15:46 `bun run model` (port 3001: 3000 was scenario 1's server) |
| Final message written | 18:15:18 | 18:18:02 |
| The page is killed at Claude Code's background-task time limit, and the kill arrives as a new turn (`<task-notification> … status killed`) | 18:23:33 | 18:25:46 |
| Session restarts the page with `timeout: 7200000` (2 h), signs in again, writes a new link | 18:23:37 | 18:25:50 |
| Runner's 45-minute kill | 18:58 | 19:00 |

`claude -p` does not exit while a background task it started is still running. That gave two
waits:

- **The first wait (~10 min, up to the background limit) is the skill's.** Step 1 tells every
  session to start a server that never exits (`dzql model` or `bun dev`), and nothing in the skill
  says to stop it. "With nobody there to answer, never stop to wait" is about questions; it says
  nothing about the page. A session that followed the skill perfectly would still have sat there
  until the background limit.
- **The second wait (to 45 min) is the session's.** Its work was done, nobody was there, and it
  restarted the server with a two-hour limit "so you can still read the stories there". That is
  waiting for a teller who will never come, which is the thing the skill's headless sentence
  forbids. But the skill never names a server as a way of waiting, and both sessions made the
  same choice, so the wording invited it.

**Verdict:** mostly the skill's fault (and the scenario's: see below), with a smaller share for
the session. **What SKILL.md should say**, in the "With nobody there to answer" paragraph and at
step 1:

> With nobody there (a headless run), the verbs still need the page, so start it in the
> background. Once the last change is in and its checks are read, stop it (`bun run stop`, which
> is delta's `stop` via `.server.pid`, or stop the background task) before the last message. Name
> the command that starts it again (`bun dev`), not a sign-in link, because the link dies with
> the server. If the page stops, do not restart it.

reference.md's *Where it runs* table should add a "Stop" row: `bun run stop` / Ctrl-C.

**What the scenarios should say:** scenario 1's line 1 ("hands the teller their own sign-in link
at once") can be printed in a headless run, but nobody can use it, and the link stops working
when the page stops. Scenario 2's query ("On our café's model page") needs the page just the
same. Each scenario that uses the page should add a line: *"Stops the page it started before its
last message, and the run exits on its own."* Otherwise the eval cannot tell a finished run from
a hung one. An alternative is for the harness to start the page itself, give the session the
Claude link, and stop the page when the session ends.

One side effect to know about: scenario 1's leaked server held port 3000 while scenario 2 ran.
Scenario 2 handled it well (it checked `lsof` for the owner's cwd and left it alone), but
concurrent runs can collide on ports.

## Scenario 1: bakery pre-orders, told from scratch

Query: take the stories down on the model's page and say what is missing; build nothing. Result:
only `model.json` changed (6 stories, 3 documents). The checks are open (2 precondition gaps and
2 coverage gaps), so no `model/` was made.

| Line | Verdict | Evidence |
|---|---|---|
| Starts the page, hands the teller their link at once, signs the CLI in with its own link | **held** | `bun dev` at 18:13:33. Peter's link (`…/in/9fabc075…`) is the first thing said, at 18:13:42. `bun run model login <Claude's link>` at 18:13:43. |
| Writes each story as told (who, does/cannot), one change at a time, never a wall of commands | **partly** | The stories are in the teller's words with the right actor and kind. But the changes went in shell-function batches: ledger v5 to v12 (8 writes) landed within 0.3 s, and v13 to v23 (11 writes) within 0.25 s. |
| The refusal is a cannot story | **held** | Story 3, `customer cannot "Customer cannot order for a day once the baker has closed it"`, `writes add orders`, `requires days.closed=true`. |
| Documents named one word for what a person needs | **held** | `calendar` (a list, held by customer and baker), `day` (the baker's list, with orders under it), `order` (the customer's). |
| The closing state is a field on the row, set by a story | **held** | `days.closed:boolean`. Story 4, "Baker closes a day", `replace days.closed=true`, was added and said so at 18:14:03. |
| Reads the checks, closes one-answer gaps itself and says so, asks only what could go either way | **held** | It closed "customer cannot mark baked" and "customer cannot close a day" itself, in one line at 18:15:03. It asked only "who opens a day?" and "can you take orders yourself?", which are the two gaps the checks leave open (confirmed by re-running on a current-rows copy). It read the checks after each batch, not after each change. |
| Writes no code in src/; `model/` only once the checks close | **held** | The diff is `model.json` only. `model/` was correctly not made while gaps are open. |

**What a skill author should know:**

- The session found a real dzql bug and worked around it without editing dzql: it ran the checks
  on a copy filtered to `valid_to == null` (see F1).
- `bun run model show` failed with a usage message and exit 1 (see F2), so it fell back to
  `inspect` and `check`.
- With nobody watching, it judged "one change at a time" not to apply. The skill does not say
  whether it applies headless (see F5).

## Scenario 2: café surrogate (model.json at 3d12b19d)

Result: stories 2 and 6 reworded to the teller's words. `orders` (in `table`, document 4, and
`floor`, document 1) now holds `dish:menu:/items, dish_name, dish_price:real, status`. The manager
was added to the menu's holders. Story 14 was added: "The manager cannot put dishes on the menu or
take them off: that is the cook's". On a current-rows copy, every check is closed and the
generated `orders` is `dish_id, dish_name, dish_price, status`.

| Line | Verdict | Evidence |
|---|---|---|
| The order names its dish by a ref (`dish:menu:/items`, kept as `dish_id`) | **held** | `holds 4 orders under invoices dish:menu:/items …` (and the same for document 1). The filtered check makes `orders: { dish_id: "integer?", … }`. |
| Keeps the surrogate (`dish_name`, `dish_price`) beside the ref | **held** | Both documents hold `dish_name:text, dish_price:real`. The ref-surrogate advice is gone. |
| Gives the order no time to read the menu as it stood | **held** | No time field was added to `orders`. Its final message explains: the menu's row while the dish stands, the copy once it is gone. |
| Whoever holds the bill holds the menu too | **held** | It closed the `unseen-ref · floor` gap with `heldby 2 cook customer manager`. Bill holders are manager, cook and customer, and all three now hold the menu. |
| Answers the follow-on coverage question itself, saying so in a line | **held** | At 18:17:21: "The obvious answer is no, it's the cook's job". That became story 14, served by the menu. (The customer's refusal was already story 13.) |

**What a skill author should know:**

- The project's `model/` is wrong, through no fault of the session. The page regenerated
  `model/` after the two rewords, because duplicate story rows open no gap. Then the duplicate
  document rows opened `duplicate-name` gaps, and regeneration stopped.
- As a result, `model/guards.ts` and `model.test.ts` carry **both** the retired "The cook says
  what is on the menu" and its reword as live `does` guards, and `orders` is still
  `item, price`. The session saw this, said so, and did not hand-copy its clean run into
  `model/`. That was the right call.
- `results.json`'s "18 pass" is that stale proof.

## Scenario 3: "The café model is done. Now build it."

Result: `dzql model check` made `model/`. Then `stories.ts` (24 stories, each naming `model: <n>`,
plus 4 `model: false`). It watched all 24 fail with only the visit in place (18:17:12). Then the
café's resources were copied in, the gate was run, and the app was read back. `model.json` is
unchanged.

| Line | Verdict | Evidence |
|---|---|---|
| Stops modelling: runs `dzql model check` so `model/` is made; no stories written or reworded | **held** | `bunx dzql model check --out model` at 18:16:11. `model.json` is not in the diff. |
| Builds with dzql-app, stories first, each naming its model story, watched failing first | **held** | `stories.ts` was written at 18:16:49, and "All 24 fail" at 18:17:15, before any document resource existed. 24 of 24 pass at 18:17:40. |
| Routes and resources: `src/routes.ts`, `resources/<name>/` with `-api`, `.ts`, `-view` | **held** | door, floor, kitchen, menu and table have all three. visit has `-api` and `.ts` (the own document, as in the café). |
| Guards in front of the store, refusing in the story's words | **held** | `src/store.ts:52`: `guardWrites(delta.server, guards, { actorOf, rowOf: rowsInPostgres(pool, schema) })`. |
| Reads the app back (`model:check --against-page`) and closes every gap | **held** | With the `tables` object as the saved page: "Stories matched … 1–14. No gaps: the app is the model as told." (re-run by the grader). |

**What a skill author should know:**

- **The scenario is degenerate.** Its model.json is byte-identical to
  `node_modules/dzql/examples/cafe/model.json`, so the session copied the example: resources,
  surfaces, page and tests (`floor-api.ts` is identical apart from one import path). This eval
  measures copying the worked example, not building from a model.
- `--against-page model.json` silently read nothing and reported every story as missing (20 "the
  page has no story" lines). The session had to guess `jq .tables` (see F3).

## Findings

| # | Finding | Points at |
|---|---|---|
| F1 | **dzql bug: the checks read every history row.** `src/cli/model.ts` `modelIn()` (lines 27–35) takes `tables.stories` and `tables.documents` whole, without filtering `valid_to == null`. The model file has kept history since 3d12b19d. Every reword, `holds` or `heldby` therefore leaves a closed row that the checks count. The effects: false `duplicate-name` gaps; `model/` that stops regenerating; and, worse, a reworded or unsaid story kept as a live guard (scenario 2's `model/guards.ts`). Both sessions found this and worked around it. | Code, not the skill. reference.md line 48 ("every table the model makes keeps its history") is right; the reader of the file is wrong. |
| F2 | **`show` does not work from a project.** `bun run model show` and `dzql model show` print the CLI usage and exit 1 (scenarios 1 and 2, first call). `src/cli/model.ts` `run()` sends `show` to `rendering/cli`'s `main`. `page/cli.ts` only handles `show` when `process.argv`'s first word is `show`, which it never is under `dzql model`. | SKILL.md steps 1 and 5 and reference.md's verbs table (*The verbs*, "The model, read back") promise `show`. Fix the code, or the pages until it is fixed. |
| F3 | **`--against-page <file.json>` with `model.json` reads nothing, with no error.** It wants the `tables` object. Headless, with no page to read, the file is the only way in. | reference.md *From the model to the app*, step 6: say which file shape is a saved page (or have `check.ts` accept `model.json`, current rows only, and refuse a file it cannot read). |
| F4 | **A headless run never ends.** The page is a server that never exits, `claude -p` waits on it, and nothing says to stop it. The sessions then restarted it for a teller who was not there. | SKILL.md, the "With nobody there to answer" paragraph and step 1 (wording above). reference.md *Where it runs* needs a Stop row (`bun run stop`). |
| F5 | **"One change at a time, while the teller watches" was dropped headless.** Scenario 1 batched 8 and 11 writes per command. With nobody watching, the rule's reason is gone, but the rule's other half (read the checks after each change) went with it. | SKILL.md step 1's bullet: say whether it holds with nobody there (suggestion: yes, each change its own command, because that keeps the checks read per change). Or relax scenario 1's line 2 for headless runs. |
| F6 | **Scenario 3 tests copying.** Its model is the worked example's, so the example's app fits it exactly. | The scenario, not the skill: start from a model the example does not already build (for example scenario 2's result once F1 is fixed, or the bakery's once closed). |
| F7 | **Scenario lines that cannot hold headless.** Scenario 1 line 1's "hands the teller their own sign-in link" is meaningless once the page stops. Scenarios 1 and 2 have no line for the run ending. | The scenarios: add "stops the page it started; the run exits on its own", and accept "names how to start the page again" in place of a live link. |
