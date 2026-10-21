/**
 * What every backend answers alike about a write, asked through the wire
 * alone: the error-code table, a row the server names (`add /<coll>/-`), and
 * write scope (a document writes only the rows it reads). Each case stands
 * up a small app of its own -- a schema, its documents, its rows -- through
 * the backend's `CaseBackend`, and checks what a fresh open reads, never the
 * tables, so a backend is asked only what a client could see.
 *
 *   errorCodeCases(standUp);
 *   refusalCases(standUp);
 *   createRowCases(standUp);
 *   writeScopeCases(standUp);
 *   uniqueCases(standUp);
 *   acceptCases(standUp);
 *   shapeCases(standUp);
 *   refsCases(standUp);
 *   serverTimeCases(standUp);
 *
 * where `standUp({ schema, docs, seed })` makes a fresh store with that
 * schema, those documents registered and those rows imported, and answers a
 * `WsServer` serving them and an `end()`.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { applyOps, splitPath } from "../core";
import { defineDoc, defineSchema, type DocDef, type Schema, type Snapshot } from "../schema";
import type { WsServer } from "../server/server";
import { mockClient, sendAndAwait, waitFor } from "./support";

/** An app for a case: what a backend stands up on a fresh store (on the ledger, `ledger: true`). */
export interface CaseApp { schema: Schema; docs: DocDef[]; seed: Snapshot; ledger?: boolean }
/** A backend's stand-up: a server over a fresh store holding the app, and how to take it down. */
export type CaseBackend = (app: CaseApp) => Promise<{ ws: WsServer; end(): Promise<void> }>;

/** A fresh open of `doc`, as another client reads it: the truth a case checks against. */
async function fresh(ws: WsServer, doc: string): Promise<any> {
  const r = await sendAndAwait(ws, mockClient({ clientId: "reader" }), { action: "open", doc });
  return r.result;
}

// ---------------------------------------------------------------------------
// A room and its messages: the error table and a server-named row
// ---------------------------------------------------------------------------

export const roomsApp: CaseApp = {
  schema: defineSchema({
    case_rooms: { columns: { title: "text" }, temporal: false },
    case_messages: { columns: { text: "text" }, parent: { collection: "case_rooms", fk: "case_rooms_id" }, temporal: false },
  }),
  docs: [defineDoc("case-room:", { root: "case_rooms", include: ["case_messages"] })],
  seed: {
    tables: {
      case_rooms: [{ id: 1, title: "general" }, { id: 2, title: "random" }],
      case_messages: [{ id: 7, case_rooms_id: 1, text: "hi" }, { id: 8, case_rooms_id: 2, text: "elsewhere" }],
    },
  },
};

const TAKEN = "-- add to /case_messages/- for a new id";
const ALONE = "case-room:1 holds case_rooms 1 alone: add another case_rooms row through a document that lists them";

/**
 * The mistakes, each answered with one code on every backend (400 malformed, 404 not there, 409
 * already there), in the same words: a row the document does not hold (not there, or another
 * room's) is not found, and a single document adds no root row but its own.
 */
export const mistakes: Record<string, { ops: unknown[]; code: number; message: string }> = {
  "a path without a leading slash": { ops: [{ op: "remove", path: "case_messages" }], code: 400, message: `Invalid JSON Pointer "case_messages": a path starts with "/" ("" is the whole document)` },
  "a row that is not there": { ops: [{ op: "replace", path: "/case_messages/404/text", value: "x" }], code: 404, message: "Row not found: case_messages/404" },
  "a remove of a row that is not there": { ops: [{ op: "remove", path: "/case_messages/404" }], code: 404, message: "Row not found: case_messages/404" },
  "a row replaced whole that is not there": { ops: [{ op: "replace", path: "/case_messages/404", value: { text: "x" } }], code: 404, message: "Row not found: case_messages/404" },
  "another room's row": { ops: [{ op: "replace", path: "/case_messages/8/text", value: "x" }], code: 404, message: "Row not found: case_messages/8" },
  "a remove of another room's row": { ops: [{ op: "remove", path: "/case_messages/8" }], code: 404, message: "Row not found: case_messages/8" },
  "another root row's field": { ops: [{ op: "replace", path: "/case_rooms/2/title", value: "x" }], code: 404, message: "Row not found: case_rooms/2" },
  "a remove of another root row": { ops: [{ op: "remove", path: "/case_rooms/2" }], code: 404, message: "Row not found: case_rooms/2" },
  "an add of another root row": { ops: [{ op: "add", path: "/case_rooms/-", value: { title: "x" } }], code: 400, message: ALONE },
  "an add of another root row, by its id": { ops: [{ op: "add", path: "/case_rooms/3", value: { title: "x" } }], code: 400, message: ALONE },
  "an add of the root that is there": { ops: [{ op: "add", path: "/case_rooms/1", value: { title: "x" } }], code: 409, message: "Id already taken: /case_rooms/1 -- add to /case_rooms/- for a new id" },
  "an unknown field": { ops: [{ op: "replace", path: "/case_messages/7/nope", value: "x" }], code: 400, message: "/case_messages/7/nope: Unknown field: nope" },
  "a field named after Object.prototype": { ops: [{ op: "replace", path: "/case_messages/7/toString", value: "x" }], code: 400, message: "/case_messages/7/toString: Unknown field: toString" },
  "an add of a row that is already there": { ops: [{ op: "add", path: "/case_messages/7", value: { text: "again" } }], code: 409, message: `Id already taken: /case_messages/7 ${TAKEN}` },
  "an add of a row another room holds": { ops: [{ op: "add", path: "/case_messages/8", value: { text: "again" } }], code: 409, message: `Id already taken: /case_messages/8 ${TAKEN}` },
  "an add that leaves out a required field": { ops: [{ op: "add", path: "/case_messages/-", value: {} }], code: 400, message: "/case_messages/-: Required field missing: text (give it a value, or declare a default or make it nullable in the schema)" },
  "a remove of a field": { ops: [{ op: "remove", path: "/case_messages/7/text" }], code: 400, message: "/case_messages/7/text: Invalid op: remove /case_messages/7/text" },
  "an add of a field": { ops: [{ op: "add", path: "/case_messages/7/text", value: "x" }], code: 400, message: "/case_messages/7/text: Invalid op: add /case_messages/7/text" },
  "an op that is not an object": { ops: [null], code: 400, message: "An op is an object: { op, path, value }" },
};

