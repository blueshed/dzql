/**
 * dzql/auth-jwt on Postgres in this process (PGlite): its schema hashes passwords with pgcrypto,
 * which PGlite has only when it is given the extension at start (`openPglite` does). Register, a
 * wrong password, and the right one.
 */
import { afterAll, expect, test } from "bun:test";
import { openPglite } from "../../src/postgres/pglite";
import { applyAuthJwtSchema } from "../../src/postgres/auth-jwt";

const pool = await openPglite();
afterAll(async () => { await pool.end(); });

test("register and sign in on PGlite, the password hashed by pgcrypto", async () => {
  await applyAuthJwtSchema(pool);
  const made = (await pool.query("SELECT register('Ada', 'ada@example.com', 'a long password') AS r")).rows[0].r;
  expect(made).toMatchObject({ name: "Ada", email: "ada@example.com" });
  expect((await pool.query("SELECT login('ada@example.com', 'wrong') AS r")).rows[0].r).toBeNull();
  expect((await pool.query("SELECT login('ada@example.com', 'a long password') AS r")).rows[0].r).toEqual(made);
  expect((await pool.query("SELECT password FROM users")).rows[0].password).toStartWith("$2a$12$");
});
