/**
 * `bun run link <name>`: a link to sign in as <name>, made someone new if nobody here has that name.
 * How the first person comes in, before anyone can send them a link: on your machine, or on the
 * server (`railway ssh -- bun run link Sam`). The site is ORIGIN, else Railway's domain, else
 * http://localhost:3000.
 */
import { Pool } from "pg";
import { makeLink } from "@blueshed/delta/auth-link";
import { postgresLinkStore } from "dzql/auth-link";
import { prepare } from "../src/db";
import { databaseUrl } from "../src/server";
import { addPerson } from "../src/resources/people/people-api";

const name = process.argv.slice(2).join(" ").trim();
if (!name) {
  console.error("Whose link? bun run link <name>");
  process.exit(2);
}
const origin = process.env.ORIGIN ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${process.env.PORT ?? 3000}`);

const pool = new Pool({ connectionString: databaseUrl() });
try {
  await prepare(pool);
  const found = (await pool.query("SELECT id::int AS id FROM people WHERE lower(name) = lower($1) ORDER BY id LIMIT 1", [name])).rows[0];
  const id = found?.id ?? (await addPerson(pool, name));
  const { url, expires } = await makeLink(await postgresLinkStore(pool), id, { origin });
  console.log(`${name}${found ? "" : " (someone new)"}: ${url}\n(used once, until ${expires})`);
} finally {
  await pool.end();
}
