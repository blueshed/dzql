import { createTables, defineDoc, defineSchema, registerDocs } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import { db } from "../../src/db";

// leave's documents, in delta (`@blueshed/delta`). A team -- its people, their requests for days
// off, and each person's draft -- is one document, written by people and on the ledger. A session is who you are and
// where you are: signed in by the sign-in page (./signin.ts), never over the wire, and never on the
// ledger. How someone signs in -- an email and a password's hash -- is a table of its own that no
// document includes, so no hash can ever cross the wire. The tables are leave's own (`leave_`).

export const schema = defineSchema({
  teams: { table: "leave_teams", columns: { name: "text" }, temporal: false },
  people: { table: "leave_people", parent: "teams", columns: { name: "text", role: "text" }, temporal: false },
  requests: { table: "leave_requests", parent: "teams", columns: { person_id: "text", starts: "text", ends: "text", status: "text", answered_by: "text?" }, temporal: false },
  // a person's draft: the days they have dragged across and not yet asked for, a row of its own
  // (delta names it): a draft asked for and drawn again is a new row, as an id is never named twice
  drafts: { table: "leave_drafts", parent: "teams", columns: { person_id: "text", starts: "text", ends: "text" }, temporal: false },
  sessions: { table: "leave_sessions", columns: { person_id: "text?", page: "text?" }, temporal: false },
  logins: { table: "leave_logins", columns: { person_id: "text", hash: "text" }, temporal: false },
});

createTables(db, schema);

// The team as it starts: two who ask and one who answers, each with a password made up for the
// example, two requests waiting, one approved, and the manager's own week, which he approved. A login's id is its email. Every id is text, as the wire
// says it, whatever a backend names a new row (a UUID on SQLite, a serial on Postgres).
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
  }
  db.run("INSERT INTO leave_requests (id, teams_id, person_id, starts, ends, status, answered_by) VALUES ('1', '1', '2', '2026-10-05', '2026-10-09', 'asked', NULL), ('2', '1', '1', '2026-11-13', '2026-11-13', 'asked', NULL), ('3', '1', '1', '2026-12-21', '2026-12-24', 'approved', '3'), ('4', '1', '3', '2026-10-19', '2026-10-23', 'approved', '3')");
}

export const delta = createLocal();

// A draft rides in the team's document beside the requests, so asking for it -- the request made, the
// draft gone -- is one change, and one Undo gives the draft back. Only its owner's page shows it.
registerDocs(delta.server, db, schema, [defineDoc("team:", { root: "teams", include: ["people", "requests", "drafts"] })], [], { ledger: true });

// A session, with no ledger: signing in and moving about are not the team's history.
registerDocs(delta.server, db, schema, [defineDoc("session:", { root: "sessions", include: [], implied: true })]);

export { db };
