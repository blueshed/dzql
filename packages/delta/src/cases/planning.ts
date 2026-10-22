/**
 * What calendars, maps, accounting and planning apps need of a store, asked of every backend
 * alike through the wire alone, as `./writes.ts` asks its cases:
 *
 *   columnTypeCases(standUp);   // a `date` (a day, no instant) and a `numeric` (an exact decimal, a string on the wire)
 *   rangeScopeCases(standUp);   // a column given several conditions (a viewport), and an instant in a name
 *   mintedNameCases(standUp);   // a later op names a row an earlier op adds with "-" ($0): an entry and its lines
 *   noOverlapCases(standUp);    // no two current rows of the same values hold overlapping ranges: bookings, leave
 *
 * where `standUp({ schema, docs, seed })` makes a fresh store with that schema, those documents
 * registered and those rows imported (a `CaseBackend`).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { defineDoc, defineSchema } from "../schema";
import type { WsServer } from "../server/server";
import { mockClient, sendAndAwait } from "./support";
import type { CaseApp, CaseBackend } from "./writes";

/** A fresh open of `doc`, as another client reads it: the truth a case checks against. */
async function fresh(ws: WsServer, doc: string): Promise<any> {
  const r = await sendAndAwait(ws, mockClient({ clientId: "reader" }), { action: "open", doc });
  return r.result ?? r;
}

/** A write through `doc`, opened first, as an in-process caller (the server) makes it, answered with what it applied. */
async function write(ws: WsServer, doc: string, ops: unknown[], cursor?: string): Promise<any> {
  const c = mockClient({ local: true });
  await sendAndAwait(ws, c, { action: "open", doc });
  return sendAndAwait(ws, c, { action: "delta", doc, ops, inverse: true, ...(cursor ? { cursor } : {}) });   // answered with the ops as applied
}

// ---------------------------------------------------------------------------
// A ledger of days: a date and an exact decimal
// ---------------------------------------------------------------------------

/**
 * Payments, each on a day (`date`: a calendar day, no instant) and of an amount (`numeric`: an
 * exact decimal, a string on the wire), perhaps until a day and with a tip. Listed whole, from a
 * day, over an amount, and on a day (an add through it is given its day).
 */
export const daysApp: CaseApp = {
  schema: defineSchema({
    case_payments: { columns: { title: "text", day: "date", until: "date?", amount: "numeric", tip: "numeric?" }, temporal: false },
  }),
  docs: [
    defineDoc("case-payments:", { root: "case_payments", include: [] }),
    defineDoc("case-payments-from:", { root: "case_payments", include: [], scope: { day: ">=:from" } }),
    defineDoc("case-payments-over:", { root: "case_payments", include: [], scope: { amount: ">:least" } }),
    defineDoc("case-payments-of:", { root: "case_payments", include: [], scope: { amount: ":sum" } }),
    defineDoc("case-payments-on:", { root: "case_payments", include: [], scope: { day: ":on" } }),
  ],
  seed: {
    tables: {
      case_payments: [
        { id: 1, title: "rent", day: "2026-10-01", until: null, amount: "950.00", tip: null },
        { id: 2, title: "coffee", day: "2026-10-20", until: "2026-10-21", amount: "3.5", tip: "0.50" },
      ],
    },
  },
};

