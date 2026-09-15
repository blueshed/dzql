import { describe, expect, test } from "bun:test";
import { history, nextRedo, nextUndo, record } from "./ledger";

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

  test("nextUndo is undefined for a session with no writes", () => {
    expect(nextUndo(crypto.randomUUID())).toBeUndefined();
  });

  test("nextUndo finds the newest write by this session, across docs", () => {
    const session = crypto.randomUUID();
    const docA = `test:${crypto.randomUUID()}`;
    const docB = `test:${crypto.randomUUID()}`;

    record(docA, [{ op: "replace", path: "/x", value: 1 }], [{ op: "replace", path: "/x", value: 0 }], session);
    record(docB, [{ op: "replace", path: "/y", value: 1 }], [{ op: "replace", path: "/y", value: 0 }], session);
    record(docA, [{ op: "replace", path: "/x", value: 2 }], [{ op: "replace", path: "/x", value: 1 }], "someone-else");

    const entry = nextUndo(session);
    expect(entry?.doc).toBe(docB);
    expect(entry?.inverse).toEqual([{ op: "replace", path: "/y", value: 0 }]);
  });

  test("recording with `undoes` excludes both the original and the undo entry from future candidates", () => {
    const session = crypto.randomUUID();
    const doc = `test:${crypto.randomUUID()}`;

    record(doc, [{ op: "replace", path: "/x", value: 1 }], [{ op: "replace", path: "/x", value: 0 }], session);
    const original = nextUndo(session)!;
    expect(original.inverse).toEqual([{ op: "replace", path: "/x", value: 0 }]);

    record(doc, original.inverse, [{ op: "replace", path: "/x", value: 1 }], session, original.id);

    // walking back past the just-applied undo (a cursor, not a toggle): with
    // nothing earlier to undo, there is no candidate left at all.
    expect(nextUndo(session)).toBeUndefined();
  });

  test("nextUndo walks further back after each undo, not back and forth over the same write", () => {
    const session = crypto.randomUUID();
    const doc = `test:${crypto.randomUUID()}`;

    record(doc, [{ op: "replace", path: "/x", value: 1 }], [{ op: "replace", path: "/x", value: 0 }], session);
    record(doc, [{ op: "replace", path: "/x", value: 2 }], [{ op: "replace", path: "/x", value: 1 }], session);

    const first = nextUndo(session)!;
    expect(first.inverse).toEqual([{ op: "replace", path: "/x", value: 1 }]); // undoes the second write

    record(doc, first.inverse, [{ op: "replace", path: "/x", value: 2 }], session, first.id);

    const second = nextUndo(session)!;
    expect(second.inverse).toEqual([{ op: "replace", path: "/x", value: 0 }]); // now the first write, not first again
  });

  test("redo walks the cursor forward again: undo, undo, redo, redo; and undo after a redo walks the redo back", () => {
    const session = crypto.randomUUID();
    const doc = `test:${crypto.randomUUID()}`;
    const set = (to: number, from: number, undoes?: number) =>
      record(doc, [{ op: "replace", path: "/x", value: to }], [{ op: "replace", path: "/x", value: from }], session, undoes);

    expect(nextRedo(session)).toBeUndefined(); // nothing undone yet
    set(1, 0); // A
    set(2, 1); // B
    const undoB = nextUndo(session)!;
    set(1, 2, undoB.id); // undo B
    const undoA = nextUndo(session)!;
    expect(undoA.ops).toEqual([{ op: "replace", path: "/x", value: 1 }]);
    set(0, 1, undoA.id); // undo A
    expect(nextUndo(session)).toBeUndefined();

    // redo: the newest undo, walked forward -- A first, then B
    let redo = nextRedo(session)!;
    expect(redo.inverse).toEqual([{ op: "replace", path: "/x", value: 1 }]); // A's ops again
    set(1, 0, redo.id);
    redo = nextRedo(session)!;
    expect(redo.inverse).toEqual([{ op: "replace", path: "/x", value: 2 }]); // B's ops again
    set(2, 1, redo.id);
    expect(nextRedo(session)).toBeUndefined();

    // and undo now walks the redo of B back, not B itself a second time
    const again = nextUndo(session)!;
    expect(again.inverse).toEqual([{ op: "replace", path: "/x", value: 1 }]);
    set(1, 2, again.id);
    expect(nextRedo(session)!.id).toBe(history(doc, 1)[0]!.id);
  });

  test("a fresh write after an undo ends what could be redone", () => {
    const session = crypto.randomUUID();
    const doc = `test:${crypto.randomUUID()}`;
    record(doc, [{ op: "replace", path: "/x", value: 1 }], [{ op: "replace", path: "/x", value: 0 }], session);
    const undone = nextUndo(session)!;
    record(doc, undone.inverse, undone.ops, session, undone.id);
    expect(nextRedo(session)).toBeDefined();
    record(doc, [{ op: "replace", path: "/y", value: 1 }], [{ op: "remove", path: "/y" }], session);
    expect(nextRedo(session)).toBeUndefined();
  });

  test("another session's undo is never this session's to redo", () => {
    const a = crypto.randomUUID();
    const doc = `test:${crypto.randomUUID()}`;
    record(doc, [{ op: "replace", path: "/x", value: 1 }], [{ op: "replace", path: "/x", value: 0 }], a);
    const undone = nextUndo(a)!;
    record(doc, undone.inverse, undone.ops, a, undone.id);
    expect(nextRedo(crypto.randomUUID())).toBeUndefined();
  });
});
