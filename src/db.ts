import { Database } from "bun:sqlite";
import { migrate } from "./migrate";

export const db = new Database(process.env.DB_PATH ?? "db.sqlite");

// `legacy`: a dev database from before 0.21.0 recorded this file without a
// namespace; adopt it rather than fail on a second CREATE TABLE.
migrate(db, process.env.MIGRATIONS_DIR ?? `${import.meta.dir}/../migrations`, "eta", {
  "0001_ledger.sql": "0001_ledger.sql",
});
