---
name: eta-app
version: 0.46.0
description: Use this skill before writing any code under examples/<name>/ — adding a new eta example app, or adding a document/compartment/applet/CLI verb to an existing one. Also use it before touching the Compartment contract, an example's delta.ts, the applet registry, or the {doc,ops} wire protocol, since those are the seam a new example has to fit through. Reference.md has the full contracts and code excerpts.
---

# Building an example on eta

eta is a kernel (`src/`) plus examples (`examples/<name>/`). The kernel never imports anything
under `examples/`; an example is everything needed to turn the kernel into a running app. This file
is the order to work in. `reference.md` beside it is how each piece works, one section per piece;
the types in `src/` are the contract itself.

## 0. The story, first

Before a table, a document or a line of HTML: open the example's `stories.ts` (and `stories.md` at
the root, once) and write the story -- who does what, and who then sees it, as a sentence a
customer could call true or false. Run `bun run stories` (`ETA_EXAMPLE=<name>`) and watch it fail.
Everything below is the least that makes it pass.

- Build nothing no story needs. If the thing you are about to add has no story, it has no reason.
- Do not write a story to justify something already built. A story that describes the tray's
  state ("opens the drawer", "the modal asks") cannot fail and proves nothing; tell what the
  person wants, and use `seen`'s place for where they must stand to see it.
- A refusal is a story too (`cannot`): the other half of what a person may do.

## Vocabulary, once

- A **Compartment** (`src/compartments/compartment.ts`) owns one `docType`: who sees its
  document, which writes are allowed, and what the wire's write becomes. Its documents are delta's. It has no place on the page.
  The page is the example's one `render(sessionId)`: which screen, in what order, reading
  whichever documents it must. An example with a lot of HTML keeps the functions that build it in
  files of their own (the wedding's and the ticker's `views/`); chat's are beside its room.
- The **tray** is the session's own document -- who you are, which page you are on -- and a
  compartment like any other (chat's and the wedding's `session`, the ticker's `desk`); list it
  first. Keep as little in it as the stories need: a page and its open drawer are one address, not
  six fields.
- An **applet** is only for a piece of the page whose client-side state a re-render would destroy
  (the ticker's board keeps sparkline histories no document holds). It is not "the view for X";
  plain `data-write` HTML is the default.
- The **bento** is how a page looks and moves (`examples/bento/README.md`, built in `src/bento.ts`
  and `src/bento.css`): a page is a box or a collection. It is a way of seeing, not a list of
  features to have.

## Adding or extending an example

1. **`stories.ts`** -- step 0, above.
2. **`delta.ts`** -- the schema (`defineSchema`, tables named `<name>_...`), `createTables` against
   `src/db`'s `db`, a seed run into empty tables, and the documents registered on a
   `createLocal()`: `registerDocs(..., { ledger: true })` for what is written and undone, a registry
   of its own with no ledger for the tray, `registerMemory` for what is live. Cut documents by
   who reads them: a page is told every change to what it read.
3. **`documents/<thing>.ts`** -- `read(id)`, from `read("<docType>:<id>")` in `src/documents.ts`,
   adapting delta's rows into what the views want; and the pure rules a write follows
   (`after(state, ops)`), tested directly.
4. **`compartments/<thing>.ts`** -- `docType`, `resolveDoc`, `permit`, `own` if its documents are
   keyed by the session id, `kind` if not `written`, `at` if its fields sit under the root
   (`/sessions`), and `shape`: the wire's ops as the document takes them (validated, an id minted,
   a nested path turned into rows), nothing when nothing applies. `changed` keeps a live document
   true after any change; `wrote` does what follows for the writer alone. The kernel tells every
   change itself: echoed to who sees it, every page that read it drawn again, each sent only the
   parts that changed. Name the page's regions with `part(key, html)` where a change should travel
   alone; nothing else says what goes.
5. **What is live** -- a document the server keeps (who is here, who stands in the photo):
   computed whole from the tables in `changed`, written as the difference with `serverWrite`.
6. **`applets/<name>.ts`** -- only if the vocabulary above says so. Split drawing (`<name>.ts`, pure,
   tested directly) from mounting (`<name>-applet.ts`, the DOM, imported only by `client/main.ts`)
   when there is drawing worth testing.
7. **`client/index.html` + `client/main.ts`** -- `main.ts` imports the example's applets, then
   `src/client/app`. The stylesheet imports `src/bento.css` first, then says its own tokens.
8. **`index.ts`** -- `export const example: Example = { name, compartments, render, active, index, delta, who?, routes? }`. `render(sessionId)` is the whole page.
9. **`cli.ts`** (optional) -- an `aliases` table of short verbs that build `{doc, ops}`; no database.
10. **Tests** -- a test for each document's rules and shapes, a `server.test.ts` that drives writes and undo over a real
    websocket (this is where delivery is checked: who is told, and with what), a
    `client/app.test.ts` for what only a browser can show. The gate is `bun run check`,
    `bun test` (100% coverage) and `bun run stories:all`; verify a bug fix by reverting it and
    watching the test fail.

None of this needs a file under `src/` edited. When it seems to, read `reference.md`'s "When it
looks like you need to touch `src/`" first: a missing seam is rare, and a workaround is never it.
