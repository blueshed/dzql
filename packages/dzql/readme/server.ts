import { createWs } from "@blueshed/delta/server";
import { run, serve } from "@blueshed/delta/serve";
import { applyFramework, applySql, createDocListener, docTypeFromDef, generateSql } from "dzql/postgres";
import { openPglite } from "dzql/pglite";
import { docs, schema } from "./model";

// The same definitions, compiled to Postgres: every write is a stored function, and every server
// on the database hears every change. PGlite runs Postgres in this process; on a Postgres server,
// `new Pool({ connectionString })` from `pg` takes its place.
const pool = await openPglite(process.env.PGLITE_DIR);
await applyFramework(pool);
await applySql(pool, generateSql(schema, docs));

const ws = createWs();
const listener = await createDocListener(ws, pool, { types: docs.map((def) => docTypeFromDef(def, pool)) });
await run(() => serve({ ws, routes: {}, close: [() => listener.destroy(), () => pool.end()] }));
