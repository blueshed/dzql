---
name: modelling
description: Use while someone tells the stories of an app to be built on eta -- to write each story down on the model's page as it is told, describe the documents it needs (root, what each holds, who holds it), and read the gaps back, before any of the app is built. Then the eta-app skill builds from the model.
metadata:
  version: 0.1.0
---

# Keeping the model while the stories are told

The model is a description of an application, kept by two people as they talk: one tells the
stories, the other -- you -- writes them down and describes the documents they need. It is a delta
document on the model's page, so the teller watches each change land, and every change undoes. The
entities are worked out from the documents, never written: if they look wrong, a document is.

## Where it runs

- In a project made with `bun create blueshed/eta`: `bun run model` (port 3001), and you write
  with `bun run cli:model <verb>`. In eta itself: `bun run dev:modeling` (port 3005), and
  `ETA_EXAMPLE=modeling ETA_URL=ws://localhost:3005 bun run cli <verb>`.
- Sign the CLI in once, as the page signs a person in: `bun run cli:model login
  claude@modeling.example <password>` (the password is `.env`'s `MODEL_PASSWORD`; in eta,
  `claude-password`). It keeps the session in `.eta-session`.
- A refused write prints `refused: <why>` and exits 1. Read it; it is the model saying no.

## The verbs (model/cli.ts)

| Said | Verb |
|---|---|
| A story | `story <actor> <does\|cannot> <words>` -- `--post /login` among the words for one that posts a form before anyone holds a document |
| A correction | `reword <n> <words>` |
| What its write changes | `touches <n> <entity>...` |
| A story taken back | `unsay <n>` |
| A document | `document <name> <root> <story>...` -- at least one story it serves |
| What it holds | `holds <doc> <entity> [under <parent>] <field[:type]>...` |
| Who holds it | `heldby <doc> <actor>...`; `own <doc>` for one each person has alone (a session) |
| Which stories it serves | `serves <doc> <story>...` |
| Renamed, taken out | `rename <doc> <name>`, `drop <doc>`, `unhold <doc> <entity>` |
| A slip | `undo` (and `redo`) |

## How to listen

1. **Write the story down as it was said**, the teller's words, with who tells it and whether they
   do it or are refused. A refusal is a story too. Don't improve it; ask, and `reword` what they say.
2. **Ask what the person needs in front of them to do it.** That is a document. Who else must see
   the change? They hold it too. Name the document for what it is to the people holding it (the
   team, a room, my week), not for a table.
3. **Say what it holds**: its root, and each entity under what it hangs from, with the fields the
   story needs -- no more. A field no story reads is a field nobody needs yet.
4. **Say what the story touches**: the entities its write changes.
5. **Read the page back.** Each gap is a question for the teller, never something to fix quietly:
   - *no document*: a story nothing serves yet -- what does its person hold?
   - *needed by no story* (red): a document, or its entities, that no story told still needs --
     take it out, or is a story missing?
   - *looked up, never held* (dashed): touched by a story, held by no document -- right for a
     credential read at sign-in; otherwise, who is told when it changes?
   - a document held by everyone, written by everyone: every write tells every holder. Is that what
     the stories ask for?

Build nothing yet. The model is done enough when the teller reads the page and calls each story
true.

## Then build it

Load the **eta-app** skill. The model says what to build, story by story:

- each story is a story in `app/stories.ts`, in the wire's words: its actor is the cast member
  `as`, `does` or `cannot` the write, `seen` the holders of the documents it is born into;
- each document is a `defineDoc` in `app/delta.ts` -- its root, and what it holds as its includes --
  and the entities with their fields and parents are its `defineSchema`; `own` is `perSession`;
- who holds a document is who its compartment lets see it; what each story does or cannot is its
  `permit` and `shape`.

Run `bun run stories` after each: the least that makes the next story pass, then the next.
