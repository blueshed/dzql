import { refuseOrigin } from "@blueshed/delta/server";
import { tell } from "dzql/rendering/refusal";
import { signInLinks } from "dzql/rendering/links";
import { seeOther, cookieOf } from "dzql/rendering/server";
import { db, sessions } from "./delta";

// Signing in: an email and a password, posted from the sign-in page as a plain form -- so the
// password goes to this route alone and never crosses the socket, the op log or the ledger. A good
// one starts a fresh session (never the visit's own cookie, which a stranger could have planted) with
// who it is written in, and the browser goes home with its cookie. A wrong one is told on the
// page it came from, and says no more than that the two do not match. The CLI signs in the same
// way, and keeps the cookie it is given (./cli.ts says how).

/** A hash to check a password against when the email is unknown, so a wrong email takes as long as a wrong password. */
const NOBODY = Bun.password.hashSync(crypto.randomUUID());

const loginOf = db.query<{ person_id: number; hash: string; name: string }, [string]>("SELECT l.person_id, l.hash, p.name FROM mdl_logins l JOIN mdl_people p ON p.id = l.person_id WHERE l.email = ?");

export async function signIn(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response(null, { status: 303, headers: { Location: "/model" } }); // the page signs in
  const refused = refuseOrigin(req);
  if (refused) return refused;
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const login = loginOf.get(email);
  const matches = await Bun.password.verify(String(form.get("password") ?? ""), login?.hash ?? NOBODY);
  if (!login || !matches) {
    const visit = cookieOf(req);
    if (visit) await tell(await sessions.of(visit), { doc: "session", path: "/login", reason: "That email and password do not match." });
    return seeOther("/model");
  }
  const { cookie } = await sessions.start({ person_id: login.person_id, name: login.name });
  return seeOther("/model", cookie);
}

// Or a link: one for each person who keeps the model, printed where the server starts (`dzql model`,
// an app's `modelRoute()`), so nobody needs an email or a password to get in. Opened, it starts a fresh
// session as that person, as the form does (dzql/rendering/links says how).
const people = () => (db.query("SELECT id, name FROM mdl_people ORDER BY id").all() as { id: number; name: string }[]).map((p) => ({ name: p.name, value: { person_id: p.id, name: p.name } }));
export const links = signInLinks("model", sessions, people, "/model");