/** What a date or a numeric column refuses, each 400 in delta's words: the op's path, then why. */
export const typeRefusals: Record<string, { ops: unknown[]; message: string }> = {
  "a day the calendar has not": { ops: [{ op: "replace", path: "/case_payments/1/day", value: "2026-02-30" }], message: "/case_payments/1/day: day must be a date, YYYY-MM-DD" },
  "a time, which is no day": { ops: [{ op: "replace", path: "/case_payments/1/day", value: "2026-10-20T08:00:00Z" }], message: "/case_payments/1/day: day must be a date, YYYY-MM-DD" },
  "a day in the year 0": { ops: [{ op: "replace", path: "/case_payments/1/day", value: "0000-01-01" }], message: "/case_payments/1/day: day must be a date, YYYY-MM-DD" },
  "a day as a number": { ops: [{ op: "replace", path: "/case_payments/1/day", value: 20261020 }], message: "/case_payments/1/day: day must be a date, YYYY-MM-DD" },
  "a day left null where none is taken": { ops: [{ op: "replace", path: "/case_payments/1/day", value: null }], message: "/case_payments/1/day: day cannot be null" },
  // a number on the wire is refused, so no float slips in: 0.1 + 0.2 is not 0.3
  "an amount as a number": { ops: [{ op: "replace", path: "/case_payments/1/amount", value: 10.5 }], message: `/case_payments/1/amount: amount must be a decimal, written as a string ("10.50")` },
  "an amount that is no decimal": { ops: [{ op: "replace", path: "/case_payments/1/amount", value: "ten" }], message: `/case_payments/1/amount: amount must be a decimal, written as a string ("10.50")` },
  "an amount with an exponent": { ops: [{ op: "replace", path: "/case_payments/1/amount", value: "1e3" }], message: `/case_payments/1/amount: amount must be a decimal, written as a string ("10.50")` },
  "an amount that is NaN": { ops: [{ op: "replace", path: "/case_payments/1/amount", value: "NaN" }], message: `/case_payments/1/amount: amount must be a decimal, written as a string ("10.50")` },
  "an amount with a plus sign": { ops: [{ op: "replace", path: "/case_payments/1/amount", value: "+1" }], message: `/case_payments/1/amount: amount must be a decimal, written as a string ("10.50")` },
  "an amount with no digit before its point": { ops: [{ op: "replace", path: "/case_payments/1/amount", value: ".5" }], message: `/case_payments/1/amount: amount must be a decimal, written as a string ("10.50")` },
  "an amount with space about it": { ops: [{ op: "replace", path: "/case_payments/1/amount", value: " 1" }], message: `/case_payments/1/amount: amount must be a decimal, written as a string ("10.50")` },
  "an amount left null where none is taken": { ops: [{ op: "replace", path: "/case_payments/1/amount", value: null }], message: "/case_payments/1/amount: amount cannot be null" },
  "a row added with both wrong": {
    ops: [{ op: "add", path: "/case_payments/-", value: { title: "x", day: "soon", amount: 1 } }],
    message: `/case_payments/-/amount: amount must be a decimal, written as a string ("10.50"); /case_payments/-/day: day must be a date, YYYY-MM-DD`,
  },
};

/**
 * A `date` and a `numeric` column, the same on every backend: a date is a day, `YYYY-MM-DD`, kept
 * and given back as written (no instant, no zone); a numeric is an exact decimal, a string on the
 * wire, kept exactly and given back as Postgres's NUMERIC writes it (no leading zeros, no sign on
 * zero, the scale as written: "007.50" is "7.50"); a number, or text that is no decimal, is
 * refused, 400. A scope compares each by value: a day by the calendar, an amount as a number
 * ("3.5" is less than "10", "3.50" is "3.5").
 */
export function columnTypeCases(backend: CaseBackend): void {
  describe("a date and an exact decimal (numeric)", () => {
    let up: Awaited<ReturnType<CaseBackend>>;
    beforeAll(async () => { up = await backend(daysApp); });
    afterAll(async () => { await up.end(); });
    const payments = async (doc = "case-payments:") => (await fresh(up.ws, doc)).case_payments;

    test("each is read as it was kept: a day as written, an amount as a string, exactly", async () => {
      expect(await payments()).toEqual({
        "1": { id: 1, title: "rent", day: "2026-10-01", until: null, amount: "950.00", tip: null },
        "2": { id: 2, title: "coffee", day: "2026-10-20", until: "2026-10-21", amount: "3.5", tip: "0.50" },
      });
    });

    for (const [name, { ops, message }] of Object.entries(typeRefusals)) {
      test(`refused, 400: ${name}`, async () => {
        expect((await write(up.ws, "case-payments:", ops)).error).toEqual({ code: 400, message });
        expect((await payments())["1"]).toEqual({ id: 1, title: "rent", day: "2026-10-01", until: null, amount: "950.00", tip: null });
      });
    }

    test("a write keeps the day and the amount exactly, the amount as Postgres's NUMERIC writes it", async () => {
      const r = await write(up.ws, "case-payments:", [
        { op: "add", path: "/case_payments/-", value: { title: "leap", day: "2028-02-29", amount: "007.50", tip: "-0.00" } },
        { op: "add", path: "/case_payments/-", value: { title: "big", day: "0001-01-01", until: "9999-12-31", amount: "12345678901234567890.123456789", tip: "-0012.30" } },
      ]);
      expect(r.error).toBeUndefined();
      const [leap, big] = r.result.ops.map((o: any) => o.value);
      expect([leap.day, leap.amount, leap.tip]).toEqual(["2028-02-29", "7.50", "0.00"]);
      expect([big.day, big.until, big.amount, big.tip]).toEqual(["0001-01-01", "9999-12-31", "12345678901234567890.123456789", "-12.30"]);
      const now = await payments();
      expect(now[leap.id]).toEqual(leap);
      expect(now[big.id]).toEqual(big);
      // a field replaced, and a nullable one emptied
      expect((await write(up.ws, "case-payments:", [
        { op: "replace", path: `/case_payments/${leap.id}/amount`, value: "0.1" },
        { op: "replace", path: `/case_payments/${leap.id}/tip`, value: null },
        { op: "replace", path: `/case_payments/${leap.id}/day`, value: "2028-03-01" },
      ])).error).toBeUndefined();
      expect((await payments())[leap.id]).toEqual({ ...leap, amount: "0.1", tip: null, day: "2028-03-01" });
      expect((await write(up.ws, "case-payments:", [{ op: "remove", path: `/case_payments/${leap.id}` }, { op: "remove", path: `/case_payments/${big.id}` }])).error).toBeUndefined();
    });

    test("a scope compares a day by the calendar, and an amount by value, not as text", async () => {
      expect(Object.keys(await payments("case-payments-from:2026-10-02"))).toEqual(["2"]);
      expect(Object.keys(await payments("case-payments-from:2026-10-01"))).toEqual(["1", "2"]);
      // as text "3.5" > "10" and "950.00" < "99": by value they are not
      expect(Object.keys(await payments("case-payments-over:10"))).toEqual(["1"]);
      expect(Object.keys(await payments("case-payments-over:99"))).toEqual(["1"]);
      expect(Object.keys(await payments("case-payments-over:3.25"))).toEqual(["1", "2"]);
      expect(Object.keys(await payments("case-payments-over:-1"))).toEqual(["1", "2"]);
      // equal by value: 3.50 is 3.5, 950 is 950.00
      expect(Object.keys(await payments("case-payments-of:3.50"))).toEqual(["2"]);
      expect(Object.keys(await payments("case-payments-of:950"))).toEqual(["1"]);
    });

    test("a scope's value its column cannot take is refused, 400", async () => {
      const c = mockClient();
      expect((await sendAndAwait(up.ws, c, { action: "open", doc: "case-payments-from:2026-13-01" })).error)
        .toEqual({ code: 400, message: `day must be a date, YYYY-MM-DD, not "2026-13-01"` });
      expect((await sendAndAwait(up.ws, c, { action: "open", doc: "case-payments-over:1e3" })).error)
        .toEqual({ code: 400, message: `amount must be a decimal, not "1e3"` });
    });

    test("an add through a list named by a day is given its day", async () => {
      const r = await write(up.ws, "case-payments-on:2026-10-22", [{ op: "add", path: "/case_payments/-", value: { title: "lunch", amount: "12.00" } }]);
      expect(r.error).toBeUndefined();
      const made = r.result.ops[0].value;
      expect([made.day, made.amount]).toEqual(["2026-10-22", "12.00"]);
      expect(Object.values(await payments("case-payments-on:2026-10-22")).map((p: any) => p.title)).toEqual(["lunch"]);
      expect((await write(up.ws, "case-payments:", [{ op: "remove", path: `/case_payments/${made.id}` }])).error).toBeUndefined();
    });
  });
}

