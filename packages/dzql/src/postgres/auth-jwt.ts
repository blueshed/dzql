/**
 * Auth-JWT — reference `DeltaAuth` implementation using JWTs (jose) and
 * Postgres stored functions for credential verification.
 *
 * Ship this as an opt-in subpath: `dzql/auth-jwt`. Users who want
 * a different auth scheme (sessions, OAuth, magic links, none) implement
 * their own `DeltaAuth` instead.
 *
 * Contract with Postgres:
 *   - `login(email, password) RETURNS jsonb` — return a user row or NULL.
 *   - `register(name, email, password) RETURNS jsonb` — return a user row,
 *     raise unique_violation (23505) on duplicate email.
 *
 * Both are overridable via the `loginSql` / `registerSql` options.
 *
 *   import { jwtAuth } from "dzql/auth-jwt";
 *
 *   const auth = jwtAuth({
 *     pool,
 *     secret: process.env.JWT_SECRET!,   // 32 bytes at least, or jwtAuth throws as it is made
 *   });
 *
 * A login with a wrong password counts against its email: past `maxFailedLogins` (5), each
 * within `lockout` (a minute) of the last, the email is refused unchecked until it has waited,
 * so a flood of guesses costs the database no bcrypt. Per process: two servers count apart.
 *
 *   wireAuth(ws, auth);
 *   await createDocListener(ws, pool, { auth });
 *
 * SQL-file helpers (`authJwtSqlFile`, `authJwtSql`, `applyAuthJwtSchema`) live
 * in `./auth-jwt-sql.ts` and are re-exported from here for convenience. They
 * have no jose dependency, so the `delta init` CLI can load them without
 * forcing consumers to install jose just to copy SQL files.
 */
import { SignJWT, jwtVerify, decodeJwt } from "jose";
import type { Pool } from "pg";
import { createLogger } from "@blueshed/delta/logger";
import type { DeltaAuth } from "@blueshed/delta/auth";
import { dropClientSubscriptions } from "@blueshed/delta/backend";

/** Algorithm this module signs with — pinned on verify to prevent alg-confusion. */
const JWT_ALG = "HS256";

export {
  authJwtSqlFile,
  authJwtSql,
  applyAuthJwtSchema,
} from "./auth-jwt-sql";

const log = createLogger("[auth-jwt]");

export interface User {
  id: number | string;
  name?: string;
  email?: string;
  [key: string]: unknown;
}

export interface JwtAuthOpts {
  pool: Pool;
  /** What signs the tokens: 32 bytes at least (256 bits, as HS256 wants), checked as `jwtAuth` is made. `openssl rand -base64 48` makes one. */
  secret: string | Uint8Array;
  expirationTime?: string;
  /**
   * Wrong passwords for one email, each within `lockout` of the last, before that email is refused
   * unchecked (no hash worked out) until it has waited `lockout`: a guess costs the database a
   * bcrypt, so a flood of them is stopped here. Unknown emails are counted too. Default 5.
   */
  maxFailedLogins?: number;
  /** How long, in ms, an email guessed at too often waits (and how long a wrong try is remembered). Default 60000. */
  lockout?: number;
  loginSql?: string;
  registerSql?: string;
  /**
   * Optional re-validation hook for `authenticate`. A JWT is stateless: by
   * default a signed, unexpired token grants access even if the user was
   * since deleted or disabled (the documented trade-off of stateless auth).
   * Provide `verifyUser` to re-check the identity against the database on
   * each `authenticate`; return the (possibly refreshed) user to allow, or
   * `null` to reject. Not called on `login` / `register` (those just hit the DB).
   */
  verifyUser?: (user: User, pool: Pool) => Promise<User | null>;
}

/** Set the socket's identity, tearing down a prior *different* identity's
 *  live subscriptions so an identity switch on one socket can't keep
 *  receiving the previous user's scoped docs. `expires` is when the token it
 *  came from runs out (ms since the epoch); `gate` refuses it after that. */
function switchIdentity(client: any, user: User, expires: number | undefined): void {
  const prev = client.data?.identity as User | undefined;
  if (prev && String(prev.id) !== String(user.id)) {
    dropClientSubscriptions(client);
  }
  if (!client.data) client.data = {};
  client.data.identity = user;
  client.data.identityExpires = expires;
}

/** When a token's `exp` says it runs out, in ms since the epoch. */
const expiresOf = (exp: unknown): number | undefined => (typeof exp === "number" ? exp * 1000 : undefined);

/** The fewest bytes a secret may have: HS256 signs with a 256-bit key. */
const SECRET_BYTES = 32;

