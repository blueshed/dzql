// Made by `delta migrations make` from the definitions: what they say beyond the migrations before it.
import { createTable } from "@blueshed/delta/migrations";

export const changes = [
  createTable("people", { columns: { name: { type: "text" } }, temporal: false }),
];
