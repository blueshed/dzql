# Who may have a document: `owns`

From `src/cases/permissions.ts`, which SQLite, the JSON file and dzql's Postgres all answer: each
document says who may have it as a path in its definition, from its row to the person.

```ts
defineDoc("post:", { root: "posts", include: [], owns: "@author_id" });   // one's own
defineDoc("venue:", { root: "venues", include: [], owns: "@org_id->members[org_id=$]{active}.person_id" });   // a group's, through its memberships
defineDoc("venues:", { root: "venues", include: [], owns: "members[org_id=1]{active}.person_id" });   // a list, for some people
defineDoc("members:", { root: "members", include: [], owns: "AUTHENTICATED" });   // anyone signed in
registerDocs(ws, db, schema, docs, [], { ledger: true, auth });   // no owns beside them: each path is its document's
```

On Postgres the definitions are the same, each registered as `docTypeFromDef(def, pool, { auth })`,
and dzql compiles each path into SQL of its own (`postgres.md`).

**A document's name is the channel its writes are broadcast on.** Whoever has it open hears
every write through it, so who may have the name is who may see its rows.

## The shapes

- **One's own**: `@column`, the root row's column is the person.
- **A group's**: from the row, through the group's memberships, to the person. A document holds
  what its parent chain reaches, so **rows hang under what decides who sees them**: for a
  group's members to see what each of them has, put the members under the group and what they
  have under each member; the group's document roots at the group and includes both, and its
  path is `@id->members[groups_id=$].person_id`. A recompute document, or a function, written
  for a group's rows is the sign they hang in the wrong place.
- **Everything, for some people** (a committee, the staff): a list has no row to start from, so
  its path starts at a table with a filter: `people[committee=true].id`.
- **Anyone signed in**: `AUTHENTICATED`; nobody: `FALSE`.

## The grammar

`src/paths.ts`: `TRUE`, `FALSE`, `AUTHENTICATED`, `@field`, or hops
`collection[filters]{conditions}.field`, each joining the value before it on its `$` filter, else
its id; the last `.field` is compared with the person (`auth.asSqlArg`, else the identity's `id`).

- **Where it starts**: a single document's root row; a document with a scope, the name's values
  (`@org_id` is the name's, `venues-of:` in the cases). A path from `@field` whose name gives no
  row reaches nobody: a single document whose row is not there (an implied one included).
- **Checked at registration** against the schema: a collection, a column or an integer key it
  cannot follow throws, naming the document and the path.
- **A row is never handed away**: a write through it that would leave the path not reaching the
  writer (`author_id` replaced with another's) is refused, **403**, and changes nothing. Removing
  the row is not handing it away.

## A function, where no path can say it

`owns: (identity, docName) => boolean | Promise<boolean>`, in `registerDocs`' or
`docTypeFromDef`'s options, or a custom document's definition (`src/cases/owns.ts`). Only where
the tables cannot say who: a name that is no row (a session token), or an answer from outside.
Nothing checks it against the schema, and dzql cannot compile it.

## Default-deny, with `auth`, on every backend

Every document says `owns` (a path, or a function) or `shared: true`; the error names the
prefix and says what to add. Without `auth`, `owns` or `shared` is refused too: it would claim
a guard nothing asks.

## When it is asked

Before open, delta, open_at, history, undo and redo: a no is **404**. Then again **before each
change is told**, once per identity: a socket refused then is let go and told
`{ doc, error }`, and its client lets its copy go (`doc.data` null).

## Gotchas

- **`shared: true`** (a team board, a public room) means every signed-in identity hears every
  write. Never on rows some readers should not see: they would see them arrive.
- `owns` decides the name; it does not filter rows. A document holds what its root, scope and
  parent chain reach: shape it to hold only what its owners may see.