// ---------------------------------------------------------------------------
// A map and a calendar: a range scope, and an instant in a name
// ---------------------------------------------------------------------------

/**
 * Sites on a map and the slots of a day. A viewport is a list named by four values, a column given
 * two conditions each (`lat: [">=:south", "<=:north"]`), so its name is
 * `case-sites-in:<east>:<north>:<south>:<west>` (the params alphabetically). A window of time is a
 * list named by two instants, in ISO 8601's basic format (a name's ":" splits the extended one).
 * The slots keep versions, so a name may read them as they stood (`at:`), at an instant too.
 */
export const mapsApp: CaseApp = {
  schema: defineSchema({
    case_sites: { columns: { name: "text", lat: "real", lng: "real" }, temporal: false },
    case_slots: { columns: { title: "text", starts: "timestamptz" } },
  }),
  docs: [
    defineDoc("case-sites-in:", { root: "case_sites", include: [], scope: { lat: [">=:south", "<=:north"], lng: [">=:west", "<=:east"] } }),
    defineDoc("case-slots-between:", { root: "case_slots", include: [], scope: { starts: [">=:from", "<:until"] } }),
    defineDoc("case-slots-at:", { root: "case_slots", include: [], scope: { starts: ":on" } }),
    defineDoc("case-slots-then:", { root: "case_slots", include: [], scope: { when: "at:when" } }),
  ],
  seed: {
    tables: {
      case_sites: [
        { id: 1, name: "london", lat: 51.5, lng: -0.13 },
        { id: 2, name: "paris", lat: 48.86, lng: 2.35 },
        { id: 3, name: "oslo", lat: 59.91, lng: 10.75 },
        { id: 4, name: "madrid", lat: 40.42, lng: -3.7 },
      ],
      case_slots: [
        { id: 1, title: "early", starts: "2026-10-20T07:59:00Z", valid_from: "2026-10-01T00:00:00.000Z", valid_to: null },
        { id: 2, title: "first", starts: "2026-10-20T08:00:00Z", valid_from: "2026-10-01T00:00:00.000Z", valid_to: null },
        { id: 3, title: "last", starts: "2026-10-20T08:59:59.5Z", valid_from: "2026-10-01T00:00:00.000Z", valid_to: null },
        { id: 4, title: "late", starts: "2026-10-20T09:00:00Z", valid_from: "2026-10-01T00:00:00.000Z", valid_to: null },
      ],
    },
  },
};

