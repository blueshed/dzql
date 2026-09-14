import { Database } from "bun:sqlite";
import { migrate } from "./migrate";

export const db = new Database(process.env.DB_PATH ?? "db.sqlite");

migrate(db, process.env.MIGRATIONS_DIR ?? `${import.meta.dir}/../migrations`);
