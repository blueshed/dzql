# lists

Shared lists, for people who sign in. To shop together you need the list in front of you, and
who else is on it: that is one document, `list:1`, a list with its members and its items. Ann
and Bo are on Shopping; Cy is not, so Cy cannot open it, nor even learn it is there. Each
person signs in by a link, with no password, and sees only the lists they are on. Undo takes
back your own last change, never anyone else's: when Ann undoes, Bo's item stays, and when Bo
has ticked the item Ann added, her undo of it is refused and changes nothing.

It shows, working, what the delta-doc skill's reference pages teach:

| Rule | Where | Reference |
|---|---|---|
| Sign in by link: a link is someone, its tap a session cookie the socket is signed in by | `resources/people/people-api.ts` (`linkAuth`, `sqliteLinkStore`), `app.tsx` (`takeLink`, `onConnect`) | [auth.md](../../.claude/skills/delta-doc/reference/auth.md) |
| Who may have a document is a path in its definition (`owns`) | `resources/lists/lists-api.ts`: `list:` through its members, `mine:` one's own | [ownership.md](../../.claude/skills/delta-doc/reference/ownership.md), [paths.md](../../.claude/skills/delta-doc/reference/paths.md) |
| A document for anyone signed in says so (`shared: true`) | `people:` in `resources/people/people-api.ts` | [ownership.md](../../.claude/skills/delta-doc/reference/ownership.md) |
| Undo with two people: each walks back their own; a walk with someone else's change in the way is refused | `{ ledger: true, who }` in `lists-api.ts`, Undo and Redo in `resources/lists/lists-view.tsx` | [ledger.md](../../.claude/skills/delta-doc/reference/ledger.md) |
| A migration on a database that holds data: a rename that keeps every row, run at start-up, undo fenced across it | `resources/lists/migrations/` | [migrations.md](../../.claude/skills/delta-doc/reference/migrations.md) |

## What is here

The app is its routes and its resources, as every app is (paintbrush's README, *Routes,
resources and documents*):

```
routes.ts              the app: the link sign-in's routes, the socket signed in by its cookie, the page
index.html, index.css  the page
app.tsx                a link taken, the socket every document rides, and each resource's view
resources/people/
  people-api.ts        people:, everyone (shared); the link sign-in; Ann, Bo and Cy on a new database
  people.ts            who this page is (me), everyone, a person's link
  people-view.tsx      you and Sign out, "Who are you?", everyone with their link
  migrations/          the people table's history
resources/lists/
  lists-api.ts         list:<id> and mine:<person>, who owns each, on the ledger; three lists on a new database
  lists.ts             the handles
  lists-view.tsx       Undo and Redo (delta's undo and redo), and each list you are on
  migrations/          the lists' history: 001-lists, then 002-title, a rename
```

## Run it

```sh
bun --hot examples/lists/routes.ts              # port 3100, kept in examples/lists/lists.db
```

Open <http://localhost:3100>. In development (`bun --hot`, or `NODE_ENV` development or test; not a
bare `bun examples/lists/routes.ts`) the page asks "Who are you?": pick Ann. In another
window (a private one, so it has its own cookie) pick Bo. Both see Shopping; only Ann sees
Holiday. Add an item in each, then press Undo in Ann's: her item goes from both windows, Bo's
stays. Add another in Ann's, tick it in Bo's, and press Undo in Ann's: it says someone has
changed it since, and leaves it; Undo in Bo's takes back his tick.

In production nobody is listed. The first person's link comes from a command on the server, and
"their link" on the page makes anyone else's (the app lets anyone here send anyone's, `mayLink`;
unsaid, a person sends only their own); each is used once:

```sh
bunx @blueshed/delta link examples/lists/lists.db 1 --origin http://localhost:3100
```

The pieces, from the files:

```ts
// people-api.ts: the link sign-in, and people: for anyone signed in
const auth = linkAuth<Person>({ store: sqliteLinkStore(db), personOf, people, mayLink: () => true });
wireAuth(ws, auth);
registerDocs(ws, db, schema, docs, [], { auth, shared: true });

// lists-api.ts: a list for its members, mine: for one person; every write on the ledger
defineDoc("list:", { root: "lists", include: ["members", "items"], owns: "@id->members[lists_id=$].person" }),
defineDoc("mine:", { root: "members", include: [], scope: { person: ":id" }, owns: "@person" }),
registerDocs<Person>(ws, db, schema, docs, [], { auth, ledger: true, who: (p) => String(p.id) });

// routes.ts: the socket signed in by the session cookie
serve({ ws, routes: { ...auth.routes, [ws.path]: upgradeWithAuth(ws, auth), "/": index } });

// app.tsx: who the socket is on every connect; its clientId, with the person, the cursor undo walks
provide(WS, connectWs("/ws", { clientId: crypto.randomUUID(), onConnect: whoAmI }));

// lists-view.tsx: undo is the ledger's; its change comes back through the documents, and it answers
// the walk, a conflict (someone has changed it since) or null (nothing to walk)
const done = await undo();   // import { undo, redo, type Walk } from "@blueshed/delta/client"
```

## The upgrade: a rename that keeps every row

Version one called an item's words its `text`; this version calls them its `title`, as a list's
are. The schema says `title`, and `make` wrote what it says beyond the history:

```sh
bunx @blueshed/delta migrations make examples/lists/resources/lists/lists-api.ts --dir examples/lists/resources/lists/migrations --name title
```

A column gone and one new may be a rename, so `make` wrote a drop and an add and said so; one is
the other renamed, so `002-title.ts` is a `renameColumn`, which keeps every value (a drop loses
them). At start-up `migrate` runs what a database has not: a new one runs the whole history, one
version one left runs `002-title` alone. Undo stops at the migration: a change made before it
names a column that has moved, so it shows in `history` as not undoable, and undo walks past
nothing.

## How it is tested

`tests/examples.test.ts` runs `routes.ts` as above, on a database of its own:

- nobody is refused (401); Ann's link from the command signs her in, once; a link she makes signs
  in Bo; everyone signed in opens `people:`; Bo cannot open Ann's `mine:1`, and Cy cannot open or
  write Shopping (404);
- two browsers, Ann and Bo: each sees only their lists; Ann adds milk, Bo eggs, Ann undoes, and
  both show eggs alone;
- on the wire: Ann's undo and redo walk her milk alone; Bo ticks Ann's bread and her undo of it
  is refused, changing nothing; Bo's undo is his tick;
- a database as version one left it (`001-lists`, its rows, a write on its ledger) is started on:
  every item is there with its `title`, the earlier write is not undoable, a new one is, and
  `migrations make` has nothing to make.

## Left out

- Making a list, and adding someone to one: the seed makes three. Adding someone is an `add
  /members/-` through the list, and their `mine:` is told.
- A cursor across page loads: it lasts the page's life (a reload starts a new one).
