import { Database } from "bun:sqlite";

export const db = new Database(process.env.DB_PATH ?? "db.sqlite");

// One transaction, one sync: WAL appends to a log and syncs once on commit, instead of
// rewriting pages through a rollback journal, and readers never wait on a writer. An in-memory
// database answers this pragma with "memory" and is otherwise unchanged (change-request.md item
// 11); the two files WAL adds beside db.sqlite are already in .gitignore.
db.exec("PRAGMA journal_mode = WAL");
