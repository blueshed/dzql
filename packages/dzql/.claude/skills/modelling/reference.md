# modelling reference

The model's page is dzql's modeling app (`src/modelling/page`, shipped in the package). The
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

`src/modelling/page/cli.ts` (in a project, under `node_modules/dzql/`). Stories and documents are
numbered as made, and named by number (`holds 3 ...`, `heldby 3 ...`, never by name); the page shows each number.

| Said | Verb |
|---|---|
| A story | `story <actor> <does\|cannot> <words>`; `--post /login` among the words for one that posts a form before anyone holds a document |
| A correction | `reword <n> <words>`; `teller <n> <actor>` for who tells it, its number kept |
| What its write changes | `touches <n> <entity>...` |
| What it writes, as hjeli had it | `writes <n> add <entity> replace <entity>.<field>=<value> remove <entity>...`; `add <entity>.<field>=<value>` is the value a new row starts with (`add tables.seated=false`); a story's writes are the kinds of change it makes, not a count, so two adds of one entity are one new row starting with both (`add tools.out=false add tools.broken=false`) |
| The state it presupposes | `requires <n> <entity>.<field>=<value>...` |
| A story taken back | `unsay <n>` |
| A document | `document <name> <root> <story>...`: at least one story it serves; entities are plural (`invoices`) |
| What it holds | `holds <doc> <entity> [under <parent>] <field[:type]>...`: the fields it holds, the whole list each time; types `text` (the default), `integer`, `real`, `boolean`, or a ref: `dish:menu:/items`, a path into a list document, the row's id its last step, kept as `dish_id`. A ref names a row and includes nothing: whoever holds the order holds the menu too. Every table the model makes keeps its history, so a ref never dangles: a dish removed is closed, not gone, no new order can name it (the guards read only what is there now), and an order that says when (`ordered_at:timestamptz`) reads the menu as it stood then, its price that day (delta's `open_at`). The checks advise a time on a row that names one and says none |
| Who holds it | `heldby <doc> <actor>...`; `own <doc>` for one each person has alone (a session); `list <doc>` for every row of its root (`menu:`, the whole menu), not one (`menu:1`) |
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
document (who you are, where you are) is `own`. A document of every row of its root, the same
for everyone who holds it (the menu, the floor's tables), is `list`; without it a document is one
row (a table, a bill). Every holder is told every write, so cut documents by who must be told, not
by table.

## The gaps

| On the page | What it asks |
|---|---|
| *no document* on a story | Nothing serves it yet: what does its person hold? |
| *needed by no story* (red) | A document, or its entities, that no story still told needs: take it out, or is a story missing? |
| *looked up, never held* (dashed) | Touched by a story, held by no document: right for a credential read at sign-in; otherwise, who is told when it changes? |
| A document everyone holds and everyone writes | Every write tells every holder: is that what the stories ask for? |

The checks run on the model after every change (`src/modelling/page/closure.ts`), across the top of
the page and at the foot of `show`: hjeli's six, Easy's coverage, and playability from rights'
`derive-ux.ts` (advice beneath it -- one way on, an end, a field no story changes -- never blocks):

| Register | Open when |
|---|---|
| Reachability | an entity no document holds; a document nobody holds that is not each person's own, or that holds no field; a story no document serves; someone holds a ref and not the document it names into |
| Subscription closure | a story writes what reaches no document anyone holds; advice where another person's document holds what a story writes and does not serve it (are they told?) |
| Actor closure | someone holds a document and tells no story |
| Precondition closure | a write changes a row no story adds (an own document's root is made by the visit), or names one by a ref; a story requires a state no write sets, or one none of its writes reaches (its row, a row above it, a row a ref names). Not asked until a story says `writes` or `requires` |
| Referential closure | a story a document serves is not told; an entity hangs under one its document does not hold; a name no table, column or document can take (a document's is one word: `my_table`); two documents of one name; a ref into a document that is not there, does not hold what it names, or is one row and not a list |
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

dzql's `examples/cafe/` (`node_modules/dzql/examples/cafe/`) is this step, worked: a model told,
made, built as routes and resources until every story passes, and read back with no gap. Its
README walks it; here is what each part of it says about the model.

1. **What the model makes: `model/`.** While no check is open, `dzql model` writes into a folder
   of its own (never the app's `src/`, so the app neither reloads nor loses a file): `types.ts`
   (delta's definitions -- each entity a table hanging from its parent, each document a
   `defineDoc` naming the stories it is for, its `columns` where it holds fewer fields than the
   table has -- and a row type and a document shape for each), `guards.ts`, `migrations/` (the
   newest rewritten in place until committed; a step a diff cannot make, a parent changed, written
   once with `// By hand:` lines) and `model.test.ts`, the proof: each story's write made through
   the guards as its teller and seen by everyone it tells, each `cannot` refused in its own words.
   It writes no stories. A file in `model/` a person wrote is kept, the model's beside it
   (`types.model.ts`). Every store takes the same definitions: the JSON file, SQLite, dzql's
   Postgres.
2. **The store: `store.ts`.** Postgres, through dzql's `openStore`: the model's migrations with the
   model's schema (`migrations: { dir, app: "<name>-model", schema }`; the app's schema there would
   make delta warn that the definitions say more than the migrations), then the app's own tables
   beside the model's (`defineSchema({ ...tables, ... })`: who the staff are, what a session keeps),
   which the compiled SQL adds. Then, in `open()`, before the listener, the guards:
   `guardWrites(delta.server, guards, { actorOf, rowOf: rowsInPostgres(pool, schema) })`
   (`rowsIn(db, schema)` on SQLite). `actorOf` is given
   the identity the app's `who` returns (the session's id without one): look the teller up there,
   or have `who` return it, never both. The guards let a write through on the first `does` story
   of its writer whose requirements hold (read from the written row and the rows above it), and
   refuse it in the words of the `cannot` story whose requirements hold (two on one write each say
   their own state); each op is checked on its own, and the server's own
   writes (`serverWrite`) go by. A resource's `permit` then says only what its page sends.
3. **Each person's own: `resources/visit/`.** The `own` document is the app's session: a
   `perSession` resource, its root the session's table, to which the app adds what a session keeps
   (the cookie's hash, who signed in). The guards leave it out. `sessionRows` finds a cookie's
   session through a document it calls `visit:`; where the model already names one `visit`, give it
   another (`sessionRows(delta, "visits", "cookie:")`).
4. **A document, a resource: `resources/<name>/`.** `<name>-api.ts` registers the model's
   definition (`docs.filter((d) => d.prefix === "floor:")`), `<name>.ts` lets its holders see it
   (`resolveDoc`; a `list` resolves `""`), `<name>-view.ts` draws it. *Whose copy* advice -- a
   document a role holds whose root is one of many, not a `list` -- is answered by a story that
   gives it them, or their own document naming it (the visit's `table`).
5. **The stories: `stories.ts`.** In the wire's words, each naming the model story it tells
   (`model: 10`: then it matches whatever its words, and only does or cannot is compared, the
   model's teller being a role and the app's a member of the cast); `model: false` for one that is
   the app's own (signing out). `bun run stories`: the least that makes the next pass. The harness
   asks the guards too (`may`, never written) before it calls a write no story tells a hidden verb.
6. **Read back: is the app the model as told?** `bun run model:check --against-page` (in dzql,
   `model:check <example> --against-page`) reads the model page as the CLI is signed in
   (`.eta-session`, `ETA_URL`; or a saved page, `--against-page <file.json>`) and the app as
   `model:load` would write it, and names each gap as a question for the teller: a story told and
   not built, or built and never told; a does or cannot that differs; a document whose root,
   holders, holdings or own-ness differ, or that serves other stories.

For the page itself, load the **dzql-app** skill.