/** The same mistake, the same code and words: every one of `mistakes`, the whole sentence, and nothing changed by any. */
export function errorCodeCases(backend: CaseBackend): void {
  describe("the same mistake, the same code", () => {
    let up: Awaited<ReturnType<CaseBackend>>;
    beforeAll(async () => { up = await backend(roomsApp); });
    afterAll(async () => { await up.end(); });

    for (const [name, { ops, code, message }] of Object.entries(mistakes)) {
      test(`${name}: ${code}`, async () => {
        const c = mockClient();
        await sendAndAwait(up.ws, c, { action: "open", doc: "case-room:1" });
        const r = await sendAndAwait(up.ws, c, { action: "delta", doc: "case-room:1", ops });
        expect(r.error).toEqual({ code, message });
        const now = await fresh(up.ws, "case-room:1");
        expect(now.case_rooms).toEqual({ id: 1, title: "general" });
        expect(Object.values(now.case_messages)).toEqual([{ id: 7, case_rooms_id: 1, text: "hi" }]);
        const other = await fresh(up.ws, "case-room:2");
        expect(other.case_rooms).toEqual({ id: 2, title: "random" });
        expect(Object.values(other.case_messages)).toEqual([{ id: 8, case_rooms_id: 2, text: "elsewhere" }]);
      });
    }

    test("a document whose root is not there: not found (404), opened or written through, in the same words", async () => {
      const c = mockClient();
      expect((await sendAndAwait(up.ws, c, { action: "open", doc: "case-room:3" })).error).toEqual({
        code: 404, message: "Not found: no case_rooms row 3. Make the row first, or declare the document implied: true",
      });
      const written = await sendAndAwait(up.ws, c, { action: "delta", doc: "case-room:3", ops: [{ op: "add", path: "/case_messages/-", value: { text: "x" } }] });
      expect(written.error).toEqual({ code: 404, message: "Document not found: case-room:3 (its root, /case_rooms/3, is not there)" });
    });

    // the wire's rule: a connection writes only what it has opened -- though another holds it open, and once it has closed it
    test("a write through a document this connection has not opened: not loaded (404), and nothing changed", async () => {
      const notLoaded = { code: 404, message: "Doc not loaded: open case-room:1 before writing to it" };
      const ops = [{ op: "replace", path: "/case_messages/7/text", value: "x" }];
      const holder = mockClient({ clientId: "holder" });
      await sendAndAwait(up.ws, holder, { action: "open", doc: "case-room:1" });
      const c = mockClient({ clientId: "writer" });
      expect((await sendAndAwait(up.ws, c, { action: "delta", doc: "case-room:1", ops })).error).toEqual(notLoaded);
      expect((await sendAndAwait(up.ws, c, { action: "delta", doc: "case-room:2", ops: [] })).error).toEqual({ ...notLoaded, message: notLoaded.message.replace("case-room:1", "case-room:2") });
      await sendAndAwait(up.ws, c, { action: "open", doc: "case-room:1" });
      await sendAndAwait(up.ws, c, { action: "close", doc: "case-room:1" });
      expect((await sendAndAwait(up.ws, c, { action: "delta", doc: "case-room:1", ops })).error).toEqual(notLoaded);
      expect(Object.values((await fresh(up.ws, "case-room:1")).case_messages)).toEqual([{ id: 7, case_rooms_id: 1, text: "hi" }]);
      await sendAndAwait(up.ws, c, { action: "open", doc: "case-room:1" });
      expect((await sendAndAwait(up.ws, c, { action: "delta", doc: "case-room:1", ops: [{ op: "replace", path: "/case_messages/7/text", value: "hi" }] })).error).toBeUndefined();
    });

    // a socket's messages run side by side: a write sent right behind its open, its answer not waited for, is behind it
    test("a write sent right behind its document's open lands", async () => {
      const c = mockClient({ clientId: "eager" });
      const [opened, written] = await Promise.all([
        sendAndAwait(up.ws, c, { action: "open", doc: "case-room:2" }),
        sendAndAwait(up.ws, c, { action: "delta", doc: "case-room:2", ops: [{ op: "replace", path: "/case_messages/8/text", value: "elsewhere" }] }),
      ]);
      expect(opened.error).toBeUndefined();
      expect(written.error).toBeUndefined();
    });

    // createLocal()'s caller (`data.local`) is the server itself, not a connection: it hears every channel
    test("an in-process caller writes a document nobody has open, and its write is there to the next open", async () => {
      const own = await backend(roomsApp);   // its own, so nobody has opened the room before
      try {
        const server = mockClient({ local: true });
        const ops = (text: string) => [{ op: "replace", path: "/case_messages/8/text", value: text }];
        expect((await sendAndAwait(own.ws, server, { action: "delta", doc: "case-room:2", ops: ops("by the server") })).error).toBeUndefined();
        expect((await sendAndAwait(own.ws, server, { action: "delta", doc: "case-room:2", ops: ops("again") })).error).toBeUndefined();
        expect((await fresh(own.ws, "case-room:2")).case_messages["8"].text).toBe("again");
        expect((await sendAndAwait(own.ws, server, { action: "delta", doc: "case-room:3", ops: [] })).error).toEqual({ code: 404, message: "Document not found: case-room:3 (its root, /case_rooms/3, is not there)" });
      } finally {
        await own.end();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// A shelf and its jars: a schema's refusals, in delta's words
// ---------------------------------------------------------------------------

/** A shelf of each column type, its jars under it, and tags no shelf document includes: what a schema refuses. */
export const shelvesApp: CaseApp = {
  schema: defineSchema({
    case_shelves: {
      columns: { label: "text", rank: "integer", width: "real", open: "boolean", checked: "timestamptz", data: "json", note: "text?" },
      temporal: false,
    },
    case_jars: { columns: { name: "text" }, parent: { collection: "case_shelves", fk: "case_shelves_id" }, temporal: false },
    case_tags: { columns: { name: "text" }, temporal: false },
  }),
  docs: [defineDoc("case-shelf:", { root: "case_shelves", include: ["case_jars"] })],
  seed: {
    tables: {
      case_shelves: [{ id: 1, label: "top", rank: 1, width: 1.5, open: true, checked: "2026-01-01T00:00:00.000Z", data: {}, note: null }],
      case_jars: [{ id: 1, case_shelves_id: 1, name: "jam" }],
      case_tags: [],
    },
  },
};

const LEFT_OUT = "(give it a value, or declare a default or make it nullable in the schema)";
const PAST = "is past 2^53 - 1, which no number holds exactly -- add to /case_jars/- and read the id from the echo";

/** What a schema refuses, each in the same words on every backend: the op's path, then why (400); a path that is no pointer, why alone (the write's grammar, asked before any op). */
export const refusals: Record<string, { ops: unknown[]; message: string }> = {
  "a path without a leading slash": { ops: [{ op: "remove", path: "case_jars" }], message: `Invalid JSON Pointer "case_jars": a path starts with "/" ("" is the whole document)` },
  "a ~ not escaped": { ops: [{ op: "replace", path: "/case_jars/1/~x", value: "x" }], message: `Invalid JSON Pointer "/case_jars/1/~x": "~" is written "~0" and "/" is written "~1"` },
  "an empty path": { ops: [{ op: "remove", path: "/" }], message: "/: Empty path" },
  "a collection the schema has not": { ops: [{ op: "add", path: "/case_other/-", value: {} }], message: "/case_other/-: Unknown collection: case_other" },
  "a collection the document does not include": { ops: [{ op: "add", path: "/case_tags/-", value: { name: "x" } }], message: "/case_tags/-: Unknown collection: case_tags" },
  "a whole collection": { ops: [{ op: "remove", path: "/case_jars" }], message: "/case_jars: Whole-collection ops are not supported: remove /case_jars" },
  "an add of the root": { ops: [{ op: "add", path: "/case_shelves", value: { label: "x" } }], message: "/case_shelves: Root supports replace only" },
  "the root replaced by no object": { ops: [{ op: "replace", path: "/case_shelves", value: 5 }], message: "/case_shelves: Replace value must be an object" },
  "a row added as no object": { ops: [{ op: "add", path: "/case_jars/-", value: "x" }], message: "/case_jars/-: Add value must be an object" },
  "a row replaced by no object": { ops: [{ op: "replace", path: "/case_jars/1", value: [] }], message: "/case_jars/1: Replace value must be an object" },
  "an unknown field of a row added": { ops: [{ op: "add", path: "/case_jars/-", value: { name: "x", nope: 1 } }], message: "/case_jars/-: Unknown field: nope" },
  "an unknown field of a row replaced": { ops: [{ op: "replace", path: "/case_jars/1", value: { name: "x", nope: 1 } }], message: "/case_jars/1: Unknown field: nope" },
  "an unknown field": { ops: [{ op: "replace", path: "/case_jars/1/nope", value: "x" }], message: "/case_jars/1/nope: Unknown field: nope" },
  "an unknown field of the root": { ops: [{ op: "replace", path: "/case_shelves/nope", value: "x" }], message: "/case_shelves/nope: Unknown field: nope" },
  "a field named after Object.prototype": { ops: [{ op: "replace", path: "/case_jars/1/toString", value: "x" }], message: "/case_jars/1/toString: Unknown field: toString" },
  "a row's id as a field": { ops: [{ op: "replace", path: "/case_jars/1/id", value: 2 }], message: "/case_jars/1/id: Unknown field: id" },
  "a required field left out of an add": { ops: [{ op: "add", path: "/case_jars/-", value: {} }], message: `/case_jars/-: Required field missing: name ${LEFT_OUT}` },
  "a required field left out of a row replaced": { ops: [{ op: "replace", path: "/case_jars/1", value: {} }], message: `/case_jars/1: Required field missing: name ${LEFT_OUT}` },
  "a remove of a field": { ops: [{ op: "remove", path: "/case_jars/1/name" }], message: "/case_jars/1/name: Invalid op: remove /case_jars/1/name" },
  "an add of a field": { ops: [{ op: "add", path: "/case_jars/1/name", value: "x" }], message: "/case_jars/1/name: Invalid op: add /case_jars/1/name" },
  "a path past a field": { ops: [{ op: "replace", path: "/case_jars/1/name/x", value: "x" }], message: "/case_jars/1/name/x: Invalid op: replace /case_jars/1/name/x" },
  "a row id past 2^53 - 1": { ops: [{ op: "replace", path: "/case_jars/9007199254740993/name", value: "x" }], message: `/case_jars/9007199254740993/name: Row id 9007199254740993 ${PAST}` },
  "a string not given": { ops: [{ op: "replace", path: "/case_shelves/label", value: 5 }], message: "/case_shelves/label: label must be a string" },
  "an integer not given": { ops: [{ op: "replace", path: "/case_shelves/rank", value: 1.5 }], message: "/case_shelves/rank: rank must be an integer" },
  "a number not given": { ops: [{ op: "replace", path: "/case_shelves/width", value: "wide" }], message: "/case_shelves/width: width must be a number" },
  "a boolean not given": { ops: [{ op: "replace", path: "/case_shelves/open", value: "yes" }], message: "/case_shelves/open: open must be a boolean" },
  "a time not given": { ops: [{ op: "replace", path: "/case_shelves/checked", value: "soon" }], message: "/case_shelves/checked: checked must be an ISO-8601 time" },
  "a field of a row added, of the wrong type": { ops: [{ op: "add", path: "/case_jars/-", value: { name: 5 } }], message: "/case_jars/-/name: name must be a string" },
  "a field of a row replaced, of the wrong type": { ops: [{ op: "replace", path: "/case_jars/1", value: { name: true } }], message: "/case_jars/1/name: name must be a string" },
  "a null where none is taken": { ops: [{ op: "replace", path: "/case_shelves/label", value: null }], message: "/case_shelves/label: label cannot be null" },
  "a null json where none is taken": { ops: [{ op: "replace", path: "/case_shelves/data", value: null }], message: "/case_shelves/data: data cannot be null" },
  "a parent key set to null": { ops: [{ op: "replace", path: "/case_jars/1/case_shelves_id", value: null }], message: "/case_jars/1/case_shelves_id: case_shelves_id cannot be null" },
  "a parent key that is no id": { ops: [{ op: "replace", path: "/case_jars/1/case_shelves_id", value: 1.5 }], message: "/case_jars/1/case_shelves_id: case_shelves_id must be an id: an integer, or text" },
  // text that is no whole number names no row: the sentence alone, once the value is otherwise as it may be written
  "a parent key that is text and no number": { ops: [{ op: "replace", path: "/case_jars/1/case_shelves_id", value: "x" }], message: `case_shelves "x" names no row: an id is a whole number` },
  "a row moved under text that is no number": { ops: [{ op: "replace", path: "/case_jars/1", value: { name: "jam", case_shelves_id: "top" } }], message: `case_shelves "top" names no row: an id is a whole number` },
  "a time the calendar has not": { ops: [{ op: "replace", path: "/case_shelves/checked", value: "2026-02-30" }], message: "/case_shelves/checked: checked must be an ISO-8601 time" },
  "a time in a month there is not": { ops: [{ op: "replace", path: "/case_shelves/checked", value: "2026-13-01T10:00:00Z" }], message: "/case_shelves/checked: checked must be an ISO-8601 time" },
  // only what Postgres's timestamptz holds, so no backend keeps a time another cannot: a zone to ±15:59, a year from 0001
  "a time in a zone past +15:59": { ops: [{ op: "replace", path: "/case_shelves/checked", value: "2021-01-01T00:00:00+16:00" }], message: "/case_shelves/checked: checked must be an ISO-8601 time" },
  "a time in a zone past -15:59": { ops: [{ op: "replace", path: "/case_shelves/checked", value: "2021-01-01T00:00:00-2000" }], message: "/case_shelves/checked: checked must be an ISO-8601 time" },
  "a time in the year 0": { ops: [{ op: "replace", path: "/case_shelves/checked", value: "0000-01-01" }], message: "/case_shelves/checked: checked must be an ISO-8601 time" },
  // an op wrong in several ways: every refusal of it, joined by "; " -- the fields there are not, then
  // each value not as it may be written, then each required field left out, each kind by name
  "a row added wrong in several ways": {
    ops: [{ op: "add", path: "/case_jars/-", value: { b: 1, name: 5, aa: 2 } }],
    message: "/case_jars/-: Unknown field: aa; /case_jars/-: Unknown field: b; /case_jars/-/name: name must be a string",
  },
  "a row replaced wrong in several ways": {
    ops: [{ op: "replace", path: "/case_jars/1", value: { nope: 1, case_shelves_id: 1.5 } }],
    message: `/case_jars/1: Unknown field: nope; /case_jars/1/case_shelves_id: case_shelves_id must be an id: an integer, or text; /case_jars/1: Required field missing: name ${LEFT_OUT}`,
  },
  "the root replaced wrong in several ways": {
    ops: [{ op: "replace", path: "/case_shelves", value: { zz: 1, rank: 1.5, label: 5, note: 3, b: 2 } }],
    message: [
      "/case_shelves: Unknown field: b", "/case_shelves: Unknown field: zz",
      "/case_shelves/label: label must be a string", "/case_shelves/note: note must be a string", "/case_shelves/rank: rank must be an integer",
      ...["checked", "data", "open", "width"].map((c) => `/case_shelves: Required field missing: ${c} ${LEFT_OUT}`),
    ].join("; "),
  },
};

/** A schema's refusal, in the same words on every backend: every one of `refusals`, 400, the whole sentence, and nothing changed by any. */
export function refusalCases(backend: CaseBackend): void {
  describe("a schema's refusal, in delta's words", () => {
    let up: Awaited<ReturnType<CaseBackend>>;
    beforeAll(async () => { up = await backend(shelvesApp); });
    afterAll(async () => { await up.end(); });

    for (const [name, { ops, message }] of Object.entries(refusals)) {
      test(name, async () => {
        const c = mockClient();
        await sendAndAwait(up.ws, c, { action: "open", doc: "case-shelf:1" });
        const r = await sendAndAwait(up.ws, c, { action: "delta", doc: "case-shelf:1", ops });
        expect(r.error).toEqual({ code: 400, message });
        const now = await fresh(up.ws, "case-shelf:1");
        expect(Object.values(now.case_jars)).toEqual([{ id: 1, case_shelves_id: 1, name: "jam" }]);
        expect(now.case_shelves.label).toBe("top");
      });
    }

    test("a time at the edges of what every backend holds is kept: a zone of ±15:59, the year 0001", async () => {
      const c = mockClient();
      await sendAndAwait(up.ws, c, { action: "open", doc: "case-shelf:1" });
      for (const at of ["2021-01-01T00:00:00+15:59", "2021-01-01T00:00:00-1559", "0001-01-01"]) {
        const r = await sendAndAwait(up.ws, c, { action: "delta", doc: "case-shelf:1", ops: [{ op: "replace", path: "/case_shelves/checked", value: at }] });
        expect(r.error).toBeUndefined();
        expect(Date.parse((await fresh(up.ws, "case-shelf:1")).case_shelves.checked)).toBe(Date.parse(at));
      }
    });
  });
}

/** The rule a document says of itself (`accept`): a blank name is no name, and the label is fixed. */
export const ruledApp: CaseApp = {
  schema: shelvesApp.schema,
  docs: [defineDoc("case-ruled:", {
    root: "case_shelves",
    include: ["case_jars"],
    accept: (op) => {
      if (op.path === "/case_shelves/label") return false;
      const name = (op as { value?: { name?: unknown } }).value?.name;
      return op.op !== "add" || (typeof name === "string" && name.trim() !== "") || "A jar needs a name";
    },
  })],
  seed: shelvesApp.seed,
};

/**
 * A document's own rule, asked of each op before any is applied, the same on every backend: its
 * reason refuses the whole write (400) and nothing changes; `false` is refused in delta's words;
 * what it takes is written.
 */
export function acceptCases(backend: CaseBackend): void {
  describe("a document's own rule (accept)", () => {
    let up: Awaited<ReturnType<CaseBackend>>;
    beforeAll(async () => { up = await backend(ruledApp); });
    afterAll(async () => { await up.end(); });
    const jars = async () => Object.values((await fresh(up.ws, "case-ruled:1")).case_jars).map((j: any) => j.name);

    test("its reason refuses the whole write, the ops it took included, and nothing changes", async () => {
      const c = mockClient();
      await sendAndAwait(up.ws, c, { action: "open", doc: "case-ruled:1" });
      const r = await sendAndAwait(up.ws, c, { action: "delta", doc: "case-ruled:1", ops: [
        { op: "add", path: "/case_jars/-", value: { name: "honey" } },
        { op: "add", path: "/case_jars/-", value: { name: "  " } },
      ] });
      expect(r.error).toEqual({ code: 400, message: "A jar needs a name" });
      expect(await jars()).toEqual(["jam"]);
    });

    test("false is refused in delta's words", async () => {
      const c = mockClient();
      await sendAndAwait(up.ws, c, { action: "open", doc: "case-ruled:1" });
      const r = await sendAndAwait(up.ws, c, { action: "delta", doc: "case-ruled:1", ops: [{ op: "replace", path: "/case_shelves/label", value: "low" }] });
      expect(r.error).toEqual({ code: 400, message: "case-ruled:1 does not take replace /case_shelves/label" });
      expect((await fresh(up.ws, "case-ruled:1")).case_shelves.label).toBe("top");
    });

    test("what it takes is written", async () => {
      const c = mockClient();
      await sendAndAwait(up.ws, c, { action: "open", doc: "case-ruled:1" });
      const r = await sendAndAwait(up.ws, c, { action: "delta", doc: "case-ruled:1", ops: [{ op: "add", path: "/case_jars/-", value: { name: "honey" } }] });
      expect(r.error).toBeUndefined();
      expect(await jars()).toEqual(["jam", "honey"]);
    });
  });
}

// ---------------------------------------------------------------------------
// A desk and its bookings: a value the server gives as the row is written
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
/** Does the op give a booking's end: its field, or a row's value that names it? */
const givesEnd = (op: { path: string; value?: unknown }) =>
  op.path.endsWith("/ends") || (typeof op.value === "object" && op.value !== null && "ends" in op.value);

/**
 * A desk's bookings, each ending two weeks from the day it is made: a value a rule gives as
 * the row is written, so the server sets it (`shape`) and stores it; a client may not (`accept`,
 * asked first). `case-askew:` shapes a field the schema does not declare.
 */
export const shapedApp: CaseApp = {
  schema: defineSchema({
    case_desks: { columns: { name: "text" }, temporal: false },
    case_bookings: {
      columns: { title: "text", made: { type: "timestamptz", default: "now" }, ends: "timestamptz?" },
      parent: { collection: "case_desks", fk: "case_desks_id" },
    },
  }),
  docs: [
    defineDoc("case-desk:", {
      root: "case_desks",
      include: ["case_bookings"],
      accept: (op) => !givesEnd(op) || "The desk sets when a booking ends",
      shape: (op) => op.op === "add" && splitPath(op.path)[0] === "case_bookings"
        ? { ...op, value: { ...(op.value as object), ends: new Date(Date.now() + 14 * DAY).toISOString() } }
        : op,
    }),
    defineDoc("case-askew:", {
      root: "case_desks",
      include: ["case_bookings"],
      shape: (op) => (op.op === "add" ? { ...op, value: { ...(op.value as object), colour: "red" } } : op),
    }),
  ],
  seed: {
    tables: {
      case_desks: [{ id: 1, name: "front" }],
      case_bookings: [{ id: 1, case_desks_id: 1, title: "atlas", made: "2026-01-01T09:00:00Z", ends: "2026-01-15T09:00:00Z", valid_from: "2026-01-01T00:00:00.000Z", valid_to: null }],
    },
  },
  ledger: true,
};

/**
 * What the server makes of a write as it is written (`shape`), the same on every backend: asked
 * after the document's rule, of each op of a fresh write; what it answers is validated as any
 * write is, then stored, told and recorded; an undo or a redo is never shaped.
 */
export function shapeCases(backend: CaseBackend): void {
  describe("what the server makes of a write (shape)", () => {
    let up: Awaited<ReturnType<CaseBackend>>;
    beforeEach(async () => { up = await backend(shapedApp); });
    afterEach(async () => { await up.end(); });

    const me = mockClient({ local: true });
    const write = async (doc: string, ops: unknown[]) => {
      await sendAndAwait(up.ws, me, { action: "open", doc });
      return sendAndAwait(up.ws, me, { action: "delta", doc, cursor: "desk", ops });
    };
    const bookings = async () => (await fresh(up.ws, "case-desk:1")).case_bookings;

    test("a value the shape gives is stored, set by the server: told to a holder, answered and recorded", async () => {
      const published: any[] = [];
      up.ws.setServer({ publish: (ch: string, raw: string) => published.push({ ch, ...JSON.parse(raw) }) });
      const peer = mockClient({ clientId: "peer" });
      await sendAndAwait(up.ws, peer, { action: "open", doc: "case-desk:1" });
      const before = Date.now();
      const r = await write("case-desk:1", [{ op: "add", path: "/case_bookings/-", value: { title: "maps" } }]);
      const after = Date.now();
      expect(r.error).toBeUndefined();
      const made = Object.values(await bookings()).find((q: any) => q.title === "maps") as any;
      expect(Date.parse(made.ends)).toBeGreaterThanOrEqual(before + 14 * DAY - 1000);
      expect(Date.parse(made.ends)).toBeLessThanOrEqual(after + 14 * DAY + 1000);
      // the answer is what was applied, the value as stored
      expect(r.result.ops).toEqual([{ op: "add", path: `/case_bookings/${made.id}`, value: made }]);
      // a holder is told the row as stored
      const told = await waitFor(() => published.find((m) => m.ch === "case-desk:1" && m.ops));
      expect(told.ops).toEqual([{ op: "add", path: `/case_bookings/${made.id}`, value: made }]);
    });

    test("it is asked after the document's rule: a client may not give what the server sets", async () => {
      expect((await write("case-desk:1", [{ op: "add", path: "/case_bookings/-", value: { title: "maps", ends: "2030-01-01T00:00:00Z" } }])).error)
        .toEqual({ code: 400, message: "The desk sets when a booking ends" });
      expect((await write("case-desk:1", [{ op: "replace", path: "/case_bookings/1/ends", value: "2030-01-01T00:00:00Z" }])).error)
        .toEqual({ code: 400, message: "The desk sets when a booking ends" });
      expect(Object.keys(await bookings())).toEqual(["1"]);
    });

    test("what it answers is validated as any write is", async () => {
      expect((await write("case-askew:1", [{ op: "add", path: "/case_bookings/-", value: { title: "maps" } }])).error)
        .toEqual({ code: 400, message: "/case_bookings/-: Unknown field: colour" });
      expect(Object.keys(await bookings())).toEqual(["1"]);
    });

    test("an undo or a redo is never shaped: each puts back what was recorded", async () => {
      expect((await write("case-desk:1", [{ op: "remove", path: "/case_bookings/1" }])).error).toBeUndefined();
      expect((await sendAndAwait(up.ws, me, { action: "undo", cursor: "desk" })).error).toBeUndefined();
      expect((await bookings())["1"].ends).toBe("2026-01-15T09:00:00+00:00");
      const r = await write("case-desk:1", [{ op: "add", path: "/case_bookings/-", value: { title: "maps" } }]);
      const id = String(r.result.ops[0].value.id);
      const ends = (await bookings())[id].ends;
      expect((await sendAndAwait(up.ws, me, { action: "undo", cursor: "desk" })).error).toBeUndefined();
      expect((await bookings())[id]).toBeUndefined();
      await Bun.sleep(5);
      expect((await sendAndAwait(up.ws, me, { action: "redo", cursor: "desk" })).error).toBeUndefined();
      expect((await bookings())[id].ends).toBe(ends);
    });
  });
}

// ---------------------------------------------------------------------------
// A log and its entries: a time only the server sets
// ---------------------------------------------------------------------------

/**
 * A log's entries, each written `at` the server's time (`default: "now"`): the entries keep
 * versions, so a replace is a new version; on the ledger, so a walk is asked too.
 */
export const stampedApp: CaseApp = {
  schema: defineSchema({
    case_logs: { columns: { title: "text" }, temporal: false },
    case_entries: {
      columns: { text: "text", at: { type: "timestamptz", default: "now" } },
      parent: { collection: "case_logs", fk: "case_logs_id" },
    },
  }),
  docs: [defineDoc("case-log:", { root: "case_logs", include: ["case_entries"] })],
  seed: {
    tables: {
      case_logs: [{ id: 1, title: "day" }],
      case_entries: [{ id: 1, case_logs_id: 1, text: "kept", at: "2026-01-01T09:00:00Z", valid_from: "2026-01-01T00:00:00.000Z", valid_to: null }],
    },
  },
  ledger: true,
};

/** delta's words for a time only the server sets, named by a write. */
const serverSets = (path: string) => `${path}: at is set by the server as the row is written (default: "now"): leave it out`;

/**
 * A time only the server sets (`default: "now"`), the same on every backend: a row a write makes
 * that leaves it out takes the server's time as it is written, in UTC to the millisecond, one time
 * for every row of the write; a write that names it is refused (400), in delta's words; a replace of
 * the row whole that leaves it out keeps the row's own; and a walk, which is no write, puts back the
 * time the row had, as rows imported keep theirs.
 */
export function serverTimeCases(backend: CaseBackend): void {
  describe('a time only the server sets (default: "now")', () => {
    let up: Awaited<ReturnType<CaseBackend>>;
    beforeEach(async () => { up = await backend(stampedApp); });
    afterEach(async () => { await up.end(); });

    const me = mockClient({ local: true });
    const write = async (ops: unknown[]) => {
      await sendAndAwait(up.ws, me, { action: "open", doc: "case-log:1" });
      return sendAndAwait(up.ws, me, { action: "delta", doc: "case-log:1", cursor: "stamp", ops });
    };
    const entries = async () => (await fresh(up.ws, "case-log:1")).case_entries;
    const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?\+00:00$/;

    test("an add that leaves it out takes the server's time as the row is written, in UTC, one time for the write", async () => {
      const before = Date.now();
      const r = await write([
        { op: "add", path: "/case_entries/-", value: { text: "first" } },
        { op: "add", path: "/case_entries/-", value: { text: "second" } },
      ]);
      const after = Date.now();
      expect(r.error).toBeUndefined();
      const rows = Object.values(await entries()) as any[];
      const at = rows[1].at;
      expect(rows.map((e) => [e.text, e.at])).toEqual([["kept", "2026-01-01T09:00:00+00:00"], ["first", at], ["second", at]]);
      expect(at).toMatch(UTC);
      // the clock the database keeps (a Postgres server's) may stand a little off this process's
      expect(Date.parse(at)).toBeGreaterThanOrEqual(before - 5000);
      expect(Date.parse(at)).toBeLessThanOrEqual(after + 5000);
    });

    test("a write that names it is refused, 400, in delta's words, and nothing changes", async () => {
      expect((await write([{ op: "add", path: "/case_entries/-", value: { text: "late", at: "2020-01-01T00:00:00Z" } }])).error)
        .toEqual({ code: 400, message: serverSets("/case_entries/-/at") });
      expect((await write([{ op: "replace", path: "/case_entries/1/at", value: "2020-01-01T00:00:00Z" }])).error)
        .toEqual({ code: 400, message: serverSets("/case_entries/1/at") });
      expect((await write([{ op: "replace", path: "/case_entries/1", value: { text: "changed", at: "2026-01-01T09:00:00Z" } }])).error)
        .toEqual({ code: 400, message: serverSets("/case_entries/1/at") });
      // a batch with one such op writes nothing of the rest
      expect((await write([
        { op: "add", path: "/case_entries/-", value: { text: "fine" } },
        { op: "replace", path: "/case_entries/1/at", value: null },
      ])).error).toEqual({ code: 400, message: serverSets("/case_entries/1/at") });
      expect(Object.values(await entries())).toEqual([{ id: 1, case_logs_id: 1, text: "kept", at: "2026-01-01T09:00:00+00:00" }]);
    });

    test("a replace of the row whole that leaves it out keeps the row's own time", async () => {
      const r = await write([{ op: "replace", path: "/case_entries/1", value: { text: "changed" } }]);
      expect(r.error).toBeUndefined();
      expect((await entries())["1"]).toEqual({ id: 1, case_logs_id: 1, text: "changed", at: "2026-01-01T09:00:00+00:00" });
    });

    test("a walk is no write: an undo puts the row back with the time it had", async () => {
      expect((await write([{ op: "remove", path: "/case_entries/1" }])).error).toBeUndefined();
      expect((await entries())["1"]).toBeUndefined();
      expect((await sendAndAwait(up.ws, me, { action: "undo", cursor: "stamp" })).error).toBeUndefined();
      expect((await entries())["1"]).toEqual({ id: 1, case_logs_id: 1, text: "kept", at: "2026-01-01T09:00:00+00:00" });
      expect((await sendAndAwait(up.ws, me, { action: "redo", cursor: "stamp" })).error).toBeUndefined();
      expect((await sendAndAwait(up.ws, me, { action: "undo", cursor: "stamp" })).error).toBeUndefined();
      expect((await entries())["1"].at).toBe("2026-01-01T09:00:00+00:00");
    });
  });
}

/** `add /<coll>/-` makes a row the server names: told and stored under its id, the path's id winning over the value's. */
export function createRowCases(backend: CaseBackend): void {
  describe("add /coll/- makes a row the server names", () => {
    let up: Awaited<ReturnType<CaseBackend>>;
    beforeEach(async () => { up = await backend(roomsApp); });
    afterEach(async () => { await up.end(); });

    test("a peer told of two adds holds each under the id it was given", async () => {
      const published: any[] = [];
      up.ws.setServer({ publish: (_ch: string, raw: string) => published.push(JSON.parse(raw)) });
      const peer = mockClient({ clientId: "peer" });
      const ada = mockClient({ clientId: "ada" });
      const view = (await sendAndAwait(up.ws, peer, { action: "open", doc: "case-room:1" })).result;
      delete view._v;
      await sendAndAwait(up.ws, ada, { action: "open", doc: "case-room:1" });
      for (const text of ["hello", "again"]) {
        const r = await sendAndAwait(up.ws, ada, { action: "delta", doc: "case-room:1", ops: [{ op: "add", path: "/case_messages/-", value: { text } }] });
        expect(r.error).toBeUndefined();
      }
      for (let i = 0; i < 50 && published.length < 2; i++) await Bun.sleep(20);
      for (const m of published) {
        expect(splitPath(m.ops[0].path)[1]).not.toBe("-");   // the echo names the row
        applyOps(view, m.ops);
      }
      const rows = Object.entries(view.case_messages as Record<string, any>);
      expect(rows.map(([, r]) => r.text).sort()).toEqual(["again", "hello", "hi"]);
      for (const [key, row] of rows) expect(String(row.id)).toBe(key);   // the row carries its id
      const now = await fresh(up.ws, "case-room:1");
      delete now._v;
      expect(now).toEqual(view);
    });

    test("the path names the row, whatever the value's id says", async () => {
      const ada = mockClient();
      await sendAndAwait(up.ws, ada, { action: "open", doc: "case-room:1" });
      const r = await sendAndAwait(up.ws, ada, {
        action: "delta", doc: "case-room:1", inverse: true,
        ops: [{ op: "add", path: "/case_messages/-", value: { id: 999, text: "forged id" } }],
      });
      expect(r.error).toBeUndefined();
      const now = await fresh(up.ws, "case-room:1");
      expect(now.case_messages["999"]).toBeUndefined();
      expect(Object.values(now.case_messages).map((m: any) => m.text).sort()).toEqual(["forged id", "hi"]);
    });
  });
}

// ---------------------------------------------------------------------------
// A library: unique constraints
// ---------------------------------------------------------------------------

/**
 * A library's books, each titled once, and its readers' holds, each book on one
 * open hold at a time (`unique`, `whereNull`): the holds keep versions, so a
 * closed version (replaced, removed) holds nothing.
 */
export const libraryApp: CaseApp = {
  schema: defineSchema({
    case_books: { columns: { name: "text" }, temporal: false, unique: ["name"] },
    case_readers: { columns: { name: "text" }, temporal: false },
    case_holds: {
      columns: { book: "integer", ended: "timestamptz?" },
      parent: { collection: "case_readers", fk: "case_readers_id" },
      unique: [{ columns: ["book"], whereNull: ["ended"] }],
    },
  }),
  docs: [
    defineDoc("case-library:", { root: "case_books", include: [] }),
    defineDoc("case-reader:", { root: "case_readers", include: ["case_holds"] }),
  ],
  seed: {
    tables: {
      case_books: [{ id: 1, name: "emma" }, { id: 2, name: "dune" }],
      case_readers: [{ id: 1, name: "ann" }, { id: 2, name: "bob" }],
      case_holds: [{ id: 1, case_readers_id: 1, book: 1, ended: null, valid_from: "2026-01-01T00:00:00.000Z", valid_to: null }],
    },
  },
};

/** A unique constraint refuses a row that would share its values, 409, and nothing is written; rows outside it (a hold ended, a version closed) do not count. */
export function uniqueCases(backend: CaseBackend): void {
  describe("a unique constraint", () => {
    let up: Awaited<ReturnType<CaseBackend>>;
    beforeEach(async () => { up = await backend(libraryApp); });
    afterEach(async () => { await up.end(); });

    const write = async (doc: string, ops: unknown[]) => {
      const c = mockClient();
      await sendAndAwait(up.ws, c, { action: "open", doc });
      return sendAndAwait(up.ws, c, { action: "delta", doc, ops });
    };
    const holds = async (reader: number) => Object.values((await fresh(up.ws, `case-reader:${reader}`)).case_holds ?? {}).map((h: any) => ({ book: h.book, open: h.ended === null }));

    test("a second book of the same name is refused, 409, and a rename onto one too", async () => {
      const twin = (await write("case-library:", [{ op: "add", path: "/case_books/-", value: { name: "emma" } }])).error;
      expect(twin?.code).toBe(409);
      expect(twin?.message).toStartWith("Already there: another row has the same"); // in delta's words on every backend, never the database's
      expect((await write("case-library:", [{ op: "replace", path: "/case_books/2/name", value: "emma" }])).error?.code).toBe(409);
      const books = Object.values((await fresh(up.ws, "case-library:")).case_books).map((t: any) => t.name).sort();
      expect(books).toEqual(["dune", "emma"]);
    });

    test("a book on one open hold is refused a second, 409, and the batch it was in writes nothing", async () => {
      const r = await write("case-reader:2", [
        { op: "add", path: "/case_holds/-", value: { book: 2 } },
        { op: "add", path: "/case_holds/-", value: { book: 1 } },
      ]);
      expect(r.error?.code).toBe(409);
      expect(await holds(2)).toEqual([]);
    });

    test("once its hold has ended, the book may be held again; a replace of the open hold keeps its own place", async () => {
      expect((await write("case-reader:1", [{ op: "replace", path: "/case_holds/1", value: { book: 1, ended: null } }])).error).toBeUndefined();
      expect((await write("case-reader:1", [{ op: "replace", path: "/case_holds/1/ended", value: "2026-02-01T00:00:00Z" }])).error).toBeUndefined();
      expect((await write("case-reader:2", [{ op: "add", path: "/case_holds/-", value: { book: 1 } }])).error).toBeUndefined();
      expect(await holds(2)).toEqual([{ book: 1, open: true }]);
    });

    test("a hold removed holds nothing: the book may be held again", async () => {
      expect((await write("case-reader:1", [{ op: "remove", path: "/case_holds/1" }])).error).toBeUndefined();
      expect((await write("case-reader:2", [{ op: "add", path: "/case_holds/-", value: { book: 1 } }])).error).toBeUndefined();
      expect(await holds(2)).toEqual([{ book: 1, open: true }]);
    });
  });
}

// ---------------------------------------------------------------------------
// A cinema: a column that names a row of another collection (refs)
// ---------------------------------------------------------------------------

/**
 * Screens and their showings, each showing naming a film (`refs`), and perhaps an usher: the films
 * keep no versions, the showings and ushers do. Films and ushers are lists of their own.
 */
export const cinemaApp: CaseApp = {
  schema: defineSchema({
    case_films: { columns: { name: "text" }, temporal: false },
    case_ushers: { columns: { name: "text" } },
    case_screens: { columns: { name: "text" }, temporal: false },
    case_showings: {
      columns: { film: "integer", usher: "integer?" },
      parent: { collection: "case_screens", fk: "case_screens_id" },
      refs: { film: "case_films", usher: "case_ushers" },
    },
  }),
  docs: [
    defineDoc("case-films:", { root: "case_films", include: [] }),
    defineDoc("case-ushers:", { root: "case_ushers", include: [] }),
    defineDoc("case-screen:", { root: "case_screens", include: ["case_showings"] }),
    defineDoc("case-program:", { root: "case_films", include: ["case_showings"] }),
  ],
  seed: {
    tables: {
      case_films: [{ id: 1, name: "metropolis" }, { id: 2, name: "vertigo" }],
      case_ushers: [{ id: 1, name: "ida", valid_from: "2026-01-01T00:00:00.000Z", valid_to: null }],
      case_screens: [{ id: 1, name: "one" }, { id: 2, name: "two" }],
      case_showings: [{ id: 1, case_screens_id: 1, film: 1, usher: 1, valid_from: "2026-01-01T00:00:00.000Z", valid_to: null }],
    },
  },
  ledger: true,
};

/**
 * A column that names a row of another collection (`refs`), the same on every backend, asked at the
 * end of the write: a write that leaves it naming a row not there is refused, 404; one that takes away
 * a row a current row still names, 409, saying who names it; a closed version names nothing; and a
 * walk is held to it as any write is.
 */
export function refsCases(backend: CaseBackend): void {
  describe("a column that names a row of another collection (refs)", () => {
    let up: Awaited<ReturnType<CaseBackend>>;
    beforeEach(async () => { up = await backend(cinemaApp); });
    afterEach(async () => { await up.end(); });

    const write = async (doc: string, ops: unknown[], cursor = "box") => {
      const c = mockClient({ local: true });
      await sendAndAwait(up.ws, c, { action: "open", doc });
      return sendAndAwait(up.ws, c, { action: "delta", doc, cursor, ops });
    };
    const films = async () => Object.keys((await fresh(up.ws, "case-films:")).case_films);
    const showings = async () => Object.values((await fresh(up.ws, "case-screen:1")).case_showings ?? {}).map((s: any) => [s.id, s.film, s.usher]);

    test("a write that names a row not there is refused, 404, and nothing changes", async () => {
      expect((await write("case-screen:1", [{ op: "add", path: "/case_showings/-", value: { film: 99 } }])).error)
        .toEqual({ code: 404, message: "Row not found: case_films/99 -- case_showings/2's film names it" });
      expect((await write("case-screen:1", [{ op: "replace", path: "/case_showings/1/film", value: 99 }])).error)
        .toEqual({ code: 404, message: "Row not found: case_films/99 -- case_showings/1's film names it" });
      expect((await write("case-screen:1", [{ op: "replace", path: "/case_showings/1", value: { film: 2, usher: 7 } }])).error)
        .toEqual({ code: 404, message: "Row not found: case_ushers/7 -- case_showings/1's usher names it" });
      expect(await showings()).toEqual([[1, 1, 1]]);
      // a row it names that is there, or none (null), is written
      expect((await write("case-screen:1", [{ op: "add", path: "/case_showings/-", value: { film: 2, usher: null } }])).error).toBeUndefined();
      expect((await showings()).length).toBe(2);
    });

    test("a row a current row still names is not removed, 409, saying who names it", async () => {
      expect((await write("case-films:", [{ op: "remove", path: "/case_films/1" }])).error)
        .toEqual({ code: 409, message: "Still named: case_films/1 is case_showings/1's film -- change or remove that first" });
      expect((await write("case-ushers:", [{ op: "remove", path: "/case_ushers/1" }])).error)
        .toEqual({ code: 409, message: "Still named: case_ushers/1 is case_showings/1's usher -- change or remove that first" });
      expect(await films()).toEqual(["1", "2"]);
    });

    test("a write may take both away together, in any order, and a removal takes what it cascades to", async () => {
      expect((await write("case-films:", [{ op: "remove", path: "/case_films/2" }])).error).toBeUndefined();   // named by none
      // the film first, then the showing that names it: asked once the write is done
      expect((await write("case-program:", [
        { op: "remove", path: "/case_films/1" },
        { op: "remove", path: "/case_showings/1" },
      ])).error).toBeUndefined();
      expect(await films()).toEqual([]);
      expect((await write("case-films:", [{ op: "add", path: "/case_films/7", value: { name: "ran" } }])).error).toBeUndefined();
      expect((await write("case-screen:2", [{ op: "add", path: "/case_showings/-", value: { film: 7 } }])).error).toBeUndefined();
      expect((await write("case-films:", [{ op: "remove", path: "/case_films/7" }])).error?.code).toBe(409);
      // a screen removed takes its showings with it: the film they named is free
      expect((await write("case-screen:2", [{ op: "remove", path: "/case_screens/2" }])).error).toBeUndefined();
      expect((await write("case-films:", [{ op: "remove", path: "/case_films/7" }])).error).toBeUndefined();
    });

    test("a closed version names nothing: a showing moved to another film, or removed, frees the one it named", async () => {
      expect((await write("case-screen:1", [{ op: "replace", path: "/case_showings/1/film", value: 2 }])).error).toBeUndefined();
      expect((await write("case-films:", [{ op: "remove", path: "/case_films/1" }])).error).toBeUndefined();
      expect((await write("case-screen:1", [{ op: "remove", path: "/case_showings/1" }])).error).toBeUndefined();
      expect((await write("case-ushers:", [{ op: "remove", path: "/case_ushers/1" }])).error).toBeUndefined();
      // and a row whose version is closed is not there to name
      expect((await write("case-screen:1", [{ op: "add", path: "/case_showings/-", value: { film: 2, usher: 1 } }])).error)
        .toEqual({ code: 404, message: "Row not found: case_ushers/1 -- case_showings/2's usher names it" });
    });

    test("a walk is held to it as any write is", async () => {
      // the film and its showing taken away together, and put back together by an undo
      expect((await write("case-screen:1", [{ op: "remove", path: "/case_showings/1" }], "both")).error).toBeUndefined();
      expect((await write("case-films:", [{ op: "remove", path: "/case_films/1" }], "both")).error).toBeUndefined();
      const local = mockClient({ local: true });
      expect((await sendAndAwait(up.ws, local, { action: "undo", cursor: "both" })).error).toBeUndefined();
      expect((await sendAndAwait(up.ws, local, { action: "undo", cursor: "both" })).error).toBeUndefined();
      expect(await showings()).toEqual([[1, 1, 1]]);
      // a film made, then named by another's showing: undoing its making would leave the showing naming nothing
      const made = await write("case-films:", [{ op: "add", path: "/case_films/-", value: { name: "ran" } }], "maker");
      const id = made.result.ops[0].value.id;
      expect((await write("case-screen:1", [{ op: "add", path: "/case_showings/-", value: { film: id } }], "other")).error).toBeUndefined();
      const undone = await sendAndAwait(up.ws, local, { action: "undo", cursor: "maker" });
      // refused by the store, it is walked as a conflict: nothing changes
      expect(undone.error).toBeUndefined();
      expect(undone.result.conflict).toEqual([`/case_films/${id}`]);
      expect(await films()).toContain(String(id));
    });
  });
}

// ---------------------------------------------------------------------------
// Tenants: write scope
// ---------------------------------------------------------------------------

/**
 * tenants → projects (a direct child, its key put in by the server on an add) →
 * notes (a grandchild, its key coming from the client): two tenants side by
 * side, each the other's sibling document of one prefix, and a list holding all.
 */
export const tenantsApp: CaseApp = {
  schema: defineSchema({
    tenants: { table: "case_tenants", columns: { name: "text" } },
    projects: { table: "case_projects", columns: { title: "text" }, parent: { collection: "tenants", fk: "tenant_id" } },
    notes: { table: "case_notes", columns: { body: "text" }, parent: { collection: "projects", fk: "project_id" } },
  }),
  docs: [
    defineDoc("tenant:", { root: "tenants", include: ["projects", "notes"] }),
    defineDoc("all-tenants:", { root: "tenants", include: ["projects", "notes"] }),
  ],
  seed: {
    tables: {
      tenants: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }],
      projects: [{ id: 10, tenant_id: 1, title: "Alice proj" }, { id: 20, tenant_id: 2, title: "Bob proj" }],
      notes: [{ id: 100, project_id: 10, body: "alice note" }, { id: 200, project_id: 20, body: "BOB SECRET" }],
    },
  },
};

/**
 * memberships hang off teams, and point at users by a key that cascades: a
 * `user:` document includes them but reaches none (cascadeOn is not scope).
 */
export const membershipsApp: CaseApp = {
  schema: defineSchema({
    users: { table: "case_users", columns: { name: "text" } },
    teams: { table: "case_teams", columns: { name: "text" } },
    memberships: { table: "case_memberships", parent: { collection: "teams", fk: "team_id" }, columns: { role: "text", user_id: "integer" }, cascadeOn: ["user_id"] },
  }),
  docs: [
    defineDoc("user:", { root: "users", include: ["memberships"] }),
    defineDoc("team:", { root: "teams", include: ["memberships"] }),
  ],
  seed: {
    tables: {
      users: [{ id: 1, name: "Alice" }],
      teams: [{ id: 1, name: "Eng" }],
      memberships: [{ id: 1, team_id: 1, role: "lead", user_id: 1 }],
    },
  },
};

/** A document writes only the rows it reads: a sibling's row is not there to it, and stays as it was. Each refusal has its positive control. */
export function writeScopeCases(backend: CaseBackend): void {
  describe("a document writes only what it reads", () => {
    let up: Awaited<ReturnType<CaseBackend>>;
    let ada: ReturnType<typeof mockClient>;
    beforeEach(async () => {
      up = await backend(tenantsApp);
      ada = mockClient({ clientId: "ada" });
      await sendAndAwait(up.ws, ada, { action: "open", doc: "tenant:1" });
    });
    afterEach(async () => { await up.end(); });

    const write = (ops: unknown[], doc = "tenant:1") => sendAndAwait(up.ws, ada, { action: "delta", doc, ops });
    const bobs = async () => {
      const b = await fresh(up.ws, "tenant:2");
      return { projects: b.projects, notes: b.notes };
    };
    const bobsAsSeeded = {
      projects: { "20": { id: 20, tenant_id: 2, title: "Bob proj" } },
      notes: { "200": { id: 200, project_id: 20, body: "BOB SECRET" } },
    };

    test("its read really excludes the sibling's rows", async () => {
      const mine = await fresh(up.ws, "tenant:1");
      // the premise of every case below: were scope wider, the refusals would pass and mean nothing
      expect(Object.keys(mine.projects)).toEqual(["10"]);
      expect(Object.keys(mine.notes)).toEqual(["100"]);
    });

    test("a sibling's row is not there to remove: 404, as a row that does not exist", async () => {
      const r = await write([{ op: "remove", path: "/notes/200" }]);
      expect(r.error).toEqual({ code: 404, message: "Row not found: notes/200" });
      expect(await bobs()).toEqual(bobsAsSeeded);
    });

    test("nor through its parent, and no cascade runs", async () => {
      const r = await write([{ op: "remove", path: "/projects/20" }]);
      expect(r.error).toEqual({ code: 404, message: "Row not found: projects/20" });
      expect(await bobs()).toEqual(bobsAsSeeded);
    });

    test("a sibling's field is not there to replace", async () => {
      const r = await write([{ op: "replace", path: "/notes/200/body", value: "OWNED" }]);
      expect(r.error).toEqual({ code: 404, message: "Row not found: notes/200" });
      expect(await bobs()).toEqual(bobsAsSeeded);
    });

    test("nor its whole row", async () => {
      const r = await write([{ op: "replace", path: "/notes/200", value: { body: "OWNED", project_id: 20 } }]);
      expect(r.error).toEqual({ code: 404, message: "Row not found: notes/200" });
      expect(await bobs()).toEqual(bobsAsSeeded);
    });

    test("a grandchild is not grafted onto a sibling's parent", async () => {
      const r = await write([{ op: "add", path: "/notes/-", value: { body: "injected", project_id: 20 } }]);
      expect(r.error).toEqual({ code: 404, message: "Row not found: projects/20" });
      expect(await bobs()).toEqual(bobsAsSeeded);
    });

    test("a row of its own is not moved under a sibling's parent", async () => {
      const r = await write([{ op: "replace", path: "/notes/100/project_id", value: 20 }]);
      expect(r.error).toEqual({ code: 404, message: "Row not found: projects/20" });
      expect(await bobs()).toEqual(bobsAsSeeded);
      expect((await fresh(up.ws, "tenant:1")).notes["100"].project_id).toBe(10);
    });

    test("in scope, every write still lands", async () => {
      expect((await write([{ op: "add", path: "/projects/-", value: { title: "new" } }])).error).toBeUndefined();
      expect((await write([{ op: "add", path: "/notes/-", value: { body: "mine", project_id: 10 } }])).error).toBeUndefined();
      expect((await write([{ op: "replace", path: "/notes/100/body", value: "edited" }])).error).toBeUndefined();
      const mine = await fresh(up.ws, "tenant:1");
      // a direct child's parent key is the document's, put in by the server
      expect(Object.values(mine.projects).map((p: any) => [p.tenant_id, p.title]).sort()).toEqual([[1, "Alice proj"], [1, "new"]]);
      expect(Object.values(mine.notes).map((n: any) => n.body).sort()).toEqual(["edited", "mine"]);
      expect((await write([{ op: "remove", path: "/notes/100" }])).error).toBeUndefined();
      expect((await fresh(up.ws, "tenant:1")).notes["100"]).toBeUndefined();
      expect(await bobs()).toEqual(bobsAsSeeded);
    });

    test("a list holding every tenant writes every row it reads", async () => {
      const all = mockClient();
      const opened = await sendAndAwait(up.ws, all, { action: "open", doc: "all-tenants:" });
      expect(Object.keys(opened.result.notes).sort()).toEqual(["100", "200"]);
      const r = await sendAndAwait(up.ws, all, { action: "delta", doc: "all-tenants:", ops: [{ op: "replace", path: "/notes/200/body", value: "edited by the list" }] });
      expect(r.error).toBeUndefined();
      expect((await bobs()).notes["200"].body).toBe("edited by the list");
    });
  });

  describe("cascadeOn is not scope", () => {
    test("a document that reaches no membership writes none; the one that holds it can", async () => {
      const up = await backend(membershipsApp);
      try {
        const u = mockClient();
        expect((await sendAndAwait(up.ws, u, { action: "open", doc: "user:1" })).result.memberships).toEqual({});
        expect((await sendAndAwait(up.ws, u, { action: "delta", doc: "user:1", ops: [{ op: "remove", path: "/memberships/1" }] })).error).toEqual({ code: 404, message: "Row not found: memberships/1" });
        expect(Object.keys((await fresh(up.ws, "team:1")).memberships)).toEqual(["1"]);
        const t = mockClient();
        await sendAndAwait(up.ws, t, { action: "open", doc: "team:1" });
        expect((await sendAndAwait(up.ws, t, { action: "delta", doc: "team:1", ops: [{ op: "remove", path: "/memberships/1" }] })).error).toBeUndefined();
        expect((await fresh(up.ws, "team:1")).memberships).toEqual({});
      } finally {
        await up.end();
      }
    });
  });
}
