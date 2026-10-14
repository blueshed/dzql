---
name: eta-app
description: Use before building an eta app -- the src/ of a project made with `bun create blueshed/eta`, an example under examples/<name>/, or an app in a repo of its own -- or adding a document, compartment, applet, route or CLI verb to one; and before touching the Compartment contract, an app's delta.ts, the applet registry or the {doc, ops} wire. reference/ has one short file a piece; SKILL.md says which to read for which step.
metadata:
  version: 0.53.0
---

# Building an app on eta

An eta app is its documents. A document is what a person needs in front of them to act: open it
and you are told every change; write to it and everyone holding it is told. The server draws each
person's page from the documents they hold, and sends only what changed.

Stories, then documents, then pages: a story says who does what and who then sees it; documents are
cut so that whoever must see a change holds it; the page is drawn from what it reads. This file is
the order to work in; `reference/` says how each piece works, one short file a piece. The types in
`src/` (a project's `eta/src/`) are the contract: read them, not prose about them. Only while someone is telling you the stories,
there to answer, does the **modelling** skill come first; asked to build or change, build.

## The order

Each step is the least that makes the next story pass. Run `bun run stories` after each.

1. **The story** (`stories.ts`): who does what, and who then sees it. Watch it fail. →
   [stories](reference/stories.md)
2. **The documents** (`delta.ts`): the schema, a seed, each document registered -- cut by who reads
   it. → [documents](reference/documents.md)
3. **What a document is to its pages** (`documents/<thing>.ts`): `read(id)`, and the pure rules a
   write follows, tested directly. → [documents](reference/documents.md)
4. **Its compartment**: `permit`, `shape`, what follows. → [compartment](reference/compartment.md),
   [refusal](reference/refusal.md)
5. **What is live**: a document the server works out, written as the difference. →
   [compartment](reference/compartment.md#after-a-write)
6. **The page** (`render(sessionId)`): a box or a collection, in parts. → [page](reference/page.md),
   [controls](reference/controls.md), [bento](reference/bento.md)
7. **An applet**, only for state a redraw would destroy. → [applets](reference/applets.md)
8. **`index.ts`**: the `Example`; `cli.ts`, if someone writes from the terminal. →
   [example](reference/example.md)
9. **Tests**, for what a story cannot say. → [tests](reference/tests.md)

## The rules that matter most

- Asked to build or change something, build it. Never stop to wait for an answer: put the question
  in `todo.jsonl` with the reading you took, and go on.
- Build nothing no story needs, and never write a story to justify what is built.
- A refusal is a story too (`cannot`), and says why in the story's words.
- HTML is the only vocabulary: the server is the only renderer, the client morphs and keeps no
  domain state.
- A write names a document and a JSON Pointer path, never a verb. Seen, then `permit`, then
  `shape`, then delta; every change is told from delta's stream, never by hand.
- A page sees what it read: `read()` what you show, and cut documents by who reads them.
- A change goes as the smallest part that holds it; a part far bigger than its write is a bug.
- The loop is seconds: `bun run stories` (`STORY=<words>` for one) and `bun test <file>`, read for
  its passes and fails, as coverage is a whole run's. The gate, before a commit: `bun check`,
  `bun test --parallel` (100% coverage), `bun run stories`.
- Never edit eta's kernel from an app (a project's `eta/`): a missing seam is rare. →
  [where-an-app-lives](reference/where-an-app-lives.md#when-it-looks-like-you-need-to-touch-the-kernel)

## Which file for which step

| To | Read |
|---|---|
| Know the words; make, refuse or keep a document | [words](reference/words.md) |
| Write a story | [stories](reference/stories.md) |
| Declare and read documents; undo | [documents](reference/documents.md) |
| Keep a document from growing forever: today's, what is open, or a window | [scope](reference/scope.md) |
| Permit, shape, follow a write | [compartment](reference/compartment.md) |
| Say why a write was refused, or what it did | [refusal](reference/refusal.md) |
| Draw the page in parts | [page](reference/page.md) |
| Build a field, a form or a button | [controls](reference/controls.md) |
| A box or collection, a drawer, a modal; the address | [bento](reference/bento.md) |
| A page for reference data | [derive](reference/derive.md) |
| An applet or an island | [applets](reference/applets.md) |
| An applet's data | [watching](reference/watching.md) |
| `index.ts`; the CLI | [example](reference/example.md) |
| Sign people in; a route | [signin](reference/signin.md) |
| What crosses the socket | [wire](reference/wire.md) |
| Let an assistant use the page | [assistants](reference/assistants.md) |
| Browser tests; the gate | [tests](reference/tests.md) |
| Start a project, or update its eta; before touching the kernel | [where-an-app-lives](reference/where-an-app-lives.md) |
