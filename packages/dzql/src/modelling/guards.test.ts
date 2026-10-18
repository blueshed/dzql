import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createLocal } from "@blueshed/delta/local";
import { createTables, registerDocs } from "@blueshed/delta/sqlite";
import { closureOf } from "../../examples/modeling/closure";
import { definitionsOf } from "./definitions";
import { check, guardSource, guardsOf, guardWrites, type GuardModel, type RowOf } from "./guards";

// The leave app's model, told as a modeller tells it: who asks, who approves, and what each write
// presupposes. Its six registers are closed, so its guards may be generated.
const field = (name: string, type = "text") => ({ name, type });
const leave: GuardModel = {
  stories: {
    "1": { id: 1, text: "Mo starts a team", actor: "mo", kind: "does", writes: [{ entity: "teams", op: "add" }] },
    "2": { id: 2, text: "Mo opens the team to requests", actor: "mo", kind: "does", writes: [{ entity: "teams", op: "replace", path: "open", to: "yes" }] },
    "3": { id: 3, text: "Ann asks for a week off", actor: "ann", kind: "does", writes: [{ entity: "requests", op: "add", path: "status", to: "waiting" }], requires: [{ entity: "teams", path: "open", value: "yes" }] },
    "4": { id: 4, text: "Mo approves a request that is waiting", actor: "mo", kind: "does", writes: [{ entity: "requests", op: "replace", path: "status", to: "approved" }], requires: [{ entity: "requests", path: "status", value: "waiting" }] },
    "5": { id: 5, text: "Ann cannot approve her own request", actor: "ann", kind: "cannot", writes: [{ entity: "requests", op: "replace", path: "status", to: "approved" }] },
    "6": { id: 6, text: "Ann takes back a request still waiting", actor: "ann", kind: "does", writes: [{ entity: "requests", op: "remove" }], requires: [{ entity: "requests", path: "status", value: "waiting" }] },
  },
  documents: {
    "1": {
      id: 1,
      name: "team",
      root: "teams",
      holds: { teams: { parent: null, fields: [field("name"), field("open")] }, requests: { parent: "teams", fields: [field("starts", "date"), field("status")] } },
      held_by: ["ann", "mo"],
      stories: [1, 2, 3, 4, 5, 6],
    } as never,
  },
};

