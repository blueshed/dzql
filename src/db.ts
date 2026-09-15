import { Database } from "bun:sqlite";
import { migrate } from "./migrate";

export const db = new Database(process.env.DB_PATH ?? "db.sqlite");

// One transaction, one sync: WAL appends to a log and syncs once on commit, instead of
// rewriting pages through a rollback journal, and readers never wait on a writer. An in-memory
// database answers this pragma with "memory" and is otherwise unchanged (change-request.md item
// 11); the two files WAL adds beside db.sqlite are already in .gitignore.
db.exec("PRAGMA journal_mode = WAL");

// `legacy`: a dev database from before 0.21.0 recorded this file without a
// namespace; adopt it rather than fail on a second CREATE TABLE.
migrate(db, process.env.MIGRATIONS_DIR ?? `${import.meta.dir}/../migrations`, "eta", {
  "0001_ledger.sql": "0001_ledger.sql",
});
