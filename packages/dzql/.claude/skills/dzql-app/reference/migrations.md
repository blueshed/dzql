# Migrations (`migrations/NNN-name.ts`)

People keep real data in an app. A new table or column the schema adds by itself; a field renamed
or dropped, or data moved, is a migration, or the data is lost.

```ts
// examples/leave/upgrade/001-reason.ts: a request says why; every one asked before was a holiday
export function up(db: Database): void {
  db.run("ALTER TABLE leave_requests ADD COLUMN reason TEXT");
  db.run("UPDATE leave_requests SET reason = 'holiday'");
}

// 002-person.ts: `asked_by` is `person_id` now
export function up(db: Database) { renameColumn(db, "leave_requests", "asked_by", "person_id"); }

// 003-days.ts: the calendar works the days out; the count kept goes
export function up(db: Database) { dropColumn(db, "leave_requests", "days"); }
```

`examples/leave/upgrade.test.ts` runs these on a database leave's previous version left, then
leave's stories on it. The helpers are delta's (`@blueshed/delta/sqlite`: `renameColumn`,
`dropColumn`, `renameTable`).

- `delta.ts` runs them first, then the schema: `await migrate(db, await fromFolder(...), { app,
  schema })`, then `createTables`, then `migrateSchema`. Change the schema to its new shape in the
  same commit.
- `app` is whose they are, recorded with each id: apps sharing a database each run only their own.
  `schema` says whether the app is new here (its tables not there), and which ledger entries a
  migration fences. Without them, another app's tables make it not new, and every app's undo is fenced.
- A file is `NNN-name.ts` exporting `up(db)`; its name is its id, recorded in `delta_migrations`.
  They run in name order, once each, each in its own transaction: one that throws is rolled back
  and stops start-up.
- A new database runs none: the schema makes it as they would leave it, and each is recorded.
- Never edit, rename or delete a migration that has run anywhere: write another.
- A column the new schema declares, add in the migration that fills it: migrations run before
  `migrateSchema`.
- Move what must be kept before you drop it: rename, or copy into the new place, then drop.
- Undo never reaches back across a migration: delta fences the ledger, and every entry before it
  is no longer undoable (history still shows them).
- `bunx delta migrate --status` says what has run here and what would.
