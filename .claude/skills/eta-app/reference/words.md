# Words, and the first questions an app asks

The words the reference uses, and what to reach for first. The order to work in is [SKILL.md](../SKILL.md).

## Words

- A **Compartment** (`src/compartments/compartment.ts`) looks after one type of document: which
  one a page is on, who may write to it, and what a write becomes. Its documents are delta's. It
  has no place on the page.
- The **page** is the app's one `render(sessionId)`: which screen, in what order, reading whichever
  documents it must. An app with a lot of HTML keeps the functions that build it in files of their
  own (the wedding's and the ticker's `views/`).
- The **session** is each visitor's own document -- who you are, where you are -- and a
  compartment like any other; list it first. Keep as little in it as the stories need: a page and
  its open drawer are one address, not six fields.
- An **applet** is only for a piece of the page whose state in the browser a redraw would destroy
  (a drag halfway through, a sparkline's history). It is not "the view for X": plain `data-write`
  HTML is the default.
- A **cell** is a place in a bento box, and the **tray** is the box the cells are cut into: how a
  page looks. The **bento** (`docs/bento/README.md`, built in `src/bento.ts`, `src/bento.css`)
  is how a page looks and moves: a box or a collection. A way of seeing, not features to have.

## The first questions an app asks

| To | Do |
|---|---|
| Show a document and let people change it | A compartment (`permit`, `shape`) and plain `data-write` controls. |
| Make a new document (a new plan, a room) | Ask who must be told it was made. Its maker alone (a plan of my own): a plain form posting to a route on `Example.routes` that writes its root as the server (`serverWrite`) and redirects there -- a story says it with `post(path, form)`. Everyone holding a list of them (a room in a lobby all read): add its root row through that document and open the id the answer names. Named by its reader (a session, chat's room): `implied: true` in `defineDoc`, made by its first write. Never through a document that tells people nobody asked. |
| Act before holding any document (sign in, join by a link) | A route on `Example.routes` answering a plain form: it writes the session with `serverWrite` and redirects ([*Signing people in*](example.md#signing-people-in)). The story posts the form, and its `seen` says who is told what the route wrote. |
| Keep a document the server works out (my home, who is here) | `registerMemory`, computed whole from the tables in `afterChange`, written as the difference with `serverWrite`, one run at a time ([*By kind*](compartment.md#by-kind)). Nobody writes it. |
| Refuse a write, saying why | `permit` or `shape`, with the story's words ([*Saying why a write was refused*](compartment.md#saying-why-a-write-was-refused-or-what-one-did)). |
| Let a person undo | Register the documents with `{ ledger: true }`: the kernel's Undo and Redo walk it ([*The ledger*](documents.md#the-ledger)). |
