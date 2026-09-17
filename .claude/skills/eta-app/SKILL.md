---
name: eta-app
description: Use this skill before writing any code under examples/<name>/ — adding a new eta example app, or adding a document/compartment/applet/migration/CLI verb to an existing one. Also use it before touching the Compartment contract, migrate(), the applet registry, or the {doc,ops} wire protocol, since those are the seam a new example has to fit through. Reference.md has the full contracts and code excerpts.
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
  document, which writes are allowed, how they apply, who is told. It has no place on the page.
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
2. **`db.ts`** -- import `db` from `../../src/db`, call
   `migrate(db, `${import.meta.dir}/migrations`, "<name>")`, re-export `db`. Every document module
   imports `db` from here, never from `src/db`, so the migrations have run before its prepared
   statements touch the database.
3. **`migrations/*.sql`** -- numbered, applied in filename order under the example's own namespace.
4. **`documents/<thing>.ts`** -- `read(id)`, and `patch(id, ops, sessionId, undoes?)`: the only write
   path, one transaction, each op's inverse computed, one `record(...)` at the end. Is this value
   valid is `patch()`'s question; may this connection write this path is `permit()`'s.
5. **`compartments/<thing>.ts`** -- `docType`, `resolveDoc`, `permit`, `write`, and what it needs of
   `sees`, `fragments`, `onOpen`, `onClose`. `write()` ends by calling
   `notify(docType, docId, result)`, which echoes the ops to everyone who sees the document and
   asks for their pages to be brought up to date, the writer included. Implement `fragments` only
   where answering smaller than the page is worth the care: every target it names has to be right for
   every state the page can be in, and no story checks it.
6. **`applets/<name>.ts`** -- only if the vocabulary above says so. Split drawing (`<name>.ts`, pure,
   tested directly) from mounting (`<name>-applet.ts`, the DOM, imported only by `client/main.ts`)
   when there is drawing worth testing.
7. **`client/index.html` + `client/main.ts`** -- `main.ts` imports the example's applets, then
   `src/client/app`. The stylesheet imports `src/bento.css` first, then says its own tokens.
8. **`index.ts`** -- `export const example: Example = { name, compartments, render, active, index, routes? }`. `render(sessionId)` is the whole page.
9. **`cli.ts`** (optional) -- an `aliases` table of short verbs that build `{doc, ops}`; no database.
10. **Tests** -- a test per document, a `server.test.ts` that drives writes and undo over a real
    websocket (this is where delivery is checked: who is told, and with what), a
    `client/app.test.ts` for what only a browser can show. `bun test`; 100% is a gate; verify a
    bug fix by reverting it and watching the test fail.

None of this needs a file under `src/` edited. When it seems to, read `reference.md`'s "When it
looks like you need to touch `src/`" first: a missing seam is rare, and a workaround is never it.
