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

| | In a project (`bun create dzql`) | In dzql itself (`packages/dzql`) |
|---|---|---|
| The page | `bun run model`, port 3001 | `bun run dev:modeling`, port 3005 |
| A verb | `bun run cli:model <verb>` | `ETA_EXAMPLE=modeling ETA_URL=ws://localhost:3005 bun run cli <verb>` |
| Sign in | `login claude@modeling.example claude-password` (or `.env`'s `MODEL_PASSWORD`) | `login claude@modeling.example claude-password` |

The CLI keeps the session it is given in `.eta-session`. A refused write prints `refused: <why>`
and exits 1: read it, it is the model saying no. Everyone signs in as `<name, in lower
case>@modeling.example`; `.env`'s `MODEL_PEOPLE` says who.

## The verbs

`examples/modeling/cli.ts` (in a project, `node_modules/dzql/examples/modeling/cli.ts`). Stories and documents are numbered as they are
made; the page shows each story's number.

| Said | Verb |
|---|---|
| A story | `story <actor> <does\|cannot> <words>`; `--post /login` among the words for one that posts a form before anyone holds a document |
| A correction | `reword <n> <words>` |
| What its write changes | `touches <n> <entity>...` |
| A story taken back | `unsay <n>` |
| A document | `document <name> <root> <story>...`: at least one story it serves |
| What it holds | `holds <doc> <entity> [under <parent>] <field[:type]>...` |
| Who holds it | `heldby <doc> <actor>...`; `own <doc>` for one each person has alone (a session) |
| Which stories it serves | `serves <doc> <story>...` |
| Renamed, taken out | `rename <doc> <name>`, `drop <doc>`, `unhold <doc> <entity>` (never its root) |
| A slip | `undo`, `redo` |
| The model, read back | `show`: each story, numbered, who and does or cannot; each document, numbered, whose, what it serves, and what it holds under its root |

Words with an apostrophe go in double quotes (`story ann does "Ann scans the table's QR code"`):
single quotes break on it, and a quote left open runs the commands after it into one story. Or pipe
them in: `-` for the words reads them from stdin (`echo "..." | bun run cli:model story ann does -`,
`reword <n> -` too). A story is one line; the model refuses words that run onto a second.

## Documents

A document is what a person needs in front of them to act, and whoever else must see a change to
it holds it too: a team's calendar, a room, my week. Its root is the row it is about; it holds
entities under that root (`under`), each with the fields a story needs -- a field no story reads
is a field nobody needs yet. Each person's own document (who you are, where you are) is `own`.
Every holder is told every write to it, so cut documents by who must be told, not by table.

## The gaps

| On the page | What it asks |
|---|---|
| *no document* on a story | Nothing serves it yet: what does its person hold? |
| *needed by no story* (red) | A document, or its entities, that no story still told needs: take it out, or is a story missing? |
| *looked up, never held* (dashed) | Touched by a story, held by no document: right for a credential read at sign-in; otherwise, who is told when it changes? |
| A document everyone holds and everyone writes | Every write tells every holder: is that what the stories ask for? |

## Loading an app that exists

An app already built can be read into the model rather than told: `bun run model:load <example |
path>` (in a project, `bun run model:load`, which reads `./src`) reads its code and runs its stories
(`loader/extract.ts`), then writes every story and every document the stories need into the model
on the page, as the person the CLI signed in as -- each write lands in front of whoever watches,
and each undoes. A document no story needs is left out, and said. `bun run model:check <example>`
reads the same app and prints its documents -- who holds each, who is told, what permit lets
through that no page offers -- and hjeli's predicates over its stories.

## From the model to the app

Load the **eta-app** skill; the model says what to build, story by story:

| In the model | In the app |
|---|---|
| A story | A story in `src/modelling/stories.ts`, in the wire's words: its actor is the cast member `as`, `does` or `cannot` the write, `seen` the holders of the documents it is born into, `model` the model story's number |
| A document | A `defineDoc` in `src/delta.ts`: its root, and what it holds as its includes |
| An entity, its fields, its parent | A table in `defineSchema`, its columns, its `parent` |
| `own` | A `perSession` resource |
| Who holds it | Who its resource lets see it |
| What each story does or cannot | Its resource's `permit` and `shape` |

Then `bun run stories`: the least that makes the next story pass, then the next.

Last, read it back: is the app the model as told? `bun run model:check --against-page`
(eta: `model:check <example> --against-page`) reads the model page as the CLI is signed in to it (`.eta-session`; `ETA_URL`), and
the app as `model:load` would write it, and names each gap as a question for the teller: a story told
that the app does not tell, one it tells that was never told, one whose teller or does/cannot
differs, and a document whose root, holders, holdings (what each hangs under, its fields) or
own-ness differ, or that serves other stories. Give each app story the number of the model story it
tells: `story("Ann cannot order onto a paid bill", { model: 10, as: "ann", cannot: ... })`. A story
that names one matches it whatever its words, and only does/cannot is compared (the model's teller
is a role, "a customer"; the app's a cast member, "ann"). One that names none matches by its words,
so a story reworded on one side shows as two gaps. The report says which matched which way.
`--against-page <file.json>` reads the page's document saved instead.
