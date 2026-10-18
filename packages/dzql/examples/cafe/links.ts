import { signInLinks } from "dzql/rendering/links";
import { db } from "./store";
import { sessions } from "./resources/visit/visit-api";

// The staff come in by a link each, no password: printed as the server starts (./routes.ts), and
// on the door while nobody is signed in, this being a demo. Opened, a link starts a fresh visit as
// that member of staff (dzql/rendering/links).
const staff = () => (db.query("SELECT id, name, role FROM cafe_staff ORDER BY id").all() as { id: number; name: string; role: string }[]).map((s) => ({ name: `${s.name}, the ${s.role}`, value: { role: s.role, name: s.name } }));

export const links = signInLinks("cafe", sessions, staff);
