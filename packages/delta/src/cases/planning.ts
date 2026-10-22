/**
 * What calendars, maps, accounting and planning apps need of a store, asked of every backend
 * alike through the wire alone, as `./writes.ts` asks its cases:
 *
 *   columnTypeCases(standUp);   // a `date` (a day, no instant) and a `numeric` (an exact decimal, a string on the wire)
 *
 * where `standUp({ schema, docs, seed })` makes a fresh store with that schema, those documents
 * registered and those rows imported (a `CaseBackend`).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
async function write(ws: WsServer, doc: string, ops: unknown[]): Promise<any> {
  const c = mockClient({ local: true });
  await sendAndAwait(ws, c, { action: "open", doc });
  return sendAndAwait(ws, c, { action: "delta", doc, ops, inverse: true });   // answered with the ops as applied
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
