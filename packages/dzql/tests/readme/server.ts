import { createWs } from "@blueshed/delta/server";
import { run, serve } from "@blueshed/delta/serve";
import { openStore } from "dzql/postgres";
import { docs, schema } from "./types";

// The same definitions, compiled to Postgres: every write is a stored function, and every server
// on the database hears every change. PGlite runs Postgres in this process (in PGLITE_DIR, else in
// memory); DATABASE_URL names a Postgres server in its place.
const ws = createWs();
const store = await openStore({ schema, ws });
store.register(docs);
await store.open();
await run(() => serve({ ws, routes: {}, close: [store.close] }));
