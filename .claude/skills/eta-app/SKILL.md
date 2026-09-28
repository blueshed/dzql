---
name: eta-app
version: 0.50.0
description: Use this skill before writing any code under examples/<name>/ — adding a new eta example app, or adding a document/compartment/applet/CLI verb to an existing one. Also use it before touching the Compartment contract, an example's delta.ts, the applet registry, or the {doc,ops} wire protocol, since those are the seam a new example has to fit through. Reference.md has the full contracts and code excerpts.
---

# Building an example on eta

eta is a kernel (`src/`) plus examples (`examples/<name>/`). The kernel never imports anything
under `examples/`; an example is everything needed to turn the kernel into a running app. This file
is the order to work in. `reference.md` beside it is how each piece works, one section per piece;
the types in `src/` are the contract itself. New to eta? `first-app.md` at the root walks chat,
then leave, in the order you meet the words.

## 0. The story, first

Before a table, a document or a line of HTML: open the example's `stories.ts` (and `stories.md` at
the root, once) and write the story -- who does what, and who then sees it, as a sentence a
customer could call true or false. Run `bun run stories` (`ETA_EXAMPLE=<name>`) and watch it fail.
Everything below is the least that makes it pass.

- Build nothing no story needs. If the thing you are about to add has no story, it has no reason.
- Do not write a story to justify something already built. A story that describes the session's
  state ("opens the drawer", "the modal asks") cannot fail and proves nothing; tell what the
  person wants, and use `seen`'s place for where they must stand to see it.
- A refusal is a story too (`cannot`): the other half of what a person may do.
- A story's `from` is where a person does it, so a control must lead there: build the button
  that opens the drawer or the modal with the drawer or the modal, or the story fails (`no control
  leads ...`), since the harness can put anyone anywhere and a person cannot.
