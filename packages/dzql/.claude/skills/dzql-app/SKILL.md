---
name: dzql-app
description: Use before building an app whose pages dzql's server draws (dzql/rendering) -- the src/ of a project made with `bun create dzql`, an example under examples/<name>/, or an app in a repo of its own -- or adding a document, resource, applet, route or CLI verb to one; and before touching the Resource contract, an app's store.ts, the applet registry or the {doc, ops} wire. reference/ has one short file a piece; SKILL.md says which to read for which step.
metadata:
  version: 0.53.0
---

# Building an app on dzql

A dzql app is its documents. A document is what a person needs in front of them to act: open it
and you are told every change; write to it and everyone holding it is told. The server draws each
person's page from the documents they hold, and sends only what changed. Routes and resources
are on the server: a resource looks after one document (who may write it, what a write becomes);
an applet is the only client resource.

dzql's rendering is the thin client, for performance: the server draws the page, with applets
where a page holds state, and the documents are compiled to Postgres. The light one, for
prototyping, is paintbrush (`bun create blueshed`, its evolve skill), where the browser draws it;
the documents are the same.

The types in dzql's `src/rendering/` (`node_modules/dzql/` in a project) are the contract: read
them, not prose about them. Only while someone is telling you the stories, there to answer, does
the **modelling** skill come first; asked to build or change, build.

## The path

**dzql's `examples/cafe/` is an app built this way** (`node_modules/dzql/examples/cafe/` in a
project; laid out at its root where yours has `src/`). Each step names the file of it that shows
the step: read it, then do the step in your app. Stories, then documents, then pages, each the
least that makes the next story pass; `bun run stories` after each.

1. **The story**, `stories.ts`: a member of the cast (`as`) `does` or `cannot` a write -- a
   document and its ops -- and who then sees it (`seen`). Watch it fail; a teller asking to see the
   page now is no reason to skip it. If the stories were modelled, `dzql model` has already made
   `model/` (the definitions, the guards, the migrations), and each story names the model story it
   tells (`model: 6`; `model: false` for the app's own). → [stories](reference/stories.md)
2. **The store**, `store.ts`: Postgres, through dzql's `openStore({ schema, migrations })` -- PGlite
   in the process (in `PGLITE_DIR`; in memory for the tests), or a server at `DATABASE_URL`. The
   tables (`defineSchema`: the model's `tables`, and the app's own beside them), the model's
   migrations, `prepare` to seed it, `delta` (the model's guards put on it as the app loads, before
   any listener), `register` for each resource's documents; the store is the app's `Example.store`,
   which `appOf` opens as the server starts (each document compiled) and closes as it stops, and
   the stories put back between stories. → [documents](reference/documents.md),
   [migrations](reference/migrations.md)
3. **A document, a folder**, `resources/floor/`: `floor-api.ts` registers its definition, `read()`s
   it for the page, and keeps the pure rules a write follows; `floor.ts` is its **resource**, which
   says which document a session is on (`resolveDoc`; a list's is `""`), what may be sent
   (`permit`), what a write becomes (`shape`) and what follows it. Undo is the ledger
   (`{ ledger: true }`). → [resource](reference/resource.md); refusing, saying why,
   [refusal](reference/refusal.md); a document that would grow forever, [scope](reference/scope.md)
4. **The session**, `resources/visit/`: each visitor's own document, a `perSession` resource listed
   first, found by its cookie (`sessionRows`). It keeps only what the stories need: who you are and
   what is yours. Where you are is one **address**, each tab's own and its URL: written on the
   session (`/page`), which says where a tab may stand, and the kernel moves the tab that sent it.
   → [bento](reference/bento.md#where-you-are-the-address)
5. **The page**, `page.ts` and each `<name>-view.ts`: a **box** of **cells** (`boxPage`), a list
   `rows()` of `row()`s, a deed a `tool()`, a drawer or a modal over it, a refusal drawn where it
   happened (`toldAt`). `surfaces.ts` makes the bento once (`bento({ icon, session, leave })`);
   `icons.ts` is lucide. → [page](reference/page.md), [bento](reference/bento.md),
   [controls](reference/controls.md); reference data, [derive](reference/derive.md)
6. **The routes**, `routes.ts`: the app (its `Example`: resources, page, who is active, the
   address, its routes) on delta's one server, the model's page beside it in development. People
   come in by a link each (`links.ts`); what is no document's is a route that writes as the server
   (`serverWrite`, the cafe's `/scan`). → [example](reference/example.md), [signin](reference/signin.md)
7. **Tests**, `routes.test.ts`: what a story cannot say, then the gate. → [tests](reference/tests.md)

Beyond the cafe, dzql's other examples are laid out the same way, on SQLite (`openTables`,
`dzql/rendering/db`, in their `store.ts`): a document the server works out (chat's `here`, kept
by its `presence.ts`, [resource](reference/resource.md#after-a-write)); an applet, only for
state a redraw would destroy (the ticker's board, [applets](reference/applets.md),
[watching](reference/watching.md)); a CLI (chat's `cli.ts`); uploads (the wedding's); passwords and
a proxy (leave's `signin.ts`). Also: what crosses the socket, [wire](reference/wire.md); an
assistant on the page, [assistants](reference/assistants.md); starting a project, a later dzql, or
before touching the kernel, [where-an-app-lives](reference/where-an-app-lives.md). The words are
[words](reference/words.md).

## The rules that matter most

- **A page is the bento's, never hand-rolled.** Read [page](reference/page.md) and
  [bento](reference/bento.md) before the first `render`: a page is a `collectionPage` or a
  `boxPage` in `layers()`, a list is `rows()` of `row()`s (a lead, the words, a state, one tap),
  a deed is a `tool()`; `styles.css` imports a look first (`bento-plain.css`, the starter's) and says only the app's tokens and
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
