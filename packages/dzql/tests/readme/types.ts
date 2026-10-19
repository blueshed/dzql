// The model, now: delta's definitions, a row type per table and each document's shape. Written by `dzql model` from the model's page; never edited by hand.
// Every store takes them: change the import to move to SQLite (`@blueshed/delta/sqlite`) or Postgres (`dzql/postgres`).
import { defineDoc, defineSchema } from "@blueshed/delta/json";

// The model's tables: an app that keeps more (who signs in, its sessions) defines them beside these,
// `defineSchema({ ...tables, ... })`, and runs its own migrations after the model's.
export const tables: Parameters<typeof defineSchema>[0] = {
  teams: { columns: { name: "text?" }, temporal: false },
  requests: { columns: { starts: "text?", days: "real?", status: "text?" }, temporal: false, parent: "teams" },
};

export const schema = defineSchema(tables);

export const docs = [
  // for: Ann asks for two days off, and Mo sees them waiting
  // for: Mo approves them, and Ann sees it
  defineDoc("team:", { root: "teams", include: ["requests"], implied: true }),
];

export type TeamsRow = { id: number; name: string | null; };
export type RequestsRow = { id: number; teams_id: number; starts: string | null; days: number | null; status: string | null; };

export type TeamDoc = { teams: TeamsRow; requests: Record<string, RequestsRow>; };
