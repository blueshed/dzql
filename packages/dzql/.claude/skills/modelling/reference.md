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

The CLI keeps its session in `.eta-session`. A refused write prints `refused: <why>` and exits 1:
it is the model saying no. Everyone signs in as `<name, lower case>@modeling.example`; `.env`'s
`MODEL_PEOPLE` says who.

## The verbs

`examples/modeling/cli.ts` (in a project, under `node_modules/dzql/`). Stories and documents are
numbered as made; the page shows each story's number.

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

## Loading an app that exists

An app already built can be read in rather than told: `bun run model:load <example | path>` (in a
project, `bun run model:load`, which reads `./src`) reads its code, runs its stories
(`loader/extract.ts`), and writes each story and each document they need into the model, as the
CLI's person: each lands in front of whoever watches, and each undoes. A document no story needs
is left out, and said. `bun run model:check <example>` prints the same app's documents (who holds
each, who is told, what permit lets through that no page offers) and hjeli's predicates.

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