/** The viewport over london and paris: east 3, north 52, south 45, west -1. */
const BOX = "case-sites-in:3:52:45:-1";

/**
 * A scope that gives a column several conditions, and an instant in a name, the same on every
 * backend: each condition holds (the values bound by their params, alphabetically, as any name's
 * are; an empty one sets none); a write through such a document is held to every one (you may
 * write what you may read); a timestamptz's value may be an instant in ISO 8601's basic format
 * (`20261020T0800Z`, `20261020T080000+0100`), a date as before, and nothing else.
 */
export function rangeScopeCases(backend: CaseBackend): void {
  describe("a column given several conditions (a range), and an instant in a name", () => {
    let up: Awaited<ReturnType<CaseBackend>>;
    beforeEach(async () => { up = await backend(mapsApp); });
    afterEach(async () => { await up.end(); });
    const names = async (doc: string, coll = "case_sites") => Object.values((await fresh(up.ws, doc))[coll] ?? {}).map((r: any) => r.name ?? r.title);

    test("each condition holds: a viewport is a list between two values on each axis", async () => {
      expect(await names(BOX)).toEqual(["london", "paris"]);
      // an empty value sets no condition: everything south of 52 and east of -1, then everything north of 50
      expect(await names("case-sites-in::52::-1")).toEqual(["london", "paris"]);
      expect(await names("case-sites-in:::50:")).toEqual(["london", "oslo"]);
      expect(await names("case-sites-in:")).toEqual(["london", "paris", "oslo", "madrid"]);
    });

    test("a write through it is held to every condition: you may write what you may read", async () => {
      const outside = (id: number | string) => `Row not found: case_sites/${id}`;
      // a row outside the viewport is not there to it
      expect((await write(up.ws, BOX, [{ op: "replace", path: "/case_sites/3/name", value: "x" }])).error).toEqual({ code: 404, message: outside(3) });
      expect((await write(up.ws, BOX, [{ op: "remove", path: "/case_sites/4" }])).error).toEqual({ code: 404, message: outside(4) });
      // one of its own moved past any edge leaves it: refused, and the write undone
      for (const value of [{ lng: 4 }, { lng: -2 }, { lat: 53 }, { lat: 44 }]) {
        const [field, to] = Object.entries(value)[0]!;
        expect((await write(up.ws, BOX, [{ op: "replace", path: `/case_sites/1/${field}`, value: to }])).error)
          .toEqual({ code: 404, message: `${outside(1)} -- the write would take it out of ${BOX}` });
      }
      // an add must land inside it
      const out = await write(up.ws, BOX, [{ op: "add", path: "/case_sites/-", value: { name: "rome", lat: 41.9, lng: 12.5 } }]);
      expect(out.error?.code).toBe(404);
      expect(out.error?.message).toMatch(new RegExp(`^Row not found: case_sites/\\d+ -- the add is not one ${BOX} holds$`));
      expect(await names("case-sites-in:")).toEqual(["london", "paris", "oslo", "madrid"]);
      // inside, every write lands
      const r = await write(up.ws, BOX, [
        { op: "add", path: "/case_sites/-", value: { name: "brussels", lat: 50.85, lng: 2.9 } },
        { op: "replace", path: "/case_sites/1/lng", value: 0 },
      ]);
      expect(r.error).toBeUndefined();
      expect(await names(BOX)).toEqual(["london", "paris", "brussels"]);
    });

    test("an instant in a name, in ISO 8601's basic format: a window of time", async () => {
      // from 08:00Z until 10:00 an hour east (09:00Z), not including it
      expect(await names("case-slots-between:20261020T0800Z:20261020T1000+0100", "case_slots")).toEqual(["first", "last"]);
      expect(await names("case-slots-between:20261020T080000Z:20261020T085959.5Z", "case_slots")).toEqual(["first"]);
      expect(await names("case-slots-between:20261020T0759-00:", "case_slots")).toEqual(["early", "first", "last", "late"]);
      // a date, as before: from midnight UTC
      expect(await names("case-slots-between:2026-10-20:20261020T0800Z", "case_slots")).toEqual(["early"]);
      // by equality: the instant a slot starts at
      expect(await names("case-slots-at:20261020T1000+0100", "case_slots")).toEqual(["late"]);
      expect(await names("case-slots-at:2026-10-20", "case_slots")).toEqual([]);
    });

    test("a name read as it stood, at an instant", async () => {
      expect(await names("case-slots-then:20260930T235959Z", "case_slots")).toEqual([]);
      expect(await names("case-slots-then:20261001T0200+0200", "case_slots")).toEqual(["early", "first", "last", "late"]);
    });

    test("an add through a list named by an instant is given it", async () => {
      const r = await write(up.ws, "case-slots-at:20261020T1030+0100", [{ op: "add", path: "/case_slots/-", value: { title: "coffee" } }]);
      expect(r.error).toBeUndefined();
      expect(Date.parse(r.result.ops[0].value.starts)).toBe(Date.parse("2026-10-20T09:30:00Z"));
      expect(await names("case-slots-at:20261020T0930Z", "case_slots")).toEqual(["coffee"]);
    });

    test("what is no instant is refused, 400, as any value its column cannot take", async () => {
      const c = mockClient();
      for (const bad of ["20261020T2500Z", "20261020T0800", "20261320T0800Z", "20260230T0800Z", "20261020T0800+1600", "20261020"]) {
        expect((await sendAndAwait(up.ws, c, { action: "open", doc: `case-slots-between:${bad}` })).error)
          .toEqual({ code: 400, message: `starts must be a date, YYYY-MM-DD, or an instant, 20261020T0800Z, not "${bad}"` });
      }
      expect((await sendAndAwait(up.ws, c, { action: "open", doc: "case-slots-then:20261020T0800" })).error)
        .toEqual({ code: 400, message: `when must be a date, YYYY-MM-DD, or an instant, 20261020T0800Z, not "20261020T0800"` });
    });
  });
}

