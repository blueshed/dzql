# Feedback for DZQL Maintainers (`cafe-d`)

## Findings (Most Important First)

### 1. `Example.who` vs `guardWrites` `actorOf`: passing `roleOf` to both silently causes `401` ("delta applied nothing")
- **What happened**: In `src/delta.ts`, `modelling/reference.md` instructs wiring `guardWrites` with `actorOf: (identity) => (identity ? roleOf(String(identity)) : undefined)`, where `roleOf(sessionId)` queries `SELECT role FROM "sessions" WHERE id = ?`. Meanwhile, `Example` in `dzql/rendering/example.ts` has an optional `who?: (sessionId: string) => unknown` hook that defaults to `ws.data.sessionId`. When an app author sets `who: roleOf` on `Example` AND uses the `actorOf` snippet from `modelling/reference.md`, `server.ts` passes `who(ws)` (`"manager"`) as `identity` to `documents.write`, and `guardWrites` then calls `roleOf("manager")` (`SELECT role FROM "sessions" WHERE id = 'manager'`), which returns `undefined`. `guardWrites` responds with `{ error: { code: 401, message: "Sign in to write to table:" } }`. Because `writeDelta` in `dzql/rendering/server.ts` only converts `403` into a `Refusal` (`if ("error" in written && written.error.code === 403) throw refuse(...)`) and turns any other error code (including `401`) into `return false`, the story harness reports: `nothing landed: manager's write was refused past table's permit and shape: delta applied nothing` — hiding the actual `401` message.
- **Seen or read in code**: **Seen** when running `bun run stories` on the first pass, and verified in `dzql/src/rendering/server.ts` (lines 234, 266–271) and `dzql/src/modelling/guards.ts` (lines 147–151).
- **How to reproduce**:
  1. Wire `guardWrites` in `src/delta.ts` using `actorOf: (identity) => (identity ? roleOf(String(identity)) : undefined)` as shown in `.claude/skills/modelling/reference.md`.
  2. Set `who: roleOf` on the `Example` export in `src/index.ts`.
  3. Run `bun run stories`. Every `does` story fails with `refused past <table>'s permit and shape: delta applied nothing`.
- **Fix to consider**:
  1. In `dzql/src/rendering/server.ts` `writeDelta`, surface `401` errors from delta (or log/report `written.error.message` in `refusedBy` inside `harness.ts`) instead of silently returning `false` and saying "delta applied nothing".
  2. Document clearly in `modelling/reference.md` and `eta-app/reference.md` that `Example.who` should be omitted when `guardWrites` maps `sessionId -> role` via `actorOf` (or conversely, if `Example.who` returns the role, `actorOf` receives the role directly).

---

### 2. `dzql model test` (`model/model.test.ts`) skips `does` stories on list-style root entities unless a dummy `replace <root>.<field>=<val>` is added
- **What happened**: In a cafe, the menu is a shared list of `menu_items` (`root: "menu_items"`) and the floor is a shared list of `tables` (`root: "tables"`). When Story 2 ("The cook says what is on the menu") has `writes: add menu_items`, `bun run cli:model` generates `model/model.test.ts` which tests every document as a **single-mode** document (`open("menu:1")`). In `@blueshed/delta/sqlite`, a single-mode implied document (`menu:1`) cannot execute `add /menu_items/-` on its own root (`menu:1 holds menu_items 1 alone: add another menu_items row through a document that lists them`). To avoid crashing, the generator in `examples/modeling/heart.ts` (`opsOf`) filters out `w.op === "add" && w.entity === doc.root`. Consequently, if a story's only write is `add <root>`, `opsOf` produces `[]`, and `model.test.ts` skips the story (`if (!doc || !ops.length) continue`). Conversely, if you try to introduce a parent root entity `menus` above `menu_items`, Reachability fails with `unwritten-entity · menus: menu holds menus, but no story ever writes one`.
- **Seen or read in code**: **Seen** while modelling Story 1 (`tables`) and Story 2 (`menu_items`) and running `bun test model/model.test.ts`, and verified in `node_modules/dzql/examples/modeling/heart.ts`.
- **How to reproduce**:
  1. Give Story 2 (`The cook says what is on the menu`) only `writes 2 add menu_items` on document `menu (root: menu_items)`.
  2. Run `bun run cli:model` to generate `model/model.test.ts`.
  3. Inspect `model/model.test.ts`: Story 2 is omitted from the `does` test loop because `opsOf` drops `add` on `doc.root` unless a `replace menu_items.<field>=<val>` is also present in `writes`.
- **Fix to consider**:
  - Either allow a document in the model to be marked as a list/catalogue document (opening `<doc>:` in list mode in `model.test.ts` so `add /<root>/-` is tested directly), or have `opsOf` in `heart.ts` synthesize a root `replace` op from the root entity's declared fields when a story's write is `add <root>`.

---

