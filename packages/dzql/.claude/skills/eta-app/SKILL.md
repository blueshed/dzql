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

An app is routes and resources. A project made with `bun create dzql` lays it out so:
`src/routes.ts` is the server (the app, its HTTP routes and in development the model's page,
composed on delta's one server), and each document is a resource of its own folder,
`src/resources/<name>/`: `<name>-api.ts` (its schema and document, registered on `delta`, and
`read` for the page), `<name>.ts` (its `Resource`: who may write it, what a write becomes) and
`<name>-view.ts` (its part of the page, drawn by `src/page.ts`). dzql's own examples (chat,
leave, wedding, the ticker) are the same pieces in eta's earlier places: `delta.ts`,
`documents/<thing>.ts`, `resources/<thing>.ts` and `index.ts`; read them for how, and put what
you write where the project's layout says.

1. **The story** (`stories.ts`): who does what, and who then sees it. Watch it fail. A teller
   asking to see the page now is no reason to skip it: the stories take minutes, and find what the
   teller would. → [stories](reference/stories.md)
2. **The documents** (`resources/<name>/<name>-api.ts`), cut so whoever must see a change holds
   it: the schema, the document, `read(id)` and the pure rules a write follows, tested directly; undo. →
   [documents](reference/documents.md); one that would grow forever, [scope](reference/scope.md);
   a field renamed or dropped, or data moved, [migrations](reference/migrations.md)
3. **Its resource** (`resources/<name>/<name>.ts`, listed in the app's `resources`): `permit`, `shape`, what follows; a memory document the server works out,
   written as the difference. → [resource](reference/resource.md); why a write was refused or what
   it did, [refusal](reference/refusal.md)
4. **The page** (`page.ts`'s `render(sessionId)`, each resource's part from its `<name>-view.ts`): a box or a collection, in parts. → [page](reference/page.md);
   a field, form or button, [controls](reference/controls.md); a drawer, a modal, the address,
   [bento](reference/bento.md); reference data, [derive](reference/derive.md)
5. **An applet or an island**, only for state a redraw would destroy. →
   [applets](reference/applets.md); its data, [watching](reference/watching.md)
6. **`routes.ts`**: the app (its `Example`: resources, page, who may write) and its HTTP routes, composed; `cli.ts`, if someone writes from the terminal. →
   [example](reference/example.md); sign-in and routes, [signin](reference/signin.md)
7. **Tests**, for what a story cannot say; the gate. → [tests](reference/tests.md)

Also: what crosses the socket, [wire](reference/wire.md); an assistant on the page,
[assistants](reference/assistants.md); starting a project, a later dzql, or before touching the
kernel, [where-an-app-lives](reference/where-an-app-lives.md).

## The rules that matter most

- **A page is the bento's, never hand-rolled.** Read [page](reference/page.md) and
  [bento](reference/bento.md) before the first `render`: a page is a `collectionPage` or a
  `boxPage` in `layers()`, a list is `rows()` of `row()`s (a lead, the words, a state, one tap),
  a deed is a `tool()`; `styles.css` imports `bento.css` first and says only the app's tokens and
  what the bento has no surface for. The result is a clean, simple interface: one thing to do per
  row, nothing drawn that no story needs.
- **Display, then a sheet.** A page shows; whatever edits or acts opens over it: a row's tap opens
  its drawer (its fields, its deeds), a new thing is the plus and `addModal`, a removal
  `confirmModal`. No forms, inputs, selects or per-row buttons on a page that displays, and
  several kinds of work are a `boxPage` of cells, not one long scroll ([bento](reference/bento.md)).
- **Icons are lucide**, through the app's `icons.ts` (`svg(ICONS[name])`, as chat's): the bento asks
  for its own marks by name (chevron-right, undo, redo, pencil, plus, x, and the leave tool's).
  Never another icon set, inline SVG, or a word where an icon says it.
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
