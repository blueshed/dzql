# Documents (`resources/<name>/<name>-api.ts`, over the tables `store.ts` makes)

An app's documents are delta's: each resource's `<name>-api.ts` says its document, registers it
on the app's `delta` (`register`, from `store.ts`) and reads it for the page. `store.ts` says the
tables once: the database makes them before any document is registered over them, and one table
may be held by several documents. Who may write them is [resource.md](resource.md).

```ts
// examples/chat/store.ts
export const schema = defineSchema({
  sessions: { table: "chat_sessions", columns: { name: "text?", room: "text?", before: "integer?", cookie: "text?" }, temporal: false }, // a visit is no history
  messages: { table: "chat_messages", columns: { room: "text", name: "text", text: "text", sent_at: "integer" } }, // keeps its history, delta's default
});
export const migrating = await openTables(schema, "chat", `${import.meta.dir}/migrations`); // dzql/rendering/db; migrations.md
export const delta = createLocal();
export const register = (docs: DocDef[], { ledger = true } = {}) => registerDocs(delta.server, db, schema, docs, [], { ledger });

// examples/chat/resources/here/here-api.ts: a memory document
registerMemory(delta.server, { prefix: "here:", empty: () => ({ people: {} as Record<string, true> }) });

// examples/chat/resources/session/session-api.ts
register([defineDoc("session:", { root: "sessions", include: [], implied: true, columns: { sessions: ["name", "room", "before"] } })]);
export function read(id: string): SessionDocument {
  const doc = readDoc<{ sessions?: Partial<SessionDocument> }>(`session:${id}`);
  return { name: doc?.sessions?.name ?? null, room: doc?.sessions?.room ?? null, before: doc?.sessions?.before ?? null };
}
```

A document is a root row and the collections it includes, maps of rows by id; two documents may
include the same rows, and a write reaches both. `defineSchema` and `defineDoc` are delta's: its `delta-doc` skill
(`node_modules/@blueshed/delta/.claude/skills/delta-doc/`). `read<T>(name)` (`src/rendering/documents.ts`) is
synchronous; it throws `Pending` when the document is not held yet, and the kernel loads it and draws
again. Put the pure rules beside it (`shape(doc, ops)`), tested without a server.

Working: [examples/chat](https://github.com/blueshed/dzql/blob/main/packages/dzql/examples/chat/store.ts), the tables said once (`store.ts`), a memory
document (`resources/here/here-api.ts`) and a session read for the page
(`resources/session/session-api.ts`); [examples/cafe](https://github.com/blueshed/dzql/blob/main/packages/dzql/examples/cafe/resources/floor/floor-api.ts), a
ref's surrogate (`orderOf`, `resources/floor/floor-api.ts`);
[examples/leave](https://github.com/blueshed/dzql/blob/main/packages/dzql/examples/leave/resources/team/team.ts), the draft that follows an ask and its Undo
(`afterWrite`, `afterWalk`, `resources/team/team.ts`).

- Prefix tables with the app's name (`chat_`). Seed only into empty tables.
- At start-up `store.ts` makes its tables (on SQLite `openTables`, `dzql/rendering/db`; on Postgres
  `openStore`): the app's migrations,
  then a missing table (delta's `createTables`), then a missing column (`migrateSchema`). That is all a new table or column needs. A field renamed or
  dropped, or data moved, is a migration: [migrations.md](migrations.md). Never delete a database
  to change its shape: people keep real data in it.
- `openStore({ schema })` takes one schema, or several (`[order.schema, message.schema]`: each
  resource's own, in its `-api.ts`), kept as one; a table two of them declare is refused.
- A row that names a row of another document (a **ref**, `dish: menu:/items`, kept as `dish_id`)
  keeps its **surrogate** beside the key when a story can remove what it names: what it shows of
  it, copied as it is written (`dish_name`, `dish_price`). Show the named row while it stands, and
  the copy once it is gone; whoever holds the order holds the menu too. The cafe's `orderOf`
  (`examples/cafe/resources/floor/floor-api.ts`):

  ```ts
  const dish = items.find((i) => i.id === String(o.dish_id));
  return { ..., item: dish?.name ?? o.dish_name ?? "", price: dish?.price ?? o.dish_price ?? 0 };
  ```
- Address a row by its id, never its position: others write between a write and its undo. Make ids
  in `shape` (`Bun.randomUUIDv7()` is time-ordered). Ids are text on the wire: compare them as text.
- A value a column cannot default in SQL (an object) goes in the schema's `default`; treat null as
  empty all the same.
- `serverWrite(doc, ops)` is the server's own write: no person, never undone. Its paths are the
  document's own, `under` not added (`/sessions/person_id`, not `/person_id`).
- Tests and scripts write as a person would, through the same `shape`.
- A page reads through `read()`. Go to the tables only for what no page reads as a document: what a
  memory document is computed from, a credential, a blob, a rule `shape` checks across rows.
- A session that is not history goes in a registry without `{ ledger: true }`, and its resource
  says `ledger: false`, so one left off the ledger by mistake is caught (leave's).
- Read a long document in windows by a keyset, never an offset (chat's `/before`); the page still
  reads it whole, so it is told every change. A document whose rows only pile up (every bill ever)
  holds only what is open, or today's: [scope.md](scope.md).

## The ledger

Undo is delta's ledger, along a cursor that is the session. Register with `{ ledger: true }`.

- The ledger takes `remove /latest` (undo) and `add /latest` (redo); and `remove /<change>`,
  `add /<change>` for one change by the handle its echo carried ([wire.md](wire.md)), so a person and
  an assistant in one session each undo their own. A handle not given to this session, or undone
  already, or not undone, is refused.
- One Undo reverses one write to one document: keep what changes together in one document. Where it
  cannot be, the hooks say what follows (leave's draft: dropped in `afterWrite`, given back in
  `afterWalk`).
- Undoing a row's making once rows sit under it is a conflict. An undo is checked first by
  `permitUndo` ([refusal.md](refusal.md#undo-is-checked-before-it-runs)).
