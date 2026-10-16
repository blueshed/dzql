/**
 * People — who is here. `people:` is everyone, for everyone signed in: anyone adds someone new, and
 * sends anyone their link (link sign-in: `call("link", { person })`). A person signs in by their
 * link, or in development by picking their name.
 *
 * The types are shared: the client imports them as types only (`import type`).
 */
import type { Pool } from "pg";
import type { DeltaAuth } from "@blueshed/delta/auth";
import { defineDoc, docTypeFromDef } from "dzql/postgres";

export type Person = { id: number; name: string };
export type People = { people: Record<string, Person> };

export const everyone = defineDoc("people:", { root: "people", include: [] });
export const peopleDocs = [everyone];

/** The documents' types: `people:` is everyone's. */
export const peopleTypes = (pool: Pool, auth: DeltaAuth<Person>) => [docTypeFromDef<Person>(everyone, pool, { auth, shared: true })];

/** Someone new, by name, through `people:` so every page holding it is told: their id. */
export async function addPerson(pool: Pool, name: string): Promise<number> {
  const ops = [{ op: "add", path: "/people/-", value: { name } }];
  const { r } = (await pool.query("SELECT delta_apply($1, $2::jsonb) AS r", ["people:", JSON.stringify(ops)])).rows[0];
  return Number(String(r.ops[0].path).split("/")[2]);
}
