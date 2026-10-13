import { describe, expect, test } from "bun:test";
import { extract } from "./extract";
import { writesOf } from "./writes";
import { heartOf } from "./facts";

describe("what loading an app into a model writes", () => {
  test("leave: its 23 stories, the team and each person's session, as the model's seed has them by hand", async () => {
    const load = writesOf((await extract("leave")).heart);
    expect(load.stories).toHaveLength(23);
    expect(load.stories[0]).toEqual({ text: "Ann drags across two days in Bo's week, and sees the clash before she asks", actor: "ann", kind: "does", touches: ["sessions"] });
    expect(load.stories[20]).toMatchObject({ actor: "visitor", kind: "does", post: "/login" });
    expect(load.stories[2]!.kind).toBe("cannot");
    const [team, session] = load.documents;
    expect(team).toMatchObject({ name: "team", root: "teams", own: false, held_by: ["ann", "bo", "mo"], serves: [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18], fields: [{ name: "name", type: "text" }] });
    expect(team!.holds.map((h) => [h.entity, h.under])).toEqual([["people", "teams"], ["requests", "teams"]]);
    expect(team!.holds[1]!.fields.map((f) => f.name)).toEqual(["person_id", "starts", "ends", "status", "answered_by"]);
    expect(session).toMatchObject({ name: "session", root: "sessions", own: true, serves: [0, 2, 19, 22], holds: [] });
    expect(load.skipped).toEqual([]);
  }, 60000);

  test("a document no story needs is left out, and one held by nobody is held by nobody; a tab closing is a story done", () => {
    const heart = heartOf({ example: "x", ran: false, session: null, perSession: [], stories: [{ n: 1, name: "Bo leaves", as: "bo", kind: "closesTab", ops: [], seen: {}, untold: [], offPage: false }], rows: [{ n: 1, kind: "closesTab", as: "bo", doc: "room", changes: [] }] as never, traces: [], documents: [{ name: "room", root: "rooms", include: ["messages"] }, { name: "lobby", root: null, include: [] }], tables: [{ name: "rooms", parent: null, columns: [], code: [], sql: "rooms" }, { name: "messages", parent: "elsewhere", columns: [{ name: "text", type: "text" }], code: [], sql: "messages" }], files: [], cast: {}, held: {} });
    const load = writesOf(heart);
    expect(load.stories).toEqual([{ text: "Bo leaves", actor: "bo", kind: "does", touches: [] }]);
    expect(load.documents).toEqual([{ name: "room", root: "rooms", own: false, held_by: [], serves: [0], fields: [], holds: [{ entity: "messages", under: "rooms", fields: [{ name: "text", type: "text" }] }] }]);
    expect(load.skipped).toEqual(["lobby"]);
  });
});
