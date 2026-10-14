---
name: eta-app
description: Use before building an eta app -- the app/ of a project made with `bun create blueshed/eta`, an example under examples/<name>/, or an app in a repo of its own -- or adding a document, compartment, applet, route or CLI verb to one; and before touching the Compartment contract, an app's delta.ts, the applet registry or the {doc, ops} wire. reference/ has the contracts, one short file a piece; SKILL.md says which to read for which step.
metadata:
  version: 0.52.0
---

# Building an app on eta

An eta app is its documents. A document is what a person needs in front of them to act: open it
and you are told every change; write to it and everyone holding it is told. The server draws each
person's page from the documents they hold, and sends only what changed.

This file is the order to work in. `reference/` is how each piece works, one short file a piece
(the table at the end says which); the types in `src/` are the contract. When a story seems to need something
not here, look there before inventing a rule. If the stories are still being told, the
**modelling** skill comes first.

## The order

Each step is the least that makes the next story pass. Run `bun run stories` after each.

1. **The story** (`stories.ts`): who does what, and who then sees it, in a sentence a customer
   could call true or false. Watch it fail. → [stories](reference/stories.md)
2. **The documents** (`delta.ts`): the schema, a seed, each document registered -- cut by who reads
   it. How to write `defineSchema` and `defineDoc` is delta's own `delta-doc` skill. → [documents](reference/documents.md)
3. **What a document is to its pages** (`documents/<thing>.ts`): `read(id)`, and the pure rules a
   write follows, tested directly. → [documents](reference/documents.md)
4. **Its compartment** (`compartments/<thing>.ts`): who sees it, which writes are allowed
   (`permit`), what a write becomes (`shape`), what follows. → [compartment](reference/compartment.md)
5. **What is live**: a document the server works out, written as the difference. → [compartment](reference/compartment.md#by-kind)
6. **The page** (`render(sessionId)`): a box or a collection, in parts. → [page](reference/page.md),
   [controls](reference/controls.md), [bento](reference/bento.md)
7. **An applet**, only for state a redraw would destroy (a drag, a sparkline). → [applets](reference/applets.md)
8. **`index.ts`**: the `Example`. **`cli.ts`**, if a person or Claude writes from the terminal. →
   [example](reference/example.md)
9. **Tests**, for what a story cannot say. → [tests](reference/tests.md)

## The rules that matter most

- Build nothing no story needs, and never write a story to justify what is built.
- A refusal is a story too (`cannot`), and says why in the story's words.
- A change goes as the smallest part that holds it; a part far bigger than its write is a bug.
- Never edit `src/` from an app: a missing seam is rare. →
  [where-an-app-lives](reference/where-an-app-lives.md#when-it-looks-like-you-need-to-touch-src)

## Where the app lives

A project made with `bun create blueshed/eta` (`app/`, beside `model/` and `src/`), one of eta's
examples (`examples/<name>/`), or a repo that installs eta. Each runs the same way; how each starts,
and how a project moves to a later eta, is → [where-an-app-lives](reference/where-an-app-lives.md).

## Which file for which step

Each file stands alone: what the piece is and when to use it, an example, the details. Where one and
the code disagree, the code is right; `docs/first-app.md` at the root is the way in for someone new.

| To | Read |
|---|---|
| Know the words; choose how to make, refuse or keep a document | [words](reference/words.md) |
| Write a story (1) | [stories](reference/stories.md) |
| Declare and read documents; undo (2, 3) | [documents](reference/documents.md) |
| Permit, shape, follow a write; keep what is live (4, 5) | [compartment](reference/compartment.md) |
| Draw the page and cut it into parts (6) | [page](reference/page.md) |
| Build a form, a button or a field (6) | [controls](reference/controls.md) |
| Lay out a box or a collection, a drawer, a modal; the address (6) | [bento](reference/bento.md) |
| Draw a page for reference data from its shape (6) | [derive](reference/derive.md) |
| Write an applet or an island (7) | [applets](reference/applets.md) |
| Write `index.ts`, sign people in, add a CLI verb (8) | [example](reference/example.md) |
| Test in a browser; the gate (9) | [tests](reference/tests.md) |
| Know what crosses the socket; let an assistant use the page | [wire](reference/wire.md) |
| Start, upgrade or install eta; before touching `src/` | [where-an-app-lives](reference/where-an-app-lives.md) |
