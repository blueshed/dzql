import { createTables, defineDoc, defineSchema, registerDocs, migrate, fromFolder, migrateSchema } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import { db } from "../../src/db";

// leave's documents, in delta (`@blueshed/delta`). A team -- its people and their requests for days
// off -- is one document, written by people and on the ledger. A session is who you are, where you
// are, and your draft -- the days you have dragged across and not yet asked for: yours alone until
// you ask, so nobody is told of it. It is signed in by the sign-in page (./signin.ts), never over the wire, and never on the
// ledger. How someone signs in -- an email and a password's hash, or a token's hash -- is a table
// of its own that no document includes, so no hash can ever cross the wire. The tables are leave's own (`leave_`).

export const schema = defineSchema({
  teams: { table: "leave_teams", columns: { name: "text" }, temporal: false },
  people: { table: "leave_people", parent: "teams", columns: { name: "text", role: "text" }, temporal: false },
  requests: { table: "leave_requests", parent: "teams", columns: { person_id: "text", starts: "text", ends: "text", status: "text", answered_by: "text?" }, temporal: false },
  sessions: { table: "leave_sessions", columns: { person_id: "text?", page: "text?", draft: "json?" }, temporal: false },
  logins: { table: "leave_logins", columns: { person_id: "text", hash: "text" }, temporal: false },
  tokens: { table: "leave_tokens", columns: { person_id: "text" }, temporal: false }, // a token's id is its SHA-256: the CLI's
});

/** A token as it is kept: its SHA-256, never the token. */
export const tokenId = (token: string): string => new Bun.CryptoHasher("sha256").update(token).digest("hex");

/** Whose migrations these are, and its schema: the examples may share a database, and each runs only its own. */
export const migrating = { app: "leave", schema };
await migrate(db, await fromFolder(`${import.meta.dir}/migrations`), migrating); // first, what the schema cannot say: a rename, a drop, data moved
createTables(db, schema);
migrateSchema(db, schema);

// The team as it starts: two who ask and one who answers, each with a password and a token for the
// CLI made up for the example, two requests waiting, one approved, and the manager's own week, which
// they approved. A login's id is its email. Every id is text here, as the wire says it.
const PEOPLE: [id: string, name: string, role: "member" | "manager"][] = [
  ["1", "Ann", "member"],
  ["2", "Bo", "member"],
  ["3", "Mo", "manager"],
];
if (!db.query("SELECT 1 FROM leave_teams").get()) {
  db.run("INSERT INTO leave_teams (id, name) VALUES ('1', 'The studio')");
  for (const [id, name, role] of PEOPLE) {
    db.run("INSERT INTO leave_people (id, teams_id, name, role) VALUES (?, '1', ?, ?)", [id, name, role]);
    const login = name.toLowerCase();
    db.run("INSERT INTO leave_logins (id, person_id, hash) VALUES (?, ?, ?)", [`${login}@leave.example`, id, Bun.password.hashSync(`${login}-password`)]);
    db.run("INSERT INTO leave_tokens (id, person_id) VALUES (?, ?)", [tokenId(`${login}-token`), id]);
  }
  db.run("INSERT INTO leave_requests (id, teams_id, person_id, starts, ends, status, answered_by) VALUES ('1', '1', '2', '2026-10-05', '2026-10-09', 'asked', NULL), ('2', '1', '1', '2026-11-13', '2026-11-13', 'asked', NULL), ('3', '1', '1', '2026-12-21', '2026-12-24', 'approved', '3'), ('4', '1', '3', '2026-10-19', '2026-10-23', 'approved', '3')");
}

export const delta = createLocal();

registerDocs(delta.server, db, schema, [defineDoc("team:", { root: "teams", include: ["people", "requests"] })], [], { ledger: true });

// A session, with no ledger: signing in, moving about and drafting are not the team's history.
registerDocs(delta.server, db, schema, [defineDoc("session:", { root: "sessions", include: [], implied: true })]);

export { db };
