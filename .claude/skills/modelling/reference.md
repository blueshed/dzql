# modelling reference

The model's page is eta's modeling app (`examples/modeling` in eta, `model/` in a project). The
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

| | In a project (`bun create blueshed/eta`) | In eta itself |
|---|---|---|
| The page | `bun run model`, port 3001 | `bun run dev:modeling`, port 3005 |
| A verb | `bun run cli:model <verb>` | `ETA_EXAMPLE=modeling ETA_URL=ws://localhost:3005 bun run cli <verb>` |
| Sign in | `login claude@modeling.example <MODEL_PASSWORD from .env>` | `login claude@modeling.example claude-password` |

The CLI keeps the session it is given in `.eta-session`. A refused write prints `refused: <why>`
and exits 1: read it, it is the model saying no. Everyone signs in as `<name, in lower
case>@modeling.example`; `.env`'s `MODEL_PEOPLE` says who.

## The verbs

`model/cli.ts` (eta: `examples/modeling/cli.ts`). Stories and documents are numbered as they are
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
path>` (in a project, `bun run model:load ./app`) reads its code and runs its stories
(`loader/extract.ts`), then writes every story and every document the stories need into the model
on the page, as the person the CLI signed in as -- each write lands in front of whoever watches,
and each undoes. A document no story needs is left out, and said. `bun run model:check <example>`
reads the same app and prints its documents -- who holds each, who is told, what permit lets
through that no page offers -- and hjeli's predicates over its stories.

## From the model to the app

Load the **eta-app** skill; the model says what to build, story by story:

| In the model | In the app |
|---|---|
| A story | A story in `app/stories.ts`, in the wire's words: its actor is the cast member `as`, `does` or `cannot` the write, `seen` the holders of the documents it is born into |
| A document | A `defineDoc` in `app/delta.ts`: its root, and what it holds as its includes |
| An entity, its fields, its parent | A table in `defineSchema`, its columns, its `parent` |
| `own` | A `perSession` compartment |
| Who holds it | Who its compartment lets see it |
| What each story does or cannot | Its compartment's `permit` and `shape` |

Then `bun run stories`: the least that makes the next story pass, then the next.
