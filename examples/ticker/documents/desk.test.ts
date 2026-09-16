import { describe, expect, test } from "bun:test";
import { history } from "../../../src/ledger";
import { patch, read } from "./desk";

describe("the desk (the ticker's tray)", () => {
  test("a fresh session has nothing open; what opens closes the drawer and the modals; unknown compartments do not open", () => {
    const id = crypto.randomUUID();
    expect(read(id)).toEqual({});
    patch(id, [{ op: "replace", path: "/open", value: "board" }, { op: "replace", path: "/focus", value: "brvo" }, { op: "replace", path: "/new", value: "board" }, { op: "replace", path: "/confirm", value: "BRVO" }]);
    expect(read(id)).toEqual({ open: "board", focus: "BRVO", new: "board", confirm: "BRVO" });
    patch(id, [{ op: "replace", path: "/open", value: "market" }]);
    expect(read(id)).toEqual({ open: "market" });
    expect(patch(id, [{ op: "replace", path: "/open", value: "attic" }, { op: "replace", path: "/new", value: "market" }, { op: "replace", path: "/focus", value: "not a symbol" }, { op: "replace", path: "/attic", value: 1 }]).applied).toEqual([]);
    patch(id, [{ op: "remove", path: "/open" }, { op: "replace", path: "/focus", value: "clock" }]);
    expect(read(id)).toEqual({ focus: "clock" });
    patch(id, [{ op: "remove", path: "/focus" }, { op: "remove", path: "/new" }, { op: "remove", path: "/confirm" }]);
    expect(read(id)).toEqual({});
  });

  test("a reading, find's word and the eye are kept by the collection's name; closing find forgets the eye; nothing is on the ledger", () => {
    const id = crypto.randomUUID();
    patch(id, [{ op: "replace", path: "/reading/board", value: "list" }, { op: "replace", path: "/filter/market", value: "ch" }, { op: "replace", path: "/hide/market", value: true }]);
    expect(read(id)).toEqual({ reading: { board: "list" }, filter: { market: "ch" }, hide: { market: true } });
    expect(patch(id, [{ op: "remove", path: "/hide/board" }]).applied).toEqual([]); // no such eye
    patch(id, [{ op: "remove", path: "/filter/market" }]);
    expect(read(id)).toEqual({ reading: { board: "list" } });
    patch(id, [{ op: "replace", path: "/hide/market", value: true }, { op: "remove", path: "/hide/market" }, { op: "remove", path: "/reading/board" }]);
    expect(read(id)).toEqual({});
    expect(history(`desk/${id}`)).toEqual([]);
  });
});
