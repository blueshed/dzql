import { defineDoc, defineSchema, registerDocs, type DocDef } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import { db, openTables } from "dzql/rendering/db";
import { sessionRows } from "dzql/rendering/sessions";

// leave's store: SQLite (dzql/rendering/db), its documents in delta (`@blueshed/delta`), each a
// resource's (`resources/<name>/<name>-api.ts` registers it, with `register`). A team -- its people and their requests for days
// off -- is one document, written by people and on the ledger. A session is who you are and your
// draft -- the days you have dragged across and not yet asked for: yours alone until you ask, so
// nobody is told of it. Where you are is each tab's own (its URL), never the session's. It is signed in by the sign-in page (./signin.ts), never over the wire, and never on the
// ledger. How someone signs in -- an email and a password's hash, or a token's hash -- is a table
// of its own that no document includes, so no hash can ever cross the wire. The tables are said
// once, here, and made and seeded before any document is registered over them: the team's and the
// session's, and those only the sign-in reads. They are leave's own (`leave_`), and every row is
// numbered: who a row is about is a person's number.

export const schema = defineSchema({
  teams: { table: "leave_teams", columns: { name: "text" }, temporal: false }, // an app from before tables kept their history: its migrations made them so (upgrade.test.ts holds such a database); keeping it is a migration of its own
  people: { table: "leave_people", parent: "teams", columns: { name: "text", role: "text" }, temporal: false }, // an app from before tables kept their history: its migrations made them so (upgrade.test.ts holds such a database); keeping it is a migration of its own
  requests: { table: "leave_requests", parent: "teams", columns: { person_id: "integer", starts: "text", ends: "text", status: "text", answered_by: "integer?" }, temporal: false }, // an app from before tables kept their history: its migrations made them so (upgrade.test.ts holds such a database); keeping it is a migration of its own
  // `cookie`: the hash of the cookie that names the session (dzql/rendering/sessions), never in its document
  sessions: { table: "leave_sessions", columns: { person_id: "integer?", draft: "json?", cookie: "text?" }, temporal: false }, // a visit is no history
  logins: { table: "leave_logins", columns: { person_id: "integer", email: "text", hash: "text" }, temporal: false }, // a credential's old versions are only a risk
  tokens: { table: "leave_tokens", columns: { person_id: "integer", hash: "text" }, temporal: false }, // a token kept as its SHA-256: the CLI's
});

/** A token as it is kept: its SHA-256, never the token. */
export const tokenId = (token: string): string => new Bun.CryptoHasher("sha256").update(token).digest("hex");

/** Its tables: its own migrations (./migrations), then what the schema says beyond them. */
export const migrating = await openTables(schema, "leave", `${import.meta.dir}/migrations`);

// The team as it starts: two who ask and one who answers, each with a password and a token for the
// CLI made up for the example, two requests waiting, one approved, and the manager's own week, which
// they approved. A login is found by its email, a token by its hash; each person's is their number.
const PEOPLE: [id: number, name: string, role: "member" | "manager"][] = [
  [1, "Ann", "member"],
  [2, "Bo", "member"],
  [3, "Mo", "manager"],
];
if (!db.query("SELECT 1 FROM leave_teams").get()) {
  db.run("INSERT INTO leave_teams (id, name) VALUES (1, 'The studio')");
  for (const [id, name, role] of PEOPLE) {
    db.run("INSERT INTO leave_people (id, teams_id, name, role) VALUES (?, 1, ?, ?)", [id, name, role]);
    const login = name.toLowerCase();
    db.run("INSERT INTO leave_logins (id, person_id, email, hash) VALUES (?, ?, ?, ?)", [id, id, `${login}@leave.example`, Bun.password.hashSync(`${login}-password`)]);
    db.run("INSERT INTO leave_tokens (id, person_id, hash) VALUES (?, ?, ?)", [id, id, tokenId(`${login}-token`)]);
  }
  db.run("INSERT INTO leave_requests (id, teams_id, person_id, starts, ends, status, answered_by) VALUES (1, 1, 2, '2026-10-05', '2026-10-09', 'asked', NULL), (2, 1, 1, '2026-11-13', '2026-11-13', 'asked', NULL), (3, 1, 1, '2026-12-21', '2026-12-24', 'approved', 3), (4, 1, 3, '2026-10-19', '2026-10-23', 'approved', 3)");
}

export const delta = createLocal();

/** A resource's documents, on delta over leave's tables: on the ledger unless it says not. */
export const register = (docs: DocDef[], { ledger = true } = {}) => registerDocs(delta.server, db, schema, docs, [], { ledger });

// The session a cookie names, found and made by the cookie's hash, off the ledger.
register([defineDoc("visit:", { root: "sessions", scope: { cookie: ":cookie" }, include: [] })], { ledger: false });
export const sessions = sessionRows(delta, "sessions");

export { db };
