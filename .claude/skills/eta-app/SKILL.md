---
name: eta-app
description: Use before building an eta app -- the app/ of a project made with `bun create blueshed/eta`, an example under examples/<name>/, or an app in a repo of its own -- or adding a document, compartment, applet, route or CLI verb to one; and before touching the Compartment contract, an app's delta.ts, the applet registry or the {doc, ops} wire. reference.md has the contracts, one section a piece, with a contents table.
metadata:
  version: 0.52.0
---

# Building an app on eta

An eta app is its documents. A document is what a person needs in front of them to act: open it
and you are told every change; write to it and everyone holding it is told. The server draws each
person's page from the documents they hold, and sends only what changed.

This file is the order to work in. `reference.md` is how each piece works, one section a piece,
with a contents table; the types in `src/` are the contract. When a story seems to need something
not here, look there before inventing a rule. If the stories are still being told, the
**modelling** skill comes first.

## The order

Each step is the least that makes the next story pass. Run `bun run stories` after each.

1. **The story** (`stories.ts`): who does what, and who then sees it, in a sentence a customer
   could call true or false. Watch it fail. → reference: *Stories*
2. **The documents** (`delta.ts`): the schema, a seed, each document registered -- cut by who reads
   it. How to write `defineSchema` and `defineDoc` is delta's own `delta-doc` skill. → *Documents*
3. **What a document is to its pages** (`documents/<thing>.ts`): `read(id)`, and the pure rules a
   write follows, tested directly. → *Documents*
4. **Its compartment** (`compartments/<thing>.ts`): who sees it, which writes are allowed
   (`permit`), what a write becomes (`shape`), what follows. → *Compartment*
5. **What is live**: a document the server works out, written as the difference. → *By kind*
6. **The page** (`render(sessionId)`): a box or a collection, in parts. → *The page*, *Parts*,
   *Pages: the bento*
7. **An applet**, only for state a redraw would destroy (a drag, a sparkline). → *Applets*
8. **`index.ts`**: the `Example`. **`cli.ts`**, if a person or Claude writes from the terminal. →
   *`Example`*, *CLI*
9. **Tests**, for what a story cannot say. → *Tests*

## The rules that matter most

- Build nothing no story needs, and never write a story to justify what is built.
- A refusal is a story too (`cannot`), and says why in the story's words.
- A change goes as the smallest part that holds it; a part far bigger than its write is a bug.
- Never edit `src/` from an app: a missing seam is rare. → *When it looks like you need to touch
  `src/`*

## Where the app lives

A project made with `bun create blueshed/eta` (`app/`, beside `model/` and `src/`), one of eta's
examples (`examples/<name>/`), or a repo that installs eta. Each runs the same way; how each starts,
and how a project moves to a later eta, is → *Where an app lives*.
