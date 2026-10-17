# paintbrush: what it carried from simple and easy, and what it dropped

*24 September 2026. Input to the next step. Written from the trees as they stand: paintbrush at
`a76c186` (7 Apr), simple at `03550fd` (5 Apr, local `archive/simple-2026`), easy at `c5dc39e`
(24 May), delta at `e494a7e` (today), create-blueshed in invoket at `3cb1b1f` (13 Jun), railroad at
`5d4b71b` (0.11.0) plus [PR #2](https://github.com/blueshed/railroad/pull/2). Facts are marked as
facts; the rest is a reading, offered for Peter to say "is this true?". Where the code was read
but not run, it says so.*

## In one paragraph

**paintbrush** (27 Feb – 7 Apr) is simple with the database taken out, written in easy's
vocabulary. simple's rule was *postgres owns everything, the server routes, the client merges*.
paintbrush kept the last two and replaced the first with one JSON file per document. The
server is written in easy's two nouns, **docs** (`registerDoc`) and **methods**
(`registerMethod`), and the client opens a document and merges ops into a signal. Making it that
small is what let the sync layer be extracted: it went into railroad 0.6 as `delta-client` and
`delta-server`, and then out again as `@blueshed/delta`, whose README credits "paintbrush's
delta-sync". Two things were lost in the reduction: **who may write**, and **the model**. What is
left that exists nowhere else is the app half: the resource folders, the design system, the
scaffolding skill and the deploy.

## The history (facts, from `git log`)

| When | What happened |
|---|---|
| 27–28 Feb | Initial commit, then SQLite, provide/inject, checklists, admin backup/restore, `@Auth` decorator, sessions, tokens, TOTP, reconnecting WebSocket. A framework. |
| 1–3 Mar | Restructured as a `bun create` template with `demo/` and `zero/` starters, then `alt/`: "rewrite zero without decorators or lib dependencies". Railway deploy, shared `Message` type. |
| 22 Mar | "adopt railroad". |
| 25 Mar | "clean up: remove framework, simplify resources, add responsive UI". |
| 27–28 Mar | "delta doc", then "delta-ws: routes and resources over one WebSocket", then the hub split out as shared infrastructure (`createWs`, `publishToSelf`, `clientId`, a server-side doc handle, `dataVersion`, `ready`). |
| 6 Apr | "use @blueshed/railroad 0.6.0 delta-doc, remove local lib/": the sync layer leaves paintbrush. |
| 7 Apr | `DESIGN.md`, the about modal, v0.2.4. Last commit. |

Around it: simple's last commit is 5 Apr, and easy moved onto `@blueshed/delta` on 24 May.
`create-blueshed` (invoket, 13 Jun) is the next scaffold of the same shape (see below). paintbrush
sits in `blueshed/archive/` locally, but on GitHub it is **public and not archived**, and its
README still says `bun create blueshed/paintbrush`.

## What it carried

| simple / easy | paintbrush | |
|---|---|---|
| Postgres owns everything | a JSON file per document owns it | fact |
| The server routes (a relay: tokens, `pg_notify` fan-out) | explicit `Bun.serve` routes and one WebSocket | fact |
| The client merges (`openDoc`, deltas into a signal) | the same: `openDoc`, JSON-Patch ops into `doc.data` | fact |
| easy's *entity* | `resources/{name}/{name}-api.ts`, a type shared by server and client | fact |
| easy's *document* | `registerDoc` | fact |
| easy's *method* | `registerMethod` | fact |
| No optimistic writes: the echo renders the write | `send()` waits for the broadcast (`publishToSelf`) | fact |
| easy's stories, relations, *publishes*, permissions, checklists | nothing | fact |

`server.ts` is divided into `// --- Docs (persisted, synced) ---` and
`// --- Methods (stateless RPC) ---`.

## What it dropped

### 1. Who may write

**Facts.** In simple, a write is a Postgres function called with the server-injected `user_id`
as its first argument. It checks permission, mutates, and notifies. Clients never write raw. In
paintbrush, `registerDoc` installs a `delta` action handler that applies whatever ops arrive and
broadcasts them, with no check (`delta-server.ts`, railroad 0.6.1). The message view sends
`replace /message` itself.

The primitive that would have kept the rule was already there: `registerDoc` returns a handle
with `applyAndBroadcast`, and `server.ts` discards it. A method that owns the write is easy's
"method publishes to document", in code:

```ts
const message = await registerDoc<Message>(ws, "message", { file, empty });
registerMethod(ws, "message.save", ({ text }) =>
  message.applyAndBroadcast([{ op: "replace", path: "/message", value: text }]));
```

That would only be a convention, though, because the 0.6 layer can't turn off raw client writes.
The gap is still open today:

- delta's JSON-file backend still takes only `{ file, empty }` (`src/server/server.ts`, `DocOptions`).
- create-blueshed's template has the client `send` raw `add` ops.

The SQLite and Postgres tiers have `validateOps` and row-level security. The bottom rung has
nothing.

**Reading.** eta-on-delta (today) splits permission into two questions. delta answers "is this
valid data, and may this identity touch these rows". eta answers "may this person, on this page,
make this write". It also says "delta's own WebSocket stays for apps that are delta and railroad
alone". In such an app **nobody answers the second question**, and on the JSON-file tier nobody
answers the first either. That is paintbrush's gap in today's words. The textarea overwriting
unsaved typing (below) is a symptom of the same thing: the client is acting as the author.

### 2. The model

**Facts.** simple has a loop: `/model-app` builds the model with easy, `bun model export > spec.md`
exports it, and `/implement` builds from the spec. paintbrush's `/add-resource` asks for three
things: a name, the fields, and whether it is a singleton or a collection. That is easy with one
entity and no relations, methods, permissions or checklists.

hjeli (May–Jun) has since rebuilt easy's modelling line for delta, and a passing hjeli model
exports to delta (`types.ts` and `init_db/`), Supabase and epsilon. create-blueshed wires in
hjeli's MCP server when the binary is on the PATH.

### 3. Documents became resources

**Reading.** simple said *documents are screens*: one document per screen, a root entity plus an
expansion tree. hjeli sharpened that to *"a document is not a view of an entity; it is what an
actor sees in order to do a job"*, and named the thing to resist: the pull down to entity
altitude, meaning tables and CRUD mirrors.

paintbrush's unit is the **resource**: one type, one document, one view. That is entity altitude.
The route `/` composes two resources (`MessageView` and `StatusView`) rather than opening one
document for the screen.

This is also why paintbrush could be so small. A JSON document is its own truth, not a lens over
tables, so simple's hard question (which documents does a write target?) never comes up. The same
simplification that made the extraction possible took paintbrush off the document-as-screen line.

## What only paintbrush has

delta took the server half. create-blueshed (13 Jun) is the same shape on current packages:
a delta JSON-file doc, a railroad client, one shared doc across windows, plus invoket tasks, project
memory, agent hooks and hjeli's MCP. Its `server.ts` is essentially paintbrush's.

Nothing else has paintbrush's **app half**:

- **The resource convention**: `resources/{name}/` with a shared type and a view. It's a convention
  for where things live, even if (above) it sits at the wrong altitude.
- **A design system for agents**: `.claude/DESIGN.md`, 184 lines of concrete tokens and roles,
  with `/sample`, a living style guide (`resources/sample.html`, 256 lines), and `styles.css`
  providing the `.sidebar` for desktop and `.dock` for touch, switched by `pointer` media queries.
- **A scaffolding skill**: `/add-resource`, with `reference/patterns.md` and
  `reference/views.md`.
- **A deploy**: a Dockerfile, `DATA_PATH` for a mounted volume, and a `status` method that reports
  whether storage is persistent.

## Where its pieces went

| Piece | Now lives in | State |
|---|---|---|
| Sync layer (`createWs`, `registerDoc`, `openDoc`) | `@blueshed/delta` (`/server`, `/client`) | public, npm, active |
| Signals, JSX, router, DI, logger | `@blueshed/railroad` | 0.11.0 plus PR #2 |
| Scaffold shape (JSON-file doc, railroad UI, one shared doc) | `create-blueshed` in invoket | on delta ^0.5, railroad ^0.10 |
| Modelling | easy, then hjeli | hjeli exports to delta |
| Resource convention, design system, `/add-resource`, deploy | paintbrush only | stale |

## Its documents, in eta-on-delta's kinds (reading)

- `message` is **written**: persistent, written from the wire. That is why it needs a writer
  rule (above).
- `status` is served as a method but is really a mix of two kinds. `uptime` is **live** (true only
  in this process), while `bun` and `persistent` are **static** (true until the next deploy). It is
  refreshed by clicking. It also returns the server's absolute data path to any client.

## State of the code (facts, unless marked)

- **Dependencies.** `@blueshed/railroad ^0.6.1` keeps a fresh scaffold on 0.6.x. It imports
  `@blueshed/railroad/delta-client` and `/delta-server`, which railroad removed in 0.7.
  `bunx tsc --noEmit` is clean against the installed 0.6.1.
- **README drift.** The README describes a `lib/` folder (removed on 6 Apr), a `{name}.ts` client
  store and a `text()` helper, none of which exist. It says "REST is the write path, WebSocket is
  notification-only", but writes now go over the WebSocket. It calls railroad "~400-line".
  `/add-resource` still points at `lib/delta-doc.ts`, `resources/graph/` and `hub.doc()`.
  `.claude/CLAUDE.md` is the only doc that matches the code.
- **Bugs (from reading, not run):**
  1. `MessageView`'s `effect` runs before the textarea's `ref` is set. On first load the data
     arrives later, so it works. The doc is opened at module level, though, so when you return to
     `/` the data is already loaded, the effect's one run sees no textarea, and the box stays empty.
  2. The same effect copies `ta.value` in on every change, so another client's save overwrites
     unsaved typing.
  3. `toast("Saved")` fires without waiting for `send()`, so a failed write still says "Saved".
  4. `call("status")` has no error handling, so if it fails the view renders nothing.
- **Open to the world.** On a public deploy anyone can edit the message, and `status` reports the
  server's filesystem path.
- **Smaller.** `@railway/cli` is a devDependency of every scaffolded app. `feather-icons` is a
  runtime dependency used only by `/sample`. `og:image` is a relative URL, which link-preview
  crawlers ignore.

## Options for the next step

**A. Archive with a pointer.** Archive the repo on GitHub, and make the README's first line point
to create-blueshed. This stops `bun create blueshed/paintbrush` handing out railroad 0.6. It costs
nothing, and the app half is lost.

**B. Fold the app half into create-blueshed, then do A.** create-blueshed already has the server
half on current packages. It would gain:

- the design system (`DESIGN.md`, `/sample`, sidebar/dock CSS)
- a scaffolding skill fed from hjeli's model rather than three questions
- the deploy (Dockerfile, `DATA_PATH`)
- methods that own writes, as the pattern the template teaches

This is the reading's preference: one scaffold, the one the packages already recommend.

**C. Refresh paintbrush as rung one of the ladder.** Keep it as its own template: railroad 0.11
and `@blueshed/delta`, writes through methods, the four bugs fixed, and the README rewritten from
`.claude/CLAUDE.md`. That gives two scaffolds of the same shape to keep in step.

Whichever is chosen, two changes are worth making to the bottom rung itself (delta's JSON-file
backend), because create-blueshed inherits the same gap:

- a way to refuse raw client writes, so that methods own them
- a validation hook, so the rung that says "start here" isn't the one with no writer rule

## Questions for Peter

1. Is the reading right that paintbrush is simple without the database? Or was it meant as
   something else, for example a teaching template, or the Railway starter?
2. Is create-blueshed paintbrush's successor, or a sibling with a different job (agent wiring
   first, app shape second)?