export function jwtAuth(opts: JwtAuthOpts): DeltaAuth<User> {
  const secret =
    typeof opts.secret === "string"
      ? new TextEncoder().encode(opts.secret)
      : opts.secret;
  if (!(secret instanceof Uint8Array) || secret.length < SECRET_BYTES) {
    throw new Error(`jwtAuth: the secret must be at least ${SECRET_BYTES} bytes (it signs every token; ${secret instanceof Uint8Array ? `this one is ${secret.length}` : "none was given"}): set JWT_SECRET to one, e.g. \`openssl rand -base64 48\``);
  }
  const expirationTime = opts.expirationTime ?? "7d";
  const maxFailed = opts.maxFailedLogins ?? 5;
  const lockout = opts.lockout ?? 60_000;
  /** Wrong tries at each email's password, and when the last was: `lockout` old, forgotten. */
  const guesses = new Map<string, { tries: number; last: number }>();
  const guessed = (email: string): void => {
    const now = Date.now();
    for (const [e, g] of guesses) if (now - g.last >= lockout) guesses.delete(e);
    guesses.set(email, { tries: (guesses.get(email)?.tries ?? 0) + 1, last: now });
  };
  const slowed = (email: string): boolean => {
    const g = guesses.get(email);
    return !!g && g.tries >= maxFailed && Date.now() - g.last < lockout;
  };
  const loginSql = opts.loginSql ?? "SELECT login($1, $2) AS result";
  const registerSql = opts.registerSql ?? "SELECT register($1, $2, $3) AS result";

  async function signToken(user: User): Promise<string> {
    return new SignJWT({
      sub: String(user.id),
      name: user.name,
      email: user.email,
    })
      .setProtectedHeader({ alg: JWT_ALG })
      .setIssuedAt()
      .setExpirationTime(expirationTime)
      .sign(secret);
  }

  async function verifyToken(token: string): Promise<{ user: User; expires: number | undefined } | null> {
    try {
      // Pin the algorithm allowlist — without it, jose accepts any alg the
      // token header claims, opening an alg-confusion vector.
      const { payload } = await jwtVerify(token, secret, { algorithms: [JWT_ALG] });
      const id = payload.sub;
      if (id === undefined) return null;
      const user: User = {
        id: /^\d+$/.test(String(id)) ? Number(id) : String(id),
        name: payload.name as string | undefined,
        email: payload.email as string | undefined,
      };
      return { user, expires: expiresOf(payload.exp) };
    } catch {
      return null;
    }
  }

  return {
    actions: {
      async login(params, client) {
        const { email, password } = params ?? {};
        if (!email || !password) return { error: "email and password required" };
        const key = String(email).trim().toLowerCase();
        if (slowed(key)) return { error: "Too many tries for that email: wait a while, then try again." }; // not even checked
        const { rows } = await opts.pool.query(loginSql, [email, password]);
        const user = rows[0]?.result as User | null;
        if (!user) {
          guessed(key);
          return { error: "Invalid credentials" };
        }
        guesses.delete(key);
        const token = await signToken(user);
        switchIdentity(client, user, expiresOf(decodeJwt(token).exp));
        log.info(`login user=${user.id}`);
        return { result: { ...user, token } };
      },

      async register(params, client) {
        const { name, email, password } = params ?? {};
        if (!name || !email || !password) {
          return { error: "name, email, and password required" };
        }
        try {
          const { rows } = await opts.pool.query(registerSql, [name, email, password]);
          const user = rows[0]?.result as User;
          const token = await signToken(user);
          switchIdentity(client, user, expiresOf(decodeJwt(token).exp));
          log.info(`register user=${user.id}`);
          return { result: { ...user, token } };
        } catch (err: any) {
          if (err.code === "23505") return { error: "Email already registered" };
          throw err;
        }
      },

      async authenticate(params, client) {
        const { token } = params ?? {};
        if (!token) return { error: "token required" };
        const verified = await verifyToken(token);
        if (!verified) return { error: "Invalid token" };
        let user = verified.user;
        if (opts.verifyUser) {
          const checked = await opts.verifyUser(user, opts.pool);
          if (!checked) return { error: "Invalid token" };
          user = checked;
        }
        switchIdentity(client, user, verified.expires);
        log.info(`authenticate user=${user.id}`);
        return { result: user };
      },

      async logout(_params, client) {
        const prev = client.data?.identity as User | undefined;
        if (client.data) { delete client.data.identity; delete client.data.identityExpires; }
        // Tear down the prior identity's live doc subscriptions so its scoped
        // ops stop streaming to this socket immediately.
        dropClientSubscriptions(client);
        if (prev) log.info(`logout user=${prev.id}`);
        return { result: { ack: true } };
      },
    },

    gate(client) {
      // A session lasts as long as its token: once it runs out the socket is
      // signed out (and its documents let go), as a logout would do, and says
      // so until it signs in again -- the listener asks the gate before it
      // tells a socket of a change, too, so that is not always a request.
      const expires = client.data?.identityExpires as number | undefined;
      if (expires !== undefined && Date.now() >= expires) {
        if (client.data.identity !== undefined) {
          delete client.data.identity;
          dropClientSubscriptions(client);
        }
        return { error: "Session expired: authenticate again" };
      }
      const identity = client.data?.identity as User | undefined;
      if (!identity) return { error: "Authentication required" };
      return identity;
    },

    asSqlArg(identity) {
      return identity.id;
    },
  };
}
