// Made by `delta migrations make` from the definitions: what they say beyond the migrations before it.
import { createTable } from "@blueshed/delta/migrations";

export const changes = [
  createTable("items", { columns: { name: { type: "text" }, price: { type: "real" } }, temporal: true }),
  createTable("orders", { columns: {}, temporal: true }),
  createTable("lines", { columns: { item: { type: "integer" } }, parent: { collection: "orders", fk: "orders_id" }, temporal: true }),
];