// ---------------------------------------------------------------------------
// Books: an entry and its lines in one write ($k)
// ---------------------------------------------------------------------------

/**
 * A journal's entries, each with its lines (a line hangs from its entry by its parent key, and
 * names an account: `refs`), and the chart of accounts beside them, which hangs from nothing. The
 * journal is one list, on the ledger.
 */
export const booksApp: CaseApp = {
  schema: defineSchema({
    case_accounts: { columns: { name: "text" }, temporal: false },
    case_entries: { columns: { memo: "text", day: "date" }, temporal: false },
    case_lines: { columns: { account: "integer", amount: "numeric" }, parent: { collection: "case_entries", fk: "case_entries_id" }, refs: { account: "case_accounts" }, temporal: false },
  }),
  docs: [defineDoc("case-journal:", { root: "case_entries", include: ["case_lines", "case_accounts"] })],
  seed: {
    tables: {
      case_accounts: [{ id: 1, name: "cash" }, { id: 2, name: "sales" }],
      case_entries: [{ id: 1, memo: "opening", day: "2026-10-01" }],
      case_lines: [{ id: 1, case_entries_id: 1, account: 1, amount: "100.00" }, { id: 2, case_entries_id: 1, account: 2, amount: "-100.00" }],
    },
  },
  ledger: true,
};

/** delta's words for a `$k` that names no row an earlier op of the write adds with "-". */
const namesNone = (at: string, k: number) => `${at}: $${k} names no row an earlier op of this write adds with "-"`;

/**
 * A row an earlier op of the same write adds with "-", named by a later op as `$<k>` (k the
 * earlier op's 0-based index in the write), the same on every backend: as a path's row
 * (`/case_entries/$0/memo`), and as the value of a column that names a row by its id (a parent key,
 * a `refs` column), so an entry and its lines are one write. The answer, the holders and the ledger
 * carry the ids the store gave; an undo takes the whole write back. A `$k` that names no such op,
 * or a row of another collection than the column names, is refused (400) and nothing lands; in a
 * column that names no row (text), `$0` is text.
 */
