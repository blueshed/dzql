---
name: eta-app
description: Use before building an eta app -- the src/ of a project made with `bun create dzql`, an example under examples/<name>/, or an app in a repo of its own -- or adding a document, resource, applet, route or CLI verb to one; and before touching the Resource contract, an app's delta.ts, the applet registry or the {doc, ops} wire. reference/ has one short file a piece; SKILL.md says which to read for which step.
metadata:
  version: 0.53.0
---

# Building an app on eta

An eta app is its documents. A document is what a person needs in front of them to act: open it
and you are told every change; write to it and everyone holding it is told. The server draws each
person's page from the documents they hold, and sends only what changed. Routes and resources
are on the server: a resource looks after one document (who may write it, what a write becomes);
an island is the only client resource.

eta is the thin client: the server draws the page. The thick one is paintbrush (`bun create
blueshed`, its evolve skill), where the browser draws it; an applet works in either, and the
documents are the same. Pick for ease or performance.

The types in dzql's `src/rendering/` (`node_modules/dzql/` in a project) are the contract: read
them, not prose about them. Only while someone is telling you the stories, there to answer, does
the **modelling** skill come first; asked to build or change, build.

## The order

Stories, then documents, then pages: each step the least that makes the next story pass. Run
`bun run stories` after each. The words are [words](reference/words.md).

1. **The story** (`stories.ts`): who does what, and who then sees it. Watch it fail. →
   [stories](reference/stories.md)
2. **The documents** (`delta.ts`), cut so whoever must see a change holds it; then
   `documents/<thing>.ts`: `read(id)` and the pure rules a write follows, tested directly; undo. →
   [documents](reference/documents.md); one that would grow forever, [scope](reference/scope.md);
   a field renamed or dropped, or data moved, [migrations](reference/migrations.md)
3. **Its resource**: `permit`, `shape`, what follows; a memory document the server works out,
   written as the difference. → [resource](reference/resource.md); why a write was refused or what
   it did, [refusal](reference/refusal.md)
4. **The page** (`render(sessionId)`): a box or a collection, in parts. → [page](reference/page.md);
   a field, form or button, [controls](reference/controls.md); a drawer, a modal, the address,
   [bento](reference/bento.md); reference data, [derive](reference/derive.md)
5. **An applet or an island**, only for state a redraw would destroy. →
   [applets](reference/applets.md); its data, [watching](reference/watching.md)
6. **`index.ts`**: the `Example`; `cli.ts`, if someone writes from the terminal. →
   [example](reference/example.md); sign-in and routes, [signin](reference/signin.md)
7. **Tests**, for what a story cannot say; the gate. → [tests](reference/tests.md)

Also: what crosses the socket, [wire](reference/wire.md); an assistant on the page,
[assistants](reference/assistants.md); starting a project, a later dzql, or before touching the
kernel, [where-an-app-lives](reference/where-an-app-lives.md).

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
- The loop is seconds: `bun run stories` (`STORY=<words>` for one) and `bun test <file>`, read
  for its passes and fails (coverage is a whole run's). The gate, before a commit: `bun check`,
  `bun test --parallel` (100% coverage), `bun run stories`.
- Never edit dzql's kernel from an app (`node_modules/dzql`): a missing seam is rare. →
  [where-an-app-lives](reference/where-an-app-lives.md#when-it-looks-like-you-need-to-touch-the-kernel)
