import { describe, expect, test } from "bun:test";
import { writesOf } from "../../../../src/modelling/page/loader/writes";
import { heartOf } from "../../../../src/modelling/page/loader/facts";

// What loading leave writes is told.test.ts's, which runs leave's stories once for it and for its own.
describe("what loading an app into a model writes", () => {
  test("a document no story needs is left out, and one held by nobody is held by nobody; a tab closing is a story done", () => {
    const heart = heartOf({ example: "x", ran: false, session: null, perSession: [], stories: [{ n: 1, name: "Bo leaves", as: "bo", kind: "closesTab", ops: [], seen: {}, untold: [], offPage: false }], rows: [{ n: 1, kind: "closesTab", as: "bo", doc: "room", changes: [] }] as never, traces: [], documents: [{ name: "room", root: "rooms", include: ["messages"] }, { name: "lobby", root: null, include: [] }], tables: [{ name: "rooms", parent: null, columns: [], code: [], sql: "rooms" }, { name: "messages", parent: "elsewhere", columns: [{ name: "text", type: "text" }], code: [], sql: "messages" }], files: [], cast: {}, held: {} });
    const load = writesOf(heart);
    expect(load.stories).toEqual([{ text: "Bo leaves", actor: "bo", kind: "does", touches: [] }]);
    expect(load.documents).toEqual([{ name: "room", root: "rooms", own: false, held_by: [], serves: [0], fields: [], holds: [{ entity: "messages", under: "rooms", fields: [{ name: "text", type: "text" }] }] }]);
    expect(load.skipped).toEqual(["lobby"]);
  });

  test("a story that names the model story it tells carries its number, for --against-page to match it by", () => {
    const heart = heartOf({ example: "x", ran: false, session: null, perSession: [], stories: [{ n: 1, name: "Ann orders a flat white", as: "ann", kind: "does", model: 3, ops: [], seen: {}, untold: [], offPage: false }], rows: [{ n: 1, kind: "does", as: "ann", doc: "bill", changes: [] }] as never, traces: [], documents: [{ name: "bill", root: "bills", include: [] }], tables: [{ name: "bills", parent: null, columns: [], code: [], sql: "bills" }], files: [], cast: {}, held: {} });
    expect(writesOf(heart).stories).toEqual([{ text: "Ann orders a flat white", actor: "ann", kind: "does", model: 3, touches: [] }]);
  });
});
