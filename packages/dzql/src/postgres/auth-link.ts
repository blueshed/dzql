/**
 * Link sign-in on Postgres: the `LinkStore` delta's `auth-link` keeps its links and sessions in
 * (`@blueshed/delta/auth-link`; Workshop's docs/link-sign-in-plan.md). The tables are its own,
 * `_auth_links` and `_auth_sessions`, beside delta's `_delta_*`: hashes, the person's id, times. A
 * link is used in one statement, so two taps at once make one session, on one server or several.
 *
 *   import { linkAuth } from "@blueshed/delta/auth-link";
 *   import { postgresLinkStore } from "dzql/auth-link";
 *
 *   const auth = linkAuth({ store: await postgresLinkStore(pool), personOf, people });
 */
import type { Pool } from "pg";
import type { KeptLink, KeptSession, LinkStore } from "@blueshed/delta/auth-link";

export { linkAuth, makeLink } from "@blueshed/delta/auth-link";

/** The links and sessions in Postgres, in tables of their own, made here (once: IF NOT EXISTS). */
export async function postgresLinkStore(pool: Pool): Promise<LinkStore> {
  await pool.query(`CREATE TABLE IF NOT EXISTS _auth_links (hash TEXT PRIMARY KEY, person BIGINT NOT NULL, opens TEXT, expires TIMESTAMPTZ NOT NULL, used TIMESTAMPTZ)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS _auth_sessions (hash TEXT PRIMARY KEY, person BIGINT NOT NULL, expires TIMESTAMPTZ NOT NULL)`);
  // Times as delta's store has them: ISO strings; a person's id a number (pg reads BIGINT as text)
  const iso = (t: Date | string | null) => (t === null ? null : new Date(t).toISOString());
  const SESSION = "SELECT person::int AS person, expires FROM _auth_sessions WHERE hash = $1";
  return {
    async addLink(hash, l) {
      await pool.query("INSERT INTO _auth_links (hash, person, opens, expires) VALUES ($1, $2, $3, $4)", [hash, l.person, l.opens, l.expires]);
    },
    async useLink(hash, now) {
      const { rows } = await pool.query(
        "UPDATE _auth_links SET used = $1 WHERE hash = $2 AND used IS NULL AND expires > $1 RETURNING person::int AS person, opens",
        [now, hash],
      );
      return rows[0] ?? null;
    },
    async link(hash): Promise<KeptLink | null> {
      const { rows } = await pool.query("SELECT person::int AS person, opens, expires, used FROM _auth_links WHERE hash = $1", [hash]);
      return rows[0] ? { ...rows[0], expires: iso(rows[0].expires)!, used: iso(rows[0].used) } : null;
    },
    async addSession(hash, s) {
      await pool.query("INSERT INTO _auth_sessions (hash, person, expires) VALUES ($1, $2, $3)", [hash, s.person, s.expires]);
    },
    async session(hash): Promise<KeptSession | null> {
      const { rows } = await pool.query(SESSION, [hash]);
      return rows[0] ? { person: rows[0].person, expires: iso(rows[0].expires)! } : null;
    },
    async renewSession(hash, expires) {
      await pool.query("UPDATE _auth_sessions SET expires = $1 WHERE hash = $2", [expires, hash]);
    },
    async endSession(hash) {
      await pool.query("DELETE FROM _auth_sessions WHERE hash = $1", [hash]);
    },
  };
}
