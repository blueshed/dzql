import type { Database } from "bun:sqlite";
import { dropColumn, renameColumn } from "@blueshed/delta/sqlite";

// Every row is numbered. A login was found by its id, its email, and a token by its id, its hash:
// each keeps what it was found by in a column of its own, and takes a number. Who a row is about is
// a person's number, not its text.
export function up(db: Database): void {
  db.run("ALTER TABLE leave_logins ADD COLUMN email TEXT");
  db.run("UPDATE leave_logins SET email = id, id = rowid");
  db.run("ALTER TABLE leave_tokens ADD COLUMN hash TEXT");
  db.run("UPDATE leave_tokens SET hash = id, id = rowid");
  for (const [table, column] of [["leave_requests", "person_id"], ["leave_requests", "answered_by"], ["leave_sessions", "person_id"], ["leave_logins", "person_id"], ["leave_tokens", "person_id"]] as const) {
    renameColumn(db, table, column, `${column}_text`);
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} INTEGER`);
    db.run(`UPDATE ${table} SET ${column} = CAST(${column}_text AS INTEGER) WHERE ${column}_text IS NOT NULL`);
    dropColumn(db, table, `${column}_text`);
  }
}
