/**
 * sites-bbox on Postgres: the same documents as server.ts, the rows in the
 * database. Every process serving it hears every write (LISTEN/NOTIFY), so a
 * box open on one is told of a site moved through another.
 *
 *   PORT=3100 bun examples/sites-bbox/server-pg.ts
 *
 * PG_URL names the database (the compose one on 5433 by default).
 */
import { Pool } from "pg";
import {
  applyFramework, applySql, createDocListener, defineCustomDoc, docTypeFromDef, generateSql,
} from "../../../src/postgres";
import { createWs } from "@blueshed/delta/server";
import { serve } from "@blueshed/delta/serve";
import { schema, worldDoc, parse, matches, type BBox } from "./schema";

const sitesInBbox = defineCustomDoc<BBox>("sites-in-bbox:", {
  watch: ["sites"],
  parse,
  query: async (pool: Pool, c) => {
    const { rows } = await pool.query(
      "SELECT to_jsonb(s) AS site FROM sites s WHERE lng BETWEEN $1 AND $2 AND lat BETWEEN $3 AND $4",
      [c.minLng, c.maxLng, c.minLat, c.maxLat],
    );
    return { sites: rows.map((r) => r.site) };   // as jsonb, so ids are numbers, as in the world's rows
  },
  matches,
});

const pool = new Pool({ connectionString: process.env.PG_URL ?? process.env.DATABASE_URL ?? "postgres://dzql_test:dzql_test@localhost:5433/dzql_test" });
await applyFramework(pool);
await applySql(pool, generateSql(schema, [worldDoc]));
await pool.query("INSERT INTO worlds (label) SELECT 'Earth' WHERE NOT EXISTS (SELECT 1 FROM worlds)");
const { rows: [world] } = await pool.query("SELECT min(id)::int AS id FROM worlds");

const ws = createWs();
const listener = await createDocListener(ws, pool, { types: [docTypeFromDef(worldDoc, pool)], custom: [sitesInBbox] });

const { server } = serve({ ws, routes: {} }, { port: Number(process.env.PORT ?? 0) });

console.log(`sites-bbox (Postgres) on ws://localhost:${server.port}${ws.path}`);
console.log(`  open "world:${world.id}" to read and write every site`);
console.log(`  open "sites-in-bbox:0,0,50,50" for the sites in that box`);

const shutdown = async () => {
  await listener.destroy();
  await pool.end();
  server.stop(true);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