describe("the guarded write layer: the stories' writes, each with what it presupposes", () => {
  test("the model it is made from is closed: all six registers", () => {
    expect(closureOf({ models: { name: "Leave" }, ...(leave as object) } as never).flatMap((r) => r.gaps)).toEqual([]);
  });

  test("a rule a write: who, what, on which documents, and the rows climbed to what it presupposes", () => {
    const { documents, rules } = guardsOf(leave);
    expect(documents).toEqual(["team"]);
    expect(rules.find((r) => r.story === 3)).toEqual({
      story: 3, text: "Ann asks for a week off", actor: "ann", allow: true, entity: "requests", op: "add", field: "status", to: "waiting", docs: ["team"],
      requires: [{ entity: "teams", field: "open", value: "yes", via: ["teams"] }],
    });
    expect(rules.find((r) => r.story === 4)!.requires).toEqual([{ entity: "requests", field: "status", value: "waiting", via: [] }]);
    expect(rules.find((r) => r.story === 5)!.allow).toBe(false);
  });

  test("proven on delta's SQLite: each story's write lands, and each it does not say is refused with the reason", async () => {
    const db = new Database(":memory:");
    const { schema, docs } = definitionsOf(leave as never);
    createTables(db, schema);
    const local = createLocal();
    const rowOf: RowOf = (entity, id) => db.query(`SELECT * FROM "${entity}" WHERE id = ?`).get(id) as Record<string, unknown> | null;
    guardWrites(local.server, guardsOf(leave), { actorOf: (identity) => (identity as { name?: string } | undefined)?.name, rowOf });
    registerDocs(local.server, db, schema, docs);
    const ann = local.as({ name: "ann" });
    const mo = local.as({ name: "mo" });
    const write = (who: typeof ann, ...ops: { op: string; path: string; value?: unknown }[]) => who.call("delta", { doc: "team:1", ops });
    await mo.call("open", { doc: "team:1" });

    expect((await write(ann, { op: "add", path: "/teams/-", value: { name: "Ann's" } })).error).toEqual({ code: 403, message: "No story says ann may add teams" });
    expect((await write(mo, { op: "add", path: "/teams/1", value: { name: "Desk", open: "no" } })).result).toEqual({ ack: true });
    // the team is closed: Ann's request presupposes it open, a row above the one she adds
    expect((await write(ann, { op: "add", path: "/requests/-", value: { teams_id: 1, starts: "2026-11-02", status: "waiting" } })).error).toEqual({
      code: 403,
      message: 'story 3 ("Ann asks for a week off") presupposes teams.open=yes, and it is "no"',
    });
    expect((await write(mo, { op: "replace", path: "/teams/1/open", value: "no" })).error!.message).toBe('No story says mo may replace teams.open="no"');
    expect((await write(mo, { op: "replace", path: "/teams/1/open", value: "yes" })).result).toEqual({ ack: true });
    // the value a story says it sets is the value it may set
    expect((await write(ann, { op: "add", path: "/requests/-", value: { teams_id: 1, starts: "2026-11-02", status: "approved" } })).error!.message).toBe("No story says ann may add requests");
    expect((await write(ann, { op: "add", path: "/requests/-", value: { teams_id: 1, starts: "2026-11-02", status: "waiting" } })).result).toEqual({ ack: true });
    // a cannot story is the reason
    expect((await write(ann, { op: "replace", path: "/requests/1/status", value: "approved" })).error).toEqual({ code: 403, message: "Ann cannot approve her own request (story 5)" });
    expect((await write(mo, { op: "replace", path: "/requests/1/status", value: "approved" })).result).toEqual({ ack: true });
    // approved, it is no longer waiting: neither another approval nor taking it back
    expect((await write(mo, { op: "replace", path: "/requests/1/status", value: "approved" })).error!.message).toBe('story 4 ("Mo approves a request that is waiting") presupposes requests.status=waiting, and it is "approved"');
    expect((await write(ann, { op: "remove", path: "/requests/1" })).error!.message).toContain("presupposes requests.status=waiting");
    expect((await write(ann, { op: "remove", path: "/requests/9" })).error!.message).toBe('story 6 ("Ann takes back a request still waiting") needs the requests row 9, and there is none');
    // nobody signed in; a document the model does not describe goes by to the store
    expect((await local.call("delta", { doc: "team:1", ops: [{ op: "remove", path: "/requests/1" }] })).error).toEqual({ code: 401, message: "Sign in to write to team:1" });
    expect((await ann.call("delta", { doc: "elsewhere:1", ops: [] })).error!.code).toBe(404);
    expect(db.query("SELECT status FROM requests").all()).toEqual([{ status: "approved" }]);
  });

  test("a whole row replaced is read for the field the story sets; a write to a document its teller does not hold is refused", async () => {
    const guards = guardsOf(leave);
    const rowOf: RowOf = (entity) => (entity === "requests" ? { id: 1, teams_id: 1, status: "waiting" } : { id: 1, open: "yes" });
    const asks = (op: { op: string; path: string; value?: unknown }, doc = "team", actor = "mo") => check(guards, { actor, doc, op, rowOf });
    expect(await asks({ op: "replace", path: "/requests/1", value: { status: "approved" } })).toEqual({ ok: true, story: 4 });
    expect(await asks({ op: "replace", path: "/requests/1", value: { starts: "x" } })).toEqual({ ok: false, reason: "No story says mo may replace requests" });
    expect(await asks({ op: "replace", path: "/requests/1", value: null })).toEqual({ ok: false, reason: "No story says mo may replace requests" });
    expect(await asks({ op: "replace", path: "/requests/1/status", value: "approved" }, "calendar")).toEqual({ ok: false, reason: 'story 4 ("Mo approves a request that is waiting") is told on team, not calendar' });
    expect(await asks({ op: "remove", path: "/requests/1/status" })).toEqual({ ok: false, reason: "No story says mo may remove requests.status" });
    expect(await asks({ op: "add", path: "/requests/-" }, "team", "ann")).toEqual({ ok: false, reason: "No story says ann may add requests" });
    expect(await asks({ op: "remove", path: "/a~1b/1" })).toEqual({ ok: false, reason: "No story says mo may remove a/b" });
  });

  test("what a write cannot reach is refused, saying so; a field any value, and a story with no document, are their own", async () => {
    const odd = guardsOf({
      stories: [
        { id: 1, text: "Jo renames a team", actor: "jo", writes: [{ entity: "teams", op: "replace", path: "name" }], requires: [{ entity: "rotas", path: "live", value: "yes" }] },
        { id: 2, text: "Jo edits a team", actor: "jo", writes: [{ entity: "teams", op: "replace" }] },
        { id: 3, text: "Jo notes a holiday", actor: "jo", writes: [{ entity: "holidays", op: "add" }] },
        { id: 4, text: "Bo signs in", actor: "visitor", post: "/login", writes: [{ entity: "logins", op: "add" }] },
        { id: 5, text: "Jo adds a shift", actor: "jo", writes: [{ entity: "shifts", op: "add" }], requires: [{ entity: "teams", path: "open", value: "yes" }] },
      ],
      documents: [
        { id: 1, name: "desk", root: "teams", own: 1 },
        { id: 2, name: "rota", root: "teams", holds: { teams: { parent: null }, shifts: { parent: null }, weeks: { parent: "teams" } } as never, held_by: [] },
        { id: 3, name: "loop", root: "a", holds: { a: { parent: "b" }, b: { parent: "a" } } as never, held_by: [] },
      ],
    });
    expect(odd.rules.map((r) => r.story)).toEqual([1, 2, 3, 5]);
    expect(odd.rules[0]!.custom).toBe("it presupposes rotas.live=yes, which is not a teams row or one it hangs under");
    expect(odd.rules[2]!.docs).toEqual([]);
    const rowOf: RowOf = () => ({ id: 1, teams_id: null });
    expect(await check(odd, { actor: "jo", doc: "desk", op: { op: "replace", path: "/teams/1/name", value: "x" }, rowOf })).toEqual({ ok: true, story: 2 });
    expect(await check(odd, { actor: "jo", doc: "desk", op: { op: "replace", path: "/teams/1", value: { name: "x" } }, rowOf })).toEqual({ ok: true, story: 2 });
    expect(await check({ ...odd, rules: [odd.rules[0]!] }, { actor: "jo", doc: "desk", op: { op: "replace", path: "/teams/1/name", value: "x" }, rowOf })).toEqual({
      ok: false,
      reason: 'story 1 ("Jo renames a team") cannot be checked from the write: it presupposes rotas.live=yes, which is not a teams row or one it hangs under',
    });
    expect(await check(odd, { actor: "jo", doc: "desk", op: { op: "add", path: "/holidays/-", value: {} }, rowOf })).toEqual({
      ok: false,
      reason: 'story 3 ("Jo notes a holiday") is told on no document its teller holds, not desk',
    });
    // what a document holds under its root, said to hang from nothing, hangs from the root, as the export has it
    expect(odd.rules[3]!.requires[0]!.via).toEqual(["teams"]);
    expect(guardsOf({ stories: [{ id: 1, text: "x", actor: "jo", writes: [{ entity: "weeks", op: "add" }], requires: [{ entity: "teams", path: "open", value: "yes" }] }], documents: [{ id: 2, name: "rota", root: "teams", holds: { teams: { parent: null }, weeks: { parent: "teams" } } as never }] }).rules[0]!.requires[0]!.via).toEqual(["teams"]);
    const weeks = guardsOf({ stories: [{ id: 1, text: "Jo adds a week", actor: "jo", writes: [{ entity: "weeks", op: "add" }], requires: [{ entity: "teams", path: "open", value: "yes" }] }], documents: [{ id: 2, name: "rota", root: "teams", own: 1, holds: { teams: { parent: null }, weeks: { parent: "teams" } } as never }] });
    expect(await check(weeks, { actor: "jo", doc: "rota", op: { op: "add", path: "/weeks/-", value: {} }, rowOf })).toEqual({ ok: false, reason: 'story 1 ("Jo adds a week") presupposes teams.open=yes, and there is no such row' });
    expect(await check(weeks, { actor: "jo", doc: "rota", op: { op: "add", path: "/weeks/-" }, rowOf })).toEqual({ ok: false, reason: 'story 1 ("Jo adds a week") needs the weeks row -, and there is none' });
    expect(guardsOf({}).rules).toEqual([]);
  });

  test("the guards as an app's file: the rules as data, and what a person must finish named at the top", () => {
    const source = guardSource(guardsOf(leave));
    expect(source).toStartWith("// Generated by `dzql model guards` from model.sqlite");
    expect(source).toContain('import type { Guards } from "dzql/modelling/guards";');
    expect(source).toContain('"text": "Ann asks for a week off"');
    expect(source).not.toContain("Refused until");
    const open = guardSource(guardsOf({ stories: [{ id: 7, text: "x", actor: "a", writes: [{ entity: "t", op: "add" }], requires: [{ entity: "u", path: "f", value: "1" }] }] }), "m.sqlite");
    expect(open).toContain("from m.sqlite");
    expect(open).toContain("//   story 7: it presupposes u.f=1, which is not a t row or one it hangs under");
  });
});
