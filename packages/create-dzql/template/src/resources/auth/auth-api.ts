/**
 * Auth — who is at the page. Someone registers with their name, email and a password, or signs in
 * with the email and password; the server answers a token the page keeps, and signs in again with
 * on every connect, so a reload or a reconnect is still them. dzql's `auth-jwt`: the people and
 * their hashed passwords are a table of its own (`users`), in no document.
 *
 * The types are shared: the client imports them as types only (`import type`).
 */
import type { Pool } from "pg";
import type { WsServer } from "@blueshed/delta/server";
import { wireAuth } from "@blueshed/delta/auth";
import { applyAuthJwtSchema, jwtAuth, type User } from "dzql/auth-jwt";

/** Someone signed in: their id, name and email. */
export type Me = User & { id: number; name: string; email: string };
/** What registering or signing in answers: who you are, and the token to sign in with next time. */
export type SignedIn = Me & { token: string };

/** Register, sign in, sign in again and sign out, on the socket every document rides. */
export async function signInOn(ws: WsServer, pool: Pool, secret: string) {
  await applyAuthJwtSchema(pool); // the users table, and register and login
  const auth = jwtAuth({ pool, secret });
  wireAuth(ws, auth);
  return auth;
}
