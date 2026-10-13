import { Database } from "bun:sqlite";

export const db = new Database(process.env.DB_PATH ?? "db.sqlite");

// WAL: one sync a commit, and readers never wait on a writer (an in-memory database ignores it).
db.exec("PRAGMA journal_mode = WAL");