### 3. `hiddenVerbs` in the story harness checks `permit` + `shape` without `guardWrites`, conflicting with `modelling/reference.md`
- **What happened**: `.claude/skills/modelling/reference.md` ("What changes in `src/`") states: *"Narrow each resource's `permit` to what the page sends, and let the guards say who."* However, `hiddenVerbs` in `dzql/src/modelling/harness.ts` (and `permitAllows` in `examples/modeling/loader/documents.ts`) tests whether a cast member can perform another role's write by calling `owner.permit` and `owner.shape` **without** running the write through `delta` / `guardWrites`. If `resource.permit` only checks the shape of the op and leaves role checks to `guardWrites`, `hiddenVerbs` emits warnings that other cast members are permitted to perform writes that `guardWrites` would actually refuse.
- **Seen or read in code**: **Read in code** (`node_modules/dzql/src/modelling/harness.ts` `hiddenVerbs` and `node_modules/dzql/examples/modeling/loader/documents.ts` `permitAllows`), which guided us to check `role` in `resource.permit` as well.
- **How to reproduce**:
  1. In `src/resources/table.ts`, change `permit` so it only checks `op.op` and `op.path` (relying on `guardWrites` in `src/delta.ts` to enforce `actor === "manager"` / `"cook"` / `"customer"`).
  2. Run `bun run stories`.
  3. `hiddenVerbs` warns that other cast members are permitted to perform those ops, even though `guardWrites` refuses them with `403`.
- **Fix to consider**:
  - Either have `hiddenVerbs` test the write through `guardWrites` (or `documents.write` in a rolled-back savepoint) before warning, or update `modelling/reference.md` to state that `resource.permit` should still gate by actor role for silent `false` refusals while `guardWrites` enforces model preconditions and `told` refusals.

---

### 4. Uninterpolated `${server}` template literal in `examples/modeling/cli.ts`
- **What happened**: When `.eta-session` holds a cookie from a previous `bun dev` process (e.g. after restarting `bun dev` with an in-memory database), running `bun run cli:model ...` fails with the literal string:
  `refused: nothing this session can see was written; is it still signed in to ${server}? (login <your link>)`
  because the error string in `examples/modeling/cli.ts` uses regular quotes instead of backticks around `${server}`.
- **Seen or read in code**: **Seen** directly in terminal output when running `bun run cli:model` after restarting `bun dev`.
- **How to reproduce**:
  1. Sign in with `bun run cli:model login <link>`.
  2. Restart `bun dev` (so the in-memory session table is reset).
  3. Run `bun run cli:model show`.
- **Fix to consider**:
  - Change the quoted string in `examples/modeling/cli.ts` to a template literal so `${server}` interpolates the URL.

---

### 5. `boxPage` re-sends closed background `cells` when their summary changes while another cell's window is open
- **What happened**: In `bento.ts`, `boxPage(trail, inPlace, cells, open)` renders `open` as `windowOf(...)` for the open cell, and renders all other `cells` in the background with `inert`. Each background cell is wrapped in `part(c.key, ...)`. If a write inside the open window (for example, the customer paying their invoice in the `invoice` window, which also sets `tables.seated = false`) causes a background `inert` cell's summary text to change (for example, the `tables` cell summary changing from `"At Table 1 (Seated)"` to `"At Table 1 (Waiting)"`), `tellChanges` diffs the page and sends the entire 2.2 KB `inert` `tables` cell part over the WebSocket alongside the open window's parts, pushing the step over the 4,608-byte wire budget (`4,879 bytes on the undo, more than the example's budget of 4,608: the most, tables, 2.2 KB`).
- **Seen or read in code**: **Seen** when running `bun run stories` on Story 9 ("The customer pays their invoice, and the manager sees it paid").
- **How to reproduce**:
  1. In `src/page.ts` `renderCustomer`, include `currentTable.seated ? "Seated" : "Waiting"` in the `tables` cell `summary`.
  2. Run `bun run stories`.
  3. Story 9 fails the 4,608-byte budget on undo (`4,879 bytes`) because the `inert` background `tables` cell (2.2 KB) is re-sent alongside `invoice` and `drawers`.
- **Fix to consider**:
  - When `open` is passed to `boxPage`, background cells are `inert` and hidden behind the open window; `boxPage` could either render lightweight placeholders for non-open cells while windowed or skip rendering their `body` rows while `open` is active.

---

### 6. `model:check --against-page` (`examples/modeling/loader/documents.ts` & `told.ts`) brittle regex and schema checks
- **What happened**:
  1. `documentsIn()` in `examples/modeling/loader/documents.ts` parses `src/delta.ts` with a regex (`/defineDoc\("(\w+):",\s*\{\s*root:\s*"(\w+)",\s*include:\s*\[([^\]]*)\](?:,\s*columns:\s*\{([^}]*)\})?/g`) that only matches inline `defineDoc(...)` calls with properties in that exact order, and does not recognize `docs` imported from `../model/types`.
  2. `told.ts` compares `schema.tables.sessions.columns` against the model's `session` document fields, flagging extra columns (`cookie`, `role`, `page`) as `unheld-field` even though `.claude/skills/modelling/reference.md` explicitly instructs adding `cookie`, `role`, and `page` to `sessions` in `src/delta.ts`.
