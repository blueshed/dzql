/**
 * Custom documents over the path schema: membership, recompute, some columns,
 * and a name that starts as a list's. Part of `pathCases`.
 */
import { describe, expect, test } from "bun:test";
import { waitFor } from "../support";
import { emailsQuery, household, seat, field } from "./fixture";
import { type PathBackend, told, openAll, assertCopiesHold, write, expectTold, expectSilent } from "./law";

/** Custom documents that watch the rows. */
export function customDocCases(backend: () => PathBackend): void {
  describe("a custom document that watches the rows", () => {
    test("a household's email written through its own document, as its root, leaves the one inbox and joins the other; undone, it goes back", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-household:1", "fo-inbox:a@x", "fo-inbox:new@x"]);
      await write(b.process, "fo-household:1", [{ op: "replace", path: "/households/email", value: "new@x" }], { cursor: "s1" });
      const undone = await b.process.call("undo", { cursor: "s1" });
      expect(undone.result.conflict).toBeUndefined();
      await expectTold(b, "fo-inbox:a@x", [
        [{ op: "remove", path: "/households/1" }],
        [{ op: "add", path: "/households/1", value: household(1, "a@x") }],
      ]);
      await expectTold(b, "fo-inbox:new@x", [
        [{ op: "add", path: "/households/1", value: household(1, "new@x") }],
        [{ op: "remove", path: "/households/1" }],
      ]);
      await assertCopiesHold(b, copies);
    });

    test("told through two documents, a write is heard once: the household's own and the board's, one add to the inbox it joins", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-household:1", "fo-board:1", "fo-inbox:a@x", "fo-inbox:new@x"]);
      await write(b.process, "fo-household:1", [{ op: "replace", path: "/households/email", value: "new@x" }]);
      await expectTold(b, "fo-inbox:a@x", [[{ op: "remove", path: "/households/1" }]]);
      await expectTold(b, "fo-inbox:new@x", [[{ op: "add", path: "/households/1", value: household(1, "new@x") }]]);
      await assertCopiesHold(b, copies);
    });

    test("a household moved to the other wedding through a list, its own document and both boards open, still matches: the inbox is told the one field that changed, and keeps it", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-household:1", "fo-board:1", "fo-board:2", "fo-inbox:a@x", "fo-all-households:"]);
      await write(b.process, "fo-all-households:", [{ op: "replace", path: "/households/1/weddings_id", value: 2 }]);
      await expectTold(b, "fo-board:1", [[{ op: "remove", path: "/households/1" }]]);
      await expectTold(b, "fo-inbox:a@x", [[field("/households/1/weddings_id", 2)]]);
      await assertCopiesHold(b, copies);
    });

    test("a seat that leaves a list's condition, still matching, is not taken for removed: the list is told it left, the custom document the field that changed, and keeps it -- written through the seating plan, since the list itself may not write it out", async () => {
      const b = backend();
      await b.process.call("open", { doc: "fo-seating:1" });
      await write(b.process, "fo-seating:1", [{ op: "replace", path: "/seats/1/kept", value: false }]);
      await b.quiet();
      const copies = await openAll(b.process, ["fo-seats-at:3", "fo-seats-at:open:all"]);
      expect((await b.process.call("delta", { doc: "fo-seats-at:3", ops: [{ op: "replace", path: "/seats/1/table_no", value: 5 }] })).error?.code).toBe(404);
      await write(b.process, "fo-seating:1", [{ op: "replace", path: "/seats/1/table_no", value: 5 }]);
      await expectTold(b, "fo-seats-at:3", [[{ op: "remove", path: "/seats/1" }]]);
      await expectTold(b, "fo-seats-at:open:all", [[field("/seats/1/table_no", 5)]]);
      await assertCopiesHold(b, copies);
    });

    test("a household removed through the board, its own document open too, leaves the inbox once", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-household:1", "fo-inbox:a@x"]);
      await write(b.process, "fo-board:1", [{ op: "remove", path: "/households/1" }]);
      await expectTold(b, "fo-household:1", [[{ op: "replace", path: "/households", value: null }]]);
      await expectTold(b, "fo-inbox:a@x", [[{ op: "remove", path: "/households/1" }]]);
      await assertCopiesHold(b, copies);
    });
    test("a wedding removed through the board takes its households out of the inboxes by its cascade; undone, redone and undone again, each inbox holds the law", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-inbox:a@x", "fo-inbox:b@x", "fo-inbox:c@x"]);
      await write(b.process, "fo-board:1", [{ op: "remove", path: "/weddings/1" }], { cursor: "s1" });
      await expectTold(b, "fo-inbox:a@x", [[{ op: "remove", path: "/households/1" }]]);
      for (const way of ["undo", "redo", "undo"]) expect((await b.process.call(way, { cursor: "s1" })).result.conflict).toBeUndefined();
      await expectSilent(b, "fo-inbox:c@x");
      await assertCopiesHold(b, copies);
    });
  });

  describe("a recompute custom document", () => {
    test("the menu card is read whole, and again on each write to what it watches -- its own wedding's or another's -- told as a root replace; a write to what it does not watch is not told", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-menu-card:1", "fo-board:1", "fo-board:2"]);
      expect(copies.get("fo-menu-card:1")).toEqual({ wedding: "ours", courses: ["Soup"] });
      // each read as the tables stand when it is read: on Postgres, after the write's commit is heard
      const card = (wedding: string, courses: string[]) => [{ op: "replace", path: "", value: { wedding, courses } }];
      await write(b.process, "fo-board:1", [{ op: "add", path: "/courses/10", value: { name: "Fish" } }]);
      await expectTold(b, "fo-menu-card:1", [card("ours", ["Soup", "Fish"])]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/weddings/name", value: "our day" }]);
      await expectTold(b, "fo-menu-card:1", [card("ours", ["Soup", "Fish"]), card("our day", ["Soup", "Fish"])]);
      await write(b.process, "fo-board:2", [{ op: "replace", path: "/courses/2/name", value: "Slaw" }]);   // no relevance gate: read again, the same
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/households/1/email", value: "z@x" }]);   // not watched
      await expectTold(b, "fo-menu-card:1", [card("ours", ["Soup", "Fish"]), card("our day", ["Soup", "Fish"]), card("our day", ["Soup", "Fish"])]);
      await assertCopiesHold(b, copies);
    });

    test("a menu card whose wedding is not there is not found (404); it is read-only (403); undone, a write is read again", async () => {
      const b = backend();
      expect((await b.process.call("open", { doc: "fo-menu-card:9" })).error?.code).toBe(404);
      const copies = await openAll(b.process, ["fo-menu-card:1", "fo-board:1"]);
      expect((await b.process.call("delta", { doc: "fo-menu-card:1", ops: [{ op: "replace", path: "/wedding", value: "x" }] })).error?.code).toBe(403);
      await write(b.process, "fo-board:1", [{ op: "remove", path: "/courses/1" }], { cursor: "s1" });
      await expectTold(b, "fo-menu-card:1", [[{ op: "replace", path: "", value: { wedding: "ours", courses: [] } }]]);
      expect((await b.process.call("undo", { cursor: "s1" })).error).toBeUndefined();
      await expectTold(b, "fo-menu-card:1", [
        [{ op: "replace", path: "", value: { wedding: "ours", courses: [] } }],
        [{ op: "replace", path: "", value: { wedding: "ours", courses: ["Soup"] } }],
      ]);
      await b.process.call("close", { doc: "fo-menu-card:1" });
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/courses/1/name", value: "Broth" }]);
      await expectTold(b, "fo-menu-card:1", [
        [{ op: "replace", path: "", value: { wedding: "ours", courses: [] } }],
        [{ op: "replace", path: "", value: { wedding: "ours", courses: ["Soup"] } }],
      ]);   // closed: not read again, not told
      copies.delete("fo-menu-card:1");
      await assertCopiesHold(b, copies);
    });
    test("the menu cards, open across a move, a cascade that takes the wedding, an undo and a redo, each hold the law: read again and told as a root replace, or null once the wedding is gone", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-menu-card:1", "fo-menu-card:2", "fo-all-courses:"]);
      await write(b.process, "fo-all-courses:", [{ op: "replace", path: "/courses/1/weddings_id", value: 2 }], { cursor: "s1" });
      await b.process.call("open", { doc: "fo-board:1" });
      await write(b.process, "fo-board:1", [{ op: "remove", path: "/weddings/1" }], { cursor: "s1" });
      for (const way of ["undo", "undo", "redo"]) expect((await b.process.call(way, { cursor: "s1" })).result.conflict).toBeUndefined();
      await assertCopiesHold(b, copies);
    });
  });

  describe("a custom document whose query reads some columns, or reads them as text", () => {
    test("is told what changed of what it holds, in the shape its query gave: a field it does not read, nothing; one it reads, that field; a key read as text, no change; a row that joins it, as its query reads it", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-emails:1", "fo-guests:1", "fo-board:1", "fo-all-households:"]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/households/1/t", value: "notes" }]);
      await write(b.process, "fo-board:1", [{ op: "replace", path: "/households/1/email", value: "z@x" }]);
      await write(b.process, "fo-all-households:", [{ op: "replace", path: "/households/2/weddings_id", value: 2 }]);
      // joining: one added to the wedding, and one moved to it from the other
      await write(b.process, "fo-board:1", [{ op: "add", path: "/households/-", value: { email: "n@x", t: "notes" } }]);
      await write(b.process, "fo-all-households:", [{ op: "replace", path: "/households/3/weddings_id", value: 1 }]);
      const joined = (shape: (id: number, email: string) => unknown) => [
        [{ op: "add", path: "/households/4", value: shape(4, "n@x") }],
        [{ op: "add", path: "/households/3", value: shape(3, "c@x") }],
      ];
      const told = [[field("/households/1/email", "z@x")], [{ op: "remove", path: "/households/2" }]];
      await expectTold(b, "fo-emails:1", [...told, ...joined((id, email) => ({ id, email }))]);
      await expectTold(b, "fo-guests:1", [...told, ...joined((id, email) => ({ id: String(id), weddings_id: "1", email }))]);
      await assertCopiesHold(b, copies);
    });

    test("its query is read once a write, however many rows join it: fifty households added in one write, one read, each told in its shape", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-emails:1", "fo-board:1"]);
      emailsQuery.runs = 0;
      const many = Array.from({ length: 50 }, (_, i) => ({ op: "add", path: `/households/${100 + i}`, value: { email: `g${i}@x` } }));
      await write(b.process, "fo-board:1", many);
      await expectTold(b, "fo-emails:1", many.map((_, i) => [{ op: "add", path: `/households/${100 + i}`, value: { id: 100 + i, email: `g${i}@x` } }]));
      expect(emailsQuery.runs).toBe(1);
      await assertCopiesHold(b, copies);
    });

    test("it hears its changes in order however slow its query: a row that joins and is removed in writes back to back is told added, then removed", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-emails:1", "fo-board:1"]);
      emailsQuery.delay = 80;
      try {
        await write(b.process, "fo-board:1", [{ op: "add", path: "/households/10", value: { email: "n@x" } }]);
        await write(b.process, "fo-board:1", [{ op: "remove", path: "/households/10" }]);
        await waitFor(() => told(b.process, "fo-emails:1").length >= 2, { timeout: 3000 }).catch(() => {});
        await b.quiet();
        // op and path: on Postgres the read may run after the removal, and then the row comes as told
        expect(told(b.process, "fo-emails:1").map((ops: any) => ops.map((o: any) => `${o.op} ${o.path}`))).toEqual([["add /households/10"], ["remove /households/10"]]);
      } finally {
        emailsQuery.delay = 0;
      }
      await assertCopiesHold(b, copies);
    });
  });

  describe("a custom document whose name starts as a list's", () => {
    test("fo-seats-at:open:all is not taken for the list fo-seats-at: named \"open\": seats written beside it are told as ever, and it hears the one that is not kept", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-seats-at:open:all", "fo-seating:1", "fo-seats-at:3", "fo-seats-at:5"]);
      await write(b.process, "fo-seating:1", [{ op: "replace", path: "/seats/1/table_no", value: 5 }]);
      const added = await write(b.process, "fo-seats-at:5", [{ op: "add", path: "/seats/-", value: { weddings_id: 1, kept: false } }]);
      expect(added.ops).toEqual([{ op: "add", path: "/seats/2", value: seat(2, 5, false) }]);
      await expectTold(b, "fo-seating:1", [[field("/seats/1/table_no", 5)], added.ops]);
      await expectTold(b, "fo-seats-at:3", [[{ op: "remove", path: "/seats/1" }]]);
      await expectTold(b, "fo-seats-at:5", [[{ op: "add", path: "/seats/1", value: seat(1, 5, true, { veg: true }) }], added.ops]);
      await expectTold(b, "fo-seats-at:open:all", [added.ops]);
      await assertCopiesHold(b, copies);
    });
  });
}
