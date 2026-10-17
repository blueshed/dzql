import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTables, defineDoc, defineSchema, fromFolder, migrate, registerDocs } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import { migrating, schema, tokenId } from "./delta";

// An upgrade is not a write, so this story is no harness story. It makes a database the way leave's
// previous version left it -- that version's tables and seed, and a week Ann asked for and Mo
// approved, each on the ledger along their session -- upgrades it with the migrations of the
// version after (./upgrade/), as a delta.ts runs them at start-up, then runs leave's stories
// against it, in a process of their own, and checks the old rows by hand.
//
// The previous version: a request was `asked_by` its person (now `person_id`), kept a count of its
// `days` (now worked out from the calendar, and dropped), and gave no `reason` (now every old
// request was a holiday); a login's id was its email and a token's its hash (now each is numbered,
// and keeps them in columns). Not renamed, a request is nobody's; not dropped, no request can be
// made; not numbered, nobody signs in.

const before = defineSchema({
  teams: { table: "leave_teams", columns: { name: "text" }, temporal: false },
  people: { table: "leave_people", parent: "teams", columns: { name: "text", role: "text" }, temporal: false },
  requests: { table: "leave_requests", parent: "teams", columns: { asked_by: "text", starts: "text", ends: "text", days: "integer", status: "text", answered_by: "text?" }, temporal: false },
  sessions: { table: "leave_sessions", columns: { person_id: "text?", page: "text?", draft: "json?" }, temporal: false },
  logins: { table: "leave_logins", columns: { person_id: "text", hash: "text" }, temporal: false },
  tokens: { table: "leave_tokens", columns: { person_id: "text" }, temporal: false },
});

const dir = mkdtempSync(join(tmpdir(), "leave-upgrade-"));
const path = join(dir, "leave.sqlite");
const team = [defineDoc("team:", { root: "teams", include: ["people", "requests"] })];
/** Ann's week in January, asked for and approved before the upgrade: its id. */
let week: string;

/** The previous version's database: its tables, its seed, and Ann's week, asked for by Ann and approved by Mo through delta. */
async function previousVersion(): Promise<void> {
  const db = new Database(path);
  createTables(db, before);
  db.run("INSERT INTO leave_teams (id, name) VALUES ('1', 'The studio')");
  for (const [id, name, role] of [["1", "Ann", "member"], ["2", "Bo", "member"], ["3", "Mo", "manager"]] as const) {
    db.run("INSERT INTO leave_people (id, teams_id, name, role) VALUES (?, '1', ?, ?)", [id, name, role]);
    const login = name.toLowerCase();
    db.run("INSERT INTO leave_logins (id, person_id, hash) VALUES (?, ?, ?)", [`${login}@leave.example`, id, Bun.password.hashSync(`${login}-password`)]);
    db.run("INSERT INTO leave_tokens (id, person_id) VALUES (?, ?)", [tokenId(`${login}-token`), id]);
  }
  db.run("INSERT INTO leave_requests (id, teams_id, asked_by, starts, ends, days, status, answered_by) VALUES ('1', '1', '2', '2026-10-05', '2026-10-09', 5, 'asked', NULL), ('2', '1', '1', '2026-11-13', '2026-11-13', 1, 'asked', NULL), ('3', '1', '1', '2026-12-21', '2026-12-24', 4, 'approved', '3'), ('4', '1', '3', '2026-10-19', '2026-10-23', 5, 'approved', '3')");

  const delta = createLocal();
  registerDocs(delta.server, db, before, team, [], { ledger: true });
  await delta.call("open", { doc: "team:1" });
  const asked = await delta.as("1").call("delta", { doc: "team:1", ops: [{ op: "add", path: "/requests/-", value: { asked_by: "1", starts: "2027-01-04", ends: "2027-01-08", days: 5, status: "asked", answered_by: null } }], cursor: "ann-before", undoable: true, inverse: true });
  week = db.query<{ id: string }, []>("SELECT CAST(id AS TEXT) AS id FROM leave_requests WHERE starts = '2027-01-04'").get()!.id;
  const approved = await delta.as("3").call("delta", { doc: "team:1", ops: [{ op: "replace", path: `/requests/${week}/status`, value: "approved" }, { op: "replace", path: `/requests/${week}/answered_by`, value: "3" }], cursor: "mo-before", undoable: true, inverse: true });
  expect([asked.error, approved.error]).toEqual([undefined, undefined]);
  db.close();
}

