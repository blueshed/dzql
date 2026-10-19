// Made by `delta migrations make` from the definitions: what they say beyond the migrations before it.
import { createTable } from "@blueshed/delta/migrations";

export const changes = [
  createTable("tables", { columns: { name: { type: "text", nullable: true }, seated: { type: "boolean", nullable: true } }, temporal: true }),
  createTable("invoices", { columns: { paid: { type: "boolean", nullable: true } }, parent: { collection: "tables", fk: "tables_id" }, temporal: true }),
  createTable("orders", { columns: { item: { type: "text", nullable: true }, price: { type: "real", nullable: true }, status: { type: "text", nullable: true } }, parent: { collection: "invoices", fk: "invoices_id" }, temporal: true }),
  createTable("items", { columns: { name: { type: "text", nullable: true }, price: { type: "real", nullable: true } }, temporal: true }),
  createTable("visits", { columns: { table: { type: "text", nullable: true } }, temporal: true }),
];