- **Seen or read in code**: **Read in code** (`node_modules/dzql/examples/modeling/loader/documents.ts` and `told.ts`).
- **How to reproduce**:
  1. Follow `.claude/skills/modelling/reference.md` to extend `tables.sessions` with `cookie`, `role`, `page` in `src/delta.ts`.
  2. Run `bun run model:check --against-page`.
- **Fix to consider**:
  - In `documentsIn()`, inspect the runtime `schema` and registered `DocDef`s (or accept `docs` imported from `../model/types.ts`).
  - In `told.ts`, ignore columns excluded by `defineDoc(..., { columns })` (like `cookie`) and standard session state columns (`page`, `role`, `person_id`) on `own` session documents.

---

### 7. Actor Closure `whose-copy` advice triggers on shared list/catalogue documents
- **What happened**: During modelling, `bun run cli:model check` closed all 8 checks, and under `Actor closure` printed `whose-copy` advice for `menu (customer)` and `table (cook)`, asking whether a customer/cook opens one of many `menu_items`/`tables` without a field saying whose it is. Because the model doesn't distinguish between a single-instance document (`menu:1`) and a list-mode document (`menu:` / `table:`), Actor Closure assumes any document whose root has an `add` story is a per-item document that needs an ownership FK or a session pointer.
- **Seen or read in code**: **Seen** in `bun run cli:model check` output during step 1.
- **How to reproduce**:
  1. Run `bun run cli:model check` on `cafe-d`'s model.
  2. Observe the `whose-copy` advice notes under `Actor closure`.
- **Fix to consider**:
  - If a document represents a shared list/catalogue opened with an empty ID (`menu:`, `table:`), suppress `whose-copy` when a document is marked as a shared list (or when no story requires per-actor scoping).

---

## Decisions Made & Questions for the Teller

### Obvious Decisions Made
1. **Menu items have a name and an integer price** (`menu_items.name`, `menu_items.price:integer`), copied onto ordered invoice `items` (`items.name`, `items.price:integer`, `items.status`) so historical invoices retain the item name and price at the time of ordering.
2. **Table occupancy (`tables.seated:boolean`)**: Opening an invoice on a table marks `tables.seated = true`, and paying that invoice marks `invoices.paid = true` and `tables.seated = false`, freeing the table for the next customer.
3. **Order lifecycle (`items.status`)**: Items progress strictly through `"ordered"` (customer orders) $\rightarrow$ `"ready"` (cook marks ready) $\rightarrow$ `"placed"` (manager takes to table and marks placed).

### Questions for the Teller (Genuine Ambiguities)
1. **Can a customer pay their invoice before all ordered items are `placed` (or `ready`)?**
   - *Reading taken*: Yes — the story says *"The customer pays their invoice, and the manager sees it paid. That frees the table"* with no precondition on item status, so an unpaid invoice can be paid at any point. In some cafes, payment is only allowed once all items are placed or served; in others, customers can pay up front or at any time.
2. **When a customer scans a table code before the manager seats them, or after a previous customer has paid, can the manager see which table the waiting customer scanned?**
   - *Reading taken*: Scanning writes `sessions.table` on the customer's own session, and the manager seats a table by selecting the table and opening an invoice for it. If the manager needs to see a live indicator on the floor plan of *which* unseated table just had its QR code scanned by a waiting customer, `tables` would also need a waiting/scanned state or shared presence document.
3. **Can the cook see items after they have been marked `placed`, or only while `ordered` / `ready`?**
   - *Reading taken*: The cook holds the `table` document and sees all items with their current status (`ordered`, `ready`, `placed`), with the `"Mark ready"` action offered only while `status === "ordered"`.
4. **Can the cook edit or remove existing menu items, or only add dishes to the menu?**
   - *Reading taken*: We modelled *"The cook says what is on the menu"* as adding dishes (`name`, `price`), which is undoable via the ledger. Does the cook also need to change prices or take dishes off the menu mid-service?

---

## Hints That Would Have Helped Most
1. **List-mode documents (`"table:"` and `"menu:"`) with `resolveDoc: () => ""`**: A one-line note in `eta-app/reference.md` explaining that returning `""` (empty string) from `Resource.resolveDoc` opens `defineDoc("table:", ...)` in `@blueshed/delta/sqlite`'s **list mode** (returning `{ tables: Record<id, row>, invoices: Record<id, row>, items: Record<id, row> }`) while letting the page and stories address the document simply as `"table"`.
2. **`Example.who` vs `guardWrites` `actorOf`**: A note in `modelling/reference.md` clarifying that `server.ts` passes `Example.who ? Example.who(sessionId) : sessionId` as `identity` to `delta`, so if `actorOf` in `src/delta.ts` looks up the role from `sessionId`, `Example.who` should be left undefined.
3. **Single-root `add` stories in `dzql model`**: A note in `modelling/SKILL.md` explaining that because `model/model.test.ts` opens `<doc>:1` in single mode, a story whose only write is `add <root>` needs a companion `replace <root>.<field>=<value>` in `writes` for `model.test.ts` to exercise it.
