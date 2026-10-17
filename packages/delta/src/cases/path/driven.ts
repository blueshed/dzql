/**
 * What the law over generated writes found, pinned as the seeds that met it. Part of `pathCases`.
 */
import { describe, expect, test } from "bun:test";
import { household } from "./fixture";
import { type PathBackend, openAll, assertCopiesHold, write, expectSilent } from "./law";

/**
 * What the law over generated writes (tests/law-driver.test.ts)
 * found, each pinned as the seed that met it, on every backend.
 */
export function drivenCases(backend: () => PathBackend): void {
  describe("found by the law over generated writes", () => {
    test("a refused write spends the serials it took, as a Postgres sequence does: the next rows are named the same on every backend (seed 1)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-board:2"]);
      // a course, and a drink under a course the other wedding's board does not hold (404)
      const refused = await b.process.call("delta", { doc: "fo-board:2", ops: [{ op: "add", path: "/courses/-", value: { name: "Fish" } }, { op: "add", path: "/drinks/-", value: { courses_id: 1, name: "Port" } }] });
      expect(refused.error?.code).toBe(404);
      const { ops } = await write(b.process, "fo-board:1", [{ op: "add", path: "/courses/-", value: { name: "Stew" } }, { op: "add", path: "/drinks/-", value: { courses_id: 1, name: "Port" } }]);
      expect(ops.map((o: any) => o.path)).toEqual(["/courses/4", "/drinks/4"]);
      await assertCopiesHold(b, copies);
    });

    test("a batch is asked op by op on every backend: one the schema refuses (400) leaves the serials the ops before it took spent, and the first refusal answers -- a 404 before a 400, a 400 before a 404; but a path that is no JSON Pointer is refused before any op, and a parent key given is an id", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1", "fo-board:2", "fo-course:2"]);
      const code = async (ops: unknown[]) => (await b.process.call("delta", { doc: "fo-board:1", ops })).error?.code;
      const fish = { op: "add", path: "/courses/-", value: { name: "Fish" } };
      expect(await code([fish, { op: "add", path: "/courses/-", value: { nope: 1 } }])).toBe(400);
      expect(await code([fish, { op: "replace", path: "/courses/1/name", value: 5 }])).toBe(400);
      expect(await code([{ op: "remove", path: "/courses/99" }, { op: "replace", path: "/courses/1/nope", value: 1 }])).toBe(404);
      expect(await code([{ op: "replace", path: "/courses/1/nope", value: 1 }, { op: "remove", path: "/courses/99" }])).toBe(400);
      expect(await code([fish, { op: "add", path: "/nowhere/-", value: {} }])).toBe(400);
      expect(await code([fish, { op: "remove", path: "/courses/99" }, { op: "remove", path: "courses" }])).toBe(400);   // nothing taken
      expect(await code([fish, { op: "add", path: "/drinks/-", value: { courses_id: true, name: "Port" } }])).toBe(400);
      const { ops } = await write(b.process, "fo-board:1", [fish]);
      expect(ops.map((o: any) => o.path)).toEqual(["/courses/7"]);
      // a document whose root is gone answers a path that is no pointer as the mistake it is
      await write(b.process, "fo-board:2", [{ op: "remove", path: "/courses/2" }]);
      const other = await b.process.call("delta", { doc: "fo-course:2", ops: [{ op: "remove", path: "courses" }] });
      expect(other.error?.code).toBe(400);
      await assertCopiesHold(b, copies);
    });

    // A refused write names none ("a write refused part way names no id", #71); a write that lands keeps it passed
    test("an id a write named stays passed once its row is gone, as setval's does: the next is past it on every backend (review)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-slots-of:1"]);
      await write(b.process, "fo-slots-of:1", [{ op: "add", path: "/slots/50", value: {} }]);
      await write(b.process, "fo-slots-of:1", [{ op: "remove", path: "/slots/50" }]);
      const { ops } = await write(b.process, "fo-slots-of:1", [{ op: "add", path: "/slots/-", value: {} }]);
      expect(ops.map((o: any) => o.path)).toEqual(["/slots/51"]);
      await assertCopiesHold(b, copies);
    });

    test("a value is of its column's type on every backend: a time is ISO-8601 (400 for anything else, not a 500) and reads back in UTC as Postgres gives it; a parent key that is text and no number is a mistake (400) (review)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-slots-of:1", "fo-seating:1", "fo-all-courses:"]);
      const code = async (doc: string, ops: unknown[]) => (await b.process.call("delta", { doc, ops })).error?.code;
      for (const starts of ["nope", "2021-02-30", "2021-01-01T24:00", "Jan 1 2021", 5]) {
        expect({ starts, code: await code("fo-slots-of:1", [{ op: "add", path: "/slots/-", value: { starts } }]) }).toEqual({ starts, code: 400 });
      }
      const { ops } = await write(b.process, "fo-slots-of:1", [
        { op: "add", path: "/slots/-", value: { starts: "2021-01-01T10:00:00+02:00", price: 3 } },
        { op: "add", path: "/slots/-", value: { starts: "2021-01-01" } },
        { op: "add", path: "/slots/-", value: { starts: "2021-01-01 10:00:00.5" } },
      ]);
      expect(ops.map((o: any) => o.value.starts)).toEqual(["2021-01-01T08:00:00+00:00", "2021-01-01T00:00:00+00:00", "2021-01-01T10:00:00.5+00:00"]);
      expect(await code("fo-seating:1", [{ op: "add", path: "/seats/-", value: { table_no: 5, kept: 1 } }])).toBe(400);
      expect(await code("fo-seating:1", [{ op: "add", path: "/seats/-", value: { table_no: "5", kept: true } }])).toBe(400);
      expect(await code("fo-seating:1", [{ op: "replace", path: "/seats/1/weddings_id", value: "abc" }])).toBe(400);
      expect(await code("fo-all-courses:", [{ op: "add", path: "/courses/-", value: { name: "x", weddings_id: "abc" } }])).toBe(400);
      await assertCopiesHold(b, copies);
    });

    test("a row is never added or moved under a parent that is not there (404), whatever document it comes through -- a list names a parent only by key; an implied plan's wedding is there once the plan is written (seeds 2 to 5)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-all-courses:", "fo-catalog:", "fo-plan:7", "fo-all-households:"]);
      const code = async (doc: string, ops: unknown[]) => (await b.process.call("delta", { doc, ops })).error?.code;
      expect(await code("fo-all-courses:", [{ op: "add", path: "/courses/-", value: { weddings_id: 7, name: "Fish" } }])).toBe(404);
      expect(await code("fo-all-courses:", [{ op: "replace", path: "/courses/1/weddings_id", value: 9 }])).toBe(404);
      expect(await code("fo-all-households:", [{ op: "replace", path: "/households/1", value: household(1, "a@x", 9) }])).toBe(404);
      expect(await code("fo-catalog:", [{ op: "add", path: "/drinks/-", value: { courses_id: 9, name: "Port" } }])).toBe(404);
      expect(await code("fo-catalog:", [{ op: "replace", path: "/drinks/1/courses_id", value: 9 }])).toBe(404);
      await expectSilent(b, ...copies.keys());
      await write(b.process, "fo-plan:7", [{ op: "replace", path: "/weddings/name", value: "planned" }]);
      await write(b.process, "fo-all-courses:", [{ op: "add", path: "/courses/-", value: { weddings_id: 7, name: "Fish" } }]);
      await assertCopiesHold(b, copies);
    });

    test("an undo that would put a drink back through its course's own document, the course removed since, is a conflict on every backend: no drink under a course that is not there (seed 25)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-course:1", "fo-board:1", "fo-catalog:"]);
      await write(b.process, "fo-course:1", [{ op: "remove", path: "/drinks/1" }], { cursor: "ada" });
      await write(b.process, "fo-board:1", [{ op: "remove", path: "/courses/1" }], { cursor: "bob" });
      const undone = await b.process.call("undo", { cursor: "ada" });
      expect({ ops: undone.result.ops, conflict: undone.result.conflict }).toEqual({ ops: [], conflict: ["/drinks/1"] });
      await assertCopiesHold(b, copies);
    });

    test("a cascade is told in one order on every backend -- each child collection by key, each row by id -- a course moved in since, which Postgres keeps last, too (seeds 2, 4, 5)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:2", "fo-all-courses:"]);
      await write(b.process, "fo-all-courses:", [{ op: "add", path: "/courses/-", value: { weddings_id: 2, name: "Fish" } }]);
      await write(b.process, "fo-all-courses:", [{ op: "replace", path: "/courses/1/weddings_id", value: 2 }]);
      const { ops } = await write(b.process, "fo-board:2", [{ op: "remove", path: "/weddings/2" }]);
      expect(ops.map((o: any) => o.path)).toEqual(["/weddings/2", "/courses/1", "/drinks/1", "/courses/2", "/drinks/2", "/courses/3", "/households/3"]);
      await assertCopiesHold(b, copies);
    });

    test("an add of a row already there is 409 before its parent is asked, on every backend (seed 8)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-board:1"]);
      expect((await b.process.call("delta", { doc: "fo-board:1", ops: [{ op: "add", path: "/drinks/1", value: { courses_id: 99, name: "Port" } }] })).error?.code).toBe(409);
      await assertCopiesHold(b, copies);
    });

    test("a menu card whose wedding is removed is let go (404) and told so, not left holding the wedding; opened again once it is back (seed 6)", async () => {
      const b = backend();
      const copies = await openAll(b.process, ["fo-menu-card:2", "fo-board:2"]);
      await write(b.process, "fo-board:2", [{ op: "remove", path: "/weddings/2" }], { cursor: "s1" });
      await b.quiet();
      expect(b.process.heard.filter((h) => h.channel === "fo-menu-card:2").map((h) => h.data)).toEqual([{ doc: "fo-menu-card:2", error: { code: 404, message: "Not found" } }]);
      expect((await b.process.call("open", { doc: "fo-menu-card:2" })).error?.code).toBe(404);
      await assertCopiesHold(b, copies);
      expect((await b.process.call("undo", { cursor: "s1" })).result.conflict).toBeUndefined();
      expect((await b.process.call("open", { doc: "fo-menu-card:2" })).result).toEqual({ wedding: "theirs", courses: ["Salad"] });
    });
  });
}
