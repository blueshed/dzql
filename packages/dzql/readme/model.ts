// The model, as delta's definitions: written by `dzql model export` from the model's page.
// Every store takes them: change the import to move to SQLite (`@blueshed/delta/sqlite`) or Postgres (`dzql/postgres`).
import { defineDoc, defineSchema } from "@blueshed/delta/json";

export const schema = defineSchema({
  teams: { columns: { name: "text?" }, temporal: false },
  requests: { columns: { starts: "text?", days: "real?", status: "text?" }, temporal: false, parent: "teams" },
});

export const docs = [
  // for: Ann asks for two days off, and Mo sees them waiting
  defineDoc("team:", { root: "teams", include: ["requests"], implied: true }),
];
