import { describe, expect, test } from "bun:test";
import { shape, type Ui } from "./desk";
import { desk } from "../compartments/desk";
import type { PatchOp } from "dzql/rendering/json-patch";

describe("the desk (the ticker's session)", () => {
  test("the desk keeps one address: a window it has, and over it a symbol, the clock, the ask or the asking-first; anywhere else is nowhere", () => {
    const go = (ui: Ui, value: unknown) => shape(ui, [{ op: "replace", path: "/page", value }]);
    const to = (page: string): PatchOp[] => [{ op: "replace", path: "/page", value: page }];
    expect(go({}, "board")).toEqual(to("board"));
    expect(go({}, "board?symbol= brvo ")).toEqual(to("board?symbol=BRVO")); // a symbol is kept as the market writes it
    for (const there of ["board?confirm=BRVO", "board?new", "?clock", "market?symbol=CHRL"]) expect(go({}, there)).toEqual(to(there));
    // nowhere: a window the desk lacks, a thing that is not a symbol, the ask anywhere but the board, a stray key
    for (const nowhere of ["attic", "market?symbol=not a symbol", "market?new", "board?attic=1"]) expect(go({ page: "?clock" }, nowhere)).toEqual([]);
    expect(go({ page: "?clock" }, "?clock")).toEqual([]); // there already
    expect(shape({ page: "?clock" }, [{ op: "replace", path: "/attic", value: 1 }])).toEqual([]);
    expect(shape({ page: "?clock" }, [{ op: "remove", path: "/page" }])).toEqual(to(""));
  });

  test("a reading, find's word and the eye are kept by the collection's name, each field replaced whole; closing find forgets the eye", () => {
    const ui: Ui = { page: "board" };
    expect(shape(ui, [{ op: "replace", path: "/reading/board", value: "list" }, { op: "replace", path: "/filter/market", value: "ch" }, { op: "replace", path: "/hide/market", value: true }])).toEqual([
      { op: "replace", path: "/reading", value: { board: "list" } },
      { op: "replace", path: "/filter", value: { market: "ch" } },
      { op: "replace", path: "/hide", value: { market: true } },
    ]);
    expect(shape(ui, [{ op: "remove", path: "/hide/board" }])).toEqual([]); // no such eye
    expect(shape(ui, [{ op: "remove", path: "/filter/market" }])).toEqual([{ op: "replace", path: "/filter", value: null }, { op: "replace", path: "/hide", value: null }]);
    expect(ui).toEqual({ page: "board", reading: { board: "list" } });
  });

  test("the desk permits what its page writes: a page gone to, and a collection's reading, find's word and its eye by the collection's name; nothing whole, no page removed", () => {
    const may = (op: PatchOp["op"], path: string) => desk.permit!({} as never, op === "remove" ? { op, path } : { op, path, value: "x" }, "x");
    expect(may("replace", "/page")).toBe(true);
    expect(may("remove", "/page")).toBe(false);
    expect(may("replace", "/reading/board")).toBe(true);
    expect(may("remove", "/reading/board")).toBe(false);
    for (const path of ["/filter/market", "/hide/market"]) expect([may("replace", path), may("remove", path)]).toEqual([true, true]);
    for (const path of ["/reading", "/filter", "/hide", "/filter/market/x", "/attic"]) expect([may("replace", path), may("remove", path)]).toEqual([false, false]);
  });
});
