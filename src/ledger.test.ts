import { describe, expect, test } from "bun:test";
import { history, record } from "./ledger";

describe("ledger", () => {
  test("history is empty for a doc with no recorded patches", () => {
    expect(history(`test:${crypto.randomUUID()}`)).toEqual([]);
  });

  test("recording with no ops returns the current version unchanged", () => {
    expect(record(`test:${crypto.randomUUID()}`, [], [], "session-x")).toBe(0);
  });

  test("version increments per doc; history reads back newest first", () => {
    const doc = `test:${crypto.randomUUID()}`;

    const v1 = record(doc, [{ op: "replace", path: "/x", value: 1 }], [{ op: "replace", path: "/x", value: 0 }], "a");
    const v2 = record(doc, [{ op: "replace", path: "/x", value: 2 }], [{ op: "replace", path: "/x", value: 1 }], "b");

    expect(v1).toBe(1);
    expect(v2).toBe(2);

    const entries = history(doc);
    expect(entries.map((e) => e.version)).toEqual([2, 1]);
    expect(entries[0]?.sessionId).toBe("b");
    expect(entries[0]?.inverse).toEqual([{ op: "replace", path: "/x", value: 1 }]);
    expect(entries[1]?.sessionId).toBe("a");
  });

  test("different docs have independent version counters", () => {
    const docA = `test:${crypto.randomUUID()}`;
    const docB = `test:${crypto.randomUUID()}`;

    record(docA, [{ op: "add", path: "/x", value: 1 }], [{ op: "remove", path: "/x" }], "a");
    const versionB = record(docB, [{ op: "add", path: "/x", value: 1 }], [{ op: "remove", path: "/x" }], "b");

    expect(versionB).toBe(1);
  });

  test("history respects the limit", () => {
    const doc = `test:${crypto.randomUUID()}`;
    for (let i = 0; i < 5; i++) {
      record(doc, [{ op: "replace", path: "/x", value: i }], [{ op: "replace", path: "/x", value: i - 1 }], "a");
    }

    const entries = history(doc, 2);
    expect(entries.map((e) => e.version)).toEqual([5, 4]);
  });
});