3. On the bottom rung, should writes go through methods, even in a JSON-file app? That is simple's
   rule. eta-on-delta gives eta the question for eta apps, but delta-and-railroad apps have no eta.
4. Should the scaffolding skill start from hjeli (document altitude, stories first), or stay a
   three-question prompt for apps too small to model?
5. Does the design system (`DESIGN.md`, `/sample`) belong to the scaffold, or to railroad as a
   shipped skill, next to `railroad` and `bun-route`?

## Afterwards (3 October 2026)

*Added later, so this note stays true when written. Peter said what paintbrush is for, which
answers question 1: neither "simple without the database" nor a cut-down create-blueshed. It is
a `bun create` hello world, and first of all it shows the clean simplicity of Bun as a server of
routes and resources, with S3, SQLite and WebSockets built in. It is also the on-ramp to
railroad, delta, eta and shinko.*

What happened between this note and that:

- **2 Oct, the rebuild ([PR #1](https://github.com/blueshed/paintbrush/pull/1)).** This was
  option C, taken further: delta came out of the box altogether. A resource starts as HTTP
  routes and climbs the `evolve` skill's ladder (WebSocket, delta document, eta). The four bugs
  above were fixed, `status` stopped reporting the data path, and the design system, `/sample`
  and `/add-resource` were dropped. create-blueshed 0.3.0 became a wrapper that runs
  `bun create blueshed/paintbrush`, which answers question 2: it is a way in, not a successor.
- **3 Oct, Bun first.** A review against Peter's statement found that the code showed Bun's
  routes and files, but not its WebSocket, SQLite or S3, and that the README led with railroad
  and Railway. The changes:
  - The README and `CLAUDE.md` now open with Bun.
  - `message` pushes each save over `/ws` with Bun's pub/sub, in the box and tested.
  - SQLite and S3 are documented as resources with tests, but are not in the box. Peter's
    choice: document them only.
  - Rewriting the evolve skill's step 3 for the new app found a real bug: its view stopped
    following other windows after its own save. It was fixed.
  - blueshed.co.uk's front page gained a "Where to start" section.
  - Then, at Peter's direction, `CLAUDE.md` went down to the facts and rules every session
    needs (44 lines). Adding or changing a resource moved to the `evolve` skill, whose
    `references.md` is read only when needed and has a table of contents. The build went too:
    a hello world runs from source, and a build is an optional section of those references.

Questions 3 to 5 (methods owning writes on the bottom rung, a skill fed by hjeli, where the
design system lives) stay open. Shinko is not yet on the evolve ladder, but Peter
corrected my reading of it: it is not a different shape. It is just another resource, a realtime
shared tree, and it should evolve into one, perhaps as a flavour of delta. It is work in
progress, so the skill only names it, and paintbrush's ledger (n10) holds the direction.
