/** Order: the catalogue, each order, and the kitchen, kept in SQLite (app.db in the data folder). */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import type { WsServer } from "@blueshed/delta/server";
import { exportTables } from "@blueshed/delta/json";
import { defineDoc, defineSchema, importTables, migrate, registerDocs } from "@blueshed/delta/sqlite";
import { migrations } from "./migrations";

export type Item = { id: number; name: string; price: number };
export type Line = { id: number; item: number };
export type Catalogue = { items: Record<string, Item> };
export type Order = { lines: Record<string, Line> };
/** What `kitchen:` holds: every order, and every line, each naming its order. */
export type Kitchen = { orders: Record<string, { id: number }>; lines: Record<string, Line & { orders_id: number }> };

export const schema = defineSchema({
  items: { columns: { name: "text", price: "real" } },
  orders: { columns: {} },
  lines: { parent: "orders", columns: { item: "integer" } },
});

export const docs = [
  defineDoc("catalogue:", { root: "items", include: [] }), // every item
  defineDoc("order:", { root: "orders", include: ["lines"], implied: true }), // order:1 is order 1 and its lines
  defineDoc("kitchen:", { root: "orders", include: ["lines"] }), // every order, and every line
];

export const catalogue = { tables: { items: [{ id: 1, name: "Tea", price: 2.5 }, { id: 2, name: "Cake", price: 3 }] } };

export async function orderDocs(ws: WsServer, dataDir: string) {
  mkdirSync(dataDir, { recursive: true }); // SQLite makes the file, not its folder
  const db = new Database(`${dataDir}/app.db`, { create: true });
  // the history makes the tables: each migration once, in order (a new database runs them all)
  await migrate(db, migrations, { app: "order", schema });
  // a new database takes the JSON file's rows, every order people made, or starts with the catalogue
  const file = `${dataDir}/order.json`;
  if (!db.query("SELECT 1 FROM items").get()) importTables(db, schema, existsSync(file) ? exportTables(file, schema) : catalogue);
  registerDocs(ws, db, schema, docs, [], { ledger: true }); // undo, redo and history
}