/** Ann's requests as the tables hold them, by id: when, how they stand, and why. */
const annsRequests = (db: Database) =>
  db.query<{ id: string; starts: string; status: string; answered_by: number | null; reason: string }, []>("SELECT CAST(id AS TEXT) AS id, starts, status, answered_by, reason FROM leave_requests WHERE person_id = 1 ORDER BY id").all();

beforeAll(async () => {
  await previousVersion();
  const db = new Database(path);
  await migrate(db, await fromFolder(join(import.meta.dir, "upgrade")), migrating);
  db.close();
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("Ann's requests are still there after leave is upgraded to a version that adds a reason, renames a field and drops one; Mo still sees them, and undo never reaches back across the upgrade", () => {
  test("the upgrade ran each migration once, in order, and each of Ann's requests is still hers, as it stood, a holiday", () => {
    const db = new Database(path);
    expect(db.query<{ id: string }, []>("SELECT id FROM delta_migrations ORDER BY rowid").all().map((m) => m.id)).toEqual(["001-reason", "002-person", "003-days", "004-numbered"]);
    expect(db.query("SELECT id, person_id, email FROM leave_logins ORDER BY id").all()).toEqual([
      { id: 1, person_id: 1, email: "ann@leave.example" },
      { id: 2, person_id: 2, email: "bo@leave.example" },
      { id: 3, person_id: 3, email: "mo@leave.example" },
    ]);
    expect(db.query("SELECT id, hash FROM leave_tokens WHERE person_id = 1").get()).toEqual({ id: 1, hash: tokenId("ann-token") });
    expect(db.query<{ name: string }, []>("PRAGMA table_info(leave_requests)").all().map((c) => c.name)).toEqual(["id", "teams_id", "starts", "ends", "status", "reason", "person_id", "answered_by"]);
    expect(annsRequests(db)).toEqual([
      { id: "2", starts: "2026-11-13", status: "asked", answered_by: null, reason: "holiday" },
      { id: "3", starts: "2026-12-21", status: "approved", answered_by: 3, reason: "holiday" },
      { id: week, starts: "2027-01-04", status: "approved", answered_by: 3, reason: "holiday" },
    ]);
    db.close();
  });

  test("Mo's team, read as leave reads it now, holds Ann's requests as hers; and an undo along Ann's or Mo's session from before reaches nothing", async () => {
    const db = new Database(path);
    const delta = createLocal();
    registerDocs(delta.server, db, schema, team, [], { ledger: true });
    const held = (await delta.as("3").call("open", { doc: "team:1" })).result as { requests: Record<string, { person_id: number; starts: string }> };
    expect(Object.entries(held.requests).filter(([, r]) => r.person_id === 1).map(([id, r]) => [id, r.starts])).toEqual([["2", "2026-11-13"], ["3", "2026-12-21"], [week, "2027-01-04"]]);
    for (const [who, cursor] of [["3", "mo-before"], ["1", "ann-before"]] as const) expect((await delta.as(who).call("undo", { cursor })).result ?? null).toBeNull();
    expect(annsRequests(db).map((r) => [r.id, r.status])).toEqual([["2", "asked"], ["3", "approved"], [week, "approved"]]);
    db.close();
  });

  test("leave's stories pass against the upgraded database, and Ann's requests from before are still hers", async () => {
    const run = Bun.spawn(["bun", "src/modelling/stories-run.ts"], { cwd: join(import.meta.dir, "../.."), env: { ...process.env, ETA_EXAMPLE: "leave", DB_PATH: path, LOG_LEVEL: "warn" }, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited]);
    expect(code === 0 ? "passed" : out + err).toBe("passed");
    const db = new Database(path);
    // the stories move and answer request 2 (and undo and redo it): it is still Ann's, and still a holiday
    expect(annsRequests(db).map((r) => [r.id, r.reason])).toEqual([["2", "holiday"], ["3", "holiday"], [week, "holiday"]]);
    db.close();
  }, 60_000);
});
