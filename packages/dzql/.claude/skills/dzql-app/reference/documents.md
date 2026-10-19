# Documents (`resources/<name>/<name>-api.ts`; in the examples, `delta.ts` and `documents/<thing>.ts`)

An app's documents are delta's: each resource's `<name>-api.ts` says its tables and its document,
registers it on the app's `delta` and reads it for the page (the examples keep these in `delta.ts`
and `documents/<thing>.ts`). Who may write them is [resource.md](resource.md).

```ts
// examples/chat/delta.ts
export const schema = defineSchema({
  sessions: { table: "chat_sessions", columns: { name: "text?", room: "text?", before: "text?" }, temporal: false },
  rooms: { table: "chat_rooms", columns: {}, temporal: false },
  messages: { table: "chat_messages", parent: "rooms", columns: { name: "text", text: "text", sent_at: "integer" }, temporal: false },
});
await migrate(db, await fromFolder(`${import.meta.dir}/migrations`), { app: "chat", schema }); // migrations.md
createTables(db, schema);
migrateSchema(db, schema);
export const delta = createLocal();
registerDocs(delta.server, db, schema, [
  defineDoc("session:", { root: "sessions", include: [], implied: true }),
  defineDoc("room:", { root: "rooms", include: ["messages"], implied: true }),
], [], { ledger: true });
registerMemory(delta.server, { prefix: "here:", empty: () => ({ people: {} as Record<string, true> }) }); // a memory document

// examples/chat/documents/session.ts
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

- Prefix tables with the app's name (`chat_`). Seed only into empty tables.
- At start-up `delta.ts` runs the app's migrations, then `createTables` (a missing table), then
  `migrateSchema` (a missing column). That is all a new table or column needs. A field renamed or
  dropped, or data moved, is a migration: [migrations.md](migrations.md). Never delete a database
  to change its shape: people keep real data in it.
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
