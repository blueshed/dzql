// Made by `delta migrations make` from the definitions: what they say beyond the migrations before it.
import { createTable } from "@blueshed/delta/migrations";

export const changes = [
  createTable("tables", { columns: { name: { type: "text", nullable: true }, seated: { type: "boolean", nullable: true } }, temporal: false }),
  createTable("invoices", { columns: { paid: { type: "boolean", nullable: true } }, parent: { collection: "tables", fk: "tables_id" }, temporal: false }),
  createTable("orders", { columns: { item: { type: "text", nullable: true }, price: { type: "real", nullable: true }, status: { type: "text", nullable: true } }, parent: { collection: "invoices", fk: "invoices_id" }, temporal: false }),
  createTable("items", { columns: { name: { type: "text", nullable: true }, price: { type: "real", nullable: true } }, temporal: false }),
  createTable("visits", { columns: { table: { type: "text", nullable: true } }, temporal: false }),
];
