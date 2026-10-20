import { signInLinks } from "dzql/rendering/links";
import { db, sessions } from "./store";

// Signing in: a link for each person who keeps the model, printed where the server starts (`dzql
// model`, an app's `modelRoute()`), so nobody needs an email or a password to get in. Opened, it
// starts a fresh session as that person (never the visit's own cookie, which a stranger could have
// planted), and the browser goes to the model with its cookie (dzql/rendering/links says how). The
// CLI signs in with the same link (`bun run cli login <link>`) and keeps the session it is given.
const people = () => (db.query("SELECT id, name FROM mdl_people ORDER BY id").all() as { id: number; name: string }[]).map((p) => ({ name: p.name, value: { person_id: p.id, name: p.name } }));
export const links = signInLinks("model", sessions, people, "/model");
