// Made by `delta migrations make` from the definitions: what they say beyond the migrations before it.
import { createTable } from "@blueshed/delta/migrations";

export const changes = [
  createTable("lists", { columns: { title: { type: "text" } }, temporal: false }),
  createTable("members", { columns: { person: { type: "integer" } }, parent: { collection: "lists", fk: "lists_id" }, temporal: false }),
  createTable("items", { columns: { text: { type: "text" }, done: { type: "boolean", default: false } }, parent: { collection: "lists", fk: "lists_id" }, temporal: false }),
];