export function mintedNameCases(backend: CaseBackend): void {
  describe('a later op names a row an earlier op adds with "-" ($k)', () => {
    let up: Awaited<ReturnType<CaseBackend>>;
    beforeEach(async () => { up = await backend(booksApp); });
    afterEach(async () => { await up.end(); });
    const journal = async () => fresh(up.ws, "case-journal:");
    const asSeeded = async () => {
      const j = await journal();
      expect([Object.keys(j.case_entries), Object.keys(j.case_lines), Object.keys(j.case_accounts)]).toEqual([["1"], ["1", "2"], ["1", "2"]]);
    };

    test("an entry and its lines in one write: each line's parent key names the entry, and the answer carries the ids the store gave", async () => {
      const r = await write(up.ws, "case-journal:", [
        { op: "add", path: "/case_entries/-", value: { memo: "a sale", day: "2026-10-22" } },
        { op: "add", path: "/case_lines/-", value: { case_entries_id: "$0", account: 1, amount: "10.50" } },
        { op: "add", path: "/case_lines/-", value: { case_entries_id: "$0", account: 2, amount: "-10.50" } },
      ]);
      expect(r.error).toBeUndefined();
      const [entry, debit, credit] = r.result.ops.map((o: any) => o.value);
      expect(r.result.ops.map((o: any) => o.path)).toEqual([`/case_entries/${entry.id}`, `/case_lines/${debit.id}`, `/case_lines/${credit.id}`]);
      expect([debit.case_entries_id, credit.case_entries_id]).toEqual([entry.id, entry.id]);
      expect(JSON.stringify(r.result.inverse)).not.toContain("$");
      const j = await journal();
      expect(Object.values(j.case_lines).filter((l: any) => l.case_entries_id === entry.id).map((l: any) => l.amount)).toEqual(["10.50", "-10.50"]);
    });

    test("as a path's row, and as a refs column's value; the undo takes the whole write back, the redo puts back the same ids", async () => {
      const r = await write(up.ws, "case-journal:", [
        { op: "add", path: "/case_accounts/-", value: { name: "bank" } },
        { op: "add", path: "/case_entries/-", value: { memo: "draft", day: "2026-10-22" } },
        { op: "replace", path: "/case_entries/$1/memo", value: "a deposit" },
        { op: "add", path: "/case_lines/-", value: { case_entries_id: "$1", account: "$0", amount: "5" } },
        { op: "replace", path: "/case_lines/$3/amount", value: "5.00" },
      ], "books");
      expect(r.error).toBeUndefined();
      const [bank, entry] = [r.result.ops[0].value, r.result.ops[1].value];
      let j = await journal();
      expect(j.case_entries[entry.id].memo).toBe("a deposit");
      const line = Object.values(j.case_lines).find((l: any) => l.case_entries_id === entry.id) as any;
      expect([line.account, line.amount]).toEqual([bank.id, "5.00"]);
      const me = mockClient({ local: true });
      expect((await sendAndAwait(up.ws, me, { action: "undo", cursor: "books" })).error).toBeUndefined();
      await asSeeded();
      expect((await sendAndAwait(up.ws, me, { action: "redo", cursor: "books" })).error).toBeUndefined();
      j = await journal();
      expect([j.case_accounts[bank.id]?.name, j.case_entries[entry.id]?.memo, j.case_lines[line.id]?.account]).toEqual(["bank", "a deposit", bank.id]);
    });

    test("a $k that names no row an earlier op adds with \"-\" is refused, 400, and nothing lands", async () => {
      const entry = { op: "add", path: "/case_entries/-", value: { memo: "x", day: "2026-10-22" } };
      const line = (fk: unknown) => ({ op: "add", path: "/case_lines/-", value: { case_entries_id: fk, account: 1, amount: "1" } });
      const cases: [unknown[], string][] = [
        [[entry, line("$5")], namesNone("/case_lines/-/case_entries_id", 5)],   // no such op
        [[line("$0"), entry], namesNone("/case_lines/-/case_entries_id", 0)],   // itself, not an earlier one
        [[entry, line("$2"), line("$0")], namesNone("/case_lines/-/case_entries_id", 2)],   // a later one
        [[{ op: "add", path: "/case_entries/7", value: { memo: "x", day: "2026-10-22" } }, line("$0")], namesNone("/case_lines/-/case_entries_id", 0)],   // an add that named its row
        [[{ op: "replace", path: "/case_entries/1/memo", value: "y" }, line("$0")], namesNone("/case_lines/-/case_entries_id", 0)],   // no add
        [[entry, { op: "replace", path: "/case_entries/$1/memo", value: "y" }], namesNone("/case_entries/$1/memo", 1)],
        [[entry, { op: "replace", path: "/case_lines/1/case_entries_id", value: "$3" }], namesNone("/case_lines/1/case_entries_id", 3)],
        // a row of another collection than the column, or the path, names
        [[{ op: "add", path: "/case_accounts/-", value: { name: "bank" } }, line("$0")], "/case_lines/-/case_entries_id: $0 names a row of case_accounts, and case_entries_id names one of case_entries"],
        [[entry, { op: "add", path: "/case_lines/-", value: { case_entries_id: 1, account: "$0", amount: "1" } }], "/case_lines/-/account: $0 names a row of case_entries, and account names one of case_accounts"],
        [[entry, { op: "replace", path: "/case_lines/$0/amount", value: "2" }], "/case_lines/$0/amount: $0 names a row of case_entries, not of case_lines"],
      ];
      for (const [ops, message] of cases) {
        expect([ops, (await write(up.ws, "case-journal:", ops)).error]).toEqual([ops, { code: 400, message }]);
        await asSeeded();
      }
    });

    test("in a column that names no row, $0 is text", async () => {
      const r = await write(up.ws, "case-journal:", [{ op: "add", path: "/case_entries/-", value: { memo: "$0", day: "2026-10-22" } }]);
      expect(r.error).toBeUndefined();
      expect(r.result.ops[0].value.memo).toBe("$0");
    });
  });
}

// ---------------------------------------------------------------------------
// Bookings, leave and price bands: no two current rows overlap (noOverlap)
// ---------------------------------------------------------------------------

