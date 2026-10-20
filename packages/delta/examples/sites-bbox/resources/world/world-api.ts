/**
 * The world: `world:1`, the world and every site in it, to read and write. Every write to a
 * site goes through it; the box (box/box-api.ts) is told what changed for it.
 */
import type { Database } from "bun:sqlite";
import type { WsServer } from "@blueshed/delta/server";
import { createTables, registerDocs } from "@blueshed/delta/sqlite";
import { schema, worldDoc } from "../schema";

/** The tables made, the world seeded (`world:1`, Earth) and its document registered on `db`. */
export function worldApi(ws: WsServer, db: Database): void {
  createTables(db, schema);
  db.run("INSERT OR IGNORE INTO worlds (id, label) VALUES (1, 'Earth')");
  registerDocs(ws, db, schema, [worldDoc]);
}
