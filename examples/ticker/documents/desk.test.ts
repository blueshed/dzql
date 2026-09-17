import { describe, expect, test } from "bun:test";
import { history } from "../../../src/ledger";
import { patch, read } from "./desk";

describe("the desk (the ticker's tray)", () => {
  test("the desk keeps one address: a window it has, and over it a symbol, the clock, the ask or the asking-first; anywhere else is nowhere", () => {
    const id = crypto.randomUUID();
    expect(read(id)).toEqual({});
    const go = (value: unknown) => patch(id, [{ op: "replace", path: "/page", value }]).applied.length;
    expect(go("board")).toBe(1);
    expect(go("board?symbol= brvo ")).toBe(1); // a symbol is kept as the market writes it
    expect(read(id)).toEqual({ page: "board?symbol=BRVO" });
    expect(go("board?confirm=BRVO")).toBe(1);
    expect(go("board?new")).toBe(1);
    expect(go("?clock")).toBe(1);
    expect(read(id)).toEqual({ page: "?clock" });
    // nowhere: a window the desk lacks, a thing that is not a symbol, the ask anywhere but the board, a stray key
    for (const nowhere of ["attic", "market?symbol=not a symbol", "market?new", "board?attic=1", undefined]) expect(go(nowhere === undefined ? "attic" : nowhere)).toBe(0);
    expect(patch(id, [{ op: "replace", path: "/attic", value: 1 }]).applied).toEqual([]);
    expect(read(id)).toEqual({ page: "?clock" });
    patch(id, [{ op: "remove", path: "/page" }]);
    expect(read(id)).toEqual({ page: "" });
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