/**
 * Halls and their bookings (`[starts, ends)`, an open end when it is null; the bookings keep
 * versions), people's leave by the day (`[first, last]`: its last day held too), and price bands
 * that no two may share (no `same` columns). Each list is a document of its own; the ledger too.
 */
export const bookedApp: CaseApp = {
  schema: defineSchema({
    case_halls: { columns: { name: "text" }, temporal: false },
    case_bookings: {
      columns: { title: "text", starts: "timestamptz", ends: "timestamptz?" },
      parent: { collection: "case_halls", fk: "case_halls_id" },
      noOverlap: [{ range: ["starts", "ends"], same: ["case_halls_id"] }],
    },
    case_leave: { columns: { person: "integer", first: "date", last: "date" }, temporal: false, noOverlap: [{ range: ["first", "last"], same: ["person"], bounds: "[]" }] },
    case_bands: { columns: { from_qty: "numeric", to_qty: "numeric" }, temporal: false, noOverlap: [{ range: ["from_qty", "to_qty"] }] },
  }),
  docs: [
    defineDoc("case-halls:", { root: "case_halls", include: ["case_bookings"] }),
    defineDoc("case-leave:", { root: "case_leave", include: [] }),
    defineDoc("case-bands:", { root: "case_bands", include: [] }),
  ],
  seed: {
    tables: {
      case_halls: [{ id: 1, name: "great" }, { id: 2, name: "small" }],
      case_bookings: [
        { id: 1, case_halls_id: 1, title: "talk", starts: "2026-10-20T09:00:00Z", ends: "2026-10-20T10:00:00Z", valid_from: "2026-10-01T00:00:00.000Z", valid_to: null },
        { id: 2, case_halls_id: 1, title: "fair", starts: "2026-10-20T14:00:00Z", ends: null, valid_from: "2026-10-01T00:00:00.000Z", valid_to: null },
      ],
      case_leave: [{ id: 1, person: 1, first: "2026-10-05", last: "2026-10-09" }],
      case_bands: [{ id: 1, from_qty: "0", to_qty: "10" }],
    },
  },
  ledger: true,
};

/** delta's words for two rows a noOverlap holds apart. */
const clash = (coll: string, id: number, other: number, same: string | undefined, from: string, to: string) =>
  `Overlaps: ${coll}/${id} and ${coll}/${other}${same ? `, of the same ${same},` : ""} both hold ${from} to ${to} at once -- move or remove one first`;

/**
 * A noOverlap constraint, the same on every backend, asked once the write is done: two current rows
 * of the same `same` values whose ranges overlap are refused (409, naming both: the row the write
 * left first, then the first it meets by id), and nothing is written; a range touching another's
 * end does not overlap it (half open; `"[]"`, a last day held, does); a null end is open; a closed
 * version holds nothing; a batch is judged as it leaves the rows, in either order; a range that
 * ends before it starts is 400; and a walk is held to it as any write is.
 *
 * The code is 409 on every backend; on Postgres it is the listener's for SQLSTATE 23P01 (an
 * exclusion), which comes in beside this (delta #100): until a branch has it, the sentence is asked
 * here and the code by each backend's own test.
 */
