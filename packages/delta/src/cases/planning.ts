/**
 * What calendars, maps, accounting and planning apps need of a store, asked of every backend
 * alike through the wire alone, as `./writes.ts` asks its cases:
 *
 *   columnTypeCases(standUp);   // a `date` (a day, no instant) and a `numeric` (an exact decimal, a string on the wire)
 *   rangeScopeCases(standUp);   // a column given several conditions (a viewport), and an instant in a name
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
