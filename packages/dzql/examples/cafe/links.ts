import { signInLinks } from "dzql/rendering/links";
import { staff } from "./store";
import { sessions } from "./resources/visit/visit-api";

// The staff come in by a link each, no password: printed as the server starts (./routes.ts), and
// on the door while nobody is signed in, this being a demo -- in development only: in production
// none is printed or listed (dzql/rendering/links), and a cafe that opens for real signs its staff
// in its own way (the dzql-app skill's reference/signin.md). Opened, a link asks, and its form
// starts a fresh visit as that member of staff; each is used once, and runs out.
const people = () => staff.map((s) => ({ name: `${s.name}, the ${s.role}`, value: { role: s.role, name: s.name } }));

export const links = signInLinks("cafe", sessions, people);
