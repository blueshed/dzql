/**
 * The box: `sites-in-bbox:<minLng>,<minLat>,<maxLng>,<maxLat>`, the sites inside it, to read.
 * A custom document over the world's rows: a site written through the world that comes into
 * the box is added, one that moves within it is told the fields that changed, one that leaves
 * is removed.
 */
import type { Database } from "bun:sqlite";
import type { WsServer } from "@blueshed/delta/server";
import { defineCustomDoc, registerDocs } from "@blueshed/delta/sqlite";
import { schema, parse, matches, type BBox } from "../schema";

const sitesInBbox = defineCustomDoc<BBox>("sites-in-bbox:", {
  watch: ["sites"],
  parse,
  // What the box holds when it is opened; after that, `matches` says which sites come and go.
  query: (db, c) => ({
    sites: db.query("SELECT * FROM sites WHERE lng BETWEEN ? AND ? AND lat BETWEEN ? AND ?")
      .all(c.minLng, c.maxLng, c.minLat, c.maxLat),
  }),
  matches,
});

/** The box registered on `db`, beside the world's document: a write through one is told to the other. */
export function boxApi(ws: WsServer, db: Database): void {
  registerDocs(ws, db, schema, [], [sitesInBbox]);
}
