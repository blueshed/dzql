import { defineSchema, openStore } from "dzql/postgres";

// The store: Postgres, each document's reads and writes compiled from its definitions (dzql's
// `openStore`): a server at DATABASE_URL, else PGlite in this process, kept in the data folder's
// pg/ (`DATA_PATH`, else data/; in memory for `bun test`: `DATA_PATH=:memory:`). PGlite is for
// development and the tests; production sets DATABASE_URL (the dzql-app skill's reference/deploy.md).
// Once the stories are modelled, `dzql model` makes ../model/: its migrations run first, and its
// `tables` go in the schema with the app's own beside them (`defineSchema({ ...tables, ... })`).
// Each resource registers its documents (`register`, in `resources/<name>/<name>-api.ts`); the
// server opens the store as it starts (the app's `store`, ./routes.ts) and closes it as it stops.
// dzql's examples/cafe is a whole app on it.

/** The tables: the model's, and the app's own beside them. None yet. */
export const schema = defineSchema({});

export const store = openStore({ schema, migrations: { dir: `${import.meta.dir}/../model/migrations` } });

export const { pool, delta, register } = store;