export function noOverlapCases(backend: CaseBackend): void {
  describe("no two rows overlap (noOverlap)", () => {
    let up: Awaited<ReturnType<CaseBackend>>;
    beforeEach(async () => { up = await backend(bookedApp); });
    afterEach(async () => { await up.end(); });
    const refused = (r: any, message: string) => expect(r.error?.message).toBe(message);
    const bookings = async () => Object.values((await fresh(up.ws, "case-halls:")).case_bookings).map((b: any) => [b.id, b.case_halls_id, b.title]);
    const at = (h: number) => `2026-10-20T${String(h).padStart(2, "0")}:00:00Z`;
    const book = (hall: number, from: number, to: number | null, title = "x") => ({ op: "add", path: "/case_bookings/-", value: { case_halls_id: hall, title, starts: at(from), ends: to === null ? null : at(to) } });
    const seeded = [[1, 1, "talk"], [2, 1, "fair"]];

    test("a booking over another of the same hall is refused, naming both, and nothing is written", async () => {
      refused(await write(up.ws, "case-halls:", [book(1, 9, 11)]), clash("case_bookings", 3, 1, "case_halls_id", "starts", "ends"));
      refused(await write(up.ws, "case-halls:", [book(1, 8, 9, "ok"), book(1, 8, 10)]), clash("case_bookings", 4, 5, "case_halls_id", "starts", "ends"));
      // an open end: the fair runs on from two
      refused(await write(up.ws, "case-halls:", [book(1, 20, 22)]), clash("case_bookings", 6, 2, "case_halls_id", "starts", "ends"));
      // a row moved over another, by a field
      refused(await write(up.ws, "case-halls:", [{ op: "replace", path: "/case_bookings/1/ends", value: at(15) }]), clash("case_bookings", 1, 2, "case_halls_id", "starts", "ends"));
      expect(await bookings()).toEqual(seeded);
    });

    test("a range that touches another's end, another hall's, or one of its own moved, is kept", async () => {
      const r = await write(up.ws, "case-halls:", [book(1, 10, 11, "after"), book(1, 8, 9, "before"), book(2, 9, 10, "beside"), { op: "replace", path: "/case_bookings/1/starts", value: "2026-10-20T08:30:00Z" }]);
      refused(r, clash("case_bookings", 4, 1, "case_halls_id", "starts", "ends"));
      expect((await write(up.ws, "case-halls:", [book(1, 10, 11, "after"), book(1, 8, 9, "before"), book(2, 9, 10, "beside"), { op: "replace", path: "/case_bookings/1/ends", value: "2026-10-20T09:30:00Z" }])).error).toBeUndefined();
      expect((await bookings()).map(([, hall, title]) => `${hall}:${title}`).sort()).toEqual(["1:after", "1:before", "1:fair", "1:talk", "2:beside"]);
    });

    test("a batch is judged as it leaves the rows: two bookings swapped, in either order", async () => {
      // the talk moves to ten, a new one takes nine: its add first, while the talk still holds nine
      expect((await write(up.ws, "case-halls:", [book(1, 9, 10, "new"), { op: "replace", path: "/case_bookings/1", value: { case_halls_id: 1, title: "talk", starts: at(10), ends: at(11) } }])).error).toBeUndefined();
      expect((await write(up.ws, "case-halls:", [{ op: "replace", path: "/case_bookings/1/starts", value: at(12) }, { op: "replace", path: "/case_bookings/1/ends", value: at(13) }, book(1, 10, 12, "newer")])).error).toBeUndefined();
    });

    test("a closed version holds nothing: a booking removed frees its time", async () => {
      expect((await write(up.ws, "case-halls:", [{ op: "remove", path: "/case_bookings/1" }])).error).toBeUndefined();
      expect((await write(up.ws, "case-halls:", [book(1, 9, 10, "again")])).error).toBeUndefined();
    });

    test("a range that ends before it starts is refused, 400", async () => {
      expect((await write(up.ws, "case-halls:", [{ op: "replace", path: "/case_bookings/1/ends", value: at(8) }])).error)
        .toEqual({ code: 400, message: "case_bookings/1: its ends is before its starts (noOverlap holds a range from starts to ends)" });
      expect(await bookings()).toEqual(seeded);
    });

    test(`a last day held ("[]"): leave the day another ends is a clash; the day after, or another person's, is not`, async () => {
      const leave = (person: number, first: string, last: string) => ({ op: "add", path: "/case_leave/-", value: { person, first, last } });
      refused(await write(up.ws, "case-leave:", [leave(1, "2026-10-09", "2026-10-12")]), clash("case_leave", 2, 1, "person", "first", "last"));
      expect((await write(up.ws, "case-leave:", [leave(1, "2026-10-10", "2026-10-12"), leave(1, "2026-10-13", "2026-10-13"), leave(2, "2026-10-05", "2026-10-09")])).error).toBeUndefined();
      refused(await write(up.ws, "case-leave:", [leave(1, "2026-10-13", "2026-10-13")]), clash("case_leave", 6, 4, "person", "first", "last"));
    });

    test("with no same columns every row is held apart from every other: price bands, by exact value", async () => {
      const band = (from: string, to: string) => ({ op: "add", path: "/case_bands/-", value: { from_qty: from, to_qty: to } });
      expect((await write(up.ws, "case-bands:", [band("10", "20"), band("20.000", "20.001")])).error).toBeUndefined();
      refused(await write(up.ws, "case-bands:", [band("9.99999999999999999", "10")]), clash("case_bands", 4, 1, undefined, "from_qty", "to_qty"));
      refused(await write(up.ws, "case-bands:", [band("20.0005", "21")]), clash("case_bands", 5, 3, undefined, "from_qty", "to_qty"));
    });

    test("a walk is held to it as any write is: an undo that would bring back a clash is walked as a conflict", async () => {
      expect((await write(up.ws, "case-halls:", [{ op: "remove", path: "/case_bookings/1" }], "first")).error).toBeUndefined();
      expect((await write(up.ws, "case-halls:", [book(1, 9, 10, "taken")], "second")).error).toBeUndefined();
      const undone = await sendAndAwait(up.ws, mockClient({ local: true }), { action: "undo", cursor: "first" });
      expect(undone.error).toBeUndefined();
      expect(undone.result.conflict).toEqual(["/case_bookings/1"]);
      expect((await bookings()).map(([, , title]) => title)).toEqual(["fair", "taken"]);
    });
  });
}
