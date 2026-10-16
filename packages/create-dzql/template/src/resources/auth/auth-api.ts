/**
 * Auth — who is at the page, with no passwords: link sign-in (`@blueshed/delta/auth-link`). A link
 * is someone; its tap makes a session cookie, and the socket is signed in by it. Anyone signed in
 * sends anyone their link; the first person's comes from `bun run link <name>`. In development the
 * page asks "Who are you?" and you pick; production answers no such thing.
 *
 * The links and sessions are kept in Postgres (`dzql/auth-link`), in tables of their own.
 */
import type { Pool } from "pg";
import type { WsServer } from "@blueshed/delta/server";
import { wireAuth } from "@blueshed/delta/auth";
import { linkAuth } from "@blueshed/delta/auth-link";
import { postgresLinkStore } from "dzql/auth-link";
import type { Person } from "../people/people-api";

/** Sign in by link on the socket every document rides: who someone is, from `people`. */
export async function signInOn(ws: WsServer, pool: Pool) {
  const auth = linkAuth<Person>({
    store: await postgresLinkStore(pool),
    personOf: async (id) => (await pool.query("SELECT id::int AS id, name FROM people WHERE id = $1", [id])).rows[0] ?? null,
    people: async () => (await pool.query("SELECT id::int AS id, name FROM people ORDER BY name, id")).rows,
  });
  wireAuth(ws, auth); // me, link
  return auth;
}
