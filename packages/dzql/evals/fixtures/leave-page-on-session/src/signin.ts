import { timingSafeEqual } from "node:crypto";
import { refuseOrigin } from "@blueshed/delta/server";
import { tell } from "dzql/rendering/refusal";
import { seeOther, cookieOf } from "dzql/rendering/server";
import { db, sessions, tokenId } from "./store";

// Signing in: an email and a password, posted from the sign-in page as a plain form -- so the
// password goes to this route alone and never crosses the socket, the op log or the ledger. A good
// one starts a fresh session and cookie (never the visit's own, which a stranger could have planted) with
// who it is written in, and the browser goes home with its cookie. A wrong one is told on the
// page it came from, and says no more than that the two do not match. Someone who keeps guessing
// one email's password may try once a minute.
//
// Or who you are comes with the socket's request (`identify`): a trusted proxy's header, or the
// CLI's token. It ends the same way: a fresh session with who it is written in.

/** A hash to check a password against when the email is unknown, so a wrong email takes as long as a wrong password. */
const NOBODY = Bun.password.hashSync(crypto.randomUUID());

const loginOf = db.query<{ person_id: number; hash: string }, [string]>("SELECT person_id, hash FROM leave_logins WHERE email = ?");
const tokenOf = db.query<{ person_id: number }, [string]>("SELECT person_id FROM leave_tokens WHERE hash = ?");
const sessionOf = db.query<{ person_id: number | null }, [string]>("SELECT person_id FROM leave_sessions WHERE id = ?");

/** A fresh session, signed in as `personId`: its cookie. */
async function signedIn(personId: number): Promise<string> {
  return (await sessions.start({ person_id: Number(personId) })).cookie; // a person's number, however an older table keeps it
}

/** Wrong tries at one email's password, each within a minute of the last, before it may try only once a minute. An unknown email's are counted too, so none is told apart. */
const TRIES = 5;
const WAIT = 60_000;
const guesses = new Map<string, { tries: number; last: number }>();

/** A wrong try at `email`'s password; tries a minute old are forgotten, everyone's. */
function guessed(email: string): void {
  const now = Date.now();
  for (const [e, g] of guesses) if (now - g.last >= WAIT) guesses.delete(e);
  guesses.set(email, { tries: (guesses.get(email)?.tries ?? 0) + 1, last: now });
}

const slowed = (email: string): boolean => {
  const g = guesses.get(email);
  return !!g && g.tries >= TRIES && Date.now() - g.last < WAIT;
};

export async function signIn(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response(null, { status: 303, headers: { Location: "/" } }); // the page signs in
  const refused = refuseOrigin(req);
  if (refused) return refused;
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const told = async (reason: string) => {
    const visit = cookieOf(req);
    if (visit) await tell(await sessions.of(visit), { doc: "session", path: "/login", reason });
    return seeOther("/");
  };
  if (slowed(email)) return told("Too many tries: wait a minute, then try again."); // not even checked
  const login = loginOf.get(email);
  const matches = await Bun.password.verify(String(form.get("password") ?? ""), login?.hash ?? NOBODY);
  if (!login || !matches) {
    guessed(email);
    return told("That email and password do not match.");
  }
  guesses.delete(email);
  return seeOther("/", await signedIn(login.person_id));
}

/** A person's number as a row names it (an older table keeps it as text), or null for nobody. */
const numbered = (id: number | string | undefined): number | null => (id == null ? null : Number(id));

/** The same text, compared in the same time whatever it is. */
const same = (a: string, b: string): boolean => timingSafeEqual(Buffer.from(tokenId(a)), Buffer.from(tokenId(b)));

/**
 * Who a request vouches for: the person its token is (`Authorization: Bearer`, the CLI's), or the
 * one the trusted proxy signed in (`X-Forwarded-Email`), believed only with the proxy's secret
 * (`X-Proxy-Secret`, `LEAVE_PROXY_SECRET`; none set, no proxy is trusted). Null for a token or an
 * email nobody here has; undefined when it vouches for nobody.
 */
function vouched(req: Request): number | null | undefined {
  const token = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  if (token) return numbered(tokenOf.get(tokenId(token))?.person_id);
  const secret = process.env.LEAVE_PROXY_SECRET;
  const email = req.headers.get("x-forwarded-email");
  if (!secret || !email || !same(req.headers.get("x-proxy-secret") ?? "", secret)) return undefined;
  return numbered(loginOf.get(email.trim().toLowerCase())?.person_id);
}

/**
 * Who a socket's request is, before it opens (Example.identify): the cookie of the person it
 * vouches for -- the visit's, when its session is already theirs, or a fresh one -- refused when
 * it vouches for someone not here; a visit when it vouches for nobody.
 */
export async function identify(req: Bun.BunRequest): Promise<string | Response | undefined> {
  const person = vouched(req);
  if (person === undefined) return undefined;
  if (person === null) return new Response("Nobody here is that.", { status: 403 });
  const visit = req.cookies.get("session_id");
  if (visit && Number(sessionOf.get(await sessions.of(visit))?.person_id) === person) return visit;
  return signedIn(person);
}
