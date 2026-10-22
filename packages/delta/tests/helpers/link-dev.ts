// A link sign-in given no `dev`, made in a process of its own: says whether it is in development
// (signInAs answers) or not, then exits (`tests/auth-link.test.ts`, "development").
import { Database } from "bun:sqlite";
import { linkAuth, sqliteLinkStore } from "../../src/server/auth-link";

const auth = linkAuth({ store: sqliteLinkStore(new Database(":memory:")), personOf: (id) => ({ id }), people: () => [] });
console.log(await auth.signInAs(1).then(() => "development", () => "not development"));
process.exit(0);
