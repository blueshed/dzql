import { describe, expect, test } from "bun:test";
import { applyPatch } from "./json-patch";

describe("applyPatch", () => {
  test("adds, replaces and removes members and array items, on a copy", () => {
    const value = { a: 1, list: ["x", "z"], nested: { b: 2 } };
    const out = applyPatch(value, [
      { op: "replace", path: "/a", value: 9 },
      { op: "add", path: "/c", value: 3 },
      { op: "add", path: "/list/1", value: "y" },
      { op: "add", path: "/list/-", value: "end" },
      { op: "replace", path: "/list/0", value: "w" },
      { op: "remove", path: "/list/3" },
      { op: "remove", path: "/nested/b" },
    ]);
    expect(out).toEqual({ a: 9, c: 3, list: ["w", "y", "z"], nested: {} });
    expect(value).toEqual({ a: 1, list: ["x", "z"], nested: { b: 2 } });
  });

  test("an op that does not land says so", () => {
    expect(() => applyPatch({ a: 1 }, [{ op: "replace", path: "/b", value: 1 }])).toThrow("no such member");
    expect(() => applyPatch({ a: 1 }, [{ op: "add", path: "/x/y", value: 1 }])).toThrow("no such path");
    expect(() => applyPatch({ l: [1] }, [{ op: "replace", path: "/l/1", value: 1 }])).toThrow("no such index");
    expect(() => applyPatch({ l: [1] }, [{ op: "add", path: "/l/5", value: 1 }])).toThrow("no such index");
  });
});
