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
synchronous; a document not held yet reads as nothing while the page is drawn, and the kernel loads
every one the drawing read together and draws again (`settled`; outside it, `read` throws `Pending`).
So read what a page needs before using it, and make nothing of a document that is not there yet: that
drawing is never sent. Put the pure rules beside it (`shape(doc, ops)`), tested without a server.

Working: [examples/chat](https://github.com/blueshed/dzql/blob/main/packages/dzql/examples/chat/store.ts), the tables said once (`store.ts`), a memory
document (`resources/here/here-api.ts`) and a session read for the page
(`resources/session/session-api.ts`); [examples/cafe](https://github.com/blueshed/dzql/blob/main/packages/dzql/examples/cafe/resources/kitchen/kitchen-api.ts), a
ref's surrogate (`orderOf`, `resources/kitchen/kitchen-api.ts`) and a seed in `prepare` (`store.ts`);
[examples/leave](https://github.com/blueshed/dzql/blob/main/packages/dzql/examples/leave/resources/team/team.ts), the draft that follows an ask and its Undo
(`afterWrite`, `afterWalk`, `resources/team/team.ts`).

- Prefix tables with the app's name (`chat_`).
- Seed in `openStore`'s `prepare`, which runs at each open, once the tables are there and before
  any document is served; only into empty tables. `importTables` (`dzql/postgres`) puts rows in as
  they are, by the schema's keys, ids kept, and sets each sequence past them. The cafe's
  (`examples/cafe/store.ts`):

  ```ts
  export const store = openStore({
    schema,
    migrations: { dir: `${import.meta.dir}/model/migrations`, app: "cafe-model", schema: modelSchema },
    prepare: async (pool) => {
      if ((await pool.query(`SELECT 1 FROM "tables" LIMIT 1`)).rows.length === 0)
        await importTables(pool, schema, { tables: { tables: [{ id: 1, name: "Table 1", seated: false }], staff: [{ id: 1, name: "Mo", role: "manager" }] } });
    },
  });
  ```
- At start-up `store.ts` makes its tables (on SQLite `openTables`, `dzql/rendering/db`; on Postgres
  `openStore`): the app's migrations,
  then a missing table (delta's `createTables`), then a missing column (`migrateSchema`). That is all a new table or column needs. A field renamed or
  dropped, or data moved, is a migration: [migrations.md](migrations.md). Never delete a database
  to change its shape: people keep real data in it.
- The tables are said in `store.ts`, the app's one schema: that is the default, and the starter's
  and the cafe's. `openStore({ schema })` also takes several (`[order.schema, message.schema]`),
  kept as one, a table two of them declare refused: only for an app that already keeps each
  resource's tables in its `-api.ts`. Such an app keeps a history per resource too:
  `migrations: [{ app: "order", list, schema: order.schema }, { app: "menu", ... }]`, each its own
  `app`, run in the order given; `imported: true` on one whose rows come from the store before,
  migrated there, so its `up`s never run on the new database.
- A resource's custom documents (`defineCustomDoc`) are registered beside its own:
  `store.register(docs, { custom: [summary] })`. What one works out past the documents' paths it
  reads as the tables' owner, `asOwner(pool, (db) => db.query(...))` (`dzql/postgres`), never by
  raising dzql's settings itself. `openStore`'s `auth` is for a page that is delta's client; a page
  dzql draws signs in by its session ([signin.md](signin.md)).
- A page dzql draws reads each document once, as no one, so a document's `owns` and the
  row-level security beneath it never meet a person here: what keeps a person's data from another
  is each resource's `resolveDoc` and `permit`, and how its documents are cut (each holds only what
  its people may read). dzql's `docs/postgres/rls.md`, *Where it applies*.
- A row that names a row of another document (a **ref**, `dish: menu:/items`, kept as `dish_id`)
  keeps its **surrogate** beside the key when a story can remove what it names: what it shows of
  it, copied as it is written (`dish_name`, `dish_price`). Show the named row while it stands, and
  the copy once it is gone; whoever holds the order holds the menu too. The cafe's `orderOf`
  (`examples/cafe/resources/kitchen/kitchen-api.ts`):

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
- Outside any page (a command, a job, a seed once the server is up), the server writes through the
  store: `store.owner`, the server itself, in this process. `await store.owner.call("delta", { doc:
  "floor:", cursor: "nightly", ops: [{ op: "replace", path: "/tables/1/seated", value: false }] })`
  is the document's write, as a page's is: its rule asked, on the ledger along the cursor it names,
  and told to every page holding it; `open` reads. With `openStore`'s `auth` it passes no gate and
  reads and writes as the tables' owner. Never `delta_apply` called by hand.
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
