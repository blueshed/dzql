# Words, and the first questions an app asks

The pieces of an app by name, and what to reach for first. The path to work in is [SKILL.md](../SKILL.md).

```ts
// examples/cafe/routes.ts: the whole app, by its pieces
export const app: Example = {
  name: "cafe",
  index: homepage,                             // index.html: the page's shell
  delta,                                       // its documents (store.ts; each resource's -api.ts registers one)
  resources: [visit, floor, menu, table, door], // one per document type, the session first
  render,                                      // the page: render(sessionId, address), the whole page as HTML
  active: (sessionId) => visitOf(sessionId).role !== null,
  address: { doc: "visit", path: "/page" },    // the write that moves a tab: its URL is where it stands
  routes: { "/in/:token": links.route as never, "/scan": scan },
  session: sessions.of,                        // a cookie's session
};
```

## Words

- A **resource** looks after one type of document: which one a page is on, who may write to it,
  what a write becomes. It has no place on the page. → [resource.md](resource.md)
- The **page** is the app's one `render(sessionId, address)`: which screen, reading whichever
  documents it must. Much HTML goes in files of its own (the wedding's `views/`). → [page.md](page.md)
- The **session** is each visitor's own document -- who you are and what is yours -- and a resource
  like any other; list it first. Keep in it only what the stories need. → [bento.md](bento.md)
- A **tab** is one page open: where it stands is its **address**, its own and its URL, never the
  session's -- a page and its open drawer are one address, not six fields. → [bento.md](bento.md#where-you-are-the-address)
- An **applet** is only for a piece of the page whose browser state a redraw would destroy (a drag
  halfway through, a sparkline's history). It is not "the view for X": plain `data-write` HTML is the
  default. → [applets.md](applets.md)
- A **cell** is a place in a bento box; the **tray** is the box the cells are cut into. The
  **bento** (`docs/bento/README.md`) is how a page looks and moves: a box or a collection.

## The first questions an app asks

| To | Do |
|---|---|
| Show a document and let people change it | A resource (`permit`, `shape`) and plain `data-write` controls ([controls.md](controls.md)). |
| Make a new document | Ask who must be told it was made. Its maker alone (a plan of my own): a plain form posting to a route that writes its root with `serverWrite` and redirects there ([signin.md](signin.md)). Everyone holding a list of them (a room in a lobby): add its root row through that document and open the id the answer names. Named by its reader (a session, chat's room): `implied: true` in `defineDoc`, made by its first write. Never through a document that tells people nobody asked. |
| Act before holding any document (sign in, join by a link) | A route answering a plain form, writing the session with `serverWrite` and redirecting ([signin.md](signin.md)). |
| Keep a document the server works out (who is here) | A memory document (`registerMemory`; its resource's `kind: "memory"`), computed whole in `afterChange`, written as the difference ([resource.md](resource.md#after-a-write)). Nobody writes it. |
| Refuse a write, saying why | `throw refuse(...)` in `permit` or `shape` ([refusal.md](refusal.md)). |
| Let a person undo | Register the documents with `{ ledger: true }` ([documents.md](documents.md#the-ledger)). |
