import { describe, expect, test } from "bun:test";
import { applyPatch, isWriteId, patchMessage, refusedMessage } from "./json-patch";

describe("a write's answers", () => {
  test("its echo carries its id to its writer, and to nobody else; its refusal carries the id, and why when it says", () => {
    const ops = [{ op: "replace" as const, path: "/text", value: "hi" }];
    expect(JSON.parse(patchMessage("note", 3, ops, 7))).toEqual({ type: "patch", doc: "note", version: 3, ops, id: 7 });
    expect(JSON.parse(patchMessage("note", 3, ops))).toEqual({ type: "patch", doc: "note", version: 3, ops });
    expect(JSON.parse(refusedMessage("w-1", "A note needs words."))).toEqual({ type: "refused", id: "w-1", reason: "A note needs words." });
    expect(JSON.parse(refusedMessage(0))).toEqual({ type: "refused", id: 0 });
  });

  test("an id is a number or a string, the sender's own", () => {
    expect([0, 7, "w-1", ""].every(isWriteId)).toBe(true);
    expect([undefined, null, {}, [1], true].some(isWriteId)).toBe(false);
  });
});

describe("applyPatch", () => {
  test("adds, replaces and removes members and array items, on a copy", () => {
    const value = { a: 1, list: ["x", "z"], nested: { b: 2 } };
    const out = applyPatch<object>(value, [
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
