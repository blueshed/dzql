# modelling reference

The model's page is dzql's modeling app (`examples/modeling`, shipped in the package). The
model is one delta document: its stories, and the documents they need. `SKILL.md` is the order to
work in.

## Contents

- [Where it runs](#where-it-runs)
- [The verbs](#the-verbs)
- [Documents](#documents)
- [The gaps](#the-gaps)
- [Loading an app that exists](#loading-an-app-that-exists)
- [From the model to the app](#from-the-model-to-the-app)

## Where it runs

| | Wherever dzql is installed | In a project (`bun create dzql`) | In dzql itself (`packages/dzql`) |
|---|---|---|---|
| The page | `bunx dzql model`, port 3001 (`MODEL_PORT`), at `/model`, the model kept in `model.json`, named for the project; beside an app, its `routes.ts` composes `modelRoute()` (`dzql/model`) in development | `bun dev`, at `localhost:3000/model` beside the app (or `bun run model` alone, port 3001) | `bun run dev:modeling`, port 3005 |
| A verb | `bunx dzql model <verb>` | `bun run cli:model <verb>`: it talks to the server whose sign-in link it was given | `ETA_EXAMPLE=modeling ETA_URL=ws://localhost:3005 bun run cli <verb>` |
| Sign in | `login <link>`: `dzql model` and `bun dev` print a sign-in link for each keeper as they start (Peter's for the person, Claude's for the CLI); no email or password. `login claude@modeling.example claude-password` (or `MODEL_PASSWORD`) still works | the same | the same |
| What it makes | after every change, while no check is open, into `model/` (`--out`): `types.ts`, `guards.ts`, `migrations/` and `model.test.ts`; `bunx dzql model check` once, exit 1 while one is open | the same | the same, `bun src/cli/index.ts model check` |

The CLI keeps its session in `.eta-session`. A refused write prints `refused: <why>` and exits 1:
it is the model saying no. Everyone signs in as `<name, lower case>@modeling.example`; `.env`'s
`MODEL_PEOPLE` says who.

## The verbs

`examples/modeling/cli.ts` (in a project, under `node_modules/dzql/`). Stories and documents are
numbered as made, and named by number (`holds 3 ...`, `heldby 3 ...`, never by name); the page shows each number.

| Said | Verb |
|---|---|
| A story | `story <actor> <does\|cannot> <words>`; `--post /login` among the words for one that posts a form before anyone holds a document |
| A correction | `reword <n> <words>`; `teller <n> <actor>` for who tells it, its number kept |
| What its write changes | `touches <n> <entity>...` |
| What it writes, as hjeli had it | `writes <n> add <entity> replace <entity>.<field>=<value> remove <entity>...`; `add <entity>.<field>=<value>` is the value a new row starts with (`add tables.seated=false`) |
| The state it presupposes | `requires <n> <entity>.<field>=<value>...` |
| A story taken back | `unsay <n>` |
| A document | `document <name> <root> <story>...`: at least one story it serves; entities are plural (`invoices`) |
| What it holds | `holds <doc> <entity> [under <parent>] <field[:type]>...`: the fields it holds, the whole list each time; types `text` (the default), `integer`, `real`, `boolean` |
| Who holds it | `heldby <doc> <actor>...`; `own <doc>` for one each person has alone (a session) |
| Which stories it serves | `serves <doc> <story>...` |
| Renamed, taken out | `rename <doc> <name>`, `drop <doc>`, `unhold <doc> <entity>` (never its root); `root <doc> <entity>` for a new root, the old one held under it, its number kept |
| A slip | `undo`, `redo` |
| The checks, once | `bunx dzql model check [--out model] [--drops]`: every check; exit 1, and nothing made, while one is open |
| The model, read back | `show`: each story, numbered, who and does or cannot; each document, numbered, whose, what it serves, and what it holds under its root |

Words with an apostrophe go in double quotes (`story ann does "Ann scans the table's QR code"`):
a single quote left open runs the commands after it into one story. Or `-` reads the words from
stdin (`echo "..." | bun run cli:model story ann does -`; `reword <n> -` too). A story is one line;
the model refuses a second.

## Documents

A document is what a person needs in front of them to act; whoever else must see a change to it
holds it too: a team's calendar, a room, my week. Its root is the row it is about; it holds
entities under that root (`under`), each with only the fields a story reads. Each person's own
document (who you are, where you are) is `own`. Every holder is told every write, so cut
documents by who must be told, not by table.

## The gaps

| On the page | What it asks |
|---|---|
| *no document* on a story | Nothing serves it yet: what does its person hold? |
| *needed by no story* (red) | A document, or its entities, that no story still told needs: take it out, or is a story missing? |
| *looked up, never held* (dashed) | Touched by a story, held by no document: right for a credential read at sign-in; otherwise, who is told when it changes? |
| A document everyone holds and everyone writes | Every write tells every holder: is that what the stories ask for? |

The checks run on the model after every change (`examples/modeling/closure.ts`), across the top of
the page and at the foot of `show`: hjeli's six, Easy's coverage, and playability from rights'
`derive-ux.ts` (advice beneath it -- one way on, an end, a field no story changes -- never blocks):

| Register | Open when |
|---|---|
| Reachability | an entity no document holds; a document nobody holds that is not each person's own, or that holds no field; a story no document serves |
| Subscription closure | a story writes what reaches no document anyone holds; advice where another person's document holds what a story writes and does not serve it (are they told?) |
| Actor closure | someone holds a document and tells no story |
| Precondition closure | a write changes a row no story adds (an own document's root is made by the visit); a story requires a state no write sets. Not asked until a story says `writes` or `requires` |
| Referential closure | a story a document serves is not told; an entity hangs under one its document does not hold; a name no table, column or document can take (a document's is one word: `my_table`); two documents of one name |
| Authorization closure | a teller writes what no document they hold holds: you may write what you may read |
| Coverage | someone holds what a write changes, and no story says whether they may make it (a `cannot` story decides it); a `cannot` that the same teller's `does` already lets through, presupposing nothing, so it is never refused |
| Playability | it is someone's move on a state no document they hold shows; someone waits on a state they cannot see |

## Loading an app that exists

An app already built can be read in rather than told: `bun run model:load <example | path>` (in a
project, `bun run model:load`, which reads `./src`) reads its code, runs its stories
(`loader/extract.ts`), and writes each story and each document they need into the model, as the
CLI's person: each lands in front of whoever watches, and each undoes. A document no story needs
is left out, and said. `bun run model:check <example>` prints the same app's documents (who holds
each, who is told, what permit lets through that no page offers) and hjeli's predicates.

## From the model to the app

While no check is open, `dzql model` writes into a folder of its own (`model/`, never the app's
`src/`, so the app neither reloads nor loses a file of its own): `types.ts`, delta's two definitions (a
`defineSchema` of its entities, each with the fields documents give it, hanging from its parent,
and a `defineDoc` for each document, saying in a comment which stories it is for) with a row type
per table and each document's shape; `guards.ts`, the guarded write layer; `migrations/`, the next
step each time the schema says more (a step a diff cannot make -- a parent changed -- is written
once with `// By hand:` lines to finish); and `model.test.ts`, the proof on SQLite. It writes no
stories: the app's stories are the app's, in its words, each naming its model story (`model: n`).
A file in `model/` a person wrote is kept, and the model's goes beside it (`types.model.ts`).

How the app uses them:
- **The store:** `types.ts` exports `tables`, `docs` and `schema`, made with the JSON file's
  `defineSchema` for the model's own proof. An app on another store takes `tables` and `docs` and
  gives them to its own: `defineSchema({ ...tables, ... })` and `registerDocs` from
  `@blueshed/delta/sqlite` (or dzql's Postgres). The definitions are the same on every store.
- **The tables:** the app keeps what the model does not (who signs in, sessions) beside the
  model's, its own tables under its own name. At start-up it runs the model's migrations with the
  model's schema (`migrate(db, model's, { app: "<name>-model", schema })`, `schema` from
  `types.ts`), then `createTables` and `migrateSchema` with its own, which add what it says
  beyond the model (eta-app's documents.md). Passing the app's schema to the model's migrations
  makes delta warn that the definitions say more than the migrations: they are the model's.
- **Each person's own document:** the model's `own` document is the app's session. Its root is the
  session's table: the app adds the session's own columns to it (`cookie`, who signed in) and keeps
  it as a `perSession` resource under the name the app gives its session. The guards leave it out.
  `sessionRows(delta, table)` finds a cookie's session through a document it calls `visit:`: if the
  own document is itself named `visit`, give the lookup another prefix (`sessionRows(delta, table,
  "cookie:")`, registering `cookie:` scoped by the cookie).
- **The guards:** `guards.ts` stands in front of the store, `guardWrites(delta.server, guards, {
  actorOf, rowOf })` on the app's `delta` before any `registerDocs` (first in `routes.ts`): a write no story says is refused there,
  with the story's words. A resource's `permit` need not say the rules again. `rowsIn(db,
  schema)` (`dzql/modelling/guards`) is the `rowOf` for SQLite, its booleans read as booleans.
  The server's own writes (`serverWrite`) are no person's, and go by.
  `actorOf` is given the identity the app's `Example.who` returns (the session's id when it has
  none): either look the teller up from the session there, or have `who` return the teller and
  `actorOf` take it as it is, never both. A guard's 401 (nobody it knows) and 403 are refused on
  the page with their reason.
  How they decide: the first `does` rule for the writer whose requirements hold lets the write
  through; else a `cannot` for the writer refuses it, in its words. A requirement is read from the
  written row and the rows it hangs under, on each write of the story that reaches it. Each op of a
  write is checked on its own. Narrow each resource's `permit` to what the page sends, and let
  the guards say who: `bun run stories` asks them too (`may`, never written) before it calls a write
  no story tells a hidden verb.
- **Whose copy:** a document a role holds whose root is one of many (a table, a bill) is advice
  in actor closure until the model says how each person comes to hold theirs (a story that gives
  it them, or their own document holding a field that names it, `table`): ask the teller.
Every store takes the definitions: delta's JSON file and SQLite, and dzql's Postgres. In code, `definitionsOf(model)` (`dzql/modelling/definitions`) does the
same. Who owns a document that is each person's own is not in the model: the file says so, to be
given with sign-in.

For a page the server draws, load the **eta-app** skill; the model says what to build, story by story:

| In the model | In the app |
|---|---|
| A story | A story in `src/stories.ts`, in the wire's words: its actor is the cast member `as`, `does` or `cannot` the write, `seen` the holders of the documents it is born into, `model` the model story's number |
| A document | A resource of its own, `src/resources/<name>/`: its `defineDoc` (from `model/types.ts`'s `docs`) registered in `<name>-api.ts`, its root and what it holds as its includes |
| An entity, its fields, its parent | A table in `defineSchema`, its columns, its `parent` |
| `own` | A `perSession` resource |
| Who holds it | Who its resource lets see it |
| What each story does or cannot | Its resource's `permit` and `shape` |

Then `bun run stories`: the least that makes the next story pass, then the next.

Last, read it back: is the app the model as told? `bun run model:check --against-page` (in dzql,
`model:check <example> --against-page`) reads the model page as the CLI is signed in
(`.eta-session`, `ETA_URL`) and the app as `model:load` would write it, and names each gap as a
question for the teller: a story told and not in the app, or in the app and never told; a teller
or does/cannot that differs; a document whose root, holders, holdings or own-ness differ, or that
serves other stories. Give each app story its model story's number
(`story("Ann cannot order onto a paid bill", { model: 10, as: "ann", cannot: ... })`): then it
matches whatever its words, and only does/cannot is compared (the model's teller is a role, the
app's a cast member). One with no number matches by its words, so a reword shows as two gaps.
`--against-page <file.json>` reads a saved page instead.