- A drag or a tap on an applet is the story's `gesture`: `{ drag: [from, to] }` or `{ press }`,
  CSS selectors on the page (leave's calendar). The story is then done by hand in a browser the
  size of a phone, and the gesture must send its `does`. `STORY_BY_HAND=1 bun run stories` (and
  `bun run stories:all`) does by hand each write a page sends and each refusal a control of the
  page sends, pressing the controls the page draws.
- A story has a cost on the wire, and `STORY_WIRE=1 bun run stories` says it: what the story's
  write handed each page, before compression and as sent, and its biggest part (`photo 9.7 KB`),
  and what its undo and redo handed each.
  A part far bigger than the write is where to look: a `part` cut coarser than what changes, or
  an applet handed its props whole where it could take its document's patches (`data-doc`). Say
  what a story may cost with `budget` (bytes before compression), on the story or on the
  example's `Stories` for all of them; a page handed more by the write, the undo or the redo fails
  the story (stories.md, "What a story costs").

## Vocabulary, once

- A **Compartment** (`src/compartments/compartment.ts`) looks after one type of document: which
  one a page is on, who may write to it, and what a write becomes. Its documents are delta's. It
  has no place on the page.
  The page is the example's one `render(sessionId)`: which screen, in what order, reading
  whichever documents it must. An example with a lot of HTML keeps the functions that build it in
  files of their own (the wedding's and the ticker's `views/`); chat's are beside its room.
- The **session** is each visitor's own document -- who you are, which page you are on -- and a
  compartment like any other (chat's and the wedding's `session`, the ticker's `desk`); list it
  first. Keep as little in it as the stories need: a page and its open drawer are one address, not
  six fields.
- An **applet** is only for a piece of the page whose state in the browser a redraw would destroy
  (a drag halfway through; the ticker's board keeps sparkline histories no document holds). It is
  not "the view for X"; plain `data-write` HTML is the default.
- A **cell** is a place in a bento box, and the **tray** is the box the cells are cut into. They
  are how a page looks; a compartment is how a document is kept.
- The **bento** is how a page looks and moves (`examples/bento/README.md`, built in `src/bento.ts`
  and `src/bento.css`): a page is a box or a collection. It is a way of seeing, not a list of
  features to have.

## Adding or extending an example

1. **`stories.ts`** -- step 0, above.
2. **`delta.ts`** -- the schema (`defineSchema`, tables named `<name>_...`), `createTables` against
   `src/db`'s `db`, a seed run into empty tables, and the documents registered on a
   `createLocal()`: `registerDocs(..., { ledger: true })` for what is written and undone,
   `registerMemory` for what is live. A session may be kept off the ledger, in a registry of its own,
   where a visit is not history (the ticker's desk, the wedding's session), and its compartment
   then says `ledger: false`; chat's session is on it. Cut documents by who reads them: a page is
   told every change to what it read, so an applet on one big document is given a view of its own
   (reference.md, "Applets"). How to write `defineSchema` and `defineDoc` (`root`, `include`,
   `implied`, `temporal`) is delta's own `delta-doc` skill
   (`node_modules/@blueshed/delta/.claude/skills/delta-doc/`).
3. **`documents/<thing>.ts`** -- `read(id)`, from `read("<docType>:<id>")` in `src/documents.ts`,
   adapting delta's rows into what the views want; and the pure rules a write follows
   (`after(state, ops)`), tested directly.
4. **`compartments/<thing>.ts`** -- `docType`, `resolveDoc`, `permit`, `perSession` if its documents are
   keyed by the session id, `kind` if not `written`, `ledger: false` if it is kept off the ledger,
   `under` if its fields sit under the root (`/sessions`), and `shape`: the wire's ops as the document takes them (validated, an id minted,
   a nested path turned into rows), nothing when nothing applies. `afterChange` keeps a live document
   true after any change; `afterWrite` does what follows for the writer alone. The kernel tells every
   change itself: echoed to who sees it, every page that read it drawn again, each sent only the
   parts that changed. A part is the unit of a message: a change goes as the smallest part that
   holds it, whole, so make what changes alone -- a row, a card, a count -- a part of its own with
   `part(key, html)`; nothing else says what goes. A row may be a part and still move to another
   list (reference.md, "Parts").
5. **What is live** -- a document the server keeps (who is here, who stands in the photo):
   computed whole from the tables in `afterChange`, written as the difference with `serverWrite`,
   one run at a time (delta refuses a remove of what another run took out).
6. **`applets/<name>.ts`** -- only if the vocabulary above says so. Split drawing (`<name>.ts`, pure,
   tested directly) from mounting (`<name>-applet.ts`, the DOM, imported only by `client/main.ts`)
   when there is drawing worth testing. An applet that builds and updates its DOM by hand is
   better an island: a railroad component made an applet by `island()` (`<name>-applet.tsx`,
   reference.md "Applets").
7. **`client/index.html` + `client/main.ts`** -- `main.ts` imports the example's applets, then
   `src/client/app`. The stylesheet imports `src/bento.css` first, then says its own tokens; it
   draws only what is in `layers()`, so the page is drawn in it.
8. **`index.ts`** -- `export const example: Example = { name, compartments, render, active, index, delta, who?, routes? }`. `render(sessionId)` is the whole page.
9. **`cli.ts`** (optional) -- an `aliases` table of short verbs that build `{doc, ops}`; no database.
10. **Tests** -- a test for each document's rules and shapes, a `server.test.ts` that drives writes
    and undo over a real websocket (for what a story cannot say: two writes racing), a
    `client/app.test.ts` for what only a browser can show (`Bun.WebView`: open each view at
    `urlFor(view, server.url)` and wait with `waitFor`, both `src/webview.ts`, so each is a browser of
    its own on Chrome too). The gate, and what the browser tests need, are CLAUDE.md's.

    Press as a mouse does, never with `element.click()`: it sends no pointerdown or pointerup, and
    reaches a control whatever is drawn over it, so a tap that goes nowhere passes (japan-eta's
    strip redrew itself on pointerup, and its real click reached nothing). `press` (`src/webview.ts`)
    scrolls to the control, presses and lets go at its middle, each event to what is there, then
    sends the click where a browser would, and throws, naming what covers it, when something else
    is at its middle. (`view.click(selector)` is the browser's own press, for a control already in
    view.)

    ```ts
    await press(view, "#quote-FXTR button");
    await waitFor(view, `document.querySelector('.drawer h2')?.textContent`, (v) => v === "FXTR");
    ```

## An app of its own

An app need not be an example: it can live in its own repo and install eta. `package.json` says
what eta ships (`src` without its tests, these skills, the docs), so pack it and add the tarball,
never `file:` or `bun link`: a linked checkout brings its own `node_modules`, and two copies of
delta or railroad go inert (delta's skill, "Local development across repos").

```sh
cd ../blueshed/eta && bun pm pack && cd - && bun add ../blueshed/eta/eta-<version>.tgz
```

After a change to eta, pack again, then `bun remove eta && bun add` the tarball: the lockfile
keeps a tarball's first contents, through `bun add` again and `bun install --force` alike (Bun 1.4). The app then imports the kernel
as `eta/src/...` (the stylesheet too: `@import "eta/src/bento.css"`), and has three small files
where an example leans on eta's scripts: `server.ts` (`createServer(example)`, src/server.ts), a
stories runner (`print(await run(example, stories, undefined, { byHand: !!process.env.STORY_BY_HAND }), { wire: !!process.env.STORY_WIRE })`,
src/harness.ts), and eta's `tsconfig.json`,
`bunfig.toml` (the 100% gate) and `.env.test`. The steps above are the same. `Workshop/japan-eta`
is one.

None of this needs a file under `src/` edited. When it seems to, read `reference.md`'s "When it
looks like you need to touch `src/`" first: a missing seam is rare, and a workaround is never it.
